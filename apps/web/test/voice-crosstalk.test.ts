import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_CHARACTERS, STORY_VOICE_CAST } from '@spades/bots';
import { VOICE_DEFER_MAX_WAIT_S, VOICE_DUCK_FACTOR, VOICE_MAX_OVERLAP_REMAINING_S, VOICE_TAIL_S, planVoiceArrival, voiceRoomWaitS, type ActiveVoiceInfo } from '../src/audio';

/**
 * Story cross-talk (owner, the Porch 2026-10-22: "only one person can talk
 * at a time… if Pat says something, Unc can start before she finishes and
 * they both continue at times"). Until now the voice channel was strictly
 * serial — a new line cut the playing one, every time (startVoice's
 * stopVoice). On story surfaces a conversational line may now start over
 * the TAIL of a different speaker's line: max two voices, the first
 * ducked ≈ −6 dB and restored if it outlives the second, same speaker
 * still cuts, and the variation is a roll so it lands like people, not a
 * metronome. These tests pin the pure plan, the speakBot opt-in wiring,
 * and the engine's duck/restore application. Source selection is NOT in
 * scope here: the story fence (cast recording or text only) is untouched.
 */
const act = (speaker: string | null, remainingS: number, elapsedS: number): ActiveVoiceInfo => ({ speaker, remainingS, elapsedS });

describe('the cross-talk plan', () => {
  it('an empty room: the line just plays', () => {
    expect(planVoiceArrival([], 'Pat', 0)).toEqual({ kind: 'play' });
    expect(planVoiceArrival([], 'Pat', 0.99)).toEqual({ kind: 'play' });
  });

  it('the bounds: duck is −5 to −7 dB; the window is a tail (≤ 3 s left), deeper in it likelier', () => {
    const db = 20 * Math.log10(VOICE_DUCK_FACTOR);
    expect(db).toBeLessThanOrEqual(-5);
    expect(db).toBeGreaterThanOrEqual(-7);
    expect(VOICE_TAIL_S).toBeGreaterThan(0);
    expect(VOICE_MAX_OVERLAP_REMAINING_S).toBeGreaterThan(VOICE_TAIL_S);
    expect(VOICE_MAX_OVERLAP_REMAINING_S).toBeLessThanOrEqual(3);
  });

  it('a speaker never overlaps their own next line — it cuts, at any roll, at any depth', () => {
    expect(planVoiceArrival([act('Pat', 0.5, 4)], 'Pat', 0)).toEqual({ kind: 'replace' });
    expect(planVoiceArrival([act('Uncle Ray', 2, 3), act('Pat', 0.5, 4)], 'Pat', 0)).toEqual({ kind: 'replace' });
    expect(planVoiceArrival([act('Pat', 0.5, 4), act('Uncle Ray', 0.5, 4)], 'Pat', 0)).toEqual({ kind: 'replace' });
  });

  it('a line with most of its body left is never talked over', () => {
    expect(planVoiceArrival([act('Pat', VOICE_MAX_OVERLAP_REMAINING_S + 0.1, 1)], 'Uncle Ray', 0)).toEqual({ kind: 'replace' });
    expect(planVoiceArrival([act('Pat', 9, 2)], 'Uncle Ray', 0)).toEqual({ kind: 'replace' });
  });

  it('deep in the tail the reply usually starts over it — but not always (the variation)', () => {
    const tail = [act('Pat', VOICE_TAIL_S - 0.4, 4)];
    expect(planVoiceArrival(tail, 'Uncle Ray', 0)).toEqual({ kind: 'overlap', keepIndex: 0 });
    expect(planVoiceArrival(tail, 'Uncle Ray', 0.8)).toEqual({ kind: 'overlap', keepIndex: 0 }); // deep tail: p = 0.85
    expect(planVoiceArrival(tail, 'Uncle Ray', 0.9)).toEqual({ kind: 'replace' });
  });

  it('mid-tail it is a coin flip', () => {
    const mid = [act('Pat', VOICE_TAIL_S + 0.8, 2)];
    expect(planVoiceArrival(mid, 'Uncle Ray', 0.4)).toEqual({ kind: 'overlap', keepIndex: 0 }); // mid tail: p = 0.5
    expect(planVoiceArrival(mid, 'Uncle Ray', 0.6)).toEqual({ kind: 'replace' });
  });

  it('two arrivals in the same breath are a cut, not a chord (the line must be under way)', () => {
    expect(planVoiceArrival([act('Pat', 1, 0.1)], 'Uncle Ray', 0)).toEqual({ kind: 'replace' });
    expect(planVoiceArrival([act('Pat', 1, 0.39)], 'Uncle Ray', 0)).toEqual({ kind: 'replace' });
    expect(planVoiceArrival([act('Pat', 1, 0.4)], 'Uncle Ray', 0)).toEqual({ kind: 'overlap', keepIndex: 0 });
  });

  it('never a third voice: with two up, an approved overlap keeps only the newest; otherwise the room resets', () => {
    const two = [act('Pat', 0.4, 6), act('Uncle Ray', VOICE_TAIL_S - 0.2, 3)];
    expect(planVoiceArrival(two, 'Dee', 0)).toEqual({ kind: 'overlap', keepIndex: 1 });
    expect(planVoiceArrival(two, 'Dee', 0.95)).toEqual({ kind: 'replace' });
    const newestBusy = [act('Pat', 0.4, 6), act('Uncle Ray', 9, 1)];
    expect(planVoiceArrival(newestBusy, 'Dee', 0)).toEqual({ kind: 'replace' });
  });
});

