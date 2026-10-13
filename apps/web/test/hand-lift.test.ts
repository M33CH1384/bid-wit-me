import { describe, expect, it } from 'vitest';
import { DEAL_LIFT_HAND } from '../src/three/dealArc';
import {
  BREATHE_HI, BREATHE_LO, BREATHE_S, BREATHE_SCALE, GAP_S, GLOW_ALPHA, GLOW_BLUR_PX, GLOW_REACH_PX, GLOW_SPREAD_PX,
  GROUP_PAD_PX, GROUP_RADIUS_PX, ILLEGAL_BRIGHTNESS, ILLEGAL_COLOR, LIFT_S, OUTLINE_COLOR, OUTLINE_PX, RAISE_S,
  GROUP_GAP_PX, LEGAL_NEAR, LEGAL_STACK, SELECT_GLOW_OP, SELECT_STACK, SHINE_DEG, SHINE_PEAK, SHINE_S, SHINE_WIDTH,
  breatheOpacity, canTapCard, cardMeshPaint, easeOut, fanGapPx, fanMotion, glowFalloff, glowRadiusPx, handDepthOpts, handLift, handRenderOrder, liftEase, outlineRadiusPx,
  handCardChrome, playablePose, posePx, raiseLocalY, shineAxis, shineBand, stackFor,
} from '../src/three/handLift';
import { fanLayout, handCardPlane, handFan } from '../src/three/layout';
import { contourContains, contiguousRuns, haloLocal, HALO_SX, HALO_SY, placeOnPlane, strokeContour, strokeRibbon, unionContours } from '../src/three/playableOutline';

describe('legal cards stay bright and outlined on their own', () => {
  it('dims only the illegal card and outlines every other playable card, not just the one you tap', () => {
    const legal = handCardChrome({ yourTurn: true, isLegal: true, selected: false, marked: false, anyIllegal: true });
    const illegal = handCardChrome({ yourTurn: true, isLegal: false, selected: false, marked: false, anyIllegal: true });
    const tapped = handCardChrome({ yourTurn: true, isLegal: true, selected: true, marked: false, anyIllegal: true });
    expect(legal).toMatchObject({ pose: 'legal', dim: false, glow: true });
    expect(illegal).toMatchObject({ pose: 'illegal', dim: true, glow: false });
    expect(tapped).toMatchObject({ pose: 'selected', dim: false, glow: true });
    // a tap does not take the ring off the other legal cards
    expect(legal.glow).toBe(true);
  });

  it('on a lead where some cards are locked, outlines the ones you can play and dims the rest', () => {
    const club = handCardChrome({ yourTurn: true, isLegal: true, selected: false, marked: false, anyIllegal: true });
    const spade = handCardChrome({ yourTurn: true, isLegal: false, selected: false, marked: false, anyIllegal: true });
    expect(club.dim).toBe(false);
    expect(club.glow).toBe(true);
    expect(spade.dim).toBe(true);
    expect(spade.glow).toBe(false);
  });

  it('does not dim the fan off turn, and does not outline an all-legal lead until you tap', () => {
    const resting = handCardChrome({ yourTurn: false, isLegal: false, selected: false, marked: false, anyIllegal: false });
    const lead = handCardChrome({ yourTurn: true, isLegal: true, selected: false, marked: false, anyIllegal: false });
    const leadTap = handCardChrome({ yourTurn: true, isLegal: true, selected: true, marked: false, anyIllegal: false });
    expect(resting).toMatchObject({ pose: 'flat', dim: false, glow: false });
    expect(lead).toMatchObject({ dim: false, glow: false });
    expect(leadTap).toMatchObject({ pose: 'selected', dim: false, glow: true });
  });
});

