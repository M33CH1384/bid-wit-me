/**
 * Wave B §C new scenarios (owner slate, 2026-10-28): the eight BUILD-NOW
 * detectors. Every predicate reads real state only — hand records, trick
 * history, bid state, or the client's own session talk log (per-side
 * callout counts the layer tallied from displayed callouts). These tests
 * pin the exact §C conditions, including the near-misses that must NOT
 * fire.
 */
import { describe, expect, it } from 'vitest';
import { makeRules, type HandRecord, type Trick } from '@spades/rules';
import {
  MIRROR_MIN, NINE_LIVES_DEFICIT, SHUSH_STREAK, SHUSH_TALK, contractDeadSides,
  doubleMoonSides, mirrorBidSides, nineLivesSides, paybackColdPairs,
  shushSides, silentAssassinSeats, textbookSides,
} from '../src/animfx/detect';

const joker = makeRules('joker');
const cutRules = { ...joker, partnerships: false } as typeof joker;

const side = (o: Partial<HandRecord['sides'][number]> & { side: number }): HandRecord['sides'][number] => ({
  seats: [], contract: 0, contractTricks: 0, tricks: 0, contractMade: null,
  nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0,
  points: 0, totalScore: 0, totalBags: 0, ...o,
});
const rec = (o: Partial<HandRecord>): HandRecord => ({ handNo: 1, dealer: 0, bids: [], tricksWon: [], sides: [], ...o });
const nil = (seat: number, kind: 'nil' | 'blindNil', made: boolean) => ({ seat, kind, tricks: made ? 0 : 1, made, points: 0 });
const wt = (winner: number): Trick => ({ leader: 0, plays: [], winner });

describe('N1 double moon', () => {
  it('both partners made nils, at least one blind → the side moons', () => {
    const r = rec({ sides: [
      side({ side: 0, nils: [nil(0, 'blindNil', true), nil(2, 'nil', true)] }),
      side({ side: 1, nils: [] }),
    ] });
    expect(doubleMoonSides(r, joker)).toEqual([0]);
  });
  it('two plain nils made is sealed twice, not a double moon', () => {
    const r = rec({ sides: [
      side({ side: 0, nils: [nil(0, 'nil', true), nil(2, 'nil', true)] }),
      side({ side: 1 }),
    ] });
    expect(doubleMoonSides(r, joker)).toEqual([]);
  });
  it('a busted partner nil breaks it; cutthroat has no partners to moon', () => {
    const r = rec({ sides: [
      side({ side: 0, nils: [nil(0, 'blindNil', true), nil(2, 'nil', false)] }),
      side({ side: 1 }),
    ] });
    expect(doubleMoonSides(r, joker)).toEqual([]);
    expect(doubleMoonSides(r, cutRules)).toEqual([]);
  });
});

describe('N3 payback served cold', () => {
  const setRec = (victim: number, handNo: number) => rec({
    handNo,
    sides: [
      side({ side: 0, contract: 8, contractMade: victim !== 0 }),
      side({ side: 1, contract: 8, contractMade: victim !== 1 }),
    ],
  });
  it('A set B earlier, B sets A now → served cold', () => {
    expect(paybackColdPairs([setRec(1, 1), setRec(0, 2)])).toEqual([{ setter: 1, victim: 0 }]);
  });
  it('a first-time set is just a set; a repeat set the same way is not payback', () => {
    expect(paybackColdPairs([setRec(0, 1)])).toEqual([]);
    expect(paybackColdPairs([setRec(0, 1), setRec(0, 2)])).toEqual([]);
    expect(paybackColdPairs([setRec(1, 1), setRec(1, 2)])).toEqual([]);
  });
});

describe('N4 nine lives', () => {
  const h = (t0: number, t1: number, handNo: number) => rec({
    handNo,
    sides: [side({ side: 0, totalScore: t0 }), side({ side: 1, totalScore: t1 })],
  });
  it('buried by 400+ at an earlier hand-end, now strictly in the lead', () => {
    expect(nineLivesSides([h(-450, 0, 1), h(-100, 50, 2), h(300, 120, 3)])).toEqual([0]);
    expect(NINE_LIVES_DEFICIT).toBe(400);
  });
  it('a 100-point comeback is the surge, not nine lives; tied at the top is not the lead', () => {
    expect(nineLivesSides([h(-150, 0, 1), h(300, 120, 2)])).toEqual([]);
    expect(nineLivesSides([h(-450, 0, 1), h(300, 300, 2)])).toEqual([]);
    expect(nineLivesSides([h(300, 120, 1)])).toEqual([]);
  });
});

