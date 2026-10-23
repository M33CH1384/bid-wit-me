/**
 * @vitest-environment happy-dom
 *
 * Card-rank rollout (owner, 2026-10-23): a player's rank IS a playing
 * card (server-derived in cred/xp.ts, carried on the profile payload's
 * card.rank) — every surface outside the profile card itself must say so.
 * These tests pin:
 *  - the rank-text helpers (glyph + full card name from the payload's
 *    card alone — the client never derives a step from a level),
 *  - the shared RepBlock headline: the card, not "Level N · Title", with
 *    a title-free fallback for payloads that predate the card,
 *  - the unlock copy: The Pj's picker label and the Big Bank challenge
 *    button (and its server error) read as the Ten of Clubs — the card
 *    Rep level 20 is — while the gates themselves stay numeric,
 *  - the rewards card-up logic: a STEP comparison (a level gain, and the
 *    Big Joker switching on at an unchanged level 50), and the reveal
 *    block presenting the new card via the PlayerCard component.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cardDisplayName, rankGlyph } from '../src/cardRank';
import { RepBlock, type RepLevelInfo } from '../src/RepBlock';
import { venueOptionLabel, VENUE_LIST, AFTER_DARK_VENUE } from '../src/venues';
import GameOverRewards, { computeRewards, type RewardsProfile } from '../src/GameOverRewards';
import type { CardRankData, PlayerCardData } from '../src/profile/PlayerCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/* ------------------------------------------------------------- fixtures */

const rankOf = (over: Partial<CardRankData>): CardRankData => ({
  level: 20, step: 20, prestige: false, rank: '10', rankName: 'Ten', suit: 'clubs',
  symbol: '♣', tier: 'clubs', isJoker: false, isLittleJoker: false, isBigJoker: false,
  ...over,
});
const NINE_CLUBS = rankOf({ level: 19, step: 19, rank: '9', rankName: 'Nine' });
const TEN_CLUBS = rankOf({});
const LITTLE_JOKER = rankOf({
  level: 50, step: 50, rank: 'JOKER', rankName: 'Little Joker', suit: null, symbol: '★',
  tier: 'spades', isJoker: true, isLittleJoker: true,
});
const BIG_JOKER = rankOf({
  level: 50, step: 51, prestige: true, rank: 'JOKER', rankName: 'Big Joker', suit: null, symbol: '★',
  tier: 'spades', isJoker: true, isBigJoker: true,
});

const cardOf = (rank: CardRankData): PlayerCardData => ({
  userId: 'u-1', name: 'Meech', avatar: null, avatarUpdatedAt: null, memberSince: 1760000000000,
  level: { level: rank.level, title: 'Block Captain' },
  rank,
  bigJoker: { earned: rank.isBigJoker, active: rank.isBigJoker },
  status: null, tags: [], showcase: [], badges: [],
  story: { stopsCleared: 3, stopsTotal: 11, completed: false },
  stats: {
    games: 12, wins: 7, losses: 5, winPct: 58.3, streak: 2, bestStreak: 4,
    team: { rating: 1100, games: 12, wins: 7, losses: 5 },
    cutthroat: { rating: 1000, games: 0, wins: 0, losses: 0 },
  },
});

const profile = (level: number, xp: number, rank: CardRankData | null): RewardsProfile => ({
  level: { level, xp, title: 'Block Captain', xpForNext: 600, xpIntoLevel: 10 },
  ...(rank ? { card: cardOf(rank) } : {}),
  coins: { balance: 500 },
  rank: { team: { elo: 1100 }, cutthroat: { elo: 1000 } },
  achievements: [],
  challenges: { daily: [], weekly: [] },
});

const LEVEL: RepLevelInfo = { level: 20, title: 'Block Captain', xpIntoLevel: 40, xpForNext: 600 };
const TEAM = { division: 'gold', elo: 1100 };
const CUT = { division: 'silver', elo: 1000 };

