/**
 * @vitest-environment happy-dom
 *
 * TAPPABLE TEAM NAMES (owner, 2026-11-04): "I should be able to tap a team
 * name and see the teams stats for that team." The Stats tab's Team names
 * chips become real buttons when the social payload carries the per-team
 * records (`teams`, computed server-side from recorded games); tapping one
 * opens that team's detail inline — partner (tappable through to their
 * profile when signed in; plain text for a bot), the shared record, and
 * the team's stat rows. A payload WITHOUT `teams` keeps the old inert
 * chips, so nothing ever looks tappable-but-dead. A team with no recorded
 * games shows an honest empty state, never zero-filled stats.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileView } from '../src/profile/ProfileView';
import { loadAccount } from '../src/account/api';
import { social } from '../src/social/store';
import { themeStore } from '../src/theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------- fixtures */

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
const SELF_FULL = {
  ...credBase('u-self-1', 'M33CH'),
  challenges: { daily: [], weekly: [] },
  unlocks: [],
};

const TEAMS = [
  {
    name: 'Big Dawgs', games: 14, wins: 9, losses: 5, winPct: 64.3, streak: 2, bestStreak: 6,
    accuracy: 68.4, booksPerHand: 3.31, nil: '7/11', wheels: 3, recorded: 'side',
    partner: { id: 'u:u-other-1', name: 'LovleyT714', avatar: null, games: 14 }, others: [],
  },
  {
    name: 'Homies', games: 67, wins: 32, losses: 35, winPct: 47.8, streak: 1, bestStreak: 5,
    accuracy: 61.2, booksPerHand: 3.05, nil: '13/22', wheels: 18, recorded: 'self',
    partner: { name: 'Dee', bot: true, games: 67 }, others: [],
  },
  {
    name: 'Ghost Crew', games: 0, wins: 0, losses: 0, winPct: null, streak: 0, bestStreak: 0,
    accuracy: null, booksPerHand: null, nil: '0/0', wheels: 0, recorded: 'self',
    partner: null, others: [],
  },
];

const socialRec = (withTeams: boolean) => ({
  id: 'u-self-1', avatar: null, username: 'M33CH', memberSince: 1760000000000, tagline: null,
  badges: [], teamNames: TEAMS.map((t) => t.name), ...(withTeams ? { teams: TEAMS } : {}),
  ratings: {}, totals: { games: 81, wins: 41 }, h2h: [], champion: 0,
  stats: { games: 81, wins: 41, streak: 1, bestStreak: 6, accuracy: 63.1, booksPerHand: 3.12, nil: '20/33', shotsGiven: 1, shotsTaken: 2, wheels: 21, bjWins: 1, bidSec: 5, playSec: 7 },
  awards: [],
});

function mockFetch(withTeams: boolean) {
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (url.includes('/api/auth/me')) return json({ user: { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] } });
    if (url.includes('/api/social/profile/M33CH')) return json(socialRec(withTeams));
    if (url.endsWith('/api/profile/me')) return json(SELF_FULL);
    if (url.endsWith('/api/profile/u-self-1')) return json(credBase('u-self-1', 'M33CH'));
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

async function renderSelf() {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  const node = createElement(ProfileView, { host: 'panel', name: 'M33CH', id: 'u:u-self-1' });
  await act(async () => { root!.render(node); });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  return el;
}

const chips = (c: HTMLElement) => [...c.querySelectorAll('[data-testid="team-chip"]')] as HTMLElement[];
const chipFor = (c: HTMLElement, name: string) => chips(c).find((n) => n.getAttribute('data-team') === name);
const detail = (c: HTMLElement) => c.querySelector('[data-testid="team-detail"]');

async function tap(node: HTMLElement) {
  await act(async () => { node.click(); });
  for (let i = 0; i < 2; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}

beforeEach(async () => { await act(async () => { await loadAccount(true); }); });
afterEach(() => { unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); act(() => themeStore.set('classic')); });

