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
 *     fraction with most of the trip already covered; the dip then unwinds over
 *     a brief flop while the travel bites in with hard deceleration.
 *  4. A SETTLE SKID (owner, 2026-11-01, on the toss ship: "The card falling
 *     animation is better but when they hit the table, they have no slide at
 *     all, which isn't very realistic"): the toss was approved, the dead stop
 *     was not — a real card keeps its momentum for a few centimetres after it
 *     is flat. So the travel curve no longer completes at the flop's end: a
 *     short share of the trip (the skid, sized in card lengths per family —
 *     drive most, glide mid, flick short, lob least) is still uncovered when
 *     the card becomes flat, and the same ease-out tail covers it while the
 *     card sits flat on the felt, bleeding speed to a stop BEFORE t = 1. Not
 *     the 2026-10-29 flat skate (that travelled flat for ~325 ms) and not the
 *     2026-10-31 dead stop: ~90–140 ms of flat travel over ~0.06–0.18 card
 *     lengths, entered at the flop's own exit speed — the curve is one
 *     analytic ease, there is no seam to hide.
 *  5. Corner clearance, as before: every frame adds exactly the lift that keeps
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
 *  - `skidScale` multiplies the family settle-skid length (see the header):
 *    how much momentum the toss still carries when it gets flat. Absent = 1.
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
  skidScale?: number;
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

/** Where a glide's flop finishes and the card is flat (its settle skid runs from here). */
const GLIDE_REST_BY = 0.58;
/** Where a flick's snap-down finishes and the card is flat (its settle skid runs from here). */
const FLICK_REST_BY = 0.78;
/** A flick's centre has finished descending by this fraction. */
const FLICK_SETTLE_BY = 0.62;

/**
 * Settle-skid lengths (world units; a card is CH = 0.35 long, so the base
 * values are ~0.13 / ~0.07 / ~0.11 card lengths) and the largest share of a
 * trip a skid may take — a short hop to a near spot must not skid most of its
 * trip. The skid is what's still uncovered when the card becomes flat; each
 * family's travel curve is re-windowed so exactly this share remains there
 * (see skidEase), and the share is scaled by the variant's `skidScale`.
 */
const SKID_LEN: Record<'glide' | 'flick' | 'flight', number> = { glide: 0.045, flick: 0.024, flight: 0.038 };
const SKID_MAX_SHARE: Record<'glide' | 'flick' | 'flight', number> = { glide: 0.075, flick: 0.06, flight: 0.09 };
/** A flight card is flat from here (the slap has completed). */
const FLIGHT_FLAT_BY = 0.94;
/** The flight skid joins the airborne curve here, mid-slap (dip ~5°), so the join hides in the slap. */
const FLIGHT_SKID_JOIN = 0.89;
/** …and has fully bled its momentum by here, before the tween ends. */
const FLIGHT_SKID_END = 0.98;

/** The skid as a share of this trip: the family's length, scaled, capped by share. */
function skidShare(motion: 'glide' | 'flick' | 'flight', scale: number, distXZ: number): number {
  if (!(distXZ > 1e-6)) return 0;
  return Math.min((SKID_LEN[motion] * scale) / distXZ, SKID_MAX_SHARE[motion]);
}

/**
 * The travel ease `1-(1-w)^k` re-windowed so the card still has `share` of
 * the trip to cover at `flatBy` (when it becomes flat) and completes at the
 * window end E > flatBy: one analytic ease, so the skid is the curve's own
 * tail — the card enters it at speed and friction-bleeds to rest, with no
 * join. With share = 0 this is exactly the old curve over [0, flatBy]. When
 * the solved E runs past 1 (a short trip with a fat share) the curve is
 * renormalized so the endpoint stays exact; its end slope is ~0 there.
 */
function skidEase(t: number, flatBy: number, k: number, share: number): number {
  if (share <= 0) { const v = clamp01(t / flatBy); return 1 - Math.pow(1 - v, k); }
  const E = flatBy / (1 - Math.pow(share, 1 / k));
  if (E <= 1) { const w = clamp01(t / E); return 1 - Math.pow(1 - w, k); }
  return (1 - Math.pow(1 - t / E, k)) / (1 - Math.pow(1 - 1 / E, k));
}

/** Leading-edge dip (radians) when a variant doesn't carry its own. */
const DIP_DEFAULT: Partial<Record<PlayFlightMotion, number>> = { flight: 0.3, glide: 0.34, flick: 0.38 };

/**
 * The dip's envelope over the flight. Flight family: builds through the
 * descent, peaks at t = 0.82, and the slap unwinds it by FLIGHT_FLAT_BY —
 * completing the slap inside the tween is what leaves room for the settle
 * skid that follows it. Glide and flick: builds across the toss, peaks
 * exactly AT touchdown (impactFraction — the leading corner is what
 * touches), unwinds over the flop while the bite finishes, and is zero from
 * the rest fraction on.
 */
function dipEnvelope(motion: PlayFlightMotion, t: number): number {
  if (motion === 'flight') {
    if (t <= 0.5) return 0;
    if (t <= 0.82) return smoothstep((t - 0.5) / 0.32);
    if (t >= FLIGHT_FLAT_BY) return 0;
    return 1 - smoothstep((t - 0.82) / (FLIGHT_FLAT_BY - 0.82));
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
  const distXZ = Math.hypot(tp.x - sp.x, tp.z - sp.z);
  const variant = opts.motion === 'slide' ? undefined : opts.variant;
  const arc = (opts.arc ?? 0) * (variant?.arcScale ?? 1);
  const skidScale = variant?.skidScale ?? 1;

  let eXZ: number; // horizontal travel
  let eY: number; // centre descent
  let eRot: number; // levelling
  // The pre-skid travel curve, kept as the driver for scale and the clearance
  // floor's rise: both must complete on the schedule the corner law was proven
  // against, even though the position itself now travels on into the skid.
  let eSettle: number;
  let hop = 0;
  if (opts.motion === 'glide') {
    // Toss until touchdown (the same fraction landTiming fires the landing sound
    // at); then the flop: the dip unwinds while the bite of travel decelerates
    // hard, the card is flat from GLIDE_REST_BY — and then SKIDS: the travel
    // curve is re-windowed (skidEase) so the skid's share of the trip is still
    // uncovered at the flop's end and its ease-out tail covers it flat on the
    // felt, at rest before t = 1. Descent keeps the old window, so by the time
    // the skid runs the centre is already at rest height.
    const toss = impactFraction('glide');
    const v = clamp01(clamped / GLIDE_REST_BY);
    eSettle = 1 - Math.pow(1 - v, 2.6);
    eXZ = skidEase(clamped, GLIDE_REST_BY, 2.6, skidShare('glide', skidScale, distXZ));
    eY = 1 - Math.pow(1 - v, 2);
    eRot = glideEase(clamp01(clamped / toss));
    hop = clamped < toss ? ballisticHop(clamped / toss) * arc * Math.min(1, dist) : 0;
  } else if (opts.motion === 'flick') {
    // A flicked card (owner, 2026-10-30): quick, flat, snapping down. Travel is
    // front-loaded hardest of all — most of the trip is done by touchdown
    // (landTiming's flick fraction, where the landing sound fires) — then the
    // dip unwinds over the snap-down while the bite finishes, and a SHORT
    // settle skid (the family's skid is the shortest: a flick sticks fast)
    // bleeds the last of it flat, at rest before t = 1. Same total duration
    // as any other play — the speed is in the shape.
    const toss = impactFraction('flick');
    const v = clamp01(clamped / FLICK_REST_BY);
    eSettle = 1 - Math.pow(1 - v, 2.2);
    eXZ = skidEase(clamped, FLICK_REST_BY, 2.2, skidShare('flick', skidScale, distXZ));
    const w = clamp01(clamped / FLICK_SETTLE_BY);
    eY = 1 - Math.pow(1 - w, 2.2);
    eRot = easeInOut(clamp01(clamped / (toss * 0.92)));
    hop = clamped < toss ? ballisticHop(clamped / toss) * arc * Math.min(1, dist) : 0;
  } else if (opts.motion === 'slide') {
    // Reduced motion: the old straight ease, unchanged except for corner clearance.
    eXZ = eY = eRot = liftEase(clamped);
    eSettle = eXZ;
  } else {
    // The toss: travel leaves the hand fast and arrives firm (no symmetric
    // easeInOut drift), the centre falls on an accelerating curve, and the hop
    // is ballistic. The dip's slap brings the card flat by FLIGHT_FLAT_BY, and
    // from FLIGHT_SKID_JOIN the airborne curve hands over to a Hermite skid
    // whose entry slope IS the airborne curve's own exit slope — the card
    // slaps down still moving and friction-bleeds to rest at FLIGHT_SKID_END.
    const share = skidShare('flight', skidScale, distXZ);
    if (share <= 0) {
      eXZ = 1 - Math.pow(1 - clamped, 1.9);
    } else {
      const g = (x: number) => 1 - Math.pow(1 - x, 1.9);
      const A = (1 - share) / g(FLIGHT_SKID_JOIN);
      if (clamped <= FLIGHT_SKID_JOIN) eXZ = A * g(clamped);
      else if (clamped >= FLIGHT_SKID_END) eXZ = 1;
      else {
        const u = (clamped - FLIGHT_SKID_JOIN) / (FLIGHT_SKID_END - FLIGHT_SKID_JOIN);
        // Entry slope of the skid segment, in segment units: the airborne
        // curve's exit slope, clamped so the Hermite stays monotone.
        const s0 = Math.min(1.6, (A * 1.9 * Math.pow(1 - FLIGHT_SKID_JOIN, 0.9) * (FLIGHT_SKID_END - FLIGHT_SKID_JOIN)) / share);
        eXZ = (1 - share) + share * (s0 * (u * u * u - 2 * u * u + u) + (3 * u * u - 2 * u * u * u));
      }
    }
    eSettle = eXZ;
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
  // The bend lives in the AIRBORNE phase: a glide/flick card is flat from its
  // rest fraction on and a flight card from FLIGHT_FLAT_BY — a bend that kept
  // unwinding past there would drag the landed card sideways during its
  // settle skid (a residual slide the traces caught in the old design), so
  // the envelope closes at the flat point and the flop/slap carries the last
  // of the bend home.
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
          : Math.sin(Math.PI * clamp01(clamped / FLIGHT_FLAT_BY));
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
    // spin unwinds inside the toss window and the settle is clean; a flight
    // card unwinds its spin by the time it is flat (FLIGHT_FLAT_BY), so the
    // settle skid that follows runs straight along the throw.
    const env = opts.motion === 'glide' || opts.motion === 'flick'
      ? Math.sin(Math.PI * clamp01(clamped / impactFraction(opts.motion)))
      : Math.sin(Math.PI * clamp01(clamped / FLIGHT_FLAT_BY));
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
  const s = from.s + (to.s - from.s) * eSettle;
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
    const blend = smoothstep((eSettle - (blendEnd - 0.13)) / 0.13);
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
    // Skid scales follow the toss's physics: the lob drops steeply and sticks
    // (least), the drive arrives low and fast and slides (most).
    case 'lob': return { arcScale: 1.5, dip: 0.18, skidScale: 0.45 };
    case 'drive': return { arcScale: 0.55, levelBy: 0.68, dip: 0.44, spin: 0.3 * sign, skidScale: 1.5 };
    case 'curve': return { arcScale: 0.95, curve: 0.13 * sign, spin: -0.4 * sign, dip: 0.32, skidScale: 1.1 };
    case 'spinner': return { arcScale: 1.1, spin: 1.0 * sign, skidScale: 0.9 };
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
    // A harder release keeps more of its momentum into the settle skid.
    skidScale: 0.6 + 0.7 * e,
  };
}
