/**
 * @vitest-environment happy-dom
 *
 * The music context-switch contract (owner, 2026-10-30: "If the music is
 * playing while I'm in the menu it still plays in the game until the music
 * changes").
 *
 * The engine's identity lives in three mutable inputs — the context
 * (enterContext), the venue (applySoundscape → roomStyle), and the story
 * mood (setStoryStop) — but the decks used to choose tracks only at LOAD
 * moments: first start, the look-ahead fetch, the crossfade. pickNext() is
 * evaluated when a deck loads, not when the identity changes, and syncMusic
 * reconciled only power/pause/death — never track identity. So a track
 * chosen in the menus played to its natural end at the table, and the
 * look-ahead parked on the standby deck (in menu context, a second copy of
 * the menu theme) played after it. The same lag ran in every direction:
 * venue tracks rode into the menus, and a foreign look-ahead could play
 * inside The Pj's closed four-track rotation.
 *
 * The fix is a shared reconciliation (queueContextRetarget →
 * retargetToContext in audio.ts): identity mutations coalesce on a
 * microtask into ONE evaluation against the final identity; a foreign
 * standby is cleared so the next advance loads fresh; a foreign sounding
 * track crossfades out through advance() itself; an in-context track is
 * never touched. This suite drives the REAL engine through the exact call
 * sequences Table.tsx / App.tsx make and pins that contract.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// NOTE: no static import of ../src/audio — the engine module must load only
// after the fakes below are installed (the audio-watchdog harness rule), so
// TRACKS / generalPool arrive with the dynamic import in beforeAll.
let TRACKS: typeof import('../src/audio').TRACKS;
let generalPool: typeof import('../src/audio').generalPool;

/* ---------- fakes (the audio-watchdog harness set, proven against this engine) ---------- */

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

let analyserLevel = 0.02; // honest signal: the watchdog must never rebuild in this suite
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
  load(): void { this.error = null; this.networkState = 1; this.readyState = 4; }
}

/* ---------- harness ---------- */

type Sound = typeof import('../src/audio').sound;
let sound: Sound;
interface EngDeck { el: FakeAudioEl; track: number | null; url: string | null; ready: Promise<boolean> | null; gain: { gain: { value: number } } }
interface Eng { decks: EngDeck[]; active: number; advancing: boolean; fading: boolean }
const eng = () => sound as unknown as Eng;
const activeDeck = () => eng().decks[eng().active]!;
const standbyDeck = () => eng().decks[1 - eng().active]!;
const status = () => (sound as unknown as { musicStatus: string }).musicStatus;
const nowFile = () => sound.nowPlaying?.track.file ?? null;
const deckFile = (d: EngDeck) => (d.track === null ? null : TRACKS[d.track]!.file);
const XFADE_MS = 4000; // XFADE in audio.ts

const PJS = ['soul-epic', 'overreach', 'no-quit', 'busted-jazz'];
const CLASSIC_LEAN = ['windows-down', 'chillin-hard', 'glad-to-be-stuck-inside'];
const inPool = (file: string | null) => file !== null && generalPool().some((i) => TRACKS[i]!.file === file);

/** Every track the SoundDock has announced, in order (its title follows announce()). */
const announced: string[] = [];

/** Advance fake time, moving a healthy playhead the way a real element would. */
const step = async (ms: number) => {
  const d = eng().decks.length ? activeDeck() : null;
  if (d && !d.el.paused && d.el.currentTime < d.el.duration - 10) d.el.currentTime += ms / 1000;
  await vi.advanceTimersByTimeAsync(ms);
};
/** Flush the microtask queue (the coalesced retarget runs there) without moving time. */
const tick = async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); };
/** Let a crossfade fully land and the post-fade look-ahead load. */
const settleFade = async () => { await step(XFADE_MS + 500); await step(100); };

beforeAll(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 }))));
  let blobSeq = 0;
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => `blob:fake-${++blobSeq}`;
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => { /* noop */ };
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  (window as unknown as { Audio: unknown }).Audio = FakeAudioEl;
  ({ sound, TRACKS, generalPool } = await import('../src/audio'));
  sound.subscribe(() => {
    const f = sound.getSnapshot().nowPlaying?.track.file;
    if (f && announced[announced.length - 1] !== f) announced.push(f);
  });
  // The owner's setup: he has menu music ON (an explicit menu choice), so the
  // menu theme is sounding when he walks into a game.
  sound.set({ music: true, ambient: false });
  sound.enterTable();
});

