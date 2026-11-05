/**
 * @vitest-environment happy-dom
 *
 * NEW-CARD REVEAL BELOW THE FOLD (owner, 2026-11-05: "When I get a new
 * card I don't want to have to scroll down to see it — it should
 * automatically be moved up the screen so the animation plays without
 * me having to scroll").
 *
 * The reported game: offline series results. The XP strip at the top of
 * the victory scroll announced "NEW CARD!", but the card itself — the
 * CardUpRow panel and the level-up takeover — sat below the fold,
 * because ReportBody armed the takeover off the ROWS' in-view gate
 * (useRowsInView), a gate built so row animations aren't spent unseen.
 * The takeover is the one component whose job is to come TO the player
 * (owner, 2026-11-02: a promotion is a takeover raised above all
 * elements, never buried in a scroll container); chaining it to the
 * scroll defeated it.
 *
 * The existing takeover suites can't see this defect: happy-dom returns
 * zero rects, so the rows always read "in view" at presentation. These
 * pins stub the .rw-rows element's rect BELOW the fold
 * (top = innerHeight + 400) and never dispatch a scroll: the rows gate
 * stays shut for the whole test, exactly like the owner's phone.
 *
 * Pins:
 *  - with the rows below the fold, the takeover still presents itself
 *    after its delay, on BOTH surfaces that share ReportBody (the
 *    standalone GameOverRewards and the merged VictoryReport), while
 *    the page never moves (no rw-rows-play class, no scrollTo call);
 *  - no card-up in the data: nothing presents, however long it sits;
 *  - dismissal under below-fold geometry returns to the untouched
 *    report — panel still in the flow, rows gate still shut, scroll
 *    state exactly as left;
 *  - the rows' own in-view discipline is unbroken: scrolling the rows
 *    into the band still opens their gate (the decoupling changed the
 *    takeover's arming, not the rows').
 *
 * RAF is a manual queue and timers are vitest fakes, mirroring
 * card-takeover.test.ts, so frame timestamps are deterministic.
 */
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameOverRewards, { VictoryReport, computeRewards, type RewardsData, type RewardsProfile } from '../src/GameOverRewards';
import { CARD_TAKEOVER_DISMISSED_KEY, CARD_TAKEOVER_DELAY_MS, CARD_TAKEOVER_EXIT_MS } from '../src/CardTakeover';
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

/** +24 XP carries 7♣ (level 18) into 8♣ (level 19) — a new card is granted. */
function cardUpData(): RewardsData {
  const after = profile({
    level: { level: 19, xp: 1224, title: 'Certified', xpForNext: 550, xpIntoLevel: 12 },
    card: cardOf(EIGHT_CLUBS),
    coins: { balance: 1400 },
  });
  return computeRewards(profile(), after, { won: true, headline: 'VICTORY!', sub: '4 hands played', kind: 'team' });
}

/** XP but no card step — nothing may present. */
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
let scrollToSpy: ReturnType<typeof vi.fn>;

function mountEl(el: React.ReactElement, strict = false) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(strict ? createElement(StrictMode, null, el) : el);
  });
}

