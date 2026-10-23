/**
 * Animation package trigger detection (owner, 2026-10-20): every predicate
 * reads real game state only. These pin the judgement calls — cut vs fair
 * trump beat, the match-point reach, the comeback thresholds, the Boston /
 * Wheels readings of a scored hand record.
 */
import { describe, expect, it } from 'vitest';
import { makeRules, type HandRecord, type Trick } from '@spades/rules';
import {
  FIRE_STREAK, HEAT_STREAK, PHOTO_FINISH_MARGIN, UPSET_GAP, bagBrinkSides,
  bagPenaltySides, bagsCrossed, bigJokerSeat, blindNilSeats, bostonSides,
  comebackSides, fireSeat, handWinnerSide, heatSides,
  matchPointSides, newlyEliminated, nilBustedSeats, nilLiveSeats, photoFinish,
  ratingGap, runClaimerSeat, saveInTrick, sealedNilSeats, setSides,
  spadePlayed, syncSides, trickStreak, trickWasCut, wheelsSides, winMargin,
  wireSides,
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

/* ================= wave 3 (owner addendum 2, 2026-10-21) ================= */

describe('wave 3 — the save', () => {
  // seat 3 leads K♥, the nil bidder (seat 0) plays A♥ — STANDING winner at
  // that moment — then seat 1's 2♥, and partner seat 2 cuts with 3♠ and wins.
  const saveTrick = () => trick([[3, 'KH'], [0, 'AH'], [1, '4H'], [2, '3S']], 2);
  const bids = ['nil', 4, 5, 4] as const;
  it('the partner cutting in over a standing nil card IS a save', () => {
    expect(saveInTrick(saveTrick(), bids as never, joker, [0, 0, 0, 0])).toEqual({ bidder: 0, saver: 2 });
  });
  it('no save when the bidder never stood (an earlier ace was already over them)', () => {
    const t = trick([[3, 'AH'], [0, '4H'], [1, 'KH'], [2, '3S']], 2);
    expect(saveInTrick(t, bids as never, joker, [0, 0, 0, 0])).toBeNull();
  });
  it('no save when an OPPONENT takes the trick', () => {
    const t = trick([[3, 'KH'], [0, 'AH'], [1, '3S'], [2, '4H']], 1);
    expect(saveInTrick(t, bids as never, joker, [0, 0, 0, 0])).toBeNull();
  });
  it('no save when the bidder was already busted earlier in the hand', () => {
    expect(saveInTrick(saveTrick(), bids as never, joker, [1, 0, 0, 0])).toBeNull();
  });
  it('no save when the bidder wins the trick themselves', () => {
    const t = trick([[3, 'KH'], [0, 'AH'], [1, '4H'], [2, '9H']], 0);
    expect(saveInTrick(t, bids as never, joker, [0, 0, 0, 0])).toBeNull();
  });
  it('no save in cutthroat (nobody has a partner) or without a live nil', () => {
    expect(saveInTrick(saveTrick(), bids as never, cutRules, [0, 0, 0, 0])).toBeNull();
    expect(saveInTrick(saveTrick(), [5, 4, 5, 4] as never, joker, [0, 0, 0, 0])).toBeNull();
  });
});

describe('wave 3 — nil sealed + busted', () => {
  it('sealed seats come from the scored record (made nils only, nil + blind nil)', () => {
    const r = rec({
      sides: [
        side({ side: 0, nils: [{ seat: 0, kind: 'nil', tricks: 0, made: true, points: 100 }] }),
        side({ side: 1, nils: [
          { seat: 1, kind: 'blindNil', tricks: 0, made: true, points: 200 },
          { seat: 3, kind: 'nil', tricks: 2, made: false, points: -100 },
        ] }),
      ],
    });
    expect(sealedNilSeats(r)).toEqual([0, 1]);
    expect(sealedNilSeats(rec({ sides: [side({ side: 0 })] }))).toEqual([]);
  });
  it('the bust edge is live-nil → first trick taken', () => {
    const prev = { bids: [4, 'nil', 4, 'blindNil'] as const, tricksWon: [0, 0, 0, 0] };
    expect(nilBustedSeats(prev as never, { bids: prev.bids, tricksWon: [0, 1, 0, 0] } as never)).toEqual([1]);
    expect(nilBustedSeats(prev as never, { bids: prev.bids, tricksWon: [0, 0, 0, 3] } as never)).toEqual([3]);
    expect(nilBustedSeats(prev as never, { bids: prev.bids, tricksWon: [2, 0, 0, 0] } as never)).toEqual([]);
    expect(nilBustedSeats(prev as never, prev as never)).toEqual([]);
  });
});

describe('wave 3 — spades broken', () => {
  it('a real spade counts; hearts, clubs and jokers do not', () => {
    expect(spadePlayed([trick([[0, '5H'], [1, 'KH']], 1)])).toBe(false);
    expect(spadePlayed([trick([[0, '5H'], [1, '3S']], 1)])).toBe(true);
    expect(spadePlayed([trick([[0, 'BJ'], [1, 'SJ']], 1)])).toBe(false);
    expect(spadePlayed([], trick([[0, '9S']], null))).toBe(true);
    expect(spadePlayed([])).toBe(false);
  });
});

describe('wave 3 — on fire + streak heat', () => {
  const wt = (winner: number): Trick => ({ leader: 0, plays: [], winner });
  it('the trailing run of trick wins is counted exactly', () => {
    expect(trickStreak([wt(2), wt(2), wt(2)])).toEqual({ seat: 2, count: 3 });
    expect(trickStreak([wt(1), wt(2), wt(2)])).toEqual({ seat: 2, count: 2 });
    expect(trickStreak([])).toBeNull();
    expect(fireSeat({ tricks: [wt(2), wt(2), wt(2)] } as never)).toBe(2);
    expect(fireSeat({ tricks: [wt(2), wt(1), wt(2), wt(2)] } as never)).toBeNull();
    expect(FIRE_STREAK).toBe(3);
  });
  const hand = (p0: number, p1: number, handNo = 1) => rec({
    handNo, sides: [side({ side: 0, points: p0 }), side({ side: 1, points: p1 })],
  });
  it('a hand winner is the unique points leader; a tie has no winner', () => {
    expect(handWinnerSide(hand(90, -40))).toBe(0);
    expect(handWinnerSide(hand(10, 10))).toBeNull();
  });
  it('heat needs HEAT_STREAK straight hand wins; a loss or tie breaks it', () => {
    expect(heatSides([hand(90, 0), hand(60, 0), hand(50, 0)])).toEqual([0]);
    expect(heatSides([hand(90, 0), hand(60, 0)])).toEqual([]);
    expect(heatSides([hand(90, 0), hand(0, 60), hand(50, 0), hand(70, 0)])).toEqual([]);
    expect(heatSides([hand(90, 0), hand(10, 10), hand(50, 0), hand(70, 0)])).toEqual([]);
    expect(heatSides([hand(0, 90), hand(0, 60), hand(0, 50), hand(0, 20)])).toEqual([1]);
    expect(HEAT_STREAK).toBe(3);
  });
});

describe('wave 3 — bag brink', () => {
  it('bags 8 or 9 INSIDE the 10-bag cycle (cumulative totals mod 10)', () => {
    expect(bagBrinkSides([8, 3])).toEqual([0]);
    expect(bagBrinkSides([7, 9])).toEqual([1]);
    expect(bagBrinkSides([19, 20])).toEqual([0]); // 19 → 9 in cycle; 20 → 0
    expect(bagBrinkSides([10, 0])).toEqual([]);
    expect(bagBrinkSides([9, 18])).toEqual([0, 1]);
  });
});

describe('wave 3 — down to the wire', () => {
  const dt = (n: number) => Array.from({ length: n }, () => trick([[0, '9H']], 0));
  const base = { rules: joker, bids: [5, 4, 4, 3], tricksWon: [5, 2, 3, 2], phase: 'playing' as const };
  it('final trick + exactly one book short → on the wire', () => {
    // side 0: contract 9, taken 8 → 1 short; side 1: contract 7, taken 4 → 3 short
    expect(wireSides({ ...base, tricks: dt(12) } as never)).toEqual([0]);
  });
  it('not the final trick → no wire, however close it is', () => {
    expect(wireSides({ ...base, tricks: dt(11) } as never)).toEqual([]);
    expect(wireSides({ ...base, phase: 'bidding', tricks: dt(12) } as never)).toEqual([]);
  });
  it('contract already made (0 short) or set beyond reach is not "decided by" the last book', () => {
    expect(wireSides({ ...base, tricksWon: [6, 2, 3, 2], tricks: dt(12) } as never)).toEqual([]); // side 0 made it
    expect(wireSides({ ...base, tricksWon: [3, 2, 3, 2], tricks: dt(12) } as never)).toEqual([]); // side 0 needs 3 with 1 left — already set
  });
  it("a nil partner's books don't inflate the contract (engine arithmetic)", () => {
    const st = { rules: joker, bids: [5, 4, 'nil', 3], tricksWon: [4, 2, 0, 2], phase: 'playing' as const, tricks: dt(12) };
    expect(wireSides(st as never)).toEqual([0]); // contract is seat 0's 5 alone; 4 taken → 1 short
  });
});

describe('wave 3 — photo finish', () => {
  const res = (winners: number[], finalScores: number[]) => ({ winners, finalScores } as never);
  it('margin = best winner total − best loser total; <= PHOTO_FINISH_MARGIN is a photo finish', () => {
    expect(winMargin(res([0], [500, 490]))).toBe(10);
    expect(photoFinish(res([0], [500, 490]))).toBe(true);
    expect(photoFinish(res([0], [500, 489]))).toBe(false);
    expect(photoFinish(res([1], [320, 505]))).toBe(false);
    expect(photoFinish(res([0], [505, 500]))).toBe(true);
    expect(PHOTO_FINISH_MARGIN).toBe(10);
  });
  it('co-winners compare against the best loser, never a 0 margin', () => {
    expect(winMargin(res([0, 1], [500, 500, 300]))).toBe(200);
    expect(photoFinish(res([0, 1], [500, 500, 300]))).toBe(false);
    expect(winMargin(res([0], []))).toBeNull();
  });
});
