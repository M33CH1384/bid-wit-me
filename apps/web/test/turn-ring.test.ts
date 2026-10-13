import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TURN_BUZZ_MARKS_MS, TURN_RING_GOLD, TURN_RING_RED, TURN_RING_WARN_MS,
  ownTurnBuzz, ringDash, turnBuzzMarks, turnRingColor, turnRingSample,
} from '../src/turnRing';

describe('turn ring window', () => {
  const start = 10_000;
  const deadline = 30_000;

  it('fills from the server window, including lead-in, and empties at the deadline', () => {
    expect(turnRingSample(start, start, deadline).fraction).toBe(1);
    expect(turnRingSample(start - 4_000, start, deadline).fraction).toBe(1);
    expect(turnRingSample(20_000, start, deadline).fraction).toBeCloseTo(0.5);
    expect(turnRingSample(deadline, start, deadline).fraction).toBe(0);
    expect(turnRingSample(deadline + 500, start, deadline).fraction).toBe(0);
  });

  it('follows a shortened deadline instead of the original timer length', () => {
    const shortened = 18_000;
    const now = 12_000;
    const sample = turnRingSample(now, start, shortened);
    expect(sample.fraction).toBeCloseTo((shortened - now) / (shortened - start));
    expect(sample.fraction).not.toBeCloseTo((deadline - now) / (deadline - start));
  });

  it('shifts from gold to red across the last 5s and is red at the deadline', () => {
    expect(TURN_RING_WARN_MS).toBe(5000);
    expect(turnRingColor(5_000)).toBe(TURN_RING_GOLD);
    expect(turnRingColor(12_000)).toBe(TURN_RING_GOLD);
    expect(turnRingColor(2_500)).toBe('rgb(250, 137, 88)');
    expect(turnRingColor(0)).toBe(TURN_RING_RED);
    expect(turnRingColor(-20)).toBe(TURN_RING_RED);
    expect(turnRingSample(deadline - 900, start, deadline).color).not.toBe(TURN_RING_GOLD);
  });
});

describe('turn ring dash', () => {
  it('starts full and drains clockwise to empty', () => {
    const full = ringDash(1);
    const half = ringDash(0.5);
    const empty = ringDash(0);
    expect(full.offset).toBe(0);
    expect(half.offset).toBeCloseTo(full.length / 2);
    expect(empty.offset).toBeCloseTo(full.length);
    expect(full.cap).toBe('butt');
    expect(half.cap).toBe('round');
  });
});

describe('own-turn buzz', () => {
  it('fires once at each of the last 3 seconds and not before', () => {
    expect(TURN_BUZZ_MARKS_MS).toEqual([3000, 2000, 1000]);
    expect(turnBuzzMarks(4_000, 3_500)).toEqual([]);
    expect(turnBuzzMarks(3_001, 2_999)).toEqual([3000]);
    expect(turnBuzzMarks(2_001, 1_999)).toEqual([2000]);
    expect(turnBuzzMarks(1_001, 999)).toEqual([1000]);
    expect(turnBuzzMarks(2_500, 2_400)).toEqual([]);
    expect(turnBuzzMarks(500, 0)).toEqual([]);
    expect(turnBuzzMarks(3_500, 500)).toEqual([3000, 2000, 1000]);
  });

  it('calls navigator.vibrate(10) only when that call exists and vibration is on', () => {
    const calls: number[] = [];
    const prev = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { vibrate: (ms: number) => { calls.push(ms); return true; } } });
    try {
      expect(ownTurnBuzz(true)).toBe(true);
      expect(calls).toEqual([10]);
      expect(ownTurnBuzz(false)).toBe(false);
      expect(calls).toEqual([10]);
    } finally {
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: prev });
    }
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    try { expect(ownTurnBuzz(true)).toBe(false); }
    finally { Object.defineProperty(globalThis, 'navigator', { configurable: true, value: prev }); }

    const src = readFileSync(new URL('../src/turnRing.ts', import.meta.url), 'utf8');
    expect(src).toContain('nav.vibrate(10)');
    // WebKit lets a stylesheet stroke beat a presentation attribute, so the color has to be inline.
    expect(src).toContain('track.style.stroke');
    expect(src).toContain('el.style.strokeDashoffset');
  });
});
