/**
 * Motion view (owner, 2026-11-07 — "Let's try both"): an OPTIONAL Settings
 * toggle, OFF by default. While it is on at a table, the phone itself drives
 * the existing adjustable view (viewAdjust.ts — the same store the drag /
 * pinch gestures drive, so the readout chip, the save channel, plate layout
 * and seat video all follow for free):
 *
 *  Lean-to-tilt — the angle the phone is held at drives the table tilt.
 *  The holding angle at enable (or at any resume) is the neutral anchor;
 *  leaning from there maps onto the view tilt. No anchor, no jump: the
 *  anchor carries the tilt the view already had, so a resume continues
 *  exactly where the view rests.
 *
 *  (A push/pull nudge-zoom shipped alongside the lean on 2026-11-07 and
 *  was REMOVED the same day on the owner's verdict — "I like the motion
 *  control as far as tilt. The zoom isn't working but that's fine —
 *  remove that part". This module is tilt-only now: nothing here reads
 *  motion/acceleration events or ever writes the view zoom, and the
 *  absence pins in test/motion-view.test.ts keep it that way. Players'
 *  saved zoom values are untouched — drag/pinch still own zoom.)
 *
 * Pure math + a small driver class — no three, no React — like viewAdjust.
 * The driver is mounted by Scene next to ViewAdjustControls (mounted
 * exactly when a table view is), fed by window sensor events; in tests it
 * is fed by a fake target and a fake clock.
 *
 * SIGN CONVENTIONS (pinned by test/motion-view.test.ts):
 *  - Lean: leaning the top of the phone AWAY from the player is positive
 *    lean and maps to +tilt — the view pitches TOWARD the table, the same
 *    direction a finger-UP drag takes (tiltForDragY(0, -70) === 10).
 */
import {
  clampViewAdjust, getViewAdjustState, beginViewAdjustGesture, updateViewAdjustLive,
  endViewAdjustGesture, viewAdjustEquals, type ViewAdjust,
} from './viewAdjust';

/* ------------------------------------------------------------- constants
 * Every feel knob for the feature lives here, named, so one-line retunes
 * after the owner's phone verdict never hunt through logic. */

/** Lean (degrees from the anchor) that sweeps the FULL ±15° view tilt. */
export const MOTION_LEAN_RANGE_DEG = 20;
/** Lean inside ±this many degrees of the anchor changes nothing. */
export const MOTION_LEAN_DEADZONE_DEG = 2;
/** Exponential smoothing time constant for the lean, ms. */
export const MOTION_SMOOTHING_TAU_MS = 150;
/** While motion is moving the view, the save channel fires at most this often, ms. */
export const MOTION_PERSIST_INTERVAL_MS = 500;
/** Quiet time after the last motion change before the gesture closes (and saves), ms. */
export const MOTION_SETTLE_MS = 600;
/** Driver housekeeping tick, ms (settle + persist checks while a gesture is open). */
export const MOTION_DRIVER_TICK_MS = 100;
/** Enable-probe: how long to wait for a first real sensor event before calling it absent, ms. */
export const MOTION_PROBE_TIMEOUT_MS = 800;
/** A lean change below this many tilt degrees is not applied (float dust). */
const MOTION_TILT_EPSILON = 0.01;

/* ------------------------------------------------------------- lean math */

/**
 * The direction of gravity in device coordinates (unit vector), from the
 * deviceorientation Euler angles (ZXY order, degrees). g = (cosβ·sinγ,
 * −sinβ, −cosβ·cosγ): flat screen-up is (0,0,−1), upright portrait is
 * (0,−1,0). Null when the platform reports no angles (a sensorless
 * desktop fires events with null beta/gamma).
 */
export function gravityFromOrientation(betaDeg: number | null, gammaDeg: number | null): { x: number; y: number; z: number } | null {
  if (typeof betaDeg !== 'number' || !Number.isFinite(betaDeg)) return null;
  if (typeof gammaDeg !== 'number' || !Number.isFinite(gammaDeg)) return null;
  const b = (betaDeg * Math.PI) / 180;
  const g = (gammaDeg * Math.PI) / 180;
  return {
    x: Math.cos(b) * Math.sin(g),
    y: -Math.sin(b),
    z: -Math.cos(b) * Math.cos(g),
  };
}

/**
 * The player's lean, in degrees: 0 = the phone held upright facing the
 * player, positive = the top of the phone leaning AWAY (toward lying flat
 * screen-up, which reads +90), negative = top leaning toward the player.
 * Computed from gravity projected onto the SCREEN's up axis — screen up
 * in device coords is (sinθ, cosθ, 0) for screen orientation angle θ — so
 * the same physical lean reads the same in portrait and both landscapes,
 * and there is no Euler singularity at the landscape-upright posture
 * (where beta itself is undefined). Null when there are no angles.
 */
