import { describe, expect, it } from 'vitest';
import { MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { FACE_POLYGON_OFFSET, GROUP_PAD_PX, GROUP_RADIUS_PX, LEGAL_LIFT_PX, LEGAL_NEAR, RAISE_SPREAD, RING_ABOVE, applyFaceDepthBias, cardIdFromHit, cardMeshPaint, cardPartOrder, cardTapHandlers, cssPxToPlane, echoTap, fanGapPx, handDepthOpts, handRenderOrder, hitsInPaintOrder, noteTapUp, raiseLocalY, raiseSpreadPx, resetEchoTap, screenRaise, spreadFitScale } from '../src/three/handLift';
import { pickHandCard, visibleStripPx, type HandHitCard } from '../src/three/handHit';
import { confirmPlay, feltClearsSelection } from '../src/online/playGuard';
import { FACE_CAP_GAP, HAND_DEPTH_STEP, MIN_STRIP_PX, cardScreenQuad, fanCssPx, fanLayout, handCardPlane, handFan, makeCamera, ndcExtentX, phoneHandFan, stripFloorPx } from '../src/three/layout';
import { cardGeometry } from '../src/three/geometry';
import { contourContains, groupOutline, haloLocal, placeOnPlane, planePointOk, unionContours } from '../src/three/playableOutline';

/**
 * The painter draws a higher renderOrder later. The ray sorts the same way, then by distance
 * inside one order. A raised card therefore wins wherever its face was hit. A neighbour wins
 * only on a ray that missed the card drawn over it.
 */
describe('a tap hits the card you see', () => {
  function hit(order: number, distance: number, name: string) {
    const group = { renderOrder: order, parent: null, name, userData: { cardId: name } };
    return { distance, object: { renderOrder: 0, parent: group, userData: {} }, eventObject: group, name };
  }

  it('gives a raised 7 of spades the tap across its face, and each neighbour only where that neighbour was hit', () => {
    // 5♠ sits left of the 7, K♣ sits right. The 7 is the raised card, so it paints after both.
    const five = hit(handRenderOrder(4, true), 1.2, '5S');
    const seven = hit(handRenderOrder(5, true, true), 0.9, '7S');
    const king = hit(handRenderOrder(6, true), 0.7, 'KC');
    expect(cardIdFromHit(hitsInPaintOrder([five, king, seven])[0]!.object)).toBe('7S');
    expect(cardIdFromHit(hitsInPaintOrder([king, seven])[0]!.object)).toBe('7S');
    expect(cardIdFromHit(hitsInPaintOrder([five, seven])[0]!.object)).toBe('7S');
    expect(cardIdFromHit(hitsInPaintOrder([five])[0]!.object)).toBe('5S');
    expect(cardIdFromHit(hitsInPaintOrder([king])[0]!.object)).toBe('KC');
    const aspect = 390 / 844;
    const sevenDepth = handCardPlane(aspect, 13, 5, 0, 0, handDepthOpts('selected')).depth;
    const fiveDepth = handCardPlane(aspect, 13, 4, 0, 0, handDepthOpts('legal')).depth;
    const kingDepth = handCardPlane(aspect, 13, 6, 0, 0, handDepthOpts('legal')).depth;
    expect(sevenDepth).toBeLessThan(fiveDepth);
    expect(sevenDepth).toBeLessThan(kingDepth);
    expect(handRenderOrder(5, true, true)).toBeGreaterThan(handRenderOrder(6, true));
    expect(handRenderOrder(5, true, true)).toBeGreaterThan(handRenderOrder(4, false));
  });

  it('selects the 6 of clubs when that is the only card the ray hit', () => {
    const six = hit(handRenderOrder(8, true), 1.1, '6C');
    const other = hit(handRenderOrder(2, true), 0.4, '3H');
    expect(cardIdFromHit(hitsInPaintOrder([six])[0]!.object)).toBe('6C');
    // The 6 is further right, so it paints after 3♥. A ray that hits both still lands on the 6.
    expect(cardIdFromHit(hitsInPaintOrder([other, six])[0]!.object)).toBe('6C');
    expect(confirmPlay(null, '6C', false)).toEqual({ type: 'select', card: '6C' });
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

  it('plays the raised card when it and a neighbour are both under the finger', () => {
    // Q♦ is raised, so it paints after 4♦. A ray through both faces hits the queen.
    const queen = {
      renderOrder: handRenderOrder(4, true, true),
      parent: null,
      userData: { cardId: 'QD' },
    };
    const four = {
      renderOrder: handRenderOrder(6, true),
      parent: null,
      userData: { cardId: '4D' },
    };
    const hits = [
      { distance: 0.4, object: { renderOrder: 0, parent: four, userData: {} }, eventObject: four, name: '4D' },
      { distance: 1.1, object: { renderOrder: 0, parent: queen, userData: {} }, eventObject: queen, name: 'QD' },
    ];
    const ordered = hitsInPaintOrder(hits);
    expect(cardIdFromHit(ordered[0]!.object)).toBe('QD');
    const onTheFour = hitsInPaintOrder([
      { distance: 0.4, object: { renderOrder: 0, parent: four, userData: {} }, eventObject: four, name: '4D' },
    ]);
    expect(cardIdFromHit(onTheFour[0]!.object)).toBe('4D');

    // The mesh stamp wins over a stale closure that still says 4♦.
    const played: string[] = [];
    const handlers = cardTapHandlers((id) => played.push(id), '4D');
    handlers.onPointerDown?.({ stopPropagation() {}, object: queen });
    expect(played).toEqual(['QD']);

    // Selecting Q♦ and then hitting 4♦ changes the selection. It does not play 4♦.
    expect(confirmPlay('QD', '4D', true)).toEqual({ type: 'select', card: '4D' });
    // The tap that selected Q♦ must not also play it. Play waits until that finger has lifted.
    expect(confirmPlay('QD', 'QD', false)).toEqual({ type: 'ignore' });
    // The confirming tap plays Q♦, the selected id, not the neighbour and not an index.
    const play = confirmPlay('QD', 'QD', true);
    expect(play).toEqual({ type: 'play', card: 'QD' });
    if (play.type === 'play') expect(play.card).toBe('QD');
  });

  it('keeps the neighbour that was actually hit, and the raised card stays in front of it', () => {
    // QS is raised. 10S is the next card. The queen is closer, and a ray that hit only 10S selects 10S.
    const aspect = 390 / 844;
    const queenDepth = handCardPlane(aspect, 10, 4, 0, 0, handDepthOpts('selected')).depth;
    const tenDepth = handCardPlane(aspect, 10, 5, 0, 0, handDepthOpts('legal')).depth;
    expect(queenDepth).toBeLessThan(tenDepth);
    expect(tenDepth - queenDepth).toBeGreaterThan(HAND_DEPTH_STEP);
    const ten = {
      renderOrder: handRenderOrder(5, true),
      parent: null,
      userData: { cardId: '10S' },
    };
    const hits = [
      { distance: 0.4, object: { renderOrder: 0, parent: ten, userData: {} }, eventObject: ten, name: '10S' },
    ];
    const onIt = hitsInPaintOrder(hits);
    expect(onIt).toHaveLength(1);
    expect(cardIdFromHit(onIt[0]!.object)).toBe('10S');
    expect(confirmPlay('QS', '10S', false)).toEqual({ type: 'select', card: '10S' });
    // A second tap on the queen, once she is the card under the finger, plays the queen.
    const play = confirmPlay('QS', 'QS', true);
    expect(play).toEqual({ type: 'play', card: 'QS' });
    expect(confirmPlay('QS', 'QS', false)).toEqual({ type: 'ignore' });
    expect(feltClearsSelection('QS')).toBe(true);
    expect(feltClearsSelection(null)).toBe(false);
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
    const near = handCardPlane(aspect, n, 6, 0, 0, handDepthOpts('legal'), gaps[6]!, screenH);
    expect(LEGAL_NEAR).toBeGreaterThan(0);
    expect(LEGAL_NEAR).toBeLessThan(HAND_DEPTH_STEP);
    expect(slot.depth - near.depth).toBeCloseTo(LEGAL_NEAR, 6);
    // The card to the right stays closer. A playable card that jumped in front of it hid that strip.
    const right = handCardPlane(aspect, n, 7, 0, 0, {}, gaps[7]!, screenH);
    expect(near.depth).toBeGreaterThan(right.depth);
    const raised = handCardPlane(aspect, n, 6, 0, 0, handDepthOpts('selected'), gaps[6]!, screenH);
    const rightLegal = handCardPlane(aspect, n, 7, 0, 0, handDepthOpts('legal'), gaps[7]!, screenH);
    expect(raised.depth).toBeLessThan(rightLegal.depth);
    expect(raised.x).toBeCloseTo(slot.x, 6);
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

describe('a raised card slides its neighbours apart', () => {
  const aspect = 390 / 844;
  const screenH = 844;
  const screenW = 390;

  it('opens about 40% of a card width on each side and keeps the fan on a phone', () => {
    const n = 8;
    const phone = phoneHandFan();
    const openedOpts = { ...phone, spread: RAISE_SPREAD };
    const layout = fanLayout(aspect, n, 0, openedOpts);
    const width = fanCssPx(layout, screenW).width;
    const spread = raiseSpreadPx(n, 6, width);
    expect(RAISE_SPREAD).toBeCloseTo(0.4, 5);
    // The raised card stays. Each side slides away as a block, so only the two
    // neighbour gaps grow, by 40% of a card width.
    expect(spread[6]).toBeCloseTo(0, 4);
    expect(spread[6]! - spread[5]!).toBeCloseTo(0.4 * width, 4);
    expect(spread[7]! - spread[6]!).toBeCloseTo(0.4 * width, 4);
    expect(spread[1]! - spread[0]!).toBeCloseTo(0, 4);
    expect(spread[0]).toBeCloseTo(-0.4 * width, 4);
    expect(spread[n - 1]).toBeCloseTo(0.4 * width, 4);
    expect(raiseSpreadPx(n, -1, width).every((g) => g === 0)).toBe(true);
    const edge = (i: number) => cardScreenQuad(aspect, handFan(aspect, n, i, 0, 0, openedOpts, 0, screenH), screenW, screenH);
    const scale = spreadFitScale(spread, Math.min(...edge(0).map((p) => p.x)), Math.max(...edge(n - 1).map((p) => p.x)), screenW, 8);
    expect(scale).toBeGreaterThan(0.85);
    const px = layout.viewH / screenH;
    const raised = handCardPlane(aspect, n, 6, 0, 0, openedOpts, spread[6]! * scale, screenH);
    const right = handCardPlane(aspect, n, 7, 0, 0, openedOpts, spread[7]! * scale, screenH);
    const homeRaised = handCardPlane(aspect, n, 6, 0, 0, openedOpts, 0, screenH);
    const homeRight = handCardPlane(aspect, n, 7, 0, 0, openedOpts, 0, screenH);
    const opened = ((right.x - raised.x) - (homeRight.x - homeRaised.x)) / px;
    expect(opened).toBeGreaterThan(0.34 * width);
    const fans = Array.from({ length: n }, (_, i) => handFan(aspect, n, i, 0, 0, openedOpts, spread[i]! * scale, screenH));
    const [lo, hi] = ndcExtentX(aspect, fans);
    expect(lo).toBeGreaterThan(-1.05);
    expect(hi).toBeLessThan(1.05);
  });

  it('gives the raised 7 of clubs the overlap, and the 5 only its own strip', () => {
    const seven: HandHitCard = {
      id: '7C', order: handRenderOrder(6, true, true),
      poly: [{ x: 180, y: 700 }, { x: 280, y: 700 }, { x: 280, y: 840 }, { x: 180, y: 840 }],
    };
    const five: HandHitCard = {
      id: '5C', order: handRenderOrder(7, true),
      poly: [{ x: 240, y: 720 }, { x: 340, y: 720 }, { x: 340, y: 844 }, { x: 240, y: 844 }],
    };
    const king: HandHitCard = {
      id: 'KC', order: handRenderOrder(5, true),
      poly: [{ x: 100, y: 720 }, { x: 190, y: 720 }, { x: 190, y: 844 }, { x: 100, y: 844 }],
    };
    const six: HandHitCard = {
      id: '6H', order: handRenderOrder(3, true),
      poly: [{ x: 20, y: 720 }, { x: 90, y: 720 }, { x: 90, y: 844 }, { x: 20, y: 844 }],
    };
    const cards = [six, king, seven, five];
    expect(pickHandCard(230, 760, cards)).toBe('7C');
    expect(pickHandCard(300, 760, cards)).toBe('5C');
    expect(pickHandCard(120, 760, cards)).toBe('KC');
    expect(pickHandCard(40, 760, cards)).toBe('6H');
  });

  it('treats one tap as one gesture, including the mouse event a phone adds', () => {
    resetEchoTap();
    expect(echoTap({ pointerType: 'touch', pointerId: 4 }, 'AH')).toBe(false);
    expect(echoTap({ pointerType: 'mouse', pointerId: 5 }, 'AH')).toBe(true);
    expect(echoTap({ pointerType: 'touch', pointerId: 4 }, 'AH')).toBe(false);
    expect(echoTap({ pointerType: 'touch', pointerId: 9 }, 'KC')).toBe(false);
    expect(confirmPlay(null, 'AH', false)).toEqual({ type: 'select', card: 'AH' });
    expect(confirmPlay('AH', 'AH', false)).toEqual({ type: 'ignore' });
    expect(confirmPlay('AH', 'AH', true)).toEqual({ type: 'play', card: 'AH' });
    resetEchoTap();
    expect(echoTap({ pointerType: 'mouse', pointerId: 1 }, '3H')).toBe(false);
    expect(echoTap({ pointerType: 'mouse', pointerId: 1 }, '3H')).toBe(true);
    noteTapUp();
    expect(echoTap({ pointerType: 'mouse', pointerId: 2 }, '3H')).toBe(false);
  });
});

describe('every card keeps a visible strip on a phone', () => {
  const aspect = 390 / 844;
  const screenW = 390;
  const screenH = 844;

  function hitsFor(n: number, selected: number, legalFrom: number, legalTo: number): HandHitCard[] {
    const phone = { ...phoneHandFan(), minStripPx: MIN_STRIP_PX, pxW: screenW };
    const laid = selected >= 0 ? { ...phone, spread: RAISE_SPREAD } : phone;
    const fan = fanLayout(aspect, n, 0, laid);
    const spread = raiseSpreadPx(n, selected, fanCssPx(fan, screenW).width, fan.raiseOpen > 0 ? fan.raiseOpen : undefined);
    const edge = (i: number) => cardScreenQuad(aspect, handFan(aspect, n, i, 0, 0, laid, 0, screenH), screenW, screenH);
    const scale = spreadFitScale(spread, Math.min(...edge(0).map((p) => p.x)), Math.max(...edge(n - 1).map((p) => p.x)), screenW, 1);
    return Array.from({ length: n }, (_, i) => {
      const legal = i >= legalFrom && i <= legalTo;
      const front = i === selected;
      const gap = (spread[i] ?? 0) * scale;
      const target = handFan(aspect, n, i, 0, 0, laid, gap, screenH);
      return {
        id: `c${i}`,
        order: handRenderOrder(i, legal, front),
        poly: cardScreenQuad(aspect, target, screenW, screenH, 0, false),
      };
    });
  }

  for (const n of [6, 8, 13, 17]) {
    const floor = stripFloorPx(n, screenW, phoneHandFan().edgeFrac ?? 0.018);
    it(`shows at least ${floor.toFixed(0)}px of each of ${n} cards, resting, raised, and with a suit lifted`, () => {
      const resting = hitsFor(n, -1, 0, -1);
      const raised = hitsFor(n, Math.floor(n / 2), 0, -1);
      const suit = hitsFor(n, -1, 2, Math.min(n - 1, 6));
      for (const cards of [resting, raised, suit]) {
        expect(cards).toHaveLength(n);
        for (const card of cards) {
          expect(visibleStripPx(cards, card.id), card.id).toBeGreaterThanOrEqual(floor - 1.5);
        }
      }
    });
  }
});
