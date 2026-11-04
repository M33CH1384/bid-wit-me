import { booksStillNeeded, sideOf, tricksStillRemaining, type GameState } from '@spades/rules';

/**
 * THIN MARGIN (owner, 2026-11-04): "they should also get something in their
 * plate if they bid a bunch of books and it's getting close to impossible to
 * make them." The plate's warning light for a live hand.
 *
 * The arithmetic is the engine's own, composed from the same two readings
 * the shotgun/wire detectors use: booksStillNeeded (the side's combined
 * numeric contract minus the books that count toward it — scoreHand's math,
 * nil seats contributing nothing unless the rules say their books count)
 * and tricksStillRemaining (the hand's real trick count — short cutthroat
 * tables included — with the trick in progress still on the clock).
 *
 * slack = remaining − needed is exactly "mistakes left": a book the side
 * wins moves both numbers, a book it loses moves only the clock.
 *
 * Tiers: slack ≥ 2 → dark. slack 1 → THIN ICE (one mistake left). slack 0 →
 * MUST WIN OUT (every remaining trick or the set). slack < 0 → SET (the
 * contract is out of reach; the light holds, steady, until the hand ends —
 * a warning that clears itself when the worst lands would read as "all
 * clear", and a "must win out" label would be a lie).
 *
 * The light arms only once the hand is underway — live play (phase
 * 'playing') with at least one trick resolved. Before that, slack is just
 * the bid the side chose freely: a 12 bid's opening slack is the bidder's
 * own stated intent, and a warning worn from the first second of every
 * big-bid hand would be noise. A contract already made (needed ≤ 0) is
 * never a warning, however few tricks remain.
 *
 * Nil: a nil or blind-nil bid never creates or feeds a contract, so a
 * pure-nil side (contract 0) reads null here and stays dark; a mixed side's
 * marker belongs to its numeric contract alone. A nil seat's own danger
 * (one book busts it) is a different, already-covered event.
 */
export type MarginTier = 0 | 1 | 2 | 3;

export const MARGIN_LABEL: Record<Exclude<MarginTier, 0>, string> = {
  1: 'THIN ICE',
  2: 'MUST WIN OUT',
  3: 'SET',
};

type MarginState = Pick<GameState, 'rules' | 'bids' | 'tricksWon' | 'tricks' | 'trickCount' | 'phase'>;

/** Mistakes left for this side, or null when the light has nothing to read:
 *  not live play yet, the hand hasn't started moving, bidding is unfinished,
 *  there is no numeric contract, or the contract is already made. */
export function marginSlack(st: MarginState, side: number): number | null {
  if (st.phase !== 'playing') return null;
  if (st.tricks.length < 1) return null;
  const needed = booksStillNeeded(st.rules, st.bids, st.tricksWon, side);
  if (needed === null || needed <= 0) return null;
  return tricksStillRemaining(st) - needed;
}

export function marginTier(st: MarginState, side: number): MarginTier {
  const slack = marginSlack(st, side);
  if (slack === null || slack >= 2) return 0;
  if (slack === 1) return 1;
  if (slack === 0) return 2;
  return 3;
}

/** The tier on one seat's plate: partnership sides share the light (both
 *  partners wear it), cutthroat seats stand alone — sideOf is the whole
 *  mapping, the same one the ON NOTICE chip reads. */
export function marginTierForSeat(st: MarginState, seat: number): MarginTier {
  return marginTier(st, sideOf(seat, st.rules));
}
