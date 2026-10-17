import { describe, expect, it } from 'vitest';
import { IDLE_LOGOUT_MS, IdleWatch, idleTimeoutFrom } from '../src/inactivity';

describe('IdleWatch', () => {
  it('expires exactly at the timeout and resets on touch', () => {
    let t = 1_000_000;
    const w = new IdleWatch(60_000, () => t);
    t += 59_999; expect(w.expired()).toBe(false);
    t += 1; expect(w.expired()).toBe(true);
    w.touch(); expect(w.expired()).toBe(false);
    expect(w.idleFor()).toBe(0);
  });
  it('defaults to 30 minutes', () => { expect(IDLE_LOGOUT_MS).toBe(30 * 60_000); });
});

describe('idleTimeoutFrom', () => {
  const store = (v: string | null) => ({ getItem: () => v });
  it('uses the default without a sane override', () => {
    expect(idleTimeoutFrom(null)).toBe(IDLE_LOGOUT_MS);
    expect(idleTimeoutFrom(store(null))).toBe(IDLE_LOGOUT_MS);
    expect(idleTimeoutFrom(store('500'))).toBe(IDLE_LOGOUT_MS); // below floor
    expect(idleTimeoutFrom(store('abc'))).toBe(IDLE_LOGOUT_MS);
  });
  it('accepts a sane override (test hook)', () => {
    expect(idleTimeoutFrom(store('15000'))).toBe(15_000);
  });
});