export function leanDegFromOrientation(betaDeg: number | null, gammaDeg: number | null, screenAngleDeg: number): number | null {
  const g = gravityFromOrientation(betaDeg, gammaDeg);
  if (!g) return null;
  const t = ((screenAngleDeg % 360) * Math.PI) / 180;
  const upProj = g.x * Math.sin(t) + g.y * Math.cos(t);
  const lean = (Math.atan2(-g.z, -upProj) * 180) / Math.PI;
  return Math.max(-90, Math.min(90, lean));
}

/**
 * View tilt for a lean delta from the anchor: nothing inside the
 * deadzone; beyond it, the remaining lean (range − deadzone) sweeps the
 * full ±15° view tilt, clamped at the bound. Symmetric both ways.
 */
export function tiltForLeanDelta(deltaDeg: number): number {
  if (!Number.isFinite(deltaDeg)) return 0;
  const a = Math.abs(deltaDeg);
  if (a <= MOTION_LEAN_DEADZONE_DEG) return 0;
  const eff = Math.min(a - MOTION_LEAN_DEADZONE_DEG, MOTION_LEAN_RANGE_DEG - MOTION_LEAN_DEADZONE_DEG);
  return (Math.sign(deltaDeg) * eff * 15) / (MOTION_LEAN_RANGE_DEG - MOTION_LEAN_DEADZONE_DEG);
}

/** Exponential low-pass over the lean: the first sample snaps (calibration
 *  must never sweep in from a stale value); later samples converge with
 *  the MOTION_SMOOTHING_TAU_MS time constant. */
export class LeanSmoother {
  private value: number | null = null;
  reset(v?: number): void { this.value = typeof v === 'number' && Number.isFinite(v) ? v : null; }
  get current(): number | null { return this.value; }
  push(target: number, dtMs: number): number {
    if (this.value === null) { this.value = target; return target; }
    const k = 1 - Math.exp(-Math.max(0, dtMs) / MOTION_SMOOTHING_TAU_MS);
    this.value += (target - this.value) * k;
    return this.value;
  }
}

/* --------------------------------------------- enabled + touch signals */

/** The toggle's runtime mirror. Table seeds it from settings next to
 *  seedViewAdjust (the same lifecycle), Scene's driver subscribes. */
let motionEnabled = false;
const motionEnabledListeners = new Set<() => void>();
export function getMotionViewEnabled(): boolean { return motionEnabled; }
export function subscribeMotionViewEnabled(fn: () => void): () => void {
  motionEnabledListeners.add(fn);
  return () => { motionEnabledListeners.delete(fn); };
}
export function seedMotionViewEnabled(on: boolean): void {
  const v = on === true;
  if (v === motionEnabled) return;
  motionEnabled = v;
  for (const fn of [...motionEnabledListeners]) fn();
}

/** "A finger (or the wheel) is driving the view right now" — fed by
 *  ViewAdjustControls' own gesture callbacks in Scene. The viewAdjust
 *  store's `adjusting` flag cannot carry this: motion itself sets it. */
let touchGestureActive = false;
const touchListeners = new Set<() => void>();
export function noteExternalViewGesture(active: boolean): void {
  const v = active === true;
  if (v === touchGestureActive) return;
  touchGestureActive = v;
  for (const fn of [...touchListeners]) fn();
}
export function isExternalViewGestureActive(): boolean { return touchGestureActive; }
export function subscribeExternalViewGesture(fn: () => void): () => void {
  touchListeners.add(fn);
  return () => { touchListeners.delete(fn); };
}

/** Test hook: restore the pristine module state. */
export function __resetMotionViewStore(): void {
  if (motionEnabled) { motionEnabled = false; for (const fn of [...motionEnabledListeners]) fn(); }
  if (touchGestureActive) { touchGestureActive = false; for (const fn of [...touchListeners]) fn(); }
}

/* ---------------------------------------------------- permission/probe */

export type MotionEnableResult = 'granted' | 'denied' | 'absent';

export interface MotionSensorEnv {
  orientationCtor?: unknown;
  /** Accepted for env compatibility with earlier callers/tests; NEVER
   *  consulted — since the 2026-11-07 removal nothing reads motion
   *  events, so motion permission is neither requested nor required. */
  motionCtor?: unknown;
  target?: MotionEventTargetLike;
}

interface PermissionCtor { requestPermission?: unknown }

/**
 * The enable flow for the Settings toggle, called FROM the toggle tap
 * (iOS requires requestPermission to ride a user gesture):
 *  - no sensor constructors at all (older browser) -> 'absent';
 *  - an iOS-style requestPermission that does not grant, or throws ->
 *    'denied' (fail closed, never throws);
 *  - otherwise probe: a real deviceorientation event with a numeric
 *    beta must arrive within the timeout, else 'absent' — a desktop
 *    browser HAS the constructor but no gyro, and its null-angle events
 *    do not count as a sensor.
 * The env is injectable for tests; keys present in `env` win over the
 * window globals (pass null to say "definitely not there").
 */
