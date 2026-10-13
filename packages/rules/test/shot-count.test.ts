import { describe, expect, it } from 'vitest';
import { type Bid, type GameResult, makeRules, scoreHand, shotCounts, shotCovers, shotOutResult, shotOutSides } from '../src';

const joker = makeRules('joker');
const cutthroat = makeRules('cutthroat', { playerCount: 3 });

function hand(rules: ReturnType<typeof makeRules>, bids: Bid[], tricks: number[], handNo = 1) {
  const n = rules.partnerships ? 2 : rules.playerCount;
  return { handNo, bids, sides: scoreHand(rules, bids, tricks, Array(n).fill(0), Array(n).fill(0)) };
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

describe('shotCovers', () => {
  const books = ['books', 'books', 'books', 'books'] as const;

  it('a recorded shot-out is the sheet and the siren, with no tape', () => {
    expect(shotOutSides(joker, 1, [false, true], [false, false])).toEqual([1]);
    expect(shotOutResult([-30, 80], [1])).toMatchObject({ endReason: 'shotOut', shotOut: [1] });
    const short = hand(joker, [...books], [5, 2, 5, 1], 1); // side 1: 3 books
    expect(shotCovers(joker, [short])[1]).toEqual({ tape: false, sheet: true, siren: true });
    expect(shotCovers(joker, [short])[0]).toEqual({ tape: false, sheet: false, siren: false });
    const ace = makeRules('aceDown');
    expect(shotCovers(ace, [hand(ace, [...books], [5, 2, 5, 1], 1)])[1]).toEqual({ tape: false, sheet: true, siren: true });
    const playedOn: GameResult = { endReason: 'target', finalScores: [-30, 80], placements: [2, 1], winners: [1] };
    expect(shotCovers(joker, [short], null)[1]).toEqual({ tape: true, sheet: false, siren: false });
    expect(shotCovers(joker, [short], playedOn)[1]).toEqual({ tape: true, sheet: false, siren: false });
    const lost: GameResult = { endReason: 'shotOut', shotOut: [1], finalScores: [-30, 80], placements: [2, 1], winners: [0] };
    expect(shotCovers(joker, [short], lost)[1]).toEqual({ tape: false, sheet: true, siren: true });
    expect(shotOutSides({ ...joker, shotOut: false }, 1, [false, true], [false, false])).toEqual([]);
    expect(shotCovers({ ...joker, shotOut: false }, [short])[1]).toEqual({ tape: true, sheet: false, siren: false });
  });

  it('tapes a later shot and pulls the tape off when they make their books', () => {
    const clear = hand(joker, [...books], [4, 4, 4, 1], 1);
    const set = hand(joker, [4, 5, 2, 3], [4, 1, 2, 2], 2); // side 1 bid 8, took 3
    const made = hand(joker, [3, 3, 3, 3], [3, 3, 3, 4], 3);
    expect(shotCovers(joker, [clear, set])[1]).toEqual({ tape: true, sheet: false, siren: false });
    expect(shotCovers(joker, [clear, set, made])[1]).toEqual({ tape: false, sheet: false, siren: false });
  });

  it('a shot while the previous hand was a shot is the loss: sheet, no tape', () => {
    const clear = hand(joker, [...books], [4, 4, 4, 1], 1);
    const set = hand(joker, [4, 5, 2, 3], [4, 1, 2, 2], 2);
    const again = hand(joker, [3, 4, 3, 4], [4, 1, 3, 1], 3);
    expect(shotOutSides(joker, 3, [false, true], [false, true])).toEqual([1]);
    expect(shotCovers(joker, [clear, set, again])[1]).toEqual({ tape: false, sheet: true, siren: true });
    expect(shotCovers(joker, [clear, set, again])[0]).toEqual({ tape: false, sheet: false, siren: false });
  });

  it('a hand that is not a shot and does not make books leaves the tape up, and does not count as the loss', () => {
    const clear = hand(joker, [...books], [4, 4, 4, 1], 1);
    const set = hand(joker, [4, 5, 2, 3], [4, 1, 2, 2], 2);
    const nils = hand(joker, ['nil', 'nil', 'nil', 'nil'], [0, 0, 0, 0], 3);
    const later = hand(joker, [3, 4, 3, 4], [3, 1, 3, 2], 4);
    expect(shotCovers(joker, [clear, set, nils])[1]).toEqual({ tape: true, sheet: false, siren: false });
    expect(shotOutSides(joker, 4, [false, true], [false, false])).toEqual([]);
    expect(shotCovers(joker, [clear, set, nils, later])[1]).toEqual({ tape: true, sheet: false, siren: false });
  });

  it('tapes one Cutthroat player, and sheets that player when the next hand shoots them too', () => {
    const set = hand(cutthroat, [6, 4, 5], [2, 5, 8], 2);
    expect(shotCovers(cutthroat, [hand(cutthroat, [4, 4, 4], [4, 4, 5], 1), set])[0]).toEqual({ tape: true, sheet: false, siren: false });
    const again = hand(cutthroat, [5, 4, 4], [1, 6, 6], 3);
    expect(shotCovers(cutthroat, [hand(cutthroat, [4, 4, 4], [4, 4, 5], 1), set, again])[0]).toEqual({ tape: false, sheet: true, siren: true });
  });
});
