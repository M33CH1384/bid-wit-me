/**
 * The King's rail as PEOPLE (owner, 2026-10-26): the face-coin columns
 * were rejected on sight — "remember this is a 3d table, they should be
 * standing around the table as human figures not coins with faces."
 * This module is the pure placement + pose math for rendering the rail
 * cast — and, at the King table, the seated three — as standing /
 * seated figures INSIDE the 3D scene (three/KingRail.tsx). No three.js
 * scene objects live here beyond Vector3 math, so every guarantee
 * (completeness, order, occlusion envelopes, animation staggering,
 * reduced-motion stillness) is unit-testable.
 *
 * STAGING — a ring in the round. The crowd wraps the table: a far arc
 * behind the partner's seat is geometrically unusable (from the high
 * standing camera a life-size head behind the far rail lands inside
 * the scorebug band; from the low cameras it leaves the frame), so the
 * cast stands in two arcs — the far wings and both flanks, closing at
 * the near corners beside the player's seat. Nobody stands between
 * the player and the felt. Figures are depth-tested and planted
 * outside the felt's bounds, so cards and felt always win in depth;
 * DOM (plates, scorebug, dock, panels) paints over the canvas by
 * construction. What placement must therefore guarantee is only that
 * faces don't sit ON TOP of those DOM rects in projection where they
 * would read as cut in half — verified by the projection tests.
 *
 * SCALE — the venue floor sits 0.9 below the felt plane (Venue3D's
 * FLOOR_Y: a real table's height). Standing figures plant their feet
 * on the floor and stand 1.63–1.82 tall, so their crowns land
 * ~0.75–0.9 above the felt — exactly the band the standing camera
 * frames under the scorebug. Seated figures crown at ~0.4 above the
 * felt (a seated adult over a 0.9 table).
 */
import { Vector3 } from 'three';
import { FELT, RAIL, edgePoint, seatDir, type SeatPos } from './layout';
import {
  VISIT_ARRIVE_MS, VISIT_DEPART_MS, VISIT_FADE_IN_MS, VISIT_FADE_OUT_MS,
  VISIT_IDLE_MS, VISIT_PEAK, type CrowdCue,
} from './crowdCue';

/** The venue floor, 0.9 below the felt plane (mirrors Venue3D FLOOR_Y). */
export const RAIL_FLOOR_Y = -0.9;

/* ------------------------------------------------------------------ */
/* Crowd placement                                                     */
/* ------------------------------------------------------------------ */

/** Floor radii of the two standing rows (world units from table centre).
 *  The felt + rail reach 1.7 × 1.98; the front row stands just clear of
 *  the rail corners, the back row a half-step behind it. */
export const RAIL_FRONT_R = 2.55;
export const RAIL_BACK_R = 3.1;

/** The ring breathes OUT on wide / short-landscape stages: those
 *  cameras sit lower, so the portrait ring's far faces crowd the top
 *  of the frame (behind the scorebug glass and the partner's strip).
 *  Scaling the ring (and the seated offset) out drops the faces to
 *  mid-frame while the near corners stay beside the player's seat. */
export function ringScaleFor(aspect: number, short: boolean): number {
  if (short) return 1.3;
  return aspect >= 1.3 ? 1.18 : 1;
}

/** Slot angles in degrees, 0 = far side (behind the partner), positive
 *  toward the player's right. The centre behind the partner's seat is
 *  deliberately empty; the near corners (±103°+) close the ring beside
 *  the player's seat without entering the hand-fan's space. */
const FRONT_ANGLES = [-104, -90, -74, -58, -40, 40, 58, 74, 90, 104];
const BACK_ANGLES = [-114, -98, -82, -64, -46, 46, 64, 82, 98, 114];

export interface RailFigure {
  id: string;
  /** index in the cast order (the session's railCast order) */
  index: number;
  row: 0 | 1;
  /** feet position (y = RAIL_FLOOR_Y) */
  x: number;
  z: number;
  /** facing: billboards yaw toward the table centre */
  yaw: number;
  /** total standing height, 1.63–1.82 — seeded from the cast order */
  height: number;
  /** silhouette variant 0..2 (stance/shoulder line), from cast order */
  variant: number;
  /** per-figure motion seed in [0,1) — phases derive from it, so the
   *  same cast order breathes identically on resume */
  seed: number;
}

