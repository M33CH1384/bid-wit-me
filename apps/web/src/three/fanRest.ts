import { liftEase } from './handLift';

/**
 * Fan rest (owner, 2026-10-28): a seat's fanned cards LOWER and TIGHTEN
 * while that seat is off-turn, and raise/open back to the normal spread
 * when the seat becomes the one to act. Scope: the SITTING camera rests
 * at any aspect (portrait included — it is the phone's home camera), and
 * the STANDING camera rests in landscape; portrait + Standing never
 * rests, so that framing stays byte-unchanged.
 *
 * This module is the pure state half of the feature — no three.js, no DOM
 * (except the reduced-motion input, which callers pass in):
 *  - `fanRestTarget` is the scope + turn gate: the rest amount a seat's fan
 *    SHOULD settle at (0 = open/normal, 1 = fully lowered + tightened).
 *  - `FanRestAnim` + `stepFanRest` ease a fan between those amounts over
 *    FAN_REST_MS with the fan's own lift ease (monotonic, bounded, no
 *    overshoot). Under reduced motion the amount settles instantly.
 * The geometry half lives in layout.ts (`FanOpts.rest` on the human fan,
 * the `rest` argument of `opponentFan`): rest is a pose applied on top of
 * the open layout — same card scale, same solver — so a resting fan and
 * an open fan differ only in anchor height, spread and roll.
 *
 * There is deliberately NO seat exemption here: the human's own fan rests
 * off-turn like every other seat (it is raised again the moment the human
 * is the active seat, because the target keys off that same signal).
 */

/** Unhurried turn-change settle, in ms (the camera's view tween is 700ms). */
export const FAN_REST_MS = 650;

export interface FanRestGate {
  /** Viewport aspect (width / height). Landscape means strictly > 1. */
  aspect: number;
  /** The table camera view. 'sitting' rests at any aspect; 'standing' rests in landscape only. */
  view: 'standing' | 'sitting';
  /** True when this seat is the one to act (bid or play — Table's actor). */
  seatIsActive: boolean;
}

/**
 * The rest amount a fan should settle at for a seat that is NOT the one
 * to act: 1 in the Sitting camera at any aspect, and 1 in the Standing
 * camera in landscape. Portrait + Standing always returns 0
 * (byte-unchanged behaviour there), a dead aspect (0 / NaN canvas)
 * never rests, and the active seat — the human included — always
 * returns 0 (raised/open, ready to tap).
 */
export function fanRestTarget(g: FanRestGate): number {
  if (g.seatIsActive) return 0;
  if (!(Number.isFinite(g.aspect) && g.aspect > 0)) return 0;
  if (g.view === 'sitting') return 1;
  if (!(g.aspect > 1)) return 0;
  return 1;
}

/** Seconds a rest/open transition takes. 0 under reduced motion (a snap). */
export function fanRestSeconds(reduced: boolean): number {
  return reduced ? 0 : FAN_REST_MS / 1000;
}

export interface FanRestAnim {
  /** Amount where the current leg started. */
  from: number;
  /** Amount the current leg is heading to (0 or 1 in practice). */
  to: number;
  /** Leg progress, 0..1. */
  t: number;
  /** The amount right now (eased). */
  value: number;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/** A rest anim settled at `initial` (Scene seeds it at the first target it sees, so a fan never animates on mount). */
export function fanRestAnim(initial = 0): FanRestAnim {
  const v = clamp01(initial);
  return { from: v, to: v, t: 1, value: v };
}

/**
 * Point an anim at a new target. A retarget continues from the amount the
 * fan is drawn at right now (no jump); under reduced motion it settles
 * on the target instantly.
 */
export function setFanRestTarget(a: FanRestAnim, target: number, reduced = false): FanRestAnim {
  const to = clamp01(target);
  if (reduced) return { from: to, to, t: 1, value: to };
  if (to === a.to) return a;
  return { from: a.value, to, t: 0, value: a.value };
}

/**
 * Advance an anim by `dtMs` (callers cap dt like the rest of the scene,
 * so a starved frame cannot fast-forward the settle). Eased with
 * liftEase: monotonic toward the target, bounded by [from, to] — the fan
 * never overshoots past either the open pose or the full rest pose.
 */
export function stepFanRest(a: FanRestAnim, dtMs: number, reduced = false): FanRestAnim {
  if (reduced) return a.to === a.value && a.t >= 1 ? a : { from: a.to, to: a.to, t: 1, value: a.to };
  if (a.t >= 1) return a;
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const t = Math.min(1, a.t + dt / FAN_REST_MS);
  return { from: a.from, to: a.to, t, value: a.from + (a.to - a.from) * liftEase(t) };
}
