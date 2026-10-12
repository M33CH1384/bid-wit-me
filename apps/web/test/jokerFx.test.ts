import { describe, expect, it } from 'vitest';
import {
  BEAT_MARKS, BURST_MS, JOKER_PALETTE,
  clearBurst, cycleMs, getBurst, heartbeat, jitterPx,
  ripplePose, shakeOffset, startBurst, subscribeBurst,
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

describe('detonation shake', () => {
  it('shakes the whole screen 8px over 350ms and skips it under reduced motion', () => {
    expect(shakeOffset(0, 'BJ', true)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(-1, 'BJ', false)).toEqual({ x: 0, y: 0 });
    expect(shakeOffset(350, 'BJ', false)).toEqual({ x: 0, y: 0 });
    const s = shakeOffset(0, 'BJ', false);
    expect(Math.hypot(s.x, s.y)).toBeCloseTo(8 * 0.65, 5);
    expect(Math.hypot(shakeOffset(0, 'LJ', false).x, shakeOffset(0, 'LJ', false).y)).toBeCloseTo(4 * 0.65, 5);
  });

  it('keeps the burst clock as long as the 3D blast so a stall can still cancel haptics', () => {
    expect(BURST_MS.BJ).toBe(3600);
    expect(BURST_MS.LJ).toBe(500);
  });
});

describe('burst clock', () => {
  it('notifies subscribers and clears', () => {
    const seen: string[] = [];
    const off = subscribeBurst(() => seen.push(getBurst()?.kind ?? 'off'));
    startBurst('BJ', false, 1000);
    expect(getBurst()).toMatchObject({ start: 1000, kind: 'BJ', reduced: false, elapsed: 0 });
    clearBurst();
    expect(getBurst()).toBeNull();
    expect(seen).toEqual(['BJ', 'off']);
    off();
  });
});
