/**
 * @vitest-environment happy-dom
 *
 * LEVEL-UP CARD TAKEOVER (owner, 2026-10-29: "When the player reaches a
 * new level their card itself should enlarge and tilt toward the player
 * and to the right a bit covering most of the screen with a prominent
 * animation to go with it").
 *
 * These pins cover the firing discipline and the dismissal contract:
 *  - the takeover fires ONCE per grant, keyed to the grant itself, after
 *    the reveal sequence lands — never on a replay of the same report
 *    (a refreshed /rewards stash, a remount), because the grant is marked
 *    celebrated in sessionStorage when it shows;
 *  - a multi-card jump celebrates the FINAL card;
 *  - the Big Joker step (same level, step 51) gets its own banner;
 *  - tapping dismisses back to the untouched NEW CARD panel;
 *  - reduced motion renders NO takeover — the static panel is the show;
 *  - no card-up in the data, no takeover, however long you wait.
 * The tilt/size contract lives in styles.css and is pinned from the CSS.
 *
 * RAF is a manual queue and timers are vitest fakes, mirroring
 * rewards-reveal.test.ts, so frame timestamps are deterministic.
 */
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameOverRewards, { computeRewards, type RewardsData, type RewardsProfile } from '../src/GameOverRewards';
import { CARD_TAKEOVER_CELEBRATED_KEY, CARD_TAKEOVER_DELAY_MS, CARD_TAKEOVER_EXIT_MS } from '../src/CardTakeover';
import type { CardRankData, PlayerCardData } from '../src/profile/PlayerCard';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------ fixtures */

const rankOf = (over: Partial<CardRankData>): CardRankData => ({
  level: 18, step: 18, prestige: false, rank: '7', rankName: 'Seven', suit: 'clubs',
  symbol: '♣', tier: 'clubs', isJoker: false, isLittleJoker: false, isBigJoker: false,
  ...over,
});
const SEVEN_CLUBS = rankOf({});
const EIGHT_CLUBS = rankOf({ level: 19, step: 19, rank: '8', rankName: 'Eight' });
const TEN_CLUBS = rankOf({ level: 21, step: 21, rank: '10', rankName: 'Ten' });
const LITTLE_JOKER = rankOf({
  level: 50, step: 50, rank: 'JOKER', rankName: 'Little Joker', suit: null, symbol: '★',
  tier: 'spades', isJoker: true, isLittleJoker: true,
});
const BIG_JOKER = rankOf({
  level: 50, step: 51, prestige: true, rank: 'JOKER', rankName: 'Big Joker', suit: null, symbol: '★',
  tier: 'spades', isJoker: true, isBigJoker: true,
});

const cardOf = (rank: CardRankData): PlayerCardData => ({
  userId: 'u-1', name: 'M33CH', avatar: null, avatarUpdatedAt: null, memberSince: 1760000000000,
  level: { level: rank.level, title: 'Certified' },
  rank,
  bigJoker: { earned: rank.isBigJoker, active: rank.isBigJoker },
  status: null, tags: [], showcase: [], badges: [],
  story: { stopsCleared: 5, stopsTotal: 11, completed: false },
  stats: {
    games: 98, wins: 51, losses: 47, winPct: 52, streak: 3, bestStreak: 6,
    team: { rating: 1200, games: 98, wins: 51, losses: 47 },
    cutthroat: { rating: 1000, games: 0, wins: 0, losses: 0 },
  },
});

function profile(over: Partial<RewardsProfile> = {}): RewardsProfile {
  return {
    level: { level: 18, xp: 1200, title: 'Certified', xpForNext: 550, xpIntoLevel: 538 },
    card: cardOf(SEVEN_CLUBS),
    coins: { balance: 1250 },
    rank: { team: { elo: 1200 }, cutthroat: { elo: 1000 } },
    achievements: [],
    challenges: { daily: [], weekly: [] },
    ...over,
  };
}

/** The owner's screenshot game: +24 XP carries 7♣ (level 18) into 8♣ (level 19, 12/550 in). */
function cardUpData(): RewardsData {
  const after = profile({
    level: { level: 19, xp: 1224, title: 'Certified', xpForNext: 550, xpIntoLevel: 12 },
    card: cardOf(EIGHT_CLUBS),
    coins: { balance: 1400 },
  });
  return computeRewards(profile(), after, { won: true, headline: 'VICTORY!', sub: '4 hands played', kind: 'team' });
}

/** A three-step jump in one match: 7♣ → 10♣. The FINAL card is the celebration. */
function multiJumpData(): RewardsData {
  const after = profile({
    level: { level: 21, xp: 1400, title: 'Certified', xpForNext: 600, xpIntoLevel: 30 },
    card: cardOf(TEN_CLUBS),
    coins: { balance: 1400 },
  });
  return computeRewards(profile(), after, { won: true, headline: 'VICTORY!', sub: '4 hands played', kind: 'team' });
}

/** The prestige step: level holds at 50, the step moves 50 → 51 (Big Joker). */
function bigJokerData(): RewardsData {
  const before = profile({
    level: { level: 50, xp: 9000, title: 'King of the Block', xpForNext: 1, xpIntoLevel: 0 },
    card: cardOf(LITTLE_JOKER),
  });
  const after = profile({
    level: { level: 50, xp: 9024, title: 'King of the Block', xpForNext: 1, xpIntoLevel: 0 },
    card: cardOf(BIG_JOKER),
    coins: { balance: 1400 },
  });
  return computeRewards(before, after, { won: true, headline: 'VICTORY!', sub: '4 hands played', kind: 'team' });
}

