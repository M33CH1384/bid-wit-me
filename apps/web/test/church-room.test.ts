import { describe, expect, it } from 'vitest';
import { CHURCH, churchTris } from '../src/three/churchLayout';
import { CHAIR_SPOTS, STUDIO, todFromDate } from '../src/three/cubeVenue';
import { TABLE_HALF } from '../src/three/classicStudioLayout';
describe('Church Basement cube room', () => {
  it('shell + chairs', () => { expect(STUDIO.floorY).toBe(-0.9); for (const c of CHAIR_SPOTS) { if (c.x === 0) expect(Math.abs(c.z) - TABLE_HALF.z).toBeGreaterThan(0.3); else expect(Math.abs(c.x) - TABLE_HALF.x).toBeGreaterThan(0.3); } });
  it('high windows x3, benches west, urn east, fluorescent no pendants', () => { expect(CHURCH.windows).toHaveLength(3); expect(CHURCH.windows?.every((w) => w.y > 3.5)).toBe(true); expect(CHURCH.pendants).toBe(false); expect(CHURCH.floorRepeat).toEqual([4, 5]); expect(CHURCH.boxes?.filter((b) => b.p[0] < -2.5).length).toBeGreaterThanOrEqual(6); expect(CHURCH.cyls?.length).toBe(2); });
  it('budget + local TOD', () => { expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000); expect(churchTris(true)).toBeLessThan(50_000); expect(churchTris(false)).toBeLessThan(2_500); expect(todFromDate(new Date(2026, 9, 17, 13))).toBe('day'); });
});