/* ---------- speakBot wiring: cross-talk everywhere; deferral is the regular-table half ---------- */

const clip = vi.hoisted(() => ({ played: true, calls: [] as unknown[][] }));
vi.mock('../src/voices/voices', () => ({
  playClip: (...args: unknown[]) => { clip.calls.push(args); return Promise.resolve(clip.played); },
  rawLine: (_id?: string) => undefined,
  clipDurationMs: () => Promise.resolve(null),
}));

const speech = {
  speak: vi.fn(),
  cancel: vi.fn(),
  speaking: false,
  pending: false,
  getVoices: () => [] as SpeechSynthesisVoice[],
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
};

async function load() {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } });
  vi.stubGlobal('speechSynthesis', speech);
  vi.stubGlobal('SpeechSynthesisUtterance', class { onend: (() => void) | null = null; onerror: (() => void) | null = null; });
  vi.resetModules();
  return import('../src/talkPrefs');
}
const flush = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { clip.played = true; clip.calls = []; speech.speak.mockClear(); speech.cancel.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('speakBot cross-talk opt-in', () => {
  it('on a story surface, a conversational cast line opts in — without deferral (story pacing is upstream)', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    speakBot('Uncle Ray', 'A scripted story line, keyed by its own text.', 'storyteller');
    await flush();
    expect(clip.calls.length).toBe(1);
    expect(clip.calls[0]![7]).toEqual({ crossTalk: true, deferCut: false });
    setStoryVoiceScope(false);
  });

  it('end-of-hand banter is chatter: a bid value only picks its numbered take and does not gate cross-talk', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    speakBot('Pat', 'You bid 7 for THAT?!', 'storyteller', undefined, 7);
    await flush();
    expect(clip.calls.length).toBe(1);
    expect(clip.calls[0]![4]).toBe(7); // the bid still reaches the take lookup, untouched
    expect(clip.calls[0]![7]).toEqual({ crossTalk: true, deferCut: false });
    setStoryVoiceScope(false);
  });

  it('off story surfaces the same cross-talk opts in — WITH deferral: regular-table chatter waits or drops, never cuts', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(false);
    speakBot('Uncle Ray', 'A scripted story line, keyed by its own text.', 'storyteller');
    speakBot('Big Mike', 'generic display text', 'hothead');
    await flush();
    expect(clip.calls.length).toBe(2);
    expect(clip.calls[0]![7]).toEqual({ crossTalk: true, deferCut: true });
    expect(clip.calls[1]![7]).toEqual({ crossTalk: true, deferCut: true });
  });

  it('the story fence is untouched: catalog talk for a cast member in scope never reaches the clip layer', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    speakBot('Uncle Ray', 'generic display text', 'comedian', 'talk.template.id', 4);
    await flush();
    expect(clip.calls.length).toBe(0);
    expect(speech.speak).not.toHaveBeenCalled();
    setStoryVoiceScope(false);
  });
});

