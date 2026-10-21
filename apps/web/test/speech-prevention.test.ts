import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Prevention (Demetrius 2026-10-21): while a live table or a story scene is on
 * screen the game never touches the speech engine — an iOS utterance seizes the
 * audio session and leaves the game's AudioContext interrupted, stuttering the
 * music and beds. These tests drive the real speakBot with the clip layer
 * mocked, and a spy speechSynthesis, and pin the contract:
 *  - a line WITH a clip still plays it (the fence never touches playClip);
 *  - a line WITHOUT a clip is text-only at the table (no speak, no cancel);
 *  - the fence is presence-keyed (it releases off the table), and the standing
 *    "never talk behind Home" rule still keeps speech silent there.
 */
const clip = vi.hoisted(() => ({ played: false, calls: [] as unknown[][] }));
vi.mock('../src/voices/voices', () => ({
  playClip: (...args: unknown[]) => { clip.calls.push(args); return Promise.resolve(clip.played); },
  rawLine: (_id?: string) => undefined,
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
  const talk = await import('../src/talkPrefs');
  const { sound } = await import('../src/audio');
  return { ...talk, sound };
}

const flush = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

beforeEach(() => { clip.played = false; clip.calls = []; speech.speak.mockClear(); speech.cancel.mockClear(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('speech prevention: the fallback never touches the engine during live play', () => {
  it('at a live table, a line with no recorded clip is text-only — no speak, no cancel', async () => {
    const { speakBot, speechFallbackFenced, sound } = await load();
    sound.enterTable();
    expect(speechFallbackFenced()).toBe(true);
    speakBot('Uncle Ray', 'An unrecorded porch line, told as text.', 'storyteller');
    await flush();
    expect(clip.calls.length).toBe(1); // the recorded path was tried first
    expect(speech.speak).not.toHaveBeenCalled();
    expect(speech.cancel).not.toHaveBeenCalled();
    sound.leaveTable();
    // leaving the table issues no idle cancel either (nothing is ever speaking)
    expect(speech.cancel).not.toHaveBeenCalled();
  });

  it('a recorded clip still plays at the table — the fence only blocks the speech fallback', async () => {
    clip.played = true;
    const { speakBot, sound } = await load();
    sound.enterTable();
    speakBot('Uncle Ray', 'A recorded porch line.', 'storyteller');
    await flush();
    expect(clip.calls.length).toBe(1);
    expect(speech.speak).not.toHaveBeenCalled();
    expect(speech.cancel).not.toHaveBeenCalled();
    sound.leaveTable();
  });

  it('the fence releases off the table, and speech still never fires behind Home', async () => {
    const { speakBot, speechFallbackFenced, sound } = await load();
    expect(sound.atTable).toBe(false);
    expect(speechFallbackFenced()).toBe(false); // presence-keyed, not a global kill switch
    speakBot('Uncle Ray', 'An unrecorded line off the table.', 'storyteller');
    await flush();
    expect(clip.calls.length).toBe(1);
    expect(speech.speak).not.toHaveBeenCalled(); // standing rule: never talk behind Home
    expect(speech.cancel).not.toHaveBeenCalled();
  });
});
