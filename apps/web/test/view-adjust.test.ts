import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_VIEW_ADJUST, VIEW_TILT_MAX, VIEW_TILT_MIN, VIEW_ZOOM_MAX, VIEW_ZOOM_MIN,
  ViewGestureTracker, __resetViewAdjustStore, applyViewAdjustToSpec, beginViewAdjustGesture,
  clampViewAdjust, endViewAdjustGesture, getViewAdjustState, isDefaultViewAdjust,
  normalizeViewAdjust, onViewAdjustCommit, resetViewAdjust, seedViewAdjust, specPitchDeg,
  tiltForDragY, updateViewAdjustLive, viewAdjustLabel, zoomForPinchDist, zoomForWheelDelta,
  type ViewAdjust, type ViewGestureEvents,
} from '../src/viewAdjust';
import { normalizeSettings } from '../src/settings';
import { cameraFor } from '../src/three/layout';

const dist = (s: { pos: readonly number[]; look: readonly number[] }) =>
  Math.hypot(s.pos[0]! - s.look[0]!, s.pos[1]! - s.look[1]!, s.pos[2]! - s.look[2]!);

describe('view adjust math', () => {
  it('clamps tilt and zoom to the shipped bounds; junk falls back per-field', () => {
    expect(clampViewAdjust({ tilt: 99, zoom: 9 })).toEqual({ tilt: VIEW_TILT_MAX, zoom: VIEW_ZOOM_MAX });
    expect(clampViewAdjust({ tilt: -99, zoom: 0 })).toEqual({ tilt: VIEW_TILT_MIN, zoom: VIEW_ZOOM_MIN });
    expect(clampViewAdjust({ tilt: Number.NaN, zoom: 1.1 })).toEqual({ tilt: 0, zoom: 1.1 });
    expect(normalizeViewAdjust(null)).toEqual(DEFAULT_VIEW_ADJUST);
    expect(normalizeViewAdjust('junk')).toEqual(DEFAULT_VIEW_ADJUST);
    expect(normalizeViewAdjust({ tilt: 8 })).toEqual({ tilt: 8, zoom: 1 });
  });

  it('the default offset returns the base spec untouched (same reference — stock framing byte-identical)', () => {
    const spec = cameraFor(390 / 844, false, 'sitting');
    expect(applyViewAdjustToSpec(spec, DEFAULT_VIEW_ADJUST)).toBe(spec);
    expect(applyViewAdjustToSpec(spec, { tilt: 0, zoom: 1 })).toBe(spec);
  });

  it('tilt pitches the aim by exactly the tilt degrees, position and fov unmoved', () => {
    const spec = cameraFor(390 / 844, false, 'sitting');
    for (const tilt of [-15, -6, 8, 15]) {
      const out = applyViewAdjustToSpec(spec, { tilt, zoom: 1 });
      expect(specPitchDeg(out)).toBeCloseTo(specPitchDeg(spec) + tilt, 6);
      expect(out.pos).toEqual(spec.pos);
      expect(out.fov).toBe(spec.fov);
      expect(out.look[0]).toBe(spec.look[0]); // never reframes sideways
    }
    // +tilt aims DOWN toward the felt; −tilt lifts the aim
    expect(applyViewAdjustToSpec(spec, { tilt: 10, zoom: 1 }).look[1]).toBeLessThan(spec.look[1]!);
    expect(applyViewAdjustToSpec(spec, { tilt: -10, zoom: 1 }).look[1]).toBeGreaterThan(spec.look[1]!);
  });

  it('zoom dollies: distance to the aim scales by 1/zoom, aim and fov unmoved', () => {
    const spec = cameraFor(844 / 390, true, 'standing');
    for (const zoom of [VIEW_ZOOM_MIN, 1.12, VIEW_ZOOM_MAX]) {
      const out = applyViewAdjustToSpec(spec, { tilt: 0, zoom });
      expect(dist(out)).toBeCloseTo(dist(spec) / zoom, 6);
      expect(out.look).toEqual(spec.look);
      expect(out.fov).toBe(spec.fov);
    }
    // tilt and zoom compose: pitched aim AND the dollied distance to that aim
    const both = applyViewAdjustToSpec(spec, { tilt: 12, zoom: 1.3 });
    expect(specPitchDeg(both)).toBeCloseTo(specPitchDeg(spec) + 12, 6);
    expect(dist(both)).toBeCloseTo(dist(spec) / 1.3, 6);
  });

  it('drag math: finger up tilts toward the table, clamped at the bounds', () => {
    expect(tiltForDragY(0, -70)).toBe(10); // 70px up at 7px/deg
    expect(tiltForDragY(0, 70)).toBe(-10);
    expect(tiltForDragY(14, -700)).toBe(VIEW_TILT_MAX);
    expect(tiltForDragY(-14, 700)).toBe(VIEW_TILT_MIN);
    expect(tiltForDragY(5, 0)).toBe(5);
  });

  it('pinch math: spreading dollies in, closing dollies out, degenerate distances are safe', () => {
    expect(zoomForPinchDist(1, 100, 130)).toBeCloseTo(1.3, 6);
    expect(zoomForPinchDist(1, 100, 85)).toBeCloseTo(0.85, 6);
    expect(zoomForPinchDist(1.2, 100, 200)).toBe(VIEW_ZOOM_MAX); // clamped
    expect(zoomForPinchDist(1.1, 0, 50)).toBe(1.1);
    expect(zoomForPinchDist(1.1, 100, 0)).toBe(1.1);
  });

  it('wheel math: wheel up dollies in, wheel down out, junk ignored', () => {
    expect(zoomForWheelDelta(1, -100)).toBeGreaterThan(1);
    expect(zoomForWheelDelta(1, 100)).toBeLessThan(1);
    expect(zoomForWheelDelta(1, -100000)).toBe(VIEW_ZOOM_MAX);
    expect(zoomForWheelDelta(1.05, Number.NaN)).toBe(1.05);
  });

  it('the readout label rounds to whole degrees and percent', () => {
    expect(viewAdjustLabel({ tilt: 8.4, zoom: 1.12 })).toBe('Tilt 8° · Zoom 112%');
    expect(viewAdjustLabel({ tilt: -3.6, zoom: 0.9 })).toBe('Tilt -4° · Zoom 90%');
    expect(viewAdjustLabel(DEFAULT_VIEW_ADJUST)).toBe('Tilt 0° · Zoom 100%');
  });
});