/* ---------- the fence, held through the end-of-hand window (owner directive, 2026-10-22) ---------- */
/**
 * "Make sure this doesn't happen at all in any scenario going forward": a
 * story character must NEVER speak with a non-cast voice — not a persona
 * clip, not an AI catalog clip, not the robot — on any surface or seam.
 * The prime suspect was the end-of-hand banter window (after the last
 * card, during collection, before the recap). The audit: Table raises
 * story scope in an effect keyed ONLY on the stop id, so hand end and
 * phase changes cannot drop it mid-match; the banter lines fire inside
 * that scope and hit the same fence as all catalog talk; the recap and
 * versus surfaces contain no speech calls at all. These pins hold that
 * shut alongside story-voice-consistency.test.ts (which sweeps the
 * scene/session/talk shapes).
 */
describe('the fence through the end-of-hand window', () => {
  it('collection banter shape, all 23 cast, in scope: no clip resolution, no robot — cast-or-text only', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    for (const c of Object.values(STORY_CHARACTERS)) {
      clip.calls = [];
      // the exact Table collection-banter call shape (name, text, persona, line id, bid, seat, count)
      speakBot(c.name, 'generic banter display text', STORY_VOICE_CAST[c.id]!.cardPersona, 'talk.template.id', 4, 'top', 4);
      await flush();
      expect(clip.calls.length, c.name).toBe(0);
      expect(speech.speak, c.name).not.toHaveBeenCalled();
      expect(speech.cancel, c.name).not.toHaveBeenCalled();
    }
    setStoryVoiceScope(false);
  });

  it('scope covers the whole match lifecycle: raised per stop, cleared only on unmount / stop change — never on hand end', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const fx = table.slice(table.indexOf('Story voice scope (one-timbre rule'), table.indexOf('}, [storyStopId]);'));
    expect(fx).toContain('setStoryVoiceScope(true);');
    expect(fx).toContain('setStoryVoiceScope(false)');
    expect(fx).not.toContain('handOver');
    expect(fx).not.toContain('phase');
    // and the banter that fires inside that window is the catalog shape the fence stops
    expect(table).toContain('speakBot(l.name, l.text, l.persona, l.line, l.bid, pos[l.seat], n)');
  });

  it('recap and versus surfaces cannot voice anyone: no speech calls exist there at all', () => {
    for (const f of ['../src/Intermission.tsx', '../src/VersusIntro.tsx']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toContain('speakBot');
      expect(src, f).not.toContain('speechSynthesis');
      expect(src, f).not.toContain('playClip');
    }
  });
});

/* ---------- engine application (source pins, the repo's pattern for the engine) ---------- */

