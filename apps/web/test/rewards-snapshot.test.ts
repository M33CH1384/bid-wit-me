import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  AFTER_RETRY_DELAYS_MS,
  clearPinnedBefore,
  computeRewardsSettled,
  loadPinnedBefore,
  pinBefore,
  resolveBeforeSnapshot,
  type RewardsProfile,
} from '../src/GameOverRewards';

function profile(over: Partial<RewardsProfile> = {}): RewardsProfile {
  return {
    level: { level: 2, xp: 1000, title: 'New Jack', xpForNext: 125, xpIntoLevel: 0 },
    coins: { balance: 1150 },
    rank: { team: { elo: 1000 }, cutthroat: { elo: 1000 } },
    achievements: [],
    challenges: { daily: [], weekly: [] },
    ...over,
  };
}

/** The credited profile: +24 XP (12 finish + 12 win at the vs-bots half rate), no coin change. */
function credited(over: Partial<RewardsProfile> = {}): RewardsProfile {
  return profile({
    level: { level: 2, xp: 1024, title: 'New Jack', xpForNext: 125, xpIntoLevel: 24 },
    ...over,
  });
}

function stubStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  } as Storage;
}

describe('pinned before-snapshot', () => {
  beforeEach(stubStorage);
  afterEach(() => { delete (globalThis as Record<string, unknown>).sessionStorage; });

  it('round-trips a pin through sessionStorage, keyed by seed', () => {
    const p = profile();
    pinBefore('seed-1', p);
    expect(loadPinnedBefore('seed-1')).toEqual(p);
    expect(loadPinnedBefore('seed-2')).toBeUndefined();
    expect(loadPinnedBefore('')).toBeUndefined();
  });

  it('first capture fetches the profile and pins it for the match', async () => {
    const before = profile();
    const fetchProfile = vi.fn(async () => before);
    const got = await resolveBeforeSnapshot('seed-1', fetchProfile);
    expect(got).toEqual(before);
    expect(fetchProfile).toHaveBeenCalledTimes(1);
    expect(loadPinnedBefore('seed-1')).toEqual(before);
  });

  it('a remount reuses the pinned snapshot instead of retaking it (LovleyT714 +0 regression)', async () => {
    const before = profile();
    const fetchProfile = vi.fn()
      .mockResolvedValueOnce(before)
      // After the inactivity bounce the server credit has landed: a retaken
      // "before" would equal the "after" and the rewards diff would read +0.
      .mockResolvedValue(credited());
    const first = await resolveBeforeSnapshot('seed-1', fetchProfile);
    expect(first).toEqual(before);
    // Simulate the Table remounting mid-game: resolve again for the same match.
    const second = await resolveBeforeSnapshot('seed-1', fetchProfile);
    expect(second).toEqual(before);
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('a genuinely new match (new seed) captures a fresh snapshot', async () => {
    const fetchProfile = vi.fn()
      .mockResolvedValueOnce(profile())
      .mockResolvedValueOnce(credited({ coins: { balance: 1300 } }));
    await resolveBeforeSnapshot('seed-1', fetchProfile);
    const next = await resolveBeforeSnapshot('seed-2', fetchProfile);
    expect(next!.coins.balance).toBe(1300);
    expect(fetchProfile).toHaveBeenCalledTimes(2);
  });

  it('does not pin a failed fetch (null), so a later remount can retry the capture', async () => {
    const fetchProfile = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(profile());
    expect(await resolveBeforeSnapshot('seed-1', fetchProfile)).toBeNull();
    expect(loadPinnedBefore('seed-1')).toBeUndefined();
    expect(await resolveBeforeSnapshot('seed-1', fetchProfile)).toEqual(profile());
    expect(fetchProfile).toHaveBeenCalledTimes(2);
  });

  it('clearPinnedBefore drops the pin when rewards are opened', async () => {
    pinBefore('seed-1', profile());
    clearPinnedBefore();
    expect(loadPinnedBefore('seed-1')).toBeUndefined();
    const fetchProfile = vi.fn(async () => credited());
    expect(await resolveBeforeSnapshot('seed-1', fetchProfile)).toEqual(credited());
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('an empty seed never pins (state not ready yet)', async () => {
    const fetchProfile = vi.fn(async () => profile());
    await resolveBeforeSnapshot('', fetchProfile);
    sessionStorage.setItem('bwm.rewards.before.v1', JSON.stringify({ seed: '', profile: profile() }));
    expect(loadPinnedBefore('')).toBeUndefined();
  });
});

describe('computeRewardsSettled (after-fetch bounded retry)', () => {
  const opts = { won: true, headline: 'VICTORY!', sub: '6 hands played', kind: 'team' as const };
  const noSleep = async () => {};

  it('a delayed credit lands through the retry: stale first fetch, credited second', async () => {
    const before = profile();
    const slept: number[] = [];
    const fetchProfile = vi.fn()
      .mockResolvedValueOnce(profile()) // credit not visible yet → delta 0
      .mockResolvedValue(credited()); // credit landed
    const data = await computeRewardsSettled(before, opts, {
      online: true,
      fetchProfile,
      sleep: async (ms) => { slept.push(ms); },
    });
    expect(data.xpGained).toBe(24);
    expect(fetchProfile).toHaveBeenCalledTimes(2);
    expect(slept).toEqual([AFTER_RETRY_DELAYS_MS[0]]);
  });

  it('gives up after the bounded retries and proceeds with the zero diff', async () => {
    const before = profile();
    const slept: number[] = [];
    const fetchProfile = vi.fn(async () => profile());
    const data = await computeRewardsSettled(before, opts, {
      online: true,
      fetchProfile,
      sleep: async (ms) => { slept.push(ms); },
    });
    expect(data.xpGained).toBe(0);
    expect(data.coinsGained).toBe(0);
    expect(fetchProfile).toHaveBeenCalledTimes(1 + AFTER_RETRY_DELAYS_MS.length);
    expect(slept).toEqual([...AFTER_RETRY_DELAYS_MS]);
    // The whole retry budget stays around two seconds — the leave flow never hangs.
    expect(AFTER_RETRY_DELAYS_MS.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(2100);
  });

  it('does not retry when the first diff already moved', async () => {
    const fetchProfile = vi.fn(async () => credited());
    const data = await computeRewardsSettled(profile(), opts, { online: true, fetchProfile, sleep: noSleep });
    expect(data.xpGained).toBe(24);
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('does not retry a coin-only credit check offline', async () => {
    const fetchProfile = vi.fn(async () => profile());
    const data = await computeRewardsSettled(profile(), opts, { online: false, fetchProfile, sleep: noSleep });
    expect(data.xpGained).toBe(0);
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('does not retry for guests (no before snapshot)', async () => {
    const fetchProfile = vi.fn(async () => null);
    const data = await computeRewardsSettled(null, opts, { online: true, fetchProfile, sleep: noSleep });
    expect(data.signedIn).toBe(false);
    expect(fetchProfile).toHaveBeenCalledTimes(1);
  });

  it('recovers when the first after-fetch fails outright (null) and the credit lands on retry', async () => {
    const fetchProfile = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(credited());
    const data = await computeRewardsSettled(profile(), opts, { online: true, fetchProfile, sleep: noSleep });
    expect(data.signedIn).toBe(true);
    expect(data.xpGained).toBe(24);
    expect(fetchProfile).toHaveBeenCalledTimes(2);
  });
});
