import { Quaternion, Vector3 } from 'three';
import { impactFraction } from '../landTiming';
import { gatherClearanceLift } from './gather';
import { liftEase } from './handLift';
import type { Xform } from './layout';

/**
 * Played-card flight (a seat throws a card to its trick spot): 'flight', 'glide' and
 * reduced-motion 'slide' in Card3D all follow this one path. Pure, so tests sample the
 * exact poses the renderer applies.
 *
 * The defect (owner 2026-10-29: "when the corner of played cards hit the table it looks
 * as if it's going into the table instead of sliding into it at first"): the old path
 * lerped the card CENTRE and slerped the rotation on one shared ease, with no regard
 * for the card's lowest corner. On a glide the hop dies at touchdown (t = 0.35) while
 * the card is still ~46% un-rotated and the centre keeps descending, so the leading
 * corner is driven up to ~43 mm BELOW the felt (y = 0) — worst for the side seats —
 * during the phase that is supposed to read as a flat slide. The reduced-motion slide
 * stabbed the same way (~33 mm) in its first quarter.
 *
 * The fix, in three parts, inside the same total duration:
 *  1. Corner clearance: every frame adds exactly the lift (the gather's proven
 *     formula) that keeps the card's lowest corner at or above the felt. Endpoints
 *     that already clear are unchanged, so fans and trick spots look as before.
 *  2. Level before contact: rotation completes early — by touchdown on a glide
 *     (t = 0.35) and by t = 0.8 on a flight — so the card meets the felt FLAT.
 *  3. A real slide at the end: the centre reaches rest height when the card levels
 *     (glide: at touchdown; flight: by t = 0.85) while horizontal travel is still
 *     finishing on its decelerating ease, so the last stretch is the card skidding
 *     flat on the felt into its spot.
 */

export type PlayFlightMotion = 'flight' | 'glide' | 'slide';

export interface PlayFlightOpts {
  motion: PlayFlightMotion;
  /** Hop height of the toss (world units, scaled by travel distance as before). */
  arc?: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const glideEase = (t: number) => 1 - Math.pow(1 - Math.pow(t, 1.4), 3);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A flight card is fully level by this fraction of the flight. */
export const FLIGHT_LEVEL_BY = 0.8;
/** A flight centre reaches rest height by this fraction; the rest is flat slide. */
export const FLIGHT_SETTLE_BY = 0.85;

const quatOf = (q: Xform['q']): Quaternion => new Quaternion(q[0], q[1], q[2], q[3]);

/**
 * One frame of a played card's flight from `from` to `to` at t in [0, 1].
 * Endpoints are exact whenever they clear the felt themselves (fan slots and
 * trick spots do): pose(0) is `from`, pose(1) is `to`.
 */
export function playFlightPose(from: Xform, to: Xform, t: number, opts: PlayFlightOpts): Xform {
  const clamped = clamp01(t);
  const sp = new Vector3(...from.p);
  const tp = new Vector3(...to.p);
  const dist = sp.distanceTo(tp);
  const arc = opts.arc ?? 0;

  let eXZ: number; // horizontal travel
  let eY: number; // centre descent
  let eRot: number; // levelling
  let hop = 0;
  if (opts.motion === 'glide') {
    // Toss until touchdown (the same fraction landTiming fires the landing sound at),
    // then a flat slide: rotation and descent run on the toss window, horizontal
    // travel keeps its whole-flight decelerating ease.
    const toss = impactFraction('glide');
    const eToss = glideEase(clamp01(clamped / toss));
    eXZ = glideEase(clamped);
    eY = eToss;
    eRot = eToss;
    hop = clamped < toss ? Math.sin((Math.PI * clamped) / toss) * arc * Math.min(1, dist) : 0;
  } else if (opts.motion === 'slide') {
    // Reduced motion: the old straight ease, unchanged except for corner clearance.
    eXZ = eY = eRot = liftEase(clamped);
  } else {
    eXZ = easeInOut(clamped);
    eY = easeInOut(clamp01(clamped / FLIGHT_SETTLE_BY));
    eRot = easeInOut(clamp01(clamped / FLIGHT_LEVEL_BY));
    hop = Math.sin(Math.PI * clamped) * arc * Math.min(1, dist);
  }

  const p = new Vector3(
    sp.x + (tp.x - sp.x) * eXZ,
    sp.y + (tp.y - sp.y) * eY + hop,
    sp.z + (tp.z - sp.z) * eXZ,
  );
  // The slam landing bounce is NOT here: Card3D still adds it after this pose,
  // exactly where it always did (it only ever adds height, so the clearance
  // guarantee below is conservative).
  const q = new Quaternion().slerpQuaternions(quatOf(from.q), quatOf(to.q), eRot);
  const s = from.s + (to.s - from.s) * eXZ;
  // No corner through the felt, whatever the tilt/scale at this frame.
  p.y += gatherClearanceLift(p.y, q, s);
  return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], s };
}
