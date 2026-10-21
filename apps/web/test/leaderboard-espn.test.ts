/**
 * @vitest-environment happy-dom
 *
 * ESPN pass on the leaderboard (owner, 2026-10-20: "I want the stats to look
 * like looking at ESPN but for Spades players" + "the leaderboard [should] be
 * stat / head to head rankings not some corny names — it should be metric
 * based"). Pins:
 *  - the board is a stat table: visible category tabs (only boards the server
 *    actually serves), a column header, striped rows with rank / player /
 *    metric / games-played;
 *  - no division names and no "Elo" anywhere in the Compete surface — plain
 *    "Rating" language only;
 *  - the BottomLine ticker + spade logo bug: lines built strictly from real
 *    payloads (rating board, presence, my-stats) — no fabricated results,
 *    no division names in the ticker either.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTickerLines, ranksFilterSummary, RanksTicker, viewRowsFor } from '../src/social/Compete';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const readSrc = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const compete = readSrc('../src/social/Compete.tsx');
const css = readSrc('../src/social/social.css');

const DIVISION_NAMES = ['Stoop', 'Corner', 'Avenue', 'Boulevard', 'Legend'];

describe('metric-based leaderboard: no named tiers, no Elo', () => {
  it('Compete renders no division name and no "Elo" copy', () => {
    for (const n of DIVISION_NAMES) expect(compete).not.toContain(n);
    expect(compete).not.toContain('Elo');
    expect(compete).toContain('<span>Rating</span>');
    expect(compete).toContain('`Rating ${m.elo}`');
    expect(compete).toContain('Ratings and Best duos count signed-in opponents.');
  });
  it('category leaders are visible tabs, one per real server board', () => {
    expect(compete).toContain('data-testid="lb-cats"');
    expect(compete).toContain('data-testid={`lb-board-${b}`}');
    // …and the metric picker is gone from the Filters sheet (one control)
    expect(compete).not.toContain("pills('lb-board'");
  });
  it('the list is a stat table: column header, GP column, striped rows', () => {
    expect(compete).toContain('className="ranks-head"');
    expect(compete).toContain('className="ranks-gp"');
    expect(compete).toContain('ranks-name-txt');
    expect(css).toContain('.ranks-list .ranks-row:nth-child(even):not(.soc-me)');
    expect(css).toContain('.ranks-head {');
  });
});

describe('ticker lines: real payloads only', () => {
  const top = [
    { rank: 1, id: 'u:a', name: 'Alpha', value: 1500, games: 40 },
    { rank: 2, id: 'u:b', name: 'Bravo', value: 1420, games: 31 },
    { rank: 3, id: 'u:c', name: 'Charlie', value: 1390, games: 22 },
    { rank: 4, id: 'u:d', name: 'Delta', value: 1300, games: 9 },
  ];
  const mine = {
    team: { games: 19, wins: 6, winPct: 32, winsVsPlayers: 4, winsVsBots: 2, gamesVsPlayers: 10, gamesVsBots: 9, winPctPlayers: 40, winPctBots: 22, accuracy: 61, bags: 3, booksPerHand: 3.1, nil: '1/2', shotsGiven: 0, shotsTaken: 1, bjWins: 0, bids: 40, elo: 1000, unrated: null },
    cutthroat: { games: 0, wins: 0, winPct: null, winsVsPlayers: 0, winsVsBots: 0, gamesVsPlayers: 0, gamesVsBots: 0, winPctPlayers: null, winPctBots: null, accuracy: null, bags: 0, booksPerHand: null, nil: '0/0', shotsGiven: 0, shotsTaken: 0, bjWins: 0, bids: 0, elo: null, unrated: 'x' },
  };
  it('builds top-rated, online and you lines from the payloads', () => {
    const lines = buildTickerLines({
      kind: 'team', top,
      online: [{ name: 'M33CH', detail: 'At a table' }, { name: 'LovleyT714', detail: 'Online' }],
      mine,
    });
    expect(lines[0]).toBe('Top rated · Partnership — Alpha 1500 · Bravo 1420 · Charlie 1390');
    expect(lines[1]).toBe('Online now — M33CH (at a table) · LovleyT714');
    expect(lines[2]).toBe('You — Rating 1000 · 19 games · Win 32% · Bid accuracy 61%');
    for (const l of lines) for (const n of DIVISION_NAMES) expect(l).not.toContain(n);
  });
  it('says nothing when there is nothing real to say', () => {
    expect(buildTickerLines({ kind: 'cutthroat', top: [], online: [], mine: null })).toEqual([]);
    expect(buildTickerLines({ kind: 'cutthroat', top: [], online: [], mine })).toEqual([]);
  });
});

describe('scope rotation + Friends / Online-now views (P-A)', () => {
  const rows = [
    { rank: 1, id: 'u:a', name: 'Alpha', value: 1500, games: 40 },
    { rank: 2, id: 'u:b', name: 'Bravo', value: 1420, games: 31 },
    { rank: 3, id: 'u:c', name: 'Charlie', value: 1390, games: 22 },
    { rank: 4, id: 'a:c', name: 'Alpha + Charlie', value: 9, games: 12 },
  ];
  it('the rotation cycles Global → Friends → Online now on an 8s tick', () => {
    expect(compete).toContain("const ROTATION: Scope[] = ['global', 'friends', 'online'];");
    expect(compete).toContain('}, 8000);');
    expect(compete).toContain('Date.now() - interactRef.current < 12_000');
  });
  it('the summary line labels every scope plainly', () => {
    expect(ranksFilterSummary('rating', 'friends', 'week')).toBe('Rating · Friends · This week');
    expect(ranksFilterSummary('rating', 'online', 'week')).toBe('Rating · Online now · This week');
    expect(ranksFilterSummary('rating', 'global', 'week')).toBe('Rating · Global · This week');
  });
  it('friends view: friends + you, renumbered; duos kept when either partner is a friend', () => {
    const v = viewRowsFor(rows, 'friends', { friendIds: ['u:b'], onlineIds: [], youId: 'u:c' });
    expect(v.map((r) => r.name)).toEqual(['Bravo', 'Charlie', 'Alpha + Charlie']);
    expect(v.map((r) => r.rank)).toEqual([1, 2, 3]);
  });
  it('online view: presence ids in either spelling; global/local pass through untouched', () => {
    const v = viewRowsFor(rows, 'online', { friendIds: [], onlineIds: ['a'], youId: undefined });
    expect(v.map((r) => r.name)).toEqual(['Alpha', 'Alpha + Charlie']);
    expect(viewRowsFor(rows, 'global', { friendIds: [], onlineIds: [] })).toBe(rows);
    expect(viewRowsFor(rows, 'local', { friendIds: [], onlineIds: [] })).toBe(rows);
  });
  it('only the server scopes hit the endpoint — friends/online fetch global', () => {
    expect(compete).toContain("const fetchScope = scope === 'local' ? 'local' : 'global';");
    expect(compete).toContain('scope=${fetchScope}');
  });
});

/* ------------------------------------------------------------ rendering */

