/**
 * PERSONA FIGURES — rigged 3D bodies for the REGULAR-table bot
 * personas (owner directive 2026-10-29 23:58 EDT: "Build them").
 *
 * At regular (non-story) tables, High quality ONLY: each bot seat
 * whose persona has a shipped figure gets the persona's actual
 * rigged body — built from the same full-body sheet -> Forge TRELLIS
 * -> rig -> Michelle hand-graft pipeline as the story cast, with the
 * face matched to the persona's established portrait (the figure key
 * IS the portrait key: src/personaFigureKey.ts, so face and body can
 * never disagree). Human seats never get figures; story tables keep
 * their own cast system (three/PorchFigures.tsx, KingRail) and this
 * module never mounts there. Low quality never mounts it either —
 * those seats keep today's treatment exactly (DOM portrait plates +
 * the card fans).
 *
 * The seated solve is the Porch pilot's, generalized (this file is
 * that solve with the seat geometry parameterized): UniRig-style
 * role detection from the bind hierarchy, world-space bone aims,
 * two-bone leg IK to flat-foot ankle targets, two-bone arm IK onto
 * the REAL fan's grip points every frame, grafted-finger curl drive,
 * breath / sway / gaze life — no blink: the rigs carry no morphs and
 * a fake blink is worse than none. Role detection sorts chains by
 * +x, which is only figure-local unrotated, so detection and bind
 * measurement run on a detached, unrotated holder first; only
 * placement and the world-space aims see the seat rotation.
 *
 * Chair reconciliation: the twelve venues use TWO chair layouts —
 * the classicStudioLayout spots (classic studio, the Pj's street,
 * the High-Rise penthouse) and the shared "kit" spots every bespoke
 * room re-declares (barbershop, rooftop, yacht, beach, cookout,
 * church basement, Vegas, speakeasy, Grandma's kitchen) — and the
 * seat tops vary by chair (fleet standard floor + 0.49, the penthouse
 * documents 0.45, the beach deck raises its floor). VENUE_SEAT_
 * GEOMETRY below carries each venue's spots, seat top and floor,
 * measured from the room sources and pinned against them by
 * persona-figures.test.ts.
 *
 * Loading: declarative useLoader + Suspense + a per-figure error
 * boundary. The persona GLBs are NOT in the loader's asset gate —
 * deliberately: the gate's promise covers the room and the cards,
 * figures are seat dressing, and the portrait plate + fan already
 * render at the seat, so a figure streams in over today's treatment
 * and a failed figure degrades to exactly today's treatment (the
 * failure names itself on window.__bwmPersonaFigures). Gating every
 * regular table on ~3 x 2.5 MB of dressing would tax every load.
 * (The Porch pilot gates its three GLBs deliberately — it is a story
 * centerpiece, not dressing.)
 *
 * Deliberately NOT here: played-card travel IK (same call as the
 * pilot — production plays are real events on no fixed clock; the
 * arms hold the fan and stay honest), and the pilot's people-framing
 * camera: regular tables keep the stock camera in Batch A; whether
 * the raised framing generalizes is the owner's ratification call.
 */