describe('your-turn hand poses', () => {
  it('lifts the legal group 14px, drops illegal cards 4px, and adds 10px on the tapped card', () => {
    expect(posePx('flat')).toBe(0);
    expect(posePx('illegal')).toBe(-4);
    expect(posePx('legal')).toBe(14);
    expect(posePx('selected')).toBe(24);
    expect(LIFT_S).toBe(0.2);
    expect(GAP_S).toBe(0.24);
    expect(RAISE_S).toBe(0.16);
  });

  it('raises with translateY only, and a select does not move or restack the fan', () => {
    const aspect = 390 / 844;
    const screenH = 844;
    const n = 13;
    const i = 4;
    const L = fanLayout(aspect, n);
    const fan = handFan(aspect, n, i, 0);
    const plane = handCardPlane(aspect, n, i, 0);
    for (const pose of ['flat', 'illegal', 'legal', 'selected'] as const) {
      const again = handFan(aspect, n, i, 0);
      expect(again.p).toEqual(fan.p);
      expect(again.q).toEqual(fan.q);
      expect(again.s).toBe(fan.s);
      const stayed = handCardPlane(aspect, n, i, 0);
      expect(stayed.x).toBe(plane.x);
      expect(stayed.roll).toBe(plane.roll);
      expect(stayed.depth).toBe(plane.depth);
      const localY = raiseLocalY(pose, L.viewH, screenH, L.ch);
      const px = ((localY * L.s) / L.viewH) * screenH;
      expect(px).toBeCloseTo(posePx(pose), 4);
    }
    // Baking the raise into the fan transform is what shoved an off-center card sideways for a frame.
    const baked = handFan(aspect, n, i, handLift('selected', L.viewH, screenH, L.ch), 0, { layer: 'selected' });
    expect(baked.p[0]).not.toBeCloseTo(fan.p[0], 3);
  });

  it('closes a gap by sliding, and a highlight only lifts', () => {
    expect(fanMotion({ flip: false, fresh: false, closing: true })).toEqual({ kind: 'slide', motion: 'slide', arc: 0 });
    expect(fanMotion({ flip: false, fresh: false, closing: false })).toEqual({ kind: 'lift', motion: 'lift', arc: 0 });
    expect(fanMotion({ flip: false, fresh: true, closing: true })).toEqual({ kind: 'deal', motion: 'flight', arc: DEAL_LIFT_HAND });
    expect(fanMotion({ flip: true, fresh: true, closing: true })).toEqual({ kind: 'flip', motion: 'flight', arc: 0 });
    // the slide uses the same curve as the lift, over the longer gap
    expect(liftEase(0)).toBe(0);
    expect(liftEase(1)).toBe(1);
    expect(liftEase(0.5)).toBeGreaterThan(0.5);
  });

  it('is flat off turn, and a card you cannot play is not tappable', () => {
    expect(playablePose(false, true, true)).toBe('flat');
    expect(playablePose(true, false, true)).toBe('illegal');
    expect(playablePose(true, true, false)).toBe('legal');
    expect(playablePose(true, true, true)).toBe('selected');
    expect(canTapCard('flat')).toBe(false);
    expect(canTapCard('illegal')).toBe(false);
    expect(canTapCard('legal')).toBe(true);
    expect(canTapCard('selected')).toBe(true);
    expect(stackFor('flat')).toBe('rest');
    expect(stackFor('illegal')).toBe('rest');
    expect(stackFor('legal')).toBe('play');
    expect(stackFor('selected')).toBe('selected');
  });

  it('those pixel offsets are CSS pixels on a phone, and the tapped card still stacks in front', () => {
    const aspect = 390 / 844;
    const screenH = 844;
    const n = 13;
    const i = 6;
    const L = fanLayout(aspect, n);
    const at = (pose: 'flat' | 'illegal' | 'legal' | 'selected') =>
      handCardPlane(aspect, n, i, handLift(pose, L.viewH, screenH, L.ch), 0, { layer: stackFor(pose) });
    const flat = at('flat');
    const illegal = at('illegal');
    const legal = at('legal');
    const selected = at('selected');
    const px = (a: number, b: number) => ((a - b) / L.viewH) * screenH;
    expect(px(legal.y, flat.y)).toBeCloseTo(14, 4);
    expect(px(flat.y, illegal.y)).toBeCloseTo(4, 4);
    expect(px(selected.y, legal.y)).toBeCloseTo(10, 4);
    expect(selected.depth).toBeLessThan(legal.depth);
    expect(legal.depth).toBeLessThan(illegal.depth);
    expect(illegal.depth).toBeCloseTo(flat.depth, 6);
    // z-order is the pose, not the old `lift > 0.2` shortcut (24px can be under or over that, depending on the card size)
    const flagged = handCardPlane(aspect, n, i, 0.01, 0, { layer: 'selected' });
    const resting = handCardPlane(aspect, n, i, 0.5, 0, { layer: 'rest' });
    expect(flagged.depth).toBeLessThan(resting.depth);
  });

  it('illegal cards are 55% of the brightness the old dim was tuned to', () => {
    expect(ILLEGAL_BRIGHTNESS).toBe(0.55);
    const lum = (c: readonly number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
    expect(lum(ILLEGAL_COLOR) / lum([0.2, 0.195, 0.25])).toBeCloseTo(0.55 / 0.6, 6);
  });
});

describe('group outline stroke', () => {
  it('is a 2px #F2C14E line, 10px corners, 4px out, with an 18px/4px glow that ends 16px from the cards', () => {
    expect(OUTLINE_COLOR).toBe('#F2C14E');
    expect(OUTLINE_PX).toBe(2);
    expect(outlineRadiusPx()).toBe(1);
    expect(GROUP_RADIUS_PX).toBe(10);
    expect(GROUP_PAD_PX).toBe(4);
    expect(GLOW_BLUR_PX).toBe(18);
    expect(GLOW_SPREAD_PX).toBe(4);
    expect(GLOW_ALPHA).toBeCloseTo(0.4, 6);
    expect(GLOW_REACH_PX).toBe(16);
    expect(glowRadiusPx()).toBe(GLOW_REACH_PX - GROUP_PAD_PX);
    expect(GROUP_PAD_PX + glowRadiusPx()).toBe(16);
    expect(glowFalloff(0)).toBe(1);
    // one sigma of the 18px blur (sigma = 9px) is the start of the outer fade, not yet pulled to 0
    const sigmaEdge = (GLOW_BLUR_PX / 2) / glowRadiusPx();
    expect(sigmaEdge).toBeCloseTo(0.75, 5);
    expect(glowFalloff(sigmaEdge)).toBeCloseTo(Math.exp(-0.5), 5);
    expect(glowFalloff(1)).toBe(0);
  });

  it('the crisp stroke is one CSS pixel to either side of the contour', () => {
    const aspect = 390 / 844;
    const screenH = 844;
    const L = fanLayout(aspect, 13);
    const radius = outlineRadiusPx() * (L.viewH / screenH);
    const [c] = unionContours([[
      { x: -1, y: -0.5 }, { x: 1, y: -0.5 }, { x: 1, y: 0.5 }, { x: -1, y: 0.5 },
    ]]);
    const tris = strokeContour(c!, radius);
    let maxY = -Infinity;
    for (let i = 0; i < tris.length; i += 3) {
      if (Math.abs(tris[i]!) < 0.05) maxY = Math.max(maxY, tris[i + 1]!);
    }
    const widthPx = ((maxY - 0.5) / L.viewH) * screenH;
    expect(widthPx).toBeCloseTo(outlineRadiusPx(), 2);
  });

  it('the glow ribbon carries a UV from the inside edge to the outside edge', () => {
    const [c] = unionContours([[
      { x: -1, y: -0.5 }, { x: 1, y: -0.5 }, { x: 1, y: 0.5 }, { x: -1, y: 0.5 },
    ]]);
    const { pos, uv } = strokeRibbon(c!, 0.08);
    expect(uv.length).toBe((pos.length / 3) * 2);
    expect(uv[0]).toBe(0);
    expect(uv[2]).toBe(1);
    for (let i = 0; i < uv.length; i += 2) expect(uv[i] === 0 || uv[i] === 1).toBe(true);
  });
});

describe('shine and idle breath', () => {
  it('breathes the glow between 0.3 and 0.5 on a 2.2s cycle and does not scale', () => {
    expect(BREATHE_S).toBe(2.2);
    expect(BREATHE_LO).toBe(0.3);
    expect(BREATHE_HI).toBe(0.5);
    expect(BREATHE_SCALE).toBe(1);
    expect(breatheOpacity(0)).toBeCloseTo(0.3, 5);
    expect(breatheOpacity(BREATHE_S / 2)).toBeCloseTo(0.5, 5);
    expect(breatheOpacity(BREATHE_S)).toBeCloseTo(0.3, 5);
    expect(breatheOpacity(BREATHE_S * 1.5)).toBeCloseTo(0.5, 5);
    expect(breatheOpacity(BREATHE_S / 4)).toBeCloseTo(0.4, 2);
    expect(breatheOpacity(BREATHE_S / 4)).toBeGreaterThan(0.3);
    expect(breatheOpacity(BREATHE_S / 4)).toBeLessThan(0.5);
  });

  it('sweeps a 35% band once at 105° and is dark outside the 650ms', () => {
    expect(SHINE_S).toBe(0.65);
    expect(SHINE_WIDTH).toBeCloseTo(0.35, 6);
    expect(SHINE_PEAK).toBeCloseTo(0.35, 6);
    expect(SHINE_DEG).toBe(105);
    const axis = shineAxis();
    expect(axis.x).toBeCloseTo(Math.sin((105 * Math.PI) / 180), 6);
    expect(axis.y).toBeCloseTo(Math.cos((105 * Math.PI) / 180), 6);
    const span = 100;
    expect(shineBand(span * 0.5, span, -0.01)).toBe(0);
    expect(shineBand(span * 0.5, span, 1.01)).toBe(0);
    expect(shineBand(0, span, 0)).toBe(0);
    expect(shineBand(span, span, 1)).toBe(0);
    // ease-out hits 0.5 when the band is centred on the middle of the group
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (easeOut(mid) < 0.5) lo = mid; else hi = mid;
    }
    const t = (lo + hi) / 2;
    expect(shineBand(span * 0.5, span, t)).toBeCloseTo(SHINE_PEAK, 2);
    expect(shineBand(span * 0.5 + SHINE_WIDTH * span, span, t)).toBe(0);
    expect(shineBand(span * 0.5 + span * 0.1, span, t)).toBeGreaterThan(0.1);
    let crossings = 0;
    let prev = 0;
    for (let i = 0; i <= 40; i++) {
      const a = shineBand(span * 0.5, span, i / 40);
      if (a > 0.2 && prev <= 0.2) crossings++;
      prev = a;
    }
    expect(crossings).toBe(1);
  });

  it('a selected card is another 10px up and the outline goes to 0.8, brighter than the breath', () => {
    expect(posePx('selected') - posePx('legal')).toBe(10);
    expect(SELECT_GLOW_OP).toBeCloseTo(0.8, 6);
    expect(SELECT_GLOW_OP).toBeGreaterThan(BREATHE_HI);
    expect(ILLEGAL_BRIGHTNESS).toBe(0.55);
  });
});

