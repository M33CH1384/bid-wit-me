import { describe, expect, it } from 'vitest';
import { type SeatPos, type Xform, handFan, ndcExtentX, opponentFan, pileSpot, trickSpot } from '../src/three/layout';

// CSS-pixel viewports: iPhone SE, 12/13/14, 14 Pro Max, small Android, desktop, and iPhone landscape
const VIEWPORTS: [number, number][] = [[320, 568], [375, 667], [390, 844], [393, 852], [430, 932], [360, 740], [1280, 800], [1920, 1080], [844, 390]];
const SEATS: Record<number, SeatPos[]> = { 4: ['bottom', 'left', 'top', 'right'], 3: ['bottom', 'left', 'right'] };

const inside = (aspect: number, xs: Xform[], margin: number) => {
  const [lo, hi] = ndcExtentX(aspect, xs);
  expect(lo).toBeGreaterThanOrEqual(-1 + margin);
  expect(hi).toBeLessThanOrEqual(1 - margin);
  return [lo, hi];
};

describe('3D hand fan fits the viewport', () => {
  for (const [w, h] of VIEWPORTS) {
    const aspect = w / h;
    for (const count of [1, 5, 13, 17, 18]) {
      it(`${w}x${h} — ${count} cards, any card lifted`, () => {
        // NDC margin of 0.06 ≈ 3% of the width on each side
        const base = Array.from({ length: count }, (_, i) => handFan(aspect, count, i, 0.07));
        const [lo, hi] = inside(aspect, base, 0.1); // ≥5% of the width clear on each side
        expect(Math.abs(lo + hi)).toBeLessThan(0.05); // centered (later cards sit a hair nearer the camera so they overlap correctly)
        for (const lifted of [0, count - 1]) inside(aspect, [handFan(aspect, count, lifted, 0.24)], 0.1);
      });
    }
    it(`${w}x${h} — safe-area inset pushes the fan inward`, () => {
      const plain = ndcExtentX(aspect, Array.from({ length: 13 }, (_, i) => handFan(aspect, 13, i, 0)));
      const safe = ndcExtentX(aspect, Array.from({ length: 13 }, (_, i) => handFan(aspect, 13, i, 0, 0.06)));
      expect(safe[1]).toBeLessThanOrEqual(1 - 2 * 0.06);
      expect(safe[1]).toBeLessThanOrEqual(plain[1] + 1e-9);
    });
    for (const n of [3, 4]) {
      it(`${w}x${h} — ${n}p opponent fans, trick cards and piles stay on screen`, () => {
        for (const pos of SEATS[n]!) {
          if (pos === 'bottom') continue;
          inside(aspect, Array.from({ length: 18 }, (_, i) => opponentFan(pos, n, i, 18)), 0.02);
        }
        for (const pos of SEATS[n]!) inside(aspect, [trickSpot(pos, n, 0, 1), trickSpot(pos, n, 0, -1)], 0.1);
        for (const pos of SEATS[n]!) inside(aspect, Array.from({ length: 6 }, (_, k) => pileSpot(pos, n, k, 0, 0)), 0.02);
      });
    }
  }
});
