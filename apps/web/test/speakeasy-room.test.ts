import { describe, expect, it } from 'vitest';
import { SPEAKEASY, speakeasyTris } from '../src/three/speakeasyLayout';
import { CHAIR_SPOTS, STUDIO } from '../src/three/cubeVenue';
import { TABLE_HALF } from '../src/three/classicStudioLayout';
import { VENUE_DEFS } from '../src/venues';
describe('Speakeasy cube room', () => {
  it('shell + chairs', () => { expect(STUDIO.floorY).toBe(-0.9); for (const c of CHAIR_SPOTS) { if (c.x === 0) expect(Math.abs(c.z) - TABLE_HALF.z).toBeGreaterThan(0.3); else expect(Math.abs(c.x) - TABLE_HALF.x).toBeGreaterThan(0.3); } });
  it('windowless, dark herringbone, back-bar + west booths + east door', () => { expect(SPEAKEASY.sky).toBe(false); expect(SPEAKEASY.windows ?? []).toHaveLength(0); expect(SPEAKEASY.floorRepeat).toEqual([7, 9]); expect(SPEAKEASY.floorTint).toBe('#4a2a1c'); expect(SPEAKEASY.boxes?.filter((b) => b.p[0] < -2.5).length).toBeGreaterThanOrEqual(3); expect(VENUE_DEFS.speakeasy.felt).toBe('#5c0d1a'); });
  it('budget', () => { expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000); expect(speakeasyTris(true)).toBeLessThan(62_000); expect(speakeasyTris(false)).toBeLessThan(2_500); });
});
