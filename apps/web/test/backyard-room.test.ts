import { describe, expect, it } from 'vitest';
import { BACKYARD, backyardTris } from '../src/three/backyardLayout';
import { CHAIR_SPOTS, STUDIO, todFromDate } from '../src/three/cubeVenue';
import { TABLE_HALF } from '../src/three/classicStudioLayout';
describe('Backyard cube room', () => {
  it('open shell + chairs', () => { expect(BACKYARD.open).toBe(true); expect(STUDIO.floorY).toBe(-0.9); for (const c of CHAIR_SPOTS) { if (c.x === 0) expect(Math.abs(c.z) - TABLE_HALF.z).toBeGreaterThan(0.3); else expect(Math.abs(c.x) - TABLE_HALF.x).toBeGreaterThan(0.3); } });
  it('grass 7x8, fence, grill west, cooler east, string bulbs', () => { expect(BACKYARD.floorRepeat).toEqual([7, 8]); expect(BACKYARD.boxes?.some((b) => b.p[0] < -2.4 && b.p[2] === -2.5)).toBe(true); expect(BACKYARD.boxes?.some((b) => b.p[0] > 2.4 && b.p[2] === -2.5)).toBe(true); expect(BACKYARD.boxes?.filter((b) => (b.ei ?? 0) > 2).length).toBe(5); });
  it('budget + local TOD', () => { expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000); expect(backyardTris(true)).toBeLessThan(50_000); expect(backyardTris(false)).toBeLessThan(2_500); expect(todFromDate(new Date(2026, 9, 17, 18, 30))).toBe('golden'); });
});
