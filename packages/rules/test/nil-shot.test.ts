import { describe, expect, it } from 'vitest';
import { type Card, type GameState, applyAction, isBooksHand, isShot, makeRules, newGame, nilBustsJustResolved, scoreHand, shotCovers, shotOutSides } from '../src';

const team = makeRules('joker', { firstHandBidsItself: false, targetScore: 500, losingFloor: null });

/** Finish a 13-book hand on the last trick. Seat 0 leads the ace of clubs and wins that book. */
function lastTrick(base: GameState, won: number[]): GameState {
  const before = [...won];
  before[0] = (before[0] ?? 0) - 1;
  const hands = [['AC'], ['KC'], ['QC'], ['JC']] as Card[][];
  let st: GameState = {
    ...base, phase: 'playing', hands, tricksWon: before, spadesBroken: true,
    revealed: [true, true, true, true],
    tricks: Array.from({ length: 12 }, () => ({ leader: 1, plays: [], winner: 1 })),
    trick: { leader: 0, plays: [], winner: null }, turn: 0,
  };
  for (let k = 0; k < 4; k++) {
    const seat = st.turn!;
    st = applyAction(st, { type: 'play', seat, card: st.hands[seat]![0]! });
  }
  return st;
}

describe('2v2 busted Nil is a shot', () => {
  it('a busted Nil is a shot even when the partner makes the number', () => {
    const bids = ['nil', 3, 4, 3] as const;
    const bust = scoreHand(team, [...bids], [1, 4, 4, 4], [0, 0], [0, 0]);
    expect(bust[0]).toMatchObject({ contractMade: true, nils: [{ made: false, tricks: 1 }] });
    expect(isShot(team, [...bids], bust[0]!)).toBe(true);
    expect(isShot(team, [...bids], bust[1]!)).toBe(false);
    const blind = scoreHand(team, ['blindNil', 3, 4, 3], [2, 4, 4, 3], [0, 0], [0, 0]);
    expect(isShot(team, ['blindNil', 3, 4, 3], blind[0]!)).toBe(true);
    const hand = { handNo: 2, bids: [...bids], sides: bust };
    expect(shotOutSides(team, 2, [true, false], [false, false])).toEqual([]);
    expect(shotCovers(team, [hand])[0]).toEqual({ tape: true, sheet: false, siren: false, outHand: null });
  });

  it('a made Nil does not count', () => {
    const bids = ['nil', 3, 4, 3] as const;
    const made = scoreHand(team, [...bids], [0, 4, 5, 4], [0, 0], [0, 0]);
    expect(made[0]!.nils[0]!.made).toBe(true);
    expect(isShot(team, [...bids], made[0]!)).toBe(false);
    expect(shotCovers(team, [{ handNo: 2, bids: [...bids], sides: made }])[0]).toEqual({ tape: false, sheet: false, siren: false, outHand: null });
    const taped = scoreHand(team, [5, 3, 2, 4], [1, 4, 1, 4], [0, 0], [0, 0]);
    const safe = scoreHand(team, ['nil', 3, 4, 3], [0, 4, 5, 4], taped.map((s) => s.totalScore), [0, 0]);
    expect(isShot(team, ['nil', 3, 4, 3], safe[0]!)).toBe(false);
    expect(shotCovers(team, [
      { handNo: 2, bids: [5, 3, 2, 4], sides: taped },
      { handNo: 3, bids: ['nil', 3, 4, 3], sides: safe },
    ])[0]).toEqual({ tape: false, sheet: false, siren: false, outHand: null });
    const mixedBids = ['nil', 4, 2, 4] as const;
    const mixed = scoreHand(team, [...mixedBids], [0, 4, 1, 4], [0, 0], [0, 0]);
    expect(mixed[0]!.nils[0]!.made).toBe(true);
    expect(isShot(team, [...mixedBids], mixed[0]!)).toBe(true);
    expect(shotCovers(team, [{ handNo: 2, bids: [...mixedBids], sides: mixed }])[0]).toEqual({ tape: true, sheet: false, siren: false, outHand: null });
    const cut = makeRules('cutthroat', { playerCount: 4, firstHandBidsItself: false });
    const alone = scoreHand(cut, ['nil', 4, 3, 3], [1, 4, 4, 4], [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(isShot(cut, ['nil', 4, 3, 3], alone[0]!)).toBe(false);
  });

  it('a busted Nil while the tape is already on loses', () => {
    const setBids = [4, 5, 2, 3] as const;
    const set = scoreHand(team, [...setBids], [4, 1, 2, 2], [0, 0], [0, 0]);
    const nilBids = [3, 'nil', 4, 4] as const;
    const bust = scoreHand(team, [...nilBids], [4, 1, 4, 4], set.map((s) => s.totalScore), [0, 0]);
    expect(isShot(team, [...nilBids], bust[1]!)).toBe(true);
    expect(shotOutSides(team, 3, [false, true], [false, true])).toEqual([1]);
    const covers = shotCovers(team, [
      { handNo: 2, bids: [...setBids], sides: set },
      { handNo: 3, bids: [...nilBids], sides: bust },
    ]);
    expect(covers[1]).toEqual({ tape: false, sheet: true, siren: true, outHand: 3 });
    expect(covers[0]).toEqual({ tape: false, sheet: false, siren: false, outHand: null });
  });

  it('the default books hand has no Nil; with bidding on, a hand-1 bust is an instant loss', () => {
    const books = makeRules('joker');
    expect(books.firstHandBidsItself).toBe(true);
    expect(isBooksHand(['books', 'books', 'books', 'books'])).toBe(true);
    let st = newGame(team, 'nil-hand-1', { dealer: 0 });
    expect(st.handNo).toBe(1);
    st = { ...st, bids: ['nil', 4, 3, 3] };
    st = lastTrick(st, [1, 4, 4, 4]);
    expect(st.phase).toBe('gameOver');
    expect(st.result).toMatchObject({ endReason: 'shotOut', shotOut: [0] });
    expect(st.history[0]!.sides[0]).toMatchObject({ shot: true, nils: [{ made: false }] });
    expect(shotCovers(team, st.history, st.result)[0]).toEqual({ tape: true, sheet: true, siren: true, outHand: 1 });

    st = newGame(team, 'nil-hand-2', { dealer: 0 });
    st = { ...st, handNo: 2, bids: ['nil', 4, 3, 3] };
    st = lastTrick(st, [1, 4, 4, 4]);
    expect(st.phase).toBe('handOver');
    expect(st.result).toBeNull();
    expect(st.history[0]!.sides[0]!.shot).toBe(true);
    expect(shotCovers(team, st.history, st.result)[0]).toEqual({ tape: true, sheet: false, siren: false, outHand: null });
  });
});

describe('shotgun when a Nil takes its first book', () => {
  const rules = team;
  type Snap = Parameters<typeof nilBustsJustResolved>[1];
  function hand(tricksWon: number[], winners: number[], bids: Snap['bids'] = ['nil', 3, 4, 3]): Snap {
    return { seed: 'nil-boom', handNo: 2, rules, bids, tricksWon, tricks: winners.map((winner) => ({ winner })) };
  }

  it('fires for the Nil bidder when the trick they take resolves, and only that once', () => {
    const before = hand([0, 2, 2, 2], [1, 2, 1, 2, 3, 2]);
    const bust = hand([1, 2, 2, 2], [1, 2, 1, 2, 3, 2, 0]);
    expect(nilBustsJustResolved(before, bust, new Set())).toEqual([0]);
    expect(nilBustsJustResolved(bust, bust, new Set([0]))).toEqual([]);
    const again = hand([2, 2, 2, 1], [1, 2, 1, 2, 3, 2, 0, 0]);
    expect(nilBustsJustResolved(bust, again, new Set())).toEqual([]);
    expect(nilBustsJustResolved(null, bust, new Set())).toEqual([]);
    expect(nilBustsJustResolved(before, { ...bust, handNo: 3 }, new Set())).toEqual([]);
    expect(nilBustsJustResolved(before, { ...bust, seed: 'other' }, new Set())).toEqual([]);
  });

  it('stays quiet while the Nil is still good, and fires once for each Nil bidder who takes a book', () => {
    const before = hand([0, 1, 1, 1], [1, 2, 3]);
    expect(nilBustsJustResolved(before, hand([0, 1, 2, 1], [1, 2, 3, 2]), new Set())).toEqual([]);
    expect(nilBustsJustResolved(before, before, new Set())).toEqual([]);
    const blind = hand([0, 2, 2, 2], [1, 2, 1, 2, 3, 2], ['blindNil', 3, 4, 3]);
    expect(nilBustsJustResolved(blind, hand([1, 2, 2, 2], [1, 2, 1, 2, 3, 2, 0], ['blindNil', 3, 4, 3]), new Set())).toEqual([0]);
    const both = hand([0, 1, 0, 1], [1, 3], ['nil', 4, 'nil', 3]);
    const first = hand([0, 1, 1, 1], [1, 3, 2], ['nil', 4, 'nil', 3]);
    const second = hand([1, 1, 1, 1], [1, 3, 2, 0], ['nil', 4, 'nil', 3]);
    expect(nilBustsJustResolved(both, first, new Set())).toEqual([2]);
    expect(nilBustsJustResolved(first, second, new Set([2]))).toEqual([0]);
    const batch = hand([1, 1, 1, 1], [1, 3, 2, 0], ['nil', 4, 'nil', 3]);
    expect(nilBustsJustResolved(both, batch, new Set())).toEqual([2, 0]);
    const ran = hand([3, 1, 1, 1], [1, 3, 0, 0, 0]);
    expect(nilBustsJustResolved(hand([0, 1, 1, 1], [1, 3]), ran, new Set())).toEqual([0]);
  });

  it('does not fire in Cutthroat or on a number bid', () => {
    const cut = makeRules('cutthroat', { playerCount: 4, firstHandBidsItself: false });
    const before = { seed: 'c', handNo: 2, rules: cut, bids: ['nil', 4, 3, 3] as const, tricksWon: [0, 2, 2, 2], tricks: [{ winner: 1 }, { winner: 2 }] };
    const after = { ...before, tricksWon: [1, 2, 2, 2], tricks: [...before.tricks, { winner: 0 }] };
    expect(nilBustsJustResolved(before, after, new Set())).toEqual([]);
    const num = hand([0, 0, 1, 1], [2, 3]);
    expect(nilBustsJustResolved(num, hand([0, 1, 1, 1], [2, 3, 1]), new Set())).toEqual([]);
  });
});
