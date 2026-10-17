import { describe, expect, it } from 'vitest';
import { makeRules } from '@spades/rules';
import { simulateGame } from '../src';

describe('bots never call a misdeal on their own', () => {
  it('full bot games (team + Cutthroat) emit no misdeal action and never stall on a spade-less bot', () => {
    const seen: string[] = [];
    for (const rules of [makeRules('joker'), makeRules('cutthroat'), makeRules('cutthroat', { playerCount: 3 })]) {
      for (const seed of ['m1', 'm2', 'm3']) {
        const st = simulateGame(rules, seed, { onAction: (_, a) => seen.push(a.type) });
        expect(st.phase).toBe('gameOver');
      }
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(seen).not.toContain('misdeal');
  });
});
