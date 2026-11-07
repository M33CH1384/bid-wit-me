/**
 * @vitest-environment happy-dom
 *
 * MENU FIRE BED (owner, 2026-11-07): "I don't like how the fire sound
 * in the Home Screen speed up for a few seconds and then stops
 * altogether. I feel it should persist."
 *
 * The contract pinned here:
 *  - the fireIgnite cue stays exactly what it was — a 3.6 s one-shot
 *    ignition build, once per arrival (home-entrance.test.ts owns it);
 *  - NEW: a sustained crackle bed (fire-loop.mp3, baked from the
 *    ignite recording's own crackle body — same SSE Library CC0 take)
 *    fades in as the cue settles and KEEPS RUNNING for as long as the
 *    fire is on Home: no scheduled end, several loop lengths later it
 *    is still sounding;
 *  - it leaves the way the fire would want: a short fade, never a cut,
 *    when he leaves Home, the streak state changes off fire, calm /
 *    reduce-effects applies, or the app backgrounds;
 *  - the switches rule it absolutely: sound off OR music off silences
 *    it (and stops it starting), and turning them back on while the
 *    fire still stands resumes it — the layer never outranks a switch;
 *  - it is a MENU layer: in a game context it never sounds;
 *  - it loads lazily (its own decode, never part of the eager SFX
 *    set — sound.loaded stays 23) and rides the sfx bus, so master
 *    mute and the SFX category volume govern it live.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

interface RampEvent { m: string; v: number; t: number }

class FakeParam {
  value = 0;
  events: RampEvent[] = [];
  setTargetAtTime(v: number, t: number): void { this.events.push({ m: 'target', v, t }); }
  setValueAtTime(v: number, t: number): void { this.value = v; this.events.push({ m: 'set', v, t }); }
  linearRampToValueAtTime(v: number, t: number): void { this.events.push({ m: 'lin', v, t }); }
  exponentialRampToValueAtTime(v: number, t: number): void { this.events.push({ m: 'exp', v, t }); }
  cancelScheduledValues(t: number): void { this.events.push({ m: 'cancel', v: 0, t }); }
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
  connections: unknown[] = [];
  connect(to?: unknown): FakeNode { this.connections.push(to); return this; }
  disconnect(): void { /* noop */ }
  start(): void { /* noop */ }
  stop(): void { /* noop */ }
  addEventListener(): void { /* noop */ }
  removeEventListener(): void { /* noop */ }
}

class FakeSource extends FakeNode {
  startAt: number | null = null;
  stopAt: number | null = null;
  override start(when?: number): void { this.startAt = when ?? 0; }
  override stop(when?: number): void { this.stopAt = when ?? 0; }
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  /** The engine's silence witness: report honest signal so no heal fires. */
  getFloatTimeDomainData(buf: Float32Array): void { buf.fill(0.02); }
}

class FakeCtx {
  static instances: FakeCtx[] = [];
  state: string = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  sources: FakeSource[] = [];
  constructor() { FakeCtx.instances.push(this); }
  createGain(): FakeNode { return new FakeNode(); }
  createDynamicsCompressor(): FakeNode { return new FakeNode(); }
  createBiquadFilter(): FakeNode { return new FakeNode(); }
  createConvolver(): FakeNode { return new FakeNode(); }
  createOscillator(): FakeNode { return new FakeNode(); }
  createAnalyser(): FakeNode { return new FakeAnalyser(); }
  createChannelSplitter(): FakeNode { return new FakeNode(); }
  createChannelMerger(): FakeNode { return new FakeNode(); }
  createStereoPanner(): FakeNode { return new FakeNode(); }
  createMediaElementSource(): FakeNode { return new FakeNode(); }
  createBufferSource(): FakeSource { const s = new FakeSource(); this.sources.push(s); return s; }
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
const fetchedUrls: string[] = [];

const ctx = () => FakeCtx.instances.at(-1)!;
/** Buffer sources created since a snapshot count. */
const sourcesSince = (n: number) => ctx().sources.slice(n);
/** The gain node a source was routed through first (its own gain). */
const gainOf = (src: FakeSource) => src.connections[0] as FakeNode;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 10));
};

