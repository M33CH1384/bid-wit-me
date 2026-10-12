import { describe, expect, it } from 'vitest';
import {
  GLOW_ALPHA, GLOW_BLUR_PX, ILLEGAL_BRIGHTNESS, ILLEGAL_COLOR, LIFT_S, OUTLINE_COLOR, OUTLINE_PX,
  canTapCard, glowFalloff, glowRadiusPx, handLift, liftEase, outlineRadiusPx, playablePose, posePx, stackFor,
} from '../src/three/handLift';
import { fanLayout, handCardPlane } from '../src/three/layout';
import { contourContains, contiguousRuns, haloLocal, HALO_SX, HALO_SY, placeOnPlane, strokeContour, strokeRibbon, unionContours } from '../src/three/playableOutline';

describe('your-turn hand poses', () => {
  it('lifts the legal group 14px, drops illegal cards 4px, and adds 10px on the tapped card', () => {
    expect(posePx('flat')).toBe(0);
    expect(posePx('illegal')).toBe(-4);
    expect(posePx('legal')).toBe(14);
    expect(posePx('selected')).toBe(24);
    expect(LIFT_S).toBe(0.2);
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
  it('is a 2px #F2C14E line with a 16px glow at 45%', () => {
    expect(OUTLINE_COLOR).toBe('#F2C14E');
    expect(OUTLINE_PX).toBe(2);
    expect(outlineRadiusPx()).toBe(1);
    expect(GLOW_BLUR_PX).toBe(16);
    expect(GLOW_ALPHA).toBeCloseTo(0.45, 6);
    expect(glowRadiusPx()).toBe(48);
    expect(glowFalloff(0)).toBe(1);
    expect(glowFalloff(1 / 3)).toBeCloseTo(Math.exp(-0.5), 5);
    expect(glowFalloff(1)).toBeLessThan(0.02);
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
