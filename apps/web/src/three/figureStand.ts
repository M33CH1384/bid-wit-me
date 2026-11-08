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
 * of knee bend kept), the spine un-leans to its bind stance, and the
 * hands leave the fan for the figure's sides. standPelvisTarget
 * returns null when the rig's legs cannot carry a stand — the figure
 * then stays seated rather than faking it.
 */
import { RUN_MEGA_SHOW_EXTRA_MS, RUN_SHOW_MS } from '../runIt';

/** The rise starts just after the claim lands (the zoom overlay is
 *  opening); 800 ms is a human-paced stand, not a snap. */
export const RUN_STAND_RISE_START_MS = 250;
export const RUN_STAND_RISE_MS = 800;
/** The sit-down after the tornado: same pace as the rise. */
export const RUN_STAND_SIT_MS = 800;
/** The sit-down when the show is skipped early: a touch quicker. */
export const RUN_STAND_SKIP_SIT_MS = 600;
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

/** The stand amount 0..1 at a wall-clock instant, given the latch. */
export function standAmount(nowMs: number, latch: StandLatch): number {
  const t = nowMs - latch.at;
  if (t < RUN_STAND_RISE_START_MS) return 0;
  const rise = smooth((t - RUN_STAND_RISE_START_MS) / RUN_STAND_RISE_MS);
  const sitStart = standShowEndMs(latch.mega);
  if (latch.skipAt !== null) {
    const skipT = latch.skipAt - latch.at;
    if (skipT < sitStart) {
      if (t <= skipT) return rise;
      const from = smooth((skipT - RUN_STAND_RISE_START_MS) / RUN_STAND_RISE_MS);
      return from * (1 - smooth((t - skipT) / RUN_STAND_SKIP_SIT_MS));
    }
    // a clear at/after the natural show end is not a skip
  }
  if (t <= sitStart) return rise;
  return rise * (1 - smooth((t - sitStart) / RUN_STAND_SIT_MS));
}

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
