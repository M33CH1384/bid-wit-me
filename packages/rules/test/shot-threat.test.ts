import { describe, expect, it } from 'vitest';
import { makeRules, newlyOneTrickFromShot, sidesOneTrickFromShot } from '../src';

const team = makeRules('joker');
const cutthroat = makeRules('cutthroat', { playerCount: 3 });

function at(over: {
  rules?: ReturnType<typeof makeRules>;
  phase?: string;
  handNo?: number;
  bids: readonly (number | 'nil' | 'blindNil' | 'books' | null)[];
  tricksWon: readonly number[];
  played: number;
}) {
  return {
    handNo: over.handNo ?? 2,
    phase: over.phase ?? 'playing',
    rules: over.rules ?? team,
    bids: over.bids,
    tricksWon: over.tricksWon,
    tricks: Array.from({ length: over.played }, () => ({})),
  };
}

describe('one trick from getting shot', () => {
  it('fires when books still needed equal the tricks still left', () => {
    // side 0 bid 8, has 5, 3 tricks left: losing one more sets them. Side 1 can still drop two.
    const st = at({ bids: [4, 3, 4, 3], tricksWon: [3, 2, 2, 3], played: 10 });
    expect(sidesOneTrickFromShot(st)).toEqual([0]);
  });

  it('stays quiet when they can still afford to lose one, or are already short', () => {
    expect(sidesOneTrickFromShot(at({ bids: [4, 3, 4, 3], tricksWon: [2, 2, 2, 2], played: 8 }))).toEqual([]); // side 0 needs 4, 5 left
    expect(sidesOneTrickFromShot(at({ bids: [4, 3, 4, 3], tricksWon: [2, 4, 2, 3], played: 11 }))).toEqual([]); // side 0 needs 4, 2 left
    expect(sidesOneTrickFromShot(at({ bids: [4, 3, 4, 3], tricksWon: [4, 2, 4, 1], played: 11 }))).toEqual([]); // contract already made
  });

  it('treats each Cutthroat player as their own side', () => {
    // 17-trick hand. Player 0 bid 8, has 3, 5 tricks left. The others are not on the edge.
    const st = at({ rules: cutthroat, bids: [8, 4, 5], tricksWon: [3, 5, 4], played: 12 });
    expect(sidesOneTrickFromShot(st)).toEqual([0]);
  });

  it('ignores a nil bid as a contract, and does not count that player’s tricks unless the rule says so', () => {
    // Partner bid 5, nil has taken 2. Those 2 do not count, so the side still needs 3 with 3 left.
    const nil = at({ bids: ['nil', 4, 5, 4], tricksWon: [2, 3, 2, 3], played: 10 });
    expect(sidesOneTrickFromShot(nil)).toEqual([0]);
    // Counting nil tricks for the partner: taken is 4, needed is 1, not equal to 3 left.
    const counted = at({
      rules: makeRules('joker', { nilTricksCountForPartner: true }),
      bids: ['nil', 4, 5, 4], tricksWon: [2, 3, 2, 3], played: 10,
    });
    expect(sidesOneTrickFromShot(counted)).toEqual([]);
    // Same rule, one trick left and one book short because the nil trick counts: now they are on the edge.
    const countedEdge = at({
      rules: makeRules('joker', { nilTricksCountForPartner: true }),
      bids: ['blindNil', 3, 5, 2], tricksWon: [1, 4, 3, 4], played: 12,
    });
    expect(sidesOneTrickFromShot(countedEdge)).toEqual([0]);
    expect(sidesOneTrickFromShot({ ...countedEdge, rules: team })).toEqual([]);
  });

  it('does not pump a side that only bid nil, or a hand still being bid', () => {
    expect(sidesOneTrickFromShot(at({ bids: ['nil', 4, 'blindNil', 4], tricksWon: [0, 4, 0, 4], played: 8 }))).toEqual([]);
    expect(sidesOneTrickFromShot(at({ phase: 'bidding', bids: [4, null, null, null], tricksWon: [0, 0, 0, 0], played: 0 }))).toEqual([]);
  });

  it('pumps a books hand when one more loss would miss the minimum', () => {
    const books = ['books', 'books', 'books', 'books'] as const;
    // Minimum 4. Side 0 has 1 book and 3 tricks left: 4 − 1 === 3. Side 1 already has the minimum.
    expect(sidesOneTrickFromShot(at({ handNo: 1, bids: books, tricksWon: [1, 3, 0, 6], played: 10 }))).toEqual([0]);
    // Two books with seven left: they can still lose one and reach 4.
    expect(sidesOneTrickFromShot(at({ handNo: 1, bids: books, tricksWon: [1, 2, 1, 2], played: 6 }))).toEqual([]);
    // Already short: 3 books still needed and only 1 trick left.
    expect(sidesOneTrickFromShot(at({ handNo: 1, bids: books, tricksWon: [1, 5, 0, 6], played: 12 }))).toEqual([]);
    // Minimum off: the books hand is not a shot, so there is nothing to rack for.
    expect(sidesOneTrickFromShot(at({
      handNo: 1, rules: cutthroat, bids: ['books', 'books', 'books'], tricksWon: [0, 8, 8], played: 16,
    }))).toEqual([]);
    // Cutthroat with a minimum: that player has 3 of 4, and one trick is left.
    expect(sidesOneTrickFromShot(at({
      handNo: 1,
      rules: makeRules('cutthroat', { playerCount: 3, firstHandMin: 4 }),
      bids: ['books', 'books', 'books'],
      tricksWon: [7, 6, 3],
      played: 16,
    }))).toEqual([2]);
    const before = at({ handNo: 1, bids: books, tricksWon: [1, 2, 0, 4], played: 7 });
    const after = at({ handNo: 1, bids: books, tricksWon: [1, 5, 0, 4], played: 10 });
    expect(newlyOneTrickFromShot(before, after, new Set())).toEqual([0]);
    expect(newlyOneTrickFromShot(after, after, new Set([0]))).toEqual([]);
  });

  it('plays on the transition into the window, once per side per hand', () => {
    const safe = at({ bids: [3, 5, 3, 4], tricksWon: [2, 3, 2, 3], played: 10 }); // side 0 needs 2 with 3 left; side 1 needs 3 with 3 left
    const edge = at({ bids: [3, 5, 3, 4], tricksWon: [2, 4, 2, 3], played: 11 }); // side 0 now needs 2 with 2 left; side 1 already was
    expect(newlyOneTrickFromShot(null, edge, new Set())).toEqual([]);
    expect(newlyOneTrickFromShot(safe, edge, new Set())).toEqual([0]);
    expect(newlyOneTrickFromShot(edge, edge, new Set([0]))).toEqual([]);
    const slipped = at({ bids: [3, 5, 3, 4], tricksWon: [2, 5, 2, 4], played: 13 });
    const back = at({ bids: [3, 5, 3, 4], tricksWon: [1, 3, 1, 4], played: 9 }); // side 0 needs 4 with 4 left, again
    expect(newlyOneTrickFromShot(slipped, back, new Set([0]))).toEqual([]);
    expect(newlyOneTrickFromShot(safe, { ...edge, handNo: 3 }, new Set())).toEqual([]);
  });
});
