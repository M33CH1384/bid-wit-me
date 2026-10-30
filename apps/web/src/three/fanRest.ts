import { liftEase } from './handLift';

/**
 * Fan rest (owner, 2026-10-28): a seat's fanned cards LOWER while that
 * seat is off-turn, and raise back to the normal spread when the seat
 * becomes the one to act. The rest pose is TWO channels, driven
 * separately:
 *  - `drop`  — the fan lowers (every card sits lower, spread unchanged).
 *  - `pinch` — the fan tightens (spread and roll close toward centre).
 * Scope (owner's calls, 2026-10-28): the SITTING camera rests at any
 * aspect, but sitting in PORTRAIT lowers only — no pinch ("let's not
 * pinch the fan while sitting, just lower it"); pinch joins wherever
 * the table is in landscape. The STANDING camera rests in landscape
 * (drop + pinch); portrait + Standing never rests, so that framing
 * stays byte-unchanged.
 *
 * This module is the pure state half of the feature — no three.js, no DOM
 * (except the reduced-motion input, which callers pass in):
 *  - `fanRestTarget` is the scope + turn gate: the rest pose a seat's fan
 *    SHOULD settle at ({ drop: 0, pinch: 0 } = open/normal).
 *  - `FanRestAnim` + `stepFanRest` ease a fan between those poses over
 *    FAN_REST_MS with the fan's own lift ease (monotonic per channel,
 *    bounded, no overshoot). Under reduced motion the pose settles
 *    instantly.
 * The geometry half lives in layout.ts (`FanOpts.rest` = drop and
 * `FanOpts.pinch` on the human fan, the `rest`/`pinch` arguments of
 * `opponentFan`): rest is a pose applied on top of the open layout —
 * same card scale, same solver — so a resting fan and an open fan
 * differ only in anchor height, spread and roll.
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
 * A rest pose: the two channels of the rest, each 0..1.
 * { drop: 0, pinch: 0 } is the open pose (raised, full spread);
 * { drop: 1, pinch: 0 } is lowered at full open width (sitting portrait);
 * { drop: 1, pinch: 1 } is the full rest (landscape, either camera).
 */
export interface FanRestPose {
  /** How far the fan lowers, 0..1. */
  drop: number;
  /** How much the fan's spread closes, 0..1. */
  pinch: number;
}

const OPEN_POSE: FanRestPose = { drop: 0, pinch: 0 };

/**
 * The rest pose a fan should settle at. The acting seat — the human
 * included — always gets the open pose, and a dead aspect (0 / NaN
 * canvas) never rests. Off-turn:
 *  - Sitting, landscape: drop + pinch. Sitting, portrait/square: drop
 *    only — the fan lowers at its open width (owner, 2026-10-28).
 *  - Standing, landscape: drop + pinch. Standing, portrait: open.
 */
export function fanRestTarget(g: FanRestGate): FanRestPose {
  if (g.seatIsActive) return { ...OPEN_POSE };
  if (!(Number.isFinite(g.aspect) && g.aspect > 0)) return { ...OPEN_POSE };
  const landscape = g.aspect > 1;
  if (g.view === 'sitting') return landscape ? { drop: 1, pinch: 1 } : { drop: 1, pinch: 0 };
  if (!landscape) return { ...OPEN_POSE };
  return { drop: 1, pinch: 1 };
}

/** Seconds a rest/open transition takes. 0 under reduced motion (a snap). */
export function fanRestSeconds(reduced: boolean): number {
  return reduced ? 0 : FAN_REST_MS / 1000;
}

/**
 * Rest character (owner, 2026-10-30): the lowering should "vary to look more
 * realistic" — a person relaxes their hand differently every time. Each rest
 * or open transition picks ONE character, seeded by the caller (hand + seat +
 * transition count, so a fan's sequence is stable within a hand):
 *  - `durMs` — how long the transition takes: a quick drop (~520 ms), the
 *    standard settle (650 ms), or a slow sag (up to ~880 ms).
 *  - `dropDepth` / `pinchDepth` — how far the channels settle this time
 *    (0.86–1.0 of the full pose): some rests sit a touch higher or looser.
 *  - `overshoot` — on some rests the fan first dips a little PAST its settle
 *    depth, then eases back up onto it (Scene applies it as a two-phase
 *    target). 0 on most legs.
 * The character never changes WHETHER or WHEN a fan rests — fanRestTarget
 * still decides that — only HOW the transition moves.
 */