/** Wait until the SFX set finishes decoding (bounded poll, not a sleep race). */
const untilLoaded = async (n: number) => {
  for (let i = 0; i < 200 && sound.loaded < n; i++) await new Promise((r) => setTimeout(r, 25));
};

beforeAll(async () => {
  localStorage.clear();
  vi.spyOn(performance, 'now').mockImplementation(() => 100_000);
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    fetchedUrls.push(String(url));
    return new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 });
  }));
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  let blobSeq = 0;
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => `blob:fake-${++blobSeq}`;
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => { /* noop */ };
  ({ sound } = await import('../src/audio'));
  sound.set({ on: true, music: true, ambient: false });
  sound.wake('gesture');
  await untilLoaded(23);
});

describe('the menu fire bed at the engine', () => {
  it('loads lazily: nothing fire-loop is fetched until the bed is first wanted', () => {
    expect(fetchedUrls.some((u) => u.includes('fire-loop'))).toBe(false);
    expect(sound.loaded).toBe(23); // the eager SFX set is untouched by the bed
  });

  it('ignite start: one looping source, silent through the build, full bed gain as the cue settles', async () => {
    const before = ctx().sources.length;
    ctx().currentTime = 10;
    sound.menuFireStart(true);
    await flush();
    const fresh = sourcesSince(before).filter((s) => s.loop);
    expect(fresh).toHaveLength(1);
    const src = fresh[0]!;
    expect(src.startAt).toBe(10);
    const ev = gainOf(src).gain.events;
    // silent at the start, still silent at +2.4 s (the ignition build owns
    // those seconds), then an exponential settle to the bed gain by +4.4 s
    expect(ev[0]).toEqual({ m: 'set', v: 0.0001, t: 10 });
    expect(ev.some((e) => e.m === 'set' && e.v === 0.0001 && Math.abs(e.t - 12.4) < 0.05)).toBe(true);
    const settle = ev.at(-1)!;
    expect(settle.m).toBe('exp');
    expect(settle.v).toBeCloseTo(0.3, 5);
    expect(settle.t).toBeCloseTo(14.4, 1);
    expect(sound.played.menuFire).toBe(1);
    expect(fetchedUrls.some((u) => u === '/assets/sfx/fire-loop.mp3')).toBe(true);
  });

  it('keeps running while the fire stands: no stop is ever scheduled', async () => {
    ctx().currentTime = 10 + 60; // ~18 loop lengths later
    await flush();
    const src = ctx().sources.filter((s) => s.loop).at(-1)!;
    expect(src.stopAt).toBeNull();
    expect(sound.menuFireOn).toBe(true);
  });

  it('stop fades out — a short exponential decay, never a hard cut', async () => {
    const src = ctx().sources.filter((s) => s.loop).at(-1)!;
    const evBefore = gainOf(src).gain.events.length;
    ctx().currentTime = 100;
    sound.menuFireStop();
    await flush();
    const ev = gainOf(src).gain.events.slice(evBefore);
    expect(ev.some((e) => e.m === 'cancel')).toBe(true);
    const fade = ev.find((e) => e.m === 'exp' && e.v === 0.0001)!;
    expect(fade.t).toBeCloseTo(100.35, 1);
    expect(src.stopAt).not.toBeNull();
    expect(src.stopAt!).toBeGreaterThan(100.35);
    expect(sound.menuFireOn).toBe(false);
  });

  it('plain start fades in promptly (a resume wears no ignition delay)', async () => {
    const before = ctx().sources.length;
    ctx().currentTime = 200;
    sound.menuFireStart(false);
    await flush();
    const fresh = sourcesSince(before).filter((s) => s.loop);
    expect(fresh).toHaveLength(1);
    const settle = gainOf(fresh[0]!).gain.events.at(-1)!;
    expect(settle.m).toBe('exp');
    expect(settle.v).toBeCloseTo(0.3, 5);
    expect(settle.t).toBeCloseTo(201.2, 1);
  });

  it('the switches rule it: music off stops it, music back on resumes it, sound off stops it', async () => {
    const running = () => ctx().sources.filter((s) => s.loop).at(-1)!;
    // music off mid-run → the bed stops (it must never outrank the switch)
    sound.set({ music: false });
    await flush();
    expect(running().stopAt).not.toBeNull();
    expect(sound.menuFireOn).toBe(false);
    // music back on while the fire still stands → it resumes, plain fade
    const before = ctx().sources.length;
    sound.set({ music: true });
    await flush();
    expect(sourcesSince(before).filter((s) => s.loop)).toHaveLength(1);
    expect(sound.menuFireOn).toBe(true);
    // and a start attempted under music-off never sounds at all
    sound.menuFireStop();
    sound.set({ music: false });
    const before2 = ctx().sources.length;
    sound.menuFireStart(false);
    await flush();
    expect(sourcesSince(before2).filter((s) => s.loop)).toHaveLength(0);
    sound.set({ music: true });
    await flush();
    sound.menuFireStop();
    // sound (master) off mid-run stops it too
    sound.menuFireStart(false);
    await flush();
    expect(sound.menuFireOn).toBe(true);
    sound.set({ on: false });
    await flush();
    expect(sound.menuFireOn).toBe(false);
    sound.set({ on: true });
    await flush();
    sound.menuFireStop();
  });

  it('never sounds in a game context', async () => {
    sound.enterContext('game');
    const before = ctx().sources.length;
    sound.menuFireStart(false);
    await flush();
    expect(sourcesSince(before).filter((s) => s.loop)).toHaveLength(0);
    sound.menuFireStop();
    sound.enterContext('menu');
    sound.set({ on: true, music: true });
    await flush();
    sound.menuFireStop();
  });
});

