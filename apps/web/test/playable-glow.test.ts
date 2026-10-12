import { describe, expect, it } from 'vitest';
import { handCardPlane } from '../src/three/layout';
import {
  contourContains, contoursToTriangles, contiguousRuns, haloLocal, HALO_SX, HALO_SY, placeOnPlane, strokeContour, unionContours, yRangeAt, type Pt,
} from '../src/three/playableOutline';

describe('contiguous playable runs', () => {
  it('groups neighbours and keeps gaps apart', () => {
    expect(contiguousRuns([])).toEqual([]);
    expect(contiguousRuns([false, false, false])).toEqual([]);
    expect(contiguousRuns([true, true, true])).toEqual([[0, 2]]);
    expect(contiguousRuns([false, true, true, false, true, false])).toEqual([[1, 2], [4, 4]]);
    expect(contiguousRuns([true, false, true])).toEqual([[0, 0], [2, 2]]);
    expect(contiguousRuns([false, true])).toEqual([[1, 1]]);
    expect(contiguousRuns([true])).toEqual([[0, 0]]);
  });
});

describe('group outline', () => {
  const rect = (x: number, y: number, hw: number, hh: number): Pt[] => [
    { x: x - hw, y: y - hh }, { x: x + hw, y: y - hh }, { x: x + hw, y: y + hh }, { x: x - hw, y: y + hh },
  ];

  it('one rounded card is a single ribbon that covers its centre and not the space beside it', () => {
    const poly = roundedAt(0, 0, 0.2, 0.3);
    const [c] = unionContours([poly]);
    expect(c).toBeTruthy();
    expect(contourContains(c!, { x: 0, y: 0 })).toBe(true);
    expect(contourContains(c!, { x: 0, y: 0.29 })).toBe(true);
    expect(contourContains(c!, { x: 0.5, y: 0 })).toBe(false);
    expect(contourContains(c!, { x: 0, y: 0.45 })).toBe(false);
  });

  it('overlapping cards become one contour; a gap becomes two and does not bridge', () => {
    const overlap = unionContours([rect(0, 0, 0.5, 0.4), rect(0.6, 0, 0.5, 0.4)]);
    expect(overlap).toHaveLength(1);
    expect(contourContains(overlap[0]!, { x: 0.3, y: 0 })).toBe(true);
    const gapped = unionContours([rect(0, 0, 0.4, 0.3), rect(2.2, 0, 0.4, 0.3)]);
    expect(gapped).toHaveLength(2);
    expect(contourContains(gapped[0]!, { x: 1.1, y: 0 })).toBe(false);
    expect(contourContains(gapped[1]!, { x: 1.1, y: 0 })).toBe(false);
    expect(contourContains(gapped[0]!, { x: 0, y: 0 })).toBe(true);
    expect(contourContains(gapped[1]!, { x: 2.2, y: 0 })).toBe(true);
  });

  it('a lifted middle card raises only the middle of the rail', () => {
    const flat = rect(0, 0, 0.45, 0.35);
    const mid = rect(0.7, 0.2, 0.45, 0.35);
    const right = rect(1.4, 0, 0.45, 0.35);
    const [c] = unionContours([flat, mid, right]);
    expect(c).toBeTruthy();
    const yAt = (x: number) => {
      let best = -Infinity;
      for (const p of c!.top) if (Math.abs(p.x - x) < 0.08) best = Math.max(best, p.y);
      return best;
    };
    expect(yAt(0.7)).toBeGreaterThan(yAt(0) + 0.12);
    expect(yAt(0.7)).toBeGreaterThan(yAt(1.4) + 0.12);
  });

  it('the stroke sits outside the contour and stays finite', () => {
    const [c] = unionContours([rect(0, 0, 1, 0.5)]);
    const tris = strokeContour(c!, 0.08);
    expect(tris.length).toBeGreaterThan(18);
    let maxY = -Infinity;
    for (let i = 1; i < tris.length; i += 3) maxY = Math.max(maxY, tris[i]!);
    expect(maxY).toBeGreaterThan(Math.max(...c!.top.map((p) => p.y)) + 0.04);
    for (const v of tris) expect(Number.isFinite(v)).toBe(true);
  });

  it('triangle soup is finite and covers the ribbon', () => {
    const tris = contoursToTriangles(unionContours([rect(0, 0, 1, 0.5), rect(1.2, 0, 1, 0.5)]));
    expect(tris.length).toBeGreaterThan(18);
    expect(tris.length % 9).toBe(0);
    for (const v of tris) expect(Number.isFinite(v)).toBe(true);
  });

  it('a vertical slice of a quad hits both edges', () => {
    expect(yRangeAt(rect(0, 0, 1, 2), 0)).toEqual([-2, 2]);
    expect(yRangeAt(rect(0, 0, 1, 2), 3)).toBeNull();
  });
});

