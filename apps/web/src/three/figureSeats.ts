/**
 * Per-stop seat geometry for the seated story figures
 * (three/PorchFigures.tsx) — character rollout, owner 2026-10-29
 * ("add the characters to all the tables").
 *
 * The pilot solved against the Porch room's own folding chairs. Every
 * story room dresses the SAME table with the same owner-scale kit
 * folding chair (H 0.90), but the rooms do NOT share chair anchors:
 *
 *  - PorchDeckRoom and RecCenterGymRoom place the kit chair at the
 *    shared CHAIR_SPOTS (classicStudioLayout): top (0, −2.45),
 *    bottom (0, 2.8), left (−2.3, 0), right (2.3, 0).
 *  - BarbershopMirrorRoom and CookoutYardRoom carry LOCAL chair
 *    spots, closer in: top (0, −1.98), bottom (0, 1.98),
 *    left (−2.14, 0), right (2.14, 0).
 *
 * Seat tops differ by the same 1.4 cm the chair kits differ by: the
 * Porch builds its seat box centred at FLOOR_Y + 0.49 − 0.014, so its
 * top lands at FLOOR_Y + 0.49 = −0.41 (PORCH_SEAT_TOP in
 * PorchFigures.tsx); the kit rooms centre the box at FLOOR_Y + 0.49
 * with height 0.028, so their top lands at FLOOR_Y + 0.504 = −0.396.
 * Batch 2's rooms add two more tops: the Corner / Rooftop folding
 * chair (box centred at local 0.478 → −0.408) and the High-Rise
 * penthouse armchair (cushion top documented at 0.45 → −0.45).
 *
 * Values here are pinned against the room sources by
 * test/story-figures.test.ts — if a room's chairs move, this table
 * must move with them or the figures float off the seat.
 */
import { CHAIR_SPOTS } from './classicStudioLayout';
import type { SeatPos } from './layout';

export interface FigureSeatSpot { x: number; z: number; ry: number }

export interface FigureSeatConfig {
  /** World Y of the chair's seat top (the solve's hip target line). */
  seatTop: number;
  /** Chair anchor per game seat position. */
  spots: Record<SeatPos, FigureSeatSpot>;
}

/** The shared studio anchors (Porch + Rec Center chairs). */
const CLASSIC_SPOTS: Record<SeatPos, FigureSeatSpot> = {
  top: CHAIR_SPOTS[0]!,
  bottom: CHAIR_SPOTS[1]!,
  left: CHAIR_SPOTS[2]!,
  right: CHAIR_SPOTS[3]!,
};

/** The closer local anchors (Barbershop + Cookout chairs). */
const KIT_SPOTS: Record<SeatPos, FigureSeatSpot> = {
  top: { x: 0, z: -1.98, ry: 0 },
  bottom: { x: 0, z: 1.98, ry: Math.PI },
  left: { x: -2.14, z: 0, ry: Math.PI / 2 },
  right: { x: 2.14, z: 0, ry: -Math.PI / 2 },
};

/** Kit-chair seat top: FLOOR_Y (−0.9) + 0.49 centre + 0.014 half-height. */
export const KIT_SEAT_TOP = -0.396;

/** The Corner / Rooftop folding chairs (CornerStreetRoom and
 *  RooftopDuskRoom chairPanelGeo): seat box 0.43 × 0.028 × 0.40
 *  centred at local (0, 0.478, 0) in a group at FLOOR_Y — top at
 *  FLOOR_Y + 0.492. */
export const FOLDING_SEAT_TOP = -0.408;

/** The High-Rise penthouse's designer armchairs (HighRisePenthouse
 *  Room): seat cushion box(0.56, 0.10, 0.52, 0, 0.40, 0.0), whose top
 *  the room documents at 0.45 local — FLOOR_Y + 0.45. */
export const PENTHOUSE_SEAT_TOP = -0.45;

/** The Legends' leather dining chairs (LegendsTableRoom): seat
 *  cushion box(0.48, 0.055, 0.48) centred at local 0.475 in a group
 *  at FLOOR_Y — top at FLOOR_Y + 0.5025. */
export const LEGENDS_SEAT_TOP = -0.3975;

export const FIGURE_SEAT_CONFIGS: Readonly<Record<string, FigureSeatConfig>> = {
  // The pilot's own row: classic anchors, the Porch seat top.
  porch: { seatTop: -0.41, spots: CLASSIC_SPOTS },
  barbershop: { seatTop: KIT_SEAT_TOP, spots: KIT_SPOTS },
  'rec-center': { seatTop: KIT_SEAT_TOP, spots: CLASSIC_SPOTS },
  cookout: { seatTop: KIT_SEAT_TOP, spots: KIT_SPOTS },
  // Batch 2: Corner + Rooftop place the classic anchors with their
  // own folding chair; the Church Basement re-declares the kit
  // anchors with the kit chair; the High-Rise's armchairs sit lower.
  corner: { seatTop: FOLDING_SEAT_TOP, spots: CLASSIC_SPOTS },
  'church-basement': { seatTop: KIT_SEAT_TOP, spots: KIT_SPOTS },
  rooftop: { seatTop: FOLDING_SEAT_TOP, spots: CLASSIC_SPOTS },
  'high-rise': { seatTop: PENTHOUSE_SEAT_TOP, spots: CLASSIC_SPOTS },
  // Batch 3: the Pj's street room re-declares the classic anchors
  // with the folding chair (seat box top at local 0.492 — the room's
  // own note; same folding seat as the Corner/Rooftop); the Legends'
  // leather dining chairs carry their own cushion top.
  'the-pjs': { seatTop: FOLDING_SEAT_TOP, spots: CLASSIC_SPOTS },
  legends: { seatTop: LEGENDS_SEAT_TOP, spots: CLASSIC_SPOTS },
  // No 'king' row: the King's seated figures are the shipped
  // KingRail portrait planes (a separate, finale-integrated system);
  // this layer deliberately does not mount there.
};
