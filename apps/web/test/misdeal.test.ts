import { describe, expect, it } from 'vitest';
import { applyAction, makeRules, newGame, viewFor, type GameState } from '@spades/rules';
import { MISDEAL_REVEAL_MS, MISDEAL_REVEAL_REDUCED_MS, misdealRevealKey, misdealRevealMs } from '../src/misdeal';
import { rotateView } from '../src/online/rotate';

/** A game where seat 0 was dealt no spades at all (scanning seeds). */
function spadeLessGame(): GameState {
  const rules = makeRules('joker', { firstHandBidsItself: false });
  for (let i = 0; i < 500; i++) {
    const st = newGame(rules, `misdeal-web-${i}`);
    if (st.phase === 'bidding' && !st.hands[0]!.some((c) => c === 'BJ' || c === 'LJ' || c.endsWith('S') || c === '2D')) return st;
  }
  throw new Error('no spade-less deal found');
}

describe('misdeal reveal beat', () => {
  it('holds 1.8s for the table to read, 0.6s snap under reduced motion', () => {
    expect(MISDEAL_REVEAL_MS).toBe(1800);
    expect(MISDEAL_REVEAL_REDUCED_MS).toBe(600);
    expect(misdealRevealMs(false)).toBe(1800);
    expect(misdealRevealMs(true)).toBe(600);
  });

  it('keys each thrown hand once', () => {
    const reveal = { seat: 2, cards: ['3C', '4H'] };
    expect(misdealRevealKey(5, reveal)).toBe('5:2:3C.4H');
    expect(misdealRevealKey(5, null)).toBeNull();
    expect(misdealRevealKey(5, undefined)).toBeNull();
  });

  it('online rotation: the thrown hand reaches every viewer with the caller in their frame', () => {
    const st = spadeLessGame();
    const thrown = [...st.hands[0]!];
    const next = applyAction(st, { type: 'misdeal', seat: 0 });
    for (let viewer = 0; viewer < 4; viewer++) {
      const { view } = rotateView(viewFor(next, viewer));
      // public cards unchanged; the caller's seat rotates into the viewer's local frame
      expect(view.misdealReveal).toEqual({ seat: (0 - viewer + 4) % 4, cards: thrown });
    }
  });
});
