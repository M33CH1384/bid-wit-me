import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { FELT_REST_Y, STACK_DY, flatRest, trickSpot } from '../src/three/layout';

const tiltDeg = (q: readonly number[] | Quaternion) => {
  const qq = q instanceof Quaternion ? q : new Quaternion(q[0], q[1], q[2], q[3]);
  const n = new Vector3(0, 0, 1).applyQuaternion(qq);
  return (Math.acos(Math.min(1, Math.abs(n.y))) * 180) / Math.PI;
};
const quatOf = (x: { q?: unknown; r?: unknown }) => {
  if (x.q) { const q = x.q as number[] | Quaternion; return q instanceof Quaternion ? q : new Quaternion(...(q as [number, number, number, number])); }
  const r = x.r as [number, number, number, string?];
  return new Quaternion().setFromEuler(new Euler(r[0], r[1], r[2], (r[3] as 'XYZ') ?? 'XYZ'));
};

describe('landed cards lie flat on the felt', () => {
  it('flatRest: zero tilt at any spin, felt height plus the stack step', () => {
    for (const spin of [-0.61, -0.3, 0, 0.2, 0.61]) for (const order of [0, 1, 2, 3]) {
      const x = flatRest(0.1, -0.2, spin, order);
      expect(tiltDeg(quatOf(x as never))).toBeLessThan(1e-4);
      expect(x.p[1]).toBeCloseTo(FELT_REST_Y + order * STACK_DY, 9);
    }
  });
  it('a physics-landed trick card has no lean; a Tips-on fixed spot keeps its lean', () => {
    const landed = trickSpot('bottom', 4, 2, 0.7, undefined, { dx: 0.05, dz: -0.03, spin: 0.4 });
    expect(tiltDeg(quatOf(landed as never))).toBeLessThan(1e-4);
    expect(landed.p[1]).toBeCloseTo(FELT_REST_Y + 2 * STACK_DY, 9);
    const fixed = trickSpot('bottom', 4, 2, 0.7);
    expect(tiltDeg(quatOf(fixed as never))).toBeGreaterThan(1);
  });
});