let root: Root | null = null;
let el: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
  vi.unstubAllGlobals();
});

describe('the BottomLine renders: bug + lines from the rating board fetch', () => {
  it('shows the spade bug and the top-rated line; no division names', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => (String(url).includes('board=rating')
        ? { rows: [{ rank: 1, id: 'u:a', name: 'Alpha', value: 1500, games: 40 }, { rank: 2, id: 'u:b', name: 'Bravo', value: 1420, games: 31 }] }
        : {}),
    })));
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(createElement(RanksTicker, { kind: 'team', mine: null })); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    const bar = el.querySelector('[data-testid="ranks-ticker"]');
    expect(bar).not.toBeNull();
    const bug = el.querySelector('.ticker-bug img') as HTMLImageElement | null;
    expect(bug).not.toBeNull();
    expect(bug!.getAttribute('src')).toBe('/favicon.svg');
    expect(el.textContent).toContain('Top rated · Partnership — Alpha 1500 · Bravo 1420');
    for (const n of DIVISION_NAMES) expect(el.textContent ?? '').not.toContain(n);
  });
  it('the ticker is leaderboard-only — Tournaments never renders it', () => {
    const tours = compete.slice(compete.indexOf('export function Tournaments'));
    expect(tours).not.toContain('RanksTicker');
    expect(compete).toContain('<RanksTicker kind={kind} mine={mine} />');
  });
});
