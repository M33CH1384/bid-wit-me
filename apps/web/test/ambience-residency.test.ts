/**
 * @vitest-environment happy-dom
 *
 * The ambience half of the crash-2 memory findings (2026-11-01: the owner
 * still crashing to the menu after the Oct-30 hardening; every provable
 * code path passed, leaving iOS process death under SESSION memory
 * accumulation). The recorded-ambience decode cache (ambCache) never
 * evicted: seven recorded 64 s beds (~23–25 MB decoded each) plus ~35
 * event one-shots piled up to ~150–175 MB across a hop-heavy session —
 * the same order as the entire figure-texture budget. The cache is now
 * bound to the CURRENT venue: a venue switch evicts the previous venue's
 * decoded bed + events, returning re-decodes behind the loader gate on
 * the ordinary first-visit path, and a same-venue settings toggle does
 * NOT evict (no re-decode hiccup for flipping venue sound off and on).
 * (Eight recorded beds since the Yacht wire-in, 2026-11-02; nine
 * since the Beach wire-in, 2026-11-03; ten since the Mansion
 * wire-in, 2026-11-03.)
 *
 * This suite drives the REAL Engine on the watchdog suite's fake-context
 * harness and pins the cache contents across a full venue-hop sequence.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

/* ---------- fakes (the audio-watchdog harness, trimmed) ---------- */

class FakeParam {
  value = 0;
  setTargetAtTime(v: number): void { this.value = v; }
  setValueAtTime(v: number): void { this.value = v; }
  linearRampToValueAtTime(v: number): void { this.value = v; }
  exponentialRampToValueAtTime(v: number): void { this.value = v; }
  cancelScheduledValues(): void { /* noop */ }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  playbackRate = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  connect(): FakeNode { return this; }
  disconnect(): void { /* noop */ }
  start(): void { /* noop */ }
  stop(): void { /* noop */ }
  addEventListener(): void { /* noop */ }
  removeEventListener(): void { /* noop */ }
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  getFloatTimeDomainData(buf: Float32Array): void { buf.fill(0.02); }
}

class FakeCtx {
  static instances: FakeCtx[] = [];
  state: string = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  sourcesStarted = 0;
  constructor() { FakeCtx.instances.push(this); }
  createGain(): FakeNode { return new FakeNode(); }
  createDynamicsCompressor(): FakeNode { return new FakeNode(); }
  createBiquadFilter(): FakeNode { return new FakeNode(); }
  createConvolver(): FakeNode { return new FakeNode(); }
  createOscillator(): FakeNode { return new FakeNode(); }
  createAnalyser(): FakeNode { return new FakeAnalyser(); }
  createMediaElementSource(): FakeNode { return new FakeNode(); }
  createChannelSplitter(): FakeNode { return new FakeNode(); }
  createChannelMerger(): FakeNode { return new FakeNode(); }
  createStereoPanner(): FakeNode { return new FakeNode(); }
  createBufferSource(): FakeNode {
    const n = new FakeNode();
    n.start = () => { this.sourcesStarted++; };
    return n;
  }
  createBuffer(channels: number, length: number, rate: number) {
    return {
      numberOfChannels: channels, length, sampleRate: rate, duration: length / rate,
      getChannelData: () => new Float32Array(length),
      copyToChannel: () => { /* noop */ },
    };
  }
  decodeAudioData(_data: ArrayBuffer, ok?: (b: unknown) => void): Promise<unknown> {
    const buf = this.createBuffer(2, 4800, 48000);
    if (ok) { ok(buf); return Promise.resolve(buf); }
    return Promise.resolve(buf);
  }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  close(): Promise<void> { this.state = 'closed'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
}

class FakeAudioEl {
  static instances: FakeAudioEl[] = [];
  src = '';
  preload = '';
  paused = true;
  currentTime = 0;
  duration = 240;
  readyState = 4;
  networkState = 1;
  error: unknown = null;
  private listeners = new Map<string, Set<() => void>>();
  constructor() { FakeAudioEl.instances.push(this); }
  setAttribute(): void { /* noop */ }
  removeAttribute(name: string): void { if (name === 'src') this.src = ''; }
  addEventListener(type: string, fn: () => void): void {
    let set = this.listeners.get(type);
    if (!set) { set = new Set(); this.listeners.set(type, set); }
    set.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void { this.listeners.get(type)?.delete(fn); }
  fire(type: string): void { this.listeners.get(type)?.forEach((f) => f()); }
  play(): Promise<void> { this.paused = false; this.fire('playing'); return Promise.resolve(); }
  pause(): void { this.paused = true; }
  load(): void { this.error = null; this.networkState = 1; this.readyState = 4; }
}

/* ---------- harness state ---------- */

type Sound = typeof import('../src/audio').sound;
let sound: Sound;

const fetchCounts = new Map<string, number>();
let blobSeq = 0;

const keys = () => sound.ambienceCacheKeys().sort();
const settle = async () => { await vi.advanceTimersByTimeAsync(1200); };

beforeAll(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url);
    fetchCounts.set(u, (fetchCounts.get(u) ?? 0) + 1);
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 }));
  }));
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => `blob:fake-${++blobSeq}`;
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => { /* noop */ };
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  (window as unknown as { Audio: unknown }).Audio = FakeAudioEl;
  ({ sound } = await import('../src/audio'));
  sound.set({ music: false, ambient: false, on: true, venueSound: true });
  sound.enterTable();
  sound.wake('gesture');
  await settle();
});