export async function enableMotionSensors(env: MotionSensorEnv = {}, probeTimeoutMs: number = MOTION_PROBE_TIMEOUT_MS): Promise<MotionEnableResult> {
  const has = (k: keyof MotionSensorEnv) => Object.prototype.hasOwnProperty.call(env, k);
  const win = (typeof window !== 'undefined' ? window : {}) as Record<string, unknown>;
  const orientationCtor = has('orientationCtor') ? env.orientationCtor : win['DeviceOrientationEvent'];
  if (!orientationCtor) return 'absent';
  for (const ctor of [orientationCtor]) {
    const rp = (ctor as PermissionCtor | null | undefined)?.requestPermission;
    if (typeof rp === 'function') {
      let res: unknown;
      try {
        res = await (rp as () => Promise<unknown>).call(ctor);
      } catch {
        return 'denied';
      }
      if (res !== 'granted') return 'denied';
    }
  }
  const target = has('target') ? env.target : (typeof window !== 'undefined' ? (window as unknown as MotionEventTargetLike) : undefined);
  if (!target) return 'absent';
  return new Promise<MotionEnableResult>((resolve) => {
    let done = false;
    const finish = (v: MotionEnableResult) => {
      if (done) return;
      done = true;
      try { target.removeEventListener('deviceorientation', onEv); } catch { /* ignore */ }
      resolve(v);
    };
    const onEv = (e: unknown) => {
      const beta = (e as { beta?: unknown } | null | undefined)?.beta;
      if (typeof beta === 'number' && Number.isFinite(beta)) finish('granted');
    };
    try {
      target.addEventListener('deviceorientation', onEv);
    } catch {
      finish('absent');
      return;
    }
    setTimeout(() => finish('absent'), Math.max(0, probeTimeoutMs));
  });
}

/** The current screen orientation angle (0/90/180/270), best-effort. */
export function screenAngleDeg(): number {
  try {
    const a = (window.screen?.orientation as { angle?: unknown } | undefined)?.angle;
    if (typeof a === 'number' && Number.isFinite(a)) return ((a % 360) + 360) % 360;
    const wo = (window as unknown as { orientation?: unknown }).orientation;
    if (typeof wo === 'number' && Number.isFinite(wo)) return ((wo % 360) + 360) % 360;
  } catch { /* ignore */ }
  return 0;
}

/* ---------------------------------------------------------------- driver */

export interface MotionEventTargetLike {
  addEventListener(type: string, fn: (e: never) => void, options?: unknown): void;
  removeEventListener(type: string, fn: (e: never) => void, options?: unknown): void;
}

export interface MotionDriverDeps {
  target: MotionEventTargetLike;
  now?: () => number;
  screenAngle?: () => number;
}

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * The sensor driver. Listeners exist only while the toggle is ON (the
 * class is constructed per table view by Scene and disposed with it).
 * While any suspend reason is active — a felt touch gesture, a sheet or
 * panel over the table, the recap/results cover, the app backgrounded,
 * Reduce effects — samples are tracked but never applied; when the last
 * reason clears, the driver re-anchors at the current posture and the
 * tilt the view already has, so the view never jumps.
 *
 * Motion drives the viewAdjust store exactly like a drag does: it opens
 * a gesture (chip shows), updates live, and closes it — which commits
 * through the one save channel — once the view settles. While a long
 * movement continues, the housekeeping tick commits at most every
 * MOTION_PERSIST_INTERVAL_MS (re-opening the gesture instantly), so a
 * sensor stream can never write settings per tick.
 */
export class MotionViewDriver {
  private target: MotionEventTargetLike;
  private nowFn: () => number;
  private angleFn: () => number;
  private enabled = false;
  private suspend = new Set<string>();
  private listening = false;
  private disposed = false;
  private wasRunning = false;

  private smoother = new LeanSmoother();
  private anchored = false;
  private pendingAnchor = false;
  private anchorLean = 0;
  private anchorTilt = 0;
  private lastSampleAt: number | null = null;

  private gestureOpen = false;
  private lastChangeAt = 0;
  private lastCommitAt = 0;
  private lastCommittedAdj: ViewAdjust | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private unsubTouch: (() => void) | null = null;

  constructor(deps: MotionDriverDeps) {
    this.target = deps.target;
    this.nowFn = deps.now ?? (() => Date.now());
    this.angleFn = deps.screenAngle ?? (() => screenAngleDeg());
    this.unsubTouch = subscribeExternalViewGesture(() => {
      this.setSuspended('touch', isExternalViewGestureActive());
    });
  }

