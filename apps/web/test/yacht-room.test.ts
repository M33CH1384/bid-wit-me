import { describe, expect, it } from 'vitest';
import { YACHT, yachtTris } from '../src/three/yachtLayout';
import { CHAIR_SPOTS, STUDIO, todFromDate } from '../src/three/cubeVenue';
import { TABLE_HALF } from '../src/three/classicStudioLayout';
describe('Yacht Deck cube room', () => {
  it('open shell + chairs', () => { expect(YACHT.open).toBe(true); for (const c of CHAIR_SPOTS) { if (c.x === 0) expect(Math.abs(c.z) - TABLE_HALF.z).toBeGreaterThan(0.3); else expect(Math.abs(c.x) - TABLE_HALF.x).toBeGreaterThan(0.3); } });
  it('deck 3x5, mast far, life-ring east, sea+sky', () => { expect(YACHT.floorRepeat).toEqual([3, 5]); expect(YACHT.cyls?.some((c) => Math.abs(c.p[2] + 2.95) < 0.01 && c.a[2] > 4)).toBe(true); expect(YACHT.tori).toHaveLength(1); expect(YACHT.planes?.some((pl) => pl.sea)).toBe(true); });
  it('budget + local TOD', () => { expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000); expect(yachtTris(true)).toBeLessThan(50_000); expect(yachtTris(false)).toBeLessThan(2_500); expect(todFromDate(new Date(2026, 9, 17, 21))).toBe('night'); });
});
