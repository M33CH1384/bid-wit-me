import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { GROUP_PAD_PX, GROUP_RADIUS_PX, cardPartOrder, cssPxToPlane, fanGapPx, handRenderOrder, hitsInPaintOrder, raiseLocalY, screenRaise } from '../src/three/handLift';
import { fanLayout, handCardPlane, handFan, makeCamera } from '../src/three/layout';
import { contourContains, groupOutline, haloLocal, placeOnPlane, planePointOk, unionContours } from '../src/three/playableOutline';

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

  it('wraps the whole hand when every card is legal, and ignores a wild corner', () => {
    const n = 13;
    const gaps = fanGapPx(Array.from({ length: n }, () => true));
    expect(gaps.every((g) => g === 0)).toBe(true);
    const L = fanLayout(aspect, n);
    const px = L.viewH / screenH;
    const faces = gaps.map((_, i) => placeOnPlane(haloLocal(1, 1), handCardPlane(aspect, n, i, 0, 0, {}, gaps[i]!, screenH)));
    const rect = groupOutline(faces, GROUP_PAD_PX * px, GROUP_RADIUS_PX * px);
    expect(rect).toBeTruthy();
    const [outline] = unionContours([rect!], 80);
    expect(outline).toBeTruthy();
    let fMinX = Infinity, fMaxX = -Infinity;
    for (const face of faces) {
      let cx = 0, cy = 0;
      for (const p of face) { cx += p.x; cy += p.y; fMinX = Math.min(fMinX, p.x); fMaxX = Math.max(fMaxX, p.x); }
      expect(contourContains(outline!, { x: cx / face.length, y: cy / face.length })).toBe(true);
    }
    const widthPx = (fMaxX - fMinX) / px;
    const outlinePx = (Math.max(...rect!.map((p) => p.x)) - Math.min(...rect!.map((p) => p.x))) / px;
    // One card is about 100px. The whole fan is the run, not a single end card and not the viewport.
    expect(widthPx).toBeGreaterThan(250);
    expect(outlinePx).toBeGreaterThan(widthPx);
    expect(outlinePx - widthPx).toBeLessThan(20);
    // One exploded corner is dropped. The run stays the size of the hand, not the size of the view.
    const wild = faces.map((face, i) => (i === n - 1 ? face.map((p, k) => (k === 0 ? { x: 1e6, y: p.y } : p)) : face));
    const kept = groupOutline(wild, GROUP_PAD_PX * px, GROUP_RADIUS_PX * px);
    expect(kept).toBeTruthy();
    expect((Math.max(...kept!.map((p) => p.x)) - Math.min(...kept!.map((p) => p.x))) / px).toBeLessThan(outlinePx + 2);
    expect(groupOutline([[{ x: 1e6, y: 0 }, { x: -1e6, y: 1 }]], GROUP_PAD_PX * px, GROUP_RADIUS_PX * px)).toBeNull();
    const withNan = faces.map((face, i) => (i === 0 ? face.map((p, k) => (k === 0 ? { x: NaN, y: NaN } : p)) : face));
    const dropped = groupOutline(withNan, GROUP_PAD_PX * px, GROUP_RADIUS_PX * px);
    expect(dropped).toBeTruthy();
    expect((Math.max(...dropped!.map((p) => p.x)) - Math.min(...dropped!.map((p) => p.x))) / px).toBeLessThan(outlinePx + 2);
    expect(planePointOk(1e6, 0)).toBe(false);
    expect(planePointOk(NaN, 0)).toBe(false);
  });
});

