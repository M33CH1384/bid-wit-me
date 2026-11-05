/**
 * @vitest-environment happy-dom
 *
 * The music-off contract (owner 2026-11-04: "I tried turning the music off
 * in the room I was in and it kept playing"). Drives the REAL Engine on the
 * watchdog suite's fake context + fake media elements. The steady-state
 * toggle always worked; the off-signal died at the toggle × crossfade/event
 * joint, and those are the pins that matter here:
 *  - OFF during a crossfade ends in musicStatus 'off' — never the load
 *    failure state 'error' (advance()'s abort used to brand it so);
 *  - OFF cancels any in-flight deck automation BEFORE fading, so a
 *    crossfade ramp to full volume can never outrank the toggle and keep
 *    the incoming track swelling after the owner said stop;
 *  - a deck 'playing' event cannot resurrect the 'playing' status while
 *    music is off (the listener takes the same wantsMusic gate its 'error'
 *    sibling always had).
 * Plus the family basics: off silences + pauses the decks, on resumes, the
 * music-volume slider rides the bus live mid-track, and neither track-end
 * events nor wakes revive music the owner turned off.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

class FakeParam {
  value = 0;
  calls: string[] = [];
  setTargetAtTime(v: number): void { this.calls.push(`target:${v}`); this.value = v; }
  setValueAtTime(v: number): void { this.calls.push(`value:${v}`); this.value = v; }
  linearRampToValueAtTime(v: number): void { this.calls.push(`ramp:${v}`); this.value = v; }
  exponentialRampToValueAtTime(v: number): void { this.calls.push(`expramp:${v}`); this.value = v; }
  cancelScheduledValues(): void { this.calls.push('cancel'); }
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
  state: string = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
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
  createBufferSource(): FakeNode { return new FakeNode(); }
  createBuffer(channels: number, length: number, rate: number) {
    return { numberOfChannels: channels, length, sampleRate: rate, duration: length / rate, getChannelData: () => new Float32Array(length), copyToChannel: () => { /* noop */ } };
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

type Sound = typeof import('../src/audio').sound;
let sound: Sound;
interface EngDeck { el: FakeAudioEl; track: number | null; url: string | null; ready: Promise<boolean> | null; gain: { gain: { value: number; calls: string[] } } }
interface Eng { decks: EngDeck[]; active: number; advancing: boolean; fading: boolean; musicBus: { gain: { value: number } } | null; sfxBus: { gain: { value: number } } | null }
const eng = () => sound as unknown as Eng;
const activeDeck = () => eng().decks[eng().active]!;
const status = () => (sound as unknown as { musicStatus: string }).musicStatus;
let musicFetches = 0;
let blobSeq = 0;
const step = async (ms: number) => {
  const d = eng().decks.length ? activeDeck() : null;
  if (d && !d.el.paused && d.el.currentTime < d.el.duration - 10) d.el.currentTime += ms / 1000;
  await vi.advanceTimersByTimeAsync(ms);
};

beforeAll(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url).includes('/audio/music/')) musicFetches++;
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 }));
  }));
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => `blob:fake-${++blobSeq}`;
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => { /* noop */ };
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  (window as unknown as { Audio: unknown }).Audio = FakeAudioEl;
  ({ sound } = await import('../src/audio'));
  sound.set({ music: true, ambient: false, venueSound: false });
  // The suite needs SOUNDING music to toggle. It used to get it from
  // the menu theme (the engine boots in menu context); since the
  // theme's retirement (2026-11-05) the menus are silent, so the suite
  // sits at a table instead — the game scene patch is these same three
  // values, and the OFF contract pinned here is context-agnostic.
  sound.enterContext('game');
  sound.enterTable();
  sound.wake('gesture');
  await step(1000);
  await step(5000);
});

