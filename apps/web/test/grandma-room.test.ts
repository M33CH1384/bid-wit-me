import { describe, expect, it } from 'vitest';
import { GRANDMA, grandmaTris } from '../src/three/grandmaLayout';
import { CHAIR_SPOTS, STUDIO, todFromDate } from '../src/three/cubeVenue';
import { TABLE_HALF } from '../src/three/classicStudioLayout';
import { VENUE_DEFS } from '../src/venues';

describe("Grandma's Kitchen cube room", () => {
  it('shell truth + chairs clear the table', () => { expect(STUDIO.floorY).toBe(-0.9); for (const c of CHAIR_SPOTS) { if (c.x === 0) expect(Math.abs(c.z) - TABLE_HALF.z).toBeGreaterThan(0.3); else expect(Math.abs(c.x) - TABLE_HALF.x).toBeGreaterThan(0.3); } });
  it('identity + diner-read fix: tall counter, cabinets, 2m fridge, stove, 2 windows', () => {
    expect(GRANDMA.floorRepeat).toEqual([5, 6]); expect(GRANDMA.windows).toHaveLength(2);
    expect(GRANDMA.boxes?.some((b) => b.s[1] >= 0.95 && b.p[2] < -3.5)).toBe(true);
    expect(GRANDMA.boxes?.some((b) => b.s[1] === 2.0)).toBe(true);
    expect(VENUE_DEFS.grandma.felt).toBe('#9e1b24');
  });
  it('budget + local TOD', () => { expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000); expect(grandmaTris(true)).toBeLessThan(62_000); expect(grandmaTris(false)).toBeLessThan(2_500); expect(todFromDate(new Date(2026, 9, 17, 18, 30))).toBe('golden'); });
});
