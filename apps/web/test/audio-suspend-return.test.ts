/**
 * @vitest-environment happy-dom
 *
 * The suspend/return contract (owner's fourth report of the family,
 * 2026-11-08: "The sound pauses and won't come back during gameplay").
 *
 * The 2026-10-30 watchdog suite pins the stems it can see: deck elements,
 * graph output, SFX holes, a bed that lost its nodes. This suite covers
 * the shapes that suite cannot express:
 *
 *  - a RECORDED bed whose one-shot async start fails (fetch/decode): the
 *    bed's flag claims it is playing, only its silent through-gain sits
 *    in the node list, so the watchdog's node-count check never fires
 *    and syncVenue's identity gate never rebuilds — the room stays dead
 *    until the player changes venue or the whole context is rebuilt;
 *  - a throw inside one stem's sync must not take the whole wake down
 *    with it (the resume that follows the syncs is the recovery);
 *  - a film hold (story rundown) must not outlive its surface into a
 *    table — the master bus stays at 0 and the watchdog reads that as
 *    intended silence;
 *  - the standard platform recoveries (interruption → rebuild,
 *    suspend → visibility return) and the switches' precedence over
 *    every recovery (music off / sound off stay off through a cycle).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

/* ---------- fakes (modelled on audio-watchdog.test.ts) ---------- */

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

/* ---------- harness state ---------- */

type Sound = typeof import('../src/audio').sound;
let sound: Sound;
interface EngDeck { el: FakeAudioEl; track: number | null; url: string | null }
interface Eng {
  decks: EngDeck[]; active: number;
  venueNodes: unknown[]; ctx: FakeCtx | null; videoHold: boolean;
  master: { gain: { value: number } } | null;
  syncVenue: () => void;
}
const eng = () => sound as unknown as Eng;
const activeDeck = () => eng().decks[eng().active]!;
const liveCtx = () => FakeCtx.instances[FakeCtx.instances.length - 1]!;

/** While true, the Classic Studio bed file 404s (a reaped connection /
 *  an edge hiccup at table entry) — everything else loads fine. */
let failBedFetch = false;

beforeAll(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (failBedFetch && String(url).includes('classic-bed.mp3')) {
      return Promise.resolve(new Response('nope', { status: 404 }));
    }
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 }));
  }));
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:fake';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => { /* noop */ };
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  (window as unknown as { Audio: unknown }).Audio = FakeAudioEl;
  ({ sound } = await import('../src/audio'));
  sound.set({ music: true, ambient: false, on: true, venueSound: true });
  sound.enterTable();
  sound.enterContext('game');
});

describe('the recorded bed whose start fails', () => {
  it('a bed that never started is rebuilt by the watchdog once its load window lapses', async () => {
    sound.set({ on: true, venueSound: true }); // in the game scene, as a table mount leaves it
    failBedFetch = true;
    sound.setVenueBed('studio');
    sound.wake('gesture'); // unlock: syncVenue builds the bed, the load 404s
    await vi.advanceTimersByTimeAsync(100);
    expect(sound.venueBedNow).toBe('studio'); // the flag claims the room is playing…
    expect(eng().venueNodes.length).toBe(1); // …but only the silent through-gain landed
    const startedBefore = liveCtx().sourcesStarted;
    failBedFetch = false; // the connection is fine again — nobody tells the engine
    await vi.advanceTimersByTimeAsync(30_000); // watchdog ticks + the heal grace
    expect(eng().venueNodes.length).toBe(2); // through-gain + the loop's stop wrapper
    expect(liveCtx().sourcesStarted).toBeGreaterThan(startedBefore); // a source actually started
    expect(sound.venueBedNow).toBe('studio');
  });

  it('a healthy bed is left alone — no rebuild churn while it sounds', async () => {
    const ctxs = FakeCtx.instances.length;
    const nodes = eng().venueNodes.length;
    const started = liveCtx().sourcesStarted;
    await vi.advanceTimersByTimeAsync(45_000);
    expect(FakeCtx.instances.length).toBe(ctxs); // no context rebuild
    expect(eng().venueNodes.length).toBe(nodes); // no bed rebuild
    expect(liveCtx().sourcesStarted).toBe(started); // no duplicate loop started
  });
});

