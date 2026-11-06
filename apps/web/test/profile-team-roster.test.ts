/**
 * @vitest-environment happy-dom
 *
 * TEAM ROSTERS in My Career (owner, 2026-11-05): the team-name detail on
 * your OWN profile carries the roster — you (owner) plus up to 3 human
 * partners — with owner-only eject behind an inline confirm. Ejecting
 * updates the roster in place (no reload) and the recorded stats above it
 * do not move. Another player's profile shows no roster at all.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileView } from '../src/profile/ProfileView';
import { loadAccount } from '../src/account/api';
import { themeStore } from '../src/theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RANK = { division: 'block', elo: 1000, games: 10, wins: 4, losses: 6, peak: 1100, rank: 3, of: 9 };
const credBase = (id: string, name: string) => ({
  user: { id, name, avatar: null, avatarUpdatedAt: null, tagline: null, socialLinks: {} },
  level: { level: 11, xp: 463, title: 'Certified', xpForNext: 375, xpIntoLevel: 75 },
  season: { id: 's1', name: 'Season 1', endsAt: 0 },
  rank: { team: RANK, cutthroat: RANK },
  stats: { team: { games: 10, wins: 4 }, cutthroat: { games: 2, wins: 1 } },
  achievements: [],
  coins: { balance: 100 },
});
const SELF_FULL = { ...credBase('u-self-1', 'M33CH'), challenges: { daily: [], weekly: [] }, unlocks: [] };

const TEAMS = [
  {
    name: 'Homies', games: 67, wins: 32, losses: 35, winPct: 47.8, streak: 1, bestStreak: 5,
    accuracy: 61.2, booksPerHand: 3.05, nil: '13/22', wheels: 18, recorded: 'side',
    partner: { id: 'u:u-other-1', name: 'LovleyT714', avatar: null, games: 40 },
    others: [{ name: 'Tunde', games: 6 }],
  },
];
const socialRec = (username: string, id: string) => ({
  id, avatar: null, username, memberSince: 1760000000000, tagline: null,
  badges: [], teamNames: TEAMS.map((t) => t.name), teams: TEAMS,
  ratings: {}, totals: { games: 81, wins: 41 }, h2h: [], champion: 0,
  stats: { games: 81, wins: 41, streak: 1, bestStreak: 6, accuracy: 63.1, booksPerHand: 3.12, nil: '20/33', shotsGiven: 1, shotsTaken: 2, wheels: 21, bjWins: 1, bidSec: 5, playSec: 7 },
  awards: [],
});

let rosterState = [
  { name: 'Homies', full: false, members: [{ id: 'u-other-1', name: 'LovleyT714' }, { id: 'u-other-2', name: 'Rafa' }] },
];
const calls: { url: string; method: string }[] = [];

function mockFetch() {
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (url.includes('/api/auth/me')) return json({ user: { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] } });
    if (url.includes('/api/social/profile/M33CH')) return json(socialRec('M33CH', 'u-self-1'));
    if (url.includes('/api/social/profile/LovleyT714')) return json(socialRec('LovleyT714', 'u-other-1'));
    if (url.endsWith('/api/profile/me')) return json(SELF_FULL);
    if (url.endsWith('/api/profile/u-self-1')) return json(credBase('u-self-1', 'M33CH'));
    if (url.endsWith('/api/social/teams') && method === 'GET') return json({ teams: rosterState });
    if (url.includes('/api/social/teams/') && method === 'DELETE') {
      const member = decodeURIComponent(url.split('/').pop()!);
      rosterState = rosterState.map((t) => ({ ...t, members: t.members.filter((m) => m.id !== member), full: false }));
      return json(rosterState[0]);
    }
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
async function render(node: ReturnType<typeof createElement>) {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  return el;
}
async function tap(node: HTMLElement) {
  await act(async () => { node.click(); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}

beforeEach(async () => {
  calls.length = 0;
  rosterState = [
    { name: 'Homies', full: false, members: [{ id: 'u-other-1', name: 'LovleyT714' }, { id: 'u-other-2', name: 'Rafa' }] },
  ];
  // stub BEFORE loading the account, or the account lands signed-out and
  // the profile never reads as mine
  mockFetch();
  await act(async () => { await loadAccount(true); });
});
afterEach(() => { unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); act(() => themeStore.set('classic')); });

describe('team roster on My Career', () => {
  it('shows the roster with owner + members on my own team detail', async () => {
    mockFetch();
    const c = await render(createElement(ProfileView, { host: 'panel', name: 'M33CH', id: 'u:u-self-1' }));
    const chip = [...c.querySelectorAll('[data-testid="team-chip"]')].find((n) => n.getAttribute('data-team') === 'Homies')!;
    await tap(chip as HTMLElement);
    const roster = c.querySelector('[data-testid="team-roster"]');
    expect(roster).not.toBeNull();
    expect(roster!.textContent).toContain('LovleyT714');
    expect(roster!.textContent).toContain('Rafa');
    expect(roster!.textContent).toContain('owner');
    // the recorded record is still right there, unmoved
    const detail = c.querySelector('[data-testid="team-detail"]');
    expect(detail!.textContent).toContain('67');
  });

  it('ejects behind an inline confirm, in place, and the record does not move', async () => {
    mockFetch();
    const c = await render(createElement(ProfileView, { host: 'panel', name: 'M33CH', id: 'u:u-self-1' }));
    const chip = [...c.querySelectorAll('[data-testid="team-chip"]')].find((n) => n.getAttribute('data-team') === 'Homies')!;
    await tap(chip as HTMLElement);
    const ejectBtn = [...c.querySelectorAll('[data-testid="team-roster-eject"]')]
      .find((b) => b.getAttribute('data-member') === 'u-other-2') as HTMLElement;
    expect(ejectBtn).toBeTruthy();
    await tap(ejectBtn);
    // confirm step appears; nothing deleted yet
    expect(calls.some((x) => x.method === 'DELETE')).toBe(false);
    const confirm = c.querySelector('[data-testid="team-roster-confirm"]') as HTMLElement;
    expect(confirm).not.toBeNull();
    await tap(confirm);
    const del = calls.find((x) => x.method === 'DELETE');
    expect(del).toBeTruthy();
    expect(del!.url).toContain('/api/social/teams/u-self-1/Homies/members/u-other-2');
    const roster = c.querySelector('[data-testid="team-roster"]');
    expect(roster!.textContent).not.toContain('Rafa');
    expect(roster!.textContent).toContain('LovleyT714');
    const detail = c.querySelector('[data-testid="team-detail"]');
    expect(detail!.textContent).toContain('67');
  });

  it('never renders a roster on another player\'s profile', async () => {
    mockFetch();
    const c = await render(createElement(ProfileView, { host: 'panel', name: 'LovleyT714', id: 'u:u-other-1' }));
    const chip = [...c.querySelectorAll('[data-testid="team-chip"]')].find((n) => n.getAttribute('data-team') === 'Homies')!;
    await tap(chip as HTMLElement);
    expect(c.querySelector('[data-testid="team-detail"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="team-roster"]')).toBeNull();
  });
});
