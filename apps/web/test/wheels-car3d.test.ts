import { describe, expect, it } from 'vitest';
import {
  DONUT, WHEELS3D_DONUT_END_S, WHEELS3D_ENTER_S, WHEELS3D_SHOW_S,
  wheelPoints3d, wheelsCarBlastLen, wheelsCarBlastPoseAt, wheelsPose3dAt,
} from '../src/three/wheelsCar3d';
import { FELT } from '../src/three/layout';
import { wheelsBlastReaction } from '../src/wheelsDonuts';
import { sedanBlastReaction, sedanBlastReducer, type SedanBlastState } from '../src/three/pjsSedanBlast';

const dims = { len: 1.15, wid: 0.56 };
const forward = (yaw: number): [number, number] => [Math.cos(yaw), -Math.sin(yaw)];

describe('wheels car 3D — the doughnuts are its own show, in world space', () => {
  it('drives in from off the left of the felt, hopping the rail', () => {
    const p = wheelsPose3dAt(0.03);
    expect(p.phase).toBe('enter');
    expect(p.x).toBeLessThan(-FELT.hx); // still off the felt
    let peakY = 0;
    for (let t = 0; t < WHEELS3D_ENTER_S; t += 0.03) peakY = Math.max(peakY, wheelsPose3dAt(t).y);
    expect(peakY).toBeGreaterThan(0.1); // the rail hop
    const landed = wheelsPose3dAt(WHEELS3D_ENTER_S - 0.005);
    expect(landed.x).toBeCloseTo(DONUT.cx, 1); // arrives at the top of the ellipse
    expect(landed.z).toBeCloseTo(DONUT.cz - DONUT.rz, 1);
    expect(landed.y).toBeCloseTo(0, 2); // settled on the cloth
  });

  it('stays on the doughnut ellipse for the whole donut phase', () => {
    for (let t = WHEELS3D_ENTER_S; t < WHEELS3D_DONUT_END_S; t += 0.05) {
      const p = wheelsPose3dAt(t);
      expect(p.phase).toBe('donuts');
      const e = ((p.x - DONUT.cx) / DONUT.rx) ** 2 + ((p.z - DONUT.cz) / DONUT.rz) ** 2;
      expect(e).toBeCloseTo(1, 6);
      expect(p.y).toBe(0);
    }
  });

  it('lays about 1¾ turns', () => {
    let swept = 0, prev = Math.atan2(-DONUT.rz, 0);
    for (let t = WHEELS3D_ENTER_S + 0.02; t < WHEELS3D_DONUT_END_S; t += 0.02) {
      const p = wheelsPose3dAt(t);
      const a = Math.atan2((p.z - DONUT.cz) / DONUT.rz, (p.x - DONUT.cx) / DONUT.rx);
      let d = a - prev;
      while (d < -Math.PI) d += Math.PI * 2;
      while (d > Math.PI) d -= Math.PI * 2;
      swept += d;
      prev = a;
    }
    expect(Math.abs(swept)).toBeGreaterThan(1.6 * Math.PI * 2);
    expect(Math.abs(swept)).toBeLessThan(1.9 * Math.PI * 2);
  });

  it('keeps the whole car on the felt through the doughnuts', () => {
    for (let t = WHEELS3D_ENTER_S; t < WHEELS3D_DONUT_END_S; t += 0.04) {
      const p = wheelsPose3dAt(t);
      const reach = Math.max(Math.abs(p.x), Math.abs(p.z)) + dims.len / 2;
      expect(Math.abs(p.x) + dims.len / 2).toBeLessThan(FELT.hx + 0.05);
      expect(Math.abs(p.z) + dims.len / 2).toBeLessThan(FELT.hz + 0.05);
      expect(reach).toBeGreaterThan(0); // (reach is a sanity bound, not the gate)
    }
  });

  it('powerslides: the nose sits inside the tangent, most at mid-doughnut', () => {
    const slipAt = (t: number): number => {
      const p = wheelsPose3dAt(t);
      const q = wheelsPose3dAt(t + 0.02);
      const vx = q.x - p.x, vz = q.z - p.z;
      const vl = Math.hypot(vx, vz) || 1;
      const [fx, fz] = forward(p.yaw);
      const dot = (fx * vx + fz * vz) / vl;
      return Math.acos(Math.min(1, Math.max(-1, dot)));
    };
    const mid = slipAt(WHEELS3D_ENTER_S + (WHEELS3D_DONUT_END_S - WHEELS3D_ENTER_S) / 2);
    expect(mid).toBeGreaterThan(0.22); // a real slip angle, ~0.38 rad at full lock
    expect(mid).toBeLessThan(0.5);
    const early = slipAt(WHEELS3D_ENTER_S + 0.03);
    expect(early).toBeLessThan(mid); // ramps in, doesn't snap
  });

  it('leans into the turn during the doughnuts, upright entering and leaving', () => {
    let lean = 0;
    for (let t = WHEELS3D_ENTER_S; t < WHEELS3D_DONUT_END_S; t += 0.05) lean = Math.max(lean, wheelsPose3dAt(t).roll);
    expect(lean).toBeGreaterThan(0.08);
    for (let t = 0; t < WHEELS3D_SHOW_S; t += 0.05) {
      const p = wheelsPose3dAt(t);
      expect(Math.abs(p.roll)).toBeLessThanOrEqual(0.14);
      expect(Math.abs(p.pitch)).toBeLessThanOrEqual(0.05);
    }
  });

  it('peels off the right edge by the end of the show', () => {
    const p = wheelsPose3dAt(WHEELS3D_SHOW_S - 0.02);
    expect(p.phase).toBe('exit');
    expect(p.x).toBeGreaterThan(FELT.hx); // already past the rail
    expect(wheelsPose3dAt(WHEELS3D_SHOW_S + 0.1).phase).toBe('gone');
  });

  it('wheel points: rear pair behind, front pair ahead, track spacing held', () => {
    const p = wheelsPose3dAt(1.3);
    const w = wheelPoints3d(p, dims);
    const [fx, fz] = forward(p.yaw);
    const along = (pt: [number, number]) => (pt[0] - p.x) * fx + (pt[1] - p.z) * fz;
    expect(along(w.rearL)).toBeCloseTo(-0.31 * dims.len, 6);
    expect(along(w.frontL)).toBeCloseTo(0.31 * dims.len, 6);
    const track = Math.hypot(w.rearL[0] - w.rearR[0], w.rearL[1] - w.rearR[1]);
    expect(track).toBeCloseTo(2 * 0.38 * dims.wid, 6);
  });
});

