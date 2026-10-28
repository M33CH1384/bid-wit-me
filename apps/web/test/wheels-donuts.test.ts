import { describe, expect, it } from 'vitest';
import {
  carSweepAt, donutRadii, wheelPoints, wheelsBlastReaction, wheelsPoseAt,
  WHEELS_DONUT_END_S, WHEELS_ENTER_S, WHEELS_SHOW_S,
} from '../src/wheelsDonuts';
import { sedanBlastReaction, sedanBlastReducer, type SedanBlastState } from '../src/three/pjsSedanBlast';

const view = { w: 390, h: 844, carW: 140 };
const center = { x: 195, y: 380 };
const { rx, ry } = donutRadii(view.carW);

describe('wheels car — the doughnuts are its own show', () => {
  it('swings in from off the left of the felt during the enter phase', () => {
    const p = wheelsPoseAt(0.05, view, center);
    expect(p.phase).toBe('enter');
    expect(p.cx).toBeLessThan(center.x - rx); // still left of the doughnut
    const mid = wheelsPoseAt(WHEELS_ENTER_S - 0.01, view, center);
    expect(mid.cx).toBeCloseTo(center.x, 0); // arrives at the top of the ellipse
    expect(mid.cy).toBeCloseTo(center.y - ry, 0);
  });

  it('stays on the doughnut ellipse for the whole donut phase', () => {
    for (let t = WHEELS_ENTER_S; t < WHEELS_DONUT_END_S; t += 0.07) {
      const p = wheelsPoseAt(t, view, center);
      expect(p.phase).toBe('donuts');
      const e = ((p.cx - center.x) / rx) ** 2 + ((p.cy - center.y) / ry) ** 2;
      expect(e).toBeCloseTo(1, 6);
    }
  });

  it('lays about 1¾ turns', () => {
    let swept = 0, prev = Math.atan2(-ry, 0); // starts at the top of the ellipse
    for (let t = WHEELS_ENTER_S + 0.02; t < WHEELS_DONUT_END_S; t += 0.02) {
      const p = wheelsPoseAt(t, view, center);
      const a = Math.atan2((p.cy - center.y) / ry, (p.cx - center.x) / rx);
      let d = a - prev;
      while (d < -Math.PI) d += Math.PI * 2;
      while (d > Math.PI) d -= Math.PI * 2;
      swept += d;
      prev = a;
    }
    expect(Math.abs(swept)).toBeGreaterThan(1.6 * Math.PI * 2);
    expect(Math.abs(swept)).toBeLessThan(1.9 * Math.PI * 2);
  });

  it('slides around the circle — never mirrored, never upside down', () => {
    // a doughnut is a powerslide: the side-view car holds its facing and leans;
    // mirroring mid-circle would pop and a full roll reads wrong from this angle.
    for (let t = 0; t < WHEELS_SHOW_S; t += 0.05) {
      const p = wheelsPoseAt(t, view, center);
      expect(p.flip).toBe(false);
      expect(Math.abs(p.rot)).toBeLessThanOrEqual(21);
    }
    let lean = 0;
    for (let t = WHEELS_ENTER_S; t < WHEELS_DONUT_END_S; t += 0.05) lean = Math.max(lean, Math.abs(wheelsPoseAt(t, view, center).rot));
    expect(lean).toBeGreaterThan(8); // the lean is visibly there during the doughnuts
  });

  it('peels off the right edge by the end of the show', () => {
    const p = wheelsPoseAt(WHEELS_SHOW_S - 0.02, view, center);
    expect(p.phase).toBe('exit');
    expect(p.cx).toBeGreaterThan(view.w - view.carW * 0.4);
    expect(wheelsPoseAt(WHEELS_SHOW_S + 0.1, view, center).phase).toBe('gone');
  });

  it('wheel points keep the axle spacing of the car art', () => {
    const p = wheelsPoseAt(1.3, view, center);
    const w = wheelPoints(p, view);
    const d = Math.hypot(w.front.x - w.rear.x, w.front.y - w.rear.y);
    expect(d).toBeCloseTo(((284 - 78) / 360) * view.carW, 4);
  });
});

