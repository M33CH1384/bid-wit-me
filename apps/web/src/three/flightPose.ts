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

export type PlayFlightMotion = 'flight' | 'glide' | 'slide' | 'flick';

/**
 * A toss character (owner, 2026-10-30: "every time I choose a card the animation
 * shouldn't always look like an underhand throw"). A variant reshapes a flight
 * INSIDE its existing timing envelope — same duration, same endpoints, same
 * landing spot; only the path between them changes:
 *  - `arcScale` multiplies the caller's hop height (a lob vs a drive).
 *  - `curve` bends the horizontal path sideways (world units at the mid-flight
 *    peak, scaled by travel distance like the hop); zero at both ends.
 *  - `spin` adds an in-flight yaw (radians at the envelope peak) that unwinds
 *    to exactly zero at the landing, so the card still settles on its spot's
 *    own rotation.
 *  - `levelBy` / `settleBy` (flight chassis only) move when the card levels
 *    and when its centre reaches rest height — an earlier settle means a
 *    longer flat skid into the spot.
 * The corner-clearance lift is applied LAST, from the final quaternion and
 * scale, so every variant keeps the no-puncture guarantee by construction.
 * The reduced-motion 'slide' ignores variants entirely.
 */
export interface FlightVariant {
  arcScale?: number;
  curve?: number;
  spin?: number;
  levelBy?: number;
  settleBy?: number;
}

export interface PlayFlightOpts {
  motion: PlayFlightMotion;
  /** Hop height of the toss (world units, scaled by travel distance as before). */
  arc?: number;
  /** Toss character for this play (see FlightVariant). Absent = the classic toss. */
  variant?: FlightVariant;
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
  const variant = opts.motion === 'slide' ? undefined : opts.variant;
  const arc = (opts.arc ?? 0) * (variant?.arcScale ?? 1);

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
  } else if (opts.motion === 'flick') {
    // A flicked card (owner, 2026-10-30): quick, flat, skimming. Horizontal travel
    // runs on the decelerating glide ease so most of the distance is covered early;
    // descent and levelling complete inside the toss window (landTiming's flick
    // fraction, where the landing sound fires); what remains is a flat skid into
    // the spot. Same total duration as any other play — the speed is in the shape.
    const toss = impactFraction('flick');
    eXZ = glideEase(clamped);
    eY = easeInOut(clamp01(clamped / toss));
    eRot = easeInOut(clamp01(clamped / (toss * 0.92)));
    hop = clamped < toss ? Math.sin((Math.PI * clamped) / toss) * arc * Math.min(1, dist) : 0;
  } else if (opts.motion === 'slide') {
    // Reduced motion: the old straight ease, unchanged except for corner clearance.
    eXZ = eY = eRot = liftEase(clamped);
  } else {
    eXZ = easeInOut(clamped);
    eY = easeInOut(clamp01(clamped / (variant?.settleBy ?? FLIGHT_SETTLE_BY)));
    eRot = easeInOut(clamp01(clamped / (variant?.levelBy ?? FLIGHT_LEVEL_BY)));
    hop = Math.sin(Math.PI * clamped) * arc * Math.min(1, dist);
  }

  const p = new Vector3(
    sp.x + (tp.x - sp.x) * eXZ,
    sp.y + (tp.y - sp.y) * eY + hop,
    sp.z + (tp.z - sp.z) * eXZ,
  );
  // Lateral curve: bend the path sideways, peaking mid-flight and returning to
  // the straight line at both ends, so the launch and landing poses stay exact.
  const curve = variant?.curve ?? 0;
  if (curve !== 0) {
    const hx = tp.x - sp.x;
    const hz = tp.z - sp.z;
    const hl = Math.hypot(hx, hz);
    if (hl > 1e-6) {
      const bend = curve * Math.sin(Math.PI * clamped) * Math.min(1, dist);
      p.x += (-hz / hl) * bend;
      p.z += (hx / hl) * bend;
    }
  }
  // The slam landing bounce is NOT here: Card3D still adds it after this pose,
  // exactly where it always did (it only ever adds height, so the clearance
  // guarantee below is conservative).
  let q = new Quaternion().slerpQuaternions(quatOf(from.q), quatOf(to.q), eRot);
  // In-flight spin: a yaw on top of the levelling slerp, enveloped to zero at
  // both ends (for a glide, inside the toss window) so the card still lands on
  // its spot's exact rotation. Folded into q BEFORE the clearance lift, so the
  // lift is computed from the true lowest corner of the spun card.
  const spin = variant?.spin ?? 0;
  if (spin !== 0) {
    // Glide and flick cards meet the felt at their touchdown fraction, so their
    // spin unwinds inside the toss window and the skid is clean; a flight card
    // keeps unwinding across its whole arc and settles exactly on the spot.
    const env = opts.motion === 'glide' || opts.motion === 'flick'
      ? Math.sin(Math.PI * clamp01(clamped / impactFraction(opts.motion)))
      : Math.sin(Math.PI * clamped);
    if (env > 0) q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spin * env).multiply(q);
  }
  const s = from.s + (to.s - from.s) * eXZ;
  // No corner through the felt, whatever the tilt/scale at this frame.
  p.y += gatherClearanceLift(p.y, q, s);
  return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], s };
}

