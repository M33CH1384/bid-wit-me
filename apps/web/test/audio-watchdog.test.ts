/**
 * @vitest-environment happy-dom
 *
 * The dropout watchdog contract (owner's third report of the family,
 * 2026-10-30: "if I switch away from the app or sometimes for no reason at
 * all it stops. Sometimes I can click the audio button and it comes back
 * but most times it never does").
 *
 * The 2026-10-21/23 heals reconciled STATE — context state, playing flags,
 * sync coverage — and audio-resume.test.ts + audio-heal-slots.test.ts pin
 * that they work (suspend → resume, interruption → rebuild). The recurrence
 * lived in the gap between state and OUTCOME, reproduced in a real browser
 * against the production engine:
 *
 *  - an element silently paused under a 'playing' status: no state moves,
 *    the heal timer never arms (it watches ctx.state only);
 *  - a deck element whose resource died: play() flips paused=false with
 *    readyState 0 — a phantom 'playing' that even the tap cannot fix,
 *    because the tap ran the same flag syncs;
 *  - a crossfade whose look-ahead fetch never settles (connection reaped
 *    while backgrounded): advancing/fading latch, the playing track ends
 *    under the latched fade, and the wedge is permanent;
 *  - a graph rendering into silence with the context reporting 'running'
 *    (interruption residue / audio-route change): every flag healthy,
 *    nothing sounding, no recovery path at all.
 *
 * This suite drives the REAL Engine on a fake context + fake media
 * elements and pins the watchdog contract: stems are verified against
 * ground truth on a tick and healed without a tap; the graph is verified
 * against the master meter and escalates to a rebuild; a wake (the
 * speaker tap) verifies outcomes too, so the button is a guaranteed
 * recovery; and honest quiet (meter above digital silence) never
 * triggers a rebuild.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/* ---------- fakes ---------- */

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

/** What the master meter hears. 0 = digital silence; 0.02 = honest signal. */
let analyserLevel = 0.02;
class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  getFloatTimeDomainData(buf: Float32Array): void { buf.fill(analyserLevel); }
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
  load(): void {
    // A load() on a fresh src is how a real element LEAVES the no-source
    // state: the error clears and the network state recovers. (Pinning
    // networkState at 3 forever made every later deckDead() read true —
    // a harness artifact, not engine behavior.)
    this.error = null;
    this.networkState = 1;
    this.readyState = 4;
  }
}

/* ---------- harness state ---------- */

type Sound = typeof import('../src/audio').sound;
let sound: Sound;
interface EngDeck { el: FakeAudioEl; track: number | null; url: string | null; ready: Promise<boolean> | null; gain: { gain: { value: number } } }
interface Eng {
  decks: EngDeck[]; active: number; advancing: boolean; fading: boolean;
  venueNodes: unknown[]; buffers: Map<string, unknown>;
}
const eng = () => sound as unknown as Eng;
const activeDeck = () => eng().decks[eng().active]!;
const status = () => (sound as unknown as { musicStatus: string }).musicStatus;

let musicFetches = 0;
let hangNextMusicFetch = false;
let blobSeq = 0;

/** Advance fake time, moving a healthy playhead the way a real element would. */
const step = async (ms: number) => {
  const d = eng().decks.length ? activeDeck() : null;
  if (d && !d.el.paused && d.el.currentTime < d.el.duration - 10) d.el.currentTime += ms / 1000;
  await vi.advanceTimersByTimeAsync(ms);
};

beforeAll(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn((url: string, opts?: { signal?: AbortSignal }) => {
    if (String(url).includes('/audio/music/')) {
      musicFetches++;
      if (hangNextMusicFetch) {
        hangNextMusicFetch = false;
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
    }
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 }));
  }));
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => `blob:fake-${++blobSeq}`;
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => { /* noop */ };
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  (window as unknown as { Audio: unknown }).Audio = FakeAudioEl;
  ({ sound } = await import('../src/audio'));
  sound.set({ music: true, ambient: false });
  sound.enterTable();
});

/* ---------- the arc ---------- */

