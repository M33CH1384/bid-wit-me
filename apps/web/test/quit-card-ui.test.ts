/**
 * @vitest-environment happy-dom
 *
 * Quit metrics on player cards — the render half (owner placement call,
 * 2026-11-02). The payload block is card.stats.quits (server contract in
 * apps/server/test/quit-card.test.ts); these tests pin what the surfaces
 * DO with it:
 * - the Player Card back shows the one-line summary when the player has
 *   rated starts, and stays silent when they have none (the card's
 *   no-fabricated-zeroes doctrine) or when a stale payload lacks the block;
 * - the profile Stats tab shows the full row set + the rated-scope note;
 * - both read the same numbers identically under Classic and Neon
 *   (theme parity: the render never branches on theme).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlayerCard, quitStatRows, quitSummaryText, type CardQuitStats, type PlayerCardData } from '../src/profile/PlayerCard';
import { ProfileView } from '../src/profile/ProfileView';
import { loadAccount } from '../src/account/api';
import { themeStore } from '../src/theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const QUITS: CardQuitStats = {
  started: 55, quits: 3, rate: 5.5,
  byHand: { early: 1, mid: 1, late: 1 },
  score: { behind: 2, ahead: 1, level: 0, unknown: 0 },
};

const cardBase = (quits?: CardQuitStats): PlayerCardData => ({
  userId: 'u-1',
  name: 'ShotCaller',
  avatar: null,
  avatarUpdatedAt: null,
  memberSince: 1760000000000,
  level: { level: 34, title: 'Shot Caller' },
  rank: { level: 34, step: 34, prestige: false, rank: 'Q', rankName: 'Queen', suit: 'diamonds', symbol: '♦', tier: 'diamonds', isJoker: false, isLittleJoker: false, isBigJoker: false },
  bigJoker: { earned: false, active: false },
  status: null,
  tags: [],
  showcase: [],
  badges: [],
  story: { stopsCleared: 4, stopsTotal: 11, completed: false },
  stats: {
    games: 50, wins: 32, losses: 18, winPct: 64, streak: 3, bestStreak: 7,
    team: { rating: 1240, games: 10, wins: 6, losses: 4 },
    cutthroat: { rating: 980, games: 2, wins: 1, losses: 1 },
    ...(quits ? { quits } : {}),
  },
});

let root: Root | null = null;
let el: HTMLDivElement | null = null;
async function render(node: React.ReactNode) {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  return el;
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove(); el = null;
  vi.unstubAllGlobals();
});
const q = (sel: string) => el!.querySelector(sel);

describe('the summary copy (one source for every surface)', () => {
  it('formats the headline and the when-split', () => {
    expect(quitSummaryText(QUITS)).toBe('Rated games 55 · Quit 3 (5.5%) · early 1 · mid 1 · late 1');
    expect(quitStatRows(QUITS)).toEqual([
      ['Rated games', '55'],
      ['Quits', '3 (5.5%)'],
      ['Quit early — hands 1–2', '1'],
      ['Quit mid — hands 3–5', '1'],
      ['Quit late — hand 6+', '1'],
    ]);
  });
  it('zero quits: no split to show, rate still prints', () => {
    const none: CardQuitStats = { ...QUITS, started: 12, quits: 0, rate: 0, byHand: { early: 0, mid: 0, late: 0 } };
    expect(quitSummaryText(none)).toBe('Rated games 12 · Quit 0 (0%)');
  });
});

describe('the Player Card back', () => {
  it('shows the quit line when the player has rated starts', async () => {
    await render(createElement(PlayerCard, { data: cardBase(QUITS) }));
    expect(q('[data-testid="pcard-quits"]')?.textContent).toBe('Rated games 55 · Quit 3 (5.5%) · early 1 · mid 1 · late 1');
  });

  it('stays silent with no rated starts — never a dressed-up zero', async () => {
    const fresh: CardQuitStats = { started: 0, quits: 0, rate: null, byHand: { early: 0, mid: 0, late: 0 }, score: { behind: 0, ahead: 0, level: 0, unknown: 0 } };
    await render(createElement(PlayerCard, { data: cardBase(fresh) }));
    expect(q('[data-testid="pcard-quits"]')).toBeNull();
    expect(q('[data-testid="pcard-stats"]')).not.toBeNull();
  });

  it('a stale payload without the block renders the card unchanged', async () => {
    await render(createElement(PlayerCard, { data: cardBase(undefined) }));
    expect(q('[data-testid="pcard-quits"]')).toBeNull();
    expect(q('[data-testid="pcard-stats"]')).not.toBeNull();
  });

  it('reads identically under Classic and Neon', async () => {
    const seen: string[] = [];
    for (const theme of ['classic', 'neon'] as const) {
      themeStore.set(theme);
      await render(createElement(PlayerCard, { data: cardBase(QUITS) }));
      seen.push(q('[data-testid="pcard-quits"]')?.textContent ?? 'MISSING');
      if (root) act(() => root!.unmount());
      root = null; el?.remove(); el = null;
    }
    expect(seen).toEqual([
      'Rated games 55 · Quit 3 (5.5%) · early 1 · mid 1 · late 1',
      'Rated games 55 · Quit 3 (5.5%) · early 1 · mid 1 · late 1',
    ]);
  });
});

/* ------------------------------------------------------- profile wiring */