  isListening(): boolean { return this.listening; }
  private running(): boolean { return this.enabled && this.suspend.size === 0 && !this.disposed; }

  setEnabled(on: boolean): void {
    const v = on === true;
    if (v === this.enabled) return;
    this.enabled = v;
    if (v) {
      this.attach();
    } else {
      if (this.gestureOpen) this.closeGesture();
      this.detach();
      this.anchored = false;
    }
    this.syncState();
  }

  setSuspended(reason: string, on: boolean): void {
    const has = this.suspend.has(reason);
    if (on === has) return;
    if (on) this.suspend.add(reason); else this.suspend.delete(reason);
    this.syncState();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.gestureOpen) this.closeGesture();
    this.detach();
    this.unsubTouch?.();
    this.unsubTouch = null;
  }

  /** running() edge transitions: falling -> commit any open gesture;
   *  rising -> re-anchor on the next sample. */
  private syncState(): void {
    const r = this.running();
    if (r === this.wasRunning) return;
    this.wasRunning = r;
    if (!r) {
      if (this.gestureOpen) this.closeGesture();
    } else {
      this.pendingAnchor = true;
    }
  }

  private attach(): void {
    if (this.listening) return;
    this.target.addEventListener('deviceorientation', this.onOrientation);
    this.target.addEventListener('orientationchange', this.onReorient);
    this.listening = true;
    this.tickTimer = setInterval(this.onTick, MOTION_DRIVER_TICK_MS);
  }

  private detach(): void {
    if (!this.listening) return;
    this.target.removeEventListener('deviceorientation', this.onOrientation);
    this.target.removeEventListener('orientationchange', this.onReorient);
    this.listening = false;
    if (this.tickTimer !== null) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  private onReorient = (): void => {
    // The lean frame rotated with the screen: commit where we are and
    // re-anchor on the next sample rather than swing the view.
    if (this.gestureOpen) this.closeGesture();
    this.pendingAnchor = true;
  };

  private onOrientation = (e: unknown): void => {
    const ev = e as { beta?: unknown; gamma?: unknown } | null | undefined;
    const lean = leanDegFromOrientation(numOrNull(ev?.beta), numOrNull(ev?.gamma), this.angleFn());
    if (lean === null) return;
    const now = this.nowFn();
    const dt = this.lastSampleAt === null ? 0 : Math.min(250, Math.max(0, now - this.lastSampleAt));
    this.lastSampleAt = now;
    if (!this.running()) return;
    if (this.pendingAnchor || !this.anchored) {
      // Calibration: this posture is neutral, and the view's current
      // tilt is the base the lean adds to — the view does not move.
      this.smoother.reset(lean);
      this.anchorLean = lean;
      this.anchorTilt = getViewAdjustState().adj.tilt;
      this.anchored = true;
      this.pendingAnchor = false;
      return;
    }
    const smoothed = this.smoother.push(lean, dt);
    const cur = getViewAdjustState().adj;
    const tilt = clampViewAdjust({
      tilt: this.anchorTilt + tiltForLeanDelta(smoothed - this.anchorLean),
      zoom: cur.zoom,
    }).tilt;
    if (Math.abs(tilt - cur.tilt) <= MOTION_TILT_EPSILON) return;
    this.openGestureIfNeeded(now);
    updateViewAdjustLive({ tilt, zoom: cur.zoom });
    this.lastChangeAt = now;
  };

  private onTick = (): void => {
    if (!this.gestureOpen || !this.running()) return;
    const now = this.nowFn();
    const cur = getViewAdjustState().adj;
    const changed = !this.lastCommittedAdj || !viewAdjustEquals(cur, this.lastCommittedAdj);
    if (changed && now - this.lastCommitAt >= MOTION_PERSIST_INTERVAL_MS) {
      // The throttled save: close (commits) and instantly re-open, so the
      // chip never flickers and the linger never starts mid-movement.
      endViewAdjustGesture(cur);
      this.lastCommittedAdj = clampViewAdjust(cur);
      this.lastCommitAt = now;
      beginViewAdjustGesture();
      return;
    }
    if (now - this.lastChangeAt >= MOTION_SETTLE_MS) this.closeGesture();
  };

  private openGestureIfNeeded(now: number): void {
    if (this.gestureOpen) return;
    beginViewAdjustGesture();
    this.gestureOpen = true;
    this.lastChangeAt = now;
    this.lastCommitAt = now;
    this.lastCommittedAdj = clampViewAdjust(getViewAdjustState().adj);
  }

  private closeGesture(): void {
    if (!this.gestureOpen) return;
    const cur = getViewAdjustState().adj;
    endViewAdjustGesture(cur);
    this.lastCommittedAdj = clampViewAdjust(cur);
    this.lastCommitAt = this.nowFn();
    this.gestureOpen = false;
  }
}
