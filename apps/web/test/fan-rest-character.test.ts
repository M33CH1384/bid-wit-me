import { describe, expect, it } from 'vitest';
import { FAN_REST_MS, NEUTRAL_REST_CHARACTER, restCharacter } from '../src/three/fanRest';

/**
 * Rest character (owner, 2026-10-30): the fan's off-turn lowering varies per
 * transition — duration, settle depth, and an occasional overshoot dip — so
 * it stops reading as the same mechanical motion every time. The character
 * is seeded (hand + seat + leg at the Scene call site) and bounded: it can
 * change HOW a fan lowers, never WHETHER or WHEN (fanRestTarget's domain).
 */
describe('rest character', () => {
  it('is deterministic per seed and stays inside its bounds', () => {
    for (let seed = 0; seed < 500; seed++) {
      const a = restCharacter(seed);
      expect(restCharacter(seed)).toEqual(a);
      expect(a.durMs).toBeGreaterThanOrEqual(520);
      expect(a.durMs).toBeLessThanOrEqual(880);
      expect(a.dropDepth).toBeGreaterThanOrEqual(0.9);
      expect(a.dropDepth).toBeLessThanOrEqual(1.0);
      expect(a.pinchDepth).toBeGreaterThanOrEqual(0.86);
      expect(a.pinchDepth).toBeLessThanOrEqual(1.0);
      expect([0, 0.05]).toContain(a.overshoot);
    }
  });

  it('actually varies: quick drops, slow sags and overshoot legs all occur', () => {
    const durs = new Set<number>();
    let overshoots = 0;
    let quick = 0;
    let sag = 0;
    for (let seed = 0; seed < 400; seed++) {
      const c = restCharacter(seed);
      durs.add(c.durMs);
      if (c.overshoot > 0) overshoots++;
      if (c.durMs < 600) quick++;
      if (c.durMs > 800) sag++;
    }
    expect(durs.size).toBeGreaterThan(50);
    expect(overshoots).toBeGreaterThan(40);
    expect(overshoots).toBeLessThan(240); // a seasoning, not the default
    expect(quick).toBeGreaterThan(10);
    expect(sag).toBeGreaterThan(10);
  });

  it('the neutral character is exactly the pre-variation behaviour', () => {
    expect(NEUTRAL_REST_CHARACTER).toEqual({ durMs: FAN_REST_MS, dropDepth: 1, pinchDepth: 1, overshoot: 0 });
  });
});
