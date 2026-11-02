/**
 * @vitest-environment happy-dom
 *
 * CHALLENGE CLAIMS LAND IN PLACE (owner, 2026-11-01): "When I claim rewards
 * it looks like the whole page refreshes. I'd rather some sort of animation
 * and for the screen to not reload to have to scroll back down to claim
 * the next one."
 *
 * The old claim() ran reload() after the POST: reloadTick is a dependency
 * of the social-record effect, whose first act is setP(null) — and the
 * view early-returns its Loading stub while p is null, so the ENTIRE
 * profile (header, tabs, scroll content) unmounted and remounted at
 * scrollTop 0 on every single claim. These tests pin the replacement:
 *
 *  - a claim updates its own row + the header balances in place: the
 *    profile root, the tab body and every untouched row keep their exact
 *    DOM nodes (no remount = no scroll loss, by construction);
 *  - the social record is fetched exactly ONCE (it is never nulled);
 *  - the claimed row celebrates (just-claimed) into the same Claimed
 *    state every other claimed row shows;
 *  - several claims in a row each work from wherever the player is, a
 *    double-tap fires exactly one POST, and a failed claim stays inline
 *    in the tab with the row still claimable;
 *  - the quiet reconcile that follows a claim burst can never un-claim
 *    a row or step the balances backwards, even when its read is stale.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileView } from '../src/profile/ProfileView';
import { loadAccount } from '../src/account/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------- fixtures */

const RANK = { division: 'block', elo: 1000, games: 10, wins: 4, losses: 6, peak: 1100, rank: 3, of: 9 };

interface Ch { id: string; title: string; metric: string; target: number; progress: number; xp: number; coins: number; claimed: boolean }
const ch = (id: string, title: string, target: number, progress: number, xp: number, coins: number, claimed = false): Ch =>
  ({ id, title, metric: 'games', target, progress, xp, coins, claimed });

const DEFS: Record<string, Ch> = {
  'd-pre': ch('d-pre', 'Give 3 shots', 3, 3, 25, 10, true),
  'd-play': ch('d-play', 'Play 20 games', 20, 20, 150, 100),
  'd-fail': ch('d-fail', 'Win 3 in a row', 3, 3, 75, 50),
  'd-open': ch('d-open', 'Play 3 games', 3, 1, 25, 0),
  'w-books': ch('w-books', 'Take 60 books', 60, 60, 150, 100),
  's-cut': ch('s-cut', 'Win 6 cutthroat games this season', 6, 6, 600, 475),
};
const BASE_COINS = 3325;
const BASE_XP = 463;

const socialRec = {
  id: 'u-self-1', avatar: null, username: 'M33CH', memberSince: 1760000000000, tagline: null,
  badges: [], teamNames: ['Homies'], ratings: {}, totals: { games: 12, wins: 5 }, h2h: [], champion: 0,
  stats: { games: 12, wins: 5, streak: 2, bestStreak: 4, accuracy: 61.9, booksPerHand: 3.26, nil: '8/13', shotsGiven: 1, shotsTaken: 2, wheels: 0, bjWins: 1, bidSec: 5, playSec: 7 },
  awards: [],
};

/* A stateful fake server: claims stick, /api/profile/me reflects them —
 * unless `staleMe` is set, in which case /me keeps serving the pre-claim
 * payload (a read that predates the claims) to prove the merge holds. */
const server = {
  claimed: new Set<string>(['d-pre']),
  staleMe: false,
  failIds: new Set<string>(['d-fail']),
  counts: { social: 0, me: 0, claims: new Map<string, number>() },
  reset() {
    this.claimed = new Set(['d-pre']);
    this.staleMe = false;
    this.failIds = new Set(['d-fail']);
    this.counts = { social: 0, me: 0, claims: new Map() };
  },
};