/* ------------------------------------------------------------- rendering */

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

/* ---------------------------------------------------------------- helpers */

describe('rank text helpers', () => {
  it('formats the glyph and the full name from the payload card', () => {
    expect(rankGlyph(TEN_CLUBS)).toBe('10♣');
    expect(cardDisplayName(TEN_CLUBS)).toBe('Ten of Clubs');
    expect(rankGlyph(rankOf({ rank: 'Q', rankName: 'Queen', suit: 'diamonds', symbol: '♦', tier: 'diamonds' }))).toBe('Q♦');
    expect(cardDisplayName(rankOf({ rank: '2', rankName: 'Deuce', suit: 'spades', symbol: '♠', tier: 'spades' }))).toBe('Deuce of Spades');
  });
  it('jokers read by name with their star', () => {
    expect(rankGlyph(LITTLE_JOKER)).toBe('Little Joker ★');
    expect(cardDisplayName(LITTLE_JOKER)).toBe('Little Joker');
    expect(rankGlyph(BIG_JOKER)).toBe('Big Joker ★');
    expect(cardDisplayName(BIG_JOKER)).toBe('Big Joker');
  });
});

/* --------------------------------------------------------------- RepBlock */

describe('RepBlock headline', () => {
  it('names the rank card, not the level title', async () => {
    await render(createElement(RepBlock, { level: LEVEL, rank: TEN_CLUBS, team: TEAM, cutthroat: CUT, testid: 'rep' }));
    const text = el!.textContent ?? '';
    expect(text).toContain('10♣');
    expect(text).toContain('Ten of Clubs');
    expect(text).not.toContain('Block Captain');
    expect(text).not.toContain('Level 20');
  });
  it('falls back to the bare level number — never the retired title — when a payload predates the card', async () => {
    await render(createElement(RepBlock, { level: { ...LEVEL, level: 11, title: 'Certified' }, team: TEAM, cutthroat: CUT, testid: 'rep' }));
    const text = el!.textContent ?? '';
    expect(text).toContain('Level 11');
    expect(text).not.toContain('Certified');
  });
});

/* ------------------------------------------------------------ unlock copy */

describe('unlock copy reads as the card (the gates stay numeric)', () => {
  it("The Pj's picker label names the Ten of Clubs", () => {
    const pjs = VENUE_LIST.find((v) => v.id === AFTER_DARK_VENUE)!;
    expect(venueOptionLabel(pjs, false)).toBe("🔒 The Pj's — opens at the Ten of Clubs (10♣)");
    expect(venueOptionLabel(pjs, true)).toBe("🌆 The Pj's");
  });
  it('the Big Bank challenge button names the Ten of Clubs (source pin)', () => {
    const src = read('../src/social/Wager.tsx');
    expect(src).toContain('Big Bank challenges unlock at the Ten of Clubs (10♣)');
    expect(src).toContain('🔒 Challenge · 10♣');
    expect(src).not.toContain('Block Captain');
    expect(src).not.toContain('Rep Level 20');
  });
  it('the server wager gate error names the Ten of Clubs (source pin)', () => {
    const src = read('../../server/src/wager/service.ts');
    expect(src).toContain("hasn't unlocked Big Bank yet — it opens at the Ten of Clubs (10♣).");
    expect(src).not.toContain('Block Captain');
  });
  it('the rewards screen carries no level-title rendering anymore (source pin)', () => {
    const src = read('../src/GameOverRewards.tsx');
    expect(src).not.toContain('levelTitle');
  });
});

/* --------------------------------------------------------- card-up logic */

