/**
 * Seat-placed player video — the pure gate that decides which local
 * seats carry a live feed into the 3D scene (owner directive
 * 2026-10-30). Kept free of React/three so the mapping is testable
 * with fake streams.
 *
 * A seat carries a feed only when ALL of these hold:
 * - this client is a seated player, not a spectator (spectators get
 *   no new video surface — the watch/broadcast apps build no mesh at
 *   all, and in-app spectators keep today's plate bubbles);
 * - the seat is not the viewer's own (local seat 0 — the scene layer
 *   never seats the first-person player; see seatVideoLayout);
 * - the seat is held by a connected human (bots never have video);
 * - that human's camera is on (room-published media state);
 * - a remote stream for them exists in the mesh state;
 * - the viewer hasn't hidden their video.
 */
import type { SeatInfo } from '@spades/protocol';

export interface SeatVideoFeedGates {
  spectator: boolean;
  seats: readonly (SeatInfo | undefined)[];
  /** mesh state: playerId → remote stream */
  remote: Readonly<Record<string, MediaStream>>;
  /** playerIds whose video the viewer hid */
  hidden: readonly string[];
  /** local seat index → server seat index */
  realOfLocal: (local: number) => number;
  n: number;
}

/** Per LOCAL seat: the stream that belongs in that seat's chair, or null. */
export function seatVideoFeedsFor(g: SeatVideoFeedGates): (MediaStream | null)[] {
  const out: (MediaStream | null)[] = Array.from({ length: g.n }, () => null);
  if (g.spectator) return out;
  for (let local = 1; local < g.n; local++) {
    const seat = g.seats[g.realOfLocal(local)];
    if (!seat || seat.kind !== 'human' || !seat.connected) continue;
    if (!seat.media.cam) continue;
    if (g.hidden.includes(seat.playerId)) continue;
    const stream = g.remote[seat.playerId];
    if (stream) out[local] = stream;
  }
  return out;
}