describe('legal cards stack above the cards beside them', () => {
  const aspect = 390 / 844;
  const screenH = 844;

  it('puts every legal card after every illegal card, and keeps index order inside each band', () => {
    const flags = [false, false, true, true, true, false, false];
    const orders = flags.map((above, i) => handRenderOrder(i, above));
    const legal = orders.filter((_, i) => flags[i]);
    const illegal = orders.filter((_, i) => !flags[i]);
    expect(Math.min(...legal)).toBeGreaterThan(Math.max(...illegal));
    expect(orders[2]).toBeLessThan(orders[3]!);
    expect(orders[3]).toBeLessThan(orders[4]!);
    expect(orders[0]).toBeLessThan(orders[1]!);
    expect(orders[5]).toBeLessThan(orders[6]!);
    // peers stay in index order. A tap is a separate front band, not another step in this one.
    expect(handRenderOrder(3, true)).toBe(LEGAL_STACK + 3);
    expect(handRenderOrder(4, true) - handRenderOrder(3, true)).toBe(1);
  });

  it('draws a selected card and its outline above every neighbour in a 13- and a 17-card hand', () => {
    const paint = (index: number, above: boolean, front = false) => {
      const order = handRenderOrder(index, above, front);
      return {
        glow: cardMeshPaint(order, 'glow').renderOrder,
        face: cardMeshPaint(order, 'face').renderOrder,
      };
    };
    const aspect = 390 / 844;
    for (const n of [13, 17]) {
      const selected = 4;
      const mine = paint(selected, true, true);
      expect(mine.face).toBeGreaterThan(mine.glow);
      expect(handRenderOrder(selected, true, true)).toBe(SELECT_STACK + selected);
      for (let i = 0; i < n; i++) {
        if (i === selected) continue;
        const legal = paint(i, true);
        const illegal = paint(i, false);
        expect(mine.glow).toBeGreaterThan(legal.face);
        expect(mine.glow).toBeGreaterThan(legal.glow);
        expect(mine.face).toBeGreaterThan(legal.face);
        expect(mine.glow).toBeGreaterThan(illegal.face);
        const sel = handCardPlane(aspect, n, selected, 0, 0, handDepthOpts('selected'), 0, 844);
        const peer = handCardPlane(aspect, n, i, 0, 0, handDepthOpts('legal'), 0, 844);
        const flat = handCardPlane(aspect, n, i, 0, 0, handDepthOpts('illegal'), 0, 844);
        expect(sel.depth).toBeLessThan(peer.depth);
        expect(sel.depth).toBeLessThan(flat.depth);
        expect(peer.depth).toBeLessThan(flat.depth);
      }
      const lead = handCardPlane(aspect, n, 0, 0, 0, handDepthOpts('legal'), 0, 844);
      const tail = handCardPlane(aspect, n, n - 1, 0, 0, handDepthOpts('illegal'), 0, 844);
      expect(lead.depth).toBeLessThan(tail.depth);
    }
    // a legal card's own ring still sits under its face, and above every flat card
    const legal = paint(0, true);
    expect(legal.face).toBeGreaterThan(legal.glow);
    expect(legal.glow).toBeGreaterThan(paint(16, false).face);
    expect(handDepthOpts('legal').near).toBe(LEGAL_NEAR);
    expect(handDepthOpts('selected').near).toBe(LEGAL_NEAR * 2);
    expect(handDepthOpts('flat')).toEqual({ layer: 'rest' });
  });

  it('opens about 8px on each side of a middle run without restacking or reordering', () => {
    expect(GROUP_GAP_PX).toBe(8);
    const n = 13;
    const flags = Array.from({ length: n }, (_, i) => i >= 5 && i <= 7);
    const gaps = fanGapPx(flags);
    expect(fanGapPx(Array.from({ length: n }, () => false)).every((g) => g === 0)).toBe(true);
    expect(fanGapPx(Array.from({ length: n }, () => true)).every((g) => g === 0)).toBe(true);
    const L = fanLayout(aspect, n);
    const px = (d: number) => (d / L.viewH) * screenH;
    const at = (i: number, gap: number) => handCardPlane(aspect, n, i, 0, 0, {}, gap, screenH);
    const gapBetween = (i: number, useGap: boolean) => {
      const a = at(i, useGap ? gaps[i]! : 0);
      const b = at(i + 1, useGap ? gaps[i + 1]! : 0);
      return px(b.x - a.x);
    };
    expect(gapBetween(4, true) - gapBetween(4, false)).toBeCloseTo(8, 2);
    expect(gapBetween(7, true) - gapBetween(7, false)).toBeCloseTo(8, 2);
    // inside the run, and between two illegal cards, the step does not change
    expect(gapBetween(5, true) - gapBetween(5, false)).toBeCloseTo(0, 2);
    expect(gapBetween(1, true) - gapBetween(1, false)).toBeCloseTo(0, 2);
    for (let i = 0; i < n; i++) {
      const moved = at(i, gaps[i]!);
      const still = at(i, 0);
      expect(moved.x).toBeGreaterThan(i === 0 ? -Infinity : at(i - 1, gaps[i - 1]!).x);
      expect(moved.depth).toBe(still.depth);
      expect(moved.roll).toBe(still.roll);
      // y only follows the fan arc as the card slides; it is not a lift
      expect(Math.abs(px(moved.y - still.y))).toBeLessThan(4);
    }
    const fan = handFan(aspect, n, 6, 0, 0, {}, gaps[6]!, screenH);
    const plain = handFan(aspect, n, 6, 0);
    expect(fan.q).toEqual(plain.q);
    expect(fan.s).toBe(plain.s);
  });
});