const RANK = { division: 'block', elo: 1000, games: 10, wins: 4, losses: 6, peak: 1100, rank: 3, of: 9 };
const credWithCard = (card: PlayerCardData) => ({
  user: { id: 'u-self-1', name: 'M33CH', avatar: null, avatarUpdatedAt: null, tagline: null, socialLinks: {} },
  card,
  level: { level: card.level.level, xp: 463, title: card.level.title, xpForNext: 375, xpIntoLevel: 75 },
  season: { id: 's1', name: 'Season 1', endsAt: 0 },
  rank: { team: RANK, cutthroat: RANK },
  stats: { team: { games: 10, wins: 4 }, cutthroat: { games: 2, wins: 1 } },
  achievements: [],
  coins: { balance: 100 },
});
const socialRec = () => ({
  id: 'u-self-1', avatar: null, username: 'M33CH', memberSince: 1760000000000, tagline: null,
  badges: [], teamNames: [], ratings: {}, totals: { games: 0, wins: 0 }, h2h: [], champion: 0,
  stats: { games: 0, wins: 0, streak: 0, bestStreak: 0, accuracy: null, booksPerHand: null, nil: '0/0', shotsGiven: 0, shotsTaken: 0, wheels: 0, bjWins: 0, bidSec: null, playSec: null },
  awards: [],
});

function mockProfileFetch(payload: unknown) {
  const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (url.includes('/api/auth/me')) return json({ user: { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] } });
    if (url.includes('/api/social/profile/M33CH')) return json(socialRec());
    if (url.endsWith('/api/profile/me')) return json(payload);
    return json({ error: 'not found' }, false);
  }));
}

describe('the profile Stats tab', () => {
  it('shows the quit rows and the rated-scope note, same under both themes', async () => {
    const seen: string[] = [];
    for (const theme of ['classic', 'neon'] as const) {
      themeStore.set(theme);
      mockProfileFetch(credWithCard(cardBase(QUITS)));
      await act(async () => { await loadAccount(true); });
      await render(createElement(ProfileView, { host: 'page' }));
      const tab = [...el!.querySelectorAll('[role="tab"]')].find((b) => b.textContent === 'Stats') as HTMLButtonElement;
      await act(async () => { tab.click(); });
      const block = q('[data-testid="profile-quits"]');
      expect(block).not.toBeNull();
      const rows = [...block!.querySelectorAll('.stat-row')].map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
      expect(rows).toEqual([
        'Rated games55',
        'Quits3 (5.5%)',
        'Quit early — hands 1–21',
        'Quit mid — hands 3–51',
        'Quit late — hand 6+1',
      ]);
      expect(el!.textContent).toContain('Rated games only — a quit is a recorded leave that ended a rated game. Disconnects don’t count.');
      seen.push(block!.textContent ?? '');
      if (root) act(() => root!.unmount());
      root = null; el?.remove(); el = null;
      vi.unstubAllGlobals();
    }
    expect(seen[0]).toBe(seen[1]);
  });
});
