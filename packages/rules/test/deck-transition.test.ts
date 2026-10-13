import { describe, expect, it } from 'vitest';
import {
  type GameState, RulesConfigError, applyAction, legalPlays, makeRules, minimumFits, newGame, removedForActive, tricksForActive, viewFor,
} from '../src';

const ct = makeRules('cutthroat', { playerCount: 4, minTeamBid: 1, targetScore: 300 });

function pile(st: GameState): string[] {
  return [...st.hands.flat(), ...(st.undealt ?? [])];
}

/** Bid 1 and play the first legal card until the hand is over. */
function playOut(st: GameState): GameState {
  for (let guard = 0; st.phase !== 'handOver' && st.phase !== 'gameOver' && guard < 800; guard++) {
    if (st.phase === 'bidding') {
      st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 1 });
      continue;
    }
    const seat = st.turn!;
    st = applyAction(st, { type: 'play', seat, card: legalPlays(st, seat)[0]! });
  }
  return st;
}

describe('Cutthroat deck transitions', () => {
  it('checks the host minimum against 13 and 17 books', () => {
    expect(tricksForActive(4)).toBe(13);
    expect(tricksForActive(3)).toBe(17);
    expect(tricksForActive(2)).toBe(13);
    expect(minimumFits(ct, 13)).toBe(true);
    expect(minimumFits(ct, 17)).toBe(true);
    expect(minimumFits({ ...ct, minTeamBid: 13 }, 13)).toBe(true);
    expect(minimumFits({ ...ct, minTeamBid: 14 }, 13)).toBe(false);
    expect(minimumFits({ ...ct, minTeamBid: 14 }, 17)).toBe(true);
    expect(minimumFits({ ...ct, minTeamBid: 18 }, 17)).toBe(false);
    expect(() => makeRules('cutthroat', { minTeamBid: 14 })).toThrow(RulesConfigError);
    expect(() => makeRules('cutthroat', { playerCount: 3, minTeamBid: 18 })).toThrow(RulesConfigError);
    expect(removedForActive(ct, 4)).toEqual(['2C', '2H']);
    expect(removedForActive(ct, 3)).toEqual(['2C', '2H', '3C']);
    expect(removedForActive(ct, 2)).toEqual(['2C', '2H']);
  });

  it('deals 13, then 17 without the 3♣, then 13 with 26 face down, and keeps the game', () => {
    let st = newGame(ct, 'deck-4-3-2', { dealer: 0 });
    expect(st.handNo).toBe(1);
    expect(st.hands.every((h) => h.length === 13)).toBe(true);
    expect(st.hands.flat()).toHaveLength(52);
    expect(st.hands.flat()).not.toContain('2C');
    expect(st.hands.flat()).not.toContain('2H');
    expect(st.hands.flat()).toContain('3C');
    expect(st.hands.flat()).toContain('BJ');
    expect(st.hands.flat()).toContain('LJ');
    expect(st.rules.removedCards).toEqual(['2C', '2H']);
    expect(() => applyAction(st, { type: 'nextHand' })).toThrow(/not over/);

    const scores = [10, 20, 30, 40];
    const failStreak = [0, 1, 0, 0];
    const history = st.history;
    st = applyAction({
      ...st, phase: 'handOver', scores, failStreak, eliminated: [true, false, false, false], result: null,
    }, { type: 'nextHand' });
    expect(st.handNo).toBe(2);
    expect(st.scores).toEqual(scores);
    expect(st.failStreak).toEqual(failStreak);
    expect(st.eliminated).toEqual([true, false, false, false]);
    expect(st.history).toBe(history);
    expect(st.rules.removedCards).toEqual(['2C', '2H']);
    expect(st.hands[0]).toEqual([]);
    expect(st.hands[1]).toHaveLength(17);
    expect(st.hands[2]).toHaveLength(17);
    expect(st.hands[3]).toHaveLength(17);
    expect(st.trickCount).toBe(17);
    expect(st.undealt).toBeUndefined();
    const three = st.hands.flat();
    expect(three).toHaveLength(51);
    expect(three).not.toContain('2C');
    expect(three).not.toContain('2H');
    expect(three).not.toContain('3C');
    expect(three).toContain('BJ');
    expect(three).toContain('LJ');
    expect(st.turn).not.toBe(0);
    expect(() => applyAction(st, { type: 'bid', seat: 0, bid: 1 })).toThrow(/out of this game/);

    st = playOut(st);
    expect(st.phase).toBe('handOver');
    expect(st.handNo).toBe(2);
    expect(st.tricks).toHaveLength(17);
    expect(st.tricks.every((t) => t.plays.length === 3)).toBe(true);
    expect(st.failStreak?.[0]).toBe(0);
    const scoredStreak = [...st.failStreak!];
    expect(st.history).toHaveLength(history.length + 1);
    expect(st.scores[0]).toBe(scores[0]);

    const keptScores = [...st.scores];
    const keptHistory = st.history;
    st = applyAction({ ...st, eliminated: [true, true, false, false] }, { type: 'nextHand' });
    expect(st.handNo).toBe(3);
    expect(st.scores).toEqual(keptScores);
    expect(st.failStreak).toEqual(scoredStreak);
    expect(st.history).toBe(keptHistory);
    expect(st.rules.removedCards).toEqual(['2C', '2H']);
    expect(st.hands[0]).toEqual([]);
    expect(st.hands[1]).toEqual([]);
    expect(st.hands[2]).toHaveLength(13);
    expect(st.hands[3]).toHaveLength(13);
    expect(st.undealt).toHaveLength(26);
    expect(st.trickCount).toBe(13);
    const two = pile(st);
    expect(two).toHaveLength(52);
    expect(two).not.toContain('2C');
    expect(two).not.toContain('2H');
    expect(two).toContain('3C');
    expect(two).toContain('BJ');
    expect(two).toContain('LJ');
    expect(new Set(two).size).toBe(52);
    const view = viewFor(st, 2);
    expect(JSON.stringify(view)).not.toContain('"undealt"');
    expect(view.hand).toHaveLength(13);
    for (const card of st.undealt!) expect(view.hand).not.toContain(card);
    expect(view.handCounts).toEqual([0, 0, 13, 13]);
  });

  it('refuses a minimum the short hand cannot reach', () => {
    const high = makeRules('cutthroat', { playerCount: 3, minTeamBid: 14, firstHandBidsItself: false });
    let st = newGame(high, 'too-high', { dealer: 0 });
    expect(st.hands.every((h) => h.length === 17)).toBe(true);
    st = { ...st, phase: 'handOver', eliminated: [true, false, false] };
    expect(() => applyAction(st, { type: 'nextHand' })).toThrow(/13/);
  });
});