function mePayload() {
  const claimed = server.staleMe ? new Set(['d-pre']) : server.claimed;
  const grantSum = (pick: (c: Ch) => number) =>
    [...claimed].reduce((sum, id) => sum + pick(DEFS[id]!), 0) - pick(DEFS['d-pre']!);
  const withClaimed = (c: Ch) => ({ ...c, claimed: claimed.has(c.id) });
  return {
    user: { id: 'u-self-1', name: 'M33CH', avatar: null, avatarUpdatedAt: null, tagline: null, socialLinks: {}, region: null },
    level: { level: 11, xp: BASE_XP + grantSum((c) => c.xp), title: 'Certified', xpForNext: 375, xpIntoLevel: 75 + grantSum((c) => c.xp) },
    season: { id: 's2', name: 'Season 2', endsAt: Date.now() + 29 * 86_400_000 },
    rank: { team: RANK, cutthroat: RANK },
    stats: { team: { games: 10, wins: 4 }, cutthroat: { games: 2, wins: 1 } },
    achievements: [],
    coins: { balance: BASE_COINS + grantSum((c) => c.coins) },
    challenges: {
      daily: [DEFS['d-pre']!, DEFS['d-play']!, DEFS['d-fail']!, DEFS['d-open']!].map(withClaimed),
      weekly: [DEFS['w-books']!].map(withClaimed),
      season: { id: 's2', name: 'Season 2', endsAt: Date.now() + 29 * 86_400_000, challenges: [DEFS['s-cut']!].map(withClaimed) },
    },
    unlocks: [],
  };
}

function mockFetch() {
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 400, headers: { get: () => 'application/json' }, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    if (url.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (url.includes('/api/auth/me')) return json({ user: { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] } });
    if (url.includes('/api/social/profile/')) { server.counts.social += 1; return json(socialRec); }
    const claimMatch = url.match(/\/api\/challenges\/([^/]+)\/claim/);
    if (claimMatch && init?.method === 'POST') {
      const id = claimMatch[1]!;
      server.counts.claims.set(id, (server.counts.claims.get(id) ?? 0) + 1);
      if (server.failIds.has(id)) return json({ error: 'Already claimed.' }, false);
      server.claimed.add(id);
      return json({ ok: true, xp: DEFS[id]!.xp, coins: DEFS[id]!.coins });
    }
    if (url.endsWith('/api/profile/me')) { server.counts.me += 1; return json(mePayload()); }
    if (url.endsWith('/api/profile/u-self-1')) return json(mePayload());
    return json({ error: 'not found' }, false);
  }));
}

/* ------------------------------------------------------------- rendering */

let root: Root | null = null;
let el: HTMLDivElement | null = null;

function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}

async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}

async function renderView(node: React.ReactNode) {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  await settle();
  return el;
}

async function openChallenges(container: HTMLElement) {
  const tab = [...container.querySelectorAll('[role="tab"]')].find((n) => (n.textContent ?? '').includes('Challenges'));
  expect(tab, 'Challenges tab exists').toBeTruthy();
  await act(async () => { (tab as HTMLButtonElement).click(); });
  await settle(3);
}

const row = (c: HTMLElement, cid: string) => c.querySelector(`[data-cid="${cid}"]`);
const claimButton = (c: HTMLElement, cid: string) => row(c, cid)?.querySelector('button') as HTMLButtonElement | null;
const coinsText = (c: HTMLElement) => c.querySelector('[data-testid="profile-coins"]')?.textContent ?? '';

async function clickClaim(c: HTMLElement, cid: string) {
  const btn = claimButton(c, cid);
  expect(btn, `claim button for ${cid}`).toBeTruthy();
  await act(async () => { btn!.click(); });
  await settle();
}

beforeEach(() => { server.reset(); mockFetch(); });
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

/* ---------------------------------------------------------------- tests */