/** XP but no card step — the takeover must never fire. */
function plainData(): RewardsData {
  const after = profile({
    level: { level: 18, xp: 1224, title: 'Certified', xpForNext: 550, xpIntoLevel: 562 },
    coins: { balance: 1400 },
  });
  return computeRewards(profile(), after, { won: true, headline: 'VICTORY!', sub: '4 hands played', kind: 'team' });
}

/* ------------------------------------------------------- raf + mounting */

let rafQ: { id: number; cb: FrameRequestCallback }[] = [];
let rafSeq = 0;

function pumpFrame(ts: number) {
  const q = rafQ;
  rafQ = [];
  act(() => { for (const f of q) f.cb(ts); });
}

function advance(ms: number) {
  act(() => { vi.advanceTimersByTime(ms); });
}

let container: HTMLDivElement;
let root: Root;

function mount(data: RewardsData, strict = false) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const surface = createElement(GameOverRewards, {
    data,
    onHome: () => undefined,
    onRematch: () => undefined,
    onProfile: () => undefined,
    onOpenTables: () => undefined,
  });
  act(() => {
    root.render(strict ? createElement(StrictMode, null, surface) : surface);
  });
}

function unmount() {
  act(() => { root?.unmount(); });
  container?.remove();
}

/** Open the reveal gate: the two post-paint frames the gate waits for. */
function openGate() {
  pumpFrame(0);
  pumpFrame(16);
}

const takeover = () => container.querySelector('[data-testid="card-takeover"]');
const panel = () => container.querySelector('[data-testid="rewards-cardup"]');

beforeEach(() => {
  rafQ = [];
  rafSeq = 0;
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafSeq;
    rafQ.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafQ = rafQ.filter((f) => f.id !== id); });
});

afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ---------------------------------------------------------------- tests */

describe('level-up card takeover', () => {
  it('fires after the reveal sequence lands, presenting the new card', () => {
    mount(cardUpData());
    expect(panel()).not.toBeNull();
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS - 1);
    expect(takeover()).toBeNull();
    advance(1);
    const t = takeover();
    expect(t).not.toBeNull();
    expect(t!.textContent).toContain('NEW CARD');
    expect(t!.textContent).toContain('Eight of Clubs');
    // the hero is the panel's own PlayerCard, presented a second time
    expect(t!.querySelector('[data-testid="player-card"]')).not.toBeNull();
    // …and the grant is now marked celebrated
    expect(sessionStorage.getItem(CARD_TAKEOVER_CELEBRATED_KEY)).toContain('19:19:12');
  });

  it('survives the StrictMode mount cycle the app shell wraps it in', () => {
    // main.tsx renders the app inside <StrictMode>: effects arm, clean
    // up, and re-run around mount. The arming must tolerate re-runs —
    // no latch may outlive the timer its own cleanup cleared, or some
    // re-run source (a remount-in-place, a gate flicker) silently eats
    // the celebration.
    mount(cardUpData(), true);
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS);
    expect(takeover()).not.toBeNull();
    expect(takeover()!.textContent).toContain('Eight of Clubs');
  });

  it('never re-fires for the same grant: a remount (the refreshed stash) stays quiet', () => {
    mount(cardUpData());
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS);
    expect(takeover()).not.toBeNull();
    unmount();
    // same session, same breakdown — the /rewards refresh case
    mount(cardUpData());
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS + 5000);
    expect(takeover()).toBeNull();
    expect(panel()).not.toBeNull();
  });

  it('tap dismisses back to the untouched panel', () => {
    mount(cardUpData());
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS);
    const t = takeover()!;
    act(() => { t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(takeover()!.classList.contains('leaving')).toBe(true);
    advance(CARD_TAKEOVER_EXIT_MS);
    expect(takeover()).toBeNull();
    // the permanent record is still right there
    expect(panel()).not.toBeNull();
    expect(panel()!.textContent).toContain('NEW CARD');
  });

  it('a multi-card jump celebrates the FINAL card, from the old one', () => {
    mount(multiJumpData());
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS);
    const t = takeover()!;
    expect(t.textContent).toContain('Ten of Clubs');
    expect(t.textContent).toContain('Seven of Clubs');
  });

  it('the Big Joker step gets the prestige banner at an unchanged level', () => {
    const d = bigJokerData();
    expect(d.cardUp).toBe(true);
    expect(d.bigJokerUp).toBe(true);
    mount(d);
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS);
    expect(takeover()!.textContent).toContain('THE BIG JOKER');
  });

  it('no card-up, no takeover — however long the report sits', () => {
    mount(plainData());
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS + 10000);
    expect(takeover()).toBeNull();
  });

  it('reduced motion: no takeover, the static panel is the whole show', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    mount(cardUpData());
    advance(CARD_TAKEOVER_DELAY_MS + 5000);
    expect(takeover()).toBeNull();
    expect(panel()).not.toBeNull();
    expect(sessionStorage.getItem(CARD_TAKEOVER_CELEBRATED_KEY)).toBeNull();
  });
});
