import { describe, expect, it } from 'vitest';
import { SPREAD_S, raiseSeconds, spreadSeconds, stepTween } from '../src/three/handLift';

describe('fan slide', () => {
  it('slides with an ease-out over ~180ms', () => {
    expect(SPREAD_S).toBeGreaterThanOrEqual(0.15);
    expect(SPREAD_S).toBeLessThanOrEqual(0.2);
    const half = stepTween({ from: 0, to: 10, t: 0 }, SPREAD_S / 2, SPREAD_S);
    expect(half.value).toBeGreaterThan(5);
    expect(stepTween({ from: 0, to: 10, t: half.t }, SPREAD_S, SPREAD_S)).toEqual({ value: 10, t: 1 });
  });
  it('a retarget continues from the drawn value, with no jump', () => {
    const mid = stepTween({ from: 0, to: 10, t: 0 }, 0.06, SPREAD_S);
    const next = stepTween({ from: mid.value, to: -4, t: 0 }, 0, SPREAD_S);
    expect(next.value).toBeCloseTo(mid.value, 6);
  });
  it('reduced motion snaps', () => {
    expect(spreadSeconds(true)).toBe(0);
    expect(raiseSeconds(true)).toBe(0);
    expect(stepTween({ from: 0, to: 10, t: 0 }, 0.001, spreadSeconds(true)).value).toBe(10);
  });
});
