/**
 * @vitest-environment happy-dom
 *
 * The memory half of the 2026-10-23 story-mode crash recurrence
 * ("randomly crashing… taking me back to solo / co-op", mid-hand, at
 * bid/play moments, story mode only). Two contracts:
 *
 * 1. DECODE AT THE NATIVE RATE. The sprite masters are 24 kHz, but the
 *    loader decoded them on the engine's 44.1/48 kHz context — every
 *    buffer silently doubled (Dee's lilcuz-f sprite: 4,400 s of audio =
 *    ≈845 MB of Float32 PCM at 48 kHz for zero extra fidelity). Sprites
 *    now decode on an OfflineAudioContext at VOICE_DECODE_RATE; where
 *    that does not exist, the engine context is used exactly as before.
 *
 * 2. A RESIDENCY CAP. A decoded sprite used to be resident forever, so
 *    every cast and railbird voice of every stop a player visited piled
 *    up until iOS killed the web process — the relaunch is a FRESH
 *    session, which is why the crash lands on the Solo/Co-op gate (the
 *    stored gate answer lives in sessionStorage; StoryHome has no
 *    in-page path back to the gate once answered). Decoded voice PCM is
 *    now capped at VOICE_RESIDENCY_BUDGET_BYTES with LRU eviction; an
 *    evicted voice refetches (HTTP-cached) and re-decodes on its next
 *    line, and a line already playing is never cut by an eviction.
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

import {
  VOICE_DECODE_RATE,
  VOICE_RESIDENCY_BUDGET_BYTES,
  playClip,
  residentVoiceBytes,
  residentVoiceKeys,
} from '../src/voices/voices';

const CLIP = 'line one';
/** Frames per fake sprite: 100M frames × 1 channel × 4 bytes = 400 MB. */
const FRAMES = 100_000_000;
const SPRITE_BYTES = FRAMES * 4;

const manifestFetches = new Map<string, number>();

function stubFetch() {
  manifestFetches.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const u = String(input);
    const key = u.match(/v2\/([a-z]+-[fm])\./)?.[1] ?? 'unknown';
    if (u.includes('.json')) {
      manifestFetches.set(key, (manifestFetches.get(key) ?? 0) + 1);
      return new Response(JSON.stringify({ clips: { [CLIP]: [0, 1000] } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(new Uint8Array([7]).buffer as ArrayBuffer, { status: 200 });
  }));
}

function fakeBuffer() {
  return { duration: FRAMES / VOICE_DECODE_RATE, length: FRAMES, numberOfChannels: 1, sampleRate: VOICE_DECODE_RATE };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  stubFetch();
  h.decode.mockReset();
  h.decode.mockImplementation(async () => fakeBuffer());
  h.playVoice.mockClear();
  h.playVoiceCrossTalk.mockClear();
  h.playVoice.mockImplementation((): boolean => true);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('sprite decode rate', () => {
  it('decodes on an OfflineAudioContext at the 24 kHz master rate, not the engine context', async () => {
    const rates: number[] = [];
    class FakeOffline {
      sampleRate: number;
      constructor(_channels: number, _length: number, sampleRate: number) {
        this.sampleRate = sampleRate;
        rates.push(sampleRate);
      }
    }
    vi.stubGlobal('OfflineAudioContext', FakeOffline);
    await expect(playClip('barber', 'Cole', CLIP, 1)).resolves.toBe(true);
    expect(rates).toEqual([VOICE_DECODE_RATE]);
    expect(VOICE_DECODE_RATE).toBe(24000); // the masters' rate (voice index sampleRate)
    const decodeCtx = h.decode.mock.calls[0]?.[0] as unknown;
    expect(decodeCtx).toBeInstanceOf(FakeOffline);
    expect(decodeCtx).not.toBe(h.ctx);
  });

  it('falls back to the engine context where OfflineAudioContext does not exist', async () => {
    vi.stubGlobal('OfflineAudioContext', undefined);
    await expect(playClip('professor', 'Noor', CLIP, 1)).resolves.toBe(true);
    expect(h.decode.mock.calls[0]?.[0]).toBe(h.ctx);
  });
});

describe('decoded-sprite residency', () => {
  it('caps decoded voice PCM at the budget, evicting least-recently-used sprites', async () => {
    // Three 400 MB sprites against a 1 GiB budget: the third decode
    // must evict the first (LRU), never the one that just landed.
    await playClip('deacon', 'Ford', CLIP, 1);
    await playClip('smooth', 'Vic', CLIP, 1);
    expect(residentVoiceBytes()).toBe(2 * SPRITE_BYTES);
    await playClip('petty', 'Rae', CLIP, 1);
    expect(residentVoiceBytes()).toBe(2 * SPRITE_BYTES);
    expect(residentVoiceBytes()).toBeLessThanOrEqual(VOICE_RESIDENCY_BUDGET_BYTES);
    const keys = residentVoiceKeys();
    expect(keys).toHaveLength(2);
    expect(keys.some((k) => k.startsWith('deacon-'))).toBe(false); // evicted
    expect(keys.some((k) => k.startsWith('smooth-'))).toBe(true);
    expect(keys.some((k) => k.startsWith('petty-'))).toBe(true);
  });

  it('an evicted voice refetches and re-decodes on its next line', async () => {
    await playClip('gambler', 'Ace', CLIP, 1);
    await playClip('hustler', 'Flo', CLIP, 1);
    await playClip('comedian', 'Gus', CLIP, 1); // evicts the gambler sprite
    const gamblerKey = [...manifestFetches.keys()].find((k) => k.startsWith('gambler-'))!;
    expect(manifestFetches.get(gamblerKey)).toBe(1);
    await flush();
    await expect(playClip('gambler', 'Ace', CLIP, 1)).resolves.toBe(true);
    expect(manifestFetches.get(gamblerKey)).toBe(2); // refetched after eviction
    expect(residentVoiceKeys().some((k) => k.startsWith('gambler-'))).toBe(true);
  });

  it('playing a resident voice makes it most-recently-used, so the OTHER sprite is evicted', async () => {
    await playClip('conspiracy', 'Mel', CLIP, 1);
    await playClip('sorelose', 'Dot', CLIP, 1);
    await playClip('conspiracy', 'Mel', CLIP, 1); // touch: conspiracy is now MRU, no refetch
    const conspiracyKey = [...manifestFetches.keys()].find((k) => k.startsWith('conspiracy-'))!;
    expect(manifestFetches.get(conspiracyKey)).toBe(1);
    await playClip('hothead', 'Sal', CLIP, 1); // forces an eviction: sorelose (LRU) goes
    const keys = residentVoiceKeys();
    expect(keys.some((k) => k.startsWith('conspiracy-'))).toBe(true);
    expect(keys.some((k) => k.startsWith('sorelose-'))).toBe(false);
    expect(keys.some((k) => k.startsWith('hothead-'))).toBe(true);
  });
});