describe('tappable team names', () => {
  it('chips are real buttons when the payload carries team records', async () => {
    mockFetch(true);
    const c = await renderSelf();
    expect(chips(c).map((n) => n.tagName)).toEqual(['BUTTON', 'BUTTON', 'BUTTON']);
    expect(chips(c).map((n) => n.getAttribute('data-team'))).toEqual(['Big Dawgs', 'Homies', 'Ghost Crew']);
    expect(detail(c)).toBeNull();
  });

  it("tapping a signed-in duo's chip opens that team's exact record; the partner taps through", async () => {
    mockFetch(true);
    const c = await renderSelf();
    const spy = vi.spyOn(social, 'showProfile');
    await tap(chipFor(c, 'Big Dawgs')!);
    const d = detail(c)!;
    expect(d).not.toBeNull();
    expect(d.textContent).toContain('Big Dawgs');
    expect(d.textContent).toContain('LovleyT714');
    expect(d.textContent).toContain('14');
    expect(d.textContent).toContain('9–5');
    expect(d.textContent).toContain('64.3%');
    expect(d.textContent).toContain('2 (best 6)');
    expect(d.textContent).toContain('68.4%');
    expect(d.textContent).toContain('3.31');
    expect(d.textContent).toContain('7/11');
    const partner = d.querySelector('[data-testid="team-partner"]') as HTMLButtonElement;
    expect(partner).not.toBeNull();
    expect(partner.tagName).toBe('BUTTON');
    await tap(partner);
    expect(spy).toHaveBeenCalledWith('LovleyT714', 'u:u-other-1');
  });

  it("a bot partner's chip opens the record with the bot named as text — no profile tap", async () => {
    mockFetch(true);
    const c = await renderSelf();
    const spy = vi.spyOn(social, 'showProfile');
    await tap(chipFor(c, 'Homies')!);
    const d = detail(c)!;
    expect(d.textContent).toContain('Dee');
    expect(d.textContent).toContain('Bot partner');
    expect(d.textContent).toContain('32–35');
    expect(d.textContent).toContain('not recorded');
    expect(d.querySelector('[data-testid="team-partner"]')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('a team with no recorded games shows the honest empty state, not zero stats', async () => {
    mockFetch(true);
    const c = await renderSelf();
    await tap(chipFor(c, 'Ghost Crew')!);
    const d = detail(c)!;
    expect(d.querySelector('[data-testid="team-empty"]')).not.toBeNull();
    expect(d.textContent).toContain('No recorded games under this name yet');
    expect(d.querySelectorAll('.stat-row').length).toBe(0);
  });

  it('tapping the open chip again closes the detail', async () => {
    mockFetch(true);
    const c = await renderSelf();
    await tap(chipFor(c, 'Big Dawgs')!);
    expect(detail(c)).not.toBeNull();
    await tap(chipFor(c, 'Big Dawgs')!);
    expect(detail(c)).toBeNull();
  });

  it('a payload without team records keeps inert chips (nothing tappable-but-dead)', async () => {
    mockFetch(false);
    const c = await renderSelf();
    expect(chips(c).length).toBe(0);
    const spans = [...c.querySelectorAll('.soc-badge-chip')].filter((n) => ['Big Dawgs', 'Homies', 'Ghost Crew'].includes(n.textContent ?? ''));
    expect(spans.length).toBe(3);
    expect(spans.every((n) => n.tagName === 'SPAN')).toBe(true);
  });

  it('theme parity: the team section is identical under Classic and Neon', async () => {
    mockFetch(true);
    const section = async (theme: 'classic' | 'neon') => {
      act(() => themeStore.set(theme));
      const c = await renderSelf();
      await tap(chipFor(c, 'Big Dawgs')!);
      const names = chips(c).map((n) => `${n.tagName}:${n.getAttribute('data-team')}`);
      return { names, detail: detail(c)?.textContent ?? '' };
    };
    const classic = await section('classic');
    const neon = await section('neon');
    expect(neon).toEqual(classic);
    expect(classic.detail).toContain('LovleyT714');
  });
});
