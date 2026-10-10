/**
 * Hype effects bus: joker rumbles, the Big-over-Little nuke, streak / shot pop-ups.
 * Effects are derived from game state on every client (offline, and online from the server state each player
 * receives), so everyone at a table sees and hears the same moments. Card landings fire the joker cues
 * (see Card3D → fireCue) so the rumble hits exactly when the card hits the felt.
 * "Reduce effects" (or the OS reduced-motion setting) keeps the sounds and pop-ups but drops shake / flash.
 */
import { useSyncExternalStore } from 'react';
import { type Sfx, sound } from './audio';

export type FxKind = 'jokerLittle' | 'jokerBig' | 'nuke' | 'streak' | 'shot' | 'gotShot' | 'wheels';
export interface FxEvent { id: number; kind: FxKind; at: number; level?: number; text?: string; sub?: string }

const KEY = 'bwm.fx';
interface FxPrefs { reduce: boolean }
function loadPrefs(): FxPrefs {
  try { const raw = localStorage.getItem(KEY); if (raw) return { reduce: !!JSON.parse(raw).reduce }; } catch { /* ignore */ }
  return { reduce: false };
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

  get reduced(): boolean {
    if (this.prefs.reduce) return true;
    try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  }
  setReduce(reduce: boolean) {
    this.prefs = { reduce };
    try { localStorage.setItem(KEY, JSON.stringify(this.prefs)); } catch { /* ignore */ }
    this.prefListeners.forEach((f) => f());
  }
  subscribePrefs = (fn: () => void) => { this.prefListeners.add(fn); return () => { this.prefListeners.delete(fn); }; };
  getReduce = () => this.prefs.reduce;

  on(fn: (e: FxEvent) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  emit(kind: FxKind, opts: { level?: number; text?: string; sub?: string; silent?: boolean } = {}) {
    const e: FxEvent = { id: this.seq++, kind, at: performance.now(), level: opts.level, text: opts.text, sub: opts.sub };
    this.fired[kind] = (this.fired[kind] ?? 0) + 1;
    if (!opts.silent) sound.play(sfxFor(e), { gain: 1 });
    if (!this.reduced) {
      if (kind === 'jokerLittle') this.shake = { start: e.at, dur: 0.35, amp: 0.035 };
      else if (kind === 'jokerBig') this.shake = { start: e.at, dur: 0.95, amp: 0.07 };
      else if (kind === 'nuke') this.shake = { start: e.at + 120, dur: 1.6, amp: 0.13 };
      else if (kind === 'shot') this.shake = { start: e.at + 80, dur: 0.3, amp: 0.03 };
      else if (kind === 'wheels') this.shake = { start: e.at + 60, dur: 0.25, amp: 0.02 };
    }
    this.listeners.forEach((f) => f(e));
  }
}

export function sfxFor(e: Pick<FxEvent, 'kind' | 'level'>): Sfx {
  if (e.kind === 'streak') return (e.level ?? 2) >= 4 ? 'streak3' : (e.level ?? 2) === 3 ? 'streak2' : 'streak1';
  return e.kind as Sfx;
}

export const fx = new FxBus();
if (typeof window !== 'undefined') (window as unknown as { __bwmFx?: FxBus }).__bwmFx = fx;

const FX_CUES = new Set(['jokerLittle', 'jokerBig', 'nuke']);
/** A landing cue from a card animation: plain sounds play; joker cues go through the effects bus (sound + visuals). */
export function fireCue(c: string, delay = 0) {
  if (FX_CUES.has(c)) {
    if (delay) window.setTimeout(() => fx.emit(c as FxKind), delay * 1000);
    else fx.emit(c as FxKind);
    return;
  }
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
