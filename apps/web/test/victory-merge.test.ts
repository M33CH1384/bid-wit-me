/**
 * @vitest-environment happy-dom
 *
 * VICTORY SCREEN CONSOLIDATION (owner, 2026-11-01: "we basically have 2
 * victory screens we should reevaluate and reduce to one" — the in-table
 * screen survives and absorbs the Postgame Report).
 *
 * Behavior pins for the merged surface and its two owed-across-a-reload
 * states:
 *  - VictoryReport (what Table renders inside the victory screen) carries
 *    the Postgame Report + the reward rows + the Profile/Open Tables
 *    links — the whole story, once, at the table;
 *  - the level-up CARD TAKEOVER fires on the merged surface with the
 *    2026-11-01 contract intact: entrance gated on painted frames,
 *    showing retires nothing (a remount while pending replays it), only
 *    TAP TO CONTINUE retires the grant;
 *  - a guest's held claim is owned by the merged surface while it is
 *    mounted: the held panel renders and the auto-claim watcher defers
 *    (registration), and unmounting releases the deferral;
 *  - VictoryRecovery (the reload path) presents the standalone report
 *    ONLY when the stash still owes the player something — an
 *    undismissed takeover grant or a held claim on an unsigned
 *    breakdown; a plain finished match presents nothing.
 *
 * RAF is a manual queue and timers are vitest fakes, mirroring
 * card-takeover.test.ts, so frame timestamps are deterministic.
 */
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameOverRewards, { VictoryReport, VictoryXpStrip, computeRewards, type RewardsData, type RewardsProfile } from '../src/GameOverRewards';
import VictoryRecovery from '../src/VictoryRecovery';
import { CARD_TAKEOVER_DISMISSED_KEY, CARD_TAKEOVER_DELAY_MS, cardTakeoverKey, markTakeoverDismissed } from '../src/CardTakeover';
import { claimDeferredToVictory, savePendingClaim } from '../src/pendingClaim';
import { stashRewards } from '../src/rewardsStash';
import type { LocalGamePost } from '../src/localStats';
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

/** A level-up match: +24 XP carries 7♣ (level 18) into 8♣ (level 19). */
function cardUpData(): RewardsData {
  const after = profile({
    level: { level: 19, xp: 1224, title: 'Certified', xpForNext: 550, xpIntoLevel: 12 },
    card: cardOf(EIGHT_CLUBS),
    coins: { balance: 1400 },
  });
  const d = computeRewards(profile(), after, { won: true, headline: 'VICTORY!', sub: '4 hands played', kind: 'team' });
  d.postgame = {
    sides: [
      { label: 'Us', score: 195, books: 41, nilsMade: 1 },
      { label: 'Them', score: 42, books: 38, nilsMade: 0 },
    ],
    myBooks: 22,
    myNilsMade: 1,
    moments: ['Best hand: +118 on hand 6'],
  };
  return d;
}

/** A plain signed-in win — rows and report, no card-up, nothing owed. */
function plainData(): RewardsData {
  const after = profile({
    level: { level: 18, xp: 1224, title: 'Certified', xpForNext: 550, xpIntoLevel: 562 },
    coins: { balance: 1400 },
  });
  return computeRewards(profile(), after, { won: true, headline: 'VICTORY!', sub: '4 hands played', kind: 'team' });
}

/** An unsigned breakdown (guest) — no rewards until claimed. */
function guestData(): RewardsData {
  return computeRewards(null, null, { won: true, headline: 'VICTORY!', sub: '5 hands played', kind: 'team' });
}

const claimItem = (id: string): LocalGamePost => ({ clientGameId: id, startedAt: 1, endedAt: 2, names: [], teamNames: null, game: {} as LocalGamePost['game'] });

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

function mountEl(el: React.ReactElement, strict = false) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(strict ? createElement(StrictMode, null, el) : el);
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

