/**
 * Animation package trigger detection (owner, 2026-10-20): every predicate
 * reads real game state only. These pin the judgement calls — cut vs fair
 * trump beat, the match-point reach, the comeback thresholds, the Boston /
 * Wheels readings of a scored hand record.
 */
import { describe, expect, it } from 'vitest';
import { makeRules, type HandRecord, type Trick } from '@spades/rules';
import {
  UPSET_GAP, bagPenaltySides, bagsCrossed, bigJokerSeat, blindNilSeats, bostonSides,
  comebackSides, matchPointSides, newlyEliminated, nilLiveSeats, ratingGap,
  runClaimerSeat, setSides, syncSides, trickWasCut, wheelsSides,
} from '../src/animfx/detect';

const joker = makeRules('joker');
const cutRules = { ...joker, partnerships: false } as typeof joker;

const trick = (plays: [number, string][], winner: number | null): Trick => ({
  leader: plays[0]?.[0] ?? 0,
  plays: plays.map(([seat, card]) => ({ seat, card: card as never })),
  winner,
});
const side = (o: Partial<HandRecord['sides'][number]> & { side: number }): HandRecord['sides'][number] => ({
  seats: [], contract: 0, contractTricks: 0, tricks: 0, contractMade: null,
  nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0,
  points: 0, totalScore: 0, totalBags: 0, ...o,
});
const rec = (o: Partial<HandRecord>): HandRecord => ({ handNo: 1, dealer: 0, bids: [], tricksWon: [], sides: [], ...o });

describe('nil + blind nil seats', () => {
  it('a nil is live until its seat takes a trick', () => {
    const st = { bids: [5, 'nil', 3, 'blindNil'] as const, tricksWon: [0, 0, 0, 0] };
    expect(nilLiveSeats(st as never)).toEqual([1, 3]);
    expect(nilLiveSeats({ bids: st.bids, tricksWon: [0, 1, 0, 0] } as never)).toEqual([3]);
    expect(nilLiveSeats({ bids: st.bids, tricksWon: [0, 0, 0, 2] } as never)).toEqual([1]);
  });
  it('blind nil seats are exactly the blindNil bids', () => {
    expect(blindNilSeats({ bids: ['blindNil', 4, 'nil', 2] } as never)).toEqual([0]);
    expect(blindNilSeats({ bids: [1, 2, 3, 4] } as never)).toEqual([]);
  });
});

describe('trick reads', () => {
  it('a spade cutting a non-trump lead is a cut', () => {
    expect(trickWasCut(trick([[0, '5H'], [1, 'KH'], [2, '3S'], [3, '9H']], 2), joker)).toBe(true);
    expect(trickWasCut(trick([[0, '5H'], [1, 'BJ'], [2, '9H'], [3, '2H']], 1), joker)).toBe(true);
  });
  it('beating a led trump, or winning on suit, is not a cut', () => {
    expect(trickWasCut(trick([[0, 'AS'], [1, 'BJ'], [2, '9S'], [3, '2S']], 1), joker)).toBe(false);
    expect(trickWasCut(trick([[0, '5H'], [1, 'KH'], [2, '9H'], [3, '2H']], 1), joker)).toBe(false);
    expect(trickWasCut(trick([[0, '5H'], [1, 'KH']], null), joker)).toBe(false);
  });
  it('finds the Big Joker seat', () => {
    expect(bigJokerSeat(trick([[0, '5S'], [1, 'BJ'], [2, '9S']], 1))).toBe(1);
    expect(bigJokerSeat(trick([[0, '5S'], [1, 'LJ']], 1))).toBeNull();
  });
  it('run claimer is the winner of the last run-flagged trick', () => {
    const t = (winner: number, run: boolean): Trick => ({ leader: 0, winner, plays: [{ seat: winner, card: 'AS' as never, ...(run ? { run: true as const } : {}) }] });
    expect(runClaimerSeat([t(0, false), t(2, true)])).toBe(2);
    expect(runClaimerSeat([t(0, false)])).toBeNull();
  });
});