/** Deterministic [0,1) hash — the same seed source the layout uses for
 *  per-character jitter; stable across sessions and resumes. */
export function hash01(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const REF_H = 1.74;
/** Portrait (head/upper-body) plane width at reference height. */
export const PORTRAIT_W = 0.8;
/** Silhouette body plane width at reference height. */
export const BODY_W = 0.62;
/** Silhouette body plane height at reference height (feet to shoulders). */
export const BODY_H = 1.18;

export const portraitW = (f: RailFigure) => (PORTRAIT_W * f.height) / REF_H;
export const bodyW = (f: RailFigure) => (BODY_W * f.height) / REF_H;

/**
 * Place the cast around the table. Cast order maps to slots sorted by
 * angle, so the crowd reads left-to-right in the order the session
 * dealt it — identical on first entry and on resume (the cast array
 * itself is the checkpointed one). Completeness is structural: one
 * figure per cast id, no sampling, no caps.
 */
export function kingRailFigures(cast: readonly string[], ringScale = 1): RailFigure[] {
  const slots: { angle: number; row: 0 | 1; r: number }[] = [
    ...FRONT_ANGLES.map((angle) => ({ angle, row: 0 as const, r: RAIL_FRONT_R * ringScale })),
    ...BACK_ANGLES.map((angle) => ({ angle, row: 1 as const, r: RAIL_BACK_R * ringScale })),
  ].sort((a, b) => a.angle - b.angle);
  return cast.map((id, i) => {
    const slot = slots[i % slots.length]!;
    // Beyond 20 the ring is full (the King deals exactly 20); any extra
    // id wraps onto a slot rather than vanishing — completeness first.
    const rad = (slot.angle * Math.PI) / 180;
    return {
      id,
      index: i,
      row: slot.row,
      x: Math.sin(rad) * slot.r,
      z: -Math.cos(rad) * slot.r,
      yaw: Math.atan2(-Math.sin(rad), Math.cos(rad)),
      height: 1.63 + hash01(i * 3 + 1) * 0.19,
      variant: i % 3,
      seed: hash01(i * 7 + 2),
    };
  });
}

/* ------------------------------------------------------------------ */
/* The cue channel                                                     */
/* ------------------------------------------------------------------ */

/**
 * The crowd's cue channel lives in ./crowdCue (three-free, so Table.tsx
 * can stamp it without pulling three.js into the entry graph); it is
 * re-exported here for the scene-side consumers.
 */
export { VISIT_AMBIENT_P, VISIT_ARRIVE_MS, VISIT_DEPART_MS, VISIT_FADE_IN_MS, VISIT_FADE_OUT_MS, VISIT_IDLE_MS, VISIT_PEAK, VISIT_SETTLED_MS, VISITOR_ID, ambientVisit, cueHash01, newCrowdCue, stampSeatSpeaker, stampSpeaker, stampStir, stampVisit, type AmbientVisit, type CrowdCue } from './crowdCue';

/* ------------------------------------------------------------------ */
/* Poses                                                               */
/* ------------------------------------------------------------------ */

export interface FigurePose {
  /** vertical breathing bob (world units, added at the hip pivot) */
  bobY: number;
  /** breath scale of the portrait plane (1 = rest) */
  breathK: number;
  /** body sway around the facing axis (rad) */
  swayRad: number;
  /** lean toward the table (rad, + = in) */
  leanRad: number;
  /** step toward the table (world units along facing) */
  stepIn: number;
  /** head yaw / pitch offsets (rad) */
  headYawRad: number;
  headPitchRad: number;
}

const REST_POSE: FigurePose = {
  bobY: 0, breathK: 1, swayRad: 0, leanRad: 0, stepIn: 0, headYawRad: 0, headPitchRad: 0,
};
export const restPose = (): FigurePose => ({ ...REST_POSE });

/** A smooth bump envelope: 0 before `at`, rises over `rise` ms, holds
 *  briefly, decays over `fall` ms. Deterministic in (t, at). */
function bump(t: number, at: number, rise: number, fall: number): number {
  const d = t - at;
  if (d < 0) return 0;
  if (d < rise) return d / rise;
  const x = (d - rise) / fall;
  return x >= 1 ? 0 : 1 - x * x * (3 - 2 * x);
}

/**
 * The standing pose of one figure at time t. Idle life is seeded per
 * figure (breath 3.8 s, sway 9.1 s, a slow tanh weight-shift every
 * 15–22 s, wandering head) so the crowd never moves in sync. A stir
 * ripples down the rail (45 ms per figure from the stamp) as a lean-in
 * with heads up; the speaking railbird leans and steps in for the
 * length of a line. All amplitudes are bounded by POSE_INFLATE — the
 * occlusion proofs run against poses inflated by exactly that much.
 */
export function crowdPoseAt(f: RailFigure, t: number, cue: CrowdCue): FigurePose {
  const s = f.seed * Math.PI * 2;
  const breath = Math.sin((t / 3800) * Math.PI * 2 + s);
  const sway = Math.sin((t / 9100) * Math.PI * 2 + s * 1.7);
  const shiftPeriod = 15000 + f.seed * 7000;
  const shift = Math.tanh(Math.sin((t / shiftPeriod) * Math.PI * 2 + s * 2.3) * 2.2);
  const headYaw = Math.sin((t / 6700) * Math.PI * 2 + s * 3.1) * 0.16
    + Math.sin((t / 11300) * Math.PI * 2 + s) * 0.08;
  const headPitch = Math.sin((t / 8300) * Math.PI * 2 + s * 1.3) * 0.05;

  let lean = 0;
  let step = 0;
  let headUp = 0;
  const stir = bump(t, cue.stirAt + f.index * 45, 260, 1180) * cue.stirAmp;
  if (stir > 0) {
    lean += 0.055 * stir;
    step += 0.045 * stir;
    headUp += 0.06 * stir;
  }
  let speakYaw = 0;
  if (cue.speakerId === f.id) {
    const sp = bump(t, cue.speakerAt, 220, 2400);
    lean += 0.07 * sp;
    step += 0.06 * sp;
    speakYaw = -headYaw * sp; // face the table while speaking
  }
  return {
    bobY: breath * 0.006,
    breathK: 1 + breath * 0.012,
    swayRad: sway * 0.012 + shift * 0.02,
    leanRad: lean,
    stepIn: step,
    headYawRad: headYaw + speakYaw,
    headPitchRad: headPitch - headUp,
  };
}

/** The worst-case pose envelope, used to inflate projection quads in
 *  the occlusion proofs: no pose the animation can reach moves a
 *  figure further toward the table, sideways, or up than this. */
export const POSE_INFLATE = { toward: 0.16, lateral: 0.09, up: 0.03 } as const;

function localToWorld(o: { x: number; z: number; yaw: number }, lx: number, y: number, lz: number): Vector3 {
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  return new Vector3(o.x + lx * c + lz * s, y, o.z - lx * s + lz * c);
}

/** The full figure quad (feet → crown, widest plane), optionally
 *  inflated by the pose envelope. */
export function figureCorners(f: RailFigure, inflate = false): Vector3[] {
  const w = Math.max(portraitW(f), bodyW(f)) / 2 + (inflate ? POSE_INFLATE.lateral : 0);
  const top = RAIL_FLOOR_Y + f.height + (inflate ? POSE_INFLATE.up : 0);
  const toward = inflate ? POSE_INFLATE.toward : 0;
  return [
    localToWorld(f, -w, RAIL_FLOOR_Y, toward),
    localToWorld(f, w, RAIL_FLOOR_Y, toward),
    localToWorld(f, w, top, toward),
    localToWorld(f, -w, top, toward),
  ];
}

/** The face region of the portrait plane: the shipped portraits are
 *  square busts — face centre ~30% from the top of the frame, chin
 *  ~55%, face spanning the middle ~48% of the width. In plane terms
 *  (plane top = crown): x ±24%, y from just under the crown to 58% of
 *  the plane height down. */
export function faceCorners(f: RailFigure, inflate = false): Vector3[] {
  const pw = portraitW(f);
  const fx = pw * 0.24 + (inflate ? POSE_INFLATE.lateral * 0.7 : 0);
  const toward = inflate ? POSE_INFLATE.toward : 0;
  const crown = RAIL_FLOOR_Y + f.height;
  const yTop = crown - pw * 0.03;
  const yBot = crown - pw * 0.58;
  return [
    localToWorld(f, -fx, yBot, toward),
    localToWorld(f, fx, yBot, toward),
    localToWorld(f, fx, yTop, toward),
    localToWorld(f, -fx, yTop, toward),
  ];
}

/* ------------------------------------------------------------------ */
/* Seated figures (Part 2)                                             */
/* ------------------------------------------------------------------ */

/** Per-character motion personalities. The King's stillness is the
 *  menace: smallest amplitude, slowest clock. Dee is the most alive
 *  person at the table; the Ringer is quicker and sharper than alive. */
export const SEATED_PERSONALITY: Record<string, { amp: number; speed: number }> = {
  king: { amp: 0.32, speed: 0.55 },
  ringer: { amp: 0.72, speed: 1.3 },
  dee: { amp: 1.0, speed: 1.0 },
};
export const seatedPersonality = (id: string) => SEATED_PERSONALITY[id] ?? { amp: 0.6, speed: 1.0 };

/** Crown height of a seated figure in world Y (felt = 0, floor −0.9):
 *  a seated adult's crown ~1.3 above their floor ≈ 0.4 above the felt.
 *  The King sits tallest — presence through size, not motion. */
const SEATED_CROWN: Record<string, number> = { king: 0.47, ringer: 0.43, dee: 0.32 };
/** Portrait plane widths — the bust doesn't shrink with the chair. */
const SEATED_PORTRAIT_W: Record<string, number> = { king: 0.62, ringer: 0.59, dee: 0.56 };
/** How far beyond the felt edge the seated figure's centre sits. */
export const SEATED_OUT = 0.4;

export interface SeatedFigure {
  characterId: string;
  seat: number;
  /** centre at the seat's edge (the torso rises from behind the apron) */
  x: number;
  z: number;
  yaw: number;
  crown: number;
  portraitW: number;
  torsoW: number;
  torsoTop: number;
  seed: number;
}

export function seatedFigureFor(characterId: string, seat: number, pos: SeatPos, n: number, ringScale = 1): SeatedFigure {
  const d = seatDir(pos, n);
  const edge = edgePoint(d);
  // The top seat sits further out: its info strip anchors directly over
  // the seat, and the figure's head must drop below the strip in the
  // high camera — the side seats' strips anchor clear of their heads.
  const out = (pos === 'top' ? 1.05 : SEATED_OUT) * ringScale;
  const x = edge.x + d.x * out;
  const z = edge.z + d.z * out;
  const crown = (SEATED_CROWN[characterId] ?? 0.42) + (hash01(seat * 7 + 3) - 0.5) * 0.03;
  const pw = SEATED_PORTRAIT_W[characterId] ?? 0.58;
  return {
    characterId, seat, x, z,
    yaw: Math.atan2(-x, -z),
    crown,
    portraitW: pw,
    torsoW: pw * 1.07,
    torsoTop: crown - pw * 0.4,
    seed: hash01(seat * 13 + 5),
  };
}

/** Clamp a look-at yaw (relative to the figure's facing) to a natural
 *  head-and-shoulders turn. */
export function attentionYawFor(f: SeatedFigure, tx: number, tz: number): number {
  // The figure's facing in world xz is (sin yaw, cos yaw) — the yaw
  // that would face the target is atan2(dx, dz); the pose wants the
  // relative turn, clamped to a natural head-and-shoulders range.
  const want = Math.atan2(tx - f.x, tz - f.z);
  let rel = want - f.yaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  return Math.max(-0.5, Math.min(0.5, rel));
}

/** The seated pose at time t: idle breathing at seated amplitude,
 *  personality-scaled reactions (stir + own speech), and attention —
 *  the caller's smoothed look yaw toward the current action. */
export function seatedPoseAt(f: SeatedFigure, t: number, cue: CrowdCue, attnYaw: number): FigurePose {
  const p = seatedPersonality(f.characterId);
  const s = f.seed * Math.PI * 2 + f.seat;
  const tt = t * p.speed;
  const breath = Math.sin((tt / 3400) * Math.PI * 2 + s);
  const sway = Math.sin((tt / 8400) * Math.PI * 2 + s * 1.9) * 0.008 * (0.4 + p.amp);
  const fx = 0.35 + 0.65 * p.amp; // even the King is not a statue when the room stirs
  let lean = 0;
  let headUp = 0;
  const stir = bump(t, cue.stirAt + f.seat * 60, 240, 1100) * cue.stirAmp;
  lean += 0.05 * stir * fx;
  headUp += 0.05 * stir * fx;
  if (cue.seatSpeakerId === f.characterId) {
    const sp = bump(t, cue.seatSpeakerAt, 200, 2200);
    lean += 0.085 * sp * fx;
  }
  return {
    bobY: breath * 0.004 * (0.4 + p.amp),
    breathK: 1 + breath * 0.01,
    swayRad: sway,
    leanRad: lean,
    stepIn: 0,
    headYawRad: attnYaw * (0.55 + 0.3 * p.amp),
    headPitchRad: Math.sin((tt / 7600) * Math.PI * 2 + s) * 0.04 - headUp,
  };
}

/** The seated figure's full quad (from just under the felt — the
 *  apron hides the rest — to the crown), pose-inflated on request. */
export function seatedCorners(f: SeatedFigure, inflate = false): Vector3[] {
  const w = Math.max(f.portraitW, f.torsoW) / 2 + (inflate ? POSE_INFLATE.lateral : 0);
  const top = f.crown + (inflate ? POSE_INFLATE.up : 0);
  const toward = inflate ? POSE_INFLATE.toward : 0;
  return [
    localToWorld(f, -w, -0.2, toward),
    localToWorld(f, w, -0.2, toward),
    localToWorld(f, w, top, toward),
    localToWorld(f, -w, top, toward),
  ];
}

export function seatedFaceCorners(f: SeatedFigure, inflate = false): Vector3[] {
  const pw = f.portraitW;
  const fx2 = pw * 0.24 + (inflate ? POSE_INFLATE.lateral * 0.7 : 0);
  const toward = inflate ? POSE_INFLATE.toward : 0;
  const yTop = f.crown - pw * 0.03;
  const yBot = f.crown - pw * 0.58;
  return [
    localToWorld(f, -fx2, yBot, toward),
    localToWorld(f, fx2, yBot, toward),
    localToWorld(f, fx2, yTop, toward),
    localToWorld(f, -fx2, yTop, toward),
  ];
}

export { FELT, RAIL };

/* ------------------------------------------------------------------ */
/* The filmed visit (owner, 2026-10-26, late): the bust-portrait      */
/* apparition was rejected on sight ("live posters on a pillar") —    */
/* the rail's visits are now FULL-BODY FILM: a person walks in with   */
/* real steps and weight, settles into living presence, drops his     */
/* line, and walks out into the dark. The registry below drives       */
/* everything: a character with clips leaves the standing ring and    */
/* only visits. This pass converts Uncle Ray only; the other 19       */
/* convert behind his verdict, one registry entry each. All of it is  */
/* pure functions of the cue, so the choreography is unit-testable    */
/* frame by frame.                                                    */
/* ------------------------------------------------------------------ */

export interface RailVisitorClips {
  arrive: string;
  idle: string;
  depart: string;
  /** the full-body art (webp): the reduced-effects still AND the
   *  poster shown until the arrive clip can play. */
  poster: string;
  /** where his shoes meet the frame's bottom, as a fraction of the
   *  frame height — the composite anchors the plane so THIS line
   *  sits on the venue floor. */
  feetFrac: number;
  /** his centre in frame (fraction of width) at each phase's key
   *  moments — the contact shadow tracks him as he crosses. */
  enterX: number;
  settleX: number;
  exitX: number;
}

/** The visit registry. Clips are silent by construction (the encodes
 *  carry no audio stream at all): full-body film generated from a
 *  head-to-toe portrait of the shipped character — identity gated
 *  frame by frame against the portrait — with real locomotion. His
 *  cast recordings play over the film. The choreography constants
 *  themselves live in ./crowdCue (three-free, so the table can stamp
 *  windows without importing three). */
export const RAIL_VISITORS: Record<string, RailVisitorClips> = {
  uncleRay: {
    arrive: '/assets/story/videos/ray-visit-arrive.mp4',
    idle: '/assets/story/videos/ray-visit-idle.mp4',
    depart: '/assets/story/videos/ray-visit-depart.mp4',
    poster: '/assets/story/videos/ray-visit-poster.webp',
    feetFrac: 0.94,
    enterX: 0.3,
    settleX: 0.51,
    exitX: 1.04,
  },
};

const smooth01 = (x: number): number => {
  const c = Math.max(0, Math.min(1, x));
  return c * c * (3 - 2 * c);
};

export type VisitPhase = 'gone' | 'arrive' | 'settled' | 'depart';

export interface VisitState {
  phase: VisitPhase;
  /** plane opacity: 0..VISIT_PEAK (a presence, never solid) */
  opacity: number;
  /** ms into the CURRENT phase's clip (the idle phase loops) */
  clipMs: number;
  /** ms since the window opened (arrive-phase position tracking) */
  elapsedMs: number;
  /** his centre in frame right now (fraction of width) — the
   *  contact shadow follows it across the walk */
  figureX: number;
}

const NO_VISIT: VisitState = { phase: 'gone', opacity: 0, clipMs: 0, elapsedMs: 0, figureX: 0.51 };

/**
 * The visit's phase + envelope at time t. The window stamped on the
 * cue splits by construction: arrive for VISIT_ARRIVE_MS (he walks
 * in and settles; the ghost gathers over the first stretch of the
 * walk), settled for the window's stamped hold (his line lands at
 * its start; the presence loop breathes beneath it), then depart for
 * VISIT_DEPART_MS (the nod, the turn, the walk out — the ghost lets
 * go over the last stretch, as he leaves the light). Outside the
 * window: gone.
 */
export function visitStateAt(t: number, cue: CrowdCue, clips: RailVisitorClips): VisitState {
  if (t < cue.visitAt || t >= cue.visitUntil) return { ...NO_VISIT, figureX: clips.settleX };
  const elapsed = t - cue.visitAt;
  const settledEnd = VISIT_ARRIVE_MS + cue.visitSettledMs;
  if (elapsed < VISIT_ARRIVE_MS) {
    const k = elapsed / VISIT_ARRIVE_MS;
    return {
      phase: 'arrive',
      opacity: VISIT_PEAK * smooth01(elapsed / VISIT_FADE_IN_MS),
      clipMs: elapsed,
      elapsedMs: elapsed,
      figureX: clips.enterX + (clips.settleX - clips.enterX) * smooth01(k),
    };
  }
  if (elapsed < settledEnd) {
    const s = elapsed - VISIT_ARRIVE_MS;
    return {
      phase: 'settled',
      opacity: VISIT_PEAK,
      clipMs: s % VISIT_IDLE_MS,
      elapsedMs: elapsed,
      figureX: clips.settleX,
    };
  }
  const d = elapsed - settledEnd;
  const dk = Math.min(1, d / VISIT_DEPART_MS);
  return {
    phase: 'depart',
    opacity: VISIT_PEAK * (1 - smooth01((d - (VISIT_DEPART_MS - VISIT_FADE_OUT_MS)) / VISIT_FADE_OUT_MS)),
    clipMs: d,
    elapsedMs: elapsed,
    figureX: clips.settleX + (clips.exitX - clips.settleX) * dk,
  };
}