/** The named toss family for ordinary plays. 'standard' is the classic toss. */
export type FlightVariantId = 'standard' | 'lob' | 'drive' | 'curve' | 'spinner';

export const FLIGHT_VARIANT_IDS: readonly FlightVariantId[] = ['standard', 'lob', 'drive', 'curve', 'spinner'];

const variantFor = (id: FlightVariantId, sign: number): FlightVariant => {
  switch (id) {
    case 'lob': return { arcScale: 1.5 };
    case 'drive': return { arcScale: 0.55, levelBy: 0.68, settleBy: 0.76, spin: 0.3 * sign };
    case 'curve': return { arcScale: 0.95, curve: 0.13 * sign, spin: -0.4 * sign };
    case 'spinner': return { arcScale: 1.1, spin: 1.0 * sign };
    default: return {};
  }
};

/**
 * Pick the toss for a play from its seed (the same playSeed the landing and
 * toss-height variation already use — the same play picks the same toss on
 * every client and on any re-render). `prev` is the previous play's variant:
 * the pick never repeats it back-to-back.
 */
export function pickFlightVariant(seed: number, prev?: FlightVariantId): { id: FlightVariantId; variant: FlightVariant } {
  let h = (Math.floor(Math.abs(Number.isFinite(seed) ? seed : 0)) >>> 0) || 1;
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  let idx = h % FLIGHT_VARIANT_IDS.length;
  if (FLIGHT_VARIANT_IDS[idx] === prev) idx = (idx + 1 + ((h >>> 8) % (FLIGHT_VARIANT_IDS.length - 1))) % FLIGHT_VARIANT_IDS.length;
  const id = FLIGHT_VARIANT_IDS[idx]!;
  const sign = (h >>> 5) & 1 ? 1 : -1;
  return { id, variant: variantFor(id, sign) };
}

/** Release speed (px/ms, releaseVector's scale) at or above which a drag play is a flick. */
export const FLICK_MIN_SPEED = 1.0;
/** A flick's energy caps here (slam.ts's SLAM_FULL — a wild flick is never wilder than a full slam). */
const FLICK_FULL_SPEED = 2.5;

/**
 * The flick toss for a drag play, shaped by the gesture itself: the faster the
 * release, the flatter the skim; the release's lateral direction bends and
 * spins the card the way the hand threw it. Returns null when the release was
 * a gentle place, not a flick (the caller then uses the seeded toss family).
 * Pure in the release vector, which rides the play record — every client
 * derives the same flick for the same play.
 */
export function flickFlightFor(rel: readonly [number, number] | undefined): FlightVariant | null {
  if (!rel) return null;
  const [rx, ry] = rel;
  if (!Number.isFinite(rx) || !Number.isFinite(ry)) return null;
  const speed = Math.hypot(rx, ry);
  if (speed < FLICK_MIN_SPEED) return null;
  const e = Math.min(1, (speed - FLICK_MIN_SPEED) / (FLICK_FULL_SPEED - FLICK_MIN_SPEED));
  const lat = Math.max(-1, Math.min(1, rx / FLICK_FULL_SPEED));
  return {
    arcScale: 0.34 - 0.14 * e,
    curve: lat * 0.17,
    spin: lat * (0.3 + 0.2 * e),
  };
}