/* The takeover portals to the document root (2026-11-02 overlay fix:
 * it must raise above the victory panel, not render inside it), so it
 * is queried at document scope; everything else stays in the flow. */
const takeover = () => document.querySelector('[data-testid="card-takeover"]');

let visState = 'visible';
function setVisibility(v: 'visible' | 'hidden') {
  visState = v;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
}

beforeEach(() => {
  rafQ = [];
  rafSeq = 0;
  visState = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visState });
  sessionStorage.clear();
  localStorage.clear();
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

describe('the merged in-table victory report', () => {
  it('carries the reward rows and the quiet links inside the table surface', () => {
    mountEl(createElement(VictoryReport, { data: plainData(), links: true }));
    expect(container.querySelector('[data-testid="victory-report"]')).not.toBeNull();
    expect(container.textContent).toContain('XP earned');
    expect(container.querySelector('[data-testid="victory-profile"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="victory-tables"]')).not.toBeNull();
    // the surface's own scope gates like the page did
    expect(container.querySelector('.rw-scope.rw-armed')).not.toBeNull();
  });

  it('renders the Postgame Report block when the data carries it', () => {
    mountEl(createElement(VictoryReport, { data: cardUpData(), links: true }));
    const pg = container.querySelector('[data-testid="postgame-report"]');
    expect(pg).not.toBeNull();
    expect(pg!.textContent).toContain('Postgame Report');
    expect(pg!.textContent).toContain('Your books');
    expect(pg!.textContent).toContain('Best hand: +118 on hand 6');
  });
});

describe('the XP slider placement (owner, 2026-11-01: buried in the scroll)', () => {
  it('VictoryXpStrip carries the XP row + level bar on its own gate scope', () => {
    mountEl(createElement(VictoryXpStrip, { d: plainData() }));
    const strip = container.querySelector('[data-testid="victory-xp"]');
    expect(strip).not.toBeNull();
    expect(strip!.classList.contains('rw-scope')).toBe(true);
    expect(strip!.textContent).toContain('XP earned');
    expect(strip!.querySelector('.rw-levelbar')).not.toBeNull();
    expect(strip!.querySelector('.rw-levelbar-fill')).not.toBeNull();
  });

  it('with omitXp the report drops the row — XP renders exactly once across strip + report', () => {
    mountEl(createElement('div', null,
      createElement(VictoryXpStrip, { d: plainData() }),
      createElement(VictoryReport, { data: plainData(), links: true, omitXp: true }),
    ));
    const xpRows = [...container.querySelectorAll('.rw-row')].filter((el) => (el.textContent || '').includes('XP earned'));
    expect(xpRows.length).toBe(1);
    const report = container.querySelector('[data-testid="victory-report"]')!;
    expect(report.textContent).not.toContain('XP earned');
    // the rest of the report is untouched
    expect(report.textContent).toContain('Coins earned');
    expect(report.textContent).toContain('Team rating');
  });

  it('the remaining rows keep their indexes when the XP row is external (delays unchanged)', () => {
    mountEl(createElement(VictoryReport, { data: plainData(), omitXp: true }));
    const coins = [...container.querySelectorAll('.rw-row')].find((el) => (el.textContent || '').includes('Coins earned')) as HTMLElement;
    // XP held index 0, so Coins is index 1 — 160ms, exactly as inline
    expect(coins.style.animationDelay).toBe('160ms');
  });

  it('guests get no XP strip — the claim panel stays in the report rows', () => {
    mountEl(createElement(VictoryXpStrip, { d: guestData() }));
    expect(container.querySelector('[data-testid="victory-xp"]')).toBeNull();
    expect(container.textContent).not.toContain('XP earned');
  });
});

