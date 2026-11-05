/**
 * @vitest-environment happy-dom
 *
 * SPLASH MUSIC RACE (owner, 2026-11-04, on the shipped splash): "The menu
 * music plays immediately with no shuffle." Rig-measured on the production
 * build (ms from the tap's pointerdown): the music fetch starts at +43 —
 * wake('gesture') runs resyncAll → syncMusic's first start from the SAME
 * tap, before the click that asks for the sting even fires — and the deck
 * is playing by +239 with its 1.5 s fade-in. The sting never sounds at
 * all: the splash entry point plays deckSlam at +59 while the buffer's
 * decode lands at +263 (the SFX load only started inside the same
 * gesture's ensure()), and play() silently drops an unloaded buffer —
 * yet the entry point still resolves true, so the splash fades on
 * schedule over silence. Two mechanisms, both pinned here:
 *
 *  - THE HOLD: while the splash's sting owns its second, syncMusic must
 *    not start the music. The gate arms it in sting mode (and only
 *    there); the release — fired at the slam — runs the ordinary first
 *    start, whose own 1.5 s fade-in brings the music in FROM the slam.
 *    The hold never touches a sounding deck, never outranks the music
 *    OFF branch (01c3680e), and self-heals on a backstop so a stranded
 *    hold can never mute a session.
 *  - THE BUFFER WAIT: the splash entry point waits (bounded) for the
 *    deckSlam buffer before playing, and aborts if the hold is released
 *    while it waits — no late sting over the menu, no dropped sting
 *    reported as fired.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/* ---------- fakes: the music-off suite's fake context + media elements ---------- */
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
interface Eng {
  decks: EngDeck[]; active: number;
  armStingHold: () => void; releaseStingHold: () => void;
  buffers: Map<string, unknown>;
}
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
  // The owner's phone: an explicit menu-music choice (menus default to no
  // scene; his menu plays music). Set while still locked — nothing starts.
  sound.set({ music: true, ambient: false, venueSound: false });
});

describe('the sting hold: music waits for the slam', () => {
  it('R0: menu music is wanted, the engine is locked, nothing has started', () => {
    expect(sound.settings.music).toBe(true);
    expect(status()).toBe('off');
    expect(musicFetches).toBe(0);
    expect(sound.playingDeckCount()).toBe(0);
  });

  it('R1: armed before the tap, the tap starts NO music — no fetch, no decks, watchdog cannot start it either', async () => {
    eng().armStingHold();
    sound.wake('gesture'); // the splash tap: pointerdown wakes the engine first
    await step(300);
    await step(2000); // a watchdog tick
    await step(2500); // another
    expect(musicFetches).toBe(0);
    expect(eng().decks.length).toBe(0);
    expect(status()).not.toBe('playing');
    expect(sound.playingDeckCount()).toBe(0);
  });

  it('R2: the release (the slam) runs the ordinary first start, with its own fade-in ramp', async () => {
    eng().releaseStingHold();
    await step(300);
    expect(musicFetches).toBeGreaterThanOrEqual(1);
    await step(1000);
    expect(status()).toBe('playing');
    expect(activeDeck().el.paused).toBe(false);
    // the first start's own automation: a 1.5 s linear ramp 0.0001 → 1 —
    // the music fades in from the slam, it is not hard-cut at the release.
    expect(activeDeck().gain.gain.calls).toContain('ramp:1');
  });

  it('R3: an armed hold never touches music that is already sounding', async () => {
    eng().armStingHold();
    sound.wake('gesture');
    await step(1000);
    expect(status()).toBe('playing');
    expect(sound.playingDeckCount()).toBe(1);
    eng().releaseStingHold();
  });

  it('R4: a stranded hold self-heals on its backstop — music starts without any release', async () => {
    sound.set({ music: false });
    await step(1600);
    expect(status()).toBe('off');
    eng().armStingHold();
    sound.set({ music: true }); // this sync is the first blocked one
    const fetches = musicFetches;
    await step(500);
    expect(musicFetches).toBe(fetches); // still held: no load began
    expect(status()).not.toBe('playing');
    await step(5200); // past the backstop
    expect(status()).toBe('playing');
    expect(sound.playingDeckCount()).toBe(1);
  });

  it('R5: the OFF branch still outranks the hold, in both directions (01c3680e joint intact)', async () => {
    eng().armStingHold();
    sound.set({ music: false });
    await step(1600);
    expect(status()).toBe('off');
    for (const d of eng().decks) expect(d.el.paused).toBe(true);
    eng().releaseStingHold(); // releasing while OFF must not start anything
    await step(500);
    expect(status()).toBe('off');
    expect(sound.playingDeckCount()).toBe(0);
    sound.set({ music: true }); // and with the hold gone, ON is the normal path again
    await step(500);
    expect(status()).toBe('playing');
  });
});

