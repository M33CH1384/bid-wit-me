import { describe, expect, it } from 'vitest';
import {
  BEAT_MARKS, BURST_MS, JOKER_PALETTE,
  cardPush, clearBurst, cloudPose, cycleMs, flashOpacity, getBurst, heartbeat, jitterPx, jokerPop,
  ripplePose, shakeOffset, shockwave, startBurst, subscribeBurst,
} from '../src/jokerFx';

describe('radioactive heartbeat', () => {
  it('speeds up as cards land after the joker', () => {
    expect(cycleMs(0)).toBe(1100);
    expect(cycleMs(1)).toBe(800);
    expect(cycleMs(2)).toBe(550);
    expect(cycleMs(3)).toBe(550);
  });

  it('double-beats at the spec marks: scale 1 → 1.035 → 1 → 1.02 → 1, glow .35 → .9', () => {
    expect(BEAT_MARKS).toEqual([0.14, 0.42]);
    const at = (p: number) => heartbeat(p, 'BJ');
    expect(at(0)).toEqual({ scale: 1, glow: 0.35 });
    expect(at(0.14).scale).toBeCloseTo(1.035, 5);
    expect(at(0.14).glow).toBeCloseTo(0.9, 5);
    expect(at(0.28)).toEqual({ scale: 1, glow: 0.35 });
    expect(at(0.42).scale).toBeCloseTo(1.02, 5);
    expect(at(0.42).glow).toBeCloseTo(0.9, 5);
    expect(at(0.58)).toEqual({ scale: 1, glow: 0.35 });
    expect(at(1)).toEqual({ scale: 1, glow: 0.35 });
  });

  it('scales the Little Joker beat down and keeps the face palette purple', () => {
    const lj = heartbeat(0.14, 'LJ');
    expect(lj.scale).toBeCloseTo(1 + 0.035 * 0.55, 5);
    expect(lj.glow).toBeCloseTo(0.9, 5);
    expect(JOKER_PALETTE.BJ.core.hex).toBe('#7CFF4F');
    expect(JOKER_PALETTE.LJ.core.hex).toBe('#C86BFF');
    expect(JOKER_PALETTE.BJ.halo).toBe(2.2);
    expect(JOKER_PALETTE.LJ.halo).toBe(1.55);
  });

  it('launches a ripple that grows and fades over 700ms', () => {
    expect(ripplePose(-1, 'BJ')).toBeNull();
    expect(ripplePose(0, 'BJ')).toEqual({ scale: 1, opacity: 0.5 });
    const mid = ripplePose(350, 'BJ')!;
    expect(mid.scale).toBeGreaterThan(1);
    expect(mid.scale).toBeLessThan(1.6);
    expect(mid.opacity).toBeLessThan(0.5);
    expect(ripplePose(700, 'BJ')).toEqual({ scale: 1.6, opacity: 0 });
    expect(ripplePose(701, 'BJ')).toBeNull();
  });

  it('jitters 1px at 30fps only on the final cycle', () => {
    expect(jitterPx(0, 1, false)).toEqual({ x: 0, y: 0 });
    expect(jitterPx(0, 2, true)).toEqual({ x: 0, y: 0 });
    const j = jitterPx(0, 2, false);
    expect(Math.abs(j.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(j.y)).toBeLessThanOrEqual(1);
    expect(jitterPx(0, 2, false)).toEqual(jitterPx(10, 2, false));
    expect(jitterPx(0, 2, false)).not.toEqual(jitterPx(40, 2, false));
  });
});

describe('detonation keyframes', () => {
  it('flashes #FFFFF0 to .85 in 60ms and clears by 280ms; Little Joker has none', () => {
    expect(flashOpacity(0, 'BJ', false)).toBe(0);
    expect(flashOpacity(60, 'BJ', false)).toBeCloseTo(0.85, 5);
    expect(flashOpacity(280, 'BJ', false)).toBe(0);
    expect(flashOpacity(60, 'BJ', true)).toBeCloseTo(0.28, 5);
    expect(flashOpacity(60, 'LJ', false)).toBe(0);
  });

  it('shockwave grows to 4x the table over 450ms and fades out', () => {
    const start = shockwave(0, 'BJ')!;
    expect(start.mul).toBe(0);
    expect(start.opacity).toBe(1);
    const end = shockwave(450, 'BJ')!;
    expect(end.mul).toBeCloseTo(4, 5);
    expect(end.opacity).toBeCloseTo(0, 5);
    expect(shockwave(451, 'BJ')).toBeNull();
    expect(shockwave(320, 'LJ')!.mul).toBeCloseTo(2.2, 5);
  });

  it('shakes 8px over 350ms, transform only, and skips it under reduced motion', () => {
    expect(shakeOffset(0, 'BJ', true)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(-1, 'BJ', false)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(350, 'BJ', false)).toEqual({ x: 0, y: 0 });
    const s = shakeOffset(0, 'BJ', false);
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(8 * 0.65, 5);
    expect(Math.hypot(shakeOffset(0, 'LJ', false).x, shakeOffset(0, 'LJ', false).y)).toBeCloseTo(4 * 0.65, 5);
  });

  it('raises the cloud from 120ms and keeps it gone under reduced motion', () => {
    expect(cloudPose(100, 'BJ', false)).toBeNull();
    expect(cloudPose(200, 'BJ', true)).toBeNull();
    const c = cloudPose(200, 'BJ', false)!;
    expect(c.rise).toBeGreaterThan(0);
    expect(c.scale).toBeGreaterThanOrEqual(0.4);
    expect(c.opacity).toBeGreaterThan(0);
    expect(cloudPose(901, 'BJ', false)).toBeNull();
    expect(cloudPose(681, 'LJ', false)).toBeNull();
  });

  it('pops the winning joker from 200ms and settles by 700ms', () => {
    expect(jokerPop(199, 'BJ')).toBe(1);
    expect(jokerPop(410, 'BJ')).toBeCloseTo(1.25, 2);
    expect(jokerPop(700, 'BJ')).toBeCloseTo(1, 5);
    expect(jokerPop(410, 'LJ')).toBeLessThan(1.25);
    expect(jokerPop(410, 'LJ')).toBeGreaterThan(1);
  });

  it('pushes other cards out without fading them away, so the iOS blast still has cards', () => {
    expect(cardPush(0, 'BJ')).toEqual({ px: 0, opacity: 1 });
    const mid = cardPush(300, 'BJ');
    expect(mid.px).toBe(20);
    expect(mid.opacity).toBeCloseTo(0.35, 5);
    expect(cardPush(150, 'BJ').opacity).toBeGreaterThan(0.35);
    expect(cardPush(900, 'LJ').px).toBe(12);
    expect(cardPush(1300, 'BJ').opacity).toBeCloseTo(1, 5);
    for (const t of [0, 100, 300, 600, 900, 1200]) {
      expect(cardPush(t, 'BJ').opacity).toBeGreaterThan(0);
      expect(cardPush(t, 'LJ').opacity).toBeGreaterThan(0);
    }
  });

  it('runs about 1.1s for the Big Joker and 0.8s for the Little one', () => {
    expect(BURST_MS.BJ).toBe(1100);
    expect(BURST_MS.LJ).toBe(800);
  });
});

describe('burst clock', () => {
  it('notifies subscribers and clears', () => {
    const seen: string[] = [];
    const off = subscribeBurst(() => seen.push(getBurst()?.kind ?? 'off'));
    startBurst('BJ', false, 1000);
    expect(getBurst()).toEqual({ start: 1000, kind: 'BJ', reduced: false });
    clearBurst();
    expect(getBurst()).toBeNull();
    expect(seen).toEqual(['BJ', 'off']);
    off();
  });
});