describe('the takeover on the merged surface', () => {
  it('fires after the rows gate + delay, entrance painted-frame gated', () => {
    mountEl(createElement(VictoryReport, { data: cardUpData(), links: true }));
    openGate();
    // rows are in view in this layout (zero rects read as in view), so the
    // takeover arms off the rows gate and fires after its delay
    advance(CARD_TAKEOVER_DELAY_MS - 1);
    expect(takeover()).toBeNull();
    advance(1);
    expect(takeover()).not.toBeNull();
    // entrance holds until CardTakeover's own two painted frames land
    expect(takeover()!.classList.contains('rw-tko-play')).toBe(false);
    pumpFrame(32);
    pumpFrame(48);
    expect(takeover()!.classList.contains('rw-tko-play')).toBe(true);
  });

  it('showing retires nothing: a remount while pending replays it', () => {
    mountEl(createElement(VictoryReport, { data: cardUpData() }));
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS);
    expect(takeover()).not.toBeNull();
    unmount();
    expect(sessionStorage.getItem(CARD_TAKEOVER_DISMISSED_KEY)).toBeNull();
    mountEl(createElement(VictoryReport, { data: cardUpData() }));
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS);
    expect(takeover()).not.toBeNull();
  });

  it('only TAP TO CONTINUE retires the grant', () => {
    mountEl(createElement(VictoryReport, { data: cardUpData() }));
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS);
    const t = takeover()!;
    act(() => { t.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(sessionStorage.getItem(CARD_TAKEOVER_DISMISSED_KEY)).not.toBeNull();
    unmount();
    mountEl(createElement(VictoryReport, { data: cardUpData() }));
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS + 1000);
    expect(takeover()).toBeNull();
  });
});

describe('the guest claim on the merged surface', () => {
  it('shows the held panel, registers the deferral, and releases it on unmount', async () => {
    savePendingClaim(claimItem('game-merge-1'), Date.now());
    mountEl(createElement(VictoryReport, { data: guestData(), gameId: 'game-merge-1' }));
    // the claim lifecycle resolves asynchronously on mount (loadAccount)
    await act(async () => { await Promise.resolve(); });
    expect(container.textContent).toContain('This game’s rewards are held for you');
    expect(container.querySelector('[data-testid="rewards-claim-signin"]')).not.toBeNull();
    expect(claimDeferredToVictory()).toBe(true);
    unmount();
    expect(claimDeferredToVictory()).toBe(false);
  });
});

describe('reload recovery', () => {
  it('presents the standalone report when an undismissed takeover is owed', () => {
    stashRewards({ data: cardUpData(), online: false, homePath: '/' });
    mountEl(createElement(VictoryRecovery));
    expect(container.querySelector('[data-testid="rewards"]')).not.toBeNull();
    openGate();
    advance(CARD_TAKEOVER_DELAY_MS);
    expect(document.querySelector('[data-testid="card-takeover"]')).not.toBeNull();
  });

  it('presents nothing for a plain finished match — no second postgame step', () => {
    stashRewards({ data: plainData(), online: false, homePath: '/' });
    mountEl(createElement(VictoryRecovery));
    expect(container.querySelector('[data-testid="rewards"]')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('presents the report when a guest claim is held on an unsigned breakdown', async () => {
    savePendingClaim(claimItem('game-merge-2'), Date.now());
    stashRewards({ data: guestData(), online: false, homePath: '/', gameId: 'game-merge-2' });
    mountEl(createElement(VictoryRecovery));
    await act(async () => { await Promise.resolve(); });
    expect(container.querySelector('[data-testid="rewards"]')).not.toBeNull();
    expect(container.textContent).toContain('This game’s rewards are held for you');
  });

  it('a dismissed grant stays quiet across the reload', () => {
    const d = cardUpData();
    stashRewards({ data: d, online: false, homePath: '/' });
    // retire the grant the way a tap does (the dismissed store is keyed by grant)
    markTakeoverDismissed(cardTakeoverKey(d)!);
    mountEl(createElement(VictoryRecovery));
    expect(container.querySelector('[data-testid="rewards"]')).toBeNull();
  });
});
