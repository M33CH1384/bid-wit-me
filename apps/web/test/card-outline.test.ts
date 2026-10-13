import { describe, expect, it } from 'vitest';
import { cardOutlineGeometry, cardOutlineStroke } from '../src/three/geometry';
import { FACE_POLYGON_OFFSET, LEGAL_NEAR, OUTLINE_AHEAD } from '../src/three/handLift';
import { CH, CR, CT, CW, FACE_CAP_GAP, handCardPlane, makeCamera } from '../src/three/layout';

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

  it('sits in front of the face bias on a 16-bit iPhone buffer, and behind the next card', () => {
    const g = cardOutlineGeometry();
    const pos = g.getAttribute('position');
    let z = -Infinity;
    for (let i = 0; i < pos.count; i++) z = Math.max(z, pos.getZ(i));
    // off the face plane, so the transparent ring is not depth-tested as coplanar with the pips
    expect(z).toBeCloseTo(CT / 2 + FACE_CAP_GAP + OUTLINE_AHEAD, 5);
    expect(OUTLINE_AHEAD).toBeGreaterThan(0);
    const aspects = [390 / 844, 844 / 390, 16 / 9];
    for (const aspect of aspects) {
      const cam = makeCamera(aspect, false);
      const n = 13;
      for (let i = 0; i < n; i++) {
        const plane = handCardPlane(aspect, n, i, 0, 0, { layer: 'play', near: LEGAL_NEAR }, 0, 844);
        const lead = OUTLINE_AHEAD * plane.s * plane.depth;
        const ulp = (plane.depth * plane.depth) * (cam.far - cam.near) / (cam.near * cam.far * 65535);
        // clears the face's window bias (8 units toward the camera) with room to spare
        expect(lead).toBeGreaterThan(ulp * Math.abs(FACE_POLYGON_OFFSET.units) * 1.5);
        // the fan steps 0.006; staying under that keeps the outline from painting the next card
        expect(lead).toBeLessThan(0.005);
      }
    }
  });
});