describe('N10 textbook', () => {
  it('contract made exactly, zero bags', () => {
    const r = rec({ sides: [
      side({ side: 0, contract: 9, tricks: 9, contractMade: true, bagsAdded: 0 }),
      side({ side: 1, contract: 7, tricks: 4, contractMade: false, bagsAdded: 0 }),
    ] });
    expect(textbookSides(r)).toEqual([0]);
  });
  it('one bag over is a make, not textbook; a nil-only side never qualifies', () => {
    const over = rec({ sides: [
      side({ side: 0, contract: 9, tricks: 10, contractMade: true, bagsAdded: 1 }),
      side({ side: 1, contract: 0, tricks: 0, contractMade: true, bagsAdded: 0 }),
    ] });
    expect(textbookSides(over)).toEqual([]);
  });
});

describe('N5 silent assassin', () => {
  const r = rec({ sides: [
    side({ side: 0, nils: [nil(0, 'blindNil', true)] }),
    side({ side: 1, nils: [nil(1, 'blindNil', true), nil(3, 'nil', true)] }),
  ] });
  it('a made blind nil from a side that said nothing all hand', () => {
    expect(silentAssassinSeats(r, [0, 3])).toEqual([0]);
    expect(silentAssassinSeats(r, [0, 0])).toEqual([0, 1]); // seat 3's plain nil never counts
  });
  it('one callout from the seat\'s own side breaks the silence', () => {
    expect(silentAssassinSeats(r, [1, 0])).toEqual([1]);
  });
});

describe('N2 the shush', () => {
  const st = (winners: number[]) => ({ tricks: winners.map(wt), rules: joker });
  it('4+ straight tricks against a side that talked 2+ times', () => {
    expect(shushSides(st([1, 0, 0, 0, 0]) as never, [0, 2])).toEqual([0]);
    expect(SHUSH_STREAK).toBe(4);
    expect(SHUSH_TALK).toBe(2);
  });
  it('no talk, no shush; a 3-run is just a streak', () => {
    expect(shushSides(st([0, 0, 0, 0]) as never, [0, 1])).toEqual([]);
    expect(shushSides(st([1, 0, 0, 0]) as never, [0, 5])).toEqual([]);
  });
});

describe('N7 mirror bids', () => {
  const st = (bids: unknown[]) => ({ rules: joker, bids });
  it('both combined contracts equal and >= 10 once bidding closes', () => {
    expect(mirrorBidSides(st([6, 5, 4, 5]) as never)).toEqual([0, 1]);
    expect(MIRROR_MIN).toBe(10);
  });
  it('unequal, under the floor, still bidding, a books hand, or cutthroat → no mirror', () => {
    expect(mirrorBidSides(st([6, 5, 4, 4]) as never)).toEqual([]);
    expect(mirrorBidSides(st([5, 4, 4, 5]) as never)).toEqual([]); // 9 vs 9
    expect(mirrorBidSides(st([6, 5, 4, null]) as never)).toEqual([]);
    expect(mirrorBidSides(st(['books', 'books', 'books', 'books']) as never)).toEqual([]);
    expect(mirrorBidSides({ rules: cutRules, bids: [10, 10, 0, 0] } as never)).toEqual([]);
  });
  it('a nil partner contributes no contract, exactly as scored', () => {
    expect(mirrorBidSides(st([10, 6, 'nil', 4]) as never)).toEqual([0, 1]); // 10 vs 10
  });
});

describe('N9 the guillotine', () => {
  const done = (n: number) => Array.from({ length: n }, () => wt(0));
  const st = (tricksDone: number) => ({
    rules: joker, bids: [7, 4, 6, 3], tricks: done(tricksDone), trickCount: 13,
  });
  it('needed > remaining is dead; needed == remaining is still alive', () => {
    // after 10 tricks: 3 remain. Side 0 (contract 13) took 8 → needs 5 > 3: dead.
    // Side 1 (contract 7) took 2 → needs 5 > 3: also dead on these numbers.
    expect(contractDeadSides(st(10) as never, [5, 1, 3, 1])).toEqual([0, 1]);
    // side 0 took 10 → needs 3 == 3 remaining: alive. Side 1 took 4 → needs 3: alive.
    expect(contractDeadSides(st(10) as never, [6, 2, 4, 2])).toEqual([]);
  });
  it('early in the hand nothing is dead; an uncountable contract (a nil-only side) is never dead', () => {
    expect(contractDeadSides(st(2) as never, [1, 0, 1, 0])).toEqual([]);
    const nilSide = { rules: joker, bids: ['nil', 4, 'nil', 3], tricks: done(12), trickCount: 13 };
    // side 0 is nil-only (uncountable → never dead); side 1 made its 7 exactly.
    expect(contractDeadSides(nilSide as never, [0, 4, 0, 3])).toEqual([]);
  });
});
