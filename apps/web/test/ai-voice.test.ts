import { describe, expect, it, vi } from 'vitest';
import { AI_CLIP_TIMEOUT_MS, deliverBotLine } from '../src/voices/aiVoice';

const line = { text: 'canned text', ai: { id: 'abc123', text: 'catalog text' } };
const on = { aiVoices: true, voices: true, soundOn: true, gain: 0.5 };
const buf = {} as AudioBuffer;
function run(l: typeof line | { text: string }, g = on, load = async () => buf, play = () => true) {
  const shown: string[] = []; const canned = vi.fn();
  return deliverBotLine(l, g, (t) => shown.push(t), canned, load, play).then((how) => ({ how, shown, canned: canned.mock.calls.length }));
}

describe('AI voice line delivery (text and audio always match)', () => {
  it('clip plays: catalog text, no canned audio', async () => {
    expect(await run(line)).toEqual({ how: 'ai', shown: ['catalog text'], canned: 0 });
  });
  it('player toggle off: canned text + canned audio, and no fetch', async () => {
    const load = vi.fn(async () => buf);
    expect(await run(line, { ...on, aiVoices: false }, load)).toEqual({ how: 'canned', shown: ['canned text'], canned: 1 });
    expect(load).not.toHaveBeenCalled();
  });
  it('voices or sound off: canned', async () => {
    expect((await run(line, { ...on, voices: false })).how).toBe('canned');
    expect((await run(line, { ...on, soundOn: false })).how).toBe('canned');
  });
  it('missing clip or playback refused: canned', async () => {
    expect(await run(line, on, async () => null)).toEqual({ how: 'canned', shown: ['canned text'], canned: 1 });
    expect((await run(line, on, async () => buf, () => false)).how).toBe('canned');
  });
  it('no catalog line: canned, exactly as today', async () => {
    expect(await run({ text: 'canned text' })).toEqual({ how: 'canned', shown: ['canned text'], canned: 1 });
  });
  it('a slow clip gives up after the timeout and falls back', async () => {
    vi.useFakeTimers();
    const p = run(line, on, () => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(AI_CLIP_TIMEOUT_MS + 1);
    expect(await p).toEqual({ how: 'canned', shown: ['canned text'], canned: 1 });
    vi.useRealTimers();
  });
});