describe('Porch people framing at the extremes (numeric clearance)', () => {
  // Mirrors Scene.tsx's peopleSpec arithmetic (PEOPLE_CAM: raise +0.37,
  // look +0.48 / −0.38) without importing the three.js module: the pilot's
  // base spec with the player's worst-case offsets composed on top.
  const peopleOf = (s: ReturnType<typeof cameraFor>) => ({
    fov: s.fov,
    pos: [s.pos[0]!, s.pos[1]! + 0.37, s.pos[2]!],
    look: [s.look[0]!, s.look[1]! + 0.48, s.look[2]! - 0.38],
  });
  it('max tilt + max zoom: the camera never translates under tilt and stays on the player side, high above the felt', () => {
    const stock = cameraFor(390 / 844, false, 'sitting');
    const people = peopleOf(stock);
    for (const tilt of [-15, 15]) {
      const tilted = applyViewAdjustToSpec(people, { tilt, zoom: 1 });
      expect(tilted.pos).toEqual(people.pos); // tilt rotates the aim around the camera — zero translation, nothing to clip into
    }
    const extreme = applyViewAdjustToSpec(people, { tilt: 15, zoom: VIEW_ZOOM_MAX });
    expect(extreme.pos[1]).toBeGreaterThan(1.4); // felt rim is ~0.1: the dollied camera stays well above the table
    expect(extreme.pos[2]).toBeGreaterThan(1.5); // still on the player's side — never crosses the table toward the seated figures
    const wide = applyViewAdjustToSpec(people, { tilt: -15, zoom: VIEW_ZOOM_MIN });
    expect(wide.pos[1]).toBeGreaterThan(people.pos[1]!); // zooming out backs away from the aim — safer still
    // the fan refit premise: at the default offset the adjusted people spec IS the people spec
    expect(applyViewAdjustToSpec(people, DEFAULT_VIEW_ADJUST)).toBe(people);
  });
});

