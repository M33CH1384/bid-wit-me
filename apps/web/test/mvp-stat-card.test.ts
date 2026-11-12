/**
 * @vitest-environment happy-dom
 *
 * Career MVPs on the Player Card back (owner, 2026-11-12: "mvp's should go to
 * the stat sheet in total and percentage"): one row, total · percentage.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { PlayerCard, type PlayerCardData } from '../src/profile/PlayerCard';

const card = (mvps?: { total: number; games: number; pct: number | null }): PlayerCardData => ({
  userId: 'u1', name: 'Ann', avatar: null, avatarUpdatedAt: null, memberSince: 1760000000000,
  level: { level: 34, title: 'Shot Caller' },
  rank: { level: 34, step: 34, prestige: false, rank: 'Q', rankName: 'Queen', suit: 'diamonds', symbol: '♦', tier: 'diamonds', isJoker: false, isLittleJoker: false, isBigJoker: false },
  bigJoker: { earned: false, active: false }, status: null, tags: [], showcase: [], badges: [],
  story: { stopsCleared: 4, stopsTotal: 11, completed: false },
  stats: {
    games: 50, wins: 32, losses: 18, winPct: 64, streak: 3, bestStreak: 7,
    team: { rating: 1240, games: 10, wins: 6, losses: 4 },
    cutthroat: { rating: 980, games: 2, wins: 1, losses: 1 },
    ...(mvps ? { mvps } : {}),
  },
} as PlayerCardData);

let root: Root | null = null;
let el: HTMLDivElement | null = null;
async function render(data: PlayerCardData) {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(PlayerCard, { data })); });
}
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove(); el = null;
});

describe('the Player Card MVPs row', () => {
  it('shows the total and the percentage', async () => {
    await render(card({ total: 12, games: 66, pct: 18.2 }));
    const row = el!.querySelector('[data-testid="pcard-row-mvp"]');
    expect(row?.textContent).toBe('MVPs12 · 18%');
  });
  it('shows a plain 0 before any game has named an MVP', async () => {
    await render(card({ total: 0, games: 0, pct: null }));
    expect(el!.querySelector('[data-testid="pcard-row-mvp"]')?.textContent).toBe('MVPs0');
  });
  it('renders no row for a payload without the stat', async () => {
    await render(card());
    expect(el!.querySelector('[data-testid="pcard-row-mvp"]')).toBeNull();
  });
});
