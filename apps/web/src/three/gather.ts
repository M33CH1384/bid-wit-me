import { Quaternion, Vector3 } from 'three';
import { CH, CT, CW, type Xform } from './layout';

/**
 * Trick-gather (won cards sliding/flipping to the winner's face-down pile).
 *
 * Root cause of the corner-through-the-table bug: the gather slerped a flat
 * face-up trick card (scale ~2.25) straight to the face-down pile quaternion.
 * That is a ~180-degree flip. Halfway through, the card is near vertical, so
 * its vertical half-extent is about (CH/2)*scale ~= 0.28-0.39 world units,
 * while the old centre path only hopped 0.15 above a ~0.01 centre height.
 * The leading edge therefore sank 0.12-0.19 world units BELOW the felt
 * (y=0) around t=0.47, for every seat (worse for side seats / larger spin).
 * Whether Demetrius saw it depended on seat, spin, scale and camera, hence
 * "sometimes".
 *
 * Fix: keep the same slerp/flip and the same endpoints, but add, every frame,
 * exactly the lift needed so the LOWEST card corner (computed from the
 * card's half-extents and its current orientation, not just its centre)
 * stays at least GATHER_CLEARANCE above the felt. Flat portions need ~no
 * lift; the near-vertical middle rises into a natural tossed flip and
 * settles back onto the pile with no endpoint change.
 */

/** Lowest allowed card corner during the gather, above the felt (y = 0). */
export const GATHER_CLEARANCE = 0.002;

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

const quatOf = (q: Xform['q'] | Quaternion): Quaternion =>
  q instanceof Quaternion ? q : new Quaternion(q[0], q[1], q[2], q[3]);

/**
 * Half of the card's vertical extent at this orientation/scale: the support
 * of the card box (CW x CH x CT, scaled) along world Y. The lowest corner
 * sits at centreY - this value, for any tilt/spin.
 */
export function cardVerticalHalfExtent(q: Xform['q'] | Quaternion, scale: number): number {
  const quat = quatOf(q);
  const ax = new Vector3(1, 0, 0).applyQuaternion(quat);
  const ay = new Vector3(0, 1, 0).applyQuaternion(quat);
  const az = new Vector3(0, 0, 1).applyQuaternion(quat);
  const s = Math.abs(scale);
  return (Math.abs(ax.y) * (CW / 2) + Math.abs(ay.y) * (CH / 2) + Math.abs(az.y) * (CT / 2)) * s;
}

/** World Y of the card's lowest corner at this centre height. */
export function minCardCornerY(centerY: number, q: Xform['q'] | Quaternion, scale: number): number {
  return centerY - cardVerticalHalfExtent(q, scale);
}

/** Extra centre height required so no corner goes below floorY + clearance. */
export function gatherClearanceLift(centerY: number, q: Xform['q'] | Quaternion, scale: number, floorY = 0): number {
  return Math.max(0, floorY + GATHER_CLEARANCE - minCardCornerY(centerY, q, scale));
}

/**
 * One gather frame: the Card3D 'flight' interpolation (eased lerp + hop +
 * quaternion slerp + scale ease) plus the corner-clearance lift above.
 * Pure, so tests sample the exact path the renderer follows. Endpoints are
 * unchanged whenever they already clear the felt (flat trick rest and the
 * pile rest both do), so landings/piles look exactly as before.
 */
export function gatherPose(from: Xform, to: Xform, t: number, arc = 0.15): Xform {
  const clamped = Math.min(1, Math.max(0, t));
  const e = easeInOut(clamped);
  const sp = new Vector3(...from.p);
  const tp = new Vector3(...to.p);
  const p = sp.clone().lerp(tp, e);
  const dist = sp.distanceTo(tp);
  p.y += Math.sin(Math.PI * clamped) * arc * Math.min(1, dist);
  const q = new Quaternion().slerpQuaternions(quatOf(from.q), quatOf(to.q), e);
  const s = from.s + (to.s - from.s) * e;
  p.y += gatherClearanceLift(p.y, q, s);
  return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], s };
}
