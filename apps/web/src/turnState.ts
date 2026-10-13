/**
 * Who is acting, for the seat badges and the playable cards together.
 * A second check (deal still running, trick on hold, move in flight) used to
 * light YOUR TURN on this seat while another seat said TO PLAY and the hand sat grey.
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

/** The seat to mark, or null when nobody should look like they are to act. */
export function actingSeat(t: TurnInputs): number | null {
  if (t.turn === null || t.pause || t.dealing || t.locked || t.covered) return null;
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
