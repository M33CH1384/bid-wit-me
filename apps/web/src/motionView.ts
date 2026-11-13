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
 *  Roll-to-sway (owner, 2026-11-08 — "there should be some slight side
 *  to side motion to make it realistic as well but not as powerful as
 *  the tilt"): the phone's ROLL — its top tipping sideways, read in the
 *  same screen frame as the lean so portrait and both landscapes agree
 *  — pans the camera's aim sideways by at most ±5°, a third of tilt's
 *  reach. Sway is a LIVE-ONLY offset: it lives in its own store below,
 *  never enters ViewAdjust {tilt, zoom}, never opens the readout chip's
 *  gesture and never persists — when motion stops (a suspend, the
 *  toggle, a felt touch, unmount) it centres, and the view is exactly
 *  the player's saved manual tilt/zoom again. The chip keeps reading
 *  "Tilt N° · Zoom N%": sway is ambience, not a third axis.
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
  releaseViewAdjustGesture, type CamSpecLike,
} from './viewAdjust';

/* ------------------------------------------------------------- constants
 * Every feel knob for the feature lives here, named, so one-line retunes
 * after the owner's phone verdict never hunt through logic. */

/** Lean (degrees from the anchor) that sweeps the FULL ±15° view tilt. */
export const MOTION_LEAN_RANGE_DEG = 20;
/** Lean inside ±this many degrees of the anchor changes nothing. */
export const MOTION_LEAN_DEADZONE_DEG = 2;
/** Roll (degrees from the anchor) that sweeps the FULL ±5° sway — the
 *  same span as the lean's, so a held phone rolls as far as it leans. */
export const MOTION_ROLL_RANGE_DEG = 20;
/** Roll inside ±this many degrees of the anchor changes nothing (a
 *  touch wider than the lean's — sideways hand tremor is constant). */
export const MOTION_ROLL_DEADZONE_DEG = 3;
/** The sway cap: degrees the camera aim pans sideways at full roll.
 *  Deliberately a third of tilt's ±15° — ambience, not steering. */
export const MOTION_SWAY_MAX_DEG = 5;
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
/** A sway change below this many degrees is not written to the store. */
const MOTION_SWAY_EPSILON = 0.02;

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
 * The player's ROLL, in degrees: the in-plane angle of gravity in the
 * SCREEN frame — 0 = the phone held level (its top pointing along
 * screen-up), positive = the top tipping toward the player's
 * screen-right. Screen right in device coords is (cosθ, −sinθ, 0) and
 * screen up is (sinθ, cosθ, 0) for orientation angle θ, so the same
 * physical tip reads the same in portrait and both landscapes — the
 * roll axis follows the screen, not the handset. Computed from the
 * same gravity vector as the lean, sharing its −g·up denominator, so
 * the two measures are independent reads of one posture. Null when
 * there are no angles.
 */
export function rollDegFromOrientation(betaDeg: number | null, gammaDeg: number | null, screenAngleDeg: number): number | null {
  const g = gravityFromOrientation(betaDeg, gammaDeg);
  if (!g) return null;
  const t = ((screenAngleDeg % 360) * Math.PI) / 180;
  const rightProj = g.x * Math.cos(t) - g.y * Math.sin(t);
  const upProj = g.x * Math.sin(t) + g.y * Math.cos(t);
  const roll = (Math.atan2(rightProj, -upProj) * 180) / Math.PI;
  return Math.max(-90, Math.min(90, roll));
}

/**
 * View sway for a roll delta from the anchor: nothing inside the
 * deadzone; beyond it, the remaining roll (range − deadzone) sweeps
 * the full ±MOTION_SWAY_MAX_DEG, clamped at the cap. Symmetric.
 */
export function swayForRollDelta(deltaDeg: number): number {
  if (!Number.isFinite(deltaDeg)) return 0;
  const a = Math.abs(deltaDeg);
  if (a <= MOTION_ROLL_DEADZONE_DEG) return 0;
  const eff = Math.min(a - MOTION_ROLL_DEADZONE_DEG, MOTION_ROLL_RANGE_DEG - MOTION_ROLL_DEADZONE_DEG);
  return (Math.sign(deltaDeg) * eff * MOTION_SWAY_MAX_DEG) / (MOTION_ROLL_RANGE_DEG - MOTION_ROLL_DEADZONE_DEG);
}

/**
 * Compose the sway onto a camera spec: the AIM rotates around the
 * camera position about the world Y axis — a level pan, so the aim's
 * height and the pos→look distance survive, and the position never
 * moves (a pan of the gaze, never a dolly or a room rotation; the
 * seat-based partner-vantage yaw is a different system entirely).
 * Positive sway pans the aim toward the camera's OWN screen-right.
 * Scene composes this AFTER applyViewAdjustToSpec in the rig and in
 * the fan refit, exactly where tilt is composed, so the hand keeps
 * its solved layout while the room sways beneath it.
 */
