import { describe, expect, it } from 'vitest';
import { CHAIR_SPOTS, STUDIO, TABLE_HALF, studioTris } from '../src/three/classicStudioLayout';

describe('Classic Studio cube room (production port)', () => {
  it('is one box: walls share the cube constants, nothing below the floor', () => {
    expect(STUDIO.zFar).toBeLessThan(0);
    expect(STUDIO.depth).toBeGreaterThan(-STUDIO.zFar); // camera side stays open
    expect(STUDIO.height).toBe(5.0);
    expect(STUDIO.beamBottom).toBeLessThan(STUDIO.height);
    expect(STUDIO.baseboardH).toBeGreaterThan(0);
  });

  it('every chair clears the game table rail and stays inside the walls', () => {
    for (const c of CHAIR_SPOTS) {
      const gapX = Math.abs(c.x) - TABLE_HALF.x;
      const gapZ = Math.abs(c.z) - TABLE_HALF.z;
      // the chair's seat spot is outside the table footprint on its facing axis, with a pulled-up gap
      if (c.x === 0) expect(gapZ).toBeGreaterThan(0.3);
      else expect(gapX).toBeGreaterThan(0.3);
      expect(Math.abs(c.x)).toBeLessThan(STUDIO.roomX - 0.4);
      expect(c.z).toBeGreaterThan(STUDIO.zFar + 0.4);
    }
  });

  it('pendants hang over the table: shade above the felt, cord reaches the beam', () => {
    const feltStudioY = -STUDIO.floorY; // game felt y=0 in studio space
    expect(STUDIO.lampShadeBottom).toBeGreaterThan(feltStudioY + 0.7);
    expect(STUDIO.lampShadeBottom).toBeLessThan(STUDIO.beamBottom);
    expect(Math.abs(STUDIO.lampX)).toBeLessThan(TABLE_HALF.x);
  });

  it('props stay inside the production budget (test scene rendered 108,638 tris)', () => {
    expect(STUDIO.chairTris).toBeLessThanOrEqual(10_000);
    expect(studioTris(true)).toBeLessThan(60_000);
    expect(studioTris(false)).toBeLessThan(200); // shell only: Low quality drops the props, never the room
  });
});
