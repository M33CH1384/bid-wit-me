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
 *
 * 3. TABLE-CHANGE EVICTION + A DERIVED BUDGET (crash-2 lane, 2026-11-01 —
 *    the owner was STILL crashing to the menu after the cap shipped,
 *    because the cap alone let up to its full value of past casts linger
 *    across tables). The budget is now 896 MiB, derived from the shipped
 *    manifests: Dee's lilcuz-f sprite alone is 402.8 MiB (a 256 MiB cap
 *    is impossible), the largest story seated set (High-Rise: Dee +
 *    Velvet + the Accountant) is 728.8 MiB, the largest regular seated
 *    set is 770.8 MiB — 896 MiB is that ceiling plus ~one median sprite
 *    of headroom. And at every table change the incoming cast becomes
 *    the seated set (setSeatedVoiceKeys): every non-seated sprite is
 *    evicted on the spot, and seated sprites are exempt from budget
 *    eviction while they hold their seats — a seated bot's line never
 *    waits on a re-decode of its own sprite.
 *
 * 4. PER-CLIP DECODE (2026-11-02, crash round 3's residency audit: even
 *    the derived budget leaves a typical table holding ~345 MiB of
 *    decoded voice — the structural half of the jetsam stack). The
 *    per-clip layer never decodes a whole sprite into residency: it
 *    holds the manifest + the sprite's COMPRESSED bytes (capped at
 *    VOICE_ENCODED_BUDGET_BYTES = 96 MiB) and decodes individual lines
 *    just ahead of playback into a clip cache hard-capped at
 *    VOICE_CLIP_CACHE_BUDGET_BYTES = 48 MiB. It ships behind the
 *    'bwm.voicePerClip' flag (default on) with the whole-sprite layer
 *    above intact: the legacy describes below run with the flag OFF and
 *    pin the old contracts unchanged; the per-clip describe runs with
 *    it ON and pins the new ceilings — the cap holding while every cast
 *    member talks, window slicing on a single decode, table-change
 *    frees, and manifest-only durations. (The encoded-bytes ceiling is
 *    pinned by its constant + residency counts; exercising its LRU
 *    would need ~100 MB of stub audio in the test process, so the
 *    eviction-shape proof rides on the clip cache, which shares it.)
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
  VOICE_CLIP_CACHE_BUDGET_BYTES,
  VOICE_DECODE_RATE,
  VOICE_ENCODED_BUDGET_BYTES,
  VOICE_RESIDENCY_BUDGET_BYTES,
  clipDurationMs,
  playClip,
  preloadVoice,
  residentClipBytes,
  residentClipIds,
  residentEncodedBytes,
  residentVoiceBytes,
  residentVoiceKeys,
  setSeatedVoiceKeys,
  voiceResidencySnapshot,
  warmClip,
} from '../src/voices/voices';

const CLIP = 'line one';
/** Frames per fake sprite: 100M frames × 1 channel × 4 bytes = 400 MB. */
const FRAMES = 100_000_000;
const SPRITE_BYTES = FRAMES * 4;

/** The per-clip manifest every stubbed sprite serves: 30 clips of
 *  20 s each laid back-to-back in a 600 s sprite. 'line one' is first;
 *  'clip k' sits at manifest index k. */
const PC_CLIP_MS = 20_000;
const PC_CLIP_BYTES = (PC_CLIP_MS / 1000) * VOICE_DECODE_RATE * 4; // 1,920,000
function pcManifestJson(): string {
  const clips: Record<string, [number, number]> = { [CLIP]: [0, PC_CLIP_MS] };
  for (let k = 1; k < 30; k++) clips[`clip ${k}`] = [k * PC_CLIP_MS, PC_CLIP_MS];
  return JSON.stringify({ clips });
}

const manifestFetches = new Map<string, number>();
const audioFetches = new Map<string, number>();
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

function stubFetch() {
  manifestFetches.clear();
  audioFetches.clear();
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const u = String(input);
    const key = u.match(/v2\/([a-z]+-[fm])\./)?.[1] ?? 'unknown';
    if (u.includes('.json')) {
      bump(manifestFetches, key);
      return new Response(pcManifestJson(), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    bump(audioFetches, key);
    return new Response(new Uint8Array([7]).buffer as ArrayBuffer, { status: 200 });
  }));
}