describe('wheels car 3D — the nuke shows no favourites', () => {
  const from = wheelsPose3dAt(1.25); // mid-doughnuts

  it('is untouched until the flash lands', () => {
    expect(wheelsCarBlastPoseAt(-0.01, from, { mega: false, calm: false })).toBeNull();
  });

  it('a nuke sweeps the donut-ing car off the table', () => {
    const s = wheelsCarBlastPoseAt(0.9, from, { mega: false, calm: false })!;
    expect(s).not.toBeNull();
    const off = Math.hypot(s.off[0], s.off[2]);
    expect(off).toBeGreaterThan(4.5); // carried well off the felt (reach ≈ 5.6 by then)
    expect(Math.abs(s.rot[0])).toBeGreaterThan(1); // tumbling
    expect(wheelsCarBlastPoseAt(wheelsCarBlastLen(false, false) + 0.01, from, { mega: false, calm: false })!.visible).toBe(false);
  });

  it('a mega throws it farther than a nuke at the same instant', () => {
    const n = wheelsCarBlastPoseAt(0.8, from, { mega: false, calm: false })!;
    const m = wheelsCarBlastPoseAt(0.8, from, { mega: true, calm: false })!;
    const dn = Math.hypot(n.off[0], n.off[2]);
    const dm = Math.hypot(m.off[0], m.off[2]);
    expect(dm).toBeGreaterThan(dn * 1.2);
  });

  it("the mega's second detonation re-kicks it mid-flight", () => {
    const gain = (mega: boolean) => {
      const a = wheelsCarBlastPoseAt(1.1, from, { mega, calm: false })!;
      const b = wheelsCarBlastPoseAt(1.5, from, { mega, calm: false })!;
      return Math.hypot(b.off[0] - a.off[0], b.off[2] - a.off[2]);
    };
    expect(gain(true)).toBeGreaterThan(gain(false) * 1.1);
  });

  it('calm (OS reduce-motion): flung without the tumble, gone sooner', () => {
    const s = wheelsCarBlastPoseAt(0.3, from, { mega: false, calm: true })!;
    expect(s.rot[0]).toBe(0);
    expect(s.rot[2]).toBe(0);
    expect(s.rot[1]).toBeCloseTo(from.yaw, 6); // keeps its heading, just slides
    expect(wheelsCarBlastPoseAt(1.1, from, { mega: false, calm: true })!.visible).toBe(false);
    expect(wheelsCarBlastLen(false, true)).toBeLessThan(wheelsCarBlastLen(false, false));
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
  it('car on the table doing doughnuts → swept in 3D; parked sedan → launched; both at once', () => {
    // the two reactions are independent subscriptions to the same fx event:
    // neither consults the other, so both fire simultaneously.
    expect(wheelsBlastReaction('nuke', 'full')).toBe('swept');
    expect(sedanBlastReaction('nuke', 'full')).toBe('nuke');
    const parked: SedanBlastState = { phase: 'parked' };
    const after = sedanBlastReducer(parked, { type: 'blast', at: 1000, mega: false, calm: false });
    expect(after.phase).toBe('flying');
    const pose = wheelsCarBlastPoseAt(0.6, wheelsPose3dAt(1.4), { mega: false, calm: false });
    expect(pose).not.toBeNull();
  });

  it('only the sedan present → it still launches (the wheels car is not consulted)', () => {
    expect(sedanBlastReaction('mega', 'full')).toBe('mega');
  });
});