describe('lift easing', () => {
  it('is cubic-bezier(.2, .8, .2, 1): endpoints, monotone, and a fast start', () => {
    expect(liftEase(0)).toBe(0);
    expect(liftEase(1)).toBe(1);
    expect(liftEase(-0.2)).toBe(0);
    expect(liftEase(1.4)).toBe(1);
    let prev = -1;
    for (let i = 0; i <= 20; i++) {
      const y = liftEase(i / 20);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
    // control point (0.2, 0.8) leaves the origin steep, so a quarter of the time is most of the rise
    expect(liftEase(0.25)).toBeGreaterThan(0.7);
    expect(liftEase(0.25)).toBeLessThan(1);
  });
});

describe('non-adjacent legal cards stay separate runs', () => {
  const aspect = 390 / 844;
  const screenH = 844;

  it('a gap card is outside both outlines and sits 18px below the legal group', () => {
    const n = 13;
    const L = fanLayout(aspect, n);
    const flags = Array.from({ length: n }, (_, i) => i === 2 || i === 3 || i === 8 || i === 9 || i === 10);
    expect(contiguousRuns(flags)).toEqual([[2, 3], [8, 10]]);
    const halo = haloLocal(HALO_SX, HALO_SY, 3);
    const poseAt = (i: number) => (flags[i] ? 'legal' : 'illegal') as const;
    const plane = (i: number) => handCardPlane(aspect, n, i, handLift(poseAt(i), L.viewH, screenH, L.ch), 0, { layer: stackFor(poseAt(i)) });
    const contours = contiguousRuns(flags).map(([a, b]) => unionContours(
      Array.from({ length: b - a + 1 }, (_, k) => placeOnPlane(halo, plane(a + k))),
    ));
    expect(contours.every((cs) => cs.length === 1)).toBe(true);
    const between = plane(5);
    expect(contourContains(contours[0]![0]!, between)).toBe(false);
    expect(contourContains(contours[1]![0]!, between)).toBe(false);
    expect(contours[0]![0]!.bot[contours[0]![0]!.bot.length - 1]!.x).toBeLessThan(contours[1]![0]!.bot[0]!.x);
    const legal = plane(8);
    const drop = ((legal.y - between.y) / L.viewH) * screenH;
    // the fan arc already separates their resting heights; the turn adds 18px on top of that
    const restLegal = handCardPlane(aspect, n, 8, 0);
    const restGap = handCardPlane(aspect, n, 5, 0);
    const restPx = ((restLegal.y - restGap.y) / L.viewH) * screenH;
    expect(drop - restPx).toBeCloseTo(18, 3);
  });
});
