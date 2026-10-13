import { describe, expect, it } from 'vitest';
import { FELT_SELECT_LIFT_PX, feltCardTransform } from '../src/FeltHand';

describe('quick-load hand', () => {
  it('keeps the fan, and lifts a selected card straight up outside that rotation', () => {
    const rest = feltCardTransform(0, 5, false);
    const sel = feltCardTransform(0, 5, true);
    expect(rest).toBe('rotate(-6.4deg) translateY(6px)');
    expect(sel).toBe(`translateY(-${FELT_SELECT_LIFT_PX}px) ${rest}`);
    expect(sel.indexOf('translateY(-10px)')).toBeLessThan(sel.indexOf('rotate('));
    expect(feltCardTransform(2, 5, false)).toBe('rotate(0deg) translateY(0px)');
    expect(feltCardTransform(2, 5, true)).toBe('translateY(-10px) rotate(0deg) translateY(0px)');
  });
});
