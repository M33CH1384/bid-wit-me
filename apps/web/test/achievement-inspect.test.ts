/**
 * @vitest-environment happy-dom
 *
 * ACHIEVEMENT ROW INSPECT (owner, 2026-11-07, victory screenshot: the
 * "🏆 Achievement: Century Club  +500 XP · +250" row circled, "I should
 * be able to tap this and get some info on it"). The standing rule:
 * earned things are tangible and inspectable IN PLACE — tapping an
 * unlocked deck, an outro award, or a Player Card badge already opens
 * its real info; the results-screen achievement row was a dead display
 * row, the gap in that rule.
 *
 * Pinned here, on both surfaces that render the row (ReportBody is
 * shared by the standalone rewards composition and the in-table
 * VictoryReport — offline, online and cutthroat ride the same body):
 *  - the row is a real <button> with an expanded state;
 *  - tapping it opens a sheet IN PLACE (no navigation, the results
 *    screen untouched behind it) carrying the achievement's OWN
 *    catalog icon + about line from achievementArt.ts (which mirrors
 *    the server defs' hints verbatim), its server-owned name, and
 *    what it paid in this game — the row's own numbers;
 *  - the results payload carries no earned date for these rows, so
 *    the sheet shows none — nothing fetched, nothing invented;
 *  - dismissal matches the Player Card badge sheet: the scrim, the
 *    ✕, or a second tap on the row;
 *  - with two unlocks in one game, each row opens ITS OWN info;
 *  - tapping the row fires nothing else on the results screen.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameOverRewards, { VictoryReport, computeRewards, type RewardsData, type RewardsProfile } from '../src/GameOverRewards';
import { ACHIEVEMENT_ART } from '../src/achievementArt';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

/* ------------------------------------------------------------ fixtures */

function profile(over: Partial<RewardsProfile> = {}): RewardsProfile {
  return {
    level: { level: 8, xp: 1000, title: 'Prospect', xpForNext: 300, xpIntoLevel: 83 },
    coins: { balance: 1250 },
    rank: { team: { elo: 1000 }, cutthroat: { elo: 1000 } },
    achievements: [],
    challenges: { daily: [], weekly: [] },
    ...over,
  };
}

/** The server defs' own rows (apps/server/src/cred/achievements.ts). */
const CENTURY = { id: 'century', title: 'Century Club', xp: 500, coins: 250, unlockedAt: 1762000000000 };
const FIRST_DUB = { id: 'first-dub', title: 'First Dub', xp: 100, coins: 50, unlockedAt: 1762000000000 };

function dataUnlocking(items: RewardsProfile['achievements'], kind: 'team' | 'cutthroat' = 'team'): RewardsData {
  return computeRewards(profile(), profile({ achievements: items }), {
    won: true, headline: 'VICTORY!', sub: '4 hands played', kind,
  });
}

/* -------------------------------------------------------------- mounting */

let container: HTMLDivElement;
let root: Root;
let rafQ: { id: number; cb: FrameRequestCallback }[] = [];
let rafSeq = 0;

function mount(el: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(el); });
}

beforeEach(() => {
  // Hold the reveal gate shut (the victory-presented discipline): the
  // rows render regardless — the gate only runs their animations — and
  // a held gate keeps the confetti + takeover timers out of these tests.
  rafQ = [];
  rafSeq = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafSeq;
    rafQ.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafQ = rafQ.filter((f) => f.id !== id); });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  vi.unstubAllGlobals();
});

function mountPage(data: RewardsData) {
  const onHome = vi.fn();
  const onRematch = vi.fn();
  mount(createElement(GameOverRewards, {
    data, onHome, onRematch,
    onProfile: () => undefined,
    onOpenTables: () => undefined,
  }));
  return { onHome, onRematch };
}

/* The sheet portals to the document root (the victory panel's glass /
 * slant layers trap fixed positioning — the card takeover's reason),
 * so queries run against the document, not the mount container. */
const rowFor = (id: string) => document.querySelector(`[data-testid="rewards-achievement-${id}"]`);
const sheet = () => document.querySelector('[data-testid="rewards-achievement-detail"]');
const scrim = () => document.querySelector('[data-testid="rewards-achievement-scrim"]');
const click = (el: Element) => { act(() => { (el as HTMLElement).click(); }); };

/* ------------------------------------------------------------------ tests */