function fakeBuffer() {
  return { duration: FRAMES / VOICE_DECODE_RATE, length: FRAMES, numberOfChannels: 1, sampleRate: VOICE_DECODE_RATE };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  stubFetch();
  h.decode.mockReset();
  h.decode.mockImplementation(async () => fakeBuffer());
  h.playVoice.mockClear();
  h.playVoiceCrossTalk.mockClear();
  h.playVoice.mockImplementation((): boolean => true);
  // A clean table between tests: both layers drop every non-seated
  // sprite (with nobody seated, that is everything), and any pass
  // still chained from a previous test drains before we start.
  setSeatedVoiceKeys([]);
  await flush(); await flush();
});
afterEach(() => { vi.unstubAllGlobals(); localStorage.removeItem('bwm.voicePerClip'); });

describe('sprite decode rate', () => {
  beforeEach(() => { localStorage.setItem('bwm.voicePerClip', '0'); });

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

describe('decoded-sprite residency (legacy layer, flag off)', () => {
  beforeEach(() => { localStorage.setItem('bwm.voicePerClip', '0'); });

  it('caps decoded voice PCM at the budget, evicting least-recently-used sprites', async () => {
    // Three 400 MB sprites against the 896 MiB budget: two fit (800 MB),
    // the third decode must evict the first (LRU), never the one that
    // just landed.
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

describe('the derived budget', () => {
  it('is 896 MiB: above the largest seated set (770.8 MiB measured), below the old 1 GiB', () => {
    expect(VOICE_RESIDENCY_BUDGET_BYTES).toBe(896 * 1024 * 1024);
    expect(VOICE_RESIDENCY_BUDGET_BYTES).toBeGreaterThan(770.8 * 1024 * 1024);
    expect(VOICE_RESIDENCY_BUDGET_BYTES).toBeLessThan(1024 * 1024 * 1024);
  });

  it('the per-clip ceilings are 48 MiB decoded clips + 96 MiB compressed bytes', () => {
    expect(VOICE_CLIP_CACHE_BUDGET_BYTES).toBe(48 * 1024 * 1024);
    expect(VOICE_ENCODED_BUDGET_BYTES).toBe(96 * 1024 * 1024);
    // The whole per-clip worst case is a rounding error next to the
    // legacy budget it replaces.
    expect(VOICE_CLIP_CACHE_BUDGET_BYTES + VOICE_ENCODED_BUDGET_BYTES)
      .toBeLessThan(VOICE_RESIDENCY_BUDGET_BYTES / 6);
  });
});

describe('table-change eviction (the seated set, legacy layer)', () => {
  beforeEach(() => { localStorage.setItem('bwm.voicePerClip', '0'); });
  afterEach(() => { setSeatedVoiceKeys([]); });

  const keyOf = (prefix: string) => residentVoiceKeys().find((k) => k.startsWith(prefix))!;

  it('evicts every non-seated sprite when the cast changes; the seated cast stays', async () => {
    await playClip('og', 'Unc', CLIP, 1);
    await playClip('mama', 'Queenie', CLIP, 1);
    const ogKey = keyOf('og-');
    const mamaKey = keyOf('mama-');
    expect(residentVoiceBytes()).toBe(2 * SPRITE_BYTES);
    // A new table seats only Queenie's sprite: Unc's is evicted on the spot.
    setSeatedVoiceKeys([mamaKey]);
    expect(residentVoiceKeys()).toEqual([mamaKey]);
    expect(residentVoiceBytes()).toBe(SPRITE_BYTES);
    // The evicted voice refetches and re-decodes on its next line.
    const before = manifestFetches.get(ogKey) ?? 0;
    await expect(playClip('og', 'Unc', CLIP, 1)).resolves.toBe(true);
    expect(manifestFetches.get(ogKey)).toBe(before + 1);
    expect(residentVoiceKeys()).toContain(ogKey);
  });

  it('seated sprites are exempt from budget eviction; the non-seated tail takes the cut', async () => {
    await playClip('og', 'Unc', CLIP, 1);
    await playClip('mama', 'Queenie', CLIP, 1);
    const ogKey = keyOf('og-');
    const mamaKey = keyOf('mama-');
    setSeatedVoiceKeys([ogKey, mamaKey]); // both hold seats now
    await playClip('coach', 'Mae', CLIP, 1); // a non-seated voice loads (over budget: nobody movable but itself)
    expect(residentVoiceKeys()).toContain(ogKey);
    expect(residentVoiceKeys()).toContain(mamaKey);
    const coachKey = keyOf('coach-');
    expect(residentVoiceKeys()).toContain(coachKey);
    await playClip('influencer', 'Zee', CLIP, 1); // pressure again: the non-seated coach sprite is the one that goes
    expect(residentVoiceKeys()).toContain(ogKey);
    expect(residentVoiceKeys()).toContain(mamaKey);
    expect(residentVoiceKeys()).not.toContain(coachKey);
  });

  it('a load in flight across a table change plays for its caller but is not retained', async () => {
    let release: ((b: unknown) => void) | null = null;
    h.decode.mockImplementationOnce(() => new Promise((res) => { release = res; }));
    const p = playClip('storyteller', 'Gramps', CLIP, 1);
    await flush(); await flush(); // fetches landed; the decode is the hanging one
    expect(release).not.toBeNull();
    setSeatedVoiceKeys([]); // the table changed while Gramps was still decoding
    release!(fakeBuffer());
    await expect(p).resolves.toBe(true); // the waiting line still plays
    const stKey = [...manifestFetches.keys()].find((k) => k.startsWith('storyteller-'))!;
    expect(residentVoiceKeys()).not.toContain(stKey); // …but nothing was retained
    await expect(playClip('storyteller', 'Gramps', CLIP, 1)).resolves.toBe(true);
    expect(manifestFetches.get(stKey)).toBe(2); // a fresh load, retained this time
    expect(residentVoiceKeys()).toContain(stKey);
  });
});

/* ---------------------------------------------------------------------
 * The per-clip layer (flag on — the shipped default).
 * Slicable fakes: the decoded sprite is a real-shaped buffer (600 s of
 * channel data) and slice buffers come from a FakeOffline with a real
 * createBuffer, so production slicing runs end to end.
 * ------------------------------------------------------------------- */
const PC_SPRITE_SECONDS = 600;
const PC_PCM = new Float32Array(PC_SPRITE_SECONDS * VOICE_DECODE_RATE);
function slicableBuffer() {
  return {
    duration: PC_SPRITE_SECONDS,
    length: PC_SPRITE_SECONDS * VOICE_DECODE_RATE,
    numberOfChannels: 1,
    sampleRate: VOICE_DECODE_RATE,
    getChannelData: () => PC_PCM,
  };
}
class FakeOfflinePc {
  sampleRate: number;
  constructor(_channels: number, _length: number, sampleRate: number) { this.sampleRate = sampleRate; }
  createBuffer(_channels: number, len: number, rate: number) {
    return {
      length: len, sampleRate: rate, numberOfChannels: 1, duration: len / rate,
      copyToChannel: () => { /* the slice lands */ },
      getChannelData: () => new Float32Array(len),
    };
  }
}
const pcKeyOf = (prefix: string) => [...manifestFetches.keys()].find((k) => k.startsWith(prefix))!;
const pcClipIdOf = (prefix: string, clipKey: string) => `${pcKeyOf(prefix)}\n${clipKey}`;

describe('per-clip decode layer (flag on)', () => {
  beforeEach(() => {
    localStorage.removeItem('bwm.voicePerClip'); // the default: per-clip on
    vi.stubGlobal('OfflineAudioContext', FakeOfflinePc);
    h.decode.mockReset();
    h.decode.mockImplementation(async () => slicableBuffer());
  });

  it('decodes at the native 24 kHz rate on the offline context, like the legacy layer', async () => {
    await expect(playClip('barber', 'Cole', CLIP, 1)).resolves.toBe(true);
    const decodeCtx = h.decode.mock.calls[0]?.[0] as unknown;
    expect(decodeCtx).toBeInstanceOf(FakeOfflinePc);
    expect((decodeCtx as FakeOfflinePc).sampleRate).toBe(VOICE_DECODE_RATE);
  });

  it('clipDurationMs answers from the manifest alone — no audio fetch, no decode', async () => {
    await expect(clipDurationMs('og', 'Unc', CLIP)).resolves.toBe(PC_CLIP_MS);
    const ogKey = pcKeyOf('og-');
    expect(manifestFetches.get(ogKey)).toBe(1);
    expect(audioFetches.get(ogKey) ?? 0).toBe(0);
    expect(h.decode).not.toHaveBeenCalled();
    expect(residentClipBytes()).toBe(0);
  });

  it('a play decodes the sprite ONCE and slices the wanted clip plus its manifest window', async () => {
    await expect(playClip('og', 'Unc', CLIP, 1)).resolves.toBe(true);
    expect(h.decode).toHaveBeenCalledTimes(1);
    // The engine receives the SLICED clip: a [0, duration] play, not a
    // sprite-offset play.
    expect(h.playVoice).toHaveBeenCalledTimes(1);
    expect(h.playVoice.mock.calls[0]?.[2]).toEqual([0, PC_CLIP_MS / 1000]);
    // Window: 'line one' is manifest index 0 → indices 0..10 are held.
    const ids = residentClipIds();
    expect(ids).toHaveLength(11);
    expect(ids).toContain(pcClipIdOf('og-', CLIP));
    expect(ids).toContain(pcClipIdOf('og-', 'clip 10'));
    expect(ids).not.toContain(pcClipIdOf('og-', 'clip 11'));
    expect(residentClipBytes()).toBe(11 * PC_CLIP_BYTES);
    // The whole sprite was never resident: legacy accounting untouched.
    expect(residentVoiceBytes()).toBe(0);
  });

  it('a second line from the warmed window is a pure cache hit — no fetch, no decode', async () => {
    await playClip('og', 'Unc', CLIP, 1);
    const ogKey = pcKeyOf('og-');
    await expect(playClip('og', 'Unc', 'clip 5', 1)).resolves.toBe(true);
    expect(h.decode).toHaveBeenCalledTimes(1);
    expect(manifestFetches.get(ogKey)).toBe(1);
    expect(audioFetches.get(ogKey)).toBe(1);
    expect(voiceResidencySnapshot().clipHits).toBeGreaterThanOrEqual(1);
  });

  it('the clip ceiling holds while a whole table talks, evicting LRU clips only', async () => {
    await playClip('og', 'Unc', CLIP, 1); // window 0..10 resident (11 clips)
    await playClip('og', 'Unc', 'clip 29', 1); // window 19..29 joins (22 clips)
    expect(residentClipBytes()).toBe(22 * PC_CLIP_BYTES);
    await playClip('og', 'Unc', 'clip 15', 1); // window 5..25 overflows the cap
    expect(residentClipBytes()).toBeLessThanOrEqual(VOICE_CLIP_CACHE_BUDGET_BYTES);
    const ids = residentClipIds();
    expect(ids).toContain(pcClipIdOf('og-', 'clip 15')); // the just-played line survives
    expect(ids).toContain(pcClipIdOf('og-', 'clip 29')); // recently played survives
    expect(ids).toContain(pcClipIdOf('og-', CLIP)); // played lines are MRU-touched
    expect(ids).not.toContain(pcClipIdOf('og-', 'clip 1')); // the cold end of the first window went
    // …and the ceiling still holds with every other seat talking too.
    for (const [persona, name] of [['mama', 'Queenie'], ['deacon', 'Ford'], ['coach', 'Mae']] as const) {
      await playClip(persona, name, CLIP, 1);
      await playClip(persona, name, 'clip 20', 1);
      expect(residentClipBytes()).toBeLessThanOrEqual(VOICE_CLIP_CACHE_BUDGET_BYTES);
    }
    const snap = voiceResidencySnapshot();
    expect(snap.layer).toBe('per-clip');
    expect(snap.clipBytes).toBe(residentClipBytes());
    expect(snap.clipBudgetBytes).toBe(VOICE_CLIP_CACHE_BUDGET_BYTES);
    expect(snap.encodedBudgetBytes).toBe(VOICE_ENCODED_BUDGET_BYTES);
    expect(snap.passes).toBeGreaterThanOrEqual(4);
    const probe = (window as unknown as Record<string, unknown>).__bwmVoiceResidency as { clipBytes: number };
    expect(probe?.clipBytes).toBe(residentClipBytes());
  });

  it('a table change frees the departed cast’s clips, bytes and manifests; the seated cast stays', async () => {
    await playClip('og', 'Unc', CLIP, 1);
    await playClip('mama', 'Queenie', CLIP, 1);
    const ogKey = pcKeyOf('og-');
    const mamaKey = pcKeyOf('mama-');
    setSeatedVoiceKeys([mamaKey]);
    expect(residentClipIds().every((id) => id.startsWith(`${mamaKey}\n`))).toBe(true);
    expect(residentClipIds().length).toBeGreaterThan(0);
    expect(residentEncodedBytes()).toBe(1); // only Queenie's (1-byte stub) sprite bytes remain
    // Unc's next line starts over: manifest refetched, pass re-run.
    await expect(playClip('og', 'Unc', CLIP, 1)).resolves.toBe(true);
    expect(manifestFetches.get(ogKey)).toBe(2);
    expect(audioFetches.get(ogKey)).toBe(2);
  });

  it('a pass in flight across a table change plays for its caller but retains nothing', async () => {
    let release: ((b: unknown) => void) | null = null;
    h.decode.mockImplementationOnce(() => new Promise((res) => { release = res; }));
    const p = playClip('storyteller', 'Gramps', CLIP, 1);
    for (let n = 0; n < 50 && !release; n++) await flush(); // manifest + bytes landed; the decode is the hanging one
    expect(release).not.toBeNull();
    setSeatedVoiceKeys([]); // the table changed mid-pass
    release!(slicableBuffer());
    await expect(p).resolves.toBe(true); // the waiting line still plays
    const stKey = pcKeyOf('storyteller-');
    expect(residentClipIds().some((id) => id.startsWith(`${stKey}\n`))).toBe(false);
    await expect(playClip('storyteller', 'Gramps', CLIP, 1)).resolves.toBe(true);
    expect(manifestFetches.get(stKey)).toBe(2); // a fresh pass, retained this time
    expect(residentClipIds().some((id) => id.startsWith(`${stKey}\n`))).toBe(true);
  });

  it('warmClip decodes ahead: the warmed line then plays with no second decode', async () => {
    warmClip('og', 'Unc', 'clip 20');
    for (let n = 0; n < 50 && h.decode.mock.calls.length === 0; n++) await flush();
    await flush();
    expect(h.decode).toHaveBeenCalledTimes(1);
    expect(residentClipIds()).toContain(pcClipIdOf('og-', 'clip 20'));
    await expect(playClip('og', 'Unc', 'clip 20', 1)).resolves.toBe(true);
    expect(h.decode).toHaveBeenCalledTimes(1); // served from the warmed cache
  });

  it('preload fetches bytes and warms a starter window — never a whole-sprite decode into residency', async () => {
    preloadVoice('hustler', 'Flo');
    // The idle callback (or its 400 ms fallback) fires the warm-up.
    await new Promise((r) => setTimeout(r, 600));
    await flush(); await flush();
    const key = pcKeyOf('hustler-');
    expect(audioFetches.get(key)).toBe(1);
    expect(h.decode).toHaveBeenCalledTimes(1);
    expect(residentClipIds()).toContain(pcClipIdOf('hustler-', CLIP));
    expect(residentVoiceBytes()).toBe(0); // legacy residency untouched
    await expect(playClip('hustler', 'Flo', CLIP, 1)).resolves.toBe(true);
    expect(h.decode).toHaveBeenCalledTimes(1); // the first line was already warm
  });

  it('take resolution matches the legacy layer: a bid take wins, a missing take falls back to the raw line', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
      const u = String(input);
      if (u.includes('.json')) {
        return new Response(JSON.stringify({ clips: { 'a raw line': [0, PC_CLIP_MS], 'a raw line#5': [PC_CLIP_MS, PC_CLIP_MS] } }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(new Uint8Array([7]).buffer as ArrayBuffer, { status: 200 });
    }));
    await expect(playClip('petty', 'Rae', 'a raw line', 1, 5)).resolves.toBe(true);
    expect(residentClipIds()).toContain(pcClipIdOf('petty-', 'a raw line#5'));
    await expect(playClip('petty', 'Rae', 'a raw line', 1, 7)).resolves.toBe(true);
    expect(residentClipIds()).toContain(pcClipIdOf('petty-', 'a raw line'));
    await expect(clipDurationMs('petty', 'Rae', 'a raw line', 5)).resolves.toBe(PC_CLIP_MS);
  });

  it('a failed decode resolves false and the next line retries against a fresh manifest (the heal contract)', async () => {
    h.decode.mockReset();
    // decodeSprite falls back from a failed offline decode to the
    // engine context, so a dead-context failure rejects BOTH paths
    // before the pass gives up — exactly what the engine rebuild does.
    let calls = 0;
    h.decode.mockImplementation(async () => {
      calls++;
      if (calls <= 2) throw new Error('context rebuilt mid-decode');
      return { duration: 1 }; // unslicable double → whole fallback
    });
    await expect(playClip('og', 'Unc', CLIP, 0.5)).resolves.toBe(false);
    expect(h.playVoice).not.toHaveBeenCalled();
    const ogKey = pcKeyOf('og-');
    await flush();
    await expect(playClip('og', 'Unc', CLIP, 0.5)).resolves.toBe(true);
    expect(manifestFetches.get(ogKey)).toBe(2); // the failure was evicted; the retry refetched
    await expect(playClip('og', 'Unc', CLIP, 0.5)).resolves.toBe(true);
    expect(manifestFetches.get(ogKey)).toBe(2); // a healthy sprite is never refetched
  });
});
