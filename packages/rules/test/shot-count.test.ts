import { describe, expect, it } from 'vitest';
import { type Bid, makeRules, scoreHand, shotCounts } from '../src';

const joker = makeRules('joker');
const cutthroat = makeRules('cutthroat', { playerCount: 3 });

function hand(rules: ReturnType<typeof makeRules>, bids: Bid[], tricks: number[]) {
  const n = rules.partnerships ? 2 : rules.playerCount;
  return { bids, sides: scoreHand(rules, bids, tricks, Array(n).fill(0), Array(n).fill(0)) };
}

describe('shotCounts', () => {
  it('counts each set, and a made contract does not add one', () => {
    const set = hand(joker, [4, 3, 2, 3], [1, 4, 2, 6]); // side 0 bid 6, took 3
    const made = hand(joker, [3, 3, 2, 3], [3, 3, 2, 5]);
    expect(shotCounts(joker, [set])).toEqual([1, 0]);
    expect(shotCounts(joker, [set, set])).toEqual([2, 0]);
    expect(shotCounts(joker, [set, made])).toEqual([1, 0]);
    expect(shotCounts(joker, [made, made])).toEqual([0, 0]);
  });

  it('a busted nil alone is not a shot', () => {
    const nil = hand(joker, ['nil', 3, 4, 3], [1, 4, 4, 4]);
    expect(nil.sides[0]!.nils[0]!.made).toBe(false);
    expect(shotCounts(joker, [nil])).toEqual([0, 0]);
    const nilAndSet = hand(joker, ['nil', 6, 3, 2], [1, 1, 4, 2]); // side 0 nil bust, partner made; side 1 bid 8, took 3
    expect(shotCounts(joker, [nilAndSet])).toEqual([0, 1]);
  });

  it('a books hand counts only when it misses the first-hand minimum', () => {
    const books = ['books', 'books', 'books', 'books'] as const;
    const short = hand(joker, [...books], [2, 5, 1, 5]); // side 0: 3 books
    expect(shotCounts(joker, [short])).toEqual([1, 0]);
    const clear = hand(joker, [...books], [2, 4, 2, 5]); // side 0: 4
    expect(shotCounts(joker, [clear])).toEqual([0, 0]);
    expect(shotCounts({ ...joker, firstHandMin: null }, [short])).toEqual([0, 0]);
  });

  it('counts each Cutthroat player on their own', () => {
    const one = hand(cutthroat, [6, 4, 5], [2, 5, 8]);
    expect(shotCounts(cutthroat, [one])).toEqual([1, 0, 0]);
    const again = hand(cutthroat, [5, 5, 4], [1, 6, 6]);
    expect(shotCounts(cutthroat, [one, again])).toEqual([2, 0, 0]);
    const nil = hand(cutthroat, ['nil', 4, 3], [2, 5, 4]);
    expect(shotCounts(cutthroat, [nil])).toEqual([0, 0, 0]);
  });
});