export function applyMotionSwayToSpec<T extends CamSpecLike>(spec: T, swayDeg: number): T {
  if (!Number.isFinite(swayDeg) || swayDeg === 0) return spec;
  const r = (swayDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = spec.look[0]! - spec.pos[0]!;
  const dz = spec.look[2]! - spec.pos[2]!;
  return {
    ...spec,
    pos: [...spec.pos],
    look: [spec.pos[0]! + dx * cos - dz * sin, spec.look[1]!, spec.pos[2]! + dx * sin + dz * cos],
  };
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
  // The master switch turning off also clears the in-table quick
  // suspend: re-enabling later starts DRIVING, never stuck suspended
  // with its button just reappearing.
  if (!v) setMotionQuickSuspended(false);
  for (const fn of [...motionEnabledListeners]) fn();
}

/* ------------------------------------------------------------ sway store
 * The live sway offset (degrees of aim pan), written ONLY by the
 * driver and read by Scene's camera rig + fan refit. It is deliberately
 * NOT part of ViewAdjust: no gesture channel opens for it, nothing
 * commits, nothing persists — centring it returns the view to exactly
 * the saved manual tilt/zoom. */

let motionSwayDeg = 0;
const motionSwayListeners = new Set<() => void>();
export function getMotionSwayDeg(): number { return motionSwayDeg; }
export function subscribeMotionSway(fn: () => void): () => void {
  motionSwayListeners.add(fn);
  return () => { motionSwayListeners.delete(fn); };
}
export function setMotionSwayDeg(v: number): void {
  const next = Number.isFinite(v) ? v : 0;
  if (next === motionSwayDeg) return;
  motionSwayDeg = next;
  for (const fn of [...motionSwayListeners]) fn();
}

/* -------------------------------------------------- quick-suspend store
 * The in-table Motion button's state (owner, 2026-11-08): while the
 * option is on, the button flips this IN-MEMORY flag; Scene feeds it to
 * the driver as the 'quick' suspend reason, so a tap freezes tilt and
 * sway in place and the next tap resumes with a fresh re-baseline. The
 * saved setting is never rewritten by the button — turning the option
 * off in Settings clears this (above), and it starts unset on load. */

let motionQuickSuspended = false;
const motionQuickListeners = new Set<() => void>();
export function getMotionQuickSuspended(): boolean { return motionQuickSuspended; }
export function subscribeMotionQuickSuspend(fn: () => void): () => void {
  motionQuickListeners.add(fn);
  return () => { motionQuickListeners.delete(fn); };
}
export function setMotionQuickSuspended(on: boolean): void {
  const v = on === true;
  if (v === motionQuickSuspended) return;
  motionQuickSuspended = v;
  for (const fn of [...motionQuickListeners]) fn();
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
  setMotionSwayDeg(0);
  setMotionQuickSuspended(false);
  sensorsAsked = false;
}

/* ---------------------------------------------------- permission/probe */

/**
 * RE-ARMING ON LAUNCH (owner, 2026-11-13: "The motion view setting only ever works if I toggle it
 * off then on").
 *
 * iOS hands out motion access for ONE page session, and only from inside a tap. The Settings
 * switch asks at the moment it is turned on, so the session it was turned on in worked — but the
 * saved setting came back ON at the next launch with nobody having asked, the driver listened to a
 * sensor that stayed silent, and the only way to get the question asked again was to flip the
 * switch off and on.
 *
 * So while the option is on and this session has not asked yet, the first tap anywhere asks.
 * Platforms with no permission step (Android, desktop) need nothing and get no listener. A
 * refusal is not asked again this session — the switch in Settings still can be.
 */
let sensorsAsked = false;

/** True when this platform gates motion behind a tap and this session has not been through it. */
export function motionNeedsTap(orientationCtor?: unknown): boolean {
  if (sensorsAsked) return false;
  const ctor = arguments.length ? orientationCtor : (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>)['DeviceOrientationEvent'] : undefined);
  return typeof (ctor as PermissionCtor | null | undefined)?.requestPermission === 'function';
}

/**
 * Ask for motion access on the next tap. Returns the disarm (call it when the option turns off or
 * the table unmounts). `target` and `env` are injectable for tests.
 */
