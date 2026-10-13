import { describe, expect, it } from 'vitest';
import { queenIndex } from '../src/cardArt';
import { MIN_STRIP_PX, fanRowCounts, handFan, ndcCorners, opponentFan } from '../src/three/layout';

function boxes(w: number, h: number, n: number) {
  const aspect = w / h;
  return Array.from({ length: n }, (_, i) => {
    const c = ndcCorners(aspect, handFan(aspect, n, i, 0, 0, { phoneRows: true }, 0, h));
    const xs = c.map((p) => ((p[0] + 1) / 2) * w);
    const ys = c.map((p) => ((1 - p[1]) / 2) * h);
    return { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  });
}

describe('phone hand fan', () => {
  for (const w of [336, 360, 390]) {
    it(`${w}px keeps a 44px strip on every card and stays on screen`, () => {
      const cards = boxes(w, 844, 13);
      for (const c of cards) {
        expect(c.left).toBeGreaterThanOrEqual(-1);
        expect(c.right).toBeLessThanOrEqual(w + 1);
        expect(c.top).toBeGreaterThanOrEqual(-1);
        expect(c.bottom).toBeLessThanOrEqual(845);
      }
      const rows: (typeof cards)[] = [];
      for (const c of cards) {
        const row = rows.find((r) => Math.abs(r[0]!.top - c.top) < 12);
        if (row) row.push(c);
        else rows.push([c]);
      }
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        const ordered = [...row].sort((a, b) => a.left - b.left);
        for (let i = 0; i < ordered.length - 1; i++) {
          expect(ordered[i + 1]!.left - ordered[i]!.left).toBeGreaterThanOrEqual(MIN_STRIP_PX - 0.5);
        }
      }
    });
  }

  it('a wide table keeps one row', () => {
    expect(fanRowCounts(13, 1280, true)).toEqual([13]);
    expect(fanRowCounts(13, 390, true)).toEqual([6, 7]);
    expect(fanRowCounts(13, 390)).toEqual([13]);
  });

  it('draws a queen with a tail outside the bowl, still in the left strip', () => {
    const W = 200;
    const g = queenIndex(W * 0.135, W * 0.255, W * 0.28);
    expect(g.tailX).toBeGreaterThan(g.bowlRight + 2);
    expect(g.tailY).toBeGreaterThan(g.bowlBottom);
    expect(g.tailX).toBeLessThan(W * 0.34);
  });

  it('keeps the right-hand seat inside a 336 and a 390 phone', () => {
    for (const w of [336, 390]) {
      const aspect = w / 844;
      let hi = -Infinity;
      for (let i = 0; i < 13; i++) {
        for (const p of ndcCorners(aspect, opponentFan('right', 4, i, 13))) hi = Math.max(hi, ((p[0] + 1) / 2) * w);
      }
      expect(hi).toBeLessThanOrEqual(w - 8);
    }
  });
});
