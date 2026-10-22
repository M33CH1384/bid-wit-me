/**
 * @vitest-environment happy-dom
 *
 * RETROACTIVE REWARDS CLAIM (owner, 2026-10-22): a game finished while
 * signed out is held as a pending claim (one slot, newest wins, 7-day TTL)
 * and submitted through the live /api/stats/local crediting path on
 * sign-in — exactly once, however many triggers fire.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CLAIM_TTL_MS, claimDeferredToRewards, holdIfGuest, loadClaimResult, loadPendingClaim,
  peekPendingClaim, savePendingClaim, shouldHoldClaim, submitPendingClaim,
} from '../src/pendingClaim';
import { loadAccount, signOut } from '../src/account/api';
import type { LocalGamePost } from '../src/localStats';
import type { RewardsProfile } from '../src/GameOverRewards';

function fakeStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}
type Store = ReturnType<typeof fakeStore>;

const item = (id: string): LocalGamePost => ({ clientGameId: id, startedAt: 1, endedAt: 2, names: [], teamNames: null, game: {} as LocalGamePost['game'] });
const NOW = 1_800_000_000_000;

function profile(xp: number): RewardsProfile {
  return {
    level: { level: 8, xp, title: 'Prospect', xpForNext: 300, xpIntoLevel: 83 },
    coins: { balance: 1250 },
    rank: { team: { elo: 1000 }, cutthroat: { elo: 1000 } },
    achievements: [],
    challenges: { daily: [], weekly: [] },
  };
}

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  } as unknown as Response;
}

describe('pending claim slot', () => {
  it('holds only for a known guest (account resolved, nobody signed in)', () => {
    expect(shouldHoldClaim(true, null)).toBe(true);
    expect(shouldHoldClaim(true, undefined)).toBe(true);
    expect(shouldHoldClaim(true, 'user-1')).toBe(false);
    expect(shouldHoldClaim(false, null)).toBe(false); // still loading: the offline queue owns it
  });

  it('keeps one slot — a newer completed game replaces an older unclaimed one', () => {
    const s = fakeStore();
    savePendingClaim(item('game-a'), NOW, s);
    savePendingClaim(item('game-b'), NOW + 1000, s);
    expect(loadPendingClaim(NOW + 2000, s)?.clientGameId).toBe('game-b');
  });

  it('expires after the TTL: peek reports it, load clears it', () => {
    const s = fakeStore();
    savePendingClaim(item('game-a'), NOW, s);
    expect(peekPendingClaim(NOW + CLAIM_TTL_MS, s).state).toBe('held');
    expect(peekPendingClaim(NOW + CLAIM_TTL_MS + 1, s).state).toBe('expired');
    expect(loadPendingClaim(NOW + CLAIM_TTL_MS + 1, s)).toBeNull();
    expect(peekPendingClaim(NOW + CLAIM_TTL_MS + 2, s).state).toBe('none');
  });

  it('claim results are stored per game id', async () => {
    const { saveClaimResult } = await import('../src/pendingClaim');
    const s = fakeStore();
    saveClaimResult({ clientGameId: 'game-a', at: NOW, before: profile(100), after: profile(124) }, s);
    expect(loadClaimResult('game-a', s)?.after?.level.xp).toBe(124);
    expect(loadClaimResult('game-b', s)).toBeNull();
  });
});

describe('hold + submit against the account store', () => {
  it('does not hold while the account is still loading, holds once known as a guest', async () => {
    const s = fakeStore();
    expect(holdIfGuest(item('game-a'), NOW, s)).toBe(false); // account unresolved at module start
    vi.stubGlobal('fetch', async () => { throw new Error('offline'); });
    await loadAccount(true); // fetch fails → ready, signed out
    expect(holdIfGuest(item('game-a'), NOW, s)).toBe(true);
    expect(peekPendingClaim(NOW, s).state).toBe('held');
    vi.unstubAllGlobals();
  });

  it('submits exactly once through the live path, then is gone', async () => {
    const s = fakeStore();
    const statsBodies: Record<string, unknown>[] = [];
    let xp = 100;
    const user = { id: 'u-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1, progressImported: false, avatar: null, identities: [], passkeys: [] };
    vi.stubGlobal('fetch', async (url: string, init?: { body?: string }) => {
      if (url.includes('/api/auth/config')) return jsonRes({ providers: [], passkeys: false, accounts: true });
      if (url.includes('/api/auth/me')) return jsonRes({ user });
      if (url.includes('/api/auth/logout')) return jsonRes({ ok: true });
      if (url.includes('/api/profile/me')) return jsonRes(profile(xp));
      if (url.includes('/api/stats/local')) {
        statsBodies.push(JSON.parse(init?.body ?? '{}'));
        xp = 124; // the credit lands
        return jsonRes({ ok: true, duplicate: false });
      }
      throw new Error(`unexpected ${url}`);
    });
    await loadAccount(true);
    // signed in now: no new holds
    expect(holdIfGuest(item('game-x'), NOW, s)).toBe(false);

    savePendingClaim(item('game-a'), NOW, s);
    const res = await submitPendingClaim({ storage: s, now: NOW });
    expect(res.status).toBe('claimed');
    expect(statsBodies).toHaveLength(1);
    expect(statsBodies[0]).toMatchObject({ clientGameId: 'game-a', claim: true });
    expect(res.before?.level.xp).toBe(100);
    expect(res.after?.level.xp).toBe(124);
    expect(loadClaimResult('game-a', s)?.after?.level.xp).toBe(124);
    expect(peekPendingClaim(NOW, s).state).toBe('none');
    // second trigger (relaunch + return-to-screen paths racing) posts nothing
    expect((await submitPendingClaim({ storage: s, now: NOW })).status).toBe('none');
    expect(statsBodies).toHaveLength(1);

    // concurrent triggers collapse to one post
    savePendingClaim(item('game-b'), NOW, s);
    const [r1, r2] = await Promise.all([submitPendingClaim({ storage: s, now: NOW }), submitPendingClaim({ storage: s, now: NOW })]);
    expect([r1.status, r2.status].sort()).toEqual(['busy', 'claimed']);
    expect(statsBodies).toHaveLength(2);
    vi.unstubAllGlobals();
  });

  it('a rejected game clears the claim; a network failure keeps it held', async () => {
    const s = fakeStore();
    let mode: 'reject' | 'down' = 'reject';
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/api/profile/me')) return jsonRes(profile(100));
      if (url.includes('/api/stats/local')) {
        if (mode === 'down') throw new Error('network down');
        return jsonRes({ error: 'scores do not match the hand history' }, 400);
      }
      throw new Error(`unexpected ${url}`);
    });
    savePendingClaim(item('game-a'), NOW, s);
    expect((await submitPendingClaim({ storage: s, now: NOW })).status).toBe('rejected');
    expect(peekPendingClaim(NOW, s).state).toBe('none');

    savePendingClaim(item('game-b'), NOW, s);
    mode = 'down';
    expect((await submitPendingClaim({ storage: s, now: NOW })).status).toBe('error');
    expect(peekPendingClaim(NOW, s).state).toBe('held');
    vi.unstubAllGlobals();
  });

  it('a claim another account took reports claimed-elsewhere and clears', async () => {
    const s = fakeStore();
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/api/profile/me')) return jsonRes(profile(100));
      if (url.includes('/api/stats/local')) return jsonRes({ ok: true, duplicate: true, claimed: true });
      throw new Error(`unexpected ${url}`);
    });
    savePendingClaim(item('game-a'), NOW, s);
    expect((await submitPendingClaim({ storage: s, now: NOW })).status).toBe('claimed-elsewhere');
    expect(peekPendingClaim(NOW, s).state).toBe('none');
    vi.unstubAllGlobals();
  });

  it('an expired claim never posts', async () => {
    const s = fakeStore();
    let posts = 0;
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/api/stats/local')) { posts++; return jsonRes({ ok: true }); }
      throw new Error(`unexpected ${url}`);
    });
    savePendingClaim(item('game-a'), NOW, s);
    expect((await submitPendingClaim({ storage: s, now: NOW + CLAIM_TTL_MS + 1 })).status).toBe('expired');
    expect(posts).toBe(0);
    expect(peekPendingClaim(NOW, s).state).toBe('none');
    vi.unstubAllGlobals();
  });

  it('after sign-out the claim stays held and unsubmitted', async () => {
    const s = fakeStore();
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/api/auth/logout')) return jsonRes({ ok: true });
      throw new Error(`unexpected ${url}`);
    });
    await signOut();
    savePendingClaim(item('game-a'), NOW, s);
    expect((await submitPendingClaim({ storage: s, now: NOW })).status).toBe('signed-out');
    expect(peekPendingClaim(NOW, s).state).toBe('held');
    vi.unstubAllGlobals();
  });
});

describe('rewards claim panel', () => {
  it('held: shows the held copy + a working sign-in action; claiming: no button; unheld: the plain row', async () => {
    const { act, createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { default: GameOverRewards, computeRewards } = await import('../src/GameOverRewards');
    const data = computeRewards(null, null, { won: true, headline: 'VICTORY!', sub: '5 hands played', kind: 'team' });
    expect(data.signedIn).toBe(false);
    const mount = (guestClaim?: { held: boolean; claiming: boolean; onSignIn: () => void }) => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      act(() => {
        root.render(createElement(GameOverRewards, {
          data, onHome: () => {}, onRematch: () => {}, onProfile: () => {}, onOpenTables: () => {}, guestClaim,
        }));
      });
      return { container, root };
    };

    let clicks = 0;
    const held = mount({ held: true, claiming: false, onSignIn: () => { clicks++; } });
    expect(held.container.textContent).toContain('This game’s rewards are held for you');
    const btn = held.container.querySelector('[data-testid="rewards-claim-signin"]') as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    act(() => { btn!.click(); });
    expect(clicks).toBe(1);
    act(() => held.root.unmount());

    const claiming = mount({ held: true, claiming: true, onSignIn: () => {} });
    expect(claiming.container.textContent).toContain('Claiming your rewards…');
    expect(claiming.container.querySelector('[data-testid="rewards-claim-signin"]')).toBeNull();
    act(() => claiming.root.unmount());

    const plain = mount(undefined);
    expect(plain.container.textContent).toContain('Sign in to earn Rep rewards');
    expect(plain.container.querySelector('[data-testid="rewards-claim-signin"]')).toBeNull();
    act(() => plain.root.unmount());
  });
});

describe('rewards-screen deferral', () => {
  it('defers only while /rewards shows the same game unsigned', () => {
    const s: Store = fakeStore();
    savePendingClaim(item('game-a'), NOW, s);
    expect(claimDeferredToRewards(s)).toBe(false); // not on /rewards
    window.history.pushState({}, '', '/rewards');
    sessionStorage.setItem('bwm.rewards.v1', JSON.stringify({ gameId: 'game-a', data: { signedIn: false } }));
    expect(claimDeferredToRewards(s)).toBe(true);
    sessionStorage.setItem('bwm.rewards.v1', JSON.stringify({ gameId: 'game-other', data: { signedIn: false } }));
    expect(claimDeferredToRewards(s)).toBe(false);
    sessionStorage.setItem('bwm.rewards.v1', JSON.stringify({ gameId: 'game-a', data: { signedIn: true } }));
    expect(claimDeferredToRewards(s)).toBe(false);
    sessionStorage.removeItem('bwm.rewards.v1');
    window.history.pushState({}, '', '/');
  });
});
