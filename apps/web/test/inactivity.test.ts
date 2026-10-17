import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  IDLE_BADGE_MS, IDLE_LOGOUT_MS, IDLE_PRESENCE_MS, IdleWatch, holdIdleExemption, idleAction, idleExempt,
  idlePolicyFrom, idleStage, idleTimeoutFrom,
} from '../src/inactivity';

describe('inactivity policy boundaries (fake clock)', () => {
  it('5 / 15 / 30 minute stages flip exactly on their boundaries', () => {
    let t = 1_000_000;
    const w = new IdleWatch(undefined, () => t);
    t += IDLE_BADGE_MS - 1; expect(w.stage()).toBe('active');
    t += 1; expect(w.stage()).toBe('badge');           // 5:00 idle badge
    t += IDLE_PRESENCE_MS - IDLE_BADGE_MS - 1; expect(w.stage()).toBe('badge');
    t += 1; expect(w.stage()).toBe('away');            // 15:00 drop off Online list
    t += IDLE_LOGOUT_MS - IDLE_PRESENCE_MS - 1; expect(w.stage()).toBe('away');
    t += 1; expect(w.stage()).toBe('out'); expect(w.expired()).toBe(true); // 30:00 sign out
    w.touch(); expect(w.stage()).toBe('active'); expect(w.idleFor()).toBe(0);
  });
  it('constants are 5 / 15 / 30 minutes', () => {
    expect(IDLE_BADGE_MS).toBe(5 * 60_000); expect(IDLE_PRESENCE_MS).toBe(15 * 60_000); expect(IDLE_LOGOUT_MS).toBe(30 * 60_000);
    expect(idleStage(IDLE_BADGE_MS - 1)).toBe('active'); expect(idleStage(IDLE_PRESENCE_MS)).toBe('away'); expect(idleStage(IDLE_LOGOUT_MS)).toBe('out');
  });
  it('main-menu idle still signs out at 30 (scope menu)', () => {
    expect(idleAction('out', { scope: 'menu' })).toBe('sign-out');
    expect(idleAction('away', { scope: 'menu' })).toBe('drop-presence');
    expect(idleAction('badge', { scope: 'menu' })).toBe('badge');
    expect(idleAction('out', { scope: 'online' })).toBe('sign-out');
  });
  it('NEVER signs out an offline bot game or anyone actively playing', () => {
    expect(idleAction('out', { scope: 'offline-bot' })).toBe('none');
    expect(idleAction('away', { scope: 'offline-bot' })).toBe('none');
    expect(idleAction('out', { scope: 'online', activePlay: true })).toBe('none');
    expect(idleAction('out', { scope: 'menu', activePlay: true })).toBe('none');
  });
  it('active play exemption: a fake-timer hour of periodic input never leaves active', () => {
    vi.useFakeTimers();
    let t = 0;
    const w = new IdleWatch(undefined, () => t);
    for (let i = 0; i < 120; i++) { t += 30_000; vi.advanceTimersByTime(30_000); w.touch(); expect(w.stage()).toBe('active'); }
    vi.useRealTimers();
  });
  it('exemption registry holds and releases', () => {
    expect(idleExempt()).toBe(false);
    const release = holdIdleExemption();
    expect(idleExempt()).toBe(true);
    release(); release(); // idempotent
    expect(idleExempt()).toBe(false);
  });
});

describe('idlePolicyFrom / idleTimeoutFrom', () => {
  const store = (v: string | null) => ({ getItem: () => v });
  it('uses the default without a sane override', () => {
    expect(idleTimeoutFrom(null)).toBe(IDLE_LOGOUT_MS);
    expect(idleTimeoutFrom(store(null))).toBe(IDLE_LOGOUT_MS);
    expect(idleTimeoutFrom(store('500'))).toBe(IDLE_LOGOUT_MS); // below floor
    expect(idleTimeoutFrom(store('abc'))).toBe(IDLE_LOGOUT_MS);
  });
  it('a sane override scales all three stages (1/6, 1/2, 1)', () => {
    expect(idlePolicyFrom(store('30000'))).toEqual({ badgeMs: 5_000, presenceMs: 15_000, logoutMs: 30_000 });
    expect(idleTimeoutFrom(store('15000'))).toBe(15_000);
  });
});
afterEach(() => vi.useRealTimers());
