import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_CHARACTERS, STORY_VOICE_CAST, personaForName, storyCastForName } from '@spades/bots';

/**
 * One-timbre rule (Demetrius 2026-10-21, Barbershop report: "the characters
 * don't have a consistent voice — sometimes it's using the robotic voice").
 * On story surfaces a story character speaks ONLY their STORY_VOICE_CAST
 * recording — never a persona sprite (a second timbre; Ray's generic clips
 * are literally a different singer than his cast lines) and never the Web
 * Speech robot. A line with no cast recording is TEXT ONLY.
 *
 * This walks all 23 story characters through every call shape a line can
 * arrive in and asserts the resolution:
 *  - scene (ScriptPlayer):      speakBot(name, text, cardPersona)
 *  - story session / rail:      speakBot(name, text)            (no persona)
 *  - cast-persona callers:      speakBot(name, text, castPersona)
 *  - generic table talk (sink): speakBot(name, text, persona, catalogLineId)
 *  - collection banter:         speakBot(name, text, persona, catalogLineId, bid)
 * and pins that normal games / normal bots are untouched.
 */
const TALK_ID = 'talk.template.id';
const TALK_TEMPLATE = 'a generic persona template line';
const STORY_LINE = 'A scripted story line, keyed by its own text.';

const clip = vi.hoisted(() => ({ played: false, calls: [] as unknown[][] }));
vi.mock('../src/voices/voices', () => ({
  playClip: (...args: unknown[]) => { clip.calls.push(args); return Promise.resolve(clip.played); },
  rawLine: (id?: string) => (id === TALK_ID ? TALK_TEMPLATE : undefined),
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
const reset = () => { clip.played = false; clip.calls = []; speech.speak.mockClear(); speech.cancel.mockClear(); };

beforeEach(reset);
afterEach(() => { vi.unstubAllGlobals(); });

const CAST = Object.values(STORY_CHARACTERS).map((c) => ({ id: c.id, name: c.name, cast: STORY_VOICE_CAST[c.id]! }));

describe('story voice consistency: cast recording or text, never a second voice', () => {
  it('the walk really covers all 23 story characters, pinned to their card personas', () => {
    expect(CAST.length).toBe(23);
    for (const { name, cast } of CAST) {
      expect(storyCastForName(name), name).toBeTruthy();
      expect(personaForName(name), name).toBe(cast.cardPersona);
    }
  });

  it('in story scope, every character’s story lines resolve through the cast path (scene / session / cast-persona shapes)', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    for (const { name, cast } of CAST) {
      for (const persona of [cast.cardPersona, undefined, cast.persona] as const) {
        reset();
        speakBot(name, STORY_LINE, persona);
        await flush();
        // exactly one clip attempt, keyed by the line's own text (the cast
        // sprite lookup) — and with the clip missing, silence: no robot.
        expect(clip.calls.length, `${name} via ${persona ?? 'default'}`).toBe(1);
        expect(clip.calls[0]![2], name).toBe(STORY_LINE);
        expect(speech.speak, name).not.toHaveBeenCalled();
        expect(speech.cancel, name).not.toHaveBeenCalled();
      }
    }
    setStoryVoiceScope(false);
  });

  it('in story scope, generic table talk and banter resolve ONLY through the cast sprite — a cast take of the template, or text', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    for (const mode of ['miss', 'hit'] as const) {
      for (const { name, cast } of CAST) {
        for (const persona of [cast.cardPersona, cast.persona] as const) {
          reset();
          clip.played = mode === 'hit'; // a cast take of the template exists (hit) or not (miss)
          speakBot(name, 'generic display text', persona, TALK_ID); // talk sink shape
          speakBot(name, 'generic display text', persona, TALK_ID, 4); // banter shape (with bid)
          await flush();
          // Exactly one attempt per line, always via the CAST persona
          // (keyFor → the cast sprite), keyed by the line's raw template —
          // never the caller's persona route, never the AI catalog, never
          // the robot. On a miss that attempt is the whole story: text
          // only. On a hit the clip that plays is that cast-route one.
          expect(clip.calls.length, `${name} via ${persona} (${mode})`).toBe(2);
          expect(clip.calls[0]![0], name).toBe(cast.persona);
          expect(clip.calls[0]![2], name).toBe(TALK_TEMPLATE);
          expect(clip.calls[1]![0], name).toBe(cast.persona);
          expect(clip.calls[1]![2], name).toBe(TALK_TEMPLATE);
          expect(clip.calls[1]![4], name).toBe(4); // the bid still picks its numbered take in the cast sprite
          expect(speech.speak, name).not.toHaveBeenCalled();
          expect(speech.cancel, name).not.toHaveBeenCalled();
        }
      }
    }
    setStoryVoiceScope(false);
  });

  it('the robot is refused by identity: off-scope and off-table, a story character with no clip still never reaches speech', async () => {
    const { speakBot, setStoryVoiceScope, storyVoiceScope } = await load();
    setStoryVoiceScope(false);
    expect(storyVoiceScope()).toBe(false);
    for (const { name, cast } of CAST) {
      reset();
      speakBot(name, STORY_LINE, cast.cardPersona);
      await flush();
      expect(clip.calls.length, name).toBe(1); // the cast recording was tried
      expect(speech.speak, name).not.toHaveBeenCalled(); // and the fallback refused the character
    }
  });

  it('normal games are untouched: out of story scope, a story-named bot’s catalog talk still resolves its clip as before', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(false);
    for (const { name, cast } of CAST) {
      reset();
      speakBot(name, 'generic display text', cast.cardPersona, TALK_ID);
      await flush();
      expect(clip.calls.length, name).toBe(1);
      expect(clip.calls[0]![2], name).toBe(TALK_TEMPLATE);
    }
  });

  it('story scope does not gag normal bots: their talk still resolves clips while scope is on', async () => {
    const { speakBot, setStoryVoiceScope } = await load();
    setStoryVoiceScope(true);
    speakBot('Big Mike', 'generic display text', 'hothead', TALK_ID);
    await flush();
    expect(clip.calls.length).toBe(1);
    expect(clip.calls[0]![2]).toBe(TALK_TEMPLATE);
    setStoryVoiceScope(false);
  });

  it('wiring: scenes and story tables raise the scope; story tables never take the AI catalog voice', () => {
    const scene = readFileSync(new URL('../src/story/ScriptPlayer.tsx', import.meta.url), 'utf8');
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const talk = readFileSync(new URL('../src/talkPrefs.ts', import.meta.url), 'utf8');
    expect(scene).toContain('setStoryVoiceScope(true)');
    expect(table).toContain('setStoryVoiceScope(true)');
    expect(table).toContain('aiVoices: tp.aiVoices && !muted && !story?.scene');
    expect(talk).toContain('if (cast && storyScope && line) {');
    expect(talk).toContain('playClip(cast.persona, name, raw,');
    expect(talk).toContain('castGate');
  });
});
