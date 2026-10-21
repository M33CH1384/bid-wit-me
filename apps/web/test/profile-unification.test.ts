/**
 * @vitest-environment happy-dom
 *
 * ONE PROFILE GUARDRAIL (owner rule, 2026-10-20): "I really don't get why we
 * have a rep profile and then a completely separate profile page if I tap on
 * my name from the players menu — it's confusing and bad user experience."
 *
 * There is exactly ONE full-profile implementation — src/profile/ProfileView.tsx —
 * and every entry point lands on it: the /profile route (Account → REP PROFILE)
 * renders it as a page, the Social panel renders it as its profile view, for
 * your own profile and everyone else's alike. This guard renders the SAME
 * subject through BOTH hosts against the same mocked endpoints and requires
 * the section/testid inventory to match exactly (the only allowed delta is
 * host chrome: the panel's Back button and root marker vs the page bar), for
 * an other-player subject AND for the self subject (where the self-only edit
 * controls, Challenges and Unlocks belong — the server keeps those payloads
 * private, so their absence on other profiles is a data difference, pinned
 * here as the ONLY content delta between self and other). Source pins keep a
 * second full-profile body from quietly growing back in Social.tsx or
 * ProfilePage.tsx.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileView } from '../src/profile/ProfileView';
import { loadAccount } from '../src/account/api';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/* ------------------------------------------------------------- fixtures */

const RANK = { division: 'block', elo: 1000, games: 10, wins: 4, losses: 6, peak: 1100, rank: 3, of: 9 };
const credBase = (id: string, name: string) => ({
  user: { id, name, avatar: null, avatarUpdatedAt: null, tagline: 'Love don’t live hea', socialLinks: {} },
  level: { level: 11, xp: 463, title: 'Certified', xpForNext: 375, xpIntoLevel: 75 },
  season: { id: 's1', name: 'Season 1', endsAt: 0 },
  rank: { team: RANK, cutthroat: RANK },
  stats: { team: { games: 10, wins: 4 }, cutthroat: { games: 2, wins: 1 } },
  achievements: [{ id: 'first-dub', title: 'First Dub', hint: 'Win a game', xp: 25, coins: 0, unlockedAt: 123 }],
  coins: { balance: 3325 },
});
const SELF_FULL = {
  ...credBase('u-self-1', 'M33CH'),
  challenges: { daily: [{ id: 'd1', title: 'Play 3 games', metric: 'games', target: 3, progress: 1, xp: 25, coins: 0, claimed: false }], weekly: [] },
  unlocks: [{ itemId: 'venue:pjs', source: 'level', unlockedAt: 5, slot: null, equipped: false }],
};
const OTHER_PUBLIC = credBase('u-other-1', 'LovleyT714');
const socialRec = (id: string, username: string) => ({
  id, avatar: null, username, memberSince: 1760000000000, tagline: null,
  badges: [{ id: 'storm-chaser', earnedAt: 7 }], teamNames: ['Homies'],
  ratings: {}, totals: { games: 12, wins: 5 }, h2h: [], champion: 0,
  stats: { games: 12, wins: 5, streak: 2, bestStreak: 4, accuracy: 61.9, booksPerHand: 3.26, nil: '8/13', shotsGiven: 1, shotsTaken: 2, wheels: 0, bjWins: 1, bidSec: 5, playSec: 7 },
  awards: [],
});

function mockFetch() {
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (url.includes('/api/auth/me')) return json({ user: { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] } });
    if (url.includes('/api/social/profile/M33CH')) return json(socialRec('u-self-1', 'M33CH'));
    if (url.includes('/api/social/profile/LovleyT714')) return json(socialRec('u-other-1', 'LovleyT714'));
    if (url.endsWith('/api/profile/me')) return json(SELF_FULL);
    if (url.endsWith('/api/profile/u-self-1')) return json(credBase('u-self-1', 'M33CH'));
    if (url.endsWith('/api/profile/u-other-1')) return json(OTHER_PUBLIC);
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

async function renderView(node: React.ReactNode) {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  // settle the chained fetches (social record → uid → cred payload → render)
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  return el;
}

/** The profile's content inventory: every testid, tab and section heading —
 *  deliberately EXCLUDING host chrome (the panel Back button / root marker
 *  and the page bar), which is the one allowed difference between hosts. */
function inventory(c: HTMLElement) {
  const items: string[] = [];
  c.querySelectorAll('[data-testid]').forEach((n) => {
    const t = n.getAttribute('data-testid')!;
    if (t === 'profile' || t === 'profile-back') return; // host chrome
    items.push(`testid:${t}`);
  });
  c.querySelectorAll('[role="tab"]').forEach((n) => items.push(`tab:${(n.textContent ?? '').trim()}`));
  c.querySelectorAll('h3, h4').forEach((n) => items.push(`h:${(n.textContent ?? '').trim()}`));
  return items.sort();
}

beforeEach(() => { mockFetch(); });
afterEach(() => { unmount(); vi.unstubAllGlobals(); });