import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import {
  Box3, Euler, Group, Matrix4, Mesh, Object3D, Quaternion, Vector3, type Material, type MeshStandardMaterial,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { PERSONA_FIGURE_KEYS } from '../personaFigureKey';
import { useFigureResidency } from './figureResidency';
import { CHAIR_SPOTS } from './classicStudioLayout';
import { opponentFan, seatDir, type SeatPos } from './layout';
import { fanRestTarget } from './fanRest';

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

const FLOOR_Y = -0.9;
/** Overall figure scale on top of each register's stature (owner
 *  2026-10-30: "the characters are a bit too small for the table").
 *  Applied inside prepareFigure's bind scale, so placement, the seat
 *  gates, the leg/arm IK and the reach settle all measure the SCALED
 *  skeleton and stay honest — the pelvis is re-anchored to the seat
 *  analytically, so figures grow about their seat, not the floor.
 *  1.10 mirrors the owner's own chair correction (0.82 → 0.90).
 *  Round 2 (owner 2026-10-30 13:16: "still need to be a bit
 *  bigger"): 1.10 → 1.20, judged from player-seat renders — the
 *  added torso height also lifts every head relative to the held
 *  fan, which the face-over-fan composition needed. */
const FIGURE_SCALE = 1.20;
/** Head-clearance floor (metres) the placement keeps between the
 *  head's bounding sphere and the held fan's volume, in the open and
 *  full-rest fan poses (see the placement settle). Covers the frame
 *  loop's breath/sway amplitude with room to spare. */
const HEAD_CLEAR_MIN = 0.025;
/** Chin-point clearance floor (metres) in the placement gate
 *  (round 2): the chin — below the Head bone, toward the table —
 *  is where the fan met the face on screen; the sphere alone
 *  passed it. */
const CHIN_CLEAR_MIN = 0.015;
const HIP_OFF = 0.05;      // hip-joint centre above the seat surface
const HIP_BACK = -0.12;    // hip-joint offset from chair centre, away from the table (seat frame). Round 2: -0.02 -> -0.12 — figures sit deeper in their chairs, heads off the held fan's plane (the partner-seat face/fan failure was depth as much as height); the reach settle re-spends scoot only where grips actually demand it, so the depth persists where it is needed.
const ANKLE_FWD = 0.38;    // ankle target forward of the hip joint (seat frame)

/* Grip calibration against the production opponent fan (opponentFan's
 * middle card), built in the FAN's own frame: GRIP_HALF to each side
 * of the fan's centre line (fan-local +x runs from the seat's right
 * hand toward its left), GRIP_EDGE below the centre along the fan's
 * face — just under the bottom edge of the 0.35-tall cards — and
 * GRIP_BACK to the seat side of the fan's plane, a palm's thickness
 * off it. The previous calibration targeted a point 0.26 behind +
 * 0.13 below the fan CENTRE in seat space: ~0.35 from the fan's
 * bottom edge, past fingertip reach, so the fan floated in front of
 * the hands (owner 2026-10-30: "the characters hands look a lil
 * crazy" — see the hand-orientation solve in the frame loop). */
const GRIP_HALF = 0.085;
/* Round 2 (owner 2026-10-30 13:17: fingers "poke thru the cards"):
 * the wrist sat only 0.01 below the fan's bottom edge, so fingers
 * rising parallel to the fan hooked through its lower third. The
 * grip drops to 0.055 below the edge and farther back, and
 * the hand's approach pitches toward the fan (HAND_PITCH in the
 * frame loop) with the held curl redistributed to the distal
 * joints (GRIP_JOINT_SCALE) — fingers wrap the bottom edge, tips
 * landing just past it on the far side, instead of spearing up
 * the fan's face. */
const GRIP_EDGE = 0.23;
const GRIP_BACK = 0.07;

/** The wrist target for one hand on a held fan, from the fan's
 * middle-card transform (centre + orientation). */
function fanGripPoint(fanC: Vector3, fanQ: Quaternion, side: 'Left' | 'Right', back: number = GRIP_BACK): Vector3 {
  const right = new Vector3(1, 0, 0).applyQuaternion(fanQ);
  const up = new Vector3(0, 1, 0).applyQuaternion(fanQ);
  const normal = new Vector3(0, 0, 1).applyQuaternion(fanQ);
  return fanC.clone()
    .addScaledVector(right, side === 'Left' ? GRIP_HALF : -GRIP_HALF)
    .addScaledVector(up, -GRIP_EDGE)
    .addScaledVector(normal, back);
}

/* Round 2: a bigger hand's palm carries its knuckles — and so its
 * whole finger arc — closer to the fan from the same wrist point.
 * The grip backs off in proportion to the hand's measured size
 * (prep.midLen over the reference hand) so every rig's fingertips
 * land in the same corridor behind the fan's bottom edge. */
const gripBackFor = (prep: PreparedFigure, side: 'Left' | 'Right'): number =>
  GRIP_BACK + Math.max(0, prep.midLen[side] - 0.11) * 1.35;

/* Reach settle bounds (placement): the cast rigs' arms run short
 * (TRELLIS proportions — a 1.8 m figure's shoulder-to-wrist ≈ 0.45 m)
 * and the production side-seat fans sit ~0.93 m from their chair
 * centres, so an upright sit cannot reach the grips. Real players
 * scoot forward on the seat and lean in; the placement does the same,
 * in that order, capped so the figure never perches off the seat:
 * at most REACH_SCOOT of forward shift on the chair (the
 * seat is 0.40 deep; the hip joint stays over it) and at most
 * REACH_LEAN of extra spine lean. The lean cap rose 0.20 → 0.40 with
 * the 2026-10-30 hand fix: once the grips moved onto the fan itself
 * (fanGripPoint), the old caps left side-seat wrists ~0.35 short and
 * the fan floating in front of correctly-posed hands — a player
 * reaching for a fan that far away hunches over it, so the settle
 * may too. Both caps stay need-based: the settle spends only what
 * the grip demands (near seats sit nearly upright). */
/** Round 2: pitch of the hand's approach frame at the fan
 *  (radians about the fan's right/knuckle axis, applied in the
 *  frame-loop orientation solve). Negative tips the fingers
 *  toward the fan's plane as they rise, so they meet the fan's
 *  bottom edge instead of running parallel to its face. */
const HAND_PITCH = -0.24;
const REACH_SCOOT = 0.30;
const REACH_LEAN = 0.40;

/** Chair-spot index per seat position (both layouts below are
 *  stored in this order: top, bottom, left, right). */
const SPOT_INDEX: Record<SeatPos, number> = { top: 0, bottom: 1, left: 2, right: 3 };

/* ------------------------------------------------------------------ */
/* Per-venue seat geometry (measured from the room sources; pinned   */
/* by persona-figures.test.ts). Two chair layouts:                    */
/*  - 'studio': classicStudioLayout.CHAIR_SPOTS — the classic        */
/*    studio, the Pj's street room and the High-Rise penthouse all   */
/*    import them.                                                   */
/*  - 'kit': the spots every bespoke room re-declares identically    */
/*    (pos order in the rooms: bottom, right, top, left — stored     */
/*    here re-ordered to SPOT_INDEX order).                          */
/* seatTop = the world Y of the chair's sitting surface (floor +     */
/* the room chair's seat height); floorY = the world Y the feet      */
/* plant on (the beach deck is raised 0.045 over FLOOR_Y).           */
/* ------------------------------------------------------------------ */

export interface VenueSeatGeometry {
  spots: readonly { x: number; z: number; ry: number }[];
  seatTop: number;
  floorY: number;
}

const KIT_SPOTS: readonly { x: number; z: number; ry: number }[] = [
  { x: 0, z: -1.98, ry: 0 },
  { x: 0, z: 1.98, ry: Math.PI },
  { x: -2.14, z: 0, ry: Math.PI / 2 },
  { x: 2.14, z: 0, ry: -Math.PI / 2 },
];

export const VENUE_SEAT_GEOMETRY: Record<string, VenueSeatGeometry> = {
  classic: { spots: CHAIR_SPOTS, seatTop: -0.41, floorY: FLOOR_Y },
  blockAfterDark: { spots: CHAIR_SPOTS, seatTop: -0.41, floorY: FLOOR_Y },
  mansion: { spots: CHAIR_SPOTS, seatTop: -0.45, floorY: FLOOR_Y },
  barbershop: { spots: KIT_SPOTS, seatTop: -0.396, floorY: FLOOR_Y },
  rooftop: { spots: KIT_SPOTS, seatTop: -0.391, floorY: FLOOR_Y },
  yacht: { spots: KIT_SPOTS, seatTop: -0.373, floorY: FLOOR_Y },
  beach: { spots: KIT_SPOTS, seatTop: -0.365, floorY: -0.855 },
  backyard: { spots: KIT_SPOTS, seatTop: -0.396, floorY: FLOOR_Y },
  church: { spots: KIT_SPOTS, seatTop: -0.396, floorY: FLOOR_Y },
  vegas: { spots: KIT_SPOTS, seatTop: -0.37, floorY: FLOOR_Y },
  speakeasy: { spots: KIT_SPOTS, seatTop: -0.39, floorY: FLOOR_Y },
  grandma: { spots: KIT_SPOTS, seatTop: -0.40, floorY: FLOOR_Y },
};

const DEFAULT_GEOMETRY: VenueSeatGeometry = VENUE_SEAT_GEOMETRY.classic!;

export function seatGeometryFor(venue: string): VenueSeatGeometry {
  return VENUE_SEAT_GEOMETRY[venue] ?? DEFAULT_GEOMETRY;
}

/* ------------------------------------------------------------------ */
/* Per-persona registers: stature + the life mix (breath, sway,       */
/* gaze). Persona-flavored — hype is restless, smooth is still —     */
/* within the pilot solve's proven ranges.                           */
/* ------------------------------------------------------------------ */

interface FigureRegister {
  stature: number;
  spine: [number, number, number];
  breathPeriod: number; breathAmp: number; swayAmp: number;
  gazeDwell: number;
  /** gaze cycle keys: 'fan' | 'trick' | 'human' | a figure key */
  gaze: readonly string[];
}

const FIGURE_REGISTERS: Record<string, FigureRegister> = {
  'coach-f': {
    stature: 1.70, spine: [0.10, 0.08, 0.06],
    breathPeriod: 4.4, breathAmp: 1.0, swayAmp: 0.8, gazeDwell: 3.4,
    gaze: ['fan', 'trick', 'human', 'fan'],
  },
  'mama-m': {
    stature: 1.78, spine: [0.07, 0.05, 0.04],
    breathPeriod: 5.2, breathAmp: 0.8, swayAmp: 0.6, gazeDwell: 4.2,
    gaze: ['trick', 'fan', 'human', 'trick'],
  },
  'influencer-f': {
    stature: 1.68, spine: [0.11, 0.09, 0.07],
    breathPeriod: 3.8, breathAmp: 1.1, swayAmp: 1.2, gazeDwell: 2.6,
    gaze: ['fan', 'human', 'trick', 'fan'],
  },
  'og-m': {
    stature: 1.76, spine: [0.06, 0.05, 0.04],
    breathPeriod: 5.8, breathAmp: 0.6, swayAmp: 0.5, gazeDwell: 4.8,
    gaze: ['trick', 'fan', 'trick', 'human'],
  },
  'hype-f': {
    stature: 1.65, spine: [0.12, 0.10, 0.08],
    breathPeriod: 3.2, breathAmp: 1.3, swayAmp: 1.5, gazeDwell: 2.2,
    gaze: ['fan', 'trick', 'human', 'fan', 'trick'],
  },
  'smooth-m': {
    stature: 1.83, spine: [0.08, 0.06, 0.05],
    breathPeriod: 4.8, breathAmp: 0.8, swayAmp: 0.7, gazeDwell: 3.8,
    gaze: ['fan', 'trick', 'fan', 'human'],
  },
  'professor-m': {
    stature: 1.80, spine: [0.07, 0.05, 0.04],
    breathPeriod: 5.0, breathAmp: 0.7, swayAmp: 0.5, gazeDwell: 4.4,
    gaze: ['trick', 'fan', 'trick', 'human'],
  },
  'silent-m': {
    stature: 1.85, spine: [0.06, 0.05, 0.04],
    breathPeriod: 5.6, breathAmp: 0.6, swayAmp: 0.5, gazeDwell: 4.8,
    gaze: ['trick', 'trick', 'fan', 'human'],
  },
  'barber-m': {
    stature: 1.79, spine: [0.08, 0.06, 0.05],
    breathPeriod: 4.6, breathAmp: 0.9, swayAmp: 0.8, gazeDwell: 3.6,
    gaze: ['fan', 'human', 'trick', 'fan'],
  },
  'barber-f': {
    stature: 1.66, spine: [0.09, 0.07, 0.05],
    breathPeriod: 4.2, breathAmp: 1.0, swayAmp: 0.9, gazeDwell: 3.2,
    gaze: ['fan', 'trick', 'human', 'fan'],
  },
  'deacon-m': {
    stature: 1.77, spine: [0.06, 0.05, 0.04],
    breathPeriod: 5.4, breathAmp: 0.7, swayAmp: 0.5, gazeDwell: 4.6,
    gaze: ['trick', 'fan', 'human', 'trick'],
  },
  'deacon-f': {
    stature: 1.63, spine: [0.07, 0.05, 0.04],
    breathPeriod: 5.0, breathAmp: 0.8, swayAmp: 0.6, gazeDwell: 4.2,
    gaze: ['fan', 'trick', 'fan', 'human'],
  },
  'conspiracy-m': {
    stature: 1.78, spine: [0.10, 0.08, 0.06],
    breathPeriod: 3.9, breathAmp: 1.1, swayAmp: 1.2, gazeDwell: 2.4,
    gaze: ['human', 'trick', 'human', 'fan'],
  },
  'conspiracy-f': {
    stature: 1.69, spine: [0.10, 0.08, 0.06],
    breathPeriod: 4.0, breathAmp: 1.1, swayAmp: 1.1, gazeDwell: 2.6,
    gaze: ['human', 'fan', 'human', 'trick'],
  },
  'petty-m': {
    stature: 1.76, spine: [0.08, 0.06, 0.05],
    breathPeriod: 4.4, breathAmp: 0.9, swayAmp: 0.8, gazeDwell: 3.0,
    gaze: ['human', 'fan', 'trick', 'human'],
  },
  'petty-f': {
    stature: 1.67, spine: [0.09, 0.07, 0.06],
    breathPeriod: 4.1, breathAmp: 1.0, swayAmp: 1.0, gazeDwell: 2.8,
    gaze: ['human', 'trick', 'fan', 'human'],
  },
  'lilcuz-m': {
    stature: 1.74, spine: [0.11, 0.09, 0.07],
    breathPeriod: 3.6, breathAmp: 1.2, swayAmp: 1.3, gazeDwell: 2.4,
    gaze: ['fan', 'human', 'fan', 'trick'],
  },
  'lilcuz-f': {
    stature: 1.64, spine: [0.11, 0.09, 0.07],
    breathPeriod: 3.7, breathAmp: 1.2, swayAmp: 1.4, gazeDwell: 2.3,
    gaze: ['fan', 'trick', 'human', 'fan'],
  },
  'hustler-m': {
    stature: 1.81, spine: [0.09, 0.07, 0.05],
    breathPeriod: 4.3, breathAmp: 0.9, swayAmp: 0.9, gazeDwell: 3.0,
    gaze: ['trick', 'human', 'fan', 'trick'],
  },
  'gambler-m': {
    stature: 1.82, spine: [0.08, 0.06, 0.05],
    breathPeriod: 4.5, breathAmp: 0.9, swayAmp: 0.8, gazeDwell: 3.3,
    gaze: ['trick', 'fan', 'trick', 'human'],
  },
  'hothead-m': {
    stature: 1.86, spine: [0.11, 0.09, 0.07],
    breathPeriod: 3.4, breathAmp: 1.3, swayAmp: 1.4, gazeDwell: 2.2,
    gaze: ['human', 'trick', 'human', 'fan'],
  },
  'hothead-f': {
    stature: 1.70, spine: [0.10, 0.08, 0.06],
    breathPeriod: 3.5, breathAmp: 1.2, swayAmp: 1.3, gazeDwell: 2.4,
    gaze: ['human', 'fan', 'human', 'trick'],
  },
  'comedian-f': {
    stature: 1.68, spine: [0.10, 0.08, 0.07],
    breathPeriod: 3.8, breathAmp: 1.2, swayAmp: 1.3, gazeDwell: 2.5,
    gaze: ['human', 'fan', 'human', 'trick'],
  },
  'storyteller-m': {
    stature: 1.75, spine: [0.07, 0.06, 0.04],
    breathPeriod: 5.2, breathAmp: 0.8, swayAmp: 0.6, gazeDwell: 4.0,
    gaze: ['human', 'trick', 'human', 'fan'],
  },
  'storyteller-f': {
    stature: 1.65, spine: [0.08, 0.06, 0.05],
    breathPeriod: 4.9, breathAmp: 0.9, swayAmp: 0.7, gazeDwell: 3.8,
    gaze: ['human', 'fan', 'trick', 'human'],
  },
  'og-f': {
    stature: 1.62, spine: [0.06, 0.05, 0.04],
    breathPeriod: 5.6, breathAmp: 0.6, swayAmp: 0.5, gazeDwell: 4.7,
    gaze: ['trick', 'fan', 'trick', 'human'],
  },
  'coach-m': {
    stature: 1.84, spine: [0.08, 0.06, 0.05],
    breathPeriod: 4.6, breathAmp: 0.9, swayAmp: 0.7, gazeDwell: 3.6,
    gaze: ['trick', 'human', 'fan', 'trick'],
  },
  'mama-f': {
    stature: 1.67, spine: [0.07, 0.06, 0.04],
    breathPeriod: 5.0, breathAmp: 0.9, swayAmp: 0.7, gazeDwell: 4.0,
    gaze: ['fan', 'human', 'trick', 'fan'],
  },
  'smooth-f': {
    stature: 1.71, spine: [0.07, 0.05, 0.04],
    breathPeriod: 4.9, breathAmp: 0.7, swayAmp: 0.6, gazeDwell: 4.0,
    gaze: ['fan', 'trick', 'human', 'fan'],
  },
  'influencer-m': {
    stature: 1.79, spine: [0.11, 0.09, 0.07],
    breathPeriod: 3.5, breathAmp: 1.2, swayAmp: 1.4, gazeDwell: 2.3,
    gaze: ['fan', 'human', 'trick', 'fan'],
  },
  'hustler-f': {
    stature: 1.68, spine: [0.09, 0.07, 0.05],
    breathPeriod: 4.2, breathAmp: 0.9, swayAmp: 0.9, gazeDwell: 3.0,
    gaze: ['trick', 'human', 'fan', 'trick'],
  },
  'silent-f': {
    stature: 1.72, spine: [0.06, 0.05, 0.04],
    breathPeriod: 5.7, breathAmp: 0.6, swayAmp: 0.5, gazeDwell: 4.9,
    gaze: ['trick', 'trick', 'fan', 'human'],
  },
  'sorelose-f': {
    stature: 1.66, spine: [0.10, 0.08, 0.06],
    breathPeriod: 3.9, breathAmp: 1.1, swayAmp: 1.2, gazeDwell: 2.6,
    gaze: ['human', 'trick', 'human', 'fan'],
  },
  'sorelose-m': {
    stature: 1.79, spine: [0.10, 0.08, 0.06],
    breathPeriod: 4.0, breathAmp: 1.1, swayAmp: 1.1, gazeDwell: 2.7,
    gaze: ['human', 'fan', 'human', 'trick'],
  },
  'professor-f': {
    stature: 1.65, spine: [0.07, 0.05, 0.04],
    breathPeriod: 5.1, breathAmp: 0.7, swayAmp: 0.5, gazeDwell: 4.5,
    gaze: ['trick', 'fan', 'trick', 'human'],
  },
  'hype-m': {
    stature: 1.78, spine: [0.12, 0.10, 0.08],
    breathPeriod: 3.3, breathAmp: 1.3, swayAmp: 1.5, gazeDwell: 2.2,
    gaze: ['fan', 'trick', 'human', 'fan', 'trick'],
  },
  'gambler-f': {
    stature: 1.70, spine: [0.08, 0.06, 0.05],
    breathPeriod: 4.6, breathAmp: 0.9, swayAmp: 0.8, gazeDwell: 3.4,
    gaze: ['trick', 'fan', 'trick', 'human'],
  },
  'comedian-m': {
    stature: 1.80, spine: [0.10, 0.08, 0.07],
    breathPeriod: 3.9, breathAmp: 1.2, swayAmp: 1.3, gazeDwell: 2.5,
    gaze: ['human', 'fan', 'human', 'trick'],
  },
};

const FIGURE_URLS: Record<string, string> = Object.fromEntries(
  PERSONA_FIGURE_KEYS.map((k) => [k, `/assets/figures/personas/${k}.glb`]),
);

/* Figure fill (owner verdict 2026-10-29: the seated cast read "very
 * dark" on device — the left seat measured ~39 luminance against the
 * felt's ~170 in the pilot's own captures: the porch key rakes in
 * from the player's right and the side seats sit in silhouette).
 * Each seated figure gets ONE small warm point light just off its
 * chest on the table side: it lights the PERSON — short range and
 * inverse-square falloff keep the room's golden-hour mood and the
 * felt's exposure as they were. The fills mount inside this module,
 * so they exist exactly where the figures do (solo Porch story,
 * High) and nowhere else. */
const FIGURE_FILL_DIST = 0.55;   // metres off the chair spot, toward the table
const FIGURE_FILL_Y = 0.40;      // ~chest/head height (the gaze anchors' head line)
const FIGURE_FILL_RANGE = 2.4;   // hard range cap: the room beyond stays unlit by it
const FIGURE_FILL_INTENSITY = 1.8;

/* ------------------------------------------------------------------ */
/* UniRig adapter (sandbox port): roles are DETECTED from the bind     */
/* hierarchy — hips = root bone; leg chains by downward reach; spine   */
/* chain upward; arm chains sorted +x-first = Left (the figure faces   */
/* +Z in bind, so +x is its Left). Detection MUST run with the figure  */
/* unrotated (see the header note), on the detached holder.            */
/* ------------------------------------------------------------------ */

const isBone = (o: Object3D) => !!(o as Object3D & { isBone?: boolean }).isBone;

function detectUniRoles(root: Object3D): Record<string, string> {
  const bones: Object3D[] = [];
  root.traverse((o) => { if (isBone(o)) bones.push(o); });
  const wp = (o: Object3D) => o.getWorldPosition(new Vector3());
  const childrenOf = (b: Object3D) => b.children.filter(isBone);
  const chain = (start: Object3D, dirY: number, max = 8): Object3D[] => {
    const out: Object3D[] = [];
    let cur: Object3D | undefined = start;
    for (let i = 0; i < max && cur; i++) {
      out.push(cur);
      const kids = childrenOf(cur);
      if (!kids.length) break;
      const p = wp(cur);
      kids.sort((a, b2) => dirY * (wp(b2).y - p.y) - dirY * (wp(a).y - p.y));
      cur = kids[0];
    }
    return out;
  };
  root.updateMatrixWorld(true);
  const hips = bones.find((b) => !isBone(b.parent as Object3D)) ?? bones[0]!;
  const legChains: Object3D[][] = [];
  const spineStarts: Object3D[] = [];
  for (const k of childrenOf(hips)) {
    const ch = chain(k, -1);
    if (wp(ch[ch.length - 1]!).y < wp(hips).y - 0.25) legChains.push(ch); else spineStarts.push(k);
  }
  legChains.sort((a, b) => wp(b[0]!).x - wp(a[0]!).x); // +x first = Left
  const spine = spineStarts.length ? chain(spineStarts[0]!, +1) : [];
  const spineSet = new Set(spine.map((b) => b.name));
  const armChains: Object3D[][] = [];
  for (const sb of spine) {
    for (const k of childrenOf(sb)) {
      if (spineSet.has(k.name)) continue;
      armChains.push(chain(k, -1));
    }
  }
  armChains.sort((a, b) => wp(b[0]!).x - wp(a[0]!).x); // +x first = Left
  const legL = legChains[0] ?? [], legR = legChains[1] ?? [];
  const armL = armChains[0] ?? [], armR = armChains[1] ?? [];
  const n = (b?: Object3D) => b?.name ?? '';
  return {
    Hips: hips.name,
    Spine: n(spine[0]), Spine1: n(spine[1]), Spine2: n(spine[2]),
    Neck: n(spine[3]), Head: n(spine[spine.length - 1]),
    LeftShoulder: n(armL[0]), LeftArm: n(armL[1]), LeftForeArm: n(armL[2]), LeftHand: n(armL[3]),
    RightShoulder: n(armR[0]), RightArm: n(armR[1]), RightForeArm: n(armR[2]), RightHand: n(armR[3]),
    LeftUpLeg: n(legL[0]), LeftLeg: n(legL[1]), LeftFoot: n(legL[2]), LeftToeBase: n(legL[3]),
    RightUpLeg: n(legR[0]), RightLeg: n(legR[1]), RightFoot: n(legR[2]), RightToeBase: n(legR[3]),
  };
}

/** Auto-upright guards for FBX-derived rigs (sandbox port). The cast
 *  GLBs trigger none of these — they are guards, not corrections. */
function orientUniRig(root: Object3D) {
  const span = (axis: 'y' | 'z') => {
    root.updateMatrixWorld(true);
    let mn = Infinity, mx = -Infinity;
    root.traverse((o) => {
      if (isBone(o)) { const p = o.getWorldPosition(new Vector3()); mn = Math.min(mn, p[axis]); mx = Math.max(mx, p[axis]); }
    });
    return mx - mn;
  };
  if (span('z') > span('y')) { root.rotateX(Math.PI / 2); root.updateMatrixWorld(true); }
  const roles = detectUniRoles(root);
  const byName = (name: string) => { let hit: Object3D | undefined; root.traverse((o) => { if (o.name === name) hit = o; }); return hit; };
  const head = byName(roles.Head!), hips = byName(roles.Hips!);
  if (head && hips && head.getWorldPosition(new Vector3()).y < hips.getWorldPosition(new Vector3()).y) {
    root.rotateX(Math.PI); root.updateMatrixWorld(true);
  }
  const toe = byName(roles.LeftToeBase!), ankle = byName(roles.LeftFoot!);
  if (toe && ankle && toe.getWorldPosition(new Vector3()).z < ankle.getWorldPosition(new Vector3()).z - 0.01) {
    root.rotateY(Math.PI); root.updateMatrixWorld(true);
  }
}

/** Rotate a bone by angle around a WORLD axis through the bone
 *  (sandbox port) — the torso lean is applied in world space, never
 *  as a bone-local Euler guess (the Phase A twisted-legs root cause). */
function rotateBoneWorld(root: Object3D, bone: Object3D, axis: Vector3, angle: number) {
  root.updateMatrixWorld(true);
  const parent = bone.parent!;
  const parentQ = parent.getWorldQuaternion(new Quaternion());
  const boneQ = bone.getWorldQuaternion(new Quaternion());
  const rot = new Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
  const newWorld = rot.multiply(boneQ);
  bone.quaternion.copy(parentQ.invert().multiply(newWorld));
  bone.updateMatrixWorld(true);
}

/* ------------------------------------------------------------------ */
/* Grafted-finger drive (sandbox port): full-grip curl per segment    */
/* (root->tip, rad) from the graft prototype's baked table; the local  */
/* delta per joint is precomputed ONCE from the bind pose (the        */
/* knuckle axis expressed in the joint's PARENT frame — conjugating   */
/* the world-space curl into the parent frame cancels the parent's    */
/* own rotation), so the per-frame driver only scales the angle.      */
/* ------------------------------------------------------------------ */

const FINGER_CURL: Record<string, number[]> = {
  Thumb: [0.35, 0.45, 0.35, 0.2],
  Index: [0.62, 0.85, 0.65, 0.3],
  Middle: [0.66, 0.9, 0.68, 0.3],
  Ring: [0.7, 0.95, 0.7, 0.3],
  Pinky: [0.75, 1.0, 0.72, 0.3],
};
const FINGER_GRIP_SCALE: Record<string, number> = {
  Thumb: 1.0, Index: 1.0, Middle: 1.0, Ring: 0.95, Pinky: 0.88,
};
const FINGER_NAMES = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'] as const;

interface FingerJoint { bone: Object3D; rest: Quaternion; axis: Vector3; angle: number; gripScale: number }

/** Round 2: per-joint share of the held-fan curl, base → tip.
 *  Round 1 applied the full FINGER_CURL at every joint (~2.4 rad
 *  total on the long fingers): the finger rose parallel to the fan
 *  and hooked through it like a fist. A fan grip is mostly distal —
 *  the base joints stay nearly straight along the fan's back while
 *  the last joints wrap the bottom edge. */
const GRIP_JOINT_SCALE: readonly number[] = [0.32, 0.5, 0.95, 1.05];

/** Anatomical frame at the wrist (the graft prototype's basis):
 *  z along the hand's bones (wrist -> chain end), y the palm
 *  direction, x = y x z the knuckle (flexion) axis. */
function knuckleBasis(wrist: Vector3, tip: Vector3, palmExpected: Vector3) {
  const z = tip.clone().sub(wrist).normalize();
  const xHint = new Vector3(0, 0, 1);
  let x = xHint.clone().addScaledVector(z, -xHint.dot(z)).normalize();
  if (x.dot(xHint) < 0) x = x.negate();
  let y = new Vector3().crossVectors(z, x);
  if (y.dot(palmExpected) < 0) { x = x.negate(); y = y.negate(); }
  x = new Vector3().crossVectors(y, z).normalize();
  return { x, y, z };
}

/* ------------------------------------------------------------------ */
/* Bind preparation (detached + unrotated): clone, orient, detect      */
/* roles, resolve bones, measure the rig from its own bind pose,       */
/* scale to the register's stature, precompute the finger drives.      */
/* Runs in useMemo on a FRESH clone of the cached GLTF scene, so a     */
/* re-run starts from the pristine bind every time.                    */
/* ------------------------------------------------------------------ */

const BONE_NAMES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
  'LeftShoulder', 'RightShoulder'] as const;