describe('the dropout watchdog', () => {
  it('unlock starts music on a healthy deck', async () => {
    sound.wake('gesture');
    await step(1000);
    await step(5000); // the look-ahead load lands too
    expect(status()).toBe('playing');
    expect(sound.playingDeckCount()).toBe(1);
    expect(activeDeck().el.paused).toBe(false);
    activeDeck().el.currentTime = 30; // mid-track
  });

  it('a silently paused deck self-heals on the watchdog — no wake, no tap', async () => {
    const ctxCount = FakeCtx.instances.length;
    activeDeck().el.paused = true; // the OS paused it; no event, ctx still 'running'
    expect(sound.needsRestore).toBe(false); // the ctx-state heal cannot see this
    await vi.advanceTimersByTimeAsync(2000); // tick 1: hysteresis
    expect(activeDeck().el.paused).toBe(true);
    await vi.advanceTimersByTimeAsync(2000); // tick 2: re-sync revives it
    expect(activeDeck().el.paused).toBe(false);
    expect(FakeCtx.instances.length).toBe(ctxCount); // a stem fault, fixed at stem level
  });

  it('a resource-dead deck is reloaded for real, not phantom-played', async () => {
    const deck = activeDeck();
    const fetchesBefore = musicFetches;
    deck.el.src = ''; // the resource is gone…
    deck.el.networkState = 3; // …NETWORK_NO_SOURCE…
    deck.el.paused = true; // …and it stopped
    await vi.advanceTimersByTimeAsync(2000); // one tick: death is unambiguous, no hysteresis
    await vi.advanceTimersByTimeAsync(10);
    expect(musicFetches).toBeGreaterThan(fetchesBefore); // the track was fetched again
    expect(deck.el.src).toMatch(/^blob:fake-/); // a live source is back
    expect(deck.el.paused).toBe(false);
    expect(status()).toBe('playing');
    deck.el.currentTime = 30;
  });

  it('a deck whose playhead froze mid-track is reloaded', async () => {
    const deck = activeDeck();
    const fetchesBefore = musicFetches;
    // paused stays false, the status stays 'playing' — but the position
    // never moves again (raw advances: the step helper must NOT move it).
    // The tracker records the position on one tick, then needs two frozen
    // readings before it believes the freeze.
    await vi.advanceTimersByTimeAsync(2000); // position recorded
    await vi.advanceTimersByTimeAsync(2000); // frozen reading 1
    await vi.advanceTimersByTimeAsync(2000); // frozen reading 2 → reload
    await vi.advanceTimersByTimeAsync(10);
    expect(musicFetches).toBeGreaterThan(fetchesBefore);
    expect(deck.el.currentTime).toBe(0); // restarted from the top by the reload
    expect(deck.el.paused).toBe(false);
    deck.el.currentTime = 30;
  });

  it('digital silence at the master meter escalates to a context rebuild', async () => {
    const ctxCount = FakeCtx.instances.length;
    analyserLevel = 0; // the graph now renders into silence; every flag still says playing
    await step(2000); // silence tick 1 (playhead honestly advancing)
    await step(2000); // silence tick 2
    expect(FakeCtx.instances.length).toBe(ctxCount); // hysteresis: no hair-trigger rebuild
    await step(2000); // silence tick 3 → rebuild
    expect(FakeCtx.instances.length).toBe(ctxCount + 1);
    analyserLevel = 0.02;
    await step(1500); // the rebuild re-syncs and the music restarts on the new graph
    expect(sound.playingDeckCount()).toBe(1);
    expect(status()).toBe('playing');
    activeDeck().el.currentTime = 30;
  });

  it('honest signal never triggers a rebuild, however long it plays', async () => {
    const ctxCount = FakeCtx.instances.length;
    analyserLevel = 0.02; // quiet but alive — dither, room tone, a soft passage
    for (let i = 0; i < 5; i++) await step(2000);
    expect(FakeCtx.instances.length).toBe(ctxCount);
    expect(sound.playingDeckCount()).toBe(1);
  });

  it('the wake behind the speaker button guarantees recovery', async () => {
    // Stem case: a paused deck revives on the wake's own syncs, no rebuild.
    const ctxCount = FakeCtx.instances.length;
    activeDeck().el.paused = true;
    sound.wake('gesture');
    expect(activeDeck().el.paused).toBe(false);
    expect(FakeCtx.instances.length).toBe(ctxCount);
    activeDeck().el.currentTime = 30;
    // Graph case: the wake's outcome verification escalates to a rebuild.
    analyserLevel = 0;
    sound.wake('gesture');
    await step(800); // first silence reading arms the confirmation
    expect(FakeCtx.instances.length).toBe(ctxCount);
    await step(800); // second reading confirms → rebuild
    expect(FakeCtx.instances.length).toBe(ctxCount + 1);
    analyserLevel = 0.02;
    await step(1500);
    expect(sound.playingDeckCount()).toBe(1);
    activeDeck().el.currentTime = 30;
  });

  it('a track fetch that never settles cannot wedge the crossfade', async () => {
    const from = activeDeck();
    const other = eng().decks[1 - eng().active]!;
    // Force the look-ahead unloaded, as when the page was frozen past its load.
    other.track = null; other.ready = null; other.url = null; other.el.src = '';
    hangNextMusicFetch = true;
    from.el.currentTime = from.el.duration - 2;
    from.el.fire('timeupdate'); // the crossfade begins; its fetch hangs
    await vi.advanceTimersByTimeAsync(1000);
    expect(eng().advancing).toBe(true); // latched on the unsettled fetch…
    expect(eng().fading).toBe(true);
    await vi.advanceTimersByTimeAsync(20000); // …until the fetch timeout fails it like any load error
    await vi.advanceTimersByTimeAsync(4500); // the retry crossfades; the fade window closes
    expect(eng().advancing).toBe(false);
    expect(eng().fading).toBe(false);
    expect(sound.playingDeckCount()).toBe(1);
    expect(status()).toBe('playing');
    activeDeck().el.currentTime = 30;
  });

  it('an SFX set with a hole is completed by the watchdog retry', async () => {
    expect(sound.loaded).toBe(17); // the full FILES set (deuce-thump + trump-cut joined it, 2026-10-30)
    eng().buffers.delete('pop'); // a fetch failed during first load; the hole used to be permanent
    expect(sound.loaded).toBe(16);
    await step(2000); // one tick: the loader re-runs (its in-flight marker now clears on settle)
    await vi.advanceTimersByTimeAsync(10);
    expect(sound.loaded).toBe(17);
  });

  it('a venue bed that loses its nodes is rebuilt', async () => {
    sound.set({ on: true, venueSound: true });
    sound.setVenueBed('street');
    sound.wake('gesture');
    await step(500);
    expect(sound.venueBedNow).toBe('street');
    expect(eng().venueNodes.length).toBeGreaterThan(0);
    eng().venueNodes = []; // the bed's sources died with the route change; the flag still claims 'street'
    await vi.advanceTimersByTimeAsync(2000);
    expect(eng().venueNodes.length).toBeGreaterThan(0);
    expect(sound.venueBedNow).toBe('street');
  });

  it('the coverage pin: every stem has a heal path, and the wake verifies outcomes', () => {
    // (Path resolved from cwd: this suite runs in happy-dom, whose URL
    // class mangles import.meta.url — the repo runs tests from the root,
    // the app package from apps/web; both layouts are covered.)
    const candidates = [join(process.cwd(), 'apps/web/src/audio.ts'), join(process.cwd(), 'src/audio.ts')];
    const srcPath = candidates.find((p) => existsSync(p))!;
    const src = readFileSync(srcPath, 'utf8');
    // resyncAll still covers the three classic stems.
    const resync = src.slice(src.indexOf('private resyncAll()'), src.indexOf('private resyncAll()') + 300);
    for (const sync of ['syncAmbient', 'syncVenue', 'syncMusic']) expect(resync).toContain(sync);
    // The watchdog — the heal that runs without a wake — reaches every stem
    // that exists today. A future stem added without a line here fails CI,
    // not the owner's ear.
    const tick = src.slice(src.indexOf('private watchdogTick()'), src.indexOf('private watchdogTick()') + 5000);
    for (const heal of ['restartDeck', 'syncMusic', 'syncVenue', 'syncAmbient', 'this.load()', 'escalateGraph']) {
      expect(tick).toContain(heal);
    }
    // The wake arms the watchdog and the outcome verification, and the deck
    // fetch carries its timeout.
    expect(src).toContain('this.startWatchdog()');
    expect(src).toContain('this.armVerify()');
    expect(src).toContain('MUSIC_FETCH_TIMEOUT_MS');
  });
});
