import { describe, expect, it } from 'vitest';
import {
  BANNER_AT_MS, BANNER_MS, BLAST_MS, CAP, SHOCK_END_MS, SWEEP_MS,
  bannerPose, cardBlow, createBlast, flashAlpha, ignitionAlpha, jokerCrush, jokerPop, noteFrame, resetBlast, shakeOffset, shockwave, stepBlast,
} from '../src/nukeBlast';

describe('canvas detonation', () => {
  it('flashes white for 100ms and clears to a core', () => {
    expect(flashAlpha(0, false)).toBe(1);
    expect(flashAlpha(40, false)).toBe(1);
    expect(flashAlpha(100, false)).toBe(0);
    expect(flashAlpha(101, false)).toBe(0);
    expect(flashAlpha(20, true)).toBeGreaterThan(0.8);
    expect(flashAlpha(100, true)).toBe(0);
    expect(ignitionAlpha(0, false)).toBe(0);
    expect(ignitionAlpha(50, false)).toBeGreaterThan(0);
    expect(ignitionAlpha(50, true)).toBe(0);
  });

  it('shakes the whole screen hard, then decays to nothing', () => {
    expect(shakeOffset(0, 'BJ', true)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(700, 'BJ', false)).toEqual({ x: 0, y: 0 });
    const s = shakeOffset(0, 'BJ', false);
    expect(Math.hypot(s.x, s.y)).toBeGreaterThan(8);
    expect(Math.hypot(shakeOffset(400, 'BJ', false).x, shakeOffset(400, 'BJ', false).y)).toBeLessThan(Math.hypot(s.x, s.y));
  });

  it('runs the shockwave, then the stamp, and flies the cards at the end', () => {
    expect(shockwave(39)).toBeNull();
    expect(shockwave(40)!.opacity).toBeGreaterThan(0.9);
    expect(shockwave(SHOCK_END_MS)).not.toBeNull();
    expect(shockwave(SHOCK_END_MS + 1)).toBeNull();
    expect(BANNER_AT_MS).toBeGreaterThan(SHOCK_END_MS);
    expect(bannerPose(BANNER_AT_MS - 1)).toBeNull();
    expect(bannerPose(BANNER_AT_MS)!.opacity).toBe(0);
    expect(bannerPose(BANNER_AT_MS + 140)!.opacity).toBeCloseTo(1, 5);
    expect(bannerPose(BANNER_AT_MS + BANNER_MS)!.opacity).toBeCloseTo(0, 5);
    expect(SWEEP_MS).toBe(1500);
    expect(SWEEP_MS).toBeLessThan(BLAST_MS);
    expect(BLAST_MS).toBeGreaterThanOrEqual(1500);
    expect(BLAST_MS).toBeLessThanOrEqual(2000);
  });

  it('blows other cards out without fading them away, crushes the little joker, and pops the winner', () => {
    expect(cardBlow(0)).toEqual({ px: 0, opacity: 1 });
    expect(cardBlow(400).px).toBe(32);
    expect(cardBlow(400).opacity).toBeCloseTo(0.4, 5);
    expect(cardBlow(1500).opacity).toBeGreaterThan(0);
    expect(jokerCrush(0).scale).toBe(1);
    expect(jokerCrush(160).opacity).toBe(0);
    expect(jokerCrush(80).scale).toBeLessThan(1);
    expect(jokerPop(0)).toBe(1);
    expect(jokerPop(80 + 520 * 0.4)).toBeCloseTo(1.2, 5);
    expect(jokerPop(700)).toBe(1);
  });

  it('reuses one pool and only shrinks after a frame actually runs long', () => {
    const b = createBlast(7);
    const fire = b.pools.fire.x;
    resetBlast(b, { cx: 200, cy: 300, w: 390, h: 844, dpr: 2, reduced: false });
    expect(b.pools.fire.x).toBe(fire);
    expect(b.budget).toBe(1);
    for (let i = 0; i < 40; i++) stepBlast(b, 0.016);
    expect(b.pools.fire.alive).toBeGreaterThan(10);
    expect(b.pools.fire.alive).toBeLessThanOrEqual(CAP.fire);
    expect(b.slowed).toBe(false);
    noteFrame(b, 51);
    expect(b.slowed).toBe(true);
    expect(b.budget).toBeLessThan(1);
    const reduced = createBlast(3);
    resetBlast(reduced, { cx: 0, cy: 0, w: 10, h: 10, dpr: 1, reduced: true });
    stepBlast(reduced, 0.05);
    expect(reduced.pools.fire.alive).toBe(0);
    expect(reduced.pools.ember.alive).toBe(0);
  });
});
