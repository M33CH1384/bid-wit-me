import { describe, expect, it } from 'vitest';
import { type Bid, bidLabel, checkGameEnd, isNilBid, makeRules, partnerOf, placementsFor, scoreHand, sideCount, sideOf, sideSeats } from '../src';

const joker = makeRules('joker');
const ct = makeRules('cutthroat');

// helper: team bids for seats 0..3 and tricks per seat
const score = (bids: Bid[], tricks: number[], rules = joker, scores = [0, 0], bags = [0, 0]) =>
  scoreHand(rules, bids, tricks, scores, bags);

describe('sides', () => {
  it('partner modes: seats 0&2 vs 1&3', () => {
    expect(sideCount(joker)).toBe(2);
    expect(sideOf(2, joker)).toBe(0);
    expect(sideOf(3, joker)).toBe(1);
    expect(sideSeats(1, joker)).toEqual([1, 3]);
    expect(partnerOf(1, joker)).toBe(3);
  });
  it('cutthroat: one side per player', () => {
    expect(sideCount(ct)).toBe(4);
    expect(sideOf(3, ct)).toBe(3);
    expect(partnerOf(1, ct)).toBeNull();
    expect(sideSeats(2, ct)).toEqual([2]);
  });
  it('bid helpers', () => {
    expect(isNilBid('nil')).toBe(true);
    expect(isNilBid('blindNil')).toBe(true);
    expect(isNilBid(0)).toBe(false);
    expect(bidLabel(null)).toBe('—');
    expect(bidLabel('nil')).toBe('Nil');
    expect(bidLabel('blindNil')).toBe('Blind Nil');
    expect(bidLabel(4)).toBe('4');
  });
});

describe('contract scoring', () => {
  it('made exactly: 10 × bid', () => {
    const [a, b] = score([3, 4, 2, 4], [3, 4, 2, 4]);
    expect(a!.points).toBe(50);
    expect(a!.contractMade).toBe(true);
    expect(b!.points).toBe(80);
  });
  it('overtricks are bags worth 1 point each', () => {
    const [a] = score([3, 4, 2, 2], [4, 2, 3, 4]);
    expect(a!.contract).toBe(5);
    expect(a!.tricks).toBe(7);
    expect(a!.bagsAdded).toBe(2);
    expect(a!.points).toBe(52);
    expect(a!.totalBags).toBe(2);
  });
  it('set: −10 × bid, no bags', () => {
    const [, b] = score([3, 5, 3, 4], [4, 3, 4, 2]);
    expect(b!.contractMade).toBe(false);
    expect(b!.points).toBe(-90);
    expect(b!.bagsAdded).toBe(0);
  });
  it('10 accumulated bags cost 100 and the count drops by 10', () => {
    const [a] = score([3, 1, 2, 1], [6, 1, 5, 1], joker, [200, 0], [8, 0]);
    expect(a!.bagsAdded).toBe(6);
    expect(a!.bagPenaltyCount).toBe(1);
    expect(a!.bagPenaltyPoints).toBe(-100);
    expect(a!.totalBags).toBe(4);
    expect(a!.points).toBe(50 + 6 - 100);
    expect(a!.totalScore).toBe(156);
  });
  it('custom bag rules: 5 bags for −50', () => {
    const r = makeRules('joker', { bagsPerPenalty: 5, bagPenalty: 50 });
    const [a] = score([1, 1, 1, 1], [6, 1, 5, 1], r, [0, 0], [0, 0]);
    expect(a!.bagsAdded).toBe(9);
    expect(a!.bagPenaltyCount).toBe(1);
    expect(a!.totalBags).toBe(4);
    expect(a!.points).toBe(20 + 9 - 50);
  });
  it('several penalties in one hand', () => {
    const r = makeRules('joker', { bagsPerPenalty: 5 });
    const [a] = score([1, 1, 1, 0], [6, 1, 5, 1], r, [0, 0], [4, 0]);
    expect(a!.totalBags).toBe(3);
    expect(a!.bagPenaltyCount).toBe(2);
  });
  it('10 for 200 doubles a made bid of 10+', () => {
    const r = makeRules('joker', { tenForTwoHundred: true });
    expect(score([6, 1, 4, 1], [6, 1, 5, 1], r)[0]!.points).toBe(201);
    expect(score([5, 1, 4, 1], [6, 1, 5, 1], r)[0]!.points).toBe(92);
    expect(score([6, 1, 5, 1], [6, 1, 4, 2], r)[0]!.points).toBe(-110);
  });
});

