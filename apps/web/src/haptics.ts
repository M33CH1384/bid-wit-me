/**
 * One haptic seam for the table.
 *
 * `haptic(pattern)` is the only call site. It checks the Vibration setting, a user gesture,
 * `navigator.vibrate`, and reduced motion. On iPhone / iPad it does nothing for now — a native
 * wrapper (Capacitor Haptics) can replace `driver` later without touching the call sites.
 * Patterns are fired from animation keyframes, then throttled to one pattern per 250ms.
 * `cancelHaptics` calls vibrate(0) when an animation is skipped or the page is hidden.
 */
import { useSyncExternalStore } from 'react';
import { isIosWebKit, currentNukeDevice } from './three/nukeVisual';

export const HAPTIC = {
  /** Heartbeat lub, fired when a beat mark is crossed. */
  beat: [12],
  /** Detonation, fired at burst t = 0 (the 3D blast starts). Slots sum to 430ms. */
  detonation: [40, 30, 120, 40, 200],
  /** Tornado spin-up, fired when the funnel clock crosses u = 0. Slots sum to 400ms of the ~700ms wind-up. */
  tornadoSpin: [20, 40, 20, 40, 30, 30, 40, 20, 60, 20, 80],
  /** Tornado impact, fired when the fling keyframe crosses u = 1.65. */
  tornadoImpact: [150],
  /** Trick won, fired when the hold releases and the cards start sweeping to the books. */
  trickWin: [15],
  /** Set or shot, fired when that toast / pop is created. */
  setOrShot: [60, 40, 60],
  /** Local game win, fired when the victory screen is shown. */
  gameWin: [80, 60, 80, 60, 200],
  /** The only vibration under prefers-reduced-motion. */
  reducedTick: [12],
} as const;

export type HapticName = keyof typeof HAPTIC;
export type HapticResult = 'played' | 'throttled' | 'skipped' | 'reduced' | 'cancelled';

const THROTTLE_MS = 250;
const KEY = 'bwm.vibrate';

/** Swap point for a native driver. Default talks to navigator.vibrate. */
export interface HapticDriver {
  vibrate(pattern: number | number[]): boolean;
}

export function navigatorDriver(): HapticDriver {
  return {
    vibrate(pattern) {
      if (typeof navigator === 'undefined') return false;
      const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
      if (typeof nav.vibrate !== 'function') return false;
      try { return nav.vibrate(pattern) !== false; } catch { return false; }
    },
  };
}

let driver: HapticDriver = navigatorDriver();
/** Install a native driver (Capacitor Haptics) without changing call sites. */
export function setHapticDriver(next: HapticDriver): void { driver = next; }

export interface HapticPorts {
  vibrate: (pattern: number | number[]) => boolean;
  now: () => number;
  reducedMotion: () => boolean;
  enabled: () => boolean;
  unlocked: () => boolean;
  hidden: () => boolean;
  /** iPhone / iPad: no web vibration. A native driver bypasses this by being installed later. */
  ios: () => boolean;
}

export interface HapticLog { pattern: number[]; at: number; tag: string; result: HapticResult }

export function createHaptics(p: HapticPorts) {
  let last = -1e9;
  let reducedSpent = false;
  const log: HapticLog[] = [];
  function note(pattern: number[], tag: string, result: HapticResult): HapticResult {
    log.push({ pattern, at: p.now(), tag, result });
    return result;
  }
  function haptic(pattern: readonly number[], tag = ''): HapticResult {
    if (p.hidden()) {
      p.vibrate(0);
      reducedSpent = false;
      return note([0], tag || 'hidden', 'cancelled');
    }
    if (!p.enabled() || !p.unlocked() || p.ios()) return note([], tag, 'skipped');
    const now = p.now();
    if (p.reducedMotion()) {
      if (reducedSpent) return note([], tag, 'reduced');
      reducedSpent = true;
      last = now;
      const tick = [...HAPTIC.reducedTick];
      p.vibrate(tick);
      return note(tick, tag, 'reduced');
    }
    if (now - last < THROTTLE_MS) return note([], tag, 'throttled');
    last = now;
    const copy = [...pattern];
    p.vibrate(copy);
    return note(copy, tag, 'played');
  }
  function cancel(tag = 'cancel'): HapticResult {
    p.vibrate(0);
    reducedSpent = false;
    last = -1e9;
    return note([0], tag, 'cancelled');
  }
  return { haptic, cancel, log };
}

function readEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    return localStorage.getItem(KEY) !== '0';
  } catch { return true; }
}

let enabled = readEnabled();
let unlocked = false;
const prefListeners = new Set<() => void>();

function emitPref() { prefListeners.forEach((f) => f()); }

export function vibrationOn(): boolean { return enabled; }
export function setVibration(on: boolean): void {
  enabled = on;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private mode */ }
  emitPref();
  if (!on) cancelHaptics('toggle-off');
}
export function subscribeVibration(fn: () => void): () => void {
  prefListeners.add(fn);
  return () => { prefListeners.delete(fn); };
}
export function useVibration(): boolean {
  return useSyncExternalStore(subscribeVibration, vibrationOn, () => true);
}

/** Call after a user gesture. Pointer and key listeners below arm this too. */
export function noteGesture(): void { unlocked = true; }
export function gestureUnlocked(): boolean { return unlocked; }

const live = createHaptics({
  vibrate: (pattern) => driver.vibrate(pattern),
  now: () => performance.now(),
  reducedMotion: () => {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
  },
  enabled: () => enabled,
  unlocked: () => unlocked,
  hidden: () => typeof document !== 'undefined' && document.hidden,
  ios: () => isIosWebKit(currentNukeDevice()),
});

/** Fire a pattern. Card play has no pattern — don't call this for a deal or a play. */
export function haptic(pattern: readonly number[], tag = ''): HapticResult {
  return live.haptic(pattern, tag);
}

/** vibrate(0). Use when an animation is skipped or the page hides. */
export function cancelHaptics(tag = 'cancel'): HapticResult {
  return live.cancel(tag);
}

if (typeof window !== 'undefined') {
  const arm = () => { unlocked = true; };
  window.addEventListener('pointerdown', arm, { passive: true });
  window.addEventListener('keydown', arm);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancelHaptics('hidden');
  });
}
