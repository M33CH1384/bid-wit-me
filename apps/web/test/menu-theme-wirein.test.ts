/**
 * @vitest-environment happy-dom
 *
 * MENU THEME + BENDS WIRE-IN (owner, 2026-11-05: "Wire it").
 *
 * The menus were silent since the morning's retirement ("Come On In"
 * scrapped — dry because mono through a chain with no space in it).
 * The replacement theme is "Eat" (HoliznaCC0, CC0) with the owner's T1
 * "Deeper" tweak baked into the shipped file, appended to the catalog
 * (TRACKS is append-only — host-music beat stamps are raw indices) and
 * fenced menuOnly like its predecessor: the menu branch of pickNext
 * names it specifically, the general pool never draws it, and no other
 * context can pick it.
 *
 * The theme never plays dry: a menu-gated insert in the shared music
 * chain gives it a room (the wet palette's LIGHT depth — a synthetic
 * generated impulse, ~1.6 s RT60 at ~12% wet on the neutral), and the
 * owner's cross-game streak bends that room + tone while he sits in
 * the menus (MENU ONLY — the table half of the streak design was
 * scoped out by the owner):
 *   win streak ≥ 3  → ON FIRE  (presence shelf pair + short bright tail)
 *   loss streak ≥ 3 → ICE COLD (2.8 kHz lowpass + long dark tail)
 *   larger run wins; tie / guest / signed-out → NEUTRAL.
 * The insert is gated to menu context: at a table or in a story scene
 * it holds its bypass values (shelves flat, lowpass open, send at
 * zero), so table and story music keep their exact prior behaviour on
 * the shared chain. Bends morph with short ramps and an IR crossfade —
 * the loop itself never cuts or restarts — and only move when the
 * state changes. Music OFF outranks everything: OFF in the menus is
 * silence, bends or no bends, and turning it back on resumes the theme
 * (a paused IN-context deck is resumed, never reloaded).
 *
 * One neighbour contract rides along: a deck left PAUSED holding a
 * foreign track (music switched off in one context, the player walks
 * to another before switching it back on) must never be resumed into
 * the new context — trackInContext is the deck-identity authority, so
 * syncMusic clears the foreign deck and takes the ordinary first
 * start instead.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { menuMusicBend, type HomeStreak } from '../src/streakFire';
// NOTE: no static import of ../src/audio — the engine module must load only
// after the fakes below are installed (the audio-watchdog harness rule), so
// TRACKS / generalPool / the bend machinery arrive with the dynamic import
// in beforeAll.
let TRACKS: typeof import('../src/audio').TRACKS;
let generalPool: typeof import('../src/audio').generalPool;
let MENU_BEND_TARGETS: typeof import('../src/audio').MENU_BEND_TARGETS;
let menuIrChannels: typeof import('../src/audio').menuIrChannels;

/* ---------- fakes (the audio-watchdog harness set, proven against this engine) ---------- */

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
interface EngDeck { el: FakeAudioEl; track: number | null; url: string | null; ready: Promise<boolean> | null; gain: { gain: FakeParam } }
interface Eng {
  decks: EngDeck[]; active: number; advancing: boolean;
  menuLow: FakeNode | null; menuHigh: FakeNode | null; menuLp: FakeNode | null;
  menuSend: FakeNode | null; menuVerb: FakeNode | null; menuWetLp: FakeNode | null;
  menuBendState: string; menuIrKind: string | null;
  pickNext: () => number;
  setMenuStreakBend: (b: 'neutral' | 'fire' | 'cold') => void;
}
const eng = () => sound as unknown as Eng;
const activeDeck = () => eng().decks[eng().active]!;
const standbyDeck = () => eng().decks[1 - eng().active]!;
const status = () => (sound as unknown as { musicStatus: string }).musicStatus;
const nowFile = () => sound.nowPlaying?.track.file ?? null;
const deckFile = (d: EngDeck) => (d.track === null ? null : TRACKS[d.track]!.file);
const inPool = (file: string | null) => file !== null && generalPool().some((i) => TRACKS[i]!.file === file);
const XFADE_MS = 4000;

const fetches = new Map<string, number>();
const fetchCount = (file: string) => fetches.get(file) ?? 0;

const step = async (ms: number) => {
  const d = eng().decks.length ? activeDeck() : null;
  if (d && !d.el.paused && d.el.currentTime < d.el.duration - 10) d.el.currentTime += ms / 1000;
  await vi.advanceTimersByTimeAsync(ms);
};
const tick = async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); };
const settleFade = async () => { await step(XFADE_MS + 500); await step(100); };