export interface RestCharacter {
  durMs: number;
  dropDepth: number;
  pinchDepth: number;
  overshoot: number;
}

/** The unvaried character: exactly the pre-variation behaviour. */
export const NEUTRAL_REST_CHARACTER: RestCharacter = { durMs: FAN_REST_MS, dropDepth: 1, pinchDepth: 1, overshoot: 0 };

export function restCharacter(seed: number): RestCharacter {
  let h = (Math.floor(Math.abs(Number.isFinite(seed) ? seed : 0)) >>> 0) || 1;
  // Scramble the seed first: sequential seeds (hand/seat/leg counters) through
  // a bare LCG would hand near-identical characters to neighbouring legs.
  h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  const rnd = () => { h = (Math.imul(h, 1664525) + 1013904223) >>> 0; return h / 4294967296; };
  const rDur = rnd();
  const rDrop = rnd();
  const rPinch = rnd();
  const rOver = rnd();
  return {
    durMs: Math.round(520 + rDur * 360),
    dropDepth: 0.9 + rDrop * 0.1,
    pinchDepth: 0.86 + rPinch * 0.14,
    overshoot: rOver < 0.35 ? 0.05 : 0,
  };
}

export interface FanRestAnim {
  /** Pose where the current leg started. */
  from: FanRestPose;
  /** Pose the current leg is heading to. */
  to: FanRestPose;
  /** Leg progress, 0..1. */
  t: number;
  /** The pose right now (eased, per channel). */
  value: FanRestPose;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

/**
 * Normalize a pose or a bare amount into a pose. A bare amount drives
 * BOTH channels together — the pre-split pose (drop and pinch in
 * lockstep), kept so scalar callers behave exactly as before.
 */
const poseOf = (v: number | FanRestPose): FanRestPose =>
  typeof v === 'number' ? { drop: clamp01(v), pinch: clamp01(v) } : { drop: clamp01(v.drop), pinch: clamp01(v.pinch) };

const samePose = (a: FanRestPose, b: FanRestPose) => a.drop === b.drop && a.pinch === b.pinch;

/** A rest anim settled at `initial` (Scene seeds it at the first target it sees, so a fan never animates on mount). */
export function fanRestAnim(initial: number | FanRestPose = 0): FanRestAnim {
  const v = poseOf(initial);
  return { from: v, to: v, t: 1, value: v };
}

/**
 * Point an anim at a new target. A retarget continues from the pose the
 * fan is drawn at right now (no jump — e.g. rotating a resting sitting
 * fan from portrait to landscape keeps its drop and only starts the
 * pinch leg); under reduced motion it settles on the target instantly.
 */
export function setFanRestTarget(a: FanRestAnim, target: number | FanRestPose, reduced = false): FanRestAnim {
  const to = poseOf(target);
  if (reduced) return { from: to, to, t: 1, value: to };
  if (samePose(to, a.to)) return a;
  return { from: a.value, to, t: 0, value: a.value };
}

/**
 * Advance an anim by `dtMs` (callers cap dt like the rest of the scene,
 * so a starved frame cannot fast-forward the settle). Eased with
 * liftEase: each channel is monotonic toward its target and bounded by
 * [from, to] — the fan never overshoots past either the open pose or
 * the full rest pose, in either channel.
 */
export function stepFanRest(a: FanRestAnim, dtMs: number, reduced = false): FanRestAnim {
  if (reduced) return samePose(a.to, a.value) && a.t >= 1 ? a : { from: a.to, to: a.to, t: 1, value: a.to };
  if (a.t >= 1) return a;
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const t = Math.min(1, a.t + dt / FAN_REST_MS);
  const e = liftEase(t);
  const value: FanRestPose = {
    drop: a.from.drop + (a.to.drop - a.from.drop) * e,
    pinch: a.from.pinch + (a.to.pinch - a.from.pinch) * e,
  };
  return { from: a.from, to: a.to, t, value };
}