describe('playable fan on a phone', () => {
  const aspect = 390 / 844;
  const halo = haloLocal(HALO_SX, HALO_SY, 3);

  function halos(indexes: number[], liftAt: (i: number) => number) {
    return indexes.map((i) => placeOnPlane(halo, { ...handCardPlane(aspect, 13, i, liftAt(i)), }));
  }

  it('three hearts in the middle of a 13-card fan are one outline, and the cards on either side stay outside it', () => {
    const playable = [5, 6, 7];
    const [c] = unionContours(halos(playable, () => 0.09));
    expect(c).toBeTruthy();
    for (const i of playable) {
      const p = handCardPlane(aspect, 13, i, 0.09);
      expect(contourContains(c!, { x: p.x, y: p.y })).toBe(true);
    }
    // on a phone the fan overlaps tightly, so the rail wraps the end cards (and the neighbour tucked under them)
    // without reaching the card beyond that neighbour.
    const left = handCardPlane(aspect, 13, 5, 0.09);
    const right = handCardPlane(aspect, 13, 7, 0.09);
    const neighbour = handCardPlane(aspect, 13, 4, 0);
    const step = left.x - neighbour.x;
    const overhang = left.x - c!.bot[0]!.x;
    expect(c!.bot[c!.bot.length - 1]!.x).toBeGreaterThan(right.x);
    expect(overhang).toBeGreaterThan(step * 0.8);
    expect(overhang).toBeLessThan(step * 2.2);
  });

  it('a gap in the fan is two outlines, one per run', () => {
    const flags = Array.from({ length: 13 }, (_, i) => i === 2 || i === 3 || i === 8 || i === 9 || i === 10);
    const runs = contiguousRuns(flags);
    expect(runs).toEqual([[2, 3], [8, 10]]);
    const contours = runs.map(([a, b]) => unionContours(halos(Array.from({ length: b - a + 1 }, (_, k) => a + k), (i) => (flags[i] ? 0.09 : 0))));
    expect(contours.every((cs) => cs.length === 1)).toBe(true);
    const [left, right] = contours.map((cs) => cs[0]!);
    const between = handCardPlane(aspect, 13, 5, 0);
    expect(contourContains(left!, between)).toBe(false);
    expect(contourContains(right!, between)).toBe(false);
    // the two rails do not overlap
    expect(left!.bot[left!.bot.length - 1]!.x).toBeLessThan(right!.bot[0]!.x);
  });

  it('selecting a card in the run lifts the outline with it', () => {
    const flat = unionContours(halos([5, 6, 7], () => 0.09))[0]!;
    const popped = unionContours(halos([5, 6, 7], (i) => (i === 6 ? 0.24 : 0.09)))[0]!;
    const peak = (c: { top: Pt[] }) => Math.max(...c.top.map((p) => p.y));
    expect(peak(popped)).toBeGreaterThan(peak(flat) + 0.015);
    // the outer tip of the run stays put; only the selected card's part of the rail rises
    expect(Math.abs(popped.top[0]!.y - flat.top[0]!.y)).toBeLessThan(0.008);
    expect(Math.abs(popped.bot[0]!.x - flat.bot[0]!.x)).toBeLessThan(1e-6);
  });
});

function roundedAt(x: number, y: number, hw: number, hh: number): Pt[] {
  const local = haloLocal(1, 1, 3).map((p) => ({ x: (p.x / (0.25 / 2)) * hw, y: (p.y / (0.35 / 2)) * hh }));
  return placeOnPlane(local, { x, y, roll: 0.04, s: 1 });
}