const hs = (streak: number, lossStreak: number): HomeStreak => ({
  streak, kind: streak > 0 ? 'team' : null, best: streak,
  lossStreak, lossKind: lossStreak > 0 ? 'team' : null,
});

beforeAll(async () => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const m = String(url).match(/\/audio\/music\/([^/]+)\.mp3/);
    if (m) fetches.set(m[1]!, (fetches.get(m[1]!) ?? 0) + 1);
    return Promise.resolve(new Response(new Uint8Array([1, 2, 3]).buffer as ArrayBuffer, { status: 200 }));
  }));
  let blobSeq = 0;
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => `blob:fake-${++blobSeq}`;
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => { /* noop */ };
  (window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx;
  (window as unknown as { Audio: unknown }).Audio = FakeAudioEl;
  ({ sound, TRACKS, generalPool, MENU_BEND_TARGETS, menuIrChannels } = await import('../src/audio'));
  sound.set({ music: true, ambient: false });
  sound.enterTable();
});

/* ---------- the streak derivation (pure) ---------- */

describe('streak derivation (streakFire payload → menu bend)', () => {
  it('guest / signed-out (no payload) is neutral', () => {
    expect(menuMusicBend(null)).toBe('neutral');
  });
  it('below the thresholds is neutral, on either side', () => {
    expect(menuMusicBend(hs(0, 0))).toBe('neutral');
    expect(menuMusicBend(hs(2, 0))).toBe('neutral');
    expect(menuMusicBend(hs(0, 2))).toBe('neutral');
    expect(menuMusicBend(hs(2, 2))).toBe('neutral');
  });
  it('win streak ≥ 3 is fire, loss streak ≥ 3 is cold', () => {
    expect(menuMusicBend(hs(3, 0))).toBe('fire');
    expect(menuMusicBend(hs(9, 1))).toBe('fire');
    expect(menuMusicBend(hs(0, 3))).toBe('cold');
    expect(menuMusicBend(hs(1, 6))).toBe('cold');
  });
  it('the larger run wins; a tie is neutral', () => {
    expect(menuMusicBend(hs(5, 3))).toBe('fire');
    expect(menuMusicBend(hs(3, 5))).toBe('cold');
    expect(menuMusicBend(hs(3, 3))).toBe('neutral');
    expect(menuMusicBend(hs(7, 7))).toBe('neutral');
  });
});

/* ---------- the catalog + picker ---------- */

describe('the Eat catalog entry', () => {
  it('is appended last, menuOnly, CC0 — and ships as a file', () => {
    const eat = TRACKS.find((t) => t.file === 'eat')!;
    expect(eat).toBeTruthy();
    expect(TRACKS[TRACKS.length - 1]!.file).toBe('eat'); // append-only: no slot is reused or renumbered
    expect(eat.menuOnly).toBe(true);
    expect(eat.license).toBe('CC0 1.0');
    expect(eat.artist).toBe('HoliznaCC0');
    expect(eat.credit).toBeUndefined(); // CC0 needs no attribution line
    // (cwd candidates, not import.meta.url: under happy-dom the module
    // URL loses the filesystem root — the context-switch wiring pin's
    // pattern.)
    const candidates = [join(process.cwd(), 'apps/web/public/audio/music/eat.mp3'), join(process.cwd(), 'public/audio/music/eat.mp3')];
    expect(candidates.some((p) => existsSync(p))).toBe(true);
  });
  it('never enters the general pool; the retired theme stays unpickable beside it', () => {
    const files = generalPool().map((i) => TRACKS[i]!.file);
    expect(generalPool().length).toBe(76);
    expect(files).not.toContain('eat');
    expect(files).not.toContain('menu-soul');
  });
  it("pickNext's menu branch names Eat, every pick", () => {
    const eatIdx = TRACKS.findIndex((t) => t.file === 'eat');
    for (let i = 0; i < 3; i++) expect(eng().pickNext()).toBe(eatIdx);
  });
});

/* ---------- the bend recipes, as data ---------- */

