import { describe, expect, it } from 'vitest';
import { BARBER, BARBER_ASSETS, barberTris, skySeekFraction, todFromDate, todLighting } from '../src/three/barbershopLayout';
import { CHAIR_SPOTS, STUDIO, TABLE_HALF } from '../src/three/classicStudioLayout';

const at = (h: number, m = 0) => new Date(2026, 9, 17, h, m);

describe('Barbershop cube room (production port)', () => {
  it('reuses the Classic shell truth: same cube, floor, grounded chair spots', () => {
    expect(BARBER.roomX).toBe(STUDIO.roomX);
    expect(BARBER.zFar).toBe(STUDIO.zFar);
    expect(BARBER.height).toBe(5.0);
    expect(BARBER.floorY).toBe(-0.9);
    for (const c of CHAIR_SPOTS) {
      if (c.x === 0) expect(Math.abs(c.z) - TABLE_HALF.z).toBeGreaterThan(0.3);
      else expect(Math.abs(c.x) - TABLE_HALF.x).toBeGreaterThan(0.3);
      expect(Math.abs(c.x)).toBeLessThan(BARBER.roomX - 0.4);
    }
  });

  it('storefront is the EAST wall with 5 bays; felt is the regraded design felt', () => {
    expect(BARBER.storefrontBays).toBe(5);
    expect(BARBER.felt).toBe('#14532d');
    expect(BARBER.checkerRepeat).toEqual([6, 7]);
  });

  it('props stay in budget: test scene was 110,444 tris, chairs <=10k each', () => {
    expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000);
    expect(barberTris(true)).toBeLessThan(62_000);
    expect(barberTris(false)).toBeLessThan(2_500); // Low: shell+storefront only, posters not video/GLB
  });

  it('host-clock TOD states + hand-lock lighting follow VENUES.md', () => {
    expect(todFromDate(at(3))).toBe('night');
    expect(todFromDate(at(6))).toBe('dawn');
    expect(todFromDate(at(13))).toBe('day');
    expect(todFromDate(at(18, 30))).toBe('golden');
    expect(todFromDate(at(21))).toBe('night');
    expect(todLighting('night').glassOpacity).toBeGreaterThan(todLighting('day').glassOpacity);
    expect(todLighting('night').skySrc).toBe('night');
    expect(skySeekFraction(at(6))).toBe(0);
    expect(skySeekFraction(at(12))).toBeCloseTo(0.5);
    expect(skySeekFraction(at(18))).toBe(1);
  });

  it('street asset is the blurred production plate, never the raw clip', () => {
    expect(BARBER_ASSETS.street).toContain('street.webm');
    expect(BARBER_ASSETS.skyDay).toContain('sky-day.webm');
    expect(BARBER_ASSETS.skyPoster).toContain('poster');
  });
});
