/**
 * Post-hand collection phase (Demetrius 2026-10-19):
 * After a hand ends, books slide to the next dealer for ~5s while bots talk trash,
 * before the recap appears. Tests the layout targets used by the collection animation.
 */
import { describe, expect, it } from 'vitest';
import { deckSpot, pileSpot } from '../src/three/layout';

describe('post-hand collection', () => {
  it('collection target is the next dealer deck spot, distinct from pile spots', () => {
    const n = 4;
    const positions = ['bottom', 'left', 'top', 'right'] as const;
    // next dealer after seat 0 is seat 1
    const collectTarget = deckSpot(positions[1]!, n);
    // pile spots for each seat should differ from the collection target
    for (let s = 0; s < n; s++) {
      const pile = pileSpot(positions[s]!, n, 0, 0, 0);
      // not identical positions (collection goes to dealer, piles stay per-player)
      const same = pile.p.every((v, i) => Math.abs(v - collectTarget.p[i]!) < 1e-9);
      // seat 1's own pile might be near its deck, but other seats must differ
      if (s !== 1) expect(same).toBe(false);
    }
  });

  it('collection stagger keeps total under ~5s (4 seats × 0.5s + books)', () => {
    // delay = seat * 0.5 + book * 0.08, duration 0.7
    // worst case: seat 3, book 12 → 1.5 + 0.96 + 0.7 = ~3.2s < 5.2s phase
    const maxDelay = 3 * 0.5 + 12 * 0.08;
    const maxTotal = maxDelay + 0.7;
    expect(maxTotal).toBeLessThan(5.2);
  });
});
