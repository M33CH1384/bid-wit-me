/**
 * @vitest-environment happy-dom
 *
 * SEASON CHALLENGES on the profile (owner, 2026-10-23): the Challenges tab
 * gains the season section — season name + time left, the dealt set with
 * live progress bars and claim states — and, ONLY for an earned Big Joker
 * holder, the upkeep line in its three truthful states (set complete /
 * crown lit, set pending / crown dark). A non-holder's season section is
 * pure content: no Big Joker framing anywhere.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProfileView } from '../src/profile/ProfileView';
import { loadAccount } from '../src/account/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RANK = { division: 'block', elo: 1000, games: 10, wins: 4, losses: 6, peak: 1100, rank: 3, of: 9 };
const SEASON_CH = { id: 'szn-games-40', title: 'Play 40 games this season', metric: 'games', target: 40, progress: 17, xp: 500, coins: 400, claimed: false };
const SEASON_DONE = { id: 'szn-nil-4', title: 'Make 4 nils this season', metric: 'nils_made', target: 4, progress: 4, xp: 800, coins: 650, claimed: false };

const selfWithSeason = (bigJoker: { earned: true; active: boolean } | null, setComplete: boolean) => ({
  user: { id: 'u-self-1', name: 'M33CH', avatar: null, avatarUpdatedAt: null, tagline: null, socialLinks: {}, region: null },
  level: { level: 50, xp: 40000, title: 'King of the Block', xpForNext: 0, xpIntoLevel: 0 },
  season: { id: '2026-10', name: 'Season 1', endsAt: Date.UTC(2026, 10, 1) },
  rank: { team: RANK, cutthroat: RANK },
  stats: { team: { games: 10, wins: 4 }, cutthroat: { games: 2, wins: 1 } },
  achievements: [],
  coins: { balance: 100 },
  challenges: {
    daily: [], weekly: [],
    season: {
      id: '2026-10', name: 'Season 1', endsAt: Date.now() + 5 * 86_400_000, setComplete,
      challenges: [SEASON_CH, ...(setComplete ? [SEASON_DONE] : [])],
      bigJoker,
    },
  },
  unlocks: [],
});

let payload: unknown;
function mockFetch() {
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (url.includes('/api/auth/me')) return json({ user: { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] } });
    if (url.includes('/api/social/profile/M33CH')) return json({ id: 'u-self-1', avatar: null, username: 'M33CH', memberSince: 1760000000000, tagline: null, badges: [], teamNames: [], ratings: {}, totals: { games: 0, wins: 0 }, h2h: [], champion: 0, stats: null, awards: [] });
    if (url.endsWith('/api/profile/me')) return json(payload);
    return json({ error: 'not found' }, false);
  }));
}

let root: Root | null = null;
let el: HTMLDivElement | null = null;
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}

async function renderChallengesTab() {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(ProfileView, { host: 'page' })); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  const tabBtn = [...el.querySelectorAll('[role="tab"]')].find((n) => (n.textContent ?? '').includes('Challenges'));
  expect(tabBtn, 'Challenges tab exists').toBeTruthy();
  await act(async () => { (tabBtn as HTMLButtonElement).click(); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  return el;
}

afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe('the season section of the Challenges tab', () => {
  it('a non-holder sees the season set as pure content — name, days left, progress, no Big Joker framing', async () => {
    payload = selfWithSeason(null, false);
    mockFetch();
    await act(async () => { await loadAccount(true); });
    const page = await renderChallengesTab();
    const section = page.querySelector('[data-testid="season-challenges"]');
    expect(section).toBeTruthy();
    expect(section!.textContent).toContain('Season 1');
    expect(section!.textContent).toContain('days left');
    expect(section!.textContent).toContain('Play 40 games this season');
    expect(section!.textContent).toContain('17/40');
    expect(page.querySelector('[data-testid="season-upkeep"]')).toBeNull();
    expect(section!.textContent).not.toContain('Big Joker');
  });

  it('a holder with the set complete reads the crown secured; an unclaimed finisher still gets a Claim button', async () => {
    payload = selfWithSeason({ earned: true, active: true }, true);
    mockFetch();
    await act(async () => { await loadAccount(true); });
    const page = await renderChallengesTab();
    const upkeep = page.querySelector('[data-testid="season-upkeep"]');
    expect(upkeep?.textContent).toContain('Big Joker');
    expect(upkeep?.textContent).toContain('season set complete');
    const section = page.querySelector('[data-testid="season-challenges"]')!;
    expect(section.textContent).toContain('Make 4 nils this season');
    expect([...section.querySelectorAll('button')].some((b) => b.textContent === 'Claim')).toBe(true);
  });

  it('a lapsed holder reads the upkeep as due — the crown is dark until the set is finished', async () => {
    payload = selfWithSeason({ earned: true, active: false }, false);
    mockFetch();
    await act(async () => { await loadAccount(true); });
    const page = await renderChallengesTab();
    const upkeep = page.querySelector('[data-testid="season-upkeep"]');
    expect(upkeep?.textContent).toContain('Big Joker');
    expect(upkeep?.textContent).toContain('dark');
  });
});
