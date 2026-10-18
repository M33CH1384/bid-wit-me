import { describe, expect, it } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { VEGAS, vegasTris } from '../src/three/vegasLayout';
import { CHAIR_SPOTS, STUDIO } from '../src/three/cubeVenue';
import { TABLE_HALF } from '../src/three/classicStudioLayout';
import { VENUE_DEFS } from '../src/venues';
describe('Vegas cube room', () => {
  it('shell + chairs', () => { expect(STUDIO.floorY).toBe(-0.9); for (const c of CHAIR_SPOTS) { if (c.x === 0) expect(Math.abs(c.z) - TABLE_HALF.z).toBeGreaterThan(0.3); else expect(Math.abs(c.x) - TABLE_HALF.x).toBeGreaterThan(0.3); } });
  it('windowless, burgundy carpet, gold panels, chip table, no screens', () => { expect(VEGAS.sky).toBe(false); expect(VEGAS.floorRepeat).toEqual([4, 5]); expect(VEGAS.boxes?.filter((b) => (b.ei ?? 0) > 0).length).toBe(3); expect(VEGAS.cyls?.length).toBeGreaterThanOrEqual(4); expect(VENUE_DEFS.vegas.felt).toBe('#3d060e'); expect(VENUE_DEFS.vegas.floorTex).toBe('dirty_carpet'); });
  it('budget + texture small', () => { expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000); expect(vegasTris(true)).toBeLessThan(62_000); expect(vegasTris(false)).toBeLessThan(2_500); const p = resolve(__dirname, '../public/assets/venues/tex/dirty_carpet_512.jpg'); expect(existsSync(p)).toBe(true); expect(statSync(p).size / 1024).toBeLessThan(90); });
});
