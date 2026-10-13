import { describe, expect, it } from 'vitest';
import { type Card, type GameState, applyAction, isBooksHand, isShot, makeRules, newGame, scoreHand, shotCovers, shotOutSides } from '../src';

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
    expect(shotCovers(team, [hand])[0]).toEqual({ tape: true, sheet: false, siren: false });
  });

  it('a made Nil does not count', () => {
    const bids = ['nil', 3, 4, 3] as const;
    const made = scoreHand(team, [...bids], [0, 4, 5, 4], [0, 0], [0, 0]);
    expect(made[0]!.nils[0]!.made).toBe(true);
    expect(isShot(team, [...bids], made[0]!)).toBe(false);
    expect(shotCovers(team, [{ handNo: 2, bids: [...bids], sides: made }])[0]).toEqual({ tape: false, sheet: false, siren: false });
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
    expect(covers[1]).toEqual({ tape: false, sheet: true, siren: true });
    expect(covers[0]).toEqual({ tape: false, sheet: false, siren: false });
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
    expect(shotCovers(team, st.history, st.result)[0]).toEqual({ tape: true, sheet: true, siren: true });

    st = newGame(team, 'nil-hand-2', { dealer: 0 });
    st = { ...st, handNo: 2, bids: ['nil', 4, 3, 3] };
    st = lastTrick(st, [1, 4, 4, 4]);
    expect(st.phase).toBe('handOver');
    expect(st.result).toBeNull();
    expect(st.history[0]!.sides[0]!.shot).toBe(true);
    expect(shotCovers(team, st.history, st.result)[0]).toEqual({ tape: true, sheet: false, siren: false });
  });
});