describe('engine application', () => {
  const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
  const voices = readFileSync(new URL('../src/voices/voices.ts', import.meta.url), 'utf8');

  it('the serial path is the same startVoice with no cross-talk — non-story callers are byte-equivalent in behaviour', () => {
    expect(audio).toContain('return this.startVoice(buf, gain, slice, seat, playerCount, null);');
    expect(audio).toContain('} else this.stopVoice();');
  });

  it('the duck is applied to the kept line on overlap and restored when the overlapping line ends', () => {
    expect(audio).toContain('keep.gain.gain.setTargetAtTime(keep.baseGain * VOICE_DUCK_FACTOR, now, 0.06)');
    expect(audio).toContain('if (d && d.duckedBy === slot && this.voiceSlots.includes(d))');
    expect(audio).toContain('d.gain.gain.setTargetAtTime(d.baseGain, c.currentTime, 0.09)');
  });

  it('stopVoice clears every slot (an overlap never survives leaving the table or voices-off)', () => {
    expect(audio).toContain('const slots = this.voiceSlots; this.voiceSlots = [];');
  });

  it('playClip routes opt-ins to the cross-talk entry and everything else to the serial one', () => {
    expect(voices).toContain('sound.playVoiceCrossTalk(sp.buf, gain,');
    expect(voices).toContain('else sound.playVoice(sp.buf, gain,');
  });
});

/* ---------- regular tables: the no-mid-sentence-cut rule (owner, bot games 2026-10-22) ---------- */
/**
 * "The bot games have that issue where they are being cut off mid
 * sentence" — at regular tables every arrival used to take the serial
 * path and stopVoice() the playing line, whatever was left of it. Now
 * regular-table chatter arrives under the same cross-talk plan as story
 * scope (tails may overlap), and an arrival the plan would REPLACE
 * defers instead: it waits for the room to clear and starts then — or
 * drops when the wait would outlast its moment. The plan itself is
 * unchanged (pinned above); these tests pin the deferral arithmetic
 * and the engine wiring that applies it. Announcements never come
 * through here: playVoice's serial path is untouched (pinned above).
 */
describe('the no-cut deferral (regular tables)', () => {
  it('the wait for the room is the last live line’s end', () => {
    expect(voiceRoomWaitS([])).toBe(0);
    expect(voiceRoomWaitS([act('Pat', 2.5, 1)])).toBe(2.5);
    expect(voiceRoomWaitS([act('Pat', 0.5, 6), act('Uncle Ray', 2.75, 1)])).toBe(2.75);
  });

  it('the deferral bound is the tail bound: a line with more body than tail left is never outwaited', () => {
    expect(VOICE_DEFER_MAX_WAIT_S).toBe(VOICE_MAX_OVERLAP_REMAINING_S);
    expect(VOICE_DEFER_MAX_WAIT_S).toBeLessThanOrEqual(3);
  });

  it('a replace planned for deferrable chatter defers (short wait) or drops — the playing line is never stopped', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    // the defer branch sits exactly where the replace used to cut
    expect(audio).toContain('if (cross.defer && live.length) {');
    expect(audio).toContain('if (this.deferredVoice || waitS > VOICE_DEFER_MAX_WAIT_S) return false;');
    expect(audio).toContain('this.deferredVoice = { buf, gain, slice, seat, playerCount, speaker: cross.speaker, deadline: now + waitS };');
    // and the non-defer replace (story scope) still cuts, as designed
    expect(audio).toContain('this.stopVoice();\n      }\n      // \'play\': the room is empty');
  });

  it('the waiter takes the room when it clears, dies with stopVoice, and is dropped once stale', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    expect(audio).toContain('if (!this.voiceSlots.length) this.startDeferredVoice();');
    expect(audio).toContain('this.deferredVoice = null; // a waiting line never survives the room being cleared');
    expect(audio).toContain('if (!c || c.currentTime > dv.deadline + 0.25) return;');
  });

  it('playVoiceCrossTalk forwards the caller’s defer choice into the engine plan', () => {
    const audio = readFileSync(new URL('../src/audio.ts', import.meta.url), 'utf8');
    expect(audio).toContain('{ speaker, roll: Math.random(), defer: opts?.defer }');
    const voices = readFileSync(new URL('../src/voices/voices.ts', import.meta.url), 'utf8');
    expect(voices).toContain("{ defer: !!opts.deferCut }");
  });

  it('the AI-catalog rendition of a line takes the same no-cut arrival as the canned one', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('sound.playVoiceCrossTalk(b, gain, [0, b.duration], seatPos, n, l.name, { defer: true })');
  });
});