describe('a bad viewport cannot throw the hand away', () => {
  const aspect = 390 / 844;
  const screenH = 844;

  it('keeps a left, middle, and right run in its own fan slot', () => {
    const n = 13;
    const px = fanLayout(aspect, n).viewH / screenH;
    const rightEdge = handCardPlane(aspect, n, n - 1, 0, 0, {}, 0, screenH);
    const runs: { name: string; cards: number[] }[] = [
      { name: 'left', cards: [0, 1, 2] },
      { name: 'middle', cards: [5, 6, 7] },
      { name: 'right', cards: [10, 11, 12] },
    ];
    for (const run of runs) {
      const flags = Array.from({ length: n }, (_, i) => i >= run.cards[0]! && i <= run.cards[run.cards.length - 1]!);
      const gaps = fanGapPx(flags);
      for (let i = 0; i < n; i++) {
        const slid = handCardPlane(aspect, n, i, 0, 0, {}, gaps[i]!, screenH);
        const slot = handCardPlane(aspect, n, i, 0, 0, {}, 0, screenH);
        // 8px of air beside the run. The index, the roll, and the depth do not change, so a card cannot jump to the far side.
        expect(Math.abs(gaps[i]!), `${run.name} gap`).toBeLessThanOrEqual(8);
        expect(Math.abs((slid.x - slot.x) / px), `${run.name}[${i}]`).toBeLessThanOrEqual(8.01);
        expect(slid.roll).toBeCloseTo(slot.roll, 6);
        expect(slid.depth).toBeCloseTo(slot.depth, 6);
      }
      const faces = run.cards.map((i) => placeOnPlane(haloLocal(1, 1), handCardPlane(aspect, n, i, 0, 0, {}, gaps[i]!, screenH)));
      const rect = groupOutline(faces, GROUP_PAD_PX * px, GROUP_RADIUS_PX * px);
      expect(rect, run.name).toBeTruthy();
      const [outline] = unionContours([rect!], 64);
      expect(outline).toBeTruthy();
      let faceX = 0;
      for (const face of faces) {
        let cx = 0;
        for (const p of face) { cx += p.x; expect(contourContains(outline!, p)).toBe(true); }
        faceX += cx / face.length;
      }
      faceX /= faces.length;
      const outlineX = rect!.reduce((s, p) => s + p.x, 0) / rect!.length;
      expect(Math.abs((outlineX - faceX) / px), `${run.name} outline`).toBeLessThan(1);
      if (run.name !== 'right') expect(Math.abs((outlineX - rightEdge.x) / px)).toBeGreaterThan(80);
    }
    // A subset has a real gap. A 0-height canvas used to divide by 1px and throw that run off the screen.
    const middle = fanGapPx(Array.from({ length: n }, (_, i) => i >= 5 && i <= 7));
    expect(middle.some((g) => g !== 0)).toBe(true);
    const home = handCardPlane(aspect, n, 7, 0, 0, {}, 0, screenH);
    for (const bad of [0, NaN, Infinity]) {
      const plane = handCardPlane(aspect, n, 7, 0, 0, {}, middle[7]!, bad);
      expect(plane.x).toBeCloseTo(home.x, 6);
      expect(plane.y).toBeCloseTo(home.y, 6);
      const fan = handFan(aspect, n, 7, 0, 0, {}, middle[7]!, bad);
      expect(fan.p.every(Number.isFinite)).toBe(true);
      expect(fan.s).toBeGreaterThan(0.05);
    }
  });

  it('keeps a void hand and an all-legal lead finite when the canvas size is 0 or NaN', () => {
    const n = 13;
    const gaps = fanGapPx(Array.from({ length: n }, () => true));
    const good = handCardPlane(aspect, n, 12, 0, 0, {}, 0, screenH);
    for (const bad of [0, NaN, Infinity]) {
      const plane = handCardPlane(aspect, n, 12, 0, 0, {}, gaps[12]!, bad);
      expect(plane.x).toBeCloseTo(good.x, 6);
      expect(plane.y).toBeCloseTo(good.y, 6);
      const fan = handFan(aspect, n, 0, 0, 0, {}, gaps[0]!, bad);
      expect(fan.p.every(Number.isFinite)).toBe(true);
      expect(fan.q.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(fan.s)).toBe(true);
      expect(fan.s).toBeGreaterThan(0.05);
    }
    for (const badAspect of [0, NaN, Infinity]) {
      const fan = handFan(badAspect, n, 6, 0, 0, {}, 0, screenH);
      expect(fan.p.every(Number.isFinite)).toBe(true);
      expect(Number.isFinite(fan.s) && fan.s > 0.05).toBe(true);
    }
    const L = fanLayout(aspect, n);
    expect(cssPxToPlane(14, L.viewH, 0)).toBe(0);
    expect(cssPxToPlane(14, L.viewH, NaN)).toBe(0);
    expect(raiseLocalY('legal', L.viewH, 0, L.ch)).toBe(0);
    expect(raiseLocalY('legal', L.viewH, NaN, L.ch)).toBe(0);
    const raised = raiseLocalY('legal', L.viewH, screenH, L.ch);
    expect(raised).toBeGreaterThan(0);
    expect(raised).toBeLessThan(0.2);
  });

  it('raises the end card straight up the screen instead of walking it out of the fan', () => {
    const cam = makeCamera(aspect);
    const screenUp = new Vector3(0, 1, 0).applyQuaternion(cam.quaternion).normalize();
    const i = 12;
    const plane = handCardPlane(aspect, 13, i, 0);
    const fan = handFan(aspect, 13, i, 0);
    const q = new Quaternion(...fan.q);
    const d = 0.05;
    const fixed = screenRaise(plane.roll, d);
    const world = new Vector3(fixed.x, fixed.y, 0).applyQuaternion(q);
    expect(world.clone().cross(screenUp).length()).toBeLessThan(1e-6);
    expect(world.dot(screenUp)).toBeCloseTo(d, 6);
    const raw = new Vector3(0, d, 0).applyQuaternion(q);
    expect(raw.clone().cross(screenUp).length()).toBeGreaterThan(0.01);
  });
});