describe('the wiring (source pins)', () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const audio = read('../src/audio.ts');
  const setup = read('../src/Setup.tsx');
  const credits = read('../../../CREDITS.md');

  it('the engine carries the bed: seam, gain, loop trim, lazy URL — and FILES is untouched', () => {
    expect(audio).toContain('menuFireStart(');
    expect(audio).toContain('menuFireStop(');
    expect(audio).toContain('MENU_FIRE_BED_GAIN = 0.3');
    expect(audio).toContain("MENU_FIRE_LOOP_URL = '/assets/sfx/fire-loop.mp3'");
    expect(audio).toContain('MENU_FIRE_LOOP_LEAD_S = 1105 / 44100');
    expect(audio).toContain('MENU_FIRE_LOOP_SECONDS = 3.2');
    expect(audio).toContain('trimLoopBuffer');
    // the bed is NOT an eager SFX-set entry (loaded stays 23, proven above)
    expect(audio).not.toContain("['fire-loop']");
  });

  it('Setup starts the bed beside the cue, under the cue\u2019s exact gate, and stops it on the fire\u2019s exits', () => {
    expect(setup.match(/sound\.play\('fireIgnite'\)/g)).toHaveLength(1); // the cue itself is untouched
    expect(setup.match(/sound\.menuFireStart\(true\)/g)).toHaveLength(1);
    // the start sits inside the same gate block as the cue
    expect(setup).toMatch(/if \(fireTier > 0 && !calmHome\) \{[^}]*sound\.play\('fireIgnite'\);[^}]*sound\.menuFireStart\(true\);/);
    // leaving home / fire off / calm → stop; unmount → stop
    expect(setup).toContain('sound.menuFireStop()');
  });

  it('the loop is credited to the same CC0 fire recordings and ships in the sfx folder', () => {
    expect(credits).toContain('fire-loop.mp3');
    expect(credits).toContain('SSE_Library_FIRE');
    const mp3 = readFileSync(new URL(['../public/assets/sfx/', 'fire-loop.mp3'].join(''), import.meta.url));
    expect(mp3.length).toBeGreaterThan(10_000);
    expect(mp3.subarray(0, 3).toString('latin1')).toBe('ID3');
  });
});
