import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { loadRewards, stashRewards, type RewardsPayload } from '../src/RewardsPage';
import { computeRewards } from '../src/GameOverRewards';

function stubStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  } as Storage;
}

describe('rewards page payload', () => {
  beforeEach(stubStorage);
  afterEach(() => { delete (globalThis as Record<string, unknown>).sessionStorage; });

  it('round-trips the rewards breakdown through sessionStorage', () => {
    const data = computeRewards(null, null, { won: true, headline: 'VICTORY!', sub: '3 hands played', kind: 'team' });
    const payload: RewardsPayload = { data, online: false, homePath: '/' };
    stashRewards(payload);
    const loaded = loadRewards();
    expect(loaded).not.toBeNull();
    expect(loaded!.online).toBe(false);
    expect(loaded!.homePath).toBe('/');
    expect(loaded!.data.headline).toBe('VICTORY!');
    expect(loaded!.data.signedIn).toBe(false);
  });

  it('round-trips the claim game id with the payload', () => {
    const data = computeRewards(null, null, { won: false, headline: 'BOOK WORMS WIN', sub: '5 hands played', kind: 'team' });
    stashRewards({ data, online: false, homePath: '/', gameId: 'local-seed42' });
    expect(loadRewards()!.gameId).toBe('local-seed42');
  });

  it('returns null when nothing was stashed', () => {
    expect(loadRewards()).toBeNull();
  });

  it('returns null on corrupt payload', () => {
    sessionStorage.setItem('bwm.rewards.v1', '{not json');
    expect(loadRewards()).toBeNull();
  });
});
