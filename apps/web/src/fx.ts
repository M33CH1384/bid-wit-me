/**
 * Hype effects bus: joker rumbles, the Big-over-Little nuke, streak / shot pop-ups.
 * Effects are derived from game state on every client (offline, and online from the server state each player
 * receives), so everyone at a table sees and hears the same moments. Card landings fire the joker cues
 * (see Card3D → fireCue) so the rumble hits exactly when the card hits the felt.
 * "Reduce effects" (an explicit opt-in in Settings) keeps the sounds and pop-ups but drops shake / flash and calms the nuke.
 * The OS "Reduce motion" setting is NOT treated as Reduce effects: it only drops camera shake / the white flash
 * (see `osReducedMotion`) — the 3D explosion still plays. (Before v0.3.2 it silently switched the nuke to Off.)
 */
import { useSyncExternalStore } from 'react';
import { HYPE_SETTLE_MAX_MS } from '@spades/protocol';
import { type Sfx, sound } from './audio';

/** How long each effect stays on screen (ms): the hand-end hold waits these out. wheelsCar is released by the car itself. */
const FX_HOLD_MS: Partial<Record<FxKind, number>> = {
  streak: 2300, shot: 2000, gotShot: 1900, wheels: 1900, ranIt: 2700, hustled: 2000, overcut: 1700,
  jokerBig: 1100, jokerLittle: 500, nuke: 3700, wheelsCar: 3000,
};

export type FxKind = 'jokerLittle' | 'jokerBig' | 'nuke' | 'streak' | 'shot' | 'gotShot' | 'wheels' | 'wheelsCar' | 'overcut' | 'hustled' | 'ranIt';
export interface FxEvent { id: number; kind: FxKind; at: number; level?: number; text?: string; sub?: string }

const KEY = 'bwm.fx';
/** Table setting for the nuke: full (3D blast + table/hand/HUD blown away and reset), classic (3D blast only), off (banner + boom). Offline it's saved locally; online the host's choice (room) wins. */
export type NukeIntensity = 'full' | 'classic' | 'off';
interface FxPrefs { reduce: boolean; nuke: NukeIntensity }
function loadPrefs(): FxPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const j = JSON.parse(raw); return { reduce: !!j.reduce, nuke: j.nuke === 'classic' || j.nuke === 'off' ? j.nuke : 'full' }; }
  } catch { /* ignore */ }
  return { reduce: false, nuke: 'full' };
}

class FxBus {
  prefs: FxPrefs = loadPrefs();
  private listeners = new Set<(e: FxEvent) => void>();
  private prefListeners = new Set<() => void>();
  private seq = 1;
  /** camera shake for the 3D scene: amplitude (world units) and duration (s), read every frame by Scene */
  shake: { start: number; dur: number; amp: number } | null = null;
  /** counters (exposed for automated checks) */
  fired: Record<string, number> = {};

