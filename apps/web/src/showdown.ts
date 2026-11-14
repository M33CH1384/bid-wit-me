import { sideOf, tricksStillRemaining, type GameState } from '@spades/rules';
import { marginSlack } from './thinMargin';

/**
 * LAST-CARD SHOWDOWN (owner, 2026-11-12: "We need a special animation for this
 * scenario where it gets down to the last card and both team must win out").
 *
 * The hand is on its final trick and every side that still has a contract to
 * make needs exactly this book — whoever takes it makes their bid, everyone
 * else is set. The reading is thinMargin's own: slack 0 (MUST WIN OUT) with
 * one trick left on the clock means "needs one, one remains".
 *
 * At least two sides must be in that spot. One side sweating its last book
 * while the other has already made theirs is a thin margin, not a showdown.
 */
type ShowdownState = Pick<GameState, 'rules' | 'bids' | 'tricksWon' | 'tricks' | 'trickCount' | 'phase'>;

/** The sides riding on the last book, or [] when this is not a showdown. */
export function showdownSides(st: ShowdownState): number[] {
  if (st.phase !== 'playing') return [];
  if (tricksStillRemaining(st) !== 1) return [];
  const sides = [...new Set(Array.from({ length: st.rules.playerCount }, (_, seat) => sideOf(seat, st.rules)))];
  const riding = sides.filter((side) => marginSlack(st, side) === 0);
  return riding.length >= 2 ? riding : [];
}

/** The hand is on its final trick (every player down to the last card). */
export function isLastTrick(st: Pick<GameState, 'rules' | 'tricks' | 'trickCount'>): boolean {
  return tricksStillRemaining(st) === 1;
}

export const isShowdown = (st: ShowdownState): boolean => showdownSides(st).length >= 2;

/** Bots take their time over the last card: a held beat instead of the usual
 *  brisk pace, and no out-of-turn "last card drop" — the showdown plays in
 *  order, one card at a time. */
export const SHOWDOWN_BOT_MS = 2300;

/** The last cards fly slower and higher, so each one hangs before it lands. */
export const SHOWDOWN_FLIGHT = { duration: 0.95, arc: 0.6 } as const;

/** Heartbeat period for the number of cards already on the table: it quickens
 *  with every card that lands. */
export function heartbeatMs(cardsDown: number): number {
  return Math.max(430, 1000 - Math.max(0, cardsDown) * 170);
}

/** The finale, from the last card leaving a hand: its flight in silence, the
 *  hit as it lands, then the call. */
export const SHOWDOWN_REVEAL_MS = 4400;