describe('music-off contract', () => {
  it('P0: music is verifiably playing mid-track', () => {
    expect(status()).toBe('playing');
    expect(sound.playingDeckCount()).toBe(1);
    activeDeck().el.currentTime = 30;
    expect(activeDeck().gain.gain.value).toBeGreaterThan(0.9);
  });

  it('P1: toggle OFF mid-track silences and pauses the decks', async () => {
    sound.set({ music: false });
    expect(sound.settings.music).toBe(false);
    expect(status()).toBe('off');
    await step(1600); // fade (tc 0.25) + the 1200 ms pause timer
    for (const d of eng().decks) expect(d.el.paused).toBe(true);
    expect(sound.playingDeckCount()).toBe(0);
  });

  it('P2: toggle back ON resumes', async () => {
    sound.set({ music: true });
    await step(500);
    expect(status()).toBe('playing');
    expect(activeDeck().el.paused).toBe(false);
    activeDeck().el.currentTime = 30;
  });

  it('P3: music volume slider rides live mid-track (musicBus gain follows)', async () => {
    sound.set({ musicVolume: 0.1 });
    const want = 0.1 ** 1.6 * 0.85;
    expect(eng().musicBus!.gain.value).toBeCloseTo(want, 5);
    sound.set({ musicVolume: 0.5 });
    expect(eng().musicBus!.gain.value).toBeCloseTo(0.5 ** 1.6 * 0.85, 5);
  });

  it('P4: while OFF, track-end events and wakes never revive the music', async () => {
    sound.set({ music: false });
    await step(1600);
    const fetches = musicFetches;
    const d = activeDeck();
    d.el.currentTime = d.el.duration - 1;
    d.el.fire('timeupdate');
    d.el.fire('ended');
    sound.wake('gesture');
    await step(3000);
    expect(status()).toBe('off');
    expect(sound.playingDeckCount()).toBe(0);
    for (const dk of eng().decks) expect(dk.el.paused).toBe(true);
    expect(musicFetches).toBe(fetches); // no look-ahead loads while off
  });

  it('P5: toggle OFF during a crossfade still ends silent', async () => {
    sound.set({ music: true });
    await step(500);
    expect(status()).toBe('playing');
    const from = activeDeck();
    const other = eng().decks[1 - eng().active]!;
    other.track = null; other.ready = null; other.url = null; other.el.src = '';
    from.el.currentTime = from.el.duration - 2;
    from.el.fire('timeupdate'); // crossfade begins; advance() awaits the fetch
    sound.set({ music: false }); // owner hits OFF mid-fade
    await step(7000); // past XFADE (4s) + pause timer + fade tail
    expect(status()).toBe('off');
    expect(sound.playingDeckCount()).toBe(0);
    for (const dk of eng().decks) expect(dk.el.paused).toBe(true);
  });

  it('P6: OFF cancels any in-flight deck automation before fading (no ramp outranks the toggle)', async () => {
    sound.set({ music: true });
    await step(500);
    expect(status()).toBe('playing');
    for (const d of eng().decks) d.gain.gain.calls.length = 0;
    sound.set({ music: false });
    for (const d of eng().decks) {
      const calls = d.gain.gain.calls;
      const cancelAt = calls.indexOf('cancel');
      const fadeAt = calls.findIndex((c) => c === 'target:0');
      expect(cancelAt, `deck automation must be cancelled on OFF (saw: ${calls.join(',')})`).toBeGreaterThanOrEqual(0);
      expect(fadeAt).toBeGreaterThan(cancelAt); // the fade is scheduled after the cancel, so nothing older can outrank it
    }
    await step(1600);
    expect(sound.playingDeckCount()).toBe(0);
  });

  it("P7: a deck 'playing' event cannot resurrect the status while music is OFF", async () => {
    expect(status()).toBe('off');
    activeDeck().el.fire('playing');
    expect(status()).toBe('off');
    await step(500);
    expect(status()).toBe('off');
    expect(sound.playingDeckCount()).toBe(0);
  });
});
