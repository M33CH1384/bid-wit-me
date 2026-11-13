import { Quaternion, Vector3 } from 'three';
import type { Card } from '@spades/rules';
import { GATHER_CLEARANCE, gatherClearanceLift, minCardCornerY } from './gather';
import { flatRest, jitterOf, opponentFan, trickSpot, type SeatPos, type Xform } from './layout';
import { playSeed, runScatter, type RunDrop } from './landing';
import { RUN_ZOOM_MS } from '../runIt';

/**
 * 'Run it!' slam (owner, 2026-11-01: "the run it animation suck honestly, i really
 * want to see an animation where the cards slowly raise from the hand and in an
 * upward then downward arc slam to the table"). The claimer's remaining cards get
 * ONE two-beat flight, replacing the old 0.3 s throw-down barrage:
 *
 *  1. RAISE (t < RUN_SLAM_RAISE_END): the card lifts SLOWLY out of the fan on a
 *     smoothstep — a deliberate, stately rise, drifting only a little toward the
 *     table while it levels face-up flat. It reads as the player lifting the
 *     cards to show them before throwing them down. (Retune, owner 2026-11-01:
 *     "go up slow but come down fast and HARD" — the raise now takes ~2/3 of
 *     the flight.)
 *  2. ARC + SLAM: the card tips over the top — a short crest — and HANGS
 *     there a beat (aggression retune, owner 2026-11-02: the raised slam
 *     "isn't aggressive enough"), then DROPS: the whole fall is compressed
 *     into the last ~0.11 s on a steeper power curve, leading edge dipped
 *     hard, and strikes the felt flat at RUN_SLAM_IMPACT_T of the flight
 *     (slap, not settle: the dip unwinds AT contact). The last tenth is the
 *     card flat on its scatter spot; Card3D's slam rebound rides on top,
 *     exactly where it always did.
 *
 * Same ballistic language as the toss family in flightPose.ts (accelerating
 * fall, corner-first contact, the clearance law keeping every corner off the
 * felt until the slap), at show scale. Endpoints are exact: pose(0) is `from`,
 * pose(1) is `to` (the runScatter rest), so the tornado that follows takes
 * every card from the same spot it always did.
 */

/** Every slam card's flight, raise + arc + strike (s). */
export const RUN_SLAM_FLIGHT_SEC = 0.9;
/** The raise beat's share of the flight (retune 2026-11-01: ~2/3 up slow, the rest down hard). */
export const RUN_SLAM_RAISE_END = 0.675;
/** The felt strike, as a fraction of the flight (landTiming's impactFraction reads the same number). */
export const RUN_SLAM_IMPACT_T = 0.9;
/**
 * The drop begins, as a fraction of the flight (aggression retune, owner
 * 2026-11-02). Between RUN_SLAM_RAISE_END and here the card HANGS at the
 * crest (~0.09 s — the wait is part of the violence); from here to
 * RUN_SLAM_IMPACT_T the whole height falls (~0.11 s). The raise and the
 * strike never moved — only the hang and the fall did.
 */
export const RUN_SLAM_DROP_T = 0.78;
/** The whole flight's delays are compressed into this spread (s): one collective slam, not a barrage. */
export const RUN_SLAM_MAX_STAGGER_SEC = 0.12;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (u: number) => { const c = clamp01(u); return c * c * (3 - 2 * c); };

/**
 * Per-card schedule for the slam: one shared flight duration, and the scatter's
 * release delays compressed into RUN_SLAM_MAX_STAGGER_SEC (order preserved), so
 * every card strikes inside one tight cluster — the impact the mega's detonation
 * is timed to (RUN_MEGA_DETONATE_MS after the slam starts, on the cluster's
 * first strikes) and the single beat the table disturbance fires on.
 */
export function runSlamSchedule(drops: readonly RunDrop[]): { delay: number; duration: number }[] {
  const maxDelay = drops.reduce((m, d) => Math.max(m, d.delay), 0);
  const scale = maxDelay > RUN_SLAM_MAX_STAGGER_SEC ? RUN_SLAM_MAX_STAGGER_SEC / maxDelay : 1;
  return drops.map((d) => ({ delay: d.delay * scale, duration: RUN_SLAM_FLIGHT_SEC }));
}