describe('the splash entry point waits for its buffer', () => {
  const played: { name: string; at: number }[] = [];
  let insertedAt = 0;

  beforeAll(() => {
    vi.useRealTimers();
    const e = sound as unknown as Record<string, unknown>;
    e['wake'] = () => { /* stubbed: B isolates the seam from the unlock path */ };
    e['play'] = (n: string) => { played.push({ name: n, at: Date.now() }); };
    e['ctx'] = { state: 'running', resume: async () => { /* already running */ } };
    e['settings'] = { on: true, volume: 0.7, music: false, ambient: false, venueSound: false, volumes: { sfx: 1 } };
    e['buffers'] = new Map<string, unknown>();
  });

  it('B1: a buffer that lands late is awaited — the sting fires when it exists, not before', async () => {
    played.length = 0;
    eng().buffers.clear();
    const p = sound.beginFromSplash();
    window.setTimeout(() => { insertedAt = Date.now(); eng().buffers.set('deck-slam', {}); }, 150);
    await expect(p).resolves.toBe(true);
    expect(played.map((x) => x.name)).toEqual(['deckSlam']);
    expect(played[0]!.at).toBeGreaterThanOrEqual(insertedAt);
  });

  it('B2: a buffer that never lands fails closed inside the bound — nothing fires', async () => {
    played.length = 0;
    eng().buffers.clear();
    const t0 = Date.now();
    await expect(sound.beginFromSplash()).resolves.toBe(false);
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(900);
    expect(elapsed).toBeLessThan(1700); // inside the splash's own 1500 ms race + slack
    expect(played).toEqual([]);
  });

  it('B3: if the hold is released while it waits, the moment has passed — no late sting', async () => {
    played.length = 0;
    eng().buffers.clear();
    eng().armStingHold();
    const p = sound.beginFromSplash();
    window.setTimeout(() => eng().releaseStingHold(), 150);
    await expect(p).resolves.toBe(false);
    expect(played).toEqual([]);
  });

  it('B4: a buffer already resident fires promptly (the warm path)', async () => {
    played.length = 0;
    eng().buffers.set('deck-slam', {});
    const t0 = Date.now();
    await expect(sound.beginFromSplash()).resolves.toBe(true);
    expect(Date.now() - t0).toBeLessThan(400);
    expect(played.map((x) => x.name)).toEqual(['deckSlam']);
  });
});

describe('wiring pins', () => {
  it('the gate arms the hold only in sting mode, and releases it on unmount', () => {
    const src = read('../src/BootSplash.tsx');
    expect(src).toContain('armStingHold');
    expect(src).toMatch(/plan\.mode !== 'sting'[\s\S]{0,160}armStingHold/);
    expect(src).toMatch(/return \(\) => \{ sound\.releaseStingHold\(\); \}/);
  });

  it('the gate releases at the slam (the done timer) and immediately on the failure path', () => {
    const src = read('../src/BootSplash.tsx');
    expect(src).toMatch(/setTimeout\(\(\) => \{ sound\.releaseStingHold\(\); setPhase\('done'\); \}, SPLASH_SLAM_MS\)/);
    expect(src).toMatch(/if \(!fired\) \{ sound\.releaseStingHold\(\); setPhase\('done'\); return; \}/);
  });

  it('the engine gate sits in syncMusic after the OFF branch, before any deck work', () => {
    const src = read('../src/audio.ts');
    const body = src.slice(src.indexOf('private syncMusic()'), src.indexOf('private deckDead'));
    expect(body).toContain('stingHold');
    expect(body.indexOf('stingHold')).toBeGreaterThan(body.indexOf('!wantsMusic(this.settings)'));
    expect(body.indexOf('stingHold')).toBeLessThan(body.indexOf('this.ensureDecks()'));
  });
});