describe('bend targets (the approved recipes, as data)', () => {
  it('neutral is the LIGHT room: ~1.6 s tail at ~12% wet, tone untouched', () => {
    expect(MENU_BEND_TARGETS.neutral.rt60).toBe(1.6);
    expect(MENU_BEND_TARGETS.neutral.send).toBe(0.12);
    expect(MENU_BEND_TARGETS.neutral.lowDb).toBe(0);
    expect(MENU_BEND_TARGETS.neutral.highDb).toBe(0);
    expect(MENU_BEND_TARGETS.neutral.lpHz).toBeGreaterThan(10000);
  });
  it('fire is the presence pair + a short bright tail', () => {
    expect(MENU_BEND_TARGETS.fire.lowDb).toBe(1);
    expect(MENU_BEND_TARGETS.fire.highDb).toBe(2.5);
    expect(MENU_BEND_TARGETS.fire.rt60).toBe(1.2);
    expect(MENU_BEND_TARGETS.fire.send).toBe(0.35);
    expect(MENU_BEND_TARGETS.fire.preDelayMs).toBe(18);
  });
  it('cold is the 2.8 kHz lowpass + a long dark tail', () => {
    expect(MENU_BEND_TARGETS.cold.lpHz).toBe(2800);
    expect(MENU_BEND_TARGETS.cold.wetLpHz).toBe(2200);
    expect(MENU_BEND_TARGETS.cold.rt60).toBe(2.6);
    expect(MENU_BEND_TARGETS.cold.send).toBe(0.6);
  });
  it('the generated impulses are deterministic, unit-energy, and shaped per recipe', () => {
    const sr = 48000;
    const n = menuIrChannels('neutral', sr);
    expect(n[0].length).toBeGreaterThan(1.6 * sr);
    expect(n[0].length).toBeLessThan(1.8 * sr);
    let energy = 0;
    for (const ch of n) for (const v of ch) energy += v * v;
    expect(Math.abs(energy - 1)).toBeLessThan(0.02);
    const rms = (ch: Float32Array, a: number, b: number) => {
      let s = 0; for (let i = a; i < b; i++) s += ch[i]! * ch[i]!;
      return Math.sqrt(s / (b - a));
    };
    expect(rms(n[0], n[0].length - 2000, n[0].length)).toBeLessThan(rms(n[0], 0, 2000) * 0.2);
    const f = menuIrChannels('fire', sr);
    let preMax = 0;
    for (let i = 0; i < 800; i++) preMax = Math.max(preMax, Math.abs(f[0][i]!), Math.abs(f[1][i]!));
    expect(preMax).toBe(0); // the 18 ms pre-delay is baked into the impulse head
    const c1 = menuIrChannels('cold', sr);
    const c2 = menuIrChannels('cold', sr);
    expect(c1[0].length).toBeGreaterThan(f[0].length);
    expect(c1[0][5000]).toBe(c2[0][5000]);
    expect(c1[1][90000]).toBe(c2[1][90000]);
  });
});

/* ---------- the live arc ---------- */

