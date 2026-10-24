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
 *  - the BottomLine ticker + BWM wordmark bug: lines built strictly from
 *    real payloads (results feed, rating board, presence, my-stats) — no
 *    fabricated results, no division names in the ticker either.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ranksFilterSummary, viewRowsFor } from '../src/social/Compete';
import { buildTickerLines, LeagueTicker, resultTickerLine, tickerRootVisible, type RecentResult } from '../src/social/LeagueTicker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const readSrc = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const compete = readSrc('../src/social/Compete.tsx');
const ticker = readSrc('../src/social/LeagueTicker.tsx');
const socialSrc = readSrc('../src/social/Social.tsx');
const mainSrc = readSrc('../src/main.tsx');
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
  it('the data-wave boards are tabs too: Win %, Books/hand, Nils made (league data wave, item 2)', () => {
    expect(compete).toContain("'rating', 'wins', 'winpct', 'accuracy', 'books', 'nils', 'duos'");
    expect(compete).toContain("winpct: 'Win %'");
    expect(compete).toContain("books: 'Books/hand'");
    expect(compete).toContain("nils: 'Nils made'");
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
    expect(lines.map((l) => l.text)).toEqual([
      'Top rated · Partnership — Alpha 1500 · Bravo 1420 · Charlie 1390',
      'Online now — M33CH (at a table) · LovleyT714',
      'You — Rating 1000 · 19 games · Win 32% · Bid accuracy 61%',
    ]);
    for (const l of lines) for (const n of DIVISION_NAMES) expect(l.text).not.toContain(n);
  });
  it('says nothing when there is nothing real to say', () => {
    expect(buildTickerLines({ kind: 'cutthroat', top: [], online: [], mine: null })).toEqual([]);
    expect(buildTickerLines({ kind: 'cutthroat', top: [], online: [], mine })).toEqual([]);
  });
});

