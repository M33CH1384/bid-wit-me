import { describe, expect, it } from 'vitest';
import {
  type Bid, type Card, type GameState, RulesConfigError, applyAction, hostMinimum, makeRules, minimumFits, newGame, shotCovers, viewFor,
} from '../src';

const ct = makeRules('cutthroat', { playerCount: 4, minTeamBid: 1, targetScore: 300 });
const clubs = ['AC', 'KC', 'QC', 'JC', 'TC', '9C'] as Card[];

/** Finish the current hand by playing one last trick. `finalWon` is the book count after that trick. */
function closeHand(base: GameState, finalWon: number[], bids: readonly Bid[], winner = 0): GameState {
  const n = base.rules.playerCount;
  const books = base.trickCount ?? (n === 3 ? 17 : 13);
  const won = [...finalWon];
  won[winner] = (won[winner] ?? 0) - 1;
  if (won.reduce((a, b) => a + b, 0) !== books - 1) throw new Error(`books ${won.join('+')} !== ${books - 1}`);
  const out = base.eliminated ?? [];
  const hands = Array.from({ length: n }, (_, i) => (out[i] ? [] : [i === winner ? clubs[0]! : clubs[i + 1]!]));
  let st: GameState = {
    ...base, phase: 'playing', bids: [...bids], hands, tricksWon: won,
    tricks: Array.from({ length: books - 1 }, () => ({ leader: winner, plays: [], winner })),
    trick: { leader: winner, plays: [], winner: null }, turn: winner, spadesBroken: true,
    revealed: Array(n).fill(true),
  };
  const live = hands.filter((h) => h.length > 0).length;
  for (let k = 0; k < live; k++) {
    const seat = st.turn!;
    st = applyAction(st, { type: 'play', seat, card: st.hands[seat]![0]! });
  }
  return st;
}

