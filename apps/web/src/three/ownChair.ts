import { createContext, useContext } from 'react';

/**
 * The own-chair rule (owner, 2026-11-02: "I shouldn't see my chair in
 * the frame"). The table camera always anchors at the local seat 0 —
 * the south seat — and in local play that seat is first-person by
 * construction: it never carries a seated figure (story solo pins
 * seat 0 null; persona figures key off bot seats and seat 0 is the
 * human). So the chair every room builds at the south spot renders
 * bare, ~0.2–0.8 m in front of the sitting camera, squarely in the
 * lower frame.
 *
 * The rule: in a LOCAL seated scene the south chair is not built at
 * all — not shrunk, not moved, not faded. On spectator / watch /
 * broadcast surfaces the same anchor seat belongs to a real
 * participant, and a bot seated there carries a figure that needs
 * its chair — so every chair stays.
 *
 * Scene provides this context from Table's spectator flag; rooms
 * consume it at their chair-building sites only. The default (false:
 * keep every chair) preserves any surface that renders a room
 * outside a seated table. Dressing chairs (barber chairs, rocking
 * chairs, camp chairs, chair stacks, the Legends rail chairs) are
 * NOT seat chairs and never pass through here.
 */
export const OwnChairHiddenContext = createContext(false);

/** True when the south (camera) seat's chair must not be built. */
export function useOwnChairHidden(): boolean {
  return useContext(OwnChairHiddenContext);
}

/**
 * The south seat spot in the shared { x, z } spot shape
 * (classicStudioLayout's CHAIR_SPOTS and its importers): the seat on
 * the centreline on the camera side of the table. Identified
 * positionally, never by array index — the spot arrays disagree on
 * ordering (classic is [N, S, W, E]; the bespoke rooms' local arrays
 * are [S, E, N, W]).
 */
export function isSouthSeatSpot(s: { x: number; z: number }): boolean {
  return s.x === 0 && s.z > 0;
}

/** The south seat spot in the bespoke rooms' { pos: [x, y, z] } shape. */
export function isSouthSeatPos(pos: readonly [number, number, number]): boolean {
  return pos[0] === 0 && pos[2]! > 0;
}
