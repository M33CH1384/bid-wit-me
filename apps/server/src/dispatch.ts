import type { Room } from './room';

/**
 * Hello has to bind the socket before the account-ticket lookup.
 * `verifyTicket` awaits D1, and that await lets the next WebSocket message run.
 * The client sends hello and then the in-flight play on the new socket. If hello
 * is still waiting on the ticket, that play is `NOT_JOINED` and the old socket's
 * close runs the turn as a disconnect.
 */
export async function dispatchTableMessage(
  room: Room,
  cid: string,
  message: string,
  verifyTicket: (ticket: string) => Promise<{ uid: string; venueAccess?: boolean } | null>,
): Promise<void> {
  let hello = false;
  let ticket: string | undefined;
  if (message.length < 4000) {
    try {
      const m = JSON.parse(message) as { t?: string; ticket?: unknown };
      if (m.t === 'hello') {
        hello = true;
        if (typeof m.ticket === 'string') ticket = m.ticket;
        room.message(cid, message, null);
      }
    } catch { /* the room rejects a body it cannot parse */ }
  }
  let uid: string | null = null;
  let venueAccess: boolean | undefined;
  if (ticket) {
    try { const t = await verifyTicket(ticket); uid = t?.uid ?? null; venueAccess = t?.venueAccess; } catch { uid = null; }
  }
  if (hello) {
    if (uid) {
      room.linkUser(cid, uid);
      // Locked-venue entitlement (The Pj's) rides the same verified ticket: stamp it on the
      // member so the room's venue gate and Random roll can decide synchronously.
      if (venueAccess !== undefined) room.setVenueAccess(cid, venueAccess);
    }
    return;
  }
  room.message(cid, message, uid);
}