describe('computeRewards card-up', () => {
  const opts = { won: true, headline: 'VICTORY!', sub: 'gg', kind: 'team' as const };
  it('a level gain is a card gain: 9♣ → 10♣', () => {
    const d = computeRewards(profile(19, 1000, NINE_CLUBS), profile(20, 1100, TEN_CLUBS), opts);
    expect(d.cardUp).toBe(true);
    expect(d.bigJokerUp).toBe(false);
    expect(d.rankBefore?.step).toBe(19);
    expect(d.rankAfter?.step).toBe(20);
    expect(d.cardAfter?.rank.rank).toBe('10');
  });
  it('no step change, no card-up', () => {
    const d = computeRewards(profile(20, 1000, TEN_CLUBS), profile(20, 1050, TEN_CLUBS), opts);
    expect(d.cardUp).toBe(false);
    expect(d.bigJokerUp).toBe(false);
  });
  it('the Big Joker switching on at an unchanged level 50 is a card-up (step 50 → 51)', () => {
    const d = computeRewards(profile(50, 9000, LITTLE_JOKER), profile(50, 9050, BIG_JOKER), opts);
    expect(d.levelBefore).toBe(50);
    expect(d.levelAfter).toBe(50);
    expect(d.cardUp).toBe(true);
    expect(d.bigJokerUp).toBe(true);
  });
  it('a legacy before-snapshot (no card) still reveals on a level gain', () => {
    const d = computeRewards(profile(19, 1000, null), profile(20, 1100, TEN_CLUBS), opts);
    expect(d.rankBefore).toBeNull();
    expect(d.cardUp).toBe(true);
    expect(d.bigJokerUp).toBe(false);
  });
});

/* -------------------------------------------------------- card-up reveal */

describe('the card-up reveal on the rewards screen', () => {
  const opts = { won: true, headline: 'VICTORY!', sub: 'gg', kind: 'team' as const };
  const noop = () => {};
  it('presents old card → new card with the PlayerCard itself', async () => {
    const d = computeRewards(profile(19, 1000, NINE_CLUBS), profile(20, 1100, TEN_CLUBS), opts);
    await render(createElement(GameOverRewards, { data: d, onHome: noop, onRematch: noop, onProfile: noop, onOpenTables: noop }));
    const reveal = el!.querySelector('[data-testid="rewards-cardup"]');
    expect(reveal).not.toBeNull();
    expect(reveal!.textContent).toContain('NEW CARD');
    expect(el!.querySelector('[data-testid="cardup-from"]')?.textContent).toContain('9♣');
    expect(el!.querySelector('[data-testid="cardup-to"]')?.textContent).toContain('10♣');
    expect(el!.querySelector('[data-testid="cardup-to"]')?.textContent).toContain('Ten of Clubs');
    // the presented card is the real PlayerCard component (contract-level:
    // a card renders — its face anatomy is the component's own business)
    expect(reveal!.querySelector('[data-testid="player-card"]')).not.toBeNull();
  });
  it('the Big Joker activation gets the prestige banner', async () => {
    const d = computeRewards(profile(50, 9000, LITTLE_JOKER), profile(50, 9050, BIG_JOKER), opts);
    await render(createElement(GameOverRewards, { data: d, onHome: noop, onRematch: noop, onProfile: noop, onOpenTables: noop }));
    const reveal = el!.querySelector('[data-testid="rewards-cardup"]');
    expect(reveal).not.toBeNull();
    // the prestige treatment is the REVEAL's banner (my markup); the card
    // face itself is asserted only as present, per the component contract
    expect(reveal!.querySelector('.rw-cardup-head')?.textContent).toContain('THE BIG JOKER');
    expect(reveal!.querySelector('[data-testid="player-card"]')).not.toBeNull();
  });
  it('no step change, no reveal', async () => {
    const d = computeRewards(profile(20, 1000, TEN_CLUBS), profile(20, 1050, TEN_CLUBS), opts);
    await render(createElement(GameOverRewards, { data: d, onHome: noop, onRematch: noop, onProfile: noop, onOpenTables: noop }));
    expect(el!.querySelector('[data-testid="rewards-cardup"]')).toBeNull();
  });
});
