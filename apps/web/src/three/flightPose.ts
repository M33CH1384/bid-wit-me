import { Quaternion, Vector3 } from 'three';
import { impactFraction } from '../landTiming';
import { GATHER_CLEARANCE, gatherClearanceLift, minCardCornerY } from './gather';
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
 * The 2026-10-29 fix kept the corner off the felt by levelling the card before contact
 * and letting it SKID flat into its spot. That cured the stab — and then the owner
 * (2026-10-31, on the toss-variation ship): "Now the way the cards slide doesn't look
 * realistic at all." He was right about the mechanism: the glide touched down at
 * t = 0.35 with ~46% of its trip still untravelled and then spent ~325 ms flat on
 * the felt still travelling; the flick skated ~225 ms the same way; even the flight
 * family levelled early and descended parallel on a symmetric sine hop, so cards
 * hovered and pucked instead of being thrown.
 *
 * The current design is a TOSS, inside the same timing envelope (same durations,
 * same touchdown fractions — landTiming is untouched — so holds, landing cues and
 * the sweep/review anchors, which are all delay+duration arithmetic, never move):
 *  1. Ballistic hop: the hop rises fast, flattens into its peak at ~45% and falls
 *     accelerating, arriving at full speed — a thrown card, not a sine levitation.
 *     Travel is front-loaded the same way: fastest out of the hand, firm stop.
 *  2. Pitch travel: the card tips as it flies — its leading edge drops (the "dip",
 *     a rotation about the horizontal axis across the direction of travel) — so it
 *     meets the felt CORNER-FIRST, never whole-face. On the flight family the dip
 *     peaks late (~t = 0.9) and unwinds in the last tenth: the slap down flat.
 *  3. Touchdown + a SHORT bite: glide/flick cards arrive at their touchdown
 *     fraction with ~90%+ of the trip already covered; the dip then unwinds over
 *     a brief flop while the last few percent of travel bite in with hard
 *     deceleration, and the card is fully at rest well before t = 1. A card that
 *     lands and STOPS, not one that glides to its spot.
 *  4. Corner clearance, as before: every frame adds exactly the lift that keeps
 *     the card's lowest corner at or above its floor — computed from the final
 *     quaternion (dip and spin folded in first), so the corner can GRAZE but
 *     never crosses. Near the spot the floor itself rises from the felt to the
 *     landing spot's own rest height, so a dipped corner rides onto the pile
 *     instead of sinking into the cards already there. Endpoints that already
 *     clear are unchanged: pose(0) is `from`, pose(1) is `to`, exactly.
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
 *  - `dip` is the pitch travel (radians): how far the leading edge drops as
 *    the card flies, so it lands corner-first. Absent = the chassis default.
 *  - `levelBy` (flight chassis only) moves when the base levelling slerp
 *    completes; the dip carries the pitch story from there to the slap.
 * The corner-clearance lift is applied LAST, from the final quaternion and
 * scale, so every variant keeps the no-puncture guarantee by construction.
 * The reduced-motion 'slide' ignores variants entirely.
 */