describe('Cutthroat elimination', () => {
  it('checks the minimum against the tricks in the hand', () => {
    expect(hostMinimum(ct)).toBe(1);
    expect(hostMinimum(makeRules('cutthroat', { minTeamBid: 4 }))).toBe(4);
    expect(minimumFits(ct, 13)).toBe(true);
    expect(minimumFits(ct, 17)).toBe(true);
    expect(minimumFits(makeRules('cutthroat', { minTeamBid: 4 }), 13)).toBe(true);
    expect(minimumFits(makeRules('cutthroat', { minTeamBid: 4 }), 3)).toBe(false);
    expect(() => makeRules('cutthroat', { minTeamBid: 14 })).toThrow(RulesConfigError);
    expect(() => makeRules('cutthroat', { playerCount: 3, minTeamBid: 18 })).toThrow(RulesConfigError);
  });

  it('hand 1: fewer books than the minimum eliminates that player when the hand is scored', () => {
    let st = newGame(ct, 'h1');
    st = closeHand(st, [0, 5, 4, 4], ['books', 'books', 'books', 'books'], 1);
    expect(st.phase).toBe('handOver');
    expect(st.handNo).toBe(1);
    expect(st.eliminated).toEqual([true, false, false, false]);
    expect(st.failStreak).toEqual([1, 0, 0, 0]);
    expect(st.history[0]!.sides[0]).toMatchObject({ tricks: 0, points: -10, out: true, shot: true });
    expect(st.history[0]!.sides[1]!.out).toBe(false);
    expect(shotCovers(ct, st.history, st.result)[0]).toEqual({ tape: true, sheet: true, siren: true });
    expect(shotCovers(ct, st.history, st.result)[1]).toEqual({ tape: false, sheet: false, siren: false });
    const score = st.scores[1];
    st = applyAction(st, { type: 'nextHand' });
    expect(st.handNo).toBe(2);
    expect(st.scores[1]).toBe(score);
    expect(st.eliminated?.[0]).toBe(true);
    expect(st.failStreak?.[0]).toBe(1);
    expect(st.hands[0]).toEqual([]);
    expect(st.hands[1]).toHaveLength(17);
    expect(st.hands[2]).toHaveLength(17);
    expect(st.hands[3]).toHaveLength(17);
    expect(st.undealt).toHaveLength(1);
    expect(st.turn).not.toBe(0);
    expect(() => applyAction({ ...st, turn: 0 }, { type: 'bid', seat: 0, bid: 1 })).toThrow(/out of this game/);
    expect(() => applyAction({ ...st, phase: 'playing', turn: 0 }, { type: 'play', seat: 0, card: 'AS' })).toThrow(/out of this game/);
    const v = viewFor(st, 1);
    expect(v.eliminated[0]).toBe(true);
    expect(v.failStreak[0]).toBe(1);
    expect(v.handNo).toBe(2);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(st.undealt));
  });

  it('from hand 2, two failed bids in a row eliminate, and a made bid resets the counter', () => {
    let st = newGame(ct, 'row');
    st = closeHand(st, [1, 4, 4, 4], ['books', 'books', 'books', 'books'], 1);
    expect(st.eliminated?.every((x) => !x)).toBe(true);
    expect(st.failStreak).toEqual([0, 0, 0, 0]);
    st = applyAction(st, { type: 'nextHand' });
    st = closeHand(st, [1, 4, 4, 4], [4, 3, 3, 3], 1);
    expect(st.phase).toBe('handOver');
    expect(st.handNo).toBe(2);
    expect(st.failStreak?.[0]).toBe(1);
    expect(st.eliminated?.[0]).toBe(false);
    expect(st.history.at(-1)!.sides[0]).toMatchObject({ points: -40, contract: 4, contractMade: false, shot: true, out: false });
    expect(shotCovers(ct, st.history, st.result)[0]).toEqual({ tape: true, sheet: false, siren: false });
    st = applyAction(st, { type: 'nextHand' });
    st = closeHand(st, [4, 3, 3, 3], [3, 3, 3, 3], 0);
    expect(st.failStreak?.[0]).toBe(0);
    expect(st.eliminated?.[0]).toBe(false);
    expect(shotCovers(ct, st.history, st.result)[0]).toEqual({ tape: false, sheet: false, siren: false });
    st = applyAction(st, { type: 'nextHand' });
    st = closeHand(st, [0, 5, 4, 4], [3, 3, 3, 3], 1);
    expect(st.handNo).toBe(4);
    expect(st.failStreak?.[0]).toBe(1);
    expect(st.eliminated?.[0]).toBe(false);
    st = applyAction(st, { type: 'nextHand' });
    st = closeHand(st, [0, 5, 4, 4], [2, 3, 4, 4], 1);
    expect(st.failStreak?.[0]).toBe(2);
    expect(st.eliminated?.[0]).toBe(true);
    expect(st.phase).toBe('handOver');
    expect(shotCovers(ct, st.history, st.result)[0]).toEqual({ tape: false, sheet: true, siren: true });
  });

  it('two players eliminated on the books hand stay out, and the hand number carries on', () => {
    let st = newGame(ct, 'both');
    st = closeHand(st, [0, 0, 6, 7], ['books', 'books', 'books', 'books'], 2);
    expect(st.eliminated).toEqual([true, true, false, false]);
    expect(st.phase).toBe('handOver');
    expect(st.scores[2]).toBe(60);
    expect(st.scores[3]).toBe(70);
    st = applyAction(st, { type: 'nextHand' });
    expect(st.handNo).toBe(2);
    expect(st.scores).toEqual([-10, -10, 60, 70]);
    expect(st.hands[2]).toHaveLength(13);
    expect(st.hands[3]).toHaveLength(13);
    expect(st.undealt).toHaveLength(26);
    expect(st.history).toHaveLength(1);
    expect(st.failStreak?.[0]).toBe(1);
  });

  it('when everyone left fails on the same hand, a tied score plays a tiebreaker', () => {
    let st = newGame(ct, 'last');
    st = closeHand(st, [0, 0, 6, 7], ['books', 'books', 'books', 'books'], 2);
    st = applyAction(st, { type: 'nextHand' });
    st = closeHand(st, [0, 0, 5, 8], [1, 1, 6, 9], 3);
    expect(st.failStreak?.[2]).toBe(1);
    expect(st.failStreak?.[3]).toBe(1);
    expect(st.eliminated?.[2]).toBe(false);
    st = applyAction(st, { type: 'nextHand' });
    st = { ...st, scores: [0, 0, 80, 80] };
    st = closeHand(st, [0, 0, 6, 7], [1, 1, 8, 8], 3);
    expect(st.phase).toBe('handOver');
    expect(st.scores[2]).toBe(0);
    expect(st.scores[3]).toBe(0);
    expect(st.eliminated?.[2]).toBe(false);
    expect(st.eliminated?.[3]).toBe(false);
    expect(st.eliminated?.[0]).toBe(true);
    st = applyAction(st, { type: 'nextHand' });
    expect(st.handNo).toBe(4);
    expect(st.phase).toBe('bidding');
    st = closeHand(st, [0, 0, 1, 12], [1, 1, 4, 3], 3);
    expect(st.eliminated?.[2]).toBe(true);
    expect(st.phase).toBe('gameOver');
    expect(st.result).toMatchObject({ winners: [3], endReason: 'shotOut' });
  });

  it('when everyone left is eliminated on the same hand, the higher score wins', () => {
    let st = newGame(ct, 'cmp');
    st = closeHand(st, [0, 0, 6, 7], ['books', 'books', 'books', 'books'], 2);
    st = applyAction(st, { type: 'nextHand' });
    st = closeHand(st, [0, 0, 5, 8], [1, 1, 6, 9], 3);
    st = applyAction(st, { type: 'nextHand' });
    st = { ...st, scores: [0, 0, 80, 50] };
    st = closeHand(st, [0, 0, 6, 7], [1, 1, 8, 8], 3);
    expect(st.phase).toBe('gameOver');
    expect(st.eliminated).toEqual([true, true, true, true]);
    expect(st.scores[2]).toBe(0);
    expect(st.scores[3]).toBe(-30);
    expect(st.result).toMatchObject({ winners: [2], endReason: 'shotOut' });
  });

  it('ends when one player is left, or when an active player reaches the host target', () => {
    const low = makeRules('cutthroat', { playerCount: 4, minTeamBid: 1, targetScore: 80, losingFloor: null });
    let st = newGame(low, 'one');
    st = closeHand(st, [13, 0, 0, 0], ['books', 'books', 'books', 'books'], 0);
    expect(st.phase).toBe('gameOver');
    expect(st.eliminated).toEqual([false, true, true, true]);
    expect(st.result).toMatchObject({ winners: [0], endReason: 'target', finalScores: [130, -10, -10, -10] });

    const race = makeRules('cutthroat', { playerCount: 4, minTeamBid: 1, targetScore: 100, firstHandBidsItself: false, losingFloor: null });
    let raceSt = newGame(race, 'race');
    raceSt = { ...raceSt, scores: [90, 140, 80, 200] };
    raceSt = closeHand(raceSt, [2, 4, 3, 4], [2, 3, 3, 4], 1);
    expect(raceSt.phase).toBe('gameOver');
    expect(raceSt.result!.endReason).toBe('target');
    expect(raceSt.result!.winners).toEqual([3]);
    expect(raceSt.result!.finalScores[3]).toBeGreaterThanOrEqual(100);
    expect(raceSt.result!.finalScores[1]).toBeGreaterThanOrEqual(100);

    let tied = newGame(race, 'tie-target');
    tied = { ...tied, scores: [0, 200, 0, 200] };
    tied = closeHand(tied, [3, 4, 2, 4], [2, 3, 2, 3], 1);
    expect(tied.phase).toBe('handOver');
    expect(tied.result).toBeNull();
    expect(tied.scores[1]).toBe(tied.scores[3]);
    expect(tied.scores[1]).toBeGreaterThanOrEqual(100);
  });
});