const quatOf = (q: Xform['q']): Quaternion => new Quaternion(q[0], q[1], q[2], q[3]);

/**
 * The drop's power curve (aggression retune, owner 2026-11-02: 3.4 → 4.8).
 * Over the compressed ~0.11 s fall the peak descent at show height is
 * ≈ 38 units/s (was ≈ 14), and the drop's last fifth carries ~66% of
 * the height (the old, longer fall carried ~53% across all of beat 2).
 */
const RUN_SLAM_DROP_EXPONENT = 4.8;

/** Leading-edge dip at the slap (radians) — the flight family's drive character, at show weight (retune: harder attack). */
const RUN_SLAM_DIP = 0.42;

/**
 * One frame of a Run It slam card's flight from `from` (its fan slot) to `to`
 * (its scatter rest) at t in [0, 1]. `arc` is the raise height in world units
 * (scaled by travel distance like the toss family's hop). The show value is
 * 0.85 (raised from 0.55 on 2026-11-02 — owner: the arc read too low) and the
 * default below matches it, so an arc-less caller never drifts from the show.
 */
export function runSlamPose(from: Xform, to: Xform, t: number, opts: { arc?: number } = {}): Xform {
  const clamped = clamp01(t);
  const sp = new Vector3(...from.p);
  const tp = new Vector3(...to.p);
  const dist = sp.distanceTo(tp);
  const raiseH = (opts.arc ?? 0.85) * Math.min(1, dist);
  const hoverY = Math.max(sp.y, tp.y) + raiseH;

  let p: Vector3;
  let level: number; // levelling slerp factor (fan pose → flat rest pose)
  let eXZ: number; // horizontal travel progress (drives scale + the clearance floor)
  let dip = 0;
  if (clamped <= RUN_SLAM_RAISE_END) {
    // Beat 1 — the slow raise: mostly UP, a slight drift toward the table,
    // levelling as it climbs. Smoothstep both ends: no snap out of the hand.
    const u = smoothstep(clamped / RUN_SLAM_RAISE_END);
    eXZ = 0.12 * u;
    p = new Vector3(
      sp.x + (tp.x - sp.x) * eXZ,
      sp.y + (hoverY - sp.y) * u,
      sp.z + (tp.z - sp.z) * eXZ,
    );
    level = u;
  } else {
    // Beat 2 — HANG, then DROP: the crest bob, the levelling and the dip
    // run on beat progress b exactly as they always did; only the height
    // and the horizontal rush wait for the drop. The card hangs at the
    // top until RUN_SLAM_DROP_T, then the whole height falls at once on
    // the steep curve, striking at RUN_SLAM_IMPACT_T; past the strike
    // the card is flat on its spot.
    const b = clamp01((clamped - RUN_SLAM_RAISE_END) / (RUN_SLAM_IMPACT_T - RUN_SLAM_RAISE_END)); // 0..1 raise end → strike
    const w = clamp01((clamped - RUN_SLAM_DROP_T) / (RUN_SLAM_IMPACT_T - RUN_SLAM_DROP_T)); // the drop proper: 0 through the hang, 0..1 across the fall, then 1
    eXZ = 0.12 + 0.88 * Math.pow(w, 2.0);
    const crest = w < 1 ? 0.15 * raiseH * Math.sin(Math.PI * clamp01(b / 0.4)) * (1 - b) : 0;
    const y = w >= 1 ? tp.y : tp.y + (hoverY - tp.y) * (1 - Math.pow(w, RUN_SLAM_DROP_EXPONENT)) + crest;
    p = new Vector3(sp.x + (tp.x - sp.x) * eXZ, y, sp.z + (tp.z - sp.z) * eXZ);
    level = Math.min(1, 0.85 + 0.15 * smoothstep(b / 0.7));
    // The dip builds across beat 2 to full attack and is gone AT the strike (the slap).
    if (b < 1) dip = RUN_SLAM_DIP * smoothstep((b - 0.15) / 0.85);
  }

  let q = new Quaternion().slerpQuaternions(quatOf(from.q), quatOf(to.q), level);
  if (dip > 0) {
    const hx = tp.x - sp.x;
    const hz = tp.z - sp.z;
    const hl = Math.hypot(hx, hz);
    if (hl > 1e-6) {
      const axis = new Vector3(hz / hl, 0, -hx / hl);
      q = new Quaternion().setFromAxisAngle(axis, dip).multiply(q);
    }
  }
  const s = from.s + (to.s - from.s) * eXZ;
  // No corner through the felt on the way down: same law as the toss family —
  // the floor rises to the spot's own rest height as the strike approaches, so
  // the dipped corner rides onto the scatter pile instead of sinking into it.
  const restCornerY = minCardCornerY(tp.y, quatOf(to.q), to.s);
  const blend = smoothstep((eXZ - 0.84) / 0.13);
  const floorY = Math.max(GATHER_CLEARANCE, restCornerY * blend);
  p.y += gatherClearanceLift(p.y, q, s, floorY - GATHER_CLEARANCE);
  return { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w], s };
}

