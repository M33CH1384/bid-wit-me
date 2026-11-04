import { createContext, useContext } from 'react';

/**
 * The own-chair rule (owner, 2026-11-02: "I shouldn't see my chair in
 * the frame"), per-seat since the room-vantage fix (2026-11-03).
 *
 * The table camera anchors at the local seat in every mode, and in a
 * seated scene that seat is first-person: it never carries a seated
 * figure (story solo pins seat 0 null; persona figures key off bot
 * seats and the human's seat is the human). So the chair every room
 * builds at the viewer's own seat renders bare, in front of the
 * sitting camera, squarely in the lower frame.
 *
 * The rule: in a LOCAL seated scene the viewer's own chair is not
 * built at all — not shrunk, not moved, not faded. On spectator /
 * watch / broadcast surfaces the anchor seat belongs to a real
 * participant, and a bot seated there carries a figure that needs
 * its chair — so every chair stays.
 *
 * Which chair is "the viewer's own" follows the viewer's seat. In
 * local play the viewer always sits at the canonical south seat, so
 * for years the rule was simply "not the south chair". Online, the
 * room layer rotates to the viewer's server seat (Scene's roomYaw,
 * from turnState.roomYawForViewerSeat), so the own chair is the one
 * at the viewer's CANONICAL seat direction — the direction this
 * context carries. Scene provides the context from Table's spectator
 * flag + the room yaw; rooms consume it at their chair-building
 * sites only. The default (hidden: false — keep every chair, dir:
 * south) preserves any surface that renders a room outside a seated
 * table. Dressing chairs (barber chairs, rocking chairs, camp
 * chairs, chair stacks, the Legends rail chairs) are NOT seat chairs
 * and never pass through here.
 */
export interface OwnSeatView {
  /** True in a local seated scene: the viewer's own chair is not built. */
  hidden: boolean;
  /** The viewer's own seat direction in the room's canonical frame,
   *  as a unit { x, z } (table centre -> seat). South (0, 1) whenever
   *  the viewer sits at canonical seat 0 — all local play. */
  dir: { x: number; z: number };
}

export const OwnChairHiddenContext = createContext<OwnSeatView>({ hidden: false, dir: { x: 0, z: 1 } });

/** True when the viewer's own seat's chair must not be built. */
export function useOwnChairHidden(): boolean {
  return useContext(OwnChairHiddenContext).hidden;
}

/** The viewer's own seat direction (canonical room frame) — the chair
 *  on this side is the one useOwnChairHidden() suppresses. */
export function useOwnSeatDir(): { x: number; z: number } {
  return useContext(OwnChairHiddenContext).dir;
}

/**
 * The viewer's canonical seat direction for a room yaw: the direction
 * D with R_y(yaw) * D = +z (the camera side) is D = (-sin yaw, cos yaw).
 * Exact inverse of turnState.roomYawForViewerSeat over the seat table.
 */
export function ownSeatDirForYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw) + 0, z: Math.cos(yaw) };
}

const SOUTH: { x: number; z: number } = { x: 0, z: 1 };

/**
 * Is this spot the viewer's own seat spot? Seat-chair spots in every
 * room are axis-aligned (the classic CHAIR_SPOTS and the bespoke
 * rooms' local arrays: one spot per compass side), so the test is
 * axis-exact: the spot must lie ON the viewer's dominant axis with
 * the matching sign. For the compass seats that is their own side;
 * for a 3-player diagonal seat (direction ~60° off north) the
 * dominant axis is its side axis, so the nearest side chair — the one
 * that lands in front of that viewer's camera once the room rotates —
 * is the own chair. Off-axis spots (dressing/rail chairs) are never
 * the own seat. With dir = south this is exactly the historical
 * isSouthSeatSpot test.
 */
export function isOwnSeatSpot(s: { x: number; z: number }, dir: { x: number; z: number } = SOUTH): boolean {
  if (Math.abs(dir.x) > Math.abs(dir.z)) {
    return s.z === 0 && s.x !== 0 && Math.sign(s.x) === Math.sign(dir.x);
  }
  return s.x === 0 && s.z !== 0 && Math.sign(s.z) === Math.sign(dir.z);
}

/** The own-seat spot test in the bespoke rooms' { pos: [x, y, z] } shape. */
export function isOwnSeatPos(pos: readonly [number, number, number], dir: { x: number; z: number } = SOUTH): boolean {
  return isOwnSeatSpot({ x: pos[0], z: pos[2]! }, dir);
}

/**
 * The south seat spot in the shared { x, z } spot shape
 * (classicStudioLayout's CHAIR_SPOTS and its importers): the seat on
 * the centreline on the camera side of the table. Identified
 * positionally, never by array index — the spot arrays disagree on
 * ordering (classic is [N, S, W, E]; the bespoke rooms' local arrays
 * are [S, E, N, W]). The dir = south case of isOwnSeatSpot.
 */
export function isSouthSeatSpot(s: { x: number; z: number }): boolean {
  return isOwnSeatSpot(s, SOUTH);
}

/** The south seat spot in the bespoke rooms' { pos: [x, y, z] } shape. */
export function isSouthSeatPos(pos: readonly [number, number, number]): boolean {
  return isOwnSeatPos(pos, SOUTH);
}
