import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { funnelFling, funnelGrow, funnelRadius, slipperPose } from '../src/three/slipperPath';

describe('ruby slippers in the Run it! funnel', () => {
  it('rides the funnel wall: horizontal radius and height match the dust profile at its height', () => {
    for (let u = 0.2; u <= 2.2; u += 0.13) {
      for (const i of [0, 1] as const) {
        const p = slipperPose(u, i);
        expect(Math.hypot(p.x, p.z)).toBeCloseTo(funnelRadius(p.h, funnelFling(u)) + (i === 1 ? 0.02 : 0), 9);
        expect(p.y).toBeCloseTo(p.h * 1.9 * funnelGrow(u), 9);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1.9);
      }
    }
  });

  it('travels as a pair: close in height and angle whenever both are on show', () => {
    let checked = 0;
    for (let u = 0.2; u <= 2.2; u += 0.05) {
      const a = slipperPose(u, 0);
      const b = slipperPose(u, 1);
      if (a.alpha < 0.25 || b.alpha < 0.25) continue;
      checked++;
      expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(0.22);
      const angA = Math.atan2(a.z, a.x);
      const angB = Math.atan2(b.z, b.x);
      let d = Math.abs(angA - angB) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      expect(d).toBeLessThanOrEqual(0.75);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('is invisible before the funnel grows and after the fling, and on show in between', () => {
    expect(slipperPose(0, 0).alpha).toBe(0);
    expect(slipperPose(0, 1).alpha).toBe(0);
    expect(slipperPose(2.3, 0).alpha).toBe(0);
    expect(slipperPose(2.3, 1).alpha).toBe(0);
    expect(slipperPose(1.0, 0).alpha).toBeGreaterThan(0.5);
    expect(slipperPose(1.0, 1).alpha).toBeGreaterThan(0.5);
  });

  it('never pops at the height wrap: the envelope hugs zero at both ends of the loop', () => {
    for (let u = 0.2; u <= 2.3; u += 0.01) {
      for (const i of [0, 1] as const) {
        const p = slipperPose(u, i);
        if (p.h > 0.96) expect(p.alpha).toBeLessThan(0.05);
        if (p.h < 0.012) expect(p.alpha).toBeLessThan(0.2);
      }
    }
  });

  it('glints: the sparkle strength breathes and never exceeds the body envelope', () => {
    const gs = [0.5, 0.8, 1.1, 1.4, 1.7].map((u) => slipperPose(u, 0).glint);
    expect(Math.max(...gs)).toBeGreaterThan(Math.min(...gs));
    for (let u = 0; u <= 2.3; u += 0.1) {
      for (const i of [0, 1] as const) {
        const p = slipperPose(u, i);
        expect(p.glint).toBeGreaterThanOrEqual(0);
        expect(p.glint).toBeLessThanOrEqual(p.alpha + 1e-9);
      }
    }
  });
});

describe('the slippers are part of the one tornado stage (both run kinds)', () => {
  const tornado = readFileSync(new URL('../src/three/Tornado3D.tsx', import.meta.url), 'utf8');
  const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

  it('Tornado3D builds the pair and drives it from the funnel clock and show flag', () => {
    expect(tornado).toContain('buildSlipper');
    expect(tornado).toContain('slipperPose');
    expect(tornado).toContain('__bwmSlippersDrawn');
    // suppressed with the funnel: the same `show` that gates the points gates the rigs
    expect(tornado).toContain('if (!show) for (const s of slippers) s.group.visible = false;');
  });

  it('regular and mega runs alike set fx.tornado — the one stage the slippers ride', () => {
    expect(table).toContain('RUN_MEGA_TORNADO_AFTER_MS');
    expect(table).toContain('fx.tornado = {');
  });
});