describe('wheels car — the nuke shows no favourites', () => {
  const from = wheelsPoseAt(1.25, view, center); // mid-doughnuts

  it('is untouched until the flash lands', () => {
    expect(carSweepAt(-0.01, from, center, false, false, view)).toBeNull();
  });

  it('a nuke sweeps the donut-ing car off the table', () => {
    const s = carSweepAt(0.9, from, center, false, false, view);
    expect(s).not.toBeNull();
    const d0 = Math.hypot(from.cx - center.x, from.cy - center.y);
    const d1 = Math.hypot(s!.cx - center.x, s!.cy - center.y);
    expect(d1).toBeGreaterThan(d0 + 500); // carried well off the felt
    expect(Math.abs(s!.rot)).toBeGreaterThan(120); // tumbling
    expect(carSweepAt(1.7, from, center, false, false, view)!.gone).toBe(true);
  });

  it('a mega throws it farther than a nuke at the same instant', () => {
    const n = carSweepAt(0.8, from, center, false, false, view)!;
    const m = carSweepAt(0.8, from, center, true, false, view)!;
    const dn = Math.hypot(n.cx - from.cx, n.cy - from.cy);
    const dm = Math.hypot(m.cx - from.cx, m.cy - from.cy);
    expect(dm).toBeGreaterThan(dn * 1.25);
  });

  it("the mega's second detonation re-kicks it mid-flight", () => {
    const before = carSweepAt(1.1, from, center, true, false, view)!;
    const after = carSweepAt(1.5, from, center, true, false, view)!;
    const nBefore = carSweepAt(1.1, from, center, false, false, view)!;
    const nAfter = carSweepAt(1.5, from, center, false, false, view)!;
    const megaGain = Math.hypot(after.cx - before.cx, after.cy - before.cy);
    const nukeGain = Math.hypot(nAfter.cx - nBefore.cx, nAfter.cy - nBefore.cy);
    expect(megaGain).toBeGreaterThan(nukeGain * 1.1);
  });

  it('calm (OS reduce-motion): flung without the tumble, and fades', () => {
    const s = carSweepAt(0.3, from, center, false, true, view)!;
    expect(s.rot).toBe(0);
    expect(s.opacity).toBeLessThan(0.4);
    expect(carSweepAt(0.5, from, center, false, true, view)!.gone).toBe(true);
  });

  it("gate: 'off' mode has no sweep anywhere, so the car keeps its show", () => {
    expect(wheelsBlastReaction('nuke', 'off')).toBe('none');
    expect(wheelsBlastReaction('mega', 'off')).toBe('none');
    expect(wheelsBlastReaction('nuke', 'full')).toBe('swept');
    expect(wheelsBlastReaction('mega', 'full')).toBe('mega-swept');
    expect(wheelsBlastReaction('mega', 'lite')).toBe('mega-swept');
  });
});

describe('the fork — both cars, one detonation', () => {
  it('car on the table doing doughnuts → swept; parked sedan → launched; both at once', () => {
    // the two reactions are independent subscriptions to the same fx event:
    // neither consults the other, so both fire simultaneously.
    expect(wheelsBlastReaction('nuke', 'full')).toBe('swept');
    expect(sedanBlastReaction('nuke', 'full')).toBe('nuke');
    const parked: SedanBlastState = { phase: 'parked' };
    const after = sedanBlastReducer(parked, { type: 'blast', at: 1000, mega: false, calm: false });
    expect(after.phase).toBe('flying');
  });

  it('only the sedan present → it still launches (the wheels car is not consulted)', () => {
    expect(sedanBlastReaction('mega', 'full')).toBe('mega');
  });
});
