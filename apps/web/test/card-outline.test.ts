import { describe, expect, it } from 'vitest';
import { CH, CR, CW } from '../src/three/layout';
import { cardOutlineGeometry, cardOutlineStroke } from '../src/three/geometry';

/** True when (x, y) lands in a triangle of the outline ring. */
function covers(x: number, y: number): boolean {
  const g = cardOutlineGeometry();
  const pos = g.getAttribute('position');
  const idx = g.getIndex();
  if (!idx) return false;
  const area = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (let i = 0; i < idx.count; i += 3) {
    const ax = pos.getX(idx.getX(i)), ay = pos.getY(idx.getX(i));
    const bx = pos.getX(idx.getX(i + 1)), by = pos.getY(idx.getX(i + 1));
    const cx = pos.getX(idx.getX(i + 2)), cy = pos.getY(idx.getX(i + 2));
    const ab = area(ax, ay, bx, by, x, y);
    const bc = area(bx, by, cx, cy, x, y);
    const ca = area(cx, cy, ax, ay, x, y);
    if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) return true;
  }
  return false;
}

describe('per-card outline', () => {
  it('is a thin ring on the rounded card, not a filled rectangle', () => {
    const stroke = cardOutlineStroke();
    expect(stroke).toBeGreaterThan(0);
    expect(stroke).toBeLessThan(CR);
    const g = cardOutlineGeometry();
    g.computeBoundingBox();
    const box = g.boundingBox!;
    expect(box.max.x).toBeCloseTo(CW / 2 + stroke, 5);
    expect(box.max.y).toBeCloseTo(CH / 2 + stroke, 5);
    expect(box.min.x).toBeCloseTo(-(CW / 2 + stroke), 5);
    // the face is open: gold does not paint the pips
    expect(covers(0, 0)).toBe(false);
    // the stroke sits on the straight edge
    expect(covers(CW / 2 + stroke / 2, 0)).toBe(true);
    // nothing past the stroke, so the ring does not grow into a pad
    expect(covers(CW / 2 + stroke + stroke, 0)).toBe(false);
    // just inside the face, past the tuck, the card stays clear
    expect(covers(CW / 2 - stroke, 0)).toBe(false);
    // the corner of the bounding square is outside the rounded stroke
    expect(covers(CW / 2, CH / 2)).toBe(false);
    // the stroke follows the same corner centre as the card
    const mid = CR + stroke / 2;
    expect(covers(CW / 2 - CR + mid / Math.SQRT2, CH / 2 - CR + mid / Math.SQRT2)).toBe(true);
  });
});