describe('the standard platform recoveries', () => {
  it('an iOS interruption rebuilds the context and the music sounds again', async () => {
    const ctx = liveCtx();
    const ctxsBefore = FakeCtx.instances.length;
    ctx.state = 'interrupted';
    ctx.onstatechange?.();
    await vi.advanceTimersByTimeAsync(6_000); // heal cadence + rebuild cooldown
    expect(FakeCtx.instances.length).toBeGreaterThan(ctxsBefore);
    expect(liveCtx().state).toBe('running');
    await vi.advanceTimersByTimeAsync(2_000); // first-start load on the fresh decks
    expect(activeDeck().el.paused).toBe(false);
  });

  it('a silent suspend heals on the visibility return', async () => {
    const ctx = liveCtx();
    ctx.state = 'suspended'; // the OS suspended it; no statechange the page can trust
    document.dispatchEvent(new Event('visibilitychange')); // back to the game
    await vi.advanceTimersByTimeAsync(2_500); // the wake + the heal timer
    expect(ctx.state).toBe('running');
  });
});

describe('one broken stem cannot take the wake down', () => {
  it('a throwing sync still leaves the context resumed and the music synced', async () => {
    const original = eng().syncVenue;
    eng().syncVenue = () => { throw new Error('device-specific boom'); };
    const ctx = liveCtx();
    ctx.state = 'suspended';
    try {
      expect(() => sound.wake('gesture')).not.toThrow();
    } finally {
      eng().syncVenue = original;
    }
    await vi.advanceTimersByTimeAsync(100);
    expect(ctx.state).toBe('running'); // the resume after the syncs still ran
    expect(activeDeck().el.paused).toBe(false); // and the music sync behind it too
    sound.wake('gesture'); // restore the venue sync's good name
    await vi.advanceTimersByTimeAsync(100);
  });
});

describe('the film hold cannot latch into a table', () => {
  it('entering a table releases a hold whose surface is gone', async () => {
    sound.holdForVideo(true);
    expect(eng().videoHold).toBe(true);
    sound.enterTable();
    expect(eng().videoHold).toBe(false);
    sound.holdForVideo(true);
    sound.holdForVideo(false); // the ordinary release still works
    expect(eng().videoHold).toBe(false);
  });
});

describe('the switches outrank every recovery', () => {
  it('music switched off stays off through a suspend/return cycle', async () => {
    sound.set({ music: false });
    await vi.advanceTimersByTimeAsync(1_500); // the off fade parks the decks
    expect(activeDeck().el.paused).toBe(true);
    const ctx = liveCtx();
    ctx.state = 'suspended';
    sound.wake('show');
    await vi.advanceTimersByTimeAsync(3_000); // heal + watchdog ticks
    expect(ctx.state).toBe('running'); // the engine recovered…
    expect(activeDeck().el.paused).toBe(true); // …but the music stayed off
    sound.set({ music: true }); // restore for the next test
    sound.wake('gesture');
    await vi.advanceTimersByTimeAsync(2_000);
  });

  it('sound switched off stays off through a suspend/return cycle', async () => {
    sound.set({ on: false });
    const ctx = liveCtx();
    ctx.state = 'suspended';
    sound.wake('show');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sound.snapshot.on).toBe(false); // the switch itself survived the cycle
    expect(ctx.state).toBe('running'); // the engine recovered underneath it
    expect(eng().master?.gain.value).toBe(0); // and the master stayed muted — silence kept
    sound.set({ on: true });
    sound.wake('gesture');
    await vi.advanceTimersByTimeAsync(2_000);
  });
});