/* ---------- the hop sequence ---------- */

const PJS_BED = '/audio/ambience/pjs-night-street.mp3';

describe('the ambience cache is bound to the current venue', () => {
  it('the street bed + its events land in the cache at The Pj\'s', async () => {
    sound.setVenueBed('street');
    await settle();
    expect(sound.venueBedNow).toBe('street');
    expect(keys()).toContain('pjs-bed');
    expect(keys().every((k) => k === 'pjs-bed' || k.includes('pjs-'))).toBe(true);
    expect(fetchCounts.get(PJS_BED)).toBe(1);
  });

  it('switching to the Speakeasy evicts the street set wholesale', async () => {
    sound.setVenueBed('jazz');
    await settle();
    expect(sound.venueBedNow).toBe('jazz');
    expect(keys()).toContain('spk-bed');
    expect(keys().some((k) => k.includes('pjs'))).toBe(false);
  });

  it('barbershop, kitchen, cookout, the church basement, the rooftop, the yacht, the beach and the mansion each hold only their own set', async () => {
    sound.setVenueBed('barbershop');
    await settle();
    expect(keys()).toContain('brb-bed');
    expect(keys().every((k) => k === 'brb-bed' || k.includes('barbershop-'))).toBe(true);
    sound.setVenueBed('kitchen');
    await settle();
    expect(keys()).toContain('gma-bed');
    expect(keys().every((k) => k === 'gma-bed' || k.includes('grandmas-'))).toBe(true);
    sound.setVenueBed('cookout');
    await settle();
    expect(keys()).toContain('ctt-bed');
    expect(keys().every((k) => k === 'ctt-bed' || k.includes('cookout-'))).toBe(true);
    sound.setVenueBed('basement');
    await settle();
    expect(keys()).toContain('chu-bed');
    expect(keys().every((k) => k === 'chu-bed' || k.includes('church-'))).toBe(true);
    sound.setVenueBed('rooftop');
    await settle();
    expect(keys()).toContain('roo-bed');
    expect(keys().every((k) => k === 'roo-bed' || k.includes('rooftop-'))).toBe(true);
    sound.setVenueBed('yacht');
    await settle();
    expect(keys()).toContain('yct-bed');
    expect(keys().every((k) => k === 'yct-bed' || k.includes('yacht-'))).toBe(true);
    sound.setVenueBed('beach');
    await settle();
    expect(keys()).toContain('bch-bed');
    expect(keys().every((k) => k === 'bch-bed' || k.includes('beach-'))).toBe(true);
    sound.setVenueBed('mansion');
    await settle();
    expect(keys()).toContain('man-bed');
    expect(keys().every((k) => k === 'man-bed' || k.includes('mansion-'))).toBe(true);
  });

  it('returning to The Pj\'s re-fetches and re-decodes its bed, which starts', async () => {
    const ctx = FakeCtx.instances[FakeCtx.instances.length - 1]!;
    const startedBefore = ctx.sourcesStarted;
    sound.setVenueBed('street');
    await settle();
    expect(sound.venueBedNow).toBe('street');
    expect(keys()).toContain('pjs-bed');
    expect(fetchCounts.get(PJS_BED)).toBe(2); // evicted on the way out, fetched again on return
    expect(ctx.sourcesStarted).toBeGreaterThan(startedBefore); // the bed source started again
  });

  it('flipping venue sound off and on at the same venue does NOT evict', async () => {
    sound.set({ venueSound: false });
    await settle();
    sound.set({ venueSound: true });
    await settle();
    expect(sound.venueBedNow).toBe('street');
    expect(keys()).toContain('pjs-bed');
    expect(fetchCounts.get(PJS_BED)).toBe(2); // no third fetch: the buffers stayed resident
  });

  it('a synthesized venue holds no recorded buffers at all', async () => {
    sound.setVenueBed('casino');
    await settle();
    expect(sound.venueBedNow).toBe('casino');
    expect(keys()).toEqual([]);
  });
});