export function armMotionSensorsOnTap(target?: MotionEventTargetLike, env: MotionSensorEnv = {}): () => void {
  const t = target ?? (typeof window !== 'undefined' ? (window as unknown as MotionEventTargetLike) : undefined);
  const has = Object.prototype.hasOwnProperty.call(env, 'orientationCtor');
  if (!t || !(has ? motionNeedsTap(env.orientationCtor) : motionNeedsTap())) return () => {};
  let live = true;
  const off = () => {
    if (!live) return;
    live = false;
    for (const type of MOTION_TAP_EVENTS) { try { t.removeEventListener(type, onTap as never, true); } catch { /* ignore */ } }
  };
  const onTap = () => {
    if (!live) return;
    off();
    sensorsAsked = true; // one question per session, whatever the answer
    // requestPermission is called synchronously inside enableMotionSensors, so it rides this tap.
    void enableMotionSensors(env).catch(() => undefined);
  };
  for (const type of MOTION_TAP_EVENTS) { try { t.addEventListener(type, onTap as never, true); } catch { /* ignore */ } }
  return off;
}
/** The events iOS counts as a tap for permission purposes. */
export const MOTION_TAP_EVENTS = ['touchend', 'click'] as const;

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
      sensorsAsked = true; // granted for this page session
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
 * sensor stream can never write settings per tick. The ROLL channel
 * rides the same samples, anchor and smoothing family, but writes only
 * the live sway store — no gesture, no commit, no persistence — and
 * centres the moment the driver stops running.
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
  private swaySmoother = new LeanSmoother();
  private anchored = false;
  private pendingAnchor = false;
  private anchorLean = 0;
  private anchorRoll = 0;
  private anchorTilt = 0;
  private lastSampleAt: number | null = null;

  private gestureOpen = false;
  private lastChangeAt = 0;
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
      this.rest();
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
    this.rest();
    this.detach();
    setMotionSwayDeg(0); // the live offset dies with the driver
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
      this.rest();
      // Motion stopped: the sway offset is released at once and the
      // view rests at exactly the saved manual tilt/zoom again.
      setMotionSwayDeg(0);
      this.swaySmoother.reset();
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
    this.rest();
    setMotionSwayDeg(0);
    this.pendingAnchor = true;
  };

  private onOrientation = (e: unknown): void => {
    const ev = e as { beta?: unknown; gamma?: unknown } | null | undefined;
    const angle = this.angleFn();
    const lean = leanDegFromOrientation(numOrNull(ev?.beta), numOrNull(ev?.gamma), angle);
    const roll = rollDegFromOrientation(numOrNull(ev?.beta), numOrNull(ev?.gamma), angle);
    if (lean === null || roll === null) return;
    const now = this.nowFn();
    const dt = this.lastSampleAt === null ? 0 : Math.min(250, Math.max(0, now - this.lastSampleAt));
    this.lastSampleAt = now;
    if (!this.running()) return;
    if (this.pendingAnchor || !this.anchored) {
      // Calibration: this posture is neutral — BOTH axes anchor on the
      // same sample, one shared calibration moment — and the view's
      // current tilt is the base the lean adds to. The view does not
      // move, and any sway from before the pause is centred.
      this.smoother.reset(lean);
      this.swaySmoother.reset(roll);
      this.anchorLean = lean;
      this.anchorRoll = roll;
      this.anchorTilt = getViewAdjustState().adj.tilt;
      setMotionSwayDeg(0);
      this.anchored = true;
      this.pendingAnchor = false;
      return;
    }
    // Sway first: it writes its own live store and must land even when
    // the tilt below is inside its epsilon and returns early.
    const smoothedRoll = this.swaySmoother.push(roll, dt);
    const sway = swayForRollDelta(smoothedRoll - this.anchorRoll);
    if (Math.abs(sway - getMotionSwayDeg()) > MOTION_SWAY_EPSILON) setMotionSwayDeg(sway);
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
    // Quiet for a while: the readout chip lingers out. Nothing is saved — see rest().
    if (this.nowFn() - this.lastChangeAt >= MOTION_SETTLE_MS) this.closeGesture();
  };

  private openGestureIfNeeded(now: number): void {
    if (this.gestureOpen) return;
    beginViewAdjustGesture();
    this.gestureOpen = true;
    this.lastChangeAt = now;
  }

  private closeGesture(): void {
    if (!this.gestureOpen) return;
    releaseViewAdjustGesture();
    this.gestureOpen = false;
  }

  /**
   * Motion is stopping (paused, a touch, a sheet, the toggle, a rotation, unmount): the lean it
   * added is taken back and the view rests at the tilt it was anchored on — the player's own saved
   * tilt. THE LEAN IS NEVER SAVED (owner, 2026-11-13: "both the sitting and standing view seem way
   * too high up"). It used to be written into the saved tilt, and each new anchor then started
   * from that already-leaned value, so the view crept a little further every session until it sat
   * pinned at the limit. Like the sway, the lean is a live offset and nothing more.
   */
  private rest(): void {
    if (this.anchored) {
      const cur = getViewAdjustState().adj;
      if (cur.tilt !== this.anchorTilt) updateViewAdjustLive({ tilt: this.anchorTilt, zoom: cur.zoom });
    }
    this.closeGesture();
  }
}
