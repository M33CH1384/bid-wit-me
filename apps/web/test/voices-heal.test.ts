/**
 * @vitest-environment happy-dom
 *
 * The voice layer's part of the 2026-10-22 intermittent-silence
 * recurrence. Two contracts, both broken on the live build:
 *
 * 1. A FAILED sprite load was cached for the rest of the session.
 *    Sprites are megabytes; a fetch+decode takes seconds on a phone,
 *    long enough for an iOS interruption to rebuild the AudioContext
 *    mid-decode. The decode rejects, the loader cached the failure,
 *    and that voice stayed silent until reload — while the engine's
 *    heal brought music and effects back, which is exactly the
 *    owner's "everything cuts, some of it comes back" shape. A failed
 *    load is now evicted (budgeted) and the next line retries
 *    against the live context.
 *
 * 2. playClip swallowed the engine's refusal. startVoice returns
 *    false when a line cannot sound (off a table surface, context
 *    not running, a deferral drop); playClip used to return true
 *    unconditionally, so callers paced and fell back as if the line
 *    had played — the meet-them Rundown mimed a 30-second reading
 *    in silence. The engine's word now flows out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  decode: vi.fn(),
  playVoice: vi.fn((): boolean => true),
  playVoiceCrossTalk: vi.fn((): boolean => true),
  ctx: { fakeCtx: true },
}));
vi.mock('../src/audio', () => ({
  sound: {
    audioContext: () => h.ctx,
    playVoice: h.playVoice,
    playVoiceCrossTalk: h.playVoiceCrossTalk,
  },
  decodeAudioBuffer: h.decode,
}));

import { playClip } from '../src/voices/voices';

const CLIP = 'line one';
let manifestFetches = 0;

function stubFetch() {
  manifestFetches = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const u = String(input);
    if (u.includes('.json')) { // the manifest (its URL carries the ?v= build token)
      manifestFetches++;
      return new Response(JSON.stringify({ clips: { [CLIP]: [0, 1000] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 });
  }));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  stubFetch();
  h.decode.mockReset();
  h.playVoice.mockClear();
  h.playVoiceCrossTalk.mockClear();
  h.playVoice.mockImplementation((): boolean => true);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('the sprite cache heal', () => {
  it('a decode that raced a context rebuild is retried on the next line, then cached for good', async () => {
    // First decode dies with the old context; every later decode succeeds.
    h.decode
      .mockRejectedValueOnce(new Error('decodeAudioData on a closed context'))
      .mockResolvedValue({ duration: 1 });
    await expect(playClip('og', 'Zed', CLIP, 1)).resolves.toBe(false);
    expect(h.playVoice).not.toHaveBeenCalled();
    await flush(); // the eviction lands when the failed load settles
    await expect(playClip('og', 'Zed', CLIP, 1)).resolves.toBe(true);
    expect(manifestFetches).toBe(2); // the dead entry was evicted and refetched
    expect(h.playVoice).toHaveBeenCalledTimes(1);
    await expect(playClip('og', 'Zed', CLIP, 1)).resolves.toBe(true);
    expect(manifestFetches).toBe(2); // a healthy sprite is never refetched
  });

  it('a manifest that failed to load is retried too, not mourned all session', async () => {
    h.decode.mockResolvedValue({ duration: 1 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    await expect(playClip('mama', 'Ada', CLIP, 1)).resolves.toBe(false);
    await flush();
    stubFetch();
    await expect(playClip('mama', 'Ada', CLIP, 1)).resolves.toBe(true);
  });
});

describe('playClip honesty', () => {
  it('an engine refusal resolves false; an engine start resolves true', async () => {
    h.decode.mockResolvedValue({ duration: 1 });
    h.playVoice.mockImplementation((): boolean => false); // the gate said no
    await expect(playClip('coach', 'Ivy', CLIP, 1)).resolves.toBe(false);
    h.playVoice.mockImplementation((): boolean => true);
    await expect(playClip('coach', 'Ivy', CLIP, 1)).resolves.toBe(true);
  });
});