interface PreparedFigure {
  root: Object3D;
  bones: Record<string, Object3D | undefined>;
  base: Record<string, Quaternion>;
  fingers: { Left: FingerJoint[]; Right: FingerJoint[] };
  /** Each hand's anatomical frame (knuckle axis / palm facing /
   *  finger direction, from knuckleBasis) expressed in the hand
   *  bone's OWN local space at bind. The frame loop maps this frame
   *  onto the held fan's frame to orient the hand at the grip. */
  handFrames: { Left?: { x: Vector3; y: Vector3; z: Vector3 }; Right?: { x: Vector3; y: Vector3; z: Vector3 } };
  /** Per-hand held-curl multiplier from the hand's own size
   *  (round 2: long hands need more bend to land tips in the
   *  same corridor — see prepareFigure). */
  curlF: { Left: number; Right: number };
  /** Rendered middle-finger lengths the curlF calibration read. */
  midLen: { Left: number; Right: number };
  ankleFlat: number;
  thigh: number;
  shin: number;
}

function prepareFigure(scene: Object3D, reg: FigureRegister, maxAniso = 1): PreparedFigure {
  const root = skeletonClone(scene);
  /* Materials: clone per figure (the GLB scene is cache-shared) and
     take shadows; nothing about the cast art itself changes. One
     sampling upgrade (owner 2026-10-29: figures read "REALLY low
     res"): the GLB textures ship with three.js's default anisotropy
     of 1, so the side figures — seen at a grazing angle — smear.
     Raise every map to the device's anisotropy (capped at 8) so the
     texture the GLBs now carry (re-encoded from the Forge source
     PNGs at WebP q95; the pilot's first pass had squeezed a 2048²
     photographic texture into 96–208 KB) actually resolves. */
  root.traverse((o) => {
    const m = o as Mesh;
    if (!(m.isMesh || (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh)) return;
    m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as Material[];
    const cloned = mats.map((mt) => mt.clone());
    m.material = Array.isArray(m.material) ? cloned : cloned[0]!;
    if (maxAniso > 1) {
      for (const mt of cloned) {
        const std = mt as MeshStandardMaterial;
        for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const) {
          const tex = std[key];
          if (tex && tex.anisotropy !== maxAniso) { tex.anisotropy = maxAniso; tex.needsUpdate = true; }
        }
      }
    }
  });
  /* Detached, unrotated holder: world == figure-local for everything
     measured below, whatever seat the figure will sit at. */
  const holder = new Group();
  holder.add(root);
  root.scale.setScalar(1);
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  holder.updateMatrixWorld(true);
  orientUniRig(root);
  holder.updateMatrixWorld(true);
  const roleMap = detectUniRoles(root);
  const byExact = (name: string) => {
    let hit: Object3D | undefined;
    root.traverse((o) => { if (o.name === name) hit = o; });
    return hit;
  };
  const bones: Record<string, Object3D | undefined> = {};
  const base: Record<string, Quaternion> = {};
  for (const n of BONE_NAMES) {
    const b = roleMap[n] ? byExact(roleMap[n]!) : undefined;
    bones[n] = b;
    if (b) base[n] = b.quaternion.clone();
  }
  const jp = (n: string) => bones[n]!.getWorldPosition(new Vector3());
  const bindPos: Record<string, Vector3> = {};
  for (const n of BONE_NAMES) if (bones[n]) bindPos[n] = jp(n);
  const bindBox = new Box3().setFromObject(root);
  /* Grafted fingers: resolve the graft chains hanging off each hand
     bone and precompute each joint's constant local curl delta (the
     sign settled per chain by the prototype's test — rotate the next
     joint +0.3 rad about the axis, keep the sign that moves it
     toward the palm). Rigs without graft joints (Ray's 2-chain
     partial) resolve empty drives and keep their bind fingers. */
  const graftByName = new Map<string, Object3D>();
  root.traverse((o) => { if (o.name.startsWith('graft_')) graftByName.set(o.name, o); });
  const chainEnd = (start: Object3D) => {
    let cur = start;
    for (;;) {
      const kids = cur.children.filter((c) => isBone(c) && !c.name.startsWith('graft_'));
      if (!kids.length) return cur;
      cur = kids[0]!;
    }
  };
  const fingers: { Left: FingerJoint[]; Right: FingerJoint[] } = { Left: [], Right: [] };
  const handFrames: PreparedFigure['handFrames'] = {};
  const curlF: { Left: number; Right: number } = { Left: 1, Right: 1 };
  for (const S of ['L', 'R'] as const) {
    const side = S === 'L' ? 'Left' : 'Right';
    const hand = bones[`${side}Hand`];
    if (!hand) continue;
    const wrist = bindPos[`${side}Hand`]!;
    const tip = chainEnd(hand).getWorldPosition(new Vector3());
    const palm = new Vector3(S === 'L' ? -1 : 1, 0, 0);
    const basis = knuckleBasis(wrist, tip, palm);
    /* The hand's anatomical frame in the hand bone's own local
       space (the bind world frame conjugated by the bone's bind
       world rotation) — see PreparedFigure.handFrames. */
    const hq = hand.getWorldQuaternion(new Quaternion()).invert();
    handFrames[side] = {
      x: basis.x.clone().applyQuaternion(hq),
      y: basis.y.clone().applyQuaternion(hq),
      z: basis.z.clone().applyQuaternion(hq),
    };
    for (const F of FINGER_NAMES) {
      const chain: Object3D[] = [];
      for (let k = 1; k <= 4; k++) {
        const j = graftByName.get(`graft_${S}_${F}${k}`);
        if (j) chain.push(j);
      }
      if (chain.length < 2) continue;
      let sign = 1;
      {
        const o = chain[0]!.getWorldPosition(new Vector3());
        const c0 = chain[1]!.getWorldPosition(new Vector3());
        const rot = new Quaternion().setFromAxisAngle(basis.x, 0.3);
        const moved = c0.clone().sub(o).applyQuaternion(rot).add(o);
        sign = moved.sub(c0).dot(palm) > 0 ? 1 : -1;
      }
      /* Round 2: normalize the held curl by the finger's rendered
         length — the same angles over-reach on long-fingered rigs
         (their tips climbed the fan and hooked deep past it) while
         short fingers barely wrap. Only ever reduces the curl. */
      let fl = 0.02;
      for (let k = 0; k + 1 < chain.length; k++) {
        fl += chain[k]!.getWorldPosition(new Vector3()).distanceTo(chain[k + 1]!.getWorldPosition(new Vector3()));
      }
      const renderScale = (reg.stature * FIGURE_SCALE) / (bindBox.max.y - bindBox.min.y);
      const lenF = Math.min(1, Math.max(0.8, 0.16 / (fl * renderScale)));
      chain.forEach((j, k) => {
        const pq = j.parent!.getWorldQuaternion(new Quaternion());
        const axis = basis.x.clone().applyQuaternion(pq.invert()).normalize();
        fingers[side].push({
          bone: j, rest: j.quaternion.clone(), axis,
          angle: sign * FINGER_CURL[F]![k]! * FINGER_GRIP_SCALE[F]!,
          gripScale: (GRIP_JOINT_SCALE[k] ?? 1) * lenF,
        });
      });
    }
  }
  const segLen = (a: string, b: string) => bindPos[a]!.distanceTo(bindPos[b]!);
  const height = bindBox.max.y - bindBox.min.y;
  const s = (reg.stature * FIGURE_SCALE) / height;
  root.scale.setScalar(s);
  holder.updateMatrixWorld(true);
  /* Round 2: per-hand grip calibration from the middle finger's
     RENDERED length, measured on the scaled figure (the graft
     chains are near-uniform in bind; hand size rides the rig's
     bone scales, so bind lengths cannot see it). A longer hand at
     the same angles lands its tips higher up the fan and deeper
     past it (the chord grows with the arc); hitting the same tip
     target takes MORE total bend, and the approach pitch shallows
     in step so the chord's direction (pitch + bend/2) holds. */
  const midLenOf = (S: 'L' | 'R'): number => {
    const pts = [1, 2, 3, 4]
      .map(k => graftByName.get(`graft_${S}_Middle${k}`))
      .filter((o): o is Object3D => !!o);
    if (pts.length < 2) return 0.17;
    let L = 0;
    for (let k = 0; k + 1 < pts.length; k++) {
      L += pts[k]!.getWorldPosition(new Vector3()).distanceTo(pts[k + 1]!.getWorldPosition(new Vector3()));
    }
    return L + (L / (pts.length - 1)) * 0.6;
  };
  const midLen = { Left: midLenOf('L'), Right: midLenOf('R') };
  curlF.Left = Math.min(1.6, Math.max(1, 1 + (midLen.Left - 0.11) * 8.5));
  curlF.Right = Math.min(1.6, Math.max(1, 1 + (midLen.Right - 0.11) * 8.5));
  return {
    root, bones, base, fingers, handFrames, curlF, midLen,
    ankleFlat: (bindPos.LeftFoot!.y - bindBox.min.y) * s,
    thigh: segLen('LeftUpLeg', 'LeftLeg') * s,
    shin: segLen('LeftLeg', 'LeftFoot') * s,
  };
}