describe('settings persistence', () => {
  it('viewAdjust round-trips through normalizeSettings, clamped; old saves default', () => {
    const s = normalizeSettings({ viewAdjust: { tilt: 11, zoom: 1.22 } });
    expect(s.viewAdjust).toEqual({ tilt: 11, zoom: 1.22 });
    const clamped = normalizeSettings({ viewAdjust: { tilt: 400, zoom: 4 } });
    expect(clamped.viewAdjust).toEqual({ tilt: VIEW_TILT_MAX, zoom: VIEW_ZOOM_MAX });
    expect(normalizeSettings({}).viewAdjust).toEqual(DEFAULT_VIEW_ADJUST);
    expect(normalizeSettings({ viewAdjust: 'junk' }).viewAdjust).toEqual(DEFAULT_VIEW_ADJUST);
  });
});

describe('view adjust store', () => {
  afterEach(() => { __resetViewAdjustStore(); vi.useRealTimers(); });

  it('seeding loads a saved value without committing or showing the chip', () => {
    const commits: ViewAdjust[] = [];
    onViewAdjustCommit((a) => commits.push(a));
    seedViewAdjust({ tilt: 6, zoom: 1.1 });
    expect(getViewAdjustState()).toEqual({ adj: { tilt: 6, zoom: 1.1 }, adjusting: false });
    expect(commits).toEqual([]);
    seedViewAdjust({ tilt: 6, zoom: 1.1 }); // equality-guarded: no churn
    expect(getViewAdjustState().adj).toEqual({ tilt: 6, zoom: 1.1 });
  });

  it('a gesture commits once at the end and the readout lingers ~2s', () => {
    vi.useFakeTimers();
    const commits: ViewAdjust[] = [];
    onViewAdjustCommit((a) => commits.push(a));
    beginViewAdjustGesture();
    expect(getViewAdjustState().adjusting).toBe(true);
    updateViewAdjustLive({ tilt: 9, zoom: 1 });
    expect(commits).toEqual([]); // never per-move
    endViewAdjustGesture({ tilt: 9, zoom: 1 });
    expect(commits).toEqual([{ tilt: 9, zoom: 1 }]);
    expect(getViewAdjustState().adjusting).toBe(true); // lingering so it can be read
    vi.advanceTimersByTime(2100);
    expect(getViewAdjustState().adjusting).toBe(false);
  });

  it('commits even when the last live update already landed (the save is never dropped), and a drag out-and-back home saves nothing', () => {
    const commits: ViewAdjust[] = [];
    onViewAdjustCommit((a) => commits.push(a));
    seedViewAdjust({ tilt: 3, zoom: 1 });
    beginViewAdjustGesture();
    updateViewAdjustLive({ tilt: 12, zoom: 1 }); // rAF flushed before the release
    endViewAdjustGesture({ tilt: 12, zoom: 1 });
    expect(commits).toEqual([{ tilt: 12, zoom: 1 }]);
    beginViewAdjustGesture();
    updateViewAdjustLive({ tilt: -5, zoom: 1 });
    updateViewAdjustLive({ tilt: 12, zoom: 1 }); // dragged back to the saved value
    endViewAdjustGesture({ tilt: 12, zoom: 1 });
    expect(commits).toHaveLength(1);
  });

  it('reset returns to the stock framing, commits it, and is quiet when already default', () => {
    const commits: ViewAdjust[] = [];
    onViewAdjustCommit((a) => commits.push(a));
    seedViewAdjust({ tilt: -7, zoom: 1.25 });
    resetViewAdjust();
    expect(getViewAdjustState().adj).toEqual(DEFAULT_VIEW_ADJUST);
    expect(isDefaultViewAdjust(getViewAdjustState().adj)).toBe(true);
    expect(commits).toEqual([DEFAULT_VIEW_ADJUST]);
    resetViewAdjust();
    expect(commits).toHaveLength(1); // unchanged value does not re-commit
  });
});

/* ------------------------------------------------------ gesture tracker */

function rig() {
  const calls: string[] = [];
  const events: ViewGestureEvents = {
    onBegin: () => calls.push('begin'),
    onLive: (a) => calls.push(`live:${a.tilt}/${a.zoom}`),
    onEnd: (a) => calls.push(`end:${a.tilt}/${a.zoom}`),
    onReset: () => calls.push('reset'),
  };
  return { calls, tracker: new ViewGestureTracker(events) };
}
const ADJ0: ViewAdjust = { tilt: 2, zoom: 1.05 };

