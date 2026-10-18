import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { MANSION, mansionTris } from '../src/three/mansionLayout';
import { CHAIR_SPOTS, STUDIO, todFromDate } from '../src/three/cubeVenue';
import { TABLE_HALF } from '../src/three/classicStudioLayout';

describe('Mansion cube room', () => {
  it('reuses Classic shell truth and grounded chairs', () => {
    expect(STUDIO.floorY).toBe(-0.9); expect(STUDIO.roomX).toBe(3.6);
    for (const c of CHAIR_SPOTS) { if (c.x === 0) expect(Math.abs(c.z) - TABLE_HALF.z).toBeGreaterThan(0.3); else expect(Math.abs(c.x) - TABLE_HALF.x).toBeGreaterThan(0.3); }
  });
  it('identity: marble_tiles 1.5x2, 3 tall windows, columns at +-2.75, pedestal E', () => {
    expect(MANSION.floorRepeat).toEqual([1.5, 2]); expect(MANSION.windows).toHaveLength(3);
    expect(MANSION.cyls?.filter((c) => Math.abs(Math.abs(c.p[0]) - 2.75) < 0.01 && c.a[2] > 4).length).toBe(2);
    expect(MANSION.boxes?.some((b) => b.p[0] > 2.5)).toBe(true);
  });
  it('budget and local-clock TOD', () => {
    expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000); expect(mansionTris(true)).toBeLessThan(62_000); expect(mansionTris(false)).toBeLessThan(2_500);
    expect(todFromDate(new Date(2026, 9, 17, 13))).toBe('day'); expect(todFromDate(new Date(2026, 9, 17, 21))).toBe('night');
  });
  it('floor texture ships small', () => { const p = resolve(__dirname, '../public/assets/venues/tex/marble_tiles_512.jpg'); expect(existsSync(p)).toBe(true); expect(statSync(p).size / 1024).toBeLessThan(90); });
});
