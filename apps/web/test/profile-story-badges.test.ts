/**
 * @vitest-environment happy-dom
 *
 * STORY BADGES IN THE PROFILE (owner, 2026-10-22): the 13 story badges
 * lived only on the story map and the win screen; the owner approved
 * adding them to the ONE profile's Achievements tab — where his standing
 * design says a player looks for their collection. The section is SELF
 * view only: story progress is the account's private payload, served by
 * /api/story/progress for the caller alone. These pins hold the three
 * honesty edges: self + a real progress payload → the badges render with
 * the true count (the verbatim StoryBadges component); another player's
 * profile → the client never even asks for story progress and no section
 * renders; locked (403) or failed fetch → NOTHING renders — no zero-count
 * placeholder, no fabricated collection.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import { ProfileView } from '../src/profile/ProfileView';
import { loadAccount } from '../src/account/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------- fixtures */

const RANK = { division: 'block', elo: 1000, games: 10, wins: 4, losses: 6, peak: 1100, rank: 3, of: 9 };
const credBase = (id: string, name: string) => ({
  user: { id, name, avatar: null, avatarUpdatedAt: null, tagline: null, socialLinks: {} },
  level: { level: 11, xp: 463, title: 'Certified', xpForNext: 375, xpIntoLevel: 75 },
  season: { id: 's1', name: 'Season 1', endsAt: 0 },
  rank: { team: RANK, cutthroat: RANK },
  stats: { team: { games: 10, wins: 4 }, cutthroat: { games: 2, wins: 1 } },
  achievements: [{ id: 'first-dub', title: 'First Dub', hint: 'Win a game', xp: 25, coins: 0, unlockedAt: 123 }],
  coins: { balance: 3325 },
});
const SELF_FULL = {
  ...credBase('u-self-1', 'M33CH'),
  challenges: { daily: [], weekly: [] },
  unlocks: [],
};
const socialRec = (id: string, username: string) => ({
  id, avatar: null, username, memberSince: 1760000000000, tagline: null,
  badges: [], teamNames: ['Homies'],
  ratings: {}, totals: { games: 12, wins: 5 }, h2h: [], champion: 0,
  stats: { games: 12, wins: 5, streak: 2, bestStreak: 4, accuracy: 61.9, booksPerHand: 3.26, nil: '8/13', shotsGiven: 1, shotsTaken: 2, wheels: 0, bjWins: 1, bidSec: 5, playSec: 7 },
  awards: [],
});
/** The same facts the story suites pin: Porch cleared + the porch-radio
 *  egg found → Porch Graduate + Egg Hunter earned → "2 of 13". */
const STORY_PROGRESS = {
  track: 'solo', currentStop: 2, completed: false, completedAt: null, completionMark: null,
  finds: { eggs: ['porch-radio'], feats: [] },
  stops: STORY_STOPS.map((x) => ({
    stopId: x.id, n: x.n, state: x.id === 'porch' ? 'cleared' : 'locked',
    attempts: x.id === 'porch' ? 1 : 0, clears: x.id === 'porch' ? 1 : 0, firstClearedAt: null,
  })),
};

type StoryMode = 'ok' | 'locked' | 'error';
let storyMode: StoryMode = 'ok';
let storyFetches = 0;

function mockFetch() {
  const json = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: { get: () => 'application/json' }, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/api/story/progress')) {
      storyFetches++;
      if (storyMode === 'ok') return json(STORY_PROGRESS);
      if (storyMode === 'locked') return json({ error: 'Story mode is locked' }, 403);
      return json({ error: 'not found' }, 404);
    }
    if (url.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (url.includes('/api/auth/me')) return json({ user: { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] } });
    if (url.includes('/api/social/profile/M33CH')) return json(socialRec('u-self-1', 'M33CH'));
    if (url.includes('/api/social/profile/LovleyT714')) return json(socialRec('u-other-1', 'LovleyT714'));
    if (url.endsWith('/api/profile/me')) return json(SELF_FULL);
    if (url.endsWith('/api/profile/u-self-1')) return json(credBase('u-self-1', 'M33CH'));
    if (url.endsWith('/api/profile/u-other-1')) return json(credBase('u-other-1', 'LovleyT714'));
    return json({ error: 'not found' }, 404);
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

async function openAchievements(c: HTMLElement) {
  const tab = [...c.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((b) => b.textContent?.includes('Achievements'));
  expect(tab, 'Achievements tab exists').toBeTruthy();
  await act(async () => { tab!.click(); });
  await settle(4);
}

beforeEach(() => { storyMode = 'ok'; storyFetches = 0; mockFetch(); });
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe('story badges in the profile Achievements tab', () => {
  it('self view: the collection renders with the true earned count', async () => {
    await act(async () => { await loadAccount(true); });
    const page = await renderView(createElement(ProfileView, { host: 'page' }));
    await openAchievements(page);
    const section = page.querySelector('[data-testid="story-badges"]');
    expect(section, 'story badges section renders on your own Achievements tab').toBeTruthy();
    expect(page.querySelector('[data-testid="story-badges-count"]')!.textContent).toBe('2 of 13');
    expect(page.querySelector('[data-testid="story-badge-porch-graduate"]')!.getAttribute('data-earned')).toBe('true');
    expect(page.querySelector('[data-testid="story-badge-king-of-the-block"]')!.getAttribute('data-earned')).toBe('false');
    expect(storyFetches).toBeGreaterThan(0);
  });

  it('tap a badge in the tab: its explanation shows, same as on the map', async () => {
    await act(async () => { await loadAccount(true); });
    const page = await renderView(createElement(ProfileView, { host: 'page' }));
    await openAchievements(page);
    const badge = page.querySelector('[data-testid="story-badge-porch-graduate"]') as HTMLButtonElement;
    await act(async () => { badge.click(); });
    expect(page.querySelector('[data-testid="story-badge-detail"]')!.textContent).toContain('cleared The Porch');
  });

  it("another player's profile: no story section, and story progress is never even fetched", async () => {
    await act(async () => { await loadAccount(true); });
    const fetchesBefore = storyFetches;
    const panel = await renderView(createElement(ProfileView, { host: 'panel', name: 'LovleyT714', id: 'u:u-other-1' }));
    await openAchievements(panel);
    expect(panel.querySelector('[data-testid="story-badges"]')).toBeNull();
    expect(storyFetches).toBe(fetchesBefore);
  });

  it('story locked to this account (403): nothing renders — no placeholder, no invented count', async () => {
    storyMode = 'locked';
    await act(async () => { await loadAccount(true); });
    const page = await renderView(createElement(ProfileView, { host: 'page' }));
    await openAchievements(page);
    expect(page.querySelector('[data-testid="story-badges"]')).toBeNull();
    expect(page.textContent).not.toContain('0 of 13');
  });

  it('progress fetch fails: nothing renders', async () => {
    storyMode = 'error';
    await act(async () => { await loadAccount(true); });
    const page = await renderView(createElement(ProfileView, { host: 'page' }));
    await openAchievements(page);
    expect(page.querySelector('[data-testid="story-badges"]')).toBeNull();
    expect(page.textContent).not.toContain('0 of 13');
  });
});
