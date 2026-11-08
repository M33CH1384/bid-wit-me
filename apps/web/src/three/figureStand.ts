/**
 * RUN IT STAND (owner 2026-11-08): when a player runs it, their seated
 * figure stands before the slam and returns to its seat after the
 * tornado — keyed off the SAME claim the show itself uses (runFx.at /
 * runFx.claimer; Table stamps runStand from runFx, so every client that
 * renders the show renders the same stand).
 *
 * This module is pure wall-clock math, shared by both figure systems
 * (PersonaFigures for regular tables, PorchFigures for story tables) so
 * the choreography is identical in both. The envelope is a function of
 * the claim time, never of frame delivery: a starved canvas, a covered
 * scene, or a late mount can never strand a figure standing — any
 * frame, however late, computes the true amount from the clock, and
 * the figure is re-seated by the clock well before the next hand.
 *
 * Timeline (ms from the claim, runIt.ts):
 *   rise   250 → 1050   — inside the zoom phase, fully standing 450 ms
 *                          before the slam phase starts and ~1.3 s
 *                          before the slam impact lands
 *   hold   1050 → end   — standing through the slam and the tornado
 *   sit    end → end+800 — after the tornado is done; the recap /
 *                          intermission sits between show and next hand
 * where end = RUN_SHOW_MS (5350), mega 6250 (+RUN_MEGA_SHOW_EXTRA_MS).
 * Skip (the player taps out of the show early): the figure sits from
 * wherever it is over 600 ms.
 *
 * The standing pose is the same solve as the seat (see the figure
 * files): the feet stay planted where the placement put them, the
 * pelvis rises over the ankle line at near-full leg reach (a whisper
 * of knee bend kept), and the spine un-leans to its bind stance.
 * standPelvisTarget returns null when the rig's legs cannot carry a
 * stand — the figure then stays seated rather than faking it.
 *
 * Two retunes (owner 2026-11-08, after watching an opponent run it):
 *  1. HANDS WITH THE CARDS — during the show the hands no longer drift
 *     to the figure's sides: they stay on the run cards, gripping the
 *     middle card of the slam bunch through its own flight (the plan
 *     is computed by runSlamGripPlan in runSlamPose.ts from the show's
 *     own calls) and releasing as the tornado takes the cards. See
 *     slamGripFrame below.
 *  2. RISE ENERGY — the rise is a POP, not an elevator: fast through
 *     the first portion with a few percent of bounded overshoot and a
 *     settle, arriving still coiled a touch into the table (the spine
 *     keeps a sliver of its seated lean at the top of the rise and
 *     releases it just before the slam). Same envelope timings — rise
 *     start, the 1050 ms fully-standing mark, reseat and skip are
 *     untouched. The knobs are the RUN_STAND_POP_* / RUN_STAND_LEAN_*
 *     constants below.
 */
import { RUN_MEGA_SHOW_EXTRA_MS, RUN_SHOW_MS } from '../runIt';
import { runSlamPose, RUN_SLAM_IMPACT_T, type SlamGripPlan } from './runSlamPose';
import type { Xform } from './layout';

/** The rise starts just after the claim lands (the zoom overlay is
 *  opening); 800 ms is a human-paced stand, not a snap. */
export const RUN_STAND_RISE_START_MS = 250;
export const RUN_STAND_RISE_MS = 800;
/** The sit-down after the tornado: same pace as the rise. */
export const RUN_STAND_SIT_MS = 800;
/** The sit-down when the show is skipped early: a touch quicker. */
export const RUN_STAND_SKIP_SIT_MS = 600;
/** RISE ENERGY knobs (owner 2026-11-08 — retune here, one line each):
 *  the rise pops: easeOutCubic speed plus a bounded overshoot bump of
 *  RUN_STAND_POP_OVERSHOOT (a fraction past full stand) peaking late
 *  in the rise — the bump window starts at RUN_STAND_POP_BUMP_START of
 *  the rise and is back to zero at the deadline, so he lands on
 *  exactly 1 with no bounce loop. */
export const RUN_STAND_POP_OVERSHOOT = 0.035;
export const RUN_STAND_POP_BUMP_START = 0.5;
/** Eagerness coil: the spine keeps RUN_STAND_LEAN_DIP of its seated
 *  lean (as a fraction of the base→bind slerp) when the pelvis arrives,
 *  ramping in from RUN_STAND_LEAN_DIP_START of the rise, then releases
 *  over RUN_STAND_LEAN_SETTLE_MS — settled upright just before the
 *  slam. ~0.07 of the lean arc reads as a degree or two. */
export const RUN_STAND_LEAN_DIP = 0.07;
export const RUN_STAND_LEAN_DIP_START = 0.55;
export const RUN_STAND_LEAN_SETTLE_MS = 400;
/** HANDS-WITH-CARDS knobs: after the middle card strikes, the grip
 *  releases over this window (done well before the tornado fires);
 *  on a skip the grip fades over the shorter window. The fingers hold
 *  at RUN_SLAM_GRIP_CURL while engaged. */