describe('gesture tracker', () => {
  it('a press that did not start on the table is never tracked (card/UI rejection)', () => {
    const { calls, tracker } = rig();
    tracker.down(1, 100, 100, false, ADJ0, 0);
    tracker.move(1, 100, 220);
    tracker.up(1, 100, 220, 50);
    expect(calls).toEqual([]);
    expect(tracker.active).toBe(false);
  });

  it('a plain tap changes nothing; two quick taps on the table reset', () => {
    const { calls, tracker } = rig();
    tracker.down(1, 200, 300, true, ADJ0, 1000);
    tracker.up(1, 200, 300, 1060);
    expect(calls).toEqual([]);
    tracker.down(1, 205, 298, true, ADJ0, 1200);
    tracker.up(1, 205, 298, 1260);
    expect(calls).toEqual(['reset']);
    // a third tap pair far away in time is just two taps
    tracker.down(1, 200, 300, true, ADJ0, 5000);
    tracker.up(1, 200, 300, 5060);
    tracker.down(1, 200, 300, true, ADJ0, 5600);
    tracker.up(1, 200, 300, 5660);
    expect(calls).toEqual(['reset']);
  });

  it('a drag past the threshold tilts live and commits once on release', () => {
    const { calls, tracker } = rig();
    tracker.down(1, 200, 300, true, ADJ0, 0);
    tracker.move(1, 200, 295); // under the 10px threshold: nothing yet
    expect(calls).toEqual([]);
    tracker.move(1, 200, 230); // 70px up -> tilt 2 + 10 = 12
    expect(calls).toEqual(['begin', 'live:12/1.05']);
    tracker.up(1, 200, 230, 300);
    expect(calls).toEqual(['begin', 'live:12/1.05', 'end:12/1.05']);
  });

  it('a second table pointer switches to pinch: zoom only, tilt frozen; the leftover pointer is dead', () => {
    const { calls, tracker } = rig();
    tracker.down(1, 200, 300, true, ADJ0, 0);
    tracker.move(1, 200, 230); // drag: tilt 12
    tracker.down(2, 200, 400, true, ADJ0, 50); // pinch starts (dist 170)
    tracker.move(2, 200, 430); // dist 200 -> zoom 1.05 * 200/170
    const pinchLive = calls.filter((c) => c.startsWith('live:')).pop()!;
    expect(pinchLive.startsWith('live:12/')).toBe(true); // tilt frozen at pinch start
    expect(Number(pinchLive.split('/')[1])).toBeCloseTo(1.05 * (200 / 170), 4);
    tracker.up(2, 200, 430, 120); // pinch ends -> commit; pointer 1 is now dead
    expect(calls.filter((c) => c.startsWith('end:'))).toHaveLength(1);
    const before = calls.length;
    tracker.move(1, 200, 100); // dead pointer moving changes nothing
    expect(calls).toHaveLength(before);
    tracker.up(1, 200, 100, 200);
    expect(tracker.active).toBe(false);
  });

  it('a UI pointer arriving mid-drag is ignored and the drag completes cleanly', () => {
    const { calls, tracker } = rig();
    tracker.down(1, 200, 300, true, ADJ0, 0);
    tracker.move(1, 200, 230);
    tracker.down(2, 40, 40, false, ADJ0, 50); // bid panel press: not tracked
    tracker.move(2, 40, 90);
    tracker.up(2, 40, 90, 80);
    tracker.move(1, 200, 216); // drag continues: tilt 2 + 12 = 14
    tracker.up(1, 200, 216, 120);
    expect(calls).toEqual(['begin', 'live:12/1.05', 'live:14/1.05', 'end:14/1.05']);
  });

  it('cancel mid-gesture commits the current value (rotation/posture can never corrupt or lose the offset)', () => {
    const { calls, tracker } = rig();
    tracker.down(1, 200, 300, true, ADJ0, 0);
    tracker.move(1, 200, 230);
    tracker.cancelAll();
    expect(calls).toEqual(['begin', 'live:12/1.05', 'end:12/1.05']);
    // a cancelled tap commits nothing
    const r2 = rig();
    r2.tracker.down(1, 200, 300, true, ADJ0, 0);
    r2.tracker.cancelPointer(1);
    expect(r2.calls).toEqual([]);
  });
});