describe('the achievement row is a real button', () => {
  it('renders as a <button> carrying the row content, on the standalone rewards composition', () => {
    mountPage(dataUnlocking([CENTURY]));
    const row = rowFor('century');
    expect(row).not.toBeNull();
    expect(row!.tagName).toBe('BUTTON');
    expect(row!.textContent).toContain('Achievement: Century Club');
    expect(row!.textContent).toContain('+500 XP');
    expect(row!.textContent).toContain('+250');
    expect(row!.getAttribute('aria-expanded')).toBe('false');
    expect(sheet()).toBeNull();
  });

  it('renders as a <button> on the in-table VictoryReport too (cutthroat data)', () => {
    mount(createElement(VictoryReport, { data: dataUnlocking([CENTURY], 'cutthroat') }));
    const row = rowFor('century');
    expect(row).not.toBeNull();
    expect(row!.tagName).toBe('BUTTON');
    click(row!);
    expect(sheet()).not.toBeNull();
    expect(sheet()!.textContent).toContain('Century Club');
  });
});

describe('tapping the row opens its info sheet, in place', () => {
  it('shows the catalog icon + about, the server name, and this game’s pay — and no invented date', () => {
    const { onHome, onRematch } = mountPage(dataUnlocking([CENTURY]));
    click(rowFor('century')!);
    const pop = sheet();
    expect(pop).not.toBeNull();
    expect(pop!.getAttribute('role')).toBe('dialog');
    // its own art + earned-for line, straight from the client catalog
    expect(ACHIEVEMENT_ART['century']).toEqual({ icon: '💯', about: 'Win 100 games' });
    expect(pop!.textContent).toContain('💯');
    expect(pop!.textContent).toContain('Win 100 games');
    // the server-owned name, as the row shows it
    expect(pop!.textContent).toContain('Century Club');
    // what it paid in THIS game — the row's own numbers
    expect(pop!.textContent).toContain('+500 XP');
    expect(pop!.textContent).toContain('+250');
    // the results payload carries no earned date: the sheet invents none
    expect(pop!.textContent).not.toMatch(/\b20\d\d\b/);
    // in place: nothing else on the results screen fired
    expect(onHome).not.toHaveBeenCalled();
    expect(onRematch).not.toHaveBeenCalled();
    expect(rowFor('century')!.getAttribute('aria-expanded')).toBe('true');
  });

  it('each row opens ITS OWN achievement when a game unlocks two', () => {
    mountPage(dataUnlocking([CENTURY, FIRST_DUB]));
    click(rowFor('first-dub')!);
    expect(sheet()!.textContent).toContain('First Dub');
    expect(sheet()!.textContent).toContain('Win your first game');
    expect(sheet()!.textContent).toContain('+100 XP');
    expect(sheet()!.textContent).not.toContain('Century Club');
    click(document.querySelector('[data-testid="rewards-achievement-detail-close"]')!);
    expect(sheet()).toBeNull();
    click(rowFor('century')!);
    expect(sheet()!.textContent).toContain('Century Club');
    expect(sheet()!.textContent).not.toContain('First Dub');
  });
});

describe('dismissal — the Player Card sheet’s three ways', () => {
  it('closes on the ✕', () => {
    mountPage(dataUnlocking([CENTURY]));
    click(rowFor('century')!);
    expect(sheet()).not.toBeNull();
    click(document.querySelector('[data-testid="rewards-achievement-detail-close"]')!);
    expect(sheet()).toBeNull();
    expect(scrim()).toBeNull();
  });

  it('closes on a scrim tap (tap outside)', () => {
    mountPage(dataUnlocking([CENTURY]));
    click(rowFor('century')!);
    expect(sheet()).not.toBeNull();
    click(scrim()!);
    expect(sheet()).toBeNull();
  });

  it('closes on a second tap of the row itself (toggle)', () => {
    mountPage(dataUnlocking([CENTURY]));
    click(rowFor('century')!);
    expect(sheet()).not.toBeNull();
    click(rowFor('century')!);
    expect(sheet()).toBeNull();
    expect(rowFor('century')!.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('sheet styling hooks (styles.css)', () => {
  it('the row button reset + sheet classes exist beside the other rw- rules', () => {
    const css = read('../src/styles.css');
    expect(css).toContain('.rw-ach-row');
    expect(css).toContain('.rw-ach-scrim');
    expect(css).toContain('.rw-ach-pop');
    // the row’s tap target: a real button at least 44px tall
    const rowRule = css.slice(css.indexOf('.rw-ach-row'));
    expect(rowRule.slice(0, rowRule.indexOf('}'))).toContain('min-height: 44px');
  });
});