describe('hand-end record reads', () => {
  it('bag penalty sides come from the scored record; crossings agree', () => {
    const r = rec({ sides: [side({ side: 0, bagPenaltyCount: 1 }), side({ side: 1 })] });
    expect(bagPenaltySides(r)).toEqual([0]);
    expect(bagsCrossed([7, 19], [12, 19])).toEqual([0]);
    expect(bagsCrossed([7, 19], [9, 21])).toEqual([1]);
    expect(bagsCrossed([10, 0], [19, 9])).toEqual([]);
  });
  it('a Boston is one side taking every book', () => {
    const r = rec({ tricksWon: [7, 0, 6, 0], sides: [side({ side: 0, tricks: 13 }), side({ side: 1, tricks: 0 })] });
    expect(bostonSides(r)).toEqual([0]);
    const split = rec({ tricksWon: [5, 3, 3, 2], sides: [side({ side: 0, tricks: 8 }), side({ side: 1, tricks: 5 })] });
    expect(bostonSides(split)).toEqual([]);
  });
  it('wheels: team predicate for partnership, 10+ books solo in cutthroat', () => {
    const team = rec({ bids: [6, 3, 5, 4], sides: [side({ side: 0, tricks: 11, contractMade: true }), side({ side: 1, tricks: 2 })] });
    expect(wheelsSides(team, joker)).toEqual([0]);
    const set = rec({ bids: [6, 3, 5, 4], sides: [side({ side: 0, tricks: 9, contractMade: false }), side({ side: 1, tricks: 4 })] });
    expect(wheelsSides(set, joker)).toEqual([]);
    const solo = rec({ sides: [side({ side: 0, tricks: 4 }), side({ side: 1, tricks: 10 }), side({ side: 2, tricks: 0 }), side({ side: 3, tricks: 0 })] });
    expect(wheelsSides(solo, cutRules)).toEqual([1]);
  });
  it('comeback: down 100+ before the hand, within 25 after it', () => {
    const r = rec({ sides: [side({ side: 0, points: 130, totalScore: 180 }), side({ side: 1, points: 10, totalScore: 205 })] });
    expect(comebackSides(r)).toEqual([0]);
    const mild = rec({ sides: [side({ side: 0, points: 60, totalScore: 150 }), side({ side: 1, points: 10, totalScore: 195 })] });
    expect(comebackSides(mild)).toEqual([]); // was only down 95
    const stillBuried = rec({ sides: [side({ side: 0, points: 40, totalScore: 90 }), side({ side: 1, points: 10, totalScore: 205 })] });
    expect(comebackSides(stillBuried)).toEqual([]); // closed to 115, not 25
  });
});

describe('wave 2 record reads', () => {
  it('the set: a failed real contract, never a nil-only side', () => {
    const r = rec({ sides: [side({ side: 0, contract: 11, contractMade: false }), side({ side: 1, contract: 7, contractMade: true })] });
    expect(setSides(r)).toEqual([0]);
    const nilOnly = rec({ sides: [side({ side: 0, contract: 0, contractMade: false }), side({ side: 1, contract: 8, contractMade: true })] });
    expect(setSides(nilOnly)).toEqual([]);
    const nobody = rec({ sides: [side({ side: 0, contract: 5, contractMade: true }), side({ side: 1, contract: 5, contractMade: true })] });
    expect(setSides(nobody)).toEqual([]);
  });
  it('in sync: contract made with BOTH partners on real bids', () => {
    const both = rec({ bids: [6, 3, 5, 4], sides: [side({ side: 0, seats: [0, 2], contractMade: true }), side({ side: 1, seats: [1, 3], contractMade: true })] });
    expect(syncSides(both, joker)).toEqual([0, 1]);
    const nilRide = rec({ bids: [11, 3, 'nil', 4], sides: [side({ side: 0, seats: [0, 2], contractMade: true }), side({ side: 1, seats: [1, 3], contractMade: false })] });
    expect(syncSides(nilRide, joker)).toEqual([]); // seat 2 rode a nil; side 1 was set
    expect(syncSides(both, cutRules)).toEqual([]); // no partners in cutthroat
  });
  it('upset gap: winners average vs losers average, 150 is the bar', () => {
    expect(ratingGap([1000, 1020], [1200, 1180])).toBe(180);
    expect(ratingGap([1200], [1000])).toBe(-200);
    expect(ratingGap([], [1000])).toBe(0);
    expect(UPSET_GAP).toBe(150);
  });
});

describe('match state', () => {
  const st = (scores: number[], extra: object = {}) => ({ scores, rules: joker, phase: 'playing', result: null, ...extra }) as never;
  it('match point: leader within one big hand (100) of the target', () => {
    expect(matchPointSides(st([430, 300]))).toEqual([0]);
    expect(matchPointSides(st([399, 300]))).toEqual([]);
    expect(matchPointSides(st([430, 425]))).toEqual([0]); // close trailer is not on match point
    expect(matchPointSides(st([450, 450]))).toEqual([0, 1]); // tied leaders both are
    expect(matchPointSides(st([0, 0]))).toEqual([]);
    expect(matchPointSides(st([430, 300], { result: { winners: [0] } }))).toEqual([]);
    expect(matchPointSides(st([430, 300], { phase: 'gameOver' }))).toEqual([]);
  });
  it('newly eliminated seats are the false→true edges', () => {
    expect(newlyEliminated([false, false, false], [false, true, false])).toEqual([1]);
    expect(newlyEliminated([false, true], [false, true])).toEqual([]);
    expect(newlyEliminated(undefined, [true, false])).toEqual([0]);
    expect(newlyEliminated([true], undefined)).toEqual([]);
  });
});