export const RUN_SLAM_GRIP_RELEASE_MS = 450;
export const RUN_SLAM_GRIP_SKIP_FADE_MS = 180;
export const RUN_SLAM_GRIP_CURL = 0.95;
/** Fraction of full leg reach the standing pelvis sits at — the legs
 *  stay very slightly bent, as a real stand does. */
export const STAND_REACH = 0.985;
/** How far behind the ankle line the standing pelvis sits (m, seat
 *  frame): over the mid-foot, not behind the heels. */
export const STAND_HIP_BEHIND_ANKLE_M = 0.02;

/** The show the figure stands for, as stamped by Table from runFx. */
export interface RunStandInfo {
  seat: number;
  at: number;
  mega: boolean;
}

/** A figure's latched stand schedule. skipAt is stamped when the show
 *  disappears before its natural end (the player tapped Skip). */
export interface StandLatch {
  at: number;
  mega: boolean;
  skipAt: number | null;
}

/** When the show (and the stand's hold) ends, from the claim. */
export function standShowEndMs(mega: boolean): number {
  return RUN_SHOW_MS + (mega ? RUN_MEGA_SHOW_EXTRA_MS : 0);
}

const smooth = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * The rise curve (owner 2026-11-08: the old smoothstep "lerped up like
 * an elevator"). A pop: easeOutCubic speed through the first portion
 * (u=0.3 → ~0.66 up, where smoothstep gave 0.216), plus a bounded
 * overshoot bump — sin² over the back half of the rise, peaking at
 * u≈0.75 a few percent PAST full stand — that is back to zero at
 * u=1, so the amount lands on exactly 1 at the deadline and the hold
 * that follows never overshoots. No bounce loop: one bump, one settle.
 */
export function standRiseAmount(u: number): number {
  const c = clamp01(u);
  if (c >= 1) return 1;
  const pop = 1 - Math.pow(1 - c, 3);
  const v = clamp01((c - RUN_STAND_POP_BUMP_START) / (1 - RUN_STAND_POP_BUMP_START));
  const bump = RUN_STAND_POP_OVERSHOOT * Math.sin(Math.PI * v) ** 2;
  return pop + bump;
}

/** The rise amount for the PELVIS at absolute ms-from-claim t. */
const pelvisRiseAt = (t: number): number =>
  standRiseAmount((t - RUN_STAND_RISE_START_MS) / RUN_STAND_RISE_MS);

/**
 * The rise amount for the SPINE at t: the same pop, minus the
 * eagerness coil — a sliver of the seated lean held back as he
 * arrives (he pops up still leaned a touch into the table, over the
 * cards he is about to slam), released over the settle window after
 * the rise ends, upright just before the slam phase starts.
 */
const spineRiseAt = (t: number): number => {
  const u = (t - RUN_STAND_RISE_START_MS) / RUN_STAND_RISE_MS;
  const riseEnd = RUN_STAND_RISE_START_MS + RUN_STAND_RISE_MS;
  const dipIn = smooth((u - RUN_STAND_LEAN_DIP_START) / (1 - RUN_STAND_LEAN_DIP_START));
  const dipOut = t <= riseEnd ? 1 : 1 - smooth((t - riseEnd) / RUN_STAND_LEAN_SETTLE_MS);
  return Math.max(0, standRiseAmount(u) - RUN_STAND_LEAN_DIP * dipIn * dipOut);
};

/** The envelope shared by the pelvis and spine amounts: rise (on the
 *  given rise curve), hold, sit — or, on a skip, sit from wherever the
 *  curve had reached when the show was cut. */
function envelope(nowMs: number, latch: StandLatch, riseAt: (t: number) => number): number {
  const t = nowMs - latch.at;
  if (t < RUN_STAND_RISE_START_MS) return 0;
  const rise = riseAt(t);
  const sitStart = standShowEndMs(latch.mega);
  if (latch.skipAt !== null) {
    const skipT = latch.skipAt - latch.at;
    if (skipT < sitStart) {
      if (t <= skipT) return rise;
      const from = riseAt(skipT);
      return from * (1 - smooth((t - skipT) / RUN_STAND_SKIP_SIT_MS));
    }
    // a clear at/after the natural show end is not a skip
  }
  if (t <= sitStart) return rise;
  return rise * (1 - smooth((t - sitStart) / RUN_STAND_SIT_MS));
}

/** The stand amount 0..1 (past 1 only inside the rise's overshoot
 *  window) at a wall-clock instant, given the latch. Drives the pelvis
 *  root lerp and the arm side-drift. */
export function standAmount(nowMs: number, latch: StandLatch): number {
  return envelope(nowMs, latch, pelvisRiseAt);
}

/** The spine's stand amount: standAmount with the eagerness coil —
 *  the spine un-leans on this curve while the pelvis rides
 *  standAmount, so the figure arrives coiled and settles upright. */
export function standSpineAmount(nowMs: number, latch: StandLatch): number {
  return envelope(nowMs, latch, spineRiseAt);
}

/**
 * HANDS WITH THE CARDS (owner 2026-11-08). The frame the claimer's
 * hands grip at a wall-clock instant: the middle run card's own frame
 * on the show's own slam path (runSlamPose over the SlamGripPlan
 * Cards computed from the builder's exact calls), plus how engaged
 * the grip is (1 = fully on the card). Null when the hands should be
 * wherever the shipped solve puts them.
 *
 *  - During the zoom (before the slam phase) the frame is the card's
 *    fan departure slot at full engagement — the hands simply stay on
 *    the fan as he rises, instead of drifting to his sides.
 *  - Through the flight the frame is runSlamPose at the card's own
 *    flight t: hands drive the card down and arrive WITH it at the
 *    strike (RUN_SLAM_IMPACT_T of the flight).
 *  - After the strike the engagement releases over
 *    RUN_SLAM_GRIP_RELEASE_MS — done well before the tornado takes
 *    the cards; the blend target underneath is the shipped side hang,
 *    so the hands settle to his sides as the show ends.
 *  - On a skip the pose freezes at the skip instant and the grip
 *    fades over RUN_SLAM_GRIP_SKIP_FADE_MS, then lets go entirely.
 */
export function slamGripFrame(
  nowMs: number,
  latch: StandLatch,
  plan: SlamGripPlan,
): { p: Xform['p']; q: Xform['q']; engage: number } | null {
  if (plan.at !== latch.at) return null;
  const poseAt = (ms: number): { p: Xform['p']; q: Xform['q']; engage: number } | null => {
    const eMs = ms - plan.startAt;
    if (eMs < 0) return { p: plan.from.p, q: plan.from.q, engage: 1 };
    const ft = clamp01((eMs / 1000 - plan.delaySec) / plan.durationSec);
    const pose = runSlamPose(plan.from, plan.to, ft);
    const strikeMs = (plan.delaySec + RUN_SLAM_IMPACT_T * plan.durationSec) * 1000;
    const engage = eMs <= strikeMs ? 1 : 1 - smooth((eMs - strikeMs) / RUN_SLAM_GRIP_RELEASE_MS);
    if (engage <= 0) return null;
    return { p: pose.p, q: pose.q, engage };
  };
  if (latch.skipAt !== null && nowMs > latch.skipAt) {
    const fade = 1 - smooth((nowMs - latch.skipAt) / RUN_SLAM_GRIP_SKIP_FADE_MS);
    if (fade <= 0) return null;
    const frozen = poseAt(latch.skipAt);
    if (!frozen) return null;
    return { p: frozen.p, q: frozen.q, engage: fade };
  }
  return poseAt(nowMs);
}

export type { SlamGripPlan };

/** True once the envelope has returned to 0 and the figure should be
 *  restored to its seated bake and the latch released. */
export function standFinished(nowMs: number, latch: StandLatch): boolean {
  const t = nowMs - latch.at;
  const sitStart = standShowEndMs(latch.mega);
  if (latch.skipAt !== null) {
    const skipT = latch.skipAt - latch.at;
    if (skipT < sitStart) return t >= skipT + RUN_STAND_SKIP_SIT_MS;
  }
  return t >= sitStart + RUN_STAND_SIT_MS;
}

/** A point in seat-group space (the frame the placement solve uses). */
export interface StandPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * The standing pelvis for a figure whose feet are planted at ankleL /
 * ankleR (the placement's flat-foot ankle targets, group space):
 * centred over the ankles, a hair behind the ankle line, at
 * STAND_REACH of the leg length above the ankle line. Returns null
 * when the legs cannot carry a stand at all (the caller then leaves
 * the figure seated — never a root-lift fake).
 */
export function standPelvisTarget(
  seatedPelvis: StandPoint,
  ankleL: StandPoint,
  ankleR: StandPoint,
  legLength: number,
): StandPoint | null {
  void seatedPelvis;
  const mid = {
    x: (ankleL.x + ankleR.x) / 2,
    y: (ankleL.y + ankleR.y) / 2,
    z: (ankleL.z + ankleR.z) / 2,
  };
  const dx = Math.max(Math.abs(ankleL.x - mid.x), Math.abs(ankleR.x - mid.x));
  const reach = legLength * STAND_REACH;
  const dz = STAND_HIP_BEHIND_ANKLE_M;
  const dySq = reach * reach - dx * dx - dz * dz;
  if (dySq < 0.09) return null; // legs too short for the stance
  return { x: mid.x, y: mid.y + Math.sqrt(dySq), z: mid.z - dz };
}
