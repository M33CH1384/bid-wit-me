/**
 * ONE BUST, ONE CRACK — the causation stamp (crack tiers, 2026-11-06).
 *
 * When a Big Joker throw busts a nil or locks a set, the photoreal
 * quake cracks the screen for that event; the seat-plate crack must
 * not fire a second crack (with the same glassCrack recording) for the
 * same bust/elimination. The layer suppresses the plate crack only on
 * POSITIVE causation, stamped here: bigJokerOutSeats replays the hand
 * and names the seats whose failure the Big Joker caused — a nil
 * bidder whose first book was won with the Big Joker, or a seat whose
 * side's set was locked by the book a Big Joker won. finishHand stamps
 * it on the record (outByBigJoker) while the tricks still exist.
 * Fixtures are replay math only: trick plays are fabricated per trick
 * (winner takes it with the named card over low hearts).
 */
import { describe, expect, it } from 'vitest';
import {
  type Bid,
  type Card,
  type GameState,
  type Trick,
  bigJokerOutSeats,
  firstBookCard,
  makeRules,
} from '../src/index';

const joker = makeRules('joker');
const cutthroat = makeRules('cutthroat');

/** One fabricated trick: seat `winner` takes it with `winCard` over low hearts. */
const trick = (winner: number, winCard: Card): Trick => ({
  leader: 0,
  winner,
  plays: [0, 1, 2, 3].map((seat) => ({
    seat,
    card: seat === winner ? winCard : (['3H', '4H', '5H', '6H'][seat] as Card),
  })),
});
const hand = (
  rules: typeof joker,
  bids: (Bid | null)[],
  tricks: Trick[],
): Pick<GameState, 'rules' | 'bids' | 'tricks' | 'trickCount'> =>
  ({ rules, bids, tricks }) as Pick<GameState, 'rules' | 'bids' | 'tricks' | 'trickCount'>;

describe('firstBookCard', () => {
  it('returns the card of the seat’s FIRST book, not a later one', () => {
    const tricks = [trick(0, 'AH'), trick(1, '5S'), trick(1, 'BJ')];
    expect(firstBookCard(joker, tricks, 1)).toBe('5S');
  });
  it('is null while the seat has no book', () => {
    expect(firstBookCard(joker, [trick(0, 'AH')], 2)).toBeNull();
    expect(firstBookCard(joker, [], 0)).toBeNull();
  });
});

describe('bigJokerOutSeats — nil busts', () => {
  it('a nil bidder whose first book is the Big Joker was busted BY it', () => {
    const st = hand(cutthroat, [3, 'nil', 3, 3], [trick(0, 'AH'), trick(1, 'BJ')]);
    expect(bigJokerOutSeats(st)).toEqual([1]);
  });
  it('a nil busted by a plain card is not the Big Joker’s doing', () => {
    const st = hand(cutthroat, [3, 'nil', 3, 3], [trick(0, 'KH'), trick(1, 'AH')]);
    expect(bigJokerOutSeats(st)).toEqual([]);
  });
  it('a nil still standing (no book) attributes nothing', () => {
    const st = hand(cutthroat, [3, 'nil', 3, 3], [trick(0, 'AH'), trick(2, 'BJ')]);
    expect(bigJokerOutSeats(st)).toEqual([]);
  });
});

describe('the replay never throws on an active-count deck variant', () => {
  // A two-player cutthroat endgame at a 3-player table is dealt from a
  // deck whose removed set drops 3C (removedForActive) — so 3C is
  // legally played in a hand whose base rules do not rank it. The
  // replay must fall back to the banked winner, never throw inside
  // scoredRecord.
  const cut3 = makeRules('cutthroat', { playerCount: 3 });
  const variantTrick = (winCard: Card): Trick => ({
    leader: 0,
    winner: 1,
    plays: [
      { seat: 0, card: '3C' },
      { seat: 1, card: winCard },
      { seat: 2, card: 'KH' },
    ],
  });
  it('a nil busted by the Big Joker in a variant trick still stamps, without throwing', () => {
    const st = hand(cut3, [3, 'nil', 3], [variantTrick('BJ')]);
    expect(firstBookCard(cut3, st.tricks, 1)).toBe('BJ');
    expect(bigJokerOutSeats(st)).toEqual([1]);
  });
  it('the same trick won by a plain card stamps nobody, without throwing', () => {
    const st = hand(cut3, [3, 'nil', 3], [variantTrick('AH')]);
    expect(bigJokerOutSeats(st)).toEqual([]);
  });
});

describe('bigJokerOutSeats — set locks', () => {
  // 11 banked tricks: seat 2 (bid 3) holds exactly 1 book — it needs 2
  // with 1 trick left after the 12th, so the 12th book is the lock.
  const banked = [2, 0, 1, 3, 0, 1, 3, 0, 1, 3, 0].map((w) => trick(w, 'AH'));
  it('the lock flipped by a Big Joker book stamps the locked seat (cutthroat)', () => {
    const st = hand(cutthroat, [3, 3, 3, 3], [...banked, trick(0, 'BJ')]);
    expect(bigJokerOutSeats(st)).toEqual([2]);
  });
  it('the same lock flipped by a plain card stamps nobody', () => {
    const st = hand(cutthroat, [3, 3, 3, 3], [...banked, trick(0, 'AS')]);
    expect(bigJokerOutSeats(st)).toEqual([]);
  });
  it('a partnership lock stamps BOTH seats of the locked side', () => {
    // side 1 (seats 1+3, contract 8) holds 6 — needs 2 with 1 left after
    const bankedP = [1, 3, 1, 3, 1, 3, 0, 2, 0, 2, 0].map((w) => trick(w, 'AH'));
    const st = hand(joker, [4, 4, 4, 4], [...bankedP, trick(0, 'BJ')]);
    expect(bigJokerOutSeats(st)).toEqual([1, 3]);
  });
  it('books hands have no contracts to lock — the walk is skipped', () => {
    const st = hand(joker, ['books', 'books', 'books', 'books'], [...banked, trick(0, 'BJ')]);
    expect(bigJokerOutSeats(st)).toEqual([]);
  });
});