describe('one profile, both hosts', () => {
  it('another player: the panel view and the page are the same profile', async () => {
    const panel = await renderView(createElement(ProfileView, { host: 'panel', name: 'LovleyT714', id: 'u:u-other-1' }));
    const panelInv = inventory(panel);
    const page = await renderView(createElement(ProfileView, { host: 'page', name: 'LovleyT714', id: 'u-other-1' }));
    expect(inventory(page)).toEqual(panelInv);
    // the shared content is really there: header Rep block, action row, tabs
    expect(panelInv).toContain('testid:profile-rep');
    expect(panelInv).toContain('testid:profile-coins');
    expect(panelInv).toContain('testid:profile-add');
    // no Rank tab anymore (owner, 2026-10-20): the rating cards + metric
    // explainer ride at the top of Stats, which is the default tab now
    expect(panelInv).not.toContain('tab:Rank');
    expect(panelInv).toContain('tab:Stats');
    expect(panelInv).toContain('testid:rating-explainer');
    // …and none of the self-only content leaks into another player's profile
    expect(panelInv).not.toContain('tab:Challenges');
    expect(panelInv).not.toContain('tab:Unlocks');
    expect(panelInv).not.toContain('testid:avatar-upload');
    expect(panelInv).not.toContain('testid:profile-edit');
  });

  it('your own profile: the panel view and the /profile route are the same profile', async () => {
    await act(async () => { await loadAccount(true); });
    const panel = await renderView(createElement(ProfileView, { host: 'panel', name: 'M33CH', id: 'u:u-self-1' }));
    const panelInv = inventory(panel);
    const page = await renderView(createElement(ProfileView, { host: 'page' }));
    expect(inventory(page)).toEqual(panelInv);
    // plain language only (owner, 2026-10-20: "no one knows what elo is
    // including me") and no named tiers anywhere on the profile: the chips
    // are plain ratings, the cards are metrics, the explainer is numbers.
    const text = page.textContent ?? '';
    expect(text).not.toContain('ELO');
    expect(text).not.toContain('Elo');
    expect(text).toContain('Rating starts at 1,000.');
    expect(text).toContain('This season');
    expect(text).toContain('4 wins – 6 losses');
    expect(text).toContain('#3 of 9 players');
    expect(text).toContain('Best rating');
    const chips = page.querySelector('[data-testid="profile-rep"]')?.textContent ?? '';
    expect(chips).toContain('Rating 1000');
    expect(chips).not.toContain('Block');
    // self-only affordances ride along in BOTH hosts now — same page, same
    // person. The editors themselves stay HIDDEN behind the one Edit profile
    // button (owner, 2026-10-20): the initial render is display-only, in
    // both hosts alike, so the inventories still match exactly.
    expect(panelInv).toContain('testid:profile-edit');
    expect(panelInv).toContain('tab:Challenges');
    expect(panelInv).toContain('tab:Unlocks');
    expect(panelInv).not.toContain('testid:avatar-upload');
    expect(panelInv).not.toContain('testid:tagline-input');
    expect(panelInv).not.toContain('testid:social-input-instagram');
    expect(panelInv).not.toContain('testid:social-save');
    // …and the other-player action row never renders on your own profile
    expect(panelInv).not.toContain('testid:profile-add');
    expect(panelInv).not.toContain('testid:profile-block');
  });

  it('Edit profile reveals the whole editor stack; Done hides it again', async () => {
    await act(async () => { await loadAccount(true); });
    const page = await renderView(createElement(ProfileView, { host: 'page' }));
    const testids = () => [...page.querySelectorAll('[data-testid]')].map((n) => n.getAttribute('data-testid'));
    expect(testids()).toContain('profile-edit');
    expect(testids()).not.toContain('avatar-upload');
    const btn = page.querySelector('[data-testid="profile-edit"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('Edit profile');
    await act(async () => { btn.click(); });
    // picture, tagline and links editors all show — the links inputs directly
    // (the old separate Edit-links collapse is subsumed by this one gate)
    expect(testids()).toContain('avatar-upload');
    expect(testids()).toContain('tagline-input');
    expect(testids()).toContain('tagline-save');
    expect(testids()).toContain('region-input');
    expect(testids()).toContain('region-save');
    expect(testids()).toContain('social-input-instagram');
    expect(testids()).toContain('social-save');
    expect(testids()).toContain('social-cancel');
    expect(testids()).not.toContain('social-edit');
    const done = page.querySelector('[data-testid="profile-edit"]') as HTMLButtonElement;
    expect(done.textContent).toContain('Done');
    await act(async () => { done.click(); });
    expect(testids()).not.toContain('avatar-upload');
    expect(testids()).not.toContain('tagline-input');
    expect(testids()).not.toContain('region-input');
    expect(testids()).not.toContain('social-input-instagram');
  });
});

describe('one implementation: no second full-profile body can grow back', () => {
  const social = read('../src/social/Social.tsx');
  const page = read('../src/profile/ProfilePage.tsx');
  const view = read('../src/profile/ProfileView.tsx');
  const account = read('../src/account/AccountUI.tsx');

  it('the tabbed body and the social-record sections exist only in ProfileView', () => {
    for (const src of [social, page]) {
      expect(src).not.toContain('className="prof-tabs"');
      expect(src).not.toContain('data-testid="profile-h2h"');
      expect(src).not.toContain('function RankCard');
      expect(src).not.toContain('function ChallengeRow');
    }
    expect(view).toContain('className="prof-tabs"');
    expect(view).toContain('data-testid="profile-h2h"');
  });

  it('Social.tsx retired its private Profile component', () => {
    expect(social).not.toContain('function Profile(');
    expect(social).not.toContain('interface ProfileData');
    expect(social).not.toContain('soc-prof-acts');
  });

  it('every host renders the one view, and the Account button lands on the same route', () => {
    expect(social).toContain('<ProfileView host="panel"');
    expect(page).toContain('<ProfileView host="page" />');
    expect(account).toContain('data-testid="open-profile"');
    expect(account).toContain("location.href = '/profile'");
  });
});
