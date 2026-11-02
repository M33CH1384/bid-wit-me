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
import type { TornadoLevel } from './three/tornadoLevel';

/** How long a noted Run It claim may wait for its tornado before the stamp goes stale (ms). */
export const TORNADO_CLAIM_TTL_MS = 10_000;

/** What fx.tornado carries: the original start/reduced pair, plus — when the claim that
 *  produced this tornado was counted on the tornado ladder — its rung and claimant.
 *  `presentedAt` is stamped by Tornado3D on the first frame the funnel actually
 *  presents at/after `start`: the funnel and card clocks run from it, so a blocked
 *  frame delays the show instead of eating its spin-up (see heroPresented).
 *  `clockP` / `clockLast` are the presented-time integration state (see
 *  tornadoPresentedT): seconds of funnel time actually presented so far, and
 *  the wall time of the last presented frame. */
export interface TornadoFx { start: number; reduced: boolean; level?: TornadoLevel; side?: number; seat?: number; presentedAt?: number; clockP?: number; clockLast?: number }

/**
 * Presented-time clocks for the hero shows (nuke / mega / tornado) — round 2
 * of the 2026-10-29 presentation fix (owner report 2026-11-01: the nuke
 * "pauses, then skips ahead" — he can hear it but far too often can't see it).
 * Round 1 anchored the START of each show to its first presented frame, but
 * the clocks then ran on WALL time for the whole run: any mid-show stall
 * (long task, lazy shader compile, GC) froze the picture while the timeline
 * kept running, and the next presented frame leapt to the wall-clock
 * position — pause, skip, pause, skip. These clocks instead integrate the
 * real delta of PRESENTED frames, clamped per frame: at a healthy frame
 * rate the show runs at exactly its nominal length; under a stall it
 * stretches in presented time rather than skipping, so the whole timeline
 * is what the player actually sees. Durations are unchanged in presented
 * time; no timing constant moves.
 */
/** One presented frame may advance a hero clock by at most this much (s). A
 *  stalled frame therefore stretches the show instead of skipping it; at
 *  ≥10 fps the clamp never binds and the show runs at full speed. */
export const PRESENTED_DT_CLAMP_S = 0.1;

/**
 * Advance a presented-time clock. `last` is the wall time (performance.now
 * ms) of the previous presented frame, or null before the first: the first
 * presented frame anchors the clock (advance 0, `last` becomes now) —
 * round 1's start anchoring, kept. Later frames add their real delta
 * clamped to [0, PRESENTED_DT_CLAMP_S] seconds.
 */
export function advancePresentedClock(t: number, last: number | null, now: number): { t: number; last: number } {
  if (last === null) return { t, last: now };
  const dt = Math.min(Math.max((now - last) / 1000, 0), PRESENTED_DT_CLAMP_S);
  return { t: t + dt, last: now };
}

/**
 * The tornado's presented time (seconds since the funnel first presented).
 * Before `start`, returns the plain wall lead-in (negative), exactly as the
 * old `(now - start) / 1000` reads did, and stamps nothing. At/after start,
 * the first caller stamps `presentedAt` and starts the presented clock at
 * 0; later calls integrate presented frames with the clamp. The state lives
 * on the TornadoFx object itself, so the many readers per frame (funnel,
 * every swept card, the camera sway) all advance the same clock by ~0
 * after the first — the integration is idempotent within a frame.
 */
export function tornadoPresentedT(T: TornadoFx, now: number): number {
  if (T.presentedAt === undefined) {
    if (now < T.start) return (now - T.start) / 1000;
    T.presentedAt = now;
    T.clockP = 0;
    T.clockLast = now;
    return 0;
  }
  const next = advancePresentedClock(T.clockP ?? 0, T.clockLast ?? now, now);
  T.clockP = next.t;
  T.clockLast = next.last;
  return next.t;
}

/** How long each effect stays on screen (ms): the hand-end hold waits these out. wheelsCar is released by the car itself. */
const FX_HOLD_MS: Partial<Record<FxKind, number>> = {
  streak: 2300, shot: 2000, gotShot: 1900, wheels: 1900, ranIt: 2700, hustled: 2000, overcut: 1700,
  jokerBig: 1100, jokerLittle: 500, nuke: 3700, mega: 4400, wheelsCar: 3000,
};