/* ------------------------------------------------------------------ */
/* One seated figure                                                   */
/* ------------------------------------------------------------------ */

interface FigureProps {
  id: string;
  url: string;
  reg: FigureRegister;
  seatPos: SeatPos;
  n: number;
  count: number;
  active: boolean;
  aspect: number;
  view: 'standing' | 'sitting';
  animate: boolean;
  anchors: { trick: Vector3; human: Vector3; heads: Record<string, Vector3> };
  /** the venue's chair layout + seat top + floor (VENUE_SEAT_GEOMETRY) */
  spots: readonly { x: number; z: number; ry: number }[];
  seatTop: number;
  floorY: number;
}

function Figure({ id, url, reg, seatPos, n, count, active, aspect, view, animate, anchors, spots, seatTop, floorY }: FigureProps) {
  const gltf = useLoader(GLTFLoader, url);
  /* Residency (crash hardening): same shared figure budget as the
     story cast — see figureResidency / PorchFigures. */
  useFigureResidency(url, gltf);
  const gl = useThree((s) => s.gl);
  const prep = useMemo(
    () => prepareFigure(gltf.scene, reg, Math.min(8, gl.capabilities.getMaxAnisotropy())),
    [gltf, reg, gl],
  );
  const groupRef = useRef<Group>(null!);
  const headState = useRef({ yaw: 0, pitch: 0, next: 0, idx: 0 });
  const restCur = useRef<{ drop: number; pinch: number } | null>(null);
  const fanRef = useRef(new Vector3());
  const solvedFrames = useRef(0);
  /* Round-2 diagnosis: what the placement effect saw (the card
     count at mount) and the head clearance it ended with. */
  const placedRef = useRef<{ count: number; clear: number | null }>({ count: -1, clear: null });
  const camera = useThree((s) => s.camera);
  const viewSize = useThree((s) => s.size);

  useEffect(() => {
    const w = window as unknown as { __bwmPersonaFigures?: { mounted: string[]; failed: string[] } };
    w.__bwmPersonaFigures ??= { mounted: [], failed: [] };
    if (!w.__bwmPersonaFigures.mounted.includes(id)) w.__bwmPersonaFigures.mounted.push(id);
  }, [id]);

  /* Pose-gate probe (the sandbox's MeasureDump discipline): once the
     pose has settled, publish the measured facts the gates judge —
     hip height over the floor, ankle height, toe-vs-ankle drop (foot
     flatness), and each hand joint's distance to its grip target.
     Samples twice (1.5 s and 5 s): on a starved canvas the first
     sample can land before the solve's first frames, so the second
     overwrites it with the settled pose. */
  useEffect(() => {
    const sample = () => {
      const { root, bones: b } = prep;
      root.updateMatrixWorld(true);
      const wp = (nm: string) => b[nm]?.getWorldPosition(new Vector3());
      const target = fanRestTarget({ aspect, view, seatIsActive: active });
      const fanX = count > 0
        ? opponentFan(seatPos, n, (count - 1) / 2, count, target.drop, target.pinch)
        : null;
      const fanC = fanX ? new Vector3(...fanX.p) : null;
      const fanQ = fanX ? new Quaternion(...fanX.q) : null;
      const gripFor = (side: 'Left' | 'Right') => (fanC && fanQ ? fanGripPoint(fanC, fanQ, side, gripBackFor(prep, side)) : null);
      /* Fingertip clearance to the fan's plane: the smallest
       * |signed distance| over the hand's fingertip joints. A hand
       * that holds the fan has fingertips ON its plane (wrapping
       * its lower edge); the old grip left them ~0.25 off it. */
      const tipGap = (S: 'L' | 'R') => {
        if (!fanC || !fanQ) return null;
        const normal = new Vector3(0, 0, 1).applyQuaternion(fanQ);
        let best: number | null = null;
        root.traverse((o) => {
          if (!o.name.startsWith(`graft_${S}_`) || !o.name.endsWith('4')) return;
          const p = o.getWorldPosition(new Vector3());
          const g = Math.abs(p.clone().sub(fanC).dot(normal));
          if (best === null || g < best) best = g;
        });
        return best === null ? null : Math.round(best * 1000) / 1000;
      };
      /* Head clearance to the fan's volume (owner 2026-10-30:
       * Queenie/mama-f's head poked through her fan at the partner
       * seat): signed distance from the head bone (as a 0.12-radius
       * sphere — the head's bounding volume at these statures) to
       * the fan's oriented box. Negative = the head intersects the
       * fan. Measured over the current target fan, the open fan
       * (the binding case — it rides highest and nearest the head)
       * and the full-rest fan. chinClear (round 2) is the same
       * measure for the chin point with no radius: the face's
       * lowest, most forward point is where the fan met it. */
      const fanDist = (p: Vector3, fc: Vector3, fq: Quaternion, pinch: number) => {
        const local = p.clone().sub(fc).applyQuaternion(fq.clone().invert());
        const halfW = ((count - 1) / 2) * 0.038 * (1 - 0.45 * pinch) + 0.125;
        const ox = Math.abs(local.x) - halfW;
        const oy = Math.abs(local.y) - 0.175;
        const oz = Math.abs(local.z) - 0.012;
        const outside = Math.hypot(Math.max(ox, 0), Math.max(oy, 0), Math.max(oz, 0));
        return outside > 0 ? outside : -Math.min(-ox, -oy, -oz);
      };
      const clearOverFans = (p: Vector3, radius: number) => {
        if (!fanC || !fanQ || count === 0) return null;
        const openX = opponentFan(seatPos, n, (count - 1) / 2, count, 0, 0);
        const restX = opponentFan(seatPos, n, (count - 1) / 2, count, 1, 1);
        const fans: [Vector3, Quaternion, number][] = [
          [fanC, fanQ, target.pinch],
          [new Vector3(...openX.p), new Quaternion(...openX.q), 0],
          [new Vector3(...restX.p), new Quaternion(...restX.q), 1],
        ];
        let worst = Infinity;
        for (const [fc, fq, pinch] of fans) worst = Math.min(worst, fanDist(p, fc, fq, pinch) - radius);
        return Math.round(worst * 1000) / 1000;
      };
      const headClear = () => {
        const hp = wp('Head');
        return hp ? clearOverFans(hp, 0.12) : null;
      };
      const chinClear = () => {
        const hp = wp('Head');
        if (!hp) return null;
        const faceW = seatDir(seatPos, n).negate();
        const chin = hp.clone().add(new Vector3(0, -0.105, 0)).addScaledVector(faceW, 0.055);
        return clearOverFans(chin, 0);
      };
      /* Round 2 (owner 2026-10-30 13:17: hands "poke thru the
       * cards", "wrong orientation"): a SIGNED audit of every hand
       * joint in the fan's own frame — round 1's fanGap was an
       * unsigned plane distance, so a fingertip punching THROUGH
       * the fan scored like one resting on it. pen = deepest
       * crossing of the fan's front-face plane (fan-local z <
       * -0.002, the card-face side) by a joint inside the fan's
       * bounds above the bottom wrap band (y >= -0.155): fingers
       * may wrap the bottom edge, nothing may cross mid-fan.
       * tips = each fingertip's fan-local (y, z): a real hold has
       * them at the bottom edge, z near 0. wrist likewise. */
      const handAudit = (S: 'L' | 'R') => {
        if (!fanC || !fanQ || count === 0) return null;
        const inv = fanQ.clone().invert();
        const halfW = ((count - 1) / 2) * 0.038 * (1 - 0.45 * target.pinch) + 0.125;
        let pen = 0; let penJoint = '';
        const tips: Record<string, [number, number]> = {};
        const local = (o: Object3D) => o.getWorldPosition(new Vector3()).sub(fanC).applyQuaternion(inv);
        const testPen = (p: Vector3, name: string) => {
          /* Corridor rule: fingers legitimately wrap the bottom
             edge — in the wrap band (y in [-0.16, -0.10]) tips may
             sit up to 0.035 past the plane (pads on the backs);
             above the band, nothing crosses the front-face plane;
             below the band is open air under the fan. pen = the
             deepest violation of that corridor. */
          if (Math.abs(p.x) > halfW + 0.03 || p.y < -0.16) return;
          const allowed = p.y >= -0.10 ? -0.002 : -0.035;
          if (p.z < allowed) {
            const depth = allowed - p.z;
            if (depth > pen) { pen = depth; penJoint = name; }
          }
        };
        root.traverse((o) => {
          if (!o.name.startsWith(`graft_${S}_`)) return;
          const p = local(o);
          testPen(p, o.name);
          if (o.name.endsWith('4')) {
            tips[o.name.split('_')[2]!.replace(/4$/, '')] = [Math.round(p.y * 1000) / 1000, Math.round(p.z * 1000) / 1000];
          }
        });
        const hw = wp(S === 'L' ? 'LeftHand' : 'RightHand');
        let wrist: [number, number, number] | null = null;
        if (hw) {
          const p = hw.clone().sub(fanC).applyQuaternion(inv);
          testPen(p, 'Hand');
          wrist = [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000, Math.round(p.z * 1000) / 1000];
        }
        return { pen: Math.round(pen * 1000) / 1000, penJoint, tips, wrist, ml: Math.round(prep.midLen[S === 'L' ? 'Left' : 'Right'] * 1000) / 1000, cf: Math.round(prep.curlF[S === 'L' ? 'Left' : 'Right'] * 100) / 100 };
      };
      /* Round 2: the composition the owner's eye judges, in screen
       * space from the live camera — chin point and the fan's top
       * edge projected to pixels. margin = fan-top y at the chin's
       * x minus chin y (px): positive means the fan's top edge sits
       * BELOW the chin (peering over); negative = the fan crosses
       * the face. Round 1's gate was world-space only and passed
       * compositions the owner failed on sight. */
      const scr = () => {
        const hp = wp('Head');
        if (!hp || !fanC || !fanQ || count === 0) return null;
        const px = (v: Vector3): [number, number] => {
          const p = v.clone().project(camera);
          return [Math.round((p.x * 0.5 + 0.5) * viewSize.width), Math.round((1 - (p.y * 0.5 + 0.5)) * viewSize.height)];
        };
        const faceW = seatDir(seatPos, n).negate();
        const chin = hp.clone().add(new Vector3(0, -0.105, 0)).addScaledVector(faceW, 0.055);
        const crown = hp.clone().add(new Vector3(0, 0.13, 0));
        const right = new Vector3(1, 0, 0).applyQuaternion(fanQ);
        const up = new Vector3(0, 1, 0).applyQuaternion(fanQ);
        const halfW = ((count - 1) / 2) * 0.038 * (1 - 0.45 * target.pinch) + 0.125;
        const tl = fanC.clone().addScaledVector(right, -halfW).addScaledVector(up, 0.175);
        const tr = fanC.clone().addScaledVector(right, halfW).addScaledVector(up, 0.175);
        const [hx, hy] = px(hp); const [cx, cy] = px(chin); const [, cry] = px(crown);
        const [lx, ly] = px(tl); const [rx, ry] = px(tr);
        const t = rx === lx ? 0 : Math.max(0, Math.min(1, (cx - lx) / (rx - lx)));
        const fanTop = Math.round(ly + (ry - ly) * t);
        return { head: [hx, hy], chin: [cx, cy], crownY: cry, fanTop, margin: fanTop - cy };
      };
      const dist = (nm: string, tgt: Vector3 | null) => {
        const p = wp(nm);
        return p && tgt ? Math.round(p.distanceTo(tgt) * 1000) / 1000 : null;
      };
      const v3 = (p?: Vector3) => (p ? [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100, Math.round(p.z * 100) / 100] : null);
      const armInfo = (side: 'Left' | 'Right') => {
        const S = wp(`${side}Arm`); const E = wp(`${side}ForeArm`); const H = wp(`${side}Hand`);
        const grip = gripFor(side);
        if (!S || !E || !H) return null;
        return {
          L1: Math.round(S.distanceTo(E) * 1000) / 1000,
          L2: Math.round(E.distanceTo(H) * 1000) / 1000,
          delta: grip ? Math.round(S.distanceTo(grip) * 1000) / 1000 : null,
          grip: v3(grip ?? undefined), hand: v3(H), shoulder: v3(S),
        };
      };
      const y = (nm: string) => { const p = wp(nm); return p ? Math.round(p.y * 1000) / 1000 : null; };
      const w = window as unknown as { __bwmPersonaFigures?: { gates?: Record<string, unknown> } };
      w.__bwmPersonaFigures ??= { mounted: [], failed: [] } as never;
      (w.__bwmPersonaFigures as { gates?: Record<string, unknown> }).gates ??= {};
      (w.__bwmPersonaFigures as { gates?: Record<string, unknown> }).gates![id] = {
        hipY: y('Hips'), ankleYL: y('LeftFoot'), ankleYR: y('RightFoot'),
        toeYL: y('LeftToeBase'), toeYR: y('RightToeBase'),
        gripErrL: dist('LeftHand', gripFor('Left')), gripErrR: dist('RightHand', gripFor('Right')),
        fanGapL: tipGap('L'), fanGapR: tipGap('R'),
        headClear: headClear(), chinClear: chinClear(), head: v3(wp('Head') ?? undefined),
        gateCount: placedRef.current.count, placedClear: placedRef.current.clear,
        auditL: handAudit('L'), auditR: handAudit('R'), scr: scr(),
        ankleFlat: Math.round(prep.ankleFlat * 1000) / 1000,
        armL: armInfo('Left'), armR: armInfo('Right'), fanC: v3(fanC ?? undefined),
      };
    };
    const t1 = window.setTimeout(sample, 1500);
    const t2 = window.setTimeout(sample, 5000);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [prep, id, aspect, view, active, count, seatPos, n]);

  /* Placement + static pose (once, at mount): torso lean in world
     space, hip onto the production chair's seat, legs by two-bone IK
     to flat-foot ankle targets — the sandbox solve, with the Porch
     chair's own seat top in place of the studio's. */
  useLayoutEffect(() => {
    const group = groupRef.current;
    const { root, bones, base } = prep;
    const jp = (nm: string) => bones[nm]!.getWorldPosition(new Vector3());
    const aim = (boneName: string, childName: string, target: Vector3) => {
      const bone = bones[boneName]; const child = bones[childName];
      if (!bone || !child || !bone.parent) return;
      root.updateMatrixWorld(true);
      const pb = bone.getWorldPosition(new Vector3());
      const pc = child.getWorldPosition(new Vector3());
      const cur = pc.sub(pb).normalize();
      const des = target.clone().sub(pb).normalize();
      const R = new Quaternion().setFromUnitVectors(cur, des);
      const qb = bone.getWorldQuaternion(new Quaternion());
      const qp = bone.parent.getWorldQuaternion(new Quaternion());
      bone.quaternion.copy(qp.invert().multiply(R).multiply(qb));
      base[boneName] = bone.quaternion.clone();
      root.updateMatrixWorld(true);
    };
    /* Torso lean: world-space rotation about the seat's right axis,
       verified closed-loop — if the head did not move toward the
       table, the lean is flipped and re-applied. */
    const spot = spots[SPOT_INDEX[seatPos]]!;
    const faceW = seatDir(seatPos, n).negate();
    const leanAxis = new Vector3(0, 1, 0).cross(faceW).normalize();
    const headBefore = jp('Head').clone();
    const lean = (nm: string, a: number) => {
      const b = bones[nm]; if (!b) return;
      rotateBoneWorld(root, b, leanAxis, a);
      base[nm] = b.quaternion.clone();
    };
    lean('Spine', reg.spine[0]); lean('Spine1', reg.spine[1]); lean('Spine2', reg.spine[2]);
    root.updateMatrixWorld(true);
    let leanFlipped = false;
    if (jp('Head').sub(headBefore).dot(faceW) < 0) {
      lean('Spine', -2 * reg.spine[0]); lean('Spine1', -2 * reg.spine[1]); lean('Spine2', -2 * reg.spine[2]);
      leanFlipped = true;
    }
    /* Hip joints onto the seat: joint world positions converted into
       seat-group space analytically (group = chair spot + ry), the
       root offset so the PELVIS midpoint lands at (centred x,
       seatTop + HIP_OFF, HIP_BACK) in that space. (The sandbox
       centred on the left hip joint alone; the midpoint keeps the
       shoulders symmetric over the chair, which the side seats' grip
       geometry needs.) */
    group.updateMatrixWorld(true);
    root.updateMatrixWorld(true);
    const invQ = new Quaternion().setFromEuler(new Euler(0, -spot.ry, 0));
    const toLocal = (w: Vector3) => w.sub(new Vector3(spot.x, 0, spot.z)).applyQuaternion(invQ);
    const ulL = toLocal(jp('LeftUpLeg'));
    const ulR = toLocal(jp('RightUpLeg'));
    root.position.set(-(ulL.x + ulR.x) / 2, (seatTop + HIP_OFF) - ulL.y, HIP_BACK - (ulL.z + ulR.z) / 2);
    root.updateMatrixWorld(true);
    /* Reach settle (REACH_SCOOT / REACH_LEAN above): measure each
       shoulder's distance to its grip on the OPEN fan (the rested fan
       sits closer, so the open pose is the binding case) and close
       the gap — scoot first, then extra lean — until both grips are
       inside the arms' reach or the caps run out. Runs BEFORE the
       leg solve so the feet plant for the final seat position. */
    if (count > 0) {
      const fanX0 = opponentFan(seatPos, n, (count - 1) / 2, count, 0, 0);
      const fanC0 = new Vector3(...fanX0.p);
      const fanQ0 = new Quaternion(...fanX0.q);
      const gripOf = (side: 'Left' | 'Right') => fanGripPoint(fanC0, fanQ0, side, gripBackFor(prep, side));
      /* Head-clearance gate (owner 2026-10-30: Queenie's fan cut
         across her chin at the partner seat): the head's bounding
         volume — a 0.12 sphere on the Head bone — must clear the
         fan's volume by HEAD_CLEAR_MIN in BOTH the open and the
         full-rest fan poses, for every key at every seat. If the
         register lean alone puts the head into the fan, trim the
         lean first (the character sits up straighter); the settle
         below is gated on the same metric, so closing reach can
         never push the head in either. */
      const headClearNow = () => {
        const hp = jp('Head');
        /* Round 2 (owner 2026-10-30 13:16): the sphere on the Head
           bone passed while the FACE — which extends down and
           toward the table from the bone — still met the fan, and
           for the shortest cast member (influencer-f, stature
           1.68) lean trim alone exhausted with the sphere still
           intersecting: the gate failed silently. The gate now
           also clears the CHIN point (below the bone, toward the
           table — the screen-space failure point) by CHIN_CLEAR_MIN
           in the same two poses; the fan drop (OPP_FAN_BASE_Y
           0.25 → 0.21) and the 1.20 figure scale give the trim the
           room it was missing. */
        const chin = hp.clone().add(new Vector3(0, -0.105, 0)).addScaledVector(faceW, 0.055);
        let worst = Infinity;
        for (const pose of [0, 1] as const) {
          const fx = opponentFan(seatPos, n, (count - 1) / 2, count, pose, pose);
          const fc = new Vector3(...fx.p);
          const fq = new Quaternion(...fx.q);
          const distTo = (p: Vector3) => {
            const local = p.clone().sub(fc).applyQuaternion(fq.clone().invert());
            const halfW = ((count - 1) / 2) * 0.038 * (1 - 0.45 * pose) + 0.125;
            const ox = Math.abs(local.x) - halfW;
            const oy = Math.abs(local.y) - 0.175;
            const oz = Math.abs(local.z) - 0.012;
            const outside = Math.hypot(Math.max(ox, 0), Math.max(oy, 0), Math.max(oz, 0));
            return outside > 0 ? outside : -Math.min(-ox, -oy, -oz);
          };
          worst = Math.min(worst, distTo(hp) - 0.12, distTo(chin) - CHIN_CLEAR_MIN + HEAD_CLEAR_MIN);
        }
        return worst;
      };
      const leanSign = leanFlipped ? 1 : -1;
      let trimmed = 0;
      while (headClearNow() < HEAD_CLEAR_MIN && trimmed < 0.3) {
        lean('Spine', leanSign * 0.012); lean('Spine1', leanSign * 0.0105); lean('Spine2', leanSign * 0.0075);
        trimmed += 0.03;
        root.updateMatrixWorld(true);
      }
      let scoot = 0; let extraLean = 0;
      /* The iteration budget must cover BOTH caps at their step
         sizes (scoot closes in ~2 steps; lean advances 0.05/step, so
         REACH_LEAN 0.40 alone needs 8) — at 6 the loop, not the caps,
         was the binding constraint and the lean never passed 0.20. */
      for (let iter = 0; iter < 24; iter++) {
        root.updateMatrixWorld(true);
        let worst = 0;
        for (const side of ['Left', 'Right'] as const) {
          const S = jp(`${side}Arm`); const E = jp(`${side}ForeArm`); const H = jp(`${side}Hand`);
          const reach = (S.distanceTo(E) + E.distanceTo(H)) * 0.96;
          worst = Math.max(worst, S.distanceTo(gripOf(side)) - reach);
        }
        if (worst <= 0.005) break;
        if (scoot < REACH_SCOOT) {
          const s = Math.min(worst * 0.8, REACH_SCOOT - scoot);
          root.position.z += s; scoot += s;
          root.updateMatrixWorld(true);
          /* Head gate outranks the last of the reach: a step that
             puts the head into the fan is reverted and ends the
             settle (the hands land where honest reach ends). */
          if (headClearNow() < HEAD_CLEAR_MIN) { root.position.z -= s; scoot -= s; break; }
        } else if (extraLean < REACH_LEAN) {
          const a = Math.min(0.05, REACH_LEAN - extraLean);
          lean('Spine', a * 0.4); lean('Spine1', a * 0.35); lean('Spine2', a * 0.25);
          extraLean += a;
          root.updateMatrixWorld(true);
          if (headClearNow() < HEAD_CLEAR_MIN) {
            lean('Spine', -a * 0.4); lean('Spine1', -a * 0.35); lean('Spine2', -a * 0.25);
            extraLean -= a; break;
          }
        } else break;
        root.updateMatrixWorld(true);
      }
    }
    /* Legs: two-bone IK to a flat-foot ankle target, then world aim.
       Targets built in seat-group space, converted to world. */
    const sideVec = new Vector3(1, 0, 0).applyQuaternion(new Quaternion().setFromEuler(new Euler(0, spot.ry, 0)));
    for (const side of ['Left', 'Right'] as const) {
      const hipW = jp(`${side}UpLeg`);
      const hipLocal = group.worldToLocal(hipW.clone());
      const ankleLocal = new Vector3(hipLocal.x, floorY + prep.ankleFlat, hipLocal.z + ANKLE_FWD);
      const ankle = group.localToWorld(ankleLocal.clone());
      const D = ankle.distanceTo(hipW);
      const a = (prep.thigh * prep.thigh + D * D - prep.shin * prep.shin) / (2 * D);
      const h = Math.sqrt(Math.max(0, prep.thigh * prep.thigh - a * a));
      const axis = ankle.clone().sub(hipW).normalize();
      // Knee bulge: perpendicular to the hip->ankle axis in the seat's
      // sagittal plane, flipped to face the table.
      const perp = new Vector3().crossVectors(axis, sideVec);
      if (perp.dot(faceW) < 0) perp.negate();
      const knee = hipW.clone().addScaledVector(axis, a).addScaledVector(perp, h);
      aim(`${side}UpLeg`, `${side}Leg`, knee);
      aim(`${side}Leg`, `${side}Foot`, ankle);
      const foot = jp(`${side}Foot`);
      aim(`${side}Foot`, `${side}ToeBase`, foot.clone().add(new Vector3(faceW.x, -0.02, faceW.z)));
    }
    /* Round-2 diagnosis: record the count placement saw and the
       head clearance the placed pose ends with (13-card fan either
       way — the binding width), so the probe can tell a gate that
       never ran from a gate that ran and lost. */
    {
      const hp = jp('Head');
      let worst = Infinity;
      const ec = 13;
      for (const pose of [0, 1] as const) {
        const fx = opponentFan(seatPos, n, (ec - 1) / 2, ec, pose, pose);
        const fc = new Vector3(...fx.p);
        const fq = new Quaternion(...fx.q);
        const local = hp.clone().sub(fc).applyQuaternion(fq.clone().invert());
        const halfW = ((ec - 1) / 2) * 0.038 * (1 - 0.45 * pose) + 0.125;
        const ox = Math.abs(local.x) - halfW;
        const oy = Math.abs(local.y) - 0.175;
        const oz = Math.abs(local.z) - 0.012;
        const outside = Math.hypot(Math.max(ox, 0), Math.max(oy, 0), Math.max(oz, 0));
        const dd = outside > 0 ? outside : -Math.min(-ox, -oy, -oz);
        worst = Math.min(worst, dd - 0.12);
      }
      placedRef.current = { count, clear: Math.round(worst * 1000) / 1000 };
    }
  }, [prep, seatPos, n, reg, spots, seatTop, floorY]);

  const headWorld = useMemo(() => new Vector3(), []);

  useFrame(({ clock }, dt) => {
    const { root, bones: b, base, fingers } = prep;
    const group = groupRef.current;
    if (!group) return;
    /* Under reduced life the pose still solves (the fan moves with
       the game), but only until the grips settle; breath/gaze/finger
       phase stay frozen — the King figures' animate contract. */
    const settle = !animate && solvedFrames.current > 120;
    /* Fan rest pose for THIS seat, eased toward its target so the
       hands ride the fan down and up with the game's own rest. */
    const target = fanRestTarget({ aspect, view, seatIsActive: active });
    if (!restCur.current || !animate) restCur.current = { ...target };
    else {
      const k = Math.min(1, Math.max(0, dt) * 4.5);
      restCur.current.drop += (target.drop - restCur.current.drop) * k;
      restCur.current.pinch += (target.pinch - restCur.current.pinch) * k;
    }
    const rest = restCur.current;
    /* The fan's centre card, from the same solver the cards use. */
    const hasCards = count > 0;
    const fanX = hasCards
      ? opponentFan(seatPos, n, (count - 1) / 2, count, rest.drop, rest.pinch)
      : null;
    const fanC = fanX
      ? new Vector3(...fanX.p)
      : group.localToWorld(new Vector3(0, seatTop + 0.3, 0.55));
    const fanQ = fanX ? new Quaternion(...fanX.q) : null;
    fanRef.current.copy(fanC);
    if (settle) return;
    solvedFrames.current++;
    const t = clock.elapsedTime;
    /* Reset the animated bones to the seated base pose, then layer
       procedural life on top (the sandbox contract). */
    for (const nm of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
      'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand']) {
      if (b[nm] && base[nm]) b[nm]!.quaternion.copy(base[nm]!);
    }
    if (animate) {
      const breath = Math.sin(t * (Math.PI * 2 / reg.breathPeriod)) * reg.breathAmp;
      if (b.Spine1 && base.Spine1) {
        b.Spine1.quaternion.copy(base.Spine1)
          .multiply(new Quaternion().setFromEuler(new Euler(breath * 0.018, 0, 0)));
      }
      if (b.Spine2 && base.Spine2) {
        b.Spine2.quaternion.copy(base.Spine2)
          .multiply(new Quaternion().setFromEuler(new Euler(breath * 0.012, Math.sin(t * 0.23) * 0.01 * reg.swayAmp, Math.sin(t * 0.31) * 0.008 * reg.swayAmp)));
      }
      if (b.Hips && base.Hips) {
        b.Hips.quaternion.copy(base.Hips)
          .multiply(new Quaternion().setFromEuler(new Euler(0, Math.sin(t * 0.17) * 0.02 * reg.swayAmp, Math.sin(t * 0.13) * 0.012 * reg.swayAmp)));
      }
      /* Gaze: a new target every dwell; the head eases toward it by a
         clamped world-space delta (seat-agnostic). */
      const st = headState.current;
      if (t > st.next) { st.idx = (st.idx + 1) % reg.gaze.length; st.next = t + reg.gazeDwell; }
      const key = reg.gaze[st.idx]!;
      const gazeTarget = key === 'fan' ? fanC
        : key === 'trick' ? anchors.trick
        : key === 'human' ? anchors.human
        : (anchors.heads[key] ?? anchors.trick);
      root.updateMatrixWorld(true);
      const aimHead = (boneName: string, factor: number) => {
        const bone = b[boneName]; if (!bone || !bone.parent) return;
        bone.getWorldPosition(headWorld);
        const wq = bone.getWorldQuaternion(new Quaternion());
        const fwd = new Vector3(0, 0, 1).applyQuaternion(wq);
        const des = gazeTarget.clone().sub(headWorld).normalize();
        const delta = new Quaternion().setFromUnitVectors(fwd, des);
        const ang = 2 * Math.acos(Math.max(-1, Math.min(1, delta.w)));
        const clamped = ang > 0.65 ? new Quaternion().slerp(new Quaternion().setFromUnitVectors(fwd, des), 0.65 / ang) : delta;
        const qw = clamped.multiply(wq);
        const qp = bone.parent.getWorldQuaternion(new Quaternion());
        bone.quaternion.slerp(qp.invert().multiply(qw), factor);
      };
      aimHead('Neck', 0.03);
      aimHead('Head', 0.05);
      if (b.Head && base.Head) {
        b.Head.quaternion.multiply(new Quaternion().setFromEuler(new Euler(breath * 0.006, 0, 0)));
      }
    }
    /* Arms: BOTH hands are two-bone-IK'd onto their targets every
       frame — the fan's grip points while the seat holds cards
       (hands behind the fan's lower edge, backs of the cards to the
       table: a bot's faces are never shown), the lap when it holds
       none. The grip must be solved, not guessed (Phase A lesson). */
    const solveArm = (side: 'Left' | 'Right') => {
      const arm = b[`${side}Arm`], fore = b[`${side}ForeArm`], hand = b[`${side}Hand`];
      if (!arm || !fore || !hand || !arm.parent || !fore.parent) return;
      root.updateMatrixWorld(true);
      const targetPos = hasCards && fanQ
        ? fanGripPoint(fanC, fanQ, side, gripBackFor(prep, side))
        : group.localToWorld(new Vector3(side === 'Left' ? 0.18 : -0.18, seatTop + 0.12, 0.25));
      const S = arm.getWorldPosition(new Vector3());
      const E0 = fore.getWorldPosition(new Vector3());
      const H0 = hand.getWorldPosition(new Vector3());
      const L1 = E0.distanceTo(S), L2 = H0.distanceTo(E0);
      const delta = targetPos.clone().sub(S);
      const dist = Math.max(0.05, Math.min(delta.length(), (L1 + L2) * 0.97));
      const axis = delta.normalize();
      const a = (L1 * L1 + dist * dist - L2 * L2) / (2 * dist);
      const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      let pole = E0.clone().sub(S.clone().addScaledVector(axis, E0.clone().sub(S).dot(axis)));
      if (pole.lengthSq() < 1e-6) pole = new Vector3(0, -1, 0); else pole.normalize();
      const E = S.clone().addScaledVector(axis, a).addScaledVector(pole, h);
      const T = S.clone().addScaledVector(axis, dist);
      const aimFull = (bone: Object3D, child: Object3D, tgt: Vector3) => {
        const pb = bone.getWorldPosition(new Vector3());
        const pc = child.getWorldPosition(new Vector3());
        const cur = pc.sub(pb).normalize();
        const des2 = tgt.clone().sub(pb).normalize();
        const R = new Quaternion().setFromUnitVectors(cur, des2);
        const qb = bone.getWorldQuaternion(new Quaternion());
        const qp = bone.parent!.getWorldQuaternion(new Quaternion());
        bone.quaternion.copy(qp.invert().multiply(R).multiply(qb));
      };
      aimFull(arm, fore, E);
      root.updateMatrixWorld(true);
      aimFull(fore, hand, T);
      /* Hand orientation (owner 2026-10-30: the hands "look a lil
         crazy"): the aims above place the WRIST, but the hand kept
         its bind orientation — at the side seats one hand landed
         flat and open on the rail, the other curled into a claw in
         the air beside the fan. With cards held, rotate the hand
         bone so the hand's measured anatomical frame (prepareFigure)
         lands on the fan's frame: fingers run up the fan's face,
         palm pressed to it — the finger curl then wraps the fan's
         lower edge instead of empty air. The graft chains hang off
         the hand bone, so the curled fingers ride the rotation
         rigidly; their local drives are untouched. */
      const frame = prep.handFrames[side];
      if (hasCards && fanQ && frame) {
        root.updateMatrixWorld(true);
        const hw = hand.getWorldQuaternion(new Quaternion());
        const cur = new Matrix4().makeBasis(
          frame.x.clone().applyQuaternion(hw),
          frame.y.clone().applyQuaternion(hw),
          frame.z.clone().applyQuaternion(hw),
        );
        const yt = new Vector3(0, 0, -1).applyQuaternion(fanQ);
        const zt = new Vector3(0, 1, 0).applyQuaternion(fanQ);
        const xt = new Vector3().crossVectors(yt, zt).normalize();
        /* Round 2: pitch the target frame about the fan's right
           (knuckle) axis — the fingers angle TOWARD the fan's
           bottom edge and the palm cradles under it, the way a
           hand actually takes a fan from below. Round 1's frame
           sent the fingers straight up the fan's face, where the
           grip curl hooked them through the cards. */
        yt.applyQuaternion(new Quaternion().setFromAxisAngle(xt, HAND_PITCH + (prep.curlF[side] - 1) * 0.31));
        const zto = new Vector3().crossVectors(xt, yt).normalize();
        const tgt = new Matrix4().makeBasis(xt, yt, zto);
        const qR = new Quaternion().setFromRotationMatrix(tgt.multiply(cur.transpose()));
        const parentQ = hand.parent!.getWorldQuaternion(new Quaternion());
        hand.quaternion.copy(parentQ.invert().multiply(qR.multiply(hw)));
        root.updateMatrixWorld(true);
      }
    };
    solveArm('Left');
    solveArm('Right');
    /* Grafted fingers: the curl follows the grip — full while the
       seat is the one to act, a shade softer while its fan rests,
       loose on the lap; a breath of per-hand phase sway keeps it
       from looking machined. Rigs without grafts skip entirely. */
    if (fingers.Left.length || fingers.Right.length) {
      const factor = !hasCards ? 0.45 : active ? 1.0 : 0.8;
      const applyHand = (list: FingerJoint[], phase: number, curlF: number) => {
        const f = animate ? Math.min(1.05, Math.max(0, factor * (1 + 0.03 * Math.sin(t * 1.3 + phase)))) : factor;
        for (const j of list) j.bone.quaternion.setFromAxisAngle(j.axis, j.angle * f * (hasCards ? j.gripScale * curlF : 1)).multiply(j.rest);
      };
      applyHand(fingers.Left, 0.7, prep.curlF.Left);
      applyHand(fingers.Right, 2.1, prep.curlF.Right);
    }
  });

  const spot = spots[SPOT_INDEX[seatPos]]!;
  return (
    <group ref={groupRef} position={[spot.x, 0, spot.z]} rotation={[0, spot.ry, 0]}>
      <primitive object={prep.root} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Failure fallback: a figure that fails to load renders nothing —     */
/* the seat keeps today's portrait plate + fan — and names itself on   */
/* the probe (the Corner sedan's discipline).                          */
/* ------------------------------------------------------------------ */

/** Load-retry policy for FigureBoundary: delays before each remount
 *  attempt. A figure GLB is ~3 MB on a phone network; one transient
 *  fetch/decode failure must not empty the seat for the session. */
const FIGURE_RETRY_DELAYS_MS: readonly number[] = [1200, 3500, 8000];

class FigureBoundary extends Component<{ id: string; url: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  private attempts = 0;
  private retryTimer: number | null = null;
  override componentDidCatch() {
    const w = window as unknown as { __bwmPersonaFigures?: { mounted: string[]; failed: string[] } };
    w.__bwmPersonaFigures ??= { mounted: [], failed: [] };
    if (!w.__bwmPersonaFigures.failed.includes(this.props.id)) w.__bwmPersonaFigures.failed.push(this.props.id);
    /* Retry with recovery (owner 2026-10-30: "sometimes the chair is
       empty when others aren't"): this boundary used to latch failed
       forever, and the loader cache kept the rejection, so a single
       transient GLB failure emptied the seat for the whole session.
       Now: clear the cached loader entry (the residency eviction
       does the same) and remount the loader child on a backoff, a
       few times; only a failure that outlives every retry stays
       degraded to the portrait plate. */
    if (this.attempts < FIGURE_RETRY_DELAYS_MS.length) {
      const delay = FIGURE_RETRY_DELAYS_MS[this.attempts]!;
      this.attempts++;
      this.retryTimer = window.setTimeout(() => {
        this.retryTimer = null;
        useLoader.clear(GLTFLoader, this.props.url);
        this.setState({ failed: false });
      }, delay);
    }
  }
  override componentWillUnmount() {
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
  }
  override render() { return this.state.failed ? null : this.props.children; }
}

/* ------------------------------------------------------------------ */
/* The persona layer: one Figure per occupied bot seat.                */
/* ------------------------------------------------------------------ */

export interface PersonaFiguresProps {
  /** per-seat persona figure keys (null = no figure at that seat) */
  seats: readonly (string | null)[];
  positions: readonly SeatPos[];
  n: number;
  handCounts: readonly number[];
  activeSeat: number | null;
  view: 'standing' | 'sitting';
  /** false under reduced effects: figures seat at rest, static (the
   *  King figures' crowdAnimate contract). */
  animate: boolean;
  /** the table's venue id — selects the seat geometry. */
  venue: string;
}

export default function PersonaFigures({ seats, positions, n, handCounts, activeSeat, view, animate, venue }: PersonaFiguresProps) {
  const geo = seatGeometryFor(venue);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const aspect = size.width >= 32 && size.height >= 32 ? size.width / size.height : 390 / 844;
  useEffect(() => {
    const w = window as unknown as { __bwmPersonaFigures?: { mounted: string[]; failed: string[] } };
    w.__bwmPersonaFigures ??= { mounted: [], failed: [] };
  }, []);
  /* The canvas is frameloop="demand": breath/sway/gaze need a pulse
     while the figures live (the KingRail ticker's pattern). */
  useEffect(() => {
    if (!animate) return;
    const id = window.setInterval(() => { if (!document.hidden) invalidate(); }, 50);
    return () => window.clearInterval(id);
  }, [animate, invalidate]);
  const anchors = useMemo(() => {
    const heads: Record<string, Vector3> = {};
    seats.forEach((id, seat) => {
      if (!id) return;
      const spot = geo.spots[SPOT_INDEX[positions[seat]!]]!;
      heads[id] = new Vector3(spot.x, 0.42, spot.z);
    });
    const humanSpot = geo.spots[SPOT_INDEX[positions[0]!]]!;
    return {
      trick: new Vector3(0, 0.02, 0),
      human: new Vector3(humanSpot.x, 0.42, humanSpot.z),
      heads,
    };
  }, [seats, positions, geo]);
  return (
    <>
      {seats.map((id, seat) => {
        if (!id) return null;
        const spot = geo.spots[SPOT_INDEX[positions[seat]!]]!;
        const d = seatDir(positions[seat]!, n);
        return (
          <pointLight
            key={`fill-${seat}`}
            position={[spot.x - d.x * FIGURE_FILL_DIST, FIGURE_FILL_Y, spot.z - d.z * FIGURE_FILL_DIST]}
            color="#ffd9ae"
            intensity={FIGURE_FILL_INTENSITY}
            distance={FIGURE_FILL_RANGE}
            decay={2}
          />
        );
      })}
      {seats.map((id, seat) => {
        if (!id) return null;
        const reg = FIGURE_REGISTERS[id];
        const url = FIGURE_URLS[id];
        if (!reg || !url) return null;
        return (
          <FigureBoundary key={seat} id={id} url={url}>
            <Suspense fallback={null}>
              <Figure
                id={id}
                url={url}
                reg={reg}
                seatPos={positions[seat]!}
                n={n}
                count={handCounts[seat] ?? 0}
                active={activeSeat === seat}
                aspect={aspect}
                view={view}
                animate={animate}
                anchors={anchors}
                spots={geo.spots}
                seatTop={geo.seatTop}
                floorY={geo.floorY}
              />
            </Suspense>
          </FigureBoundary>
        );
      })}
    </>
  );
}
