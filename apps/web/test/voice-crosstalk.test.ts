import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_CHARACTERS, STORY_VOICE_CAST } from '@spades/bots';
import { VOICE_DUCK_FACTOR, VOICE_MAX_OVERLAP_REMAINING_S, VOICE_TAIL_S, planVoiceArrival, type ActiveVoiceInfo } from '../src/audio';

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
 * and the engine's duck/restore application. Source selection keeps the
 * story fence (cast recording or text only): in scope, catalog lines
 * attempt the cast route only — see the fence pins below.
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

/* ---------- speakBot wiring: the opt-in is the story surface, nothing else ---------- */

const clip = vi.hoisted(() => ({ played: true, calls: [] as unknown[][] }));
vi.mock('../src/voices/voices', () => ({
  playClip: (...args: unknown[]) => { clip.calls.push(args); return Promise.resolve(clip.played); },
  rawLine: (id?: string) => (id === 'talk.template.id' ? 'a generic persona template line' : undefined),
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
  it('on a story surface, a conversational cast line opts in', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    speakBot('Uncle Ray', 'A scripted story line, keyed by its own text.', 'storyteller');
    await flush();
    expect(clip.calls.length).toBe(1);
    expect(clip.calls[0]![7]).toEqual({ crossTalk: true });
    setStoryVoiceScope(false);
  });

  it('end-of-hand banter is chatter: a bid value only picks its numbered take and does not gate cross-talk', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    speakBot('Pat', 'You bid 7 for THAT?!', 'storyteller', undefined, 7);
    await flush();
    expect(clip.calls.length).toBe(1);
    expect(clip.calls[0]![4]).toBe(7); // the bid still reaches the take lookup, untouched
    expect(clip.calls[0]![7]).toEqual({ crossTalk: true });
    setStoryVoiceScope(false);
  });

  it('off story surfaces nothing opts in — regular tables keep the serial channel', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(false);
    speakBot('Uncle Ray', 'A scripted story line, keyed by its own text.', 'storyteller');
    speakBot('Big Mike', 'generic display text', 'hothead');
    await flush();
    expect(clip.calls.length).toBe(2);
    expect(clip.calls[0]![7]).toEqual({ crossTalk: false });
    expect(clip.calls[1]![7]).toEqual({ crossTalk: false });
  });

  it('the fence, resolved: catalog talk for a cast member in scope attempts the cast route only — never the persona path, never the robot', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    for (const played of [true, false]) { // a cast take of the template exists (hit) or not (miss)
      clip.played = played; clip.calls = []; speech.speak.mockClear();
      speakBot('Uncle Ray', 'generic display text', 'comedian', 'talk.template.id', 4);
      await flush();
      expect(clip.calls.length).toBe(1); // exactly one attempt, hit or miss
      expect(clip.calls[0]![0]).toBe('storyteller'); // the CAST persona — not the caller's 'comedian' route
      expect(clip.calls[0]![2]).toBe('a generic persona template line');
      expect(clip.calls[0]![4]).toBe(4); // the bid-take key form still applies inside the cast sprite
      expect(clip.calls[0]![7]).toEqual({ crossTalk: true }); // the cross-talk opt-in is preserved on this path
      expect(speech.speak).not.toHaveBeenCalled(); // a miss is text only — the robot is never the consolation
    }
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
 * that scope and resolve through the same cast-only route as all catalog
 * talk (a cast take of the template, or text); the recap and
 * versus surfaces contain no speech calls at all. These pins hold that
 * shut alongside story-voice-consistency.test.ts (which sweeps the
 * scene/session/talk shapes).
 */
describe('the fence through the end-of-hand window', () => {
  it('collection banter shape, all 23 cast, in scope: cast-route attempt or text — no persona, no catalog, no robot', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    for (const played of [false, true]) { // no cast take of the template (miss) / the cast take exists (hit)
      for (const c of Object.values(STORY_CHARACTERS)) {
        const cast = STORY_VOICE_CAST[c.id]!;
        clip.played = played; clip.calls = []; speech.speak.mockClear(); speech.cancel.mockClear();
        // the exact Table collection-banter call shape (name, text, persona, line id, bid, seat, count)
        speakBot(c.name, 'generic banter display text', cast.cardPersona, 'talk.template.id', 4, 'top', 4);
        await flush();
        // exactly one attempt, via the character's CAST persona (keyFor →
        // the cast sprite), keyed by the line's template with its bid —
        // and nothing else, in either mode: a miss stays text, a hit is
        // that cast-route clip, the robot never fires.
        expect(clip.calls.length, c.name).toBe(1);
        expect(clip.calls[0]![0], c.name).toBe(cast.persona);
        expect(clip.calls[0]![2], c.name).toBe('a generic persona template line');
        expect(clip.calls[0]![4], c.name).toBe(4);
        expect(speech.speak, c.name).not.toHaveBeenCalled();
        expect(speech.cancel, c.name).not.toHaveBeenCalled();
      }
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