export interface FlightVariant {
  arcScale?: number;
  curve?: number;
  spin?: number;
  dip?: number;
  levelBy?: number;
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
const smoothstep = (u: number) => { const c = clamp01(u); return c * c * (3 - 2 * c); };

/** A flight card's base levelling completes by this fraction of the flight. */
export const FLIGHT_LEVEL_BY = 0.8;

/**
 * Projectile hop over u in [0, 1]: a fast rise that flattens into the peak,
 * then a fall that accelerates all the way to touchdown. A thrown card leaves
 * the hand at its fastest and arrives at its fastest; the old sin(pi t) hop
 * rose exactly as fast as it fell, which read as levitation.
 */
const HOP_PEAK = 0.45;
function ballisticHop(u: number): number {
  const c = clamp01(u);
  if (c <= HOP_PEAK) { const r = 1 - c / HOP_PEAK; return 1 - r * r; }
  const f = (c - HOP_PEAK) / (1 - HOP_PEAK);
  return 1 - f * f;
}

/** Where a glide's flop finishes and the card is at rest (fraction of flight). */
const GLIDE_REST_BY = 0.58;
/** Where a flick's snap-down finishes and the card is at rest. */
const FLICK_REST_BY = 0.78;
/** A flick's centre has finished descending by this fraction. */
const FLICK_SETTLE_BY = 0.62;

/** Leading-edge dip (radians) when a variant doesn't carry its own. */
const DIP_DEFAULT: Partial<Record<PlayFlightMotion, number>> = { flight: 0.3, glide: 0.34, flick: 0.38 };

/**
 * The dip's envelope over the flight. Flight family: builds through the
 * descent, peaks at t = 0.9, unwinds in the last tenth (the slap). Glide and
 * flick: builds across the toss, peaks exactly AT touchdown (impactFraction —
 * the leading corner is what touches), unwinds over the flop while the bite
 * finishes, and is zero from the rest fraction on.
 */
function dipEnvelope(motion: PlayFlightMotion, t: number): number {
  if (motion === 'flight') {
    if (t <= 0.55) return 0;
    if (t <= 0.9) return smoothstep((t - 0.55) / 0.35);
    return 1 - smoothstep((t - 0.9) / 0.1);
  }
  const toss = impactFraction(motion);
  const restBy = motion === 'glide' ? GLIDE_REST_BY : FLICK_REST_BY;
  if (t <= toss) return smoothstep(t / toss);
  if (t >= restBy) return 0;
  const u = (t - toss) / (restBy - toss);
  return 1 - u * u;
}

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
    // Toss until touchdown (the same fraction landTiming fires the landing sound
    // at), arriving with ~91% of the trip already covered; then the flop: the
    // dip unwinds while the last bite of travel decelerates hard, and the card
    // is at rest from GLIDE_REST_BY on. Travel and descent share one curve over
    // the rest window so there is no seam at touchdown.
    const toss = impactFraction('glide');
    const v = clamp01(clamped / GLIDE_REST_BY);
    eXZ = 1 - Math.pow(1 - v, 2.6);
    eY = 1 - Math.pow(1 - v, 2);
    eRot = glideEase(clamp01(clamped / toss));
    hop = clamped < toss ? ballisticHop(clamped / toss) * arc * Math.min(1, dist) : 0;
  } else if (opts.motion === 'flick') {
    // A flicked card (owner, 2026-10-30): quick, flat, snapping down. Travel is
    // front-loaded hardest of all — ~95% of the trip is done by touchdown
    // (landTiming's flick fraction, where the landing sound fires) — then the
    // dip unwinds over the snap-down while the small bite finishes; the card
    // is at rest from FLICK_REST_BY on. Same total duration as any other play —
    // the speed is in the shape.
    const toss = impactFraction('flick');
    const v = clamp01(clamped / FLICK_REST_BY);
    eXZ = 1 - Math.pow(1 - v, 2.2);
    const w = clamp01(clamped / FLICK_SETTLE_BY);
    eY = 1 - Math.pow(1 - w, 2.2);
    eRot = easeInOut(clamp01(clamped / (toss * 0.92)));
    hop = clamped < toss ? ballisticHop(clamped / toss) * arc * Math.min(1, dist) : 0;
  } else if (opts.motion === 'slide') {
    // Reduced motion: the old straight ease, unchanged except for corner clearance.
    eXZ = eY = eRot = liftEase(clamped);
  } else {
    // The toss: travel leaves the hand fast and arrives firm (no symmetric
    // easeInOut drift), the centre falls on an accelerating curve, and the hop
    // is ballistic. Contact is at t = 1 (impactFraction): the dip's slap, not
    // an early flat settle, is what brings the card down.
    eXZ = 1 - Math.pow(1 - clamped, 1.9);
    eY = 1 - Math.pow(1 - clamped, 2);
    eRot = easeInOut(clamp01(clamped / (variant?.levelBy ?? FLIGHT_LEVEL_BY)));
    hop = ballisticHop(clamped) * arc * Math.min(1, dist);
  }

  const p = new Vector3(
    sp.x + (tp.x - sp.x) * eXZ,
    sp.y + (tp.y - sp.y) * eY + hop,
    sp.z + (tp.z - sp.z) * eXZ,
  );
  // Lateral curve: bend the path sideways, peaking mid-flight and returning to
  // the straight line at both ends, so the launch and landing poses stay exact.
  // The bend lives in the AIRBORNE phase: a flight card is airborne throughout,
  // but a glide/flick card is at rest from its rest fraction on — a bend that
  // kept unwinding to t = 1 would drag the landed card sideways (a residual
  // slide the traces caught), so there the envelope closes at the rest point
  // and the flop carries the last of the bend home.
  const curve = variant?.curve ?? 0;
  if (curve !== 0) {
    const hx = tp.x - sp.x;
    const hz = tp.z - sp.z;
    const hl = Math.hypot(hx, hz);
    if (hl > 1e-6) {
      const bendEnv = opts.motion === 'glide'
        ? Math.sin(Math.PI * clamp01(clamped / GLIDE_REST_BY))
        : opts.motion === 'flick'
          ? Math.sin(Math.PI * clamp01(clamped / FLICK_REST_BY))
          : Math.sin(Math.PI * clamped);
      const bend = curve * bendEnv * Math.min(1, dist);
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
    // spin unwinds inside the toss window and the settle is clean; a flight card
    // keeps unwinding across its whole arc and settles exactly on the spot.
    const env = opts.motion === 'glide' || opts.motion === 'flick'
      ? Math.sin(Math.PI * clamp01(clamped / impactFraction(opts.motion)))
      : Math.sin(Math.PI * clamped);
    if (env > 0) q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spin * env).multiply(q);
  }
  // Pitch travel: the leading edge drops as the card flies (the dip), a
  // rotation about the horizontal axis across the direction of travel, folded
  // into q BEFORE the clearance lift like the spin — so the lift is computed
  // from the true lowest corner of the dipped card, and the corner can graze
  // the felt/pile but never cross it.
  const dipAmp = opts.motion === 'slide' ? 0 : (variant?.dip ?? DIP_DEFAULT[opts.motion] ?? 0);
  const dip = dipAmp * dipEnvelope(opts.motion, clamped);
  const hx = tp.x - sp.x;
  const hz = tp.z - sp.z;
  const hl = Math.hypot(hx, hz);
  if (dip > 0 && hl > 1e-6) {
    const axis = new Vector3(hz / hl, 0, -hx / hl);
    q = new Quaternion().setFromAxisAngle(axis, dip).multiply(q);
  }
  const s = from.s + (to.s - from.s) * eXZ;
  // No corner through the felt, whatever the tilt/scale at this frame. The
  // floor rises from the bare felt to the landing spot's own rest height as
  // the travel completes, so a dipped corner rides onto the pile at the spot
  // instead of sinking into the cards already there; early in the flight (and
  // everywhere for the reduced-motion slide) it is exactly the original law.
  if (opts.motion === 'slide') {
    p.y += gatherClearanceLift(p.y, q, s);
  } else {
    const restCornerY = minCardCornerY(tp.y, quatOf(to.q), to.s);
    // The floor reaches the spot's rest height by the moment of touchdown
    // (glide/flick travel shares) resp. just before the flight family's slap.
    const blendEnd = opts.motion === 'glide' ? 0.91 : opts.motion === 'flick' ? 0.95 : 0.97;
    const blend = smoothstep((eXZ - (blendEnd - 0.13)) / 0.13);
    const floorY = Math.max(GATHER_CLEARANCE, restCornerY * blend);
    p.y += gatherClearanceLift(p.y, q, s, floorY - GATHER_CLEARANCE);
  }
  return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], s };
}

/** The named toss family for ordinary plays. 'standard' is the classic toss. */
export type FlightVariantId = 'standard' | 'lob' | 'drive' | 'curve' | 'spinner';

export const FLIGHT_VARIANT_IDS: readonly FlightVariantId[] = ['standard', 'lob', 'drive', 'curve', 'spinner'];

const variantFor = (id: FlightVariantId, sign: number): FlightVariant => {
  switch (id) {
    case 'lob': return { arcScale: 1.5, dip: 0.18 };
    case 'drive': return { arcScale: 0.55, levelBy: 0.68, dip: 0.44, spin: 0.3 * sign };
    case 'curve': return { arcScale: 0.95, curve: 0.13 * sign, spin: -0.4 * sign, dip: 0.32 };
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
 * release, the flatter the skim and the harder the snap-down; the release's
 * lateral direction bends and spins the card the way the hand threw it.
 * Returns null when the release was a gentle place, not a flick (the caller
 * then uses the seeded toss family). Pure in the release vector, which rides
 * the play record — every client derives the same flick for the same play.
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
    dip: 0.34 + 0.1 * e,
  };
}
