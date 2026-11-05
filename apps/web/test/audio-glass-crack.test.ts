/**
 * @vitest-environment happy-dom
 *
 * The glassCrack engine contract (screen-crack lane, 2026-11-04): the
 * REAL Engine on a fake AudioContext, proving the cue the AnimFxLayer
 * fires for the plate crack is a fully registered one-shot —
 *
 *  - the whole SFX set including glass-crack decodes (loaded = 23 since fire-ignite joined 2026-11-05);
 *  - play('glassCrack') at a table starts its buffer source at EXACTLY
 *    ctx.currentTime — offset 0. The crack visual's fracture onset is
 *    its mount instant (the main vein carries no CSS delay), so the
 *    engine must not schedule the cue late; the sample's own attack
 *    (1.8 ms into the encoded file, measured at build) is the only
 *    distance between the call and the crack the ear hears;
 *  - sound settings off silences it (the family gate).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

class FakeParam {
  value = 0;
  setTargetAtTime(): void { /* noop */ }
  setValueAtTime(): void { /* noop */ }
  linearRampToValueAtTime(): void { /* noop */ }
  exponentialRampToValueAtTime(): void { /* noop */ }
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

class FakeCtx {
  static instances: FakeCtx[] = [];
  state: string = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  /** Every buffer-source start time, in schedule order. */
  starts: number[] = [];
  constructor() { FakeCtx.instances.push(this); }
  createGain(): FakeNode { return new FakeNode(); }
  createDynamicsCompressor(): FakeNode { return new FakeNode(); }
  createBiquadFilter(): FakeNode { return new FakeNode(); }
  createConvolver(): FakeNode { return new FakeNode(); }
  createOscillator(): FakeNode { return new FakeNode(); }
  createMediaElementSource(): FakeNode { return new FakeNode(); }
  createBufferSource(): FakeNode {
    const n = new FakeNode();
    n.start = (when?: number) => { this.starts.push(when ?? this.currentTime); };
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
    const buf = this.createBuffer(1, 4800, 48000);
    if (ok) { ok(buf); return Promise.resolve(buf); }
    return Promise.resolve(buf);
  }
  resume(): Promise<void> { this.state = 'running'; return Promise.resolve(); }
  close(): Promise<void> { this.state = 'closed'; return Promise.resolve(); }
  suspend(): Promise<void> { this.state = 'suspended'; return Promise.resolve(); }
}

type Sound = typeof import('../src/audio').sound;
let sound: Sound;

/** Wait until the SFX set finishes decoding (bounded). A fixed sleep
 *  races the loader on a loaded machine — the heal-slots suite's
 *  documented 60ms-flush flake — so poll the counter itself. */
const untilLoaded = async (n: number) => {
  for (let i = 0; i < 200 && sound.loaded < n; i++) await new Promise((r) => setTimeout(r, 25));
};

beforeAll(async () => {
  localStorage.clear();
  vi.spyOn(performance, 'now').mockImplementation(() => 100_000);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 })));
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  ({ sound } = await import('../src/audio'));
  sound.set({ music: false, ambient: true });
  sound.enterTable();
  sound.wake('gesture');
  await untilLoaded(23);
});

describe('glassCrack at the engine', () => {
  it('the full SFX set decodes with the crack in it', () => {
    expect(sound.loaded).toBe(23); // 21 + glass-crack (2026-11-04) + fire-ignite (2026-11-05)
  });

  it('play starts the source at exactly ctx.currentTime — offset 0 from the fracture frame', () => {
    const ctx = FakeCtx.instances.at(-1)!;
    ctx.currentTime = 3.25;
    const before = ctx.starts.length;
    sound.play('glassCrack');
    expect(sound.played.glassCrack).toBe(1);
    const fresh = ctx.starts.slice(before);
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toBe(3.25);
  });

  it('sound settings off silences the cue', () => {
    sound.set({ on: false });
    sound.play('glassCrack');
    expect(sound.played.glassCrack).toBe(1); // unchanged — the gate held
    sound.set({ on: true });
  });
});
