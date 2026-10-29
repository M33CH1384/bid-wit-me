/**
 * The bestRuns stamp on the hand record (Play-Well, owner 2026-10-29):
 * finishHand records each seat's longest run of consecutive trick wins
 * inside the hand — the Streak Fire definition — because the record
 * itself keeps only trick COUNTS, so the run is unrecoverable later.
 * One engine path builds the record for both producers (server room +
 * offline) and for both mode families (the stamp lands before the
 * partnership/cutthroat split), so all of them are covered.
 */
import { describe, expect, it } from 'vitest';
import { type Card, type GameState, type Seat, type Trick, makeRules } from '../src/index';
import { play, rigged } from './helpers';

const joker = makeRules('joker');
const cut4 = makeRules('cutthroat');

/** a hand one trick from done: `winners` banked as completed tricks, one card per seat, seat 0 to lead the last trick */
const lastTrick = (rules: typeof joker, winners: Seat[], cards: Card[][]): GameState => {
  const st = rigged(rules, cards);
  const tricks: Trick[] = winners.map((w) => ({ leader: 0, plays: [], winner: w }));
  return { ...st, phase: 'playing', bids: [3, 3, 3, 3], tricks, tricksWon: [3, 3, 3, 3], turn: 0, trick: { leader: 0, plays: [], winner: null }, spadesBroken: true };
};

describe('HandRecord.bestRuns', () => {
  it('stamps each seat\'s longest run of consecutive trick wins (partnership)', () => {
    // runs in the banked tricks: seat1 opens with 3, seat2 pairs, seat1 runs 4, seat3 pairs
    const winners: Seat[] = [1, 1, 1, 0, 2, 2, 1, 1, 1, 1, 3, 3];
    // final trick: seat 0 leads the ace and takes it — a fresh run of 1
    const st = play(lastTrick(joker, winners, [['AS'], ['KS'], ['QS'], ['JS']]), 'AS', 'KS', 'QS', 'JS');
    expect(st.phase === 'handOver' || st.phase === 'gameOver').toBe(true);
    const rec = st.history[st.history.length - 1]!;
    expect(rec.bestRuns).toEqual([1, 4, 2, 2]);
  });

  it('a run continues into the final trick (cutthroat)', () => {
    // seat 2 closes the banked tricks with 3 straight…
    const winners: Seat[] = [0, 1, 1, 3, 3, 0, 0, 1, 3, 2, 2, 2];
    // …and takes the last trick too (its ace over the led jack): run of 4
    const st = play(lastTrick(cut4, winners, [['JS'], ['QS'], ['AS'], ['KS']]), 'JS', 'QS', 'AS', 'KS');
    const rec = st.history[st.history.length - 1]!;
    expect(rec.bestRuns).toEqual([2, 2, 4, 2]);
  });

  it('a seat that never won a trick stamps 0, not a gap', () => {
    const winners: Seat[] = Array(12).fill(2) as Seat[];
    const st = play(lastTrick(joker, winners, [['AS'], ['KS'], ['QS'], ['JS']]), 'AS', 'KS', 'QS', 'JS');
    const rec = st.history[st.history.length - 1]!;
    expect(rec.bestRuns).toEqual([1, 0, 12, 0]);
  });
});
