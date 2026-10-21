import { describe, expect, it } from 'vitest';
import { dealFirstHand, makeRules, newGame, newGameUndealt } from '../src/index';

describe('pre-deal: undealt game + first deal', () => {
  it('newGameUndealt is a game shell: hand 0, empty hands, no turn, no bids', () => {
    const rules = makeRules('joker');
    const g = newGameUndealt(rules, 'seed-1');
    expect(g.handNo).toBe(0);
    expect(g.phase).toBe('bidding');
    expect(g.turn).toBeNull();
    expect(g.hands).toEqual([[], [], [], []]);
    expect(g.bids).toEqual([null, null, null, null]);
    expect(g.tricksWon).toEqual([0, 0, 0, 0]);
    expect(g.history).toEqual([]);
  });

  it('dealFirstHand deals EXACTLY the hand newGame would have dealt (same seed + dealer)', () => {
    for (const rules of [makeRules('joker'), makeRules('cutthroat'), makeRules('joker', { deck: 'joker54' })]) {
      const dealt = newGame(rules, 'seed-xyz', { dealer: 2 });
      const waited = dealFirstHand(newGameUndealt(rules, 'seed-xyz', { dealer: 2 }));
      expect(waited).toEqual(dealt);
      expect(waited.handNo).toBe(1);
      expect(waited.hands.every((h) => h.length === 13)).toBe(true);
      expect(waited.turn).not.toBeNull();
    }
  });

  it('the dealer RNG also matches when no dealer is pinned', () => {
    const rules = makeRules('joker');
    expect(dealFirstHand(newGameUndealt(rules, 'seed-abc'))).toEqual(newGame(rules, 'seed-abc'));
  });

  it('dealFirstHand on an already-dealt game is a no-op (no double deal)', () => {
    const rules = makeRules('joker');
    const g = newGame(rules, 'seed-1');
    expect(dealFirstHand(g)).toBe(g);
    expect(g.handNo).toBe(1);
  });
});