describe('challenge claims land in place', () => {
  it('panel host: three claims in a row — no remount, no social refetch, balances tick up', async () => {
    await act(async () => { await loadAccount(true); });
    const c = await renderView(createElement(ProfileView, { host: 'panel', name: 'M33CH', id: 'u:u-self-1' }));
    await openChallenges(c);

    // identity anchors: if any of these nodes is replaced, the view remounted
    const rootNode = c.querySelector('[data-testid="profile"]');
    const bodyNode = c.querySelector('.prof-body');
    const preRow = row(c, 'd-pre');
    const openRow = row(c, 'd-open');
    const booksRow = row(c, 'w-books');
    expect(preRow?.textContent).toContain('Claimed');
    expect(coinsText(c)).toContain('3,325');
    expect(server.counts.social).toBe(1);

    await clickClaim(c, 'd-play');
    expect(row(c, 'd-play')?.textContent).toContain('Claimed');
    expect(row(c, 'd-play')?.className).toContain('just-claimed'); // the celebration beat
    expect(row(c, 'd-play')?.querySelector('small')?.className).toContain('affirm');
    expect(coinsText(c)).toContain('3,425');
    expect(row(c, 'w-books')).toBe(booksRow);
    expect(row(c, 'd-pre')).toBe(preRow);

    await clickClaim(c, 'w-books');
    expect(row(c, 'w-books')?.textContent).toContain('Claimed');
    expect(coinsText(c)).toContain('3,525');

    await clickClaim(c, 's-cut');
    expect(row(c, 's-cut')?.textContent).toContain('Claimed');
    expect(coinsText(c)).toContain('4,000');

    // nothing remounted, the social record was never re-fetched or nulled,
    // and the tab dot (pending claims) is gone now that all are claimed
    expect(c.querySelector('[data-testid="profile"]')).toBe(rootNode);
    expect(c.querySelector('.prof-body')).toBe(bodyNode);
    expect(row(c, 'd-open')).toBe(openRow);
    expect(server.counts.social).toBe(1);
    // one pending claim remains (d-fail, deliberately never claimed here)
    const tab = [...c.querySelectorAll('[role="tab"]')].find((n) => (n.textContent ?? '').includes('Challenges'));
    expect(tab?.querySelector('.tab-dot')?.textContent).toBe('1');
    // the Earned summary reflects every claim, including the pre-claimed one
    const earned = c.querySelector('[data-testid="challenges-earned"]')?.textContent ?? '';
    expect(earned).toContain('925 XP');
    expect(earned).toContain('685 coins');
  });

  it('page host: a claim updates the row in place there too', async () => {
    await act(async () => { await loadAccount(true); });
    const c = await renderView(createElement(ProfileView, { host: 'page' }));
    await openChallenges(c);
    const booksRow = row(c, 'w-books');
    await clickClaim(c, 'd-play');
    expect(row(c, 'd-play')?.textContent).toContain('Claimed');
    expect(row(c, 'w-books')).toBe(booksRow);
    expect(coinsText(c)).toContain('3,425');
    expect(server.counts.social).toBe(1);
  });

  it('a double-tap fires exactly one claim POST and the row disables in flight', async () => {
    await act(async () => { await loadAccount(true); });
    const c = await renderView(createElement(ProfileView, { host: 'panel', name: 'M33CH', id: 'u:u-self-1' }));
    await openChallenges(c);
    const btn = claimButton(c, 'd-play');
    expect(btn).toBeTruthy();
    await act(async () => { btn!.click(); btn!.click(); });
    await settle();
    expect(server.counts.claims.get('d-play')).toBe(1);
    expect(row(c, 'd-play')?.textContent).toContain('Claimed');
  });

  it('a failed claim stays inline, the row stays claimable, nothing remounts', async () => {
    await act(async () => { await loadAccount(true); });
    const c = await renderView(createElement(ProfileView, { host: 'panel', name: 'M33CH', id: 'u:u-self-1' }));
    await openChallenges(c);
    const playRow = row(c, 'd-play');
    await clickClaim(c, 'd-fail');
    const alert = c.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Already claimed.');
    // the alert lives inside the profile (the tab), not on some error screen
    expect(c.querySelector('[data-testid="profile"]')?.contains(alert)).toBe(true);
    const btn = claimButton(c, 'd-fail');
    expect(btn?.textContent).toContain('Claim');
    expect(btn?.disabled).toBe(false);
    expect(row(c, 'd-play')).toBe(playRow);
    expect(server.counts.social).toBe(1);
  });

  it('a stale reconcile read never un-claims a row or steps balances back', async () => {
    await act(async () => { await loadAccount(true); });
    const c = await renderView(createElement(ProfileView, { host: 'panel', name: 'M33CH', id: 'u:u-self-1' }));
    await openChallenges(c);
    server.staleMe = true; // every /me read from here serves the pre-claim payload
    await clickClaim(c, 'd-play');
    await settle(); // let the quiet reconcile land
    expect(row(c, 'd-play')?.textContent).toContain('Claimed');
    expect(claimButton(c, 'd-play')).toBeNull();
    expect(coinsText(c)).toContain('3,425');
  });
});
