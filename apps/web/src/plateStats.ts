import { type Bid, type GameState, isFreshDeal } from '@spades/rules';

/** Bid and books as dealt for one hand, used to tell a new hand from a copied tally. */
export interface HandTally {
  handNo: number;
  bids: readonly (Bid | null)[];
  tricksWon: readonly number[];
}

export interface PlateTally {
  bids: (Bid | null)[];
  books: number[];
}

type HandState = Pick<GameState, 'handNo' | 'phase' | 'bids' | 'tricksWon' | 'tricks' | 'trick'>;

function zeros(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

function sameBids(a: readonly (Bid | null)[], b: readonly (Bid | null)[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function sameBooks(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * Bid and books drawn on the seat plates.
 * A new hand opens with no bid and zero books. The hand that just ended keeps its numbers
 * on the score pad; if that tally is still sitting on the table state, the plates drop it.
 */
export function plateTally(st: HandState, previous: HandTally | null, dealing: boolean): PlateTally {
  const n = st.bids.length;
  const booksHand = n > 0 && st.bids.every((b) => b === 'books');
  const carried = !!previous
    && previous.handNo !== st.handNo
    && sameBids(st.bids, previous.bids)
    && sameBooks(st.tricksWon, previous.tricksWon);
  const opening = dealing || isFreshDeal(st);
  if (carried || opening) {
    if (booksHand) return { bids: [...st.bids], books: zeros(n) };
    return { bids: Array.from({ length: n }, () => null), books: zeros(n) };
  }
  return { bids: [...st.bids], books: [...st.tricksWon] };
}

/**
 * Keep the previous hand's tally while the new hand still shows those same numbers,
 * so the plates stay reset until this hand records a bid or a book of its own.
 */
export function rememberHandTally(prev: HandTally | null, st: HandTally): HandTally {
  if (prev && prev.handNo !== st.handNo && sameBids(st.bids, prev.bids) && sameBooks(st.tricksWon, prev.tricksWon)) return prev;
  return { handNo: st.handNo, bids: st.bids, tricksWon: st.tricksWon };
}