describe('nil scoring', () => {
  it('nil made +100, scored apart from the partner contract', () => {
    const [a] = score(['nil', 3, 4, 3], [0, 4, 5, 4]);
    expect(a!.nils).toEqual([{ seat: 0, kind: 'nil', tricks: 0, made: true, points: 100 }]);
    expect(a!.contract).toBe(4);
    expect(a!.points).toBe(100 + 40 + 1);
  });
  it('nil failed −100; by default those tricks are bags, not toward the partner', () => {
    const [a] = score(['nil', 3, 4, 3], [2, 3, 3, 5]);
    expect(a!.nils[0]!.made).toBe(false);
    expect(a!.contractTricks).toBe(3);
    expect(a!.contractMade).toBe(false);
    expect(a!.bagsAdded).toBe(2);
    expect(a!.points).toBe(-100 - 40 + 2);
  });
  it('house rule: failed nil tricks count toward the partner', () => {
    const r = makeRules('joker', { nilTricksCountForPartner: true });
    const [a] = score(['nil', 3, 4, 3], [2, 3, 3, 5], r);
    expect(a!.contractTricks).toBe(5);
    expect(a!.contractMade).toBe(true);
    expect(a!.bagsAdded).toBe(1);
    expect(a!.points).toBe(-100 + 40 + 1);
  });
  it('blind nil ±200', () => {
    expect(score(['blindNil', 3, 4, 3], [0, 4, 5, 4])[0]!.nils[0]!.points).toBe(200);
    expect(score(['blindNil', 3, 4, 3], [1, 4, 4, 4])[0]!.nils[0]!.points).toBe(-200);
  });
  it('double nil: no contract, tricks are bags either way', () => {
    const [a] = score(['nil', 5, 'nil', 5], [1, 6, 0, 6]);
    expect(a!.contract).toBe(0);
    expect(a!.contractMade).toBeNull();
    expect(a!.bagsAdded).toBe(1);
    expect(a!.points).toBe(-100 + 100 + 1);
    const r = makeRules('joker', { nilTricksCountForPartner: true });
    const [b] = score(['nil', 5, 'nil', 5], [1, 6, 0, 6], r);
    expect(b!.bagsAdded).toBe(1);
    expect(b!.points).toBe(1);
  });
  it('custom nil values', () => {
    const r = makeRules('joker', { nil: { value: 50 }, blindNil: { value: 150 } });
    expect(score(['nil', 3, 'blindNil', 3], [0, 6, 0, 7], r)[0]!.points).toBe(200);
  });
});

describe('cutthroat scoring', () => {
  it('each player scores individually, bags per player', () => {
    const res = scoreHand(ct, [3, 'nil', 4, 5], [5, 0, 3, 5], [0, 0, 0, 0], [0, 0, 0, 9]);
    expect(res.map((r) => r.points)).toEqual([32, 100, -40, 50]);
    expect(res[0]!.totalBags).toBe(2);
    expect(res[3]!.totalBags).toBe(9);
  });
  it('3-player cutthroat with 17 tricks', () => {
    const r3 = makeRules('cutthroat', { playerCount: 3 });
    const res = scoreHand(r3, [6, 5, 6], [7, 4, 6], [0, 0, 0], [0, 0, 0]);
    expect(res.map((r) => r.points)).toEqual([61, -50, 60]);
  });
});

describe('game end', () => {
  it('first to the target wins', () => {
    expect(checkGameEnd(joker, [510, 300])).toMatchObject({ endReason: 'target', winners: [0], placements: [1, 2] });
    expect(checkGameEnd(joker, [499, 300])).toBeNull();
  });
  it('both over target: higher wins; exact tie plays on', () => {
    expect(checkGameEnd(joker, [520, 560])!.winners).toEqual([1]);
    expect(checkGameEnd(joker, [520, 520])).toBeNull();
  });
  it('mercy floor ends the game; can be turned off', () => {
    expect(checkGameEnd(joker, [-200, 50])).toMatchObject({ endReason: 'floor', winners: [1] });
    expect(checkGameEnd(joker, [-199, 50])).toBeNull();
    expect(checkGameEnd(makeRules('joker', { losingFloor: null }), [-900, 50])).toBeNull();
  });
  it('partner floor with a tied top plays on', () => {
    expect(checkGameEnd(joker, [-250, -250])).toBeNull();
  });
  it('cutthroat: placements share ties; target needs a unique leader', () => {
    expect(checkGameEnd(ct, [310, 120, 120, 40])).toMatchObject({ placements: [1, 2, 2, 4], winners: [0] });
    expect(checkGameEnd(ct, [310, 310, 0, 0])).toBeNull();
    expect(checkGameEnd(ct, [100, 100, -210, 0])).toMatchObject({ endReason: 'floor', winners: [0, 1], placements: [1, 1, 4, 3] });
  });
  it('custom target', () => {
    expect(checkGameEnd(makeRules('joker', { targetScore: 250 }), [260, 0])!.winners).toEqual([0]);
  });
  it('placementsFor uses competition ranking', () => {
    expect(placementsFor([5, 9, 9, 1])).toEqual([3, 1, 1, 4]);
  });
});
