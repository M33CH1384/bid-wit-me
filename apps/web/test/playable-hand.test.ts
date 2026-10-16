import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { FACE_POLYGON_OFFSET, GROUP_PAD_PX, GROUP_RADIUS_PX, LEGAL_LIFT_PX, LEGAL_NEAR, RING_ABOVE, applyFaceDepthBias, cardIdFromHit, cardMeshPaint, cardPartOrder, cardTapHandlers, cssPxToPlane, fanGapPx, handDepthOpts, handRenderOrder, hitsInPaintOrder, raiseLocalY, screenRaise, setPointerSelected, setSelectedTapLayer } from '../src/three/handLift';
import { TAP_PLAY_ARM_MS, confirmPlay, feltClearsSelection } from '../src/online/playGuard';
import { FACE_CAP_GAP, fanLayout, handCardPlane, handFan, makeCamera } from '../src/three/layout';
import { cardGeometry } from '../src/three/geometry';
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

  it('keeps the face above the body, and the front material depth-tests', () => {
    const order = handRenderOrder(4, true);
    const face = cardMeshPaint(order, 'face');
    const body = cardMeshPaint(order, 'edge');
    const back = cardMeshPaint(order, 'back');
    const glow = cardMeshPaint(order, 'glow');
    expect(face.renderOrder).toBeGreaterThan(body.renderOrder);
    expect(face.renderOrder).toBe(order + 0.5);
    // The face draws after the back, so a tied 16-bit depth shows the pips and not the BWM back.
    expect(face.renderOrder).toBeGreaterThan(back.renderOrder);
    expect(FACE_POLYGON_OFFSET.factor).toBe(0);
    expect(glow.renderOrder).toBe(order + RING_ABOVE);
    expect(glow.depthTest).toBe(false);
    expect(glow.renderOrder).toBeGreaterThan(cardMeshPaint(handRenderOrder(16, true), 'face').renderOrder);
    expect(face.depthTest).toBe(true);
    expect(body.depthTest).toBe(true);
    expect(cardPartOrder('face', order)).toBeGreaterThan(cardPartOrder('edge', order));
  });

  it('keeps the face in front of the cap on a 16-bit depth buffer', () => {
    const aspect = 390 / 844;
    const screenH = 844;
    const geo = cardGeometry();
    const front = geo.front.getAttribute('position');
    const body = geo.body.getAttribute('position');
    let frontZ = -Infinity;
    let bodyZ = -Infinity;
    for (let i = 0; i < front.count; i++) frontZ = Math.max(frontZ, front.getZ(i));
    for (let i = 0; i < body.count; i++) bodyZ = Math.max(bodyZ, body.getZ(i));
    expect(frontZ - bodyZ).toBeCloseTo(FACE_CAP_GAP, 6);
    const cam = makeCamera(aspect, false);
    const n = 13;
    const plane = handCardPlane(aspect, n, n - 1, 0, 0, { near: LEGAL_NEAR }, 0, screenH);
    const world = FACE_CAP_GAP * plane.s * plane.depth;
    const z = plane.depth;
    const dz = (z * z) * (cam.far - cam.near) / (cam.near * cam.far * 65535);
    expect(world).toBeGreaterThan(dz * 2);
    const face = new MeshStandardMaterial();
    applyFaceDepthBias(face);
    expect(face.polygonOffset).toBe(true);
    expect(face.polygonOffsetUnits).toBe(FACE_POLYGON_OFFSET.units);
    expect(FACE_POLYGON_OFFSET.units).toBeLessThan(0);
  });

  it('plays the selected card id when a closer neighbour is also under the finger', () => {
    // Q♦ is raised. 4♦ is closer in z and overlaps it. The ray hits both.
    const queen = {
      renderOrder: handRenderOrder(4, true, true),
      parent: null,
      userData: { cardId: 'QD' },
    };
    const four = {
      renderOrder: handRenderOrder(6, true, false),
      parent: null,
      userData: { cardId: '4D' },
    };
    const hits = [
      { distance: 0.4, object: { renderOrder: 0, parent: four, userData: {} }, eventObject: four, name: '4D' },
      { distance: 1.1, object: { renderOrder: 0, parent: queen, userData: {} }, eventObject: queen, name: 'QD' },
    ];
    setPointerSelected('QD');
    try {
      const ordered = hitsInPaintOrder(hits);
      expect(ordered).toHaveLength(1);
      expect(cardIdFromHit(ordered[0]!.object)).toBe('QD');
    } finally {
      setPointerSelected(null);
    }

    // The mesh stamp wins over a stale closure that still says 4♦.
    const played: string[] = [];
    const handlers = cardTapHandlers((id) => played.push(id), '4D');
    handlers.onPointerDown?.({ stopPropagation() {}, object: queen });
    expect(played).toEqual(['QD']);

    // Selecting Q♦ and then hitting 4♦ changes the selection. It does not play 4♦.
    expect(confirmPlay('QD', '4D', 0, 500)).toEqual({ type: 'select', card: '4D' });
    // The tap that selected Q♦ must not also play it.
    expect(confirmPlay('QD', 'QD', 1000, 1000 + TAP_PLAY_ARM_MS - 1)).toEqual({ type: 'ignore' });
    // The confirming tap plays Q♦, the selected id, not the neighbour and not an index.
    const play = confirmPlay('QD', 'QD', 1000, 1000 + TAP_PLAY_ARM_MS);
    expect(play).toEqual({ type: 'play', card: 'QD' });
    if (play.type === 'play') expect(play.card).toBe('QD');
  });

  it('gives the raised card the tap when only the neighbour on its right was hit', () => {
    // QS is raised. 10S is the next card and draws in front of the overlap, so the ray hits only 10S.
    // Depth and the tap are separate: the nearer neighbour does not get the play.
    const aspect = 390 / 844;
    const queenDepth = handCardPlane(aspect, 10, 4, 0.34, 0, handDepthOpts('selected')).depth;
    const tenDepth = handCardPlane(aspect, 10, 5, 0.12, 0, handDepthOpts('legal')).depth;
    expect(tenDepth).toBeLessThan(queenDepth);
    const ten = {
      renderOrder: handRenderOrder(5, true, false),
      parent: null,
      userData: { cardId: '10S' },
    };
    const queen = {
      renderOrder: handRenderOrder(4, true, true),
      parent: null,
      userData: { cardId: 'QS' },
    };
    const hits = [
      { distance: 0.4, object: { renderOrder: 0, parent: ten, userData: {} }, eventObject: ten, name: '10S' },
    ];
    const raised = [
      { x: -0.2, y: 0.2 },
      { x: 0.4, y: 0.2 },
      { x: 0.4, y: -0.3 },
      { x: -0.2, y: -0.3 },
    ];
    setPointerSelected('QS');
    setSelectedTapLayer('QS', raised, queen);
    try {
      const onIt = hitsInPaintOrder(hits, 'QS', { x: 0.15, y: -0.05 });
      expect(onIt).toHaveLength(1);
      expect(cardIdFromHit(onIt[0]!.object)).toBe('QS');
      // That second tap plays the selected queen. It does not play the ten, and it does not lower the queen.
      const play = confirmPlay('QS', 'QS', 0, 500);
      expect(play).toEqual({ type: 'play', card: 'QS' });
      expect(confirmPlay('QS', 'QS', 1000, 1000 + TAP_PLAY_ARM_MS - 1)).toEqual({ type: 'ignore' });
      // Past the raised card, the ten is a different card. Select it. Do not play it.
      const beside = hitsInPaintOrder(hits, 'QS', { x: 0.9, y: -0.05 });
      expect(cardIdFromHit(beside[0]!.object)).toBe('10S');
      expect(confirmPlay('QS', '10S', 0, 500)).toEqual({ type: 'select', card: '10S' });
      expect(feltClearsSelection('QS')).toBe(true);
      expect(feltClearsSelection(null)).toBe(false);
    } finally {
      setPointerSelected(null);
      setSelectedTapLayer(null, null, null);
    }
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

  it('follows the fan on a sloping run, with 4px of pad after the lift', () => {
    const n = 13;
    const viewH = fanLayout(aspect, n).viewH;
    const px = viewH / screenH;
    const lift = cssPxToPlane(LEGAL_LIFT_PX, viewH, screenH);
    const runs: { name: string; cards: number[] }[] = [
      { name: 'left', cards: [0, 1, 2, 3, 4] },
      { name: 'middle', cards: [5, 6, 7] },
      { name: 'right', cards: [8, 9, 10, 11, 12] },
      { name: 'one', cards: [12] },
    ];
    const center = (poly: { x: number; y: number }[]) => {
      let x = 0, y = 0;
      for (const p of poly) { x += p.x; y += p.y; }
      return { x: x / poly.length, y: y / poly.length };
    };
    const extents = (pts: { x: number; y: number }[], ang: number) => {
      const co = Math.cos(ang), si = Math.sin(ang);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        const x = p.x * co + p.y * si;
        const y = -p.x * si + p.y * co;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return { minX, minY, maxX, maxY };
    };
    for (const run of runs) {
      const flags = Array.from({ length: n }, (_, i) => run.cards.includes(i));
      const gaps = fanGapPx(flags);
      const faces = run.cards.map((i) => {
        const pose = handCardPlane(aspect, n, i, 0, 0, {}, gaps[i]!, screenH);
        // The legal lift is the same screen-up shift on every card in the run.
        return placeOnPlane(haloLocal(1, 1), pose).map((p) => ({ x: p.x, y: p.y + lift }));
      });
      const rect = groupOutline(faces, GROUP_PAD_PX * px, GROUP_RADIUS_PX * px);
      expect(rect, run.name).toBeTruthy();
      const first = center(faces[0]!);
      const last = center(faces[faces.length - 1]!);
      const ang = faces.length >= 2
        ? Math.atan2(last.y - first.y, last.x - first.x)
        : handCardPlane(aspect, n, run.cards[0]!, 0, 0, {}, gaps[run.cards[0]!]!, screenH).roll + Math.PI / 2;
      const facePts = faces.flat();
      const f = extents(facePts, ang);
      const o = extents(rect!, ang);
      for (const side of ['minX', 'maxX', 'minY', 'maxY'] as const) {
        const extra = side.startsWith('min') ? (f[side] - o[side]) / px : (o[side] - f[side]) / px;
        expect(extra, `${run.name} ${side}`).toBeCloseTo(GROUP_PAD_PX, 0);
      }
      // An upright box on the card-height axis left a corner about 29px off the lower cards.
      // The 10px corner radius keeps a hugging box under 16px from the nearest face point.
      let stray = 0;
      for (const p of rect!) {
        let near = Infinity;
        for (const q of facePts) near = Math.min(near, Math.hypot(p.x - q.x, p.y - q.y));
        stray = Math.max(stray, near);
      }
      expect(stray / px, `${run.name} stray`).toBeLessThan(16);
    }
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
    // The fan no longer opens air for an outline. A caller-supplied gap must still not explode
    // when the canvas height is 0: that used to divide by 1px and throw the run off the screen.
    const middle = fanGapPx(Array.from({ length: n }, (_, i) => i >= 5 && i <= 7));
    expect(middle.every((g) => g === 0)).toBe(true);
    const home = handCardPlane(aspect, n, 7, 0, 0, {}, 0, screenH);
    for (const bad of [0, NaN, Infinity]) {
      const plane = handCardPlane(aspect, n, 7, 0, 0, {}, 8, bad);
      expect(plane.x).toBeCloseTo(home.x, 6);
      expect(plane.y).toBeCloseTo(home.y, 6);
      const fan = handFan(aspect, n, 7, 0, 0, {}, 8, bad);
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

  it('brings a playable card forward without sliding the outline off its slot', () => {
    const n = 13;
    const gaps = fanGapPx(Array.from({ length: n }, (_, i) => i >= 5 && i <= 7));
    const slot = handCardPlane(aspect, n, 6, 0, 0, {}, gaps[6]!, screenH);
    const near = handCardPlane(aspect, n, 6, 0, 0, { near: LEGAL_NEAR }, gaps[6]!, screenH);
    const beside = handCardPlane(aspect, n, 9, 0, 0, {}, gaps[9]!, screenH);
    expect(LEGAL_NEAR).toBe(0.02);
    expect(slot.depth - near.depth).toBeCloseTo(LEGAL_NEAR, 6);
    // Three fan steps (0.006) is the overlap. 0.02 clears that neighbour and stays above the 16-bit z-fight.
    expect(near.depth).toBeLessThan(beside.depth);
    expect(near.x).toBeCloseTo(slot.x, 6);
    expect(near.y).toBeCloseTo(slot.y, 6);
    const px = fanLayout(aspect, n).viewH / screenH;
    const faces = [5, 6, 7].map((i) => placeOnPlane(haloLocal(1, 1), handCardPlane(aspect, n, i, 0, 0, { near: LEGAL_NEAR }, gaps[i]!, screenH)));
    const rect = groupOutline(faces, GROUP_PAD_PX * px, GROUP_RADIUS_PX * px);
    expect(rect).toBeTruthy();
    let faceX = 0;
    for (const face of faces) faceX += face.reduce((s, p) => s + p.x, 0) / face.length;
    faceX /= faces.length;
    const outlineX = rect!.reduce((s, p) => s + p.x, 0) / rect!.length;
    expect(Math.abs((outlineX - faceX) / px)).toBeLessThan(1);
    const slidePx = Math.abs((near.x - handCardPlane(aspect, n, 6, 0, 0, {}, 0, screenH).x) / px);
    expect(slidePx).toBeLessThanOrEqual(8.01);
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