describe('results feed lines (league data wave, item 1)', () => {
  const team: RecentResult = {
    id: 'g1', at: 1, kind: 'team', mode: 'joker', code: 'TBL1', wheels: false,
    sides: [
      { names: ['Alpha', 'Bravo'], score: 500, won: true },
      { names: ['Char', 'Delta'], score: 320, won: false },
    ],
  };
  const cut: RecentResult = {
    id: 'g2', at: 2, kind: 'cutthroat', mode: 'cutthroat', code: 'TBL2', wheels: true,
    sides: [
      { names: ['Alpha'], score: 210, won: false },
      { names: ['Bravo'], score: 500, won: true },
      { names: ['Botty'], score: 150, won: false },
      { names: ['Delta'], score: 320, won: false },
    ],
  };
  it('formats team, cutthroat, wheels and tie lines from the feed shape', () => {
    expect(resultTickerLine(team)).toBe('Alpha + Bravo def. Char + Delta 500–320 · Joker');
    expect(resultTickerLine(cut)).toBe('Bravo won Cutthroat 500–320–210–150 · Wheels');
    const tie: RecentResult = { ...team, sides: team.sides.map((s) => ({ ...s, won: true })) };
    expect(resultTickerLine(tie)).toContain('tied');
  });
  it('results lead the ticker, capped at three, ahead of the rating line', () => {
    const topRows = [{ rank: 1, id: 'u:a', name: 'Alpha', value: 1500, games: 40 }];
    const lines = buildTickerLines({ kind: 'team', top: topRows, online: [], mine: null, results: [team, cut, team, cut] });
    expect(lines[0]!.text).toBe(resultTickerLine(team));
    expect(lines[1]!.text).toBe(resultTickerLine(cut));
    expect(lines[3]!.text).toContain('Top rated');
    expect(lines).toHaveLength(4);
  });
  it('an empty feed adds no line (the feed accumulates from real games)', () => {
    expect(buildTickerLines({ kind: 'team', top: [], online: [], mine: null, results: [] })).toEqual([]);
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
    expect(compete).toContain("const fetchScope = scope === 'local' ? 'local' : scope === 'regions' ? 'regions' : 'global';");
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
  it('shows the wordmark bug and the top-rated line; no division names', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      ok: true, status: 200,
      json: async () => (String(url).includes('board=rating')
        ? { rows: [{ rank: 1, id: 'u:a', name: 'Alpha', value: 1500, games: 40 }, { rank: 2, id: 'u:b', name: 'Bravo', value: 1420, games: 31 }] }
        : {}),
    })));
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(createElement(LeagueTicker, { variant: 'panel' })); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    const bar = el.querySelector('[data-testid="ranks-ticker"]');
    expect(bar).not.toBeNull();
    const bug = el.querySelector('.ticker-bug img') as HTMLImageElement | null;
    expect(bug).not.toBeNull();
    expect(bug!.getAttribute('src')).toBe('/assets/bwm-wordmark-white.svg');
    expect(el.textContent).toContain('Top rated · Partnership — Alpha 1500 · Bravo 1420');
    for (const n of DIVISION_NAMES) expect(el.textContent ?? '').not.toContain(n);
  });
  it('the bug is the full wordmark lockup: opaque block, gold BETA tag, marquee clipped after it (owner spec, item 5)', () => {
    // gold BETA chip in the lockup
    expect(ticker).toContain('<span className="ticker-beta">BETA</span>');
    expect(css).toContain('.ticker-beta {');
    // the block is fully opaque in BOTH themes — a solid hex fill, and the
    // old translucent gold / neon-tinted bug backgrounds are gone
    expect(css).toContain('background: #1d0b38');
    expect(css).not.toContain('.ticker-bug { flex: none; display: grid; place-items: center; width: 44px; background: rgba');
    expect(css).not.toContain('html[data-theme="neon"] .ticker-bug { background: rgba');
    // the marquee track lives inside its own clipped viewport beside the bug
    expect(ticker).toContain('<div className="ticker-viewport">');
    expect(css).toContain('.ticker-viewport { flex: 1; min-width: 0; overflow: hidden;');
  });
  it('the marquee runs ~25% faster than the original loop (owner tweak)', () => {
    // was: max(16, chars * 0.32); now the duration is cut to 0.8×
    expect(ticker).toContain('Math.max(13, Math.round(lines.map((l) => l.text).join(\' \').length * 0.256))');
    expect(ticker).not.toContain('* 0.32)');
  });
  it('the ticker is app-wide now (item 6a): one shared component, root + panel mounts, none inside the leaderboard', () => {
    const tours = compete.slice(compete.indexOf('export function Tournaments'));
    expect(tours).not.toContain('<LeagueTicker');
    // the leaderboard no longer carries a local ticker — the shared mounts serve it
    expect(compete).not.toContain('<LeagueTicker');
    // root mount in main.tsx, panel footer in Social.tsx (hidden on composer tabs)
    expect(mainSrc).toContain('<LeagueTickerRoot />');
    expect(socialSrc).toContain('<LeagueTicker variant="panel" />');
    expect(socialSrc).toContain("s.tab !== 'chat' && s.tab !== 'messages'");
    // the surface rule: never at a live table, never under the open panel
    expect(tickerRootVisible({ inGame: false, panelOpen: false })).toBe(true);
    expect(tickerRootVisible({ inGame: true, panelOpen: false })).toBe(false);
    expect(tickerRootVisible({ inGame: false, panelOpen: true })).toBe(false);
    // and never on /story (owner guardrail, 2026-10-21): story surfaces keep
    // the warm neighborhood register — the fixed bar sliced across the Tale
    // of the Tape. Other routes keep the bar exactly as before.
    expect(tickerRootVisible({ inGame: false, panelOpen: false, storyRoute: true })).toBe(false);
    expect(tickerRootVisible({ inGame: false, panelOpen: false, storyRoute: false })).toBe(true);
    expect(ticker).toContain("classList.toggle('bwm-ticker-on'");
  });
  it('placement (owner, 2026-10-20): the root bar is FIXED via the class the component actually renders', () => {
    // the component renders the variant as the bare class `bar`; the fixed
    // rule must name it. The shipped `.league-bar` selector matched nothing
    // and the bar rendered in flow at the document's end — home scrolled
    // and the ticker sat below the fold.
    expect(ticker).toContain("league-ticker ${variant}");
    expect(css).toContain('.ranks-ticker.bar { position: fixed; left: 0; right: 0; bottom: 0;');
    expect(css).not.toContain('.ranks-ticker.league-bar');
    // no body-padding reservation: it shrank #root, which the 100dvh-sized
    // surfaces ignore, so the document grew anyway. Each surface instead
    // gives the bar's height back out of its own full-height box.
    expect(css).not.toContain('html.bwm-ticker-on body');
    expect(css).toContain('html.bwm-ticker-on .wizard { padding-bottom: calc(38px + env(safe-area-inset-bottom)); }');
    expect(css).toContain('html.bwm-ticker-on .setup { padding-bottom: calc(78px + env(safe-area-inset-bottom)); }');
    expect(css).toContain('html.bwm-ticker-on .profile-page { padding-bottom: calc(62px + env(safe-area-inset-bottom)); }');
    expect(css).toContain('html.bwm-ticker-on .rewards-page { padding-bottom: calc(58px + env(safe-area-inset-bottom)); }');
  });
  it('placement (owner, 2026-10-24): the wizard commit bar reserves the ticker height as a bottom OFFSET — it is fixed, so padding cannot move it', () => {
    // The Create Table screenshot: the gold CREATE TABLE button sat half
    // under the ticker. Both bars are position:fixed at bottom:0 with
    // z-index 15 (.setup-bar is Setup.tsx's SetupBar — CREATE TABLE on the
    // online create step, DEAL ME IN on the bots step), and the in-flow
    // padding reservations above cannot reach a fixed bar. The contract:
    // while the ticker shows, the commit bar stacks directly on top of it
    // (bottom offset = the ticker's exact height, safe area included) and
    // the form's scroll clearance (.ess-barred, 138px + safe area at rest)
    // grows by the same offset so the last card still rests above the bar.
    const styles = readSrc('../src/styles.css');
    expect(styles).toContain('.setup-bar { position: fixed;');
    expect(css).toContain('html.bwm-ticker-on .setup-bar { bottom: calc(38px + env(safe-area-inset-bottom)); }');
    expect(css).toContain('html.bwm-ticker-on .ess-barred { padding-bottom: calc(176px + env(safe-area-inset-bottom) + env(safe-area-inset-bottom)); }');
    // the offset must stay equal to the ticker's own height or the slice
    // (or a floating gap) returns
    expect(css).toContain('.ranks-ticker.bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 15; height: calc(38px + env(safe-area-inset-bottom));');
  });
  it('placement (owner, 2026-10-20): the panel ticker sits flush on the sheet bottom edge, not floating on its safe-area padding', () => {
    // the panel sheet pads its bottom by the safe area; the footer ticker
    // absorbs that strip inside its own height and the panel drops the
    // doubled padding. (The ticker's own bottom padding is gone since the
    // 2026-10-21 proportions pass — it shrank the content box to the top
    // 38px and read as a dead band; see the proportions test below.)
    expect(css).toContain('.ranks-ticker.panel { height: calc(38px + env(safe-area-inset-bottom)); }');
    expect(css).toContain('.soc-panel:has(> .ranks-ticker.panel) { padding-bottom: 0; }');
    // the mount is the panel's LAST child (after the flex:1 scroll body),
    // so the flex column pins it under all scroll content on every tab
    const bodyAt = socialSrc.indexOf('<div className="soc-body">');
    const tickerAt = socialSrc.indexOf('<LeagueTicker variant="panel" />');
    expect(bodyAt).toBeGreaterThan(-1);
    expect(tickerAt).toBeGreaterThan(bodyAt);
  });
  it('proportions (owner, 2026-10-21): content centers in the FULL bar height, scaled up — no dead band under the line', () => {
    // The safe area lives inside the height on both variants and neither
    // variant pads its bottom: the padded version shrank the content box
    // to the top 38px, so the bug + line hugged the top of a ~72px bar
    // and the safe-area strip below the text read as an empty box.
    const rule = (sel: string) => { const i = css.indexOf(sel); expect(i).toBeGreaterThan(-1); return css.slice(i, css.indexOf('}', i) + 1); };
    expect(rule('.ranks-ticker.bar')).toContain('height: calc(38px + env(safe-area-inset-bottom))');
    expect(rule('.ranks-ticker.bar')).not.toContain('padding-bottom');
    expect(rule('.ranks-ticker.panel')).toContain('height: calc(38px + env(safe-area-inset-bottom))');
    expect(rule('.ranks-ticker.panel')).not.toContain('padding-bottom');
    // Centering is structural — the bug centers its lockup, the marquee
    // track centers the lines, the still line centers — now across the
    // whole content box instead of a 38px slice at its top.
    expect(css).toContain('.ticker-bug { flex: none; position: relative; display: flex; align-items: center;');
    expect(css).toContain('.ticker-track { display: flex; align-items: center;');
    // Scaled up to fill the box, BottomLine-style: 32px lockup (was
    // 25px), 15px type (was 13px), LIVE dot + separators to match.
    expect(css).toContain('.ticker-bug img { height: 32px; width: auto; display: block; }');
    expect(css).toContain('.ticker-line { font-family: var(--display); font-weight: 700; font-size: 15px; line-height: 1.2;');
    expect(css).toContain('.ticker-still { display: flex; align-items: center; padding: 0 12px; font-family: var(--display); font-weight: 700; font-size: 15px; line-height: 1.2;');
    expect(css).toContain('.ticker-live-dot { display: inline-block; width: 9px; height: 9px;');
    expect(css).toContain('.ticker-sep { font-style: normal; color: var(--gold); margin: 0 16px; }');
    // The BETA chip stays glued to the centered lockup at any bar height.
    expect(css).toContain('bottom: calc(50% - 12px)');
  });
});
