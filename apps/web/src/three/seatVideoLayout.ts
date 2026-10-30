/**
 * Seat-placed player video — pure placement math (owner directive
 * 2026-10-30: "when users turn their camera on the video feed should
 * be placed in the seat from which they are playing").
 *
 * A remote player's live feed renders on a plane anchored at their
 * chair, using the SAME seated-presence math as the King table's
 * seated figures (kingRailLayout.seatedFigureFor): the centre sits
 * beyond the felt edge on the seat's own direction, the quad rises
 * from behind the apron to a seated adult's crown. This module is
 * deliberately free of three.js scene / DOM concerns beyond the
 * shared layout helpers, so the feed↔seat mapping is unit-testable
 * without a camera or a canvas.
 */
import { edgePoint, seatDir, type SeatPos } from './layout';

export const SEAT_VIDEO = {
  /** how far beyond the felt edge the plane's centre sits (KingRail SEATED_OUT) */
  out: 0.4,
  /** the top seat sits further out — its info strip anchors over the
   *  seat, and the extra depth drops the fan's sight line at the plane */
  topOut: 1.15,
  /** plane width (KingRail seated portrait width default) */
  w: 0.58,
  /** plane height: from behind the apron (y −0.20) to the crown */
  h: 0.78,
  /** Crown height above the felt. The KingRail seated default is
   *  0.42, but a held fan's top edge reaches ~0.5 in front of the
   *  seat, and from the low sitting camera the sight line over the
   *  partner's OPEN fan cuts the plane right at the face's eye line
   *  for crowns up to ~0.52 (measured in captures, twice). 0.58 puts
   *  the eyes clear of the fan in every production camera while the
   *  plane's foot stays behind the apron — a face feed is judged by
   *  the face reading, not by body-proportion purity. */
  crown: 0.58,
  /** the yaw billboard never turns further than this from the seat's
   *  natural facing (toward the table centre), so the presence stays
   *  seated in its chair while the face stays readable */
  maxYawRad: 0.96, // ≈55°
} as const;

export interface SeatVideoSpot {
  x: number;
  z: number;
  /** world y of the plane's centre */
  cy: number;
  /** the seat's natural facing yaw (toward the table centre) */
  yaw: number;
  w: number;
  h: number;
}

/** Where the video plane for a seat at `pos` stands. ringScale is 1
 *  at production tables (KingRail's story ring scaling doesn't apply). */
export function seatVideoSpot(pos: SeatPos, n: number): SeatVideoSpot {
  const d = seatDir(pos, n);
  const edge = edgePoint(d);
  const out = pos === 'top' ? SEAT_VIDEO.topOut : SEAT_VIDEO.out;
  const x = edge.x + d.x * out;
  const z = edge.z + d.z * out;
  return {
    x,
    z,
    cy: SEATED_CY,
    yaw: Math.atan2(-x, -z),
    w: SEAT_VIDEO.w,
    h: SEAT_VIDEO.h,
  };
}

const SEATED_CY = SEAT_VIDEO.crown - SEAT_VIDEO.h / 2;

/** Shortest-arc clamp of a desired yaw to within ±maxRad of a base yaw. */
export function clampYawToFacing(facingYaw: number, desiredYaw: number, maxRad: number = SEAT_VIDEO.maxYawRad): number {
  let rel = desiredYaw - facingYaw;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  const clamped = Math.max(-maxRad, Math.min(maxRad, rel));
  return facingYaw + clamped;
}

/** The yaw a seat plane at (x, z) should take so its face turns toward
 *  a camera at (cx, cz), never more than maxYawRad from its facing. */
export function seatVideoYawAt(spot: SeatVideoSpot, cx: number, cz: number): number {
  const camYaw = Math.atan2(cx - spot.x, cz - spot.z);
  return clampYawToFacing(spot.yaw, camYaw);
}

export interface SeatVideoAssignment<T> {
  seat: number;
  pos: SeatPos;
  spot: SeatVideoSpot;
  feed: T;
}

/**
 * The feed↔seat assignment the scene layer renders: one entry per seat
 * that HAS a feed, in seat order. The human's own seat is never
 * assigned (first-person framing: the bottom-seat plane sits behind
 * the player's own fan, out of the sightline — the local feed stays in
 * the player's plate bubble; every other viewer sees it at the seat).
 */
export function assignSeatVideos<T>(
  feeds: readonly (T | null | undefined)[],
  positions: readonly SeatPos[],
  n: number,
  humanSeat: number,
): SeatVideoAssignment<T>[] {
  const out: SeatVideoAssignment<T>[] = [];
  feeds.forEach((feed, seat) => {
    if (feed == null || seat === humanSeat) return;
    const pos = positions[seat];
    if (!pos) return;
    out.push({ seat, pos, spot: seatVideoSpot(pos, n), feed });
  });
  return out;
}
