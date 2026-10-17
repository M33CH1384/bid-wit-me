import { describe, expect, it } from 'vitest';
import { archSpot, rectHitsCards } from '../src/archSpot';
import { MIN_STRIP_PX, cardScreenQuad, fanLayout, handFan, phoneHandFan } from '../src/three/layout';
import type { HandHitCard } from '../src/three/handHit';

function fan(w: number, h: number, n = 13): HandHitCard[] {
  const A = w / h;
  const o = { ...phoneHandFan(), minStripPx: MIN_STRIP_PX, pxW: w };
  fanLayout(A, n, 0, o);
  return Array.from({ length: n }, (_, i) => ({ id: String(i), order: i, poly: cardScreenQuad(A, handFan(A, n, i, 0, 0, o, 0, h), w, h, 0) }));
}

describe('plate in the arch', () => {
  for (const [w, h] of [[375, 667], [390, 664], [393, 659], [430, 739]] as const) {
    it(`finds a clear spot under a 13-card fan at ${w}x${h}`, () => {
      const hits = fan(w, h);
      const s = archSpot(hits, w, h);
      expect(s).not.toBeNull();
      expect(rectHitsCards({ left: s!.x - s!.w / 2, top: s!.top, right: s!.x + s!.w / 2, bottom: s!.top + 34 }, hits)).toBe(false);
    });
  }
  it('no hand, no spot', () => { expect(archSpot([], 390, 664)).toBeNull(); });
});