/* ---------- the arc ---------- */

describe('music context switches', () => {
  it('boots in the menus with the menu theme on BOTH decks (the carry-over setup)', async () => {
    sound.wake('gesture');
    await step(1000);
    await step(5000); // the look-ahead lands too
    expect(status()).toBe('playing');
    expect(nowFile()).toBe('menu-soul');
    expect(deckFile(activeDeck())).toBe('menu-soul');
    // The standby holds a second copy of the menu theme: without a retarget,
    // entering a table would play the theme out here AND once more there.
    expect(deckFile(standbyDeck())).toBe('menu-soul');
    activeDeck().el.currentTime = 30;
  });

  it('menu → table: the menu theme crossfades out promptly, the venue opens', async () => {
    const mark = announced.length;
    sound.enterContext('game'); // Table.tsx mount effect
    sound.applySoundscape('ctx-test', undefined, 'classic', false); // Table.tsx soundscape effect
    await tick();
    // THE regression assertion: a crossfade is now running. Before the fix,
    // nothing was advancing and menu-soul simply played on.
    expect(eng().advancing).toBe(true);
    await settleFade();
    // The venue's own signature (its armed lean) opened the session…
    expect(CLASSIC_LEAN).toContain(nowFile());
    expect(nowFile()).not.toBe('menu-soul');
    // …and nothing foreign is parked on the standby deck.
    expect(deckFile(standbyDeck())).not.toBe('menu-soul');
    expect(inPool(deckFile(standbyDeck())) || deckFile(standbyDeck()) === null).toBe(true);
    expect(announced.slice(mark)).not.toContain('menu-soul');
    expect(sound.playingDeckCount()).toBe(1);
    activeDeck().el.currentTime = 30;
  });

  it('re-entering the same context with an in-context track is a no-op (no restart)', async () => {
    const before = { active: eng().active, file: nowFile(), at: activeDeck().el.currentTime };
    sound.enterContext('game');
    sound.applySoundscape('ctx-test', undefined, 'classic', false); // the effect re-runs (seed/access change)
    await tick();
    await step(300);
    expect(eng().advancing).toBe(false);
    expect(eng().active).toBe(before.active);
    expect(nowFile()).toBe(before.file);
    expect(activeDeck().el.currentTime).toBeGreaterThanOrEqual(before.at); // never rewound
  });

  it("menu → The Pj's: the first in-game pick comes from the closed rotation, and the rotation stays pure", async () => {
    // Back to the menus first (Table cleanup), let the menu theme take over.
    sound.enterContext('menu');
    await tick();
    await settleFade();
    expect(nowFile()).toBe('menu-soul');
    // Into the Pj's.
    const mark = announced.length;
    sound.enterContext('game');
    sound.applySoundscape('ctx-test', undefined, 'blockAfterDark', false);
    await tick();
    expect(eng().advancing).toBe(true);
    await settleFade();
    expect(PJS).toContain(nowFile());
    // The look-ahead inside the closed rotation is one of the four — no
    // foreign track is parked to play next.
    expect(PJS.includes(deckFile(standbyDeck()) ?? '') || deckFile(standbyDeck()) === null).toBe(true);
    // Play the rotation forward: the next track is also one of the four,
    // and never an immediate repeat.
    const first = nowFile();
    activeDeck().el.currentTime = activeDeck().el.duration - 1;
    activeDeck().el.fire('timeupdate');
    await settleFade();
    expect(PJS).toContain(nowFile());
    expect(nowFile()).not.toBe(first);
    expect(announced.slice(mark).every((f) => PJS.includes(f))).toBe(true);
    expect(sound.playingDeckCount()).toBe(1);
    activeDeck().el.currentTime = 30;
  });

  it("The Pj's → menu: the venue track does not ride into the menus", async () => {
    sound.enterContext('menu'); // Table.tsx unmount cleanup
    await tick();
    expect(eng().advancing).toBe(true);
    await settleFade();
    expect(nowFile()).toBe('menu-soul');
    await step(100);
    expect(deckFile(standbyDeck()) === 'menu-soul' || deckFile(standbyDeck()) === null).toBe(true);
    activeDeck().el.currentTime = 30;
  });

  it('re-entering the menu with the menu theme playing is a no-op', async () => {
    const before = { active: eng().active, at: activeDeck().el.currentTime };
    sound.enterContext('menu');
    await tick();
    await step(300);
    expect(eng().advancing).toBe(false);
    expect(eng().active).toBe(before.active);
    expect(nowFile()).toBe('menu-soul');
    expect(activeDeck().el.currentTime).toBeGreaterThanOrEqual(before.at);
  });

  it('a same-tick venue → venue hop collapses to one switch (no menu-theme detour)', async () => {
    // Sit at a classic table first.
    sound.enterContext('game');
    sound.applySoundscape('ctx-test', undefined, 'classic', false);
    await tick();
    await settleFade();
    expect(inPool(nowFile())).toBe(true);
    activeDeck().el.currentTime = 30;
    // The hop: old Table cleanup + new Table mount land in ONE commit.
    const mark = announced.length;
    sound.enterContext('menu');
    sound.enterContext('game');
    sound.applySoundscape('ctx-test', undefined, 'blockAfterDark', false);
    await tick();
    await settleFade();
    expect(PJS).toContain(nowFile());
    // The menu theme was never announced during the hop: the burst coalesced.
    expect(announced.slice(mark)).not.toContain('menu-soul');
    expect(eng().advancing).toBe(false);
    expect(eng().fading).toBe(false);
    expect(sound.playingDeckCount()).toBe(1);
    activeDeck().el.currentTime = 30;
  });

  it('rapid switches mid-crossfade do not wedge the decks', async () => {
    // Start a switch to the menus; the crossfade begins…
    sound.enterContext('menu');
    await tick();
    expect(eng().advancing).toBe(true);
    // …and mid-fade the player bounces straight into a classic table. The
    // reconciliation must defer to the landing fade, not fight it.
    await step(100);
    sound.enterContext('game');
    sound.applySoundscape('ctx-test', undefined, 'classic', false);
    await tick();
    // Let everything land: fade 1, the deferred re-check, fade 2, look-aheads.
    for (let i = 0; i < 6; i++) await step(2000);
    expect(eng().advancing).toBe(false);
    expect(eng().fading).toBe(false);
    expect(status()).toBe('playing');
    expect(sound.playingDeckCount()).toBe(1);
    // The LAST identity wins: a classic-context track, not the menu theme
    // the first fade was heading for, and no story score.
    expect(nowFile()).not.toBe('menu-soul');
    expect(inPool(nowFile())).toBe(true);
    activeDeck().el.currentTime = 30;
  });

  it('story mood changes still retarget promptly, and leaving the stop releases the score', async () => {
    sound.setStoryStop('king'); // Table.tsx story effect
    await tick();
    expect(eng().advancing).toBe(true);
    await settleFade();
    expect(nowFile()).toBe('story-king');
    activeDeck().el.currentTime = 30;
    sound.setStoryStop(null);
    await tick();
    await settleFade();
    expect(nowFile()).not.toBe('story-king');
    expect(inPool(nowFile())).toBe(true);
    activeDeck().el.currentTime = 30;
  });

  it('the wiring pin: every identity mutation funnels into the shared retarget', () => {
    const candidates = [join(process.cwd(), 'apps/web/src/audio.ts'), join(process.cwd(), 'src/audio.ts')];
    const src = readFileSync(candidates.find((p) => existsSync(p))!, 'utf8');
    const enter = src.slice(src.indexOf('enterContext(ctx'), src.indexOf('enterContext(ctx') + 1400);
    expect(enter).toContain('this.queueContextRetarget()');
    const scape = src.slice(src.indexOf('applySoundscape(seed'), src.indexOf('applySoundscape(seed') + 1400);
    expect(scape).toContain('this.queueContextRetarget()');
    const stop = src.slice(src.indexOf('setStoryStop(stopId'), src.indexOf('setStoryStop(stopId') + 700);
    expect(stop).toContain('this.queueContextRetarget()');
  });
});
