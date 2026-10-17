import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../src/settings';
import { dragSlamIntensity, isVGesture, type DragSample } from '../src/slam';
import { CAMERA_VIEW_TWEEN_MS, TRICK_SCALE, cameraFor, cameraPoseAt, cardScreenQuad, fanCssPx, fanLayout, handFan, phoneHandFan, PHONE_HAND_STRIP_PX } from '../src/three/layout';

const path = (pts: [number, number][]): DragSample[] => pts.map(([x, y], i) => ({ t: i * 40, x, y }));
describe('camera view', () => {
  it('sitting is lower than standing, reframed so the hand fan fits (wider fov, aim toward hand)', () => {
    const st = cameraFor(390 / 844, false, 'standing'); const si = cameraFor(390 / 844, false, 'sitting');
    expect(si.pos[1]).toBeLessThan(st.pos[1]);
    expect(si.fov).toBeGreaterThan(st.fov); expect(si.look[2]).toBeGreaterThan(st.look[2]);
  });
  it('sitting is low and over the table: lower + closer than the first cut, standing untouched', () => {
    const st = cameraFor(390 / 844, false, 'standing'); const si = cameraFor(390 / 844, false, 'sitting');
    expect(st.pos).toEqual([0, 4.5, 3.75]); // standing unchanged
    expect(si.pos[1]).toBeLessThan(2.1); // lower (was 2.61)
    expect(si.pos[2]).toBeLessThan(3.1); // closer over the felt (was 3.5625)
    const dist = (c: typeof si) => Math.hypot(c.pos[1] - c.look[1], c.pos[2] - c.look[2]);
    expect(dist(si)).toBeLessThan(dist(st)); // nearer the trick cards lying on the felt
  });
  it('bigger cards: trick scale is +25% and the phone fan grew while keeping its strip', () => {
    expect(TRICK_SCALE).toBe(2.25); // was 1.8 (#166 shrink), +25% per Demetrius
    const L = fanLayout(390 / 844, 13, 0, { ...phoneHandFan(), view: 'sitting', pxW: 390, minStripPx: PHONE_HAND_STRIP_PX });
    const px = fanCssPx(L, 390);
    expect(px.width).toBeGreaterThanOrEqual(76); // 68.3px before -> 77.1px (+13%, strip-bound on phone)
    expect(px.exposed).toBeGreaterThanOrEqual(42);
  });
  it('sitting applies in short landscape too', () => {
    const st = cameraFor(844 / 390, true, 'standing'); const si = cameraFor(844 / 390, true, 'sitting');
    expect(si.pos[1]).toBeLessThan(st.pos[1]); expect(si.fov).toBeGreaterThan(st.fov);
  });
  it('camera tween: 0.7s wall-clock, intermediate poses, never a 1-frame jump from a huge first dt', () => {
    const st = cameraFor(390 / 844, false, 'standing'), si = cameraFor(390 / 844, false, 'sitting');
    expect(CAMERA_VIEW_TWEEN_MS).toBeGreaterThanOrEqual(500); expect(CAMERA_VIEW_TWEEN_MS).toBeLessThanOrEqual(900);
    const mid = cameraPoseAt(st.pos, si.pos, st.look, si.look, CAMERA_VIEW_TWEEN_MS / 2);
    expect(mid.t).toBe(0.5); expect(mid.pos[1]).toBeLessThan(st.pos[1]!); expect(mid.pos[1]).toBeGreaterThan(si.pos[1]!);
    expect(mid.look[2]).toBeGreaterThan(st.look[2]!); expect(mid.look[2]).toBeLessThan(si.look[2]!); // look animates too (was instant)
    expect(cameraPoseAt(st.pos, si.pos, st.look, si.look, 0).pos[1]).toBe(st.pos[1]);
    expect(cameraPoseAt(st.pos, si.pos, st.look, si.look, 99999).t).toBe(1);
  });
  it('sitting hand: all 13 cards inside 390x844 and above an injected 34px home indicator + Safari chrome line', () => {
    const W = 390, H = 844, chrome = 34 + 50; // home indicator + bottom bar, as on Demetrius's iPhone
    const o = { ...phoneHandFan(), view: 'sitting' as const, bottomFrac: (phoneHandFan().bottomFrac ?? 0) + (34 + 12) / H, minStripPx: 36, pxW: W };
    for (let i = 0; i < 13; i++) {
      const poly = cardScreenQuad(W / H, handFan(W / H, 13, i, 0, 0, o, 0, H), W, H, 0, false, 'sitting');
      for (const pt of poly) { expect(pt.x).toBeGreaterThanOrEqual(-1); expect(pt.x).toBeLessThanOrEqual(W + 1); expect(pt.y).toBeGreaterThanOrEqual(-1); expect(pt.y).toBeLessThanOrEqual(H - chrome + 1); }
    }
  });
  it('view setting normalises: no saved preference -> Sitting; a saved choice always wins', () => {
    expect(normalizeSettings({}).view).toBe('sitting'); // new player default
    expect(normalizeSettings({ view: undefined as never }).view).toBe('sitting');
    expect(normalizeSettings({ view: 'floor' as never }).view).toBe('sitting');
    expect(normalizeSettings({ view: 'standing' as never }).view).toBe('standing'); // saved Standing respected exactly
    expect(normalizeSettings({ view: 'sitting' as never }).view).toBe('sitting'); // saved Sitting respected exactly
  });
  it('V gesture: continuous up then down slams in sitting; straight drag stays gentle', () => {
    const v = path([[195, 700], [195, 640], [195, 580], [195, 640], [195, 700], [180, 430]]);
    // final release point is over the felt; the V legs are the first five samples
    expect(isVGesture(v.slice(0, 5))).toBe(true);
    expect(dragSlamIntensity(v.slice(0, 5), 'sitting')).toBe(1);
    const straight = path([[195, 700], [195, 690], [195, 680], [195, 670], [195, 660]]); // slow straight drag, no V
    expect(isVGesture(straight)).toBe(false);
    expect(dragSlamIntensity(straight, 'sitting')).toBe(0);
    const fastStraight = path([[195, 700], [195, 560], [195, 420], [195, 300]]); // fast, no V
    expect(dragSlamIntensity(fastStraight, 'sitting')).toBe(0);
    const fastFlickUp = path([[195, 700], [195, 500], [195, 320]]);
    expect(dragSlamIntensity(fastFlickUp, 'sitting')).toBe(0);
    expect(dragSlamIntensity(straight, 'standing')).toBe(1);
    expect(isVGesture(path([[195, 700], [195, 690], [195, 700]]))).toBe(false); // legs too small
  });
});