function mountStandalone(data: RewardsData) {
  mountEl(createElement(GameOverRewards, {
    data,
    onHome: () => undefined,
    onRematch: () => undefined,
    onProfile: () => undefined,
    onOpenTables: () => undefined,
  }));
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

const takeover = () => document.querySelector('[data-testid="card-takeover"]');
const panel = () => container.querySelector('[data-testid="rewards-cardup"]');
const rowsEl = () => container.querySelector('.rw-rows') as HTMLElement | null;
const rootEl = () => (container.querySelector('[data-testid="rewards"], [data-testid="victory-report"]') as HTMLElement | null);

function rectWithTop(top: number): DOMRect {
  return {
    top, bottom: top + 300, left: 0, right: 320, width: 320, height: 300,
    x: 0, y: top, toJSON: () => ({}),
  } as DOMRect;
}

/** Pin the reward rows below the fold, the owner's phone geometry: the
 *  rows' in-view gate can never open unless something scrolls. */
function pinRowsBelowFold() {
  const el = rowsEl();
  expect(el).not.toBeNull();
  el!.getBoundingClientRect = () => rectWithTop(window.innerHeight + 400);
}

/** Move the (stubbed) rows into the gate's band and report a scroll. */
function scrollRowsIntoView() {
  const el = rowsEl();
  expect(el).not.toBeNull();
  el!.getBoundingClientRect = () => rectWithTop(100);
  act(() => { window.dispatchEvent(new Event('scroll')); });
}

let visState = 'visible';

beforeEach(() => {
  rafQ = [];
  rafSeq = 0;
  visState = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visState });
  sessionStorage.clear();
  localStorage.clear();
  scrollToSpy = vi.fn();
  (window as unknown as { scrollTo: unknown }).scrollTo = scrollToSpy;
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
  delete (document as { visibilityState?: string }).visibilityState;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ---------------------------------------------------------------- tests */

describe('new-card takeover with the reward rows below the fold', () => {
  it('standalone surface: presents itself after its delay — no scroll, page unmoved', () => {
    mountStandalone(cardUpData());
    pinRowsBelowFold();
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS - 1);
    expect(takeover()).toBeNull();
    advance(1);
    const t = takeover();
    expect(t).not.toBeNull();
    expect(t!.textContent).toContain('NEW CARD');
    expect(t!.textContent).toContain('Eight of Clubs');
    expect(t!.querySelector('[data-testid="player-card"]')).not.toBeNull();
    // the reveal came to the player: the rows gate never opened and
    // nothing scrolled the page to make it happen
    expect(rootEl()!.classList.contains('rw-rows-play')).toBe(false);
    expect(scrollToSpy).not.toHaveBeenCalled();
    // the in-flow panel is still the permanent record, below the fold
    expect(panel()).not.toBeNull();
    // showing retired nothing
    expect(sessionStorage.getItem(CARD_TAKEOVER_DISMISSED_KEY)).toBeNull();
  });

  it('merged victory report (the reported surface): presents itself with the rows below the fold', () => {
    mountEl(createElement(VictoryReport, { data: cardUpData(), links: true, omitXp: true }));
    pinRowsBelowFold();
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS - 1);
    expect(takeover()).toBeNull();
    advance(1);
    const t = takeover();
    expect(t).not.toBeNull();
    expect(t!.textContent).toContain('NEW CARD');
    expect(t!.textContent).toContain('Eight of Clubs');
    expect(rootEl()!.classList.contains('rw-rows-play')).toBe(false);
    expect(scrollToSpy).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });

  it('no card-up: nothing presents, however long the report sits below the fold', () => {
    mountStandalone(plainData());
    pinRowsBelowFold();
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS + 10000);
    expect(takeover()).toBeNull();
    expect(panel()).toBeNull();
  });

  it('dismissal under below-fold geometry returns to the results exactly as left', () => {
    mountStandalone(cardUpData());
    pinRowsBelowFold();
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS);
    const t = takeover();
    expect(t).not.toBeNull();
    act(() => { t!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(sessionStorage.getItem(CARD_TAKEOVER_DISMISSED_KEY)).not.toBeNull();
    advance(CARD_TAKEOVER_EXIT_MS);
    expect(takeover()).toBeNull();
    // the report is right where it was: panel in the flow, rows gate
    // still shut, and dismissal never scrolled anything either
    expect(panel()).not.toBeNull();
    expect(rootEl()!.classList.contains('rw-rows-play')).toBe(false);
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it('the rows’ own in-view gate still opens when the rows are scrolled into view', () => {
    mountStandalone(cardUpData());
    pinRowsBelowFold();
    openGate();
    expect(rootEl()!.classList.contains('rw-rows-play')).toBe(false);
    scrollRowsIntoView();
    expect(rootEl()!.classList.contains('rw-rows-play')).toBe(true);
  });
});
