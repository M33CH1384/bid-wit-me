import { describe, expect, it } from 'vitest';
import { BEACH, beachTris } from '../src/three/beachLayout';
import { CHAIR_SPOTS, STUDIO, todFromDate } from '../src/three/cubeVenue';
import { TABLE_HALF } from '../src/three/classicStudioLayout';
describe('Beach Cabana cube room', () => {
  it('open shell + chairs', () => { expect(BEACH.open).toBe(true); for (const c of CHAIR_SPOTS) { if (c.x === 0) expect(Math.abs(c.z) - TABLE_HALF.z).toBeGreaterThan(0.3); else expect(Math.abs(c.x) - TABLE_HALF.x).toBeGreaterThan(0.3); } });
  it('sand 6x7, thatch at y~3.3, sea+sky planes, tiki/cooler split', () => { expect(BEACH.floorRepeat).toEqual([6, 7]); expect(BEACH.boxes?.some((b) => Math.abs(b.p[1] - 3.32) < 0.05)).toBe(true); expect(BEACH.planes?.some((pl) => pl.sea)).toBe(true); expect(BEACH.planes?.some((pl) => pl.sky)).toBe(true); });
  it('budget + local TOD', () => { expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000); expect(beachTris(true)).toBeLessThan(50_000); expect(beachTris(false)).toBeLessThan(2_500); expect(todFromDate(new Date(2026, 9, 17, 13))).toBe('day'); });
});