  /** Reduce effects: only the player's explicit choice in Settings (never inferred from the OS). */
  get reduced(): boolean { return this.prefs.reduce; }
  /** OS-level "Reduce motion": no camera shake / white flash, but every effect (incl. the nuke blast) still plays. */
  get osReducedMotion(): boolean {
    try { return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }
  /** The nuke as this player sees it: Reduce effects forces the Off-style version. */
  /** set by the online table from the room's setting (null offline) */
  private _tableNuke: NukeIntensity | null = null;
  get tableNuke(): NukeIntensity | null { return this._tableNuke; }
  set tableNuke(v: NukeIntensity | null) { if (v === this._tableNuke) return; this._tableNuke = v; this.prefListeners.forEach((f) => f()); }
  getTableNuke = () => this._tableNuke;
  get nukeMode(): NukeIntensity { return this.reduced ? 'off' : (this.tableNuke ?? this.prefs.nuke); }
  setNuke(nuke: NukeIntensity) {
    this.prefs = { ...this.prefs, nuke };
    try { localStorage.setItem(KEY, JSON.stringify(this.prefs)); } catch { /* ignore */ }
    this.prefListeners.forEach((f) => f());
  }
  getNuke = () => this.prefs.nuke;
  /** 3D blast impulse (cards lifted / blown outward, then settle), read by every Card3D each frame */
  blast: { start: number; hand: boolean } | null = null;
  /**
   * 'Run it!' tornado, read by every Card3D (cards pulled into the funnel, spun, flung away), the funnel itself and the
   * camera sway. `start` is when the funnel starts pulling (after the claimer's cards slam down).
   */
  tornado: { start: number; reduced: boolean } | null = null;
  /** capture scripts only: pin the nuke timeline to this many seconds (frame-exact screenshots / recordings) */
  warp: number | null = null;
  setReduce(reduce: boolean) {
    this.prefs = { ...this.prefs, reduce };
    try { localStorage.setItem(KEY, JSON.stringify(this.prefs)); } catch { /* ignore */ }
    this.prefListeners.forEach((f) => f());
  }
  subscribePrefs = (fn: () => void) => { this.prefListeners.add(fn); return () => { this.prefListeners.delete(fn); }; };
  getReduce = () => this.prefs.reduce;

  on(fn: (e: FxEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /* ----- pending-effects queue: the end of a hand waits for these before the scorecard / Table Talk opens ----- */
  private holds = new Map<number, number>(); // hold id → expiry (performance.now ms)
  private holdSeq = 1;
  /** Marks an effect as running for up to `ms` (capped by HYPE_SETTLE_MAX_MS so nothing can hang). Returns a release. */
  hold(ms: number, tag = 'fx'): () => void {
    const id = this.holdSeq++;
    this.holds.set(id, performance.now() + Math.min(Math.max(0, ms), HYPE_SETTLE_MAX_MS));
    this.held[tag] = (this.held[tag] ?? 0) + 1;
    return () => { this.holds.delete(id); };
  }
  /** counters of holds by tag (automated checks) */
  held: Record<string, number> = {};
  /** ms until every running effect has finished (0 = idle). */
  pendingMs(): number {
    const now = performance.now();
    let end = now;
    for (const [id, t] of this.holds) { if (t <= now) this.holds.delete(id); else end = Math.max(end, t); }
    return end - now;
  }
  /** Emits later, holding the hand-end queue from now until the effect itself is done. */
  later(kind: FxKind, delayMs: number, opts: Parameters<FxBus['emit']>[1] = {}): () => void {
    const release = this.hold(delayMs + 100, `later:${kind}`);
    const t = window.setTimeout(() => { this.emit(kind, opts); release(); }, delayMs);
    return () => { clearTimeout(t); release(); };
  }
  /**
   * Calls `cb` once every running effect has finished, then `beatMs` more. Never waits longer than `maxMs` (+ the beat)
   * in total, so a stuck effect can't hang the game. Returns a cancel.
   */
  whenIdle(cb: () => void, beatMs = 0, maxMs = HYPE_SETTLE_MAX_MS): () => void {
    const start = performance.now();
    let t = 0, done = false;
    const check = () => {
      const left = this.pendingMs();
      const waited = performance.now() - start;
      if (left <= 0 || waited >= maxMs) { t = window.setTimeout(() => { done = true; cb(); }, beatMs); return; }
      t = window.setTimeout(check, Math.min(left, maxMs - waited) + 20);
    };
    t = window.setTimeout(check, 30); // effects scheduled in the same render register first
    return () => { if (!done) clearTimeout(t); };
  }

  private lastNukeAt = -1e9;
  /** the running Wheels car releases its hold when it drives off (WheelsCelebration onDone) */
  carRelease: (() => void) | null = null;
  emit(kind: FxKind, opts: { level?: number; text?: string; sub?: string; silent?: boolean } = {}) {
    // one blast per nuked trick: the card's landing cue and the Table's watchdog may both ask for it
    if (kind === 'nuke') { const now = performance.now(); if (now - this.lastNukeAt < 4500) return; this.lastNukeAt = now; }
    const e: FxEvent = { id: this.seq++, kind, at: performance.now(), level: opts.level, text: opts.text, sub: opts.sub };
    this.fired[kind] = (this.fired[kind] ?? 0) + 1;
    const holdMs = FX_HOLD_MS[kind];
    if (holdMs) { const release = this.hold(holdMs, kind); if (kind === 'wheelsCar') this.carRelease = release; }
    if (!opts.silent) sound.play(sfxFor(e), { gain: 1 });
    if (!this.reduced && !this.osReducedMotion) {
      if (kind === 'jokerLittle') this.shake = { start: e.at, dur: 0.35, amp: 0.035 };
      else if (kind === 'jokerBig') this.shake = { start: e.at, dur: 0.95, amp: 0.07 };
      else if (kind === 'nuke' && this.nukeMode !== 'off') this.shake = { start: e.at + 260, dur: 2.2, amp: 0.15 };
      else if (kind === 'shot') this.shake = { start: e.at + 80, dur: 0.3, amp: 0.03 };
      // over-cut: one short, sharp nudge (not the joker's rolling rumble)
      else if (kind === 'overcut') this.shake = (e.level ?? 2) >= 3 ? { start: e.at, dur: 0.45, amp: 0.085 } : { start: e.at, dur: 0.24, amp: 0.045 };
      else if (kind === 'wheels') this.shake = { start: e.at + 60, dur: 0.25, amp: 0.02 };
      else if (kind === 'wheelsCar') this.shake = { start: e.at + 950, dur: 0.6, amp: 0.025 };
    }
    this.listeners.forEach((f) => f(e));
  }
}

export function sfxFor(e: Pick<FxEvent, 'kind' | 'level'>): Sfx {
  if (e.kind === 'streak') return (e.level ?? 2) >= 4 ? 'streak3' : (e.level ?? 2) === 3 ? 'streak2' : 'streak1';
  if (e.kind === 'overcut') return (e.level ?? 2) >= 3 ? 'overcut3' : 'overcut';
  if (e.kind === 'hustled') return 'shot';
  if (e.kind === 'ranIt') return 'tornado';
  return e.kind as Sfx;
}

export const fx = new FxBus();
if (typeof window !== 'undefined') (window as unknown as { __bwmFx?: FxBus }).__bwmFx = fx;

const FX_CUES = new Set(['jokerLittle', 'jokerBig', 'nuke', 'overcut', 'overcut3']);
/** A landing cue from a card animation: plain sounds play; joker cues go through the effects bus (sound + visuals). */
export function fireCue(c: string, delay = 0) {
  if (FX_CUES.has(c.split('|')[0]!)) {
    const go = () => fx.emit(c as FxKind);
    if (c.startsWith('overcut')) {
      // "overcut|SAY LESS!" / "overcut3|…": level 2 / 3+ with the (seeded) callout text
      const [k, text] = c.split('|');
      const emit = () => fx.emit('overcut', { level: k === 'overcut3' ? 3 : 2, text });
      if (delay) window.setTimeout(emit, delay * 1000); else emit();
      return;
    }
    if (delay) window.setTimeout(go, delay * 1000); else go();
    return;
  }
  // level-1 cut: the crisp cut sound + a light accent nudge
  if (c === 'cut' && !fx.reduced && !fx.osReducedMotion) window.setTimeout(() => { fx.shake = { start: performance.now(), dur: 0.14, amp: 0.012 }; }, delay * 1000);
  sound.play(c as Sfx, delay ? { delay } : {});
}

export function useReduceEffects(): boolean {
  return useSyncExternalStore(fx.subscribePrefs, fx.getReduce, fx.getReduce);
}

/** Which side won a scored hand outright (strictly most points that hand), or null. */
export function handWinner(points: number[]): number | null {
  const top = Math.max(...points);
  return points.filter((p) => p === top).length === 1 ? points.indexOf(top) : null;
}

/** Consecutive hands (ending with the latest) that `side` won outright. */
export function streakOf(history: { sides: { points: number }[] }[], side: number): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (handWinner(history[i]!.sides.map((s) => s.points)) !== side) break;
    n++;
  }
  return n;
}

export function streakLabel(n: number): string | null {
  if (n >= 4) return 'UNSTOPPABLE';
  if (n === 3) return 'ON FIRE';
  if (n === 2) return 'HEAT CHECK';
  return null;
}

/** The online table's nuke level (null offline). */
export function useTableNuke(): NukeIntensity | null {
  return useSyncExternalStore(fx.subscribePrefs, fx.getTableNuke, fx.getTableNuke);
}

export function useNukeIntensity(): NukeIntensity {
  return useSyncExternalStore(fx.subscribePrefs, fx.getNuke, fx.getNuke);
}