describe('the menu theme, live', () => {
  it('boots in the menus into Eat, wearing the neutral room', async () => {
    sound.wake('gesture');
    await step(1000);
    expect(status()).toBe('playing');
    expect(nowFile()).toBe('eat');
    expect(deckFile(activeDeck())).toBe('eat');
    expect(fetchCount('eat')).toBeGreaterThanOrEqual(1);
    // the neutral's room: LIGHT send up, tone flat, lowpass open, impulse loaded
    expect(eng().menuIrKind).toBe('neutral');
    expect(eng().menuVerb!.buffer).not.toBeNull();
    expect(eng().menuSend!.gain.value).toBeCloseTo(0.12, 5);
    expect(eng().menuLow!.gain.value).toBe(0);
    expect(eng().menuHigh!.gain.value).toBe(0);
    expect(eng().menuLp!.frequency.value).toBeGreaterThan(10000);
    activeDeck().el.currentTime = 30;
  });

  it('ON FIRE morphs the chain — shelves in, bright tail swapped — the loop never restarts', async () => {
    const fetchesBefore = fetchCount('eat');
    const deckBefore = activeDeck();
    eng().setMenuStreakBend('fire');
    // the tone moves at once, with ramps; the tail crossfades (send dips first)
    expect(eng().menuLow!.gain.value).toBe(1);
    expect(eng().menuHigh!.gain.value).toBe(2.5);
    expect(eng().menuSend!.gain.calls).toContain('target:0');
    expect(eng().advancing).toBe(false);
    await step(700);
    expect(eng().menuIrKind).toBe('fire');
    expect(eng().menuSend!.gain.value).toBeCloseTo(0.35, 5);
    // the same deck, the same track, still playing — no reload, no restart
    expect(activeDeck()).toBe(deckBefore);
    expect(deckFile(activeDeck())).toBe('eat');
    expect(fetchCount('eat')).toBe(fetchesBefore);
    expect(status()).toBe('playing');
    expect(sound.playingDeckCount()).toBe(1);
  });

  it('ICE COLD morphs the chain — 2.8 kHz lowpass, dark tail — the loop never restarts', async () => {
    const fetchesBefore = fetchCount('eat');
    eng().setMenuStreakBend('cold');
    expect(eng().menuLp!.frequency.value).toBe(2800);
    expect(eng().menuWetLp!.frequency.value).toBe(2200);
    expect(eng().menuLow!.gain.value).toBe(0);
    expect(eng().menuHigh!.gain.value).toBe(0);
    await step(700);
    expect(eng().menuIrKind).toBe('cold');
    expect(eng().menuSend!.gain.value).toBeCloseTo(0.6, 5);
    expect(deckFile(activeDeck())).toBe('eat');
    expect(fetchCount('eat')).toBe(fetchesBefore);
    expect(status()).toBe('playing');
  });

  it('back to NEUTRAL restores the light room; repeating the same state is a no-op', async () => {
    eng().setMenuStreakBend('neutral');
    expect(eng().menuLp!.frequency.value).toBeGreaterThan(10000);
    await step(700);
    expect(eng().menuIrKind).toBe('neutral');
    expect(eng().menuSend!.gain.value).toBeCloseTo(0.12, 5);
    const sendCalls = eng().menuSend!.gain.calls.length;
    const lpCalls = eng().menuLp!.frequency.calls.length;
    eng().setMenuStreakBend('neutral'); // no state change → no ramps, no morph
    await step(300);
    expect(eng().menuSend!.gain.calls.length).toBe(sendCalls);
    expect(eng().menuLp!.frequency.calls.length).toBe(lpCalls);
  });

  it('music OFF outranks an armed bend — and ON resumes the theme in place', async () => {
    eng().setMenuStreakBend('cold');
    await step(700);
    expect(eng().menuSend!.gain.value).toBeCloseTo(0.6, 5);
    const fetchesBefore = fetchCount('eat');
    sound.set({ music: false });
    await step(1600); // the OFF fade + pause settle
    expect(status()).toBe('off');
    expect(sound.playingDeckCount()).toBe(0);
    sound.set({ music: true });
    await step(400);
    expect(status()).toBe('playing');
    expect(nowFile()).toBe('eat');
    // resumed, not reloaded: the paused in-context deck was never cleared
    expect(fetchCount('eat')).toBe(fetchesBefore);
    expect(eng().menuSend!.gain.value).toBeCloseTo(0.6, 5); // the bend survives the toggle
  });

  it('at a table the insert sits at bypass — even with a bend armed — and the table track is a pool draw', async () => {
    sound.enterContext('game');
    sound.applySoundscape('wirein-test', undefined, 'classic', false);
    await tick();
    expect(eng().menuBendState).toBe('cold'); // the state is kept…
    expect(eng().menuSend!.gain.value).toBe(0); // …but the gate is contextual
    expect(eng().menuLow!.gain.value).toBe(0);
    expect(eng().menuHigh!.gain.value).toBe(0);
    expect(eng().menuLp!.frequency.value).toBeGreaterThan(10000);
    await step(700); // no stale morph may raise the send at a table
    expect(eng().menuSend!.gain.value).toBe(0);
    await settleFade();
    await settleFade();
    expect(inPool(nowFile())).toBe(true);
    expect(nowFile()).not.toBe('eat');
    expect(sound.playingDeckCount()).toBe(1);
    activeDeck().el.currentTime = 30;
  });

  it('returning to the menus re-applies the armed bend over the theme', async () => {
    sound.enterContext('menu');
    await tick();
    expect(eng().menuLp!.frequency.value).toBe(2800);
    await settleFade();
    expect(nowFile()).toBe('eat');
    await step(700);
    expect(eng().menuIrKind).toBe('cold');
    expect(eng().menuSend!.gain.value).toBeCloseTo(0.6, 5);
    activeDeck().el.currentTime = 30;
  });

  it('a foreign track left paused by OFF is never resumed into a new context', async () => {
    sound.set({ music: false });
    await step(1600);
    expect(status()).toBe('off');
    expect(deckFile(activeDeck())).toBe('eat'); // still loaded, paused — the trap state
    sound.enterContext('game');
    sound.applySoundscape('wirein-test', undefined, 'classic', false);
    await tick();
    sound.set({ music: true });
    await step(1000);
    await settleFade();
    // the first start in the new context draws from ITS pool — Eat never sounds here
    expect(status()).toBe('playing');
    expect(inPool(nowFile())).toBe(true);
    expect(deckFile(activeDeck())).not.toBe('eat');
    expect(deckFile(standbyDeck())).not.toBe('eat');
    expect(sound.playingDeckCount()).toBe(1);
  });
});