/**
 * The claimer's grip plan for the Run It stand (owner 2026-11-08: "why
 * dont the hands go with the cards"). The standing figure's hands ride
 * the MIDDLE card of the slam bunch: this plan is that card's flight,
 * computed with the EXACT calls the Cards slam builder makes for it
 * (same runScatter seed grain, same compressed schedule, same fan
 * departure slot, same scatter rest) — so the hands track the show's
 * own path and phase clock, never a parallel guessed arc. Cards
 * computes it once per claim; the figure layer reads it through
 * figureStand's slamGripFrame on the same wall clock as the stand.
 */
export interface SlamGripPlan {
  /** the claim time (performance.now) this plan belongs to */
  at: number;
  /** the claimer's absolute seat */
  seat: number;
  /** when the slam phase starts: at + RUN_ZOOM_MS */
  startAt: number;
  /** the middle card's fan departure slot (world frame) */
  from: Xform;
  /** the middle card's scatter rest on the felt (world frame) */
  to: Xform;
  /** the middle card's own release delay inside the slam (s) */
  delaySec: number;
  /** the middle card's flight duration (s) — RUN_SLAM_FLIGHT_SEC */
  durationSec: number;
}

export function runSlamGripPlan(args: {
  gameSeed: string;
  handNo: number;
  seat: number;
  at: number;
  cards: readonly Card[];
  seatPos: SeatPos;
  n: number;
  /** the claimer's fan rest state at the claim (restFor snapshot) */
  drop: number;
  pinch: number;
  trickScale?: number;
  /** The HUMAN claimer's origin: his cards depart from his held
   *  strip slots, not a fan — Cards passes the middle card's own
   *  departureSlot (the slam builder's call) when the claimer is the
   *  local human, whose figure now stands for his own run (owner
   *  2026-11-08). Absent for figure claimers: the fan origin below. */
  fromOverride?: Xform;
}): SlamGripPlan | null {
  const k = args.cards.length;
  if (k === 0) return null;
  const drops = runScatter(playSeed(args.gameSeed, args.handNo, 99, `runit:${args.seat}`), k);
  const plan = runSlamSchedule(drops);
  const m = Math.round((k - 1) / 2);
  const d = drops[m]!;
  const base = trickSpot('bottom', args.n, m, jitterOf(args.cards[m]!), args.trickScale);
  return {
    at: args.at,
    seat: args.seat,
    startAt: args.at + RUN_ZOOM_MS,
    from: args.fromOverride ?? opponentFan(args.seatPos, args.n, Math.min(m, k - 1), k, args.drop, args.pinch),
    to: flatRest(d.dx, d.dz, d.spin, 4 + m, base.s),
    delaySec: 0.02 + plan[m]!.delay,
    durationSec: plan[m]!.duration,
  };
}
