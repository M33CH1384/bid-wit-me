/**
 * The nuke stamp on the hand record (league data wave, item 4): finishHand
 * records which hand was nuked and the seat who played the Big Joker, so
 * the Postgame Report can call the moment out. One engine path builds the
 * record for BOTH producers (server room + offline), so both are covered.
 */
import { describe, expect, it } from 'vitest';
import { type Card, type GameState, type Trick, makeRules } from '../src/index';
import { play, rigged } from './helpers';

const joker = makeRules('joker');

/** a hand one trick from done: `done` tricks banked, one card per seat, seat 0 to lead */
const lastTrick = (cards: Card[][]): GameState => {
  const st = rigged(joker, cards);
  const filler: Trick = { leader: 0, plays: [], winner: 0 };
  return { ...st, phase: 'playing', bids: [3, 3, 3, 3], tricks: Array(12).fill(filler), tricksWon: [3, 3, 3, 3], turn: 0, trick: { leader: 0, plays: [], winner: null }, spadesBroken: true };
};

describe('HandRecord.nuke', () => {
  it('stamps the hand and the Big Joker seat when both Jokers fall in a trick', () => {
    const st = play(lastTrick([['BJ'], ['LJ'], ['QS'], ['JS']]), 'BJ', 'LJ', 'QS', 'JS');
    expect(st.phase === 'handOver' || st.phase === 'gameOver').toBe(true);
    const rec = st.history[st.history.length - 1]!;
    expect(rec.handNo).toBe(1);
    expect(rec.nuke).toEqual({ seat: 0 });
  });

  it('credits the seat who played the Big Joker, in either Joker order', () => {
    const st = play(lastTrick([['LJ'], ['BJ'], ['QS'], ['JS']]), 'LJ', 'BJ', 'QS', 'JS');
    const rec = st.history[st.history.length - 1]!;
    expect(rec.nuke).toEqual({ seat: 1 });
  });

  it('no stamp on a quiet hand (old histories simply lack the field)', () => {
    const st = play(lastTrick([['AS'], ['KS'], ['QS'], ['JS']]), 'AS', 'KS', 'QS', 'JS');
    const rec = st.history[st.history.length - 1]!;
    expect(rec.nuke).toBeUndefined();
  });
});