export type FxKind = 'jokerLittle' | 'jokerBig' | 'nuke' | 'mega' | 'streak' | 'shot' | 'gotShot' | 'wheels' | 'wheelsCar' | 'overcut' | 'hustled' | 'ranIt';
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
  shake: { start: number; dur: number; amp: number; /** table-only vertical thump: never moves the camera sideways */ thump?: boolean } | null = null;
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
  /** 3D blast impulse (cards lifted / blown outward, then settle), read by every Card3D each frame. `mega` = the both-Jokers run tier: the sweep reaches farther. */
  blast: { start: number; hand: boolean; mega?: boolean } | null = null;
  /** The running blast's presented time in seconds (Nuke3D publishes it every
   *  frame; null when no blast is running). The blown cards read the SAME
   *  presented clock as the fireball, so a mid-show stall stretches the
   *  cards' flight with the show instead of the cards leaping on wall time. */
  nukeT: number | null = null;
  /**
   * 'Run it!' tornado, read by every Card3D (cards pulled into the funnel, spun, flung away), the funnel itself and the
   * camera sway. `start` is when the funnel starts pulling (after the claimer's cards slam down).
   *
   * This is an ACCESSOR, not a plain field: Table assigns the plain
   * {start, reduced} pair exactly as it always has, and the setter stamps
   * a pending ladder claim (see noteTornadoClaim) onto that assignment —
   * so the funnel that a counted claim produced carries its rung, and no
   * other tornado does. An assignment that already carries an explicit
   * level wins over the stamp. The stamp is consumed on use and expires
   * after TORNADO_CLAIM_TTL_MS, so a stale claim can never brand a later,
   * unrelated tornado.
   */
  private _tornado: TornadoFx | null = null;
  private pendingTornadoClaim: { level: TornadoLevel; side: number; seat: number; at: number } | null = null;
  get tornado(): TornadoFx | null { return this._tornado; }
  set tornado(v: TornadoFx | null) {
    if (v) {
      const pending = this.pendingTornadoClaim;
      this.pendingTornadoClaim = null; // any live assignment consumes the stamp
      if (!v.level && pending && performance.now() - pending.at <= TORNADO_CLAIM_TTL_MS) {
        v = { ...v, level: pending.level, side: pending.side, seat: pending.seat };
      }
    }
    this._tornado = v;
  }
  /** Record the ladder claim that is about to produce a tornado (called by the AnimFx layer the moment the claim resolves). */
  noteTornadoClaim(claim: { level: TornadoLevel; side: number; seat: number }): void {
    this.pendingTornadoClaim = { ...claim, at: performance.now() };
  }
  /** Drop any pending claim stamp (a rematch rewind must not brand the new match's first tornado with the old one's rung). */
  clearTornadoClaim(): void { this.pendingTornadoClaim = null; }
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
  /**
   * A hero blast (nuke / mega) whose boom + camera shake are waiting for the blast's
   * first PRESENTED frame. The emit-time schedule used to land the sound behind
   * whatever the mount cost — and the blast's clock was wall-time from the emit, so
   * the show was eaten while the thread blocked (owner report 2026-10-29: card lands,
   * ~1 s freeze, boom, flash to book collection, the animation itself never seen).
   * Nuke3D calls heroPresented() from the run's first frame; a fallback timer
   * presents it anyway if no frame ever lands (context loss, chunk failure), so
   * the boom is never lost. Mode 'off' (incl. Reduce effects) never defers: there
   * is no 3D run, so the emit's sound IS the show, exactly as before.
   */
  private heroWait: { kind: 'nuke' | 'mega'; timer: number } | null = null;
  /** The hero blast's first frame is on screen: play its boom + shake NOW, in sync. */
  heroPresented() {
    const w = this.heroWait;
    if (!w) return;
    this.heroWait = null;
    clearTimeout(w.timer);
    this.playHero(w.kind);
  }
  private playHero(kind: 'nuke' | 'mega') {
    sound.play(sfxFor({ kind }), { gain: 1 });
    if (!this.reduced && !this.osReducedMotion) {
      // the shake still leads the flash by its designed offset — measured from presentation, not emit
      const now = performance.now();
      if (kind === 'nuke') this.shake = { start: now + 260, dur: 2.2, amp: 0.15 };
      else this.shake = { start: now + 260, dur: 3.0, amp: 0.24 };
    }
  }
  emit(kind: FxKind, opts: { level?: number; text?: string; sub?: string; silent?: boolean } = {}) {
    // one blast per nuked trick: the card's landing cue and the Table's watchdog may both ask for it
    if (kind === 'nuke') { const now = performance.now(); if (now - this.lastNukeAt < 4500) return; this.lastNukeAt = now; }
    const e: FxEvent = { id: this.seq++, kind, at: performance.now(), level: opts.level, text: opts.text, sub: opts.sub };
    this.fired[kind] = (this.fired[kind] ?? 0) + 1;
    const holdMs = FX_HOLD_MS[kind];
    if (holdMs) { const release = this.hold(holdMs, kind); if (kind === 'wheelsCar') this.carRelease = release; }
    // hero blasts with a 3D run defer their boom to the first presented frame (heroPresented);
    // warp captures keep the emit-time schedule (their clock is pinned, not presented)
    const heroDeferred = (kind === 'nuke' || kind === 'mega') && this.nukeMode !== 'off' && this.warp === null;
    if (!opts.silent) {
      if (heroDeferred) {
        if (this.heroWait) clearTimeout(this.heroWait.timer);
        const timer = window.setTimeout(() => { const w = this.heroWait; if (w) { this.heroWait = null; this.playHero(w.kind); } }, 1500);
        this.heroWait = { kind, timer };
      } else sound.play(sfxFor(e), { gain: 1 });
    }
    if (!this.reduced && !this.osReducedMotion) {
      if (kind === 'jokerLittle') this.shake = { start: e.at, dur: 0.35, amp: 0.035 };
      else if (kind === 'jokerBig') this.shake = { start: e.at, dur: 0.95, amp: 0.07 };
      else if (kind === 'nuke' && this.nukeMode !== 'off') { if (this.warp !== null) this.shake = { start: e.at + 260, dur: 2.2, amp: 0.15 }; }
      // ☢☢ mega: a deeper, longer thump than the nuke's (the second stage re-shakes from Nuke3D at its flash)
      else if (kind === 'mega' && this.nukeMode !== 'off') { if (this.warp !== null) this.shake = { start: e.at + 260, dur: 3.0, amp: 0.24 }; }
      // a set shakes that scorecard panel, not the camera
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
export function fireCue(c: string, delay = 0, seat?: import('./three/layout').SeatPos, playerCount = 4) {
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
  if (c === 'cut' && !fx.reduced && !fx.osReducedMotion) window.setTimeout(() => { fx.shake = { start: performance.now(), dur: 0.14, amp: 0.012, thump: true }; }, delay * 1000);
  sound.play(c as Sfx, { ...(delay ? { delay } : {}), ...(seat ? { seat, playerCount } : {}) });
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
