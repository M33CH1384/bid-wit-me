/**
 * Who is acting, for the seat badges and the playable cards together.
 * A deal, a held trick, or a show hides every badge so two seats cannot both
 * look ready. A move already in flight does not: blanking YOUR TURN and TO PLAY
 * made a slow ack look like the table had forgotten whose turn it was.
 */

export interface TurnInputs {
  turn: number | null;
  phase: string;
  /** A finished trick is still on the table. */
  pause: boolean;
  /** Shuffle / deal animation still owns the table. */
  dealing: boolean;
  /** This client's move has not been acknowledged yet. */
  locked: boolean;
  /** A show (Run it!) is covering the table. */
  covered: boolean;
}

/**
 * The server (or the offline engine) says whose turn it is, in that seat order.
 * The table draws seat 0 at the bottom, so a seated viewer shifts the server seat
 * into that frame once. A spectator's view is already anchored; pass viewerSeat null.
 */
export function localSeatOfServerTurn(serverTurn: number | null, viewerSeat: number | null, n: number): number | null {
  if (serverTurn === null || n <= 0) return null;
  const seat = viewerSeat === null ? serverTurn : serverTurn - viewerSeat;
  return ((seat % n) + n) % n;
}

/** The seat to mark, or null when nobody should look like they are to act. */
export function actingSeat(t: TurnInputs): number | null {
  // `locked` stays on the input so callers can pass it, but it must not clear the badge.
  void t.locked;
  if (t.turn === null || t.pause || t.dealing || t.covered) return null;
  if (t.phase !== 'bidding' && t.phase !== 'playing' && t.phase !== 'exchange') return null;
  return t.turn;
}

export type SeatMark = 'your-turn' | 'your-bid' | 'to-play' | 'bidding';

/**
 * The single badge for one seat. The viewer's own YOUR TURN mark is withheld
 * unless they have a legal card, so the badge and the lit cards cannot disagree.
 */
export function seatMark(
  actor: number | null,
  seat: number,
  phase: string,
  self: boolean,
  spectating: boolean,
  legalCount: number,
): SeatMark | null {
  if (actor !== seat) return null;
  if (self && !spectating) {
    if (phase === 'playing') return legalCount > 0 ? 'your-turn' : null;
    if (phase === 'bidding') return 'your-bid';
    return null;
  }
  if (phase === 'bidding') return 'bidding';
  if (phase === 'playing' || phase === 'exchange') return 'to-play';
  return null;
}

export interface TurnBadge {
  seat: number;
  mark: SeatMark;
  text: string;
  testId: string;
}

/**
 * YOUR TURN and TO PLAY are this one result. `turn` is the server's current-turn
 * seat already expressed in the table's seat order. At most one badge comes back.
 */
export function turnView(t: TurnInputs & {
  viewerSeat: number;
  spectating: boolean;
  legalCount: number;
  selected: boolean;
}): { actor: number | null; badge: TurnBadge | null } {
  const actor = actingSeat(t);
  if (actor === null) return { actor, badge: null };
  const mark = seatMark(actor, actor, t.phase, actor === t.viewerSeat, t.spectating, t.legalCount);
  if (!mark) return { actor, badge: null };
  const text = mark === 'your-turn' ? (t.selected ? 'TAP AGAIN TO PLAY' : 'YOUR TURN')
    : mark === 'your-bid' ? 'YOUR BID'
    : mark === 'bidding' ? 'BIDDING'
    : 'TO PLAY';
  const testId = mark === 'your-turn' ? 'your-turn'
    : mark === 'your-bid' ? 'your-bid'
    : mark === 'bidding' ? `bidding-${actor}`
    : `to-play-${actor}`;
  return { actor, badge: { seat: actor, mark, text, testId } };
}
