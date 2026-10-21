import { describe, expect, it } from 'vitest';
import { applyAction, makeRules, newGame, viewFor, type GameState } from '@spades/rules';
import { MISDEAL_DEAL_SPEED, MISDEAL_REVEAL_MS, MISDEAL_REVEAL_REDUCED_MS, misdealDealMs, misdealRevealKey, misdealRevealMs, misdealSequenceMs } from '../src/misdeal';
import { dealTimeline } from '../src/three/dealTimeline';
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

describe('misdeal redeal sequence', () => {
  it('announces + gathers for 1.2s, 0.6s snap under reduced motion', () => {
    expect(MISDEAL_REVEAL_MS).toBe(1200);
    expect(MISDEAL_REVEAL_REDUCED_MS).toBe(600);
    expect(misdealRevealMs(false)).toBe(1200);
    expect(misdealRevealMs(true)).toBe(600);
  });

  it('the redeal deals out on the normal deal timeline, a touch brisker', () => {
    expect(MISDEAL_DEAL_SPEED).toBe(0.7);
    expect(misdealDealMs(1, 4, 52)).toBe(dealTimeline(0.7, 4, 52).total * 1000 + 150);
    expect(misdealDealMs(1, 4, 52)).toBeLessThan(dealTimeline(1, 4, 52).total * 1000 + 150);
  });

  it('the full moment lands near three seconds; reduced motion is announcement + swap only', () => {
    const total = misdealSequenceMs(1, 4, 52, false);
    expect(total).toBe(MISDEAL_REVEAL_MS + misdealDealMs(1, 4, 52));
    expect(total).toBeGreaterThan(2500);
    expect(total).toBeLessThan(3500);
    expect(misdealSequenceMs(1, 4, 52, true)).toBe(MISDEAL_REVEAL_REDUCED_MS);
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

  it('the deal passes on the redeal — in every viewer’s frame, whoever called it', () => {
    const st = spadeLessGame();
    const next = applyAction(st, { type: 'misdeal', seat: 0 });
    // the announcement + gather + shuffle + deal flight all key off the view's dealer, so
    // every client's view must carry the INCOMING dealer (one seat on) from the same state
    expect(next.dealer).toBe((st.dealer + 1) % 4);
    for (let viewer = 0; viewer < 4; viewer++) {
      expect(viewFor(next, viewer).dealer).toBe((st.dealer + 1) % 4);
      const { view } = rotateView(viewFor(next, viewer));
      expect(view.dealer).toBe(((st.dealer + 1 - viewer) % 4 + 4) % 4);
    }
  });
});
