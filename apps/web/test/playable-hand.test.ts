import { describe, expect, it } from 'vitest';
import { GROUP_PAD_PX, GROUP_RADIUS_PX, cardPartOrder, fanGapPx, handRenderOrder, hitsInPaintOrder } from '../src/three/handLift';
import { fanLayout, handCardPlane } from '../src/three/layout';
import { contourContains, groupOutline, haloLocal, placeOnPlane, unionContours } from '../src/three/playableOutline';

/**
 * The fan draws a legal card over the illegal card beside it, but that neighbour stays closer in z.
 * A distance-only raycast hands the tap to the card you cannot see.
 */
describe('a tap hits the card you see', () => {
  function hit(order: number, distance: number, name: string) {
    const group = { renderOrder: order, parent: null, name };
    return { distance, object: { renderOrder: 0, parent: group }, eventObject: group, name };
  }

  it('gives the tap to the legal card drawn over a closer illegal neighbour', () => {
    // K♦ (index 8) overlaps 3♣ (index 7) and is nearer the camera. 3♣ is painted on top.
    const diamond = hit(handRenderOrder(8, false), 1.0, 'KD');
    const club = hit(handRenderOrder(7, true), 1.35, '3C');
    const ordered = hitsInPaintOrder([diamond, club]);
    expect(ordered[0]!.name).toBe('3C');
    expect(ordered[0]!.eventObject.renderOrder).toBeGreaterThan(ordered[1]!.eventObject.renderOrder);
  });

  it('keeps the face above the blank edge when depth testing is off', () => {
    expect(cardPartOrder('face')).toBeGreaterThan(cardPartOrder('edge'));
    expect(cardPartOrder('face')).toBeGreaterThan(cardPartOrder('back'));
    expect(cardPartOrder('back')).toBeGreaterThan(cardPartOrder('edge'));
  });

  it('keeps left-to-right order inside the legal group and does not jump on a tie', () => {
    const left = hit(handRenderOrder(5, true), 1.4, 'JC');
    const right = hit(handRenderOrder(7, true), 1.1, '3C');
    expect(hitsInPaintOrder([left, right])[0]!.name).toBe('3C');
    const far = hit(0, 2, 'far');
    const near = hit(0, 1, 'near');
    expect(hitsInPaintOrder([far, near]).map((h) => h.name)).toEqual(['near', 'far']);
  });
});

describe('the legal outline matches the card bounds', () => {
  const aspect = 390 / 844;
  const screenH = 844;

  it('wraps the middle run, padding included, and leaves the cards beside it outside', () => {
    const n = 13;
    const flags = Array.from({ length: n }, (_, i) => i >= 5 && i <= 7);
    const gaps = fanGapPx(flags);
    const px = fanLayout(aspect, n).viewH / screenH;
    const faceOf = (i: number) => placeOnPlane(haloLocal(1, 1), handCardPlane(aspect, n, i, 0, 0, {}, gaps[i]!, screenH));
    const faces = [5, 6, 7].map(faceOf);
    const rect = groupOutline(faces, GROUP_PAD_PX * px, GROUP_RADIUS_PX * px);
    expect(rect).toBeTruthy();
    const [outline] = unionContours([rect!], 64);
    expect(outline).toBeTruthy();

    let fMinX = Infinity, fMaxX = -Infinity, fMinY = Infinity, fMaxY = -Infinity;
    for (const face of faces) {
      let cx = 0, cy = 0;
      for (const p of face) {
        cx += p.x; cy += p.y;
        fMinX = Math.min(fMinX, p.x); fMaxX = Math.max(fMaxX, p.x);
        fMinY = Math.min(fMinY, p.y); fMaxY = Math.max(fMaxY, p.y);
        expect(contourContains(outline!, p)).toBe(true);
      }
      expect(contourContains(outline!, { x: cx / face.length, y: cy / face.length })).toBe(true);
    }
    let oMinX = Infinity, oMaxX = -Infinity, oMinY = Infinity, oMaxY = -Infinity;
    for (const p of rect!) {
      oMinX = Math.min(oMinX, p.x); oMaxX = Math.max(oMaxX, p.x);
      oMinY = Math.min(oMinY, p.y); oMaxY = Math.max(oMaxY, p.y);
    }
    // The stroke sits GROUP_PAD_PX outside the faces. A rotated box can add a hair on the screen axes.
    expect(Math.abs((fMinX - oMinX) / px - GROUP_PAD_PX)).toBeLessThan(2);
    expect(Math.abs((oMaxX - fMaxX) / px - GROUP_PAD_PX)).toBeLessThan(2);
    expect(Math.abs((fMinY - oMinY) / px - GROUP_PAD_PX)).toBeLessThan(2);
    expect(Math.abs((oMaxY - fMaxY) / px - GROUP_PAD_PX)).toBeLessThan(2);
    expect(Math.abs(((oMinX + oMaxX) / 2 - (fMinX + fMaxX) / 2) / px)).toBeLessThan(1);
    expect(Math.abs(((oMinY + oMaxY) / 2 - (fMinY + fMaxY) / 2) / px)).toBeLessThan(1);

    // The end card overlaps the neighbour, so that neighbour's centre can sit under the face.
    // The card past that neighbour stays outside the outline.
    const pastRight = handCardPlane(aspect, n, 9, 0, 0, {}, gaps[9]!, screenH);
    const pastLeft = handCardPlane(aspect, n, 3, 0, 0, {}, gaps[3]!, screenH);
    expect(contourContains(outline!, { x: pastRight.x, y: pastRight.y })).toBe(false);
    expect(contourContains(outline!, { x: pastLeft.x, y: pastLeft.y })).toBe(false);
    expect(contourContains(outline!, { x: oMaxX + 12 * px, y: (oMinY + oMaxY) / 2 })).toBe(false);
  });
});
