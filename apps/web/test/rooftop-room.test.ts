import { describe, expect, it } from 'vitest';
import { ROOFTOP, rooftopTris } from '../src/three/rooftopLayout';
import { CHAIR_SPOTS, STUDIO, todFromDate } from '../src/three/cubeVenue';
import { TABLE_HALF } from '../src/three/classicStudioLayout';
describe('Rooftop cube room', () => {
  it('open shell + chairs', () => { expect(ROOFTOP.open).toBe(true); for (const c of CHAIR_SPOTS) { if (c.x === 0) expect(Math.abs(c.z) - TABLE_HALF.z).toBeGreaterThan(0.3); else expect(Math.abs(c.x) - TABLE_HALF.x).toBeGreaterThan(0.3); } });
  it('concrete 3x4, parapet low, skyline tall at z=-5.4 with lit windows, vent west', () => {
    expect(ROOFTOP.floorRepeat).toEqual([3, 4]);
    expect(ROOFTOP.floorUrl).toContain('brushed_concrete');
    const towers = (ROOFTOP.boxes ?? []).filter((b) => b.p[2] < -5 && b.s[1] > 2.5);
    expect(towers.length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...towers.map((b) => b.s[1]))).toBeGreaterThanOrEqual(6);
    expect((ROOFTOP.boxes ?? []).some((b) => b.e === '#ffd98a')).toBe(true);
    expect((ROOFTOP.boxes ?? []).some((b) => b.p[0] < -2.8 && b.p[2] < -2)).toBe(true); // vent W
  });
  it('budget + local TOD', () => { expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000); expect(rooftopTris(true)).toBeLessThan(55_000); expect(rooftopTris(false)).toBeLessThan(2_500); expect(todFromDate(new Date(2026, 9, 17, 21))).toBe('night'); });
});
