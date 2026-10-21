/** Release 9b: Leaderboards and Tournaments tabs of the Social panel. */
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { statusLabel, type OpenTable, type PresenceEntry } from '@spades/protocol';
import { CoinIcon } from '../RepBlock';
import { fetchWagerList, type WagerRow } from './wagerApi';
import { useAccount } from '../account/api';
import { fx, useReduceEffects } from '../fx';
import { navigate } from '../online/nav';
import { social, useSocial } from './store';

const get = (u: string) => fetch(u, { credentials: 'same-origin' }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`); return j; });
const post = (u: string, b: unknown = {}) => fetch(u, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`); return j; });

const MODE: Record<string, string> = { joker: 'Joker 2v2', aceDown: 'Ace Down 2v2', cutthroat: 'Cutthroat' };
function when(at: number, now = Date.now()): string {
  const d = at - now, m = Math.round(Math.abs(d) / 60_000);
  const rel = m < 1 ? 'now' : m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
  const abs = new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return d > 0 ? `${abs} · in ${rel}` : abs;
}

/* ------------------------------------------------------------ leaderboards */

type Board = 'rating' | 'wins' | 'accuracy' | 'duos' | 'winpct' | 'books' | 'nils';
type Kind = 'team' | 'cutthroat';
/** Board scopes. The server serves 'global' and 'local' (IP region); 'friends'
 *  and 'online' are honest client-side views over the global board — filtered
 *  to the viewer's friends (social store) or to players online right now
 *  (presence), renumbered inside the view. The scope label always says which
 *  one you're looking at. */
type Scope = 'global' | 'friends' | 'online' | 'regions' | 'local';
/** The auto-rotation cycle (owner, 2026-10-20): Global → Friends → Online
 *  now, plus Regions when the viewer declared one (league P-B). 'local' is
 *  a manual Filters pick, not part of the cycle. */
const ROTATION: Scope[] = ['global', 'friends', 'online'];
type Period = 'all' | 'month' | 'week';
interface Row { rank: number; id: string; name: string; value: number; games: number; extra?: string; vsPlayers?: number; vsBots?: number }
interface ModeStats {
  games: number; wins: number; winPct: number | null;
  winsVsPlayers: number; winsVsBots: number; gamesVsPlayers: number; gamesVsBots: number;
  winPctPlayers: number | null; winPctBots: number | null;
  accuracy: number | null; bags: number; booksPerHand: number | null; nil: string;
  shotsGiven: number; shotsTaken: number; bjWins: number; bids: number;
  elo: number | null; unrated: string | null;
}
interface MyStats { team: ModeStats; cutthroat: ModeStats }

const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
const num = (n: number | null) => (n === null ? '—' : String(n));
const UNRATED_HINT = 'Play a signed-in player to get rated';

const BOARD_LABEL: Record<Board, string> = { rating: 'Rating', wins: 'Wins', accuracy: 'Bid accuracy', duos: 'Best duos', winpct: 'Win %', books: 'Books/hand', nils: 'Nils made' };
const SCOPE_LABEL: Record<Scope, string> = { global: 'Global', friends: 'Friends', online: 'Online now', regions: 'Regions', local: 'Local' };
const PERIOD_LABEL: Record<Period, string> = { week: 'This week', month: 'This month', all: 'All-time' };

/** Server-wide count. Kept for callers; the Ranks tab no longer prints it. */
export function siteGamesToday(n: number): string {
  return `Site: ${n} ${n === 1 ? 'game' : 'games'} today`;
}

/** One line under the Ranks controls, e.g. "Rating · Global · This week". */
export function ranksFilterSummary(board: Board, scope: Scope, period: Period): string {
  return `${BOARD_LABEL[board]} · ${SCOPE_LABEL[scope]} · ${PERIOD_LABEL[period]}`;
}

/** Single friendly sentence for an empty board. */
export function ranksEmptyLine(board: Board, period: Period, scope: Scope): string {
  const near = scope === 'local' ? ' nearby' : '';
  if (board === 'rating' && period === 'week') return `No rating changes${near} this week yet.`;
  if (board === 'rating' && period === 'month') return `No rating changes${near} this month yet.`;
  if (board === 'rating') return `No rated players${near} yet.`;
  if (board === 'wins') return `No wins${near} on this board yet.`;
  if (board === 'accuracy') return `Not enough bids${near} for this board yet.`;
  if (board === 'winpct') return `No one has 10 games${near} on this board yet — Win % opens at 10 games.`;
  if (board === 'books') return `No books${near} on this board yet.`;
  if (board === 'nils') return `No nils made${near} on this board yet.`;
  return `No duos${near} on this board yet.`;
}

function initials(name: string): string {
  if (name.includes(' + ')) {
    const [a, b] = name.split(' + ');
    return `${a?.[0] ?? ''}${b?.[0] ?? ''}`.toUpperCase();
  }
  return (name[0] ?? '?').toUpperCase();
}

function isMineRow(r: Row, youId: string | undefined, myName: string | undefined): boolean {
  if (youId && (r.id === youId || r.id === `u:${youId}` || r.id.split(':').includes(youId))) return true;
  if (myName && (r.name === myName || r.name.split(' + ').includes(myName))) return true;
  return false;
}

function metricText(board: Board, period: Period, r: Row): string {
  if (board === 'accuracy' || board === 'winpct') return `${r.value}%`;
  if (board === 'books') return r.value.toFixed(1);
  if (board === 'rating' && period !== 'all') return `${r.value > 0 ? '+' : ''}${r.value}`;
  return String(r.value);
}

function trendDir(board: Board, period: Period, value: number): 'up' | 'down' | 'flat' {
  if (board !== 'rating' || period === 'all') return 'flat';
  return value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
}

function Trend({ dir }: { dir: 'up' | 'down' | 'flat' }) {
  const label = dir === 'up' ? 'Up' : dir === 'down' ? 'Down' : 'No change';
  return (
    <span className={`ranks-trend ${dir}`} aria-label={label}>
      {dir === 'flat' ? (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M1.5 5h7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      ) : (
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d={dir === 'up' ? 'M5 1.5 8.5 8H1.5Z' : 'M1.5 2h7L5 8.5Z'} fill="currentColor" /></svg>
      )}
    </span>
  );
}

/** ESPN-style row (owner, 2026-10-20: stats should look "like looking at
 *  ESPN but for Spades players"): rank, face + name, the board's metric
 *  right-aligned, games played, trend. The row's secondary line carries only
 *  what the payload actually has: the wins split on the Wins board, the win %
 *  on Best duos (the payload's `extra`), the bid count on Bid accuracy. */
function RankRow({ r, board, period, mine, onOpen, rowRef, testId }: {
  r: Row; board: Board; period: Period; mine: boolean; onOpen?: () => void; rowRef?: (el: HTMLElement | null) => void; testId?: string;
}) {
  const dir = trendDir(board, period, r.value);
  const sub = board === 'wins' && r.vsPlayers !== undefined
    ? `${r.vsPlayers} vs players · ${r.vsBots ?? 0} vs bots`
    : (r.extra ?? null);
  const body = (
    <>
      <span className={`ranks-rk${r.rank <= 3 ? ' top' : ''}`}>{r.rank}</span>
      <span className={`soc-av${initials(r.name).length > 1 ? ' duo' : ''}`} aria-hidden>{initials(r.name)}</span>
      <span className="ranks-name"><span className="ranks-name-txt">{r.name}</span>{sub && <small className="ranks-sub">{sub}</small>}</span>
      <span className={`ranks-val ${dir}`}>{metricText(board, period, r)}</span>
      <span className="ranks-gp">{r.games}</span>
      <Trend dir={dir} />
    </>
  );
  const cls = `ranks-row${mine ? ' soc-me' : ''}`;
  if (!onOpen) return <div className={cls} ref={rowRef} role="listitem" data-testid={testId}>{body}</div>;
  return (
    <button type="button" className={cls} ref={rowRef} role="listitem" data-testid={testId} onClick={onOpen}>{body}</button>
  );
}

/**
 * The Friends / Online-now views over a fetched board. Ids are matched in
 * both spellings ('u:<uid>' presence/friend ids and raw '<uid>'); duos rows
 * are '<uid>:<uid>' and stay when either partner is in the set. The viewer
 * is always in their own filtered board. Ranks renumber inside the view.
 */
export function viewRowsFor(rows: Row[], scope: Scope, o: { friendIds: string[]; onlineIds: string[]; youId?: string }): Row[] {
  if (scope === 'global' || scope === 'local' || scope === 'regions') return rows;
  const set = new Set<string>();
  for (const id of scope === 'friends' ? o.friendIds : o.onlineIds) { set.add(id); set.add(`u:${id.replace(/^u:/, '')}`); }
  if (o.youId) { set.add(o.youId); set.add(`u:${o.youId.replace(/^u:/, '')}`); }
  const keep = (r: Row) => set.has(r.id) || r.id.split(':').some((part) => set.has(part) || set.has(`u:${part.replace(/^u:/, '')}`));
  return rows.filter(keep).map((r, i) => ({ ...r, rank: i + 1 }));
}

function useOffscreen(el: HTMLElement | null, root: HTMLElement | null, active: boolean): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    if (!active || !el) { setOff(false); return; }
    const io = new IntersectionObserver(([e]) => setOff(!e?.isIntersecting), { root, threshold: 0.01 });
    io.observe(el);
    return () => io.disconnect();
  }, [el, root, active]);
  return off;
}

function findGame() {
  social.close();
  navigate('/', false, { wiz: 'mode', path: 'online', d: 0 });
}

function YouCard({ mine, kind, rank, onMore }: { mine: MyStats; kind: Kind; rank: number | null; onMore: () => void }) {
  const mode = mine[kind];
  const rated = mode.elo != null;
  return (
    <section className="ranks-you" data-testid="your-stats">
      <div className="ranks-you-top">
        <span className="ranks-you-kicker">You</span>
        <span className="ranks-you-rank" data-testid="your-stats-rank">{rank == null ? '—' : `#${rank}`}</span>
        <button type="button" className="ranks-you-more" data-testid="your-stats-more" onClick={onMore}>See all stats</button>
      </div>
      <div className="ranks-you-rating">
        {rated
          ? <b data-testid="your-stats-elo">{mode.elo}<span>Rating</span></b>
          : <><b className="unrated" data-testid="your-stats-unrated">Unrated</b><small>{UNRATED_HINT}</small></>}
      </div>
      <div className="ranks-you-stats">
        <div><b>{mode.games}</b><small>Games</small></div>
        <div><b>{pct(mode.winPct)}</b><small>Win %</small></div>
        <div><b>{pct(mode.accuracy)}</b><small>Bid accuracy</small></div>
      </div>
    </section>
  );
}

function StatsSheet({ mine, kind, onClose }: { mine: MyStats; kind: Kind; onClose: () => void }) {
  const primary = mine[kind];
  const label = kind === 'cutthroat' ? 'Cutthroat' : '2v2';
  const winLabel = (games: number, rate: number | null, name: string) => `${name}${games ? ` · ${pct(rate)}` : ''}`;
  const side = (k: Kind, name: string) => {
    const m = mine[k];
    return (
      <div className={k === kind ? 'on' : ''}>
        <small>{name}</small>
        <b>{m.games ? `${m.wins}–${m.games - m.wins}` : '—'}</b>
        <small>{m.elo == null ? 'Unrated' : `Rating ${m.elo}`}</small>
      </div>
    );
  };
  return (
    <div className="ranks-sheet-back" onClick={onClose} data-testid="ranks-stats-back">
      <div className="ranks-sheet" role="dialog" aria-label="Your stats" onClick={(e) => e.stopPropagation()} data-testid="ranks-stats-sheet">
        <div className="ranks-sheet-grab" aria-hidden />
        <div className="ranks-sheet-h">
          <h3>Your stats · {label}</h3>
          <button type="button" className="ranks-done" onClick={onClose} data-testid="ranks-stats-done">Done</button>
        </div>
        <div className="ranks-grid" data-testid="your-stats-grid">
          <div><b>{primary.games}</b><small>games</small></div>
          <div data-testid="your-stats-vs-players"><b>{primary.winsVsPlayers}</b><small>{winLabel(primary.gamesVsPlayers, primary.winPctPlayers, 'vs players')}</small></div>
          <div data-testid="your-stats-vs-bots"><b>{primary.winsVsBots}</b><small>{winLabel(primary.gamesVsBots, primary.winPctBots, 'vs bots')}</small></div>
          <div><b>{pct(primary.accuracy)}</b><small>bid accuracy</small></div>
          <div><b>{primary.bags}</b><small>bags</small></div>
          <div><b>{num(primary.booksPerHand)}</b><small>books / hand</small></div>
          <div><b>{primary.nil}</b><small>nils</small></div>
          <div><b>{primary.shotsGiven}/{primary.shotsTaken}</b><small>shots</small></div>
          <div><b>{primary.bjWins}</b><small>Big Joker wins</small></div>
        </div>
        <div className="ranks-split" data-testid="your-stats-other">
          {side('team', '2v2')}
          {side('cutthroat', 'Cutthroat')}
        </div>
      </div>
    </div>
  );
}

function FilterSheet({ scope, period, onScope, onPeriod, onClose }: {
  scope: Scope; period: Period;
  onScope: (s: Scope) => void; onPeriod: (p: Period) => void; onClose: () => void;
}) {
  const pills = <T extends string>(id: string, label: string, value: T, set: (v: T) => void, opts: [T, string, boolean?][]) => (
    <>
      <p className="ranks-filter-label" id={id}>{label}</p>
      <div className="ranks-pills" role="radiogroup" aria-labelledby={id}>
        {opts.map(([k, l, disabled]) => (
          <button key={k} type="button" role="radio" aria-label={l} aria-checked={value === k} disabled={!!disabled} className={value === k ? 'on' : ''} data-testid={`${id}-${k}`} onClick={() => set(k)}>{l}</button>
        ))}
      </div>
    </>
  );
  return (
    <div className="ranks-sheet-back" onClick={onClose}>
      <div className="ranks-sheet ranks-sheet-sm" role="dialog" aria-label="Filters" onClick={(e) => e.stopPropagation()} data-testid="ranks-filters-sheet">
        <div className="ranks-sheet-grab" aria-hidden />
        <div className="ranks-sheet-h">
          <h3>Filters</h3>
          <button type="button" className="ranks-done" onClick={onClose} data-testid="ranks-filters-done">Done</button>
        </div>
        {/* The metric itself is picked on the visible category tabs above
            the list (ESPN leaders pattern) — this sheet keeps scope/period. */}
        {pills('lb-scope', 'Scope', scope, onScope, [['global', 'Global'], ['friends', 'Friends'], ['online', 'Online now'], ['regions', 'Regions'], ['local', 'Local']])}
        {pills('lb-period', 'Period', period, onPeriod, [['week', 'Week'], ['month', 'Month'], ['all', 'All-time']])}
      </div>
    </div>
  );
}

export function Leaderboards() {
  const s = useSocial();
  const acct = useAccount();
  const signedIn = !!acct.user?.username;
  const [board, setBoard] = useState<Board>('rating');
  const [kind, setKind] = useState<Kind>('team');
  const [scope, setScope] = useState<Scope>('global');
  const [period, setPeriod] = useState<Period>('week');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [mine, setMine] = useState<MyStats | null>(null);
  const [ready, setReady] = useState(false);
  const [filters, setFilters] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [mineEl, setMineEl] = useState<HTMLElement | null>(null);
  const touched = useRef(false);
  useEffect(() => {
    if (!acct.ready) return;
    if (!signedIn) { setMine(null); setReady(true); return; }
    let stop = false;
    get('/api/social/me/stats').then((j: MyStats) => {
      if (stop) return;
      setMine(j);
      if (!touched.current && j.cutthroat.games > j.team.games) setKind('cutthroat');
      setReady(true);
    }).catch(() => { if (!stop) setReady(true); });
    return () => { stop = true; };
  }, [acct.ready, signedIn]);
  // Friends / Online now filter the GLOBAL board client-side; global, local
  // and regions (league P-B) are server-backed scopes.
  const fetchScope = scope === 'local' ? 'local' : scope === 'regions' ? 'regions' : 'global';
  useEffect(() => {
    if (!ready) return;
    setRows(null); setNote(null);
    get(`/api/social/leaderboard?board=${board}&kind=${board === 'duos' ? 'team' : kind}&scope=${fetchScope}&period=${period}`)
      .then((j) => { setRows(j.rows); setNote(j.note ?? ((fetchScope === 'local' || fetchScope === 'regions') && j.region ? `Region: ${j.region}` : null)); })
      .catch((e) => { setRows([]); setNote(String(e.message)); });
  }, [board, kind, fetchScope, period, ready]);

  /* The viewer's declared region (one /api/profile/me read on mount): gates
   * Regions joining the rotation. Unset viewers simply never rotate into it. */
  const [myRegion, setMyRegion] = useState<string | null>(null);
  useEffect(() => {
    if (!acct.user) return;
    let live = true;
    get('/api/profile/me').then((j) => { if (live) setMyRegion(j?.user?.region ?? null); }).catch(() => undefined);
    return () => { live = false; };
  }, [acct.user]);

  /* Auto-rotation (owner, 2026-10-20): the board cycles Global → Friends →
   * Online now every ~8s and the summary line labels the active scope. Any
   * interaction — tap, click, hover, holding a row — pauses the cycle for a
   * good while; an open Filters/Stats sheet pauses it outright. */
  const interactRef = useRef(0);
  const hoverRef = useRef(false);
  const markInteract = () => { interactRef.current = Date.now(); };
  useEffect(() => {
    const cycle: Scope[] = myRegion ? [...ROTATION, 'regions'] : ROTATION;
    const iv = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      if (filters || statsOpen || hoverRef.current) return;
      if (Date.now() - interactRef.current < 12_000) return;
      setScope((cur) => cycle[(cycle.indexOf(cur) + 1) % cycle.length] ?? 'global');
    }, 8000);
    return () => clearInterval(iv);
  }, [filters, statsOpen, myRegion]);
  useEffect(() => {
    if (!filters && !statsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setFilters(false);
      setStatsOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [filters, statsOpen]);
  const pickKind = (k: Kind) => {
    touched.current = true;
    setKind(k);
    if (k === 'cutthroat' && board === 'duos') setBoard('rating');
  };
  const pickBoard = (b: Board) => {
    setBoard(b);
    if (b === 'duos' && kind === 'cutthroat') setKind('team');
  };
  const accMin = period === 'all' ? 20 : 8;
  const mode = mine?.[kind];
  const myName = acct.user?.username ?? undefined;
  const youId = s.you?.id;
  /* The rows on screen: the fetched board, or its Friends / Online-now
   * filter (ranks renumber inside the filtered view; the summary line names
   * the scope so the context is never a mystery). */
  const viewRows = useMemo(() => {
    if (!rows) return rows;
    const friendIds = (s.friends?.friends ?? []).map((f) => f.id);
    const onlineIds = Object.entries(s.users).filter(([, u]) => !u.guest).flatMap(([pid, u]) => [pid, u.id]);
    return viewRowsFor(rows, scope, { friendIds, onlineIds, youId });
  }, [rows, scope, s.friends, s.users, youId]);
  const mineIdx = viewRows?.findIndex((r) => isMineRow(r, youId, myName)) ?? -1;
  const onBoard = mineIdx >= 0;
  const ownAcc = board === 'accuracy' && mode && mode.accuracy !== null && mode.bids < accMin && !onBoard ? mode : null;
  const unknownRegion = !!note && /no local board/i.test(note);
  const mineRow = mineIdx >= 0 ? viewRows![mineIdx]! : null;
  const offscreen = useOffscreen(mineEl, scrollEl, !!mineRow);
  return (
    <div className="soc-lb ranks" data-testid="leaderboard"
      onPointerDown={markInteract} onClick={markInteract}
      onPointerEnter={() => { hoverRef.current = true; }} onPointerLeave={() => { hoverRef.current = false; }}>
      <div className="ranks-scroll" ref={setScrollEl}>
        <FeaturedTable />
        {signedIn && mine && <YouCard mine={mine} kind={kind} rank={onBoard ? mineRow!.rank : null} onMore={() => setStatsOpen(true)} />}
        {signedIn && !ready && <p className="soc-empty">Loading your stats…</p>}
        <div className="ranks-controls">
          <div className="ranks-kind" role="group" aria-label="Game" data-testid="lb-kind">
            <button type="button" className={kind === 'team' ? 'on' : ''} data-testid="lb-kind-team" onClick={() => pickKind('team')}>2v2</button>
            <button type="button" className={kind === 'cutthroat' ? 'on' : ''} data-testid="lb-kind-cutthroat" onClick={() => pickKind('cutthroat')}>Cutthroat</button>
          </div>
          <button type="button" className={`ranks-filters-btn${filters ? ' on' : ''}`} aria-expanded={filters} data-testid="ranks-filters" onClick={() => setFilters(true)}>Filters</button>
        </div>
        {/* Category leaders (ESPN pattern): the ranking metric switches on
            visible tabs, not buried in Filters. Only boards the server
            actually serves exist here — Rating, Wins, Win %, Bid accuracy,
            Books/hand, Nils made, Best duos (league data wave added the
            middle three from the same stored stat JSON). */}
        <div className="ranks-cat" role="group" aria-label="Category" data-testid="lb-cats">
          {(['rating', 'wins', 'winpct', 'accuracy', 'books', 'nils', 'duos'] as Board[]).map((b) => (
            <button key={b} type="button" className={board === b ? 'on' : ''} data-testid={`lb-board-${b}`}
              disabled={b === 'duos' && kind === 'cutthroat'} onClick={() => pickBoard(b)}>{BOARD_LABEL[b]}</button>
          ))}
        </div>
        <p className="ranks-summary" data-testid="ranks-summary">{ranksFilterSummary(board, scope, period)}</p>
        {note && <p className="ranks-note" data-testid="lb-note">{note}</p>}
        {ownAcc && <p className="ranks-note" data-testid="lb-own-accuracy">Your bid accuracy shows after {accMin} bids.</p>}
        {rows === null ? <p className="soc-empty">Loading…</p> : !rows.length ? (
          unknownRegion ? null : (
            <div className="ranks-empty" data-testid="lb-empty">
              <p>{ownAcc ? `Your bid accuracy shows after ${accMin} bids.` : ranksEmptyLine(board, period, fetchScope)}</p>
              <button type="button" className="primary" data-testid="ranks-find-game" onClick={findGame}>Find a game</button>
            </div>
          )
        ) : !viewRows!.length ? (
          <div className="ranks-empty" data-testid="lb-empty-filtered">
            <p>{scope === 'friends' ? 'None of your friends are on this board yet.' : 'Nobody on this board is online right now.'}</p>
          </div>
        ) : (
          <>
            <div className="ranks-head" aria-hidden="true">
              <span className="ranks-rk">#</span>
              <span className="ranks-av-sp" />
              <span className="ranks-name">{board === 'duos' ? 'Duo' : 'Player'}</span>
              <span className="ranks-val-h">{board === 'accuracy' ? 'Accuracy' : board === 'rating' ? 'Rating' : board === 'winpct' ? 'Win %' : board === 'books' ? 'Books/hand' : board === 'nils' ? 'Nils' : 'Wins'}</span>
              <span className="ranks-gp-h">GP</span>
              <span className="ranks-trend" />
            </div>
            <div className="ranks-list" role="list" data-testid={board === 'wins' ? 'lb-wins' : 'lb-rows'}>
              {viewRows!.map((r, i) => (
                <RankRow key={r.id} r={r} board={board} period={period} mine={i === mineIdx} rowRef={i === mineIdx ? setMineEl : undefined} testId={`lb-row-${r.rank}`} onOpen={board === 'duos' ? undefined : () => social.showProfile(r.name)} />
              ))}
            </div>
          </>
        )}
        <p className="soc-note">Ratings and Best duos count signed-in opponents. Wins split into vs players and vs bots.</p>
        <PowerRankings kind={board === 'duos' ? 'team' : kind} onOpen={(name) => social.showProfile(name)} />
        <RecordBook onOpen={(name) => social.showProfile(name)} />
      </div>
      <RanksTicker kind={kind} mine={mine} />
      {offscreen && mineRow && (
        <div className="ranks-pin" data-testid="ranks-pin">
          <RankRow r={mineRow} board={board} period={period} mine onOpen={() => mineEl?.scrollIntoView({ block: 'nearest' })} />
        </div>
      )}
      {filters && (
        <FilterSheet scope={scope} period={period} onScope={setScope} onPeriod={setPeriod} onClose={() => setFilters(false)} />
      )}
      {statsOpen && mine && <StatsSheet mine={mine} kind={kind} onClose={() => setStatsOpen(false)} />}
    </div>
  );
}

/* ------------------------------------------------- Featured Table (P-G) */

export interface FeaturedPick {
  code: string; names: string[]; combined: number; mode?: string;
  open: number; playing: boolean; seat?: number; watchFull?: boolean;
}

/**
 * The featured table: the open online table with the highest COMBINED
 * player ratings. Seated players come from presence (status carries the
 * table code and each account's per-pool rating) — a table qualifies when
 * at least two seated players carry a rating for its pool, so the number
 * is real, never padded with invented ratings. Offline vs-bots tables and
 * finished tables never qualify.
 */
export function pickFeaturedTable(users: PresenceEntry[], tables: Record<string, OpenTable>): FeaturedPick | null {
  const byCode = new Map<string, { names: string[]; combined: number; rated: number; mode?: string; open: number; seat?: number; watchFull?: boolean }>();
  for (const u of users) {
    if (u.guest || !u.rating) continue;
    const st = u.status;
    if (st.kind !== 'table' || st.offline || !st.code) continue;
    const t = tables[st.code];
    if (t && t.status === 'over') continue;
    const cut = (t?.mode ?? st.mode ?? '').includes('cutthroat');
    const r = cut ? u.rating.cutthroat : u.rating.team;
    if (r == null) continue;
    const cur = byCode.get(st.code) ?? { names: [], combined: 0, rated: 0, mode: t?.mode ?? st.mode, open: t?.open ?? st.open ?? 0, seat: st.seat, watchFull: st.watchFull };
    cur.names.push(u.name);
    cur.combined += r;
    cur.rated += 1;
    byCode.set(st.code, cur);
  }
  let best: FeaturedPick | null = null;
  for (const [code, v] of byCode) {
    if (v.rated < 2) continue;
    if (!best || v.combined > best.combined) {
      best = { code, names: v.names, combined: v.combined, mode: v.mode, open: v.open, playing: tables[code]?.status === 'playing', seat: v.seat, watchFull: v.watchFull };
    }
  }
  return best;
}

const FEATURE_MODE: Record<string, string> = { joker: 'Joker', aceDown: 'Ace Down', cutthroat: 'Cutthroat', cutthroat4: 'Cutthroat' };

/**
 * League-surface spotlight (league P-G): the featured table above; else
 * the biggest upcoming Big Bank match (largest pot, via the existing wager
 * list); else an honest empty state. Join/Watch ride the same flows as the
 * Open Tables list; the wager card opens the challenge's own detail.
 */
function FeaturedTable() {
  const s = useSocial();
  const pick = useMemo(() => pickFeaturedTable(Object.values(s.users), s.tables), [s.users, s.tables]);
  const [wager, setWager] = useState<WagerRow | null>(null);
  useEffect(() => {
    if (pick) { setWager(null); return; }
    let live = true;
    fetchWagerList()
      .then((j) => {
        if (!live) return;
        const upcoming = (j.challenges ?? []).filter((c) => ['pending', 'scheduled', 'checkin', 'live'].includes(c.status));
        upcoming.sort((a, b) => b.pot - a.pot);
        setWager(upcoming[0] ?? null);
      })
      .catch(() => { if (live) setWager(null); });
    return () => { live = false; };
  }, [pick]);

  if (pick) {
    return (
      <section className="featured" data-testid="featured-table">
        <div className="power-head"><h3>⭐ Featured Table</h3><span className="soc-muted">{pick.playing ? 'Live now' : 'In the lobby'} · {FEATURE_MODE[pick.mode ?? ''] ?? pick.mode ?? ''}</span></div>
        <p className="featured-names">{pick.names.join(' · ')}</p>
        <p className="soc-muted">Combined rating {pick.combined.toLocaleString()}</p>
        <div className="featured-acts">
          {pick.open > 0 && <button type="button" className="primary" data-testid="featured-join" onClick={() => navigate(`/t/${pick.code}${pick.seat !== undefined ? `?seat=${pick.seat}` : ''}`)}>Join</button>}
          <button type="button" data-testid="featured-watch" disabled={pick.watchFull} onClick={() => navigate(`/t/${pick.code}?watch=1`)}>{pick.watchFull ? 'Full' : 'Watch'}</button>
        </div>
      </section>
    );
  }
  if (wager) {
    const names = wager.format === 'partnership'
      ? `${wager.players.filter((p) => p.side === 0).map((p) => p.name).join(' + ')} vs ${wager.players.filter((p) => p.side === 1).map((p) => p.name).join(' + ')}`
      : wager.players.map((p) => p.name).join(' · ');
    return (
      <section className="featured" data-testid="featured-table">
        <div className="power-head"><h3>⭐ Featured Match</h3><span className="soc-muted">Big Bank · starts {new Date(wager.startAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span></div>
        <p className="featured-names">{names}</p>
        <p className="soc-muted">Pot {wager.pot.toLocaleString()} <CoinIcon size={13} /></p>
        <div className="featured-acts">
          <button type="button" className="primary" data-testid="featured-wager" onClick={() => social.showChallenge(wager.id)}>View challenge</button>
        </div>
      </section>
    );
  }
  return (
    <section className="featured" data-testid="featured-table">
      <div className="power-head"><h3>⭐ Featured Table</h3></div>
      <p className="soc-muted" data-testid="featured-empty">No featured table right now — open a table or set up a Big Bank match and it can be spotlighted here.</p>
    </section>
  );
}

/* -------------------------------------------------- Power Rankings (P-E) */

interface PowerRowT { rank: number; id: string; name: string; power: number; rating: number; movement: number | 'new' }

/**
 * Weekly Power Rankings: this week's Top 10 from the server snapshot
 * (GET /api/social/power), with movement vs last week's snapshot — ▲ up,
 * ▼ down, — same, NEW for first-timers. The first week ever has no previous
 * snapshot and says so instead of inventing movement.
 */
function PowerRankings({ kind, onOpen }: { kind: Kind; onOpen: (name: string) => void }) {
  const [data, setData] = useState<{ week: string; hasPrev: boolean; rows: PowerRowT[] } | null>(null);
  useEffect(() => {
    let live = true;
    get(`/api/social/power?kind=${kind}`)
      .then((j) => { if (live) setData(j as { week: string; hasPrev: boolean; rows: PowerRowT[] }); })
      .catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [kind]);
  if (!data || !data.rows.length) return null;
  return (
    <section className="power-rank" data-testid="power-rankings">
      <div className="power-head">
        <h3>⚡ Power Rankings</h3>
        <span className="soc-muted">{kind === 'team' ? 'Partnership' : 'Cutthroat'} · week of {data.week}</span>
      </div>
      {!data.hasPrev && <p className="soc-muted power-note">First week — no movement yet, everyone starts new.</p>}
      <div className="ranks-list">
        {data.rows.map((r) => (
          <button key={r.id} type="button" className="ranks-row power-row" onClick={() => onOpen(r.name)}>
            <span className="ranks-rk">{r.rank}</span>
            <span className="ranks-name"><span className="ranks-name-txt">{r.name}</span></span>
            <span className="power-move">
              {r.movement === 'new' ? <i className="power-new">NEW</i>
                : r.movement > 0 ? <i className="trend up">▲{r.movement}</i>
                : r.movement < 0 ? <i className="trend down">▼{-r.movement}</i>
                : <i className="trend flat">—</i>}
            </span>
            <span className="ranks-val">{r.power}</span>
          </button>
        ))}
      </div>
      <p className="soc-muted power-note">Power = rating + recent form (last 14 days). Updates weekly.</p>
    </section>
  );
}

/* ---------------------------------------------------- Record Book (P-F) */

interface HonorT { id: string; label: string; userId: string; name: string; value: string }

/**
 * The Record Book: all-time marks from stored stats (highest peak rating,
 * most wins / Wheels / Bostons, best win % with a games minimum), from
 * /api/social/honors. No streak record — streaks aren't stored anywhere
 * (see honors.ts), so none is shown rather than an approximated one.
 */
function RecordBook({ onOpen }: { onOpen: (name: string) => void }) {
  const [records, setRecords] = useState<HonorT[] | null>(null);
  useEffect(() => {
    let live = true;
    get('/api/social/honors')
      .then((j) => { if (live) setRecords((j as { records: HonorT[] }).records); })
      .catch(() => { if (live) setRecords([]); });
    return () => { live = false; };
  }, []);
  if (!records?.length) return null;
  return (
    <section className="record-book" data-testid="record-book">
      <div className="power-head"><h3>📖 Record Book</h3><span className="soc-muted">All-time</span></div>
      <table className="cmp-table">
        <tbody>
          {records.map((r) => (
            <tr key={r.id}>
              <th>{r.label}</th>
              <td><button type="button" className="link" onClick={() => onOpen(r.name)}>{r.name}</button></td>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/* ------------------------------------------------- ESPN bottom ticker */

/** One online player for the ticker: a name plus what they're doing. */
export interface TickerOnline { name: string; detail: string }

/** One finished match from GET /api/social/results (league data wave). */
export interface RecentResult {
  id: string; at: number; kind: Kind; mode: string; code: string;
  sides: { names: string[]; score: number; won: boolean }[];
  wheels: boolean;
}

const RESULT_MODE: Record<string, string> = { joker: 'Joker', aceDown: 'Ace Down', cutthroat: 'Cutthroat', cutthroat4: 'Cutthroat' };

/**
 * One results line for the ticker, from the feed's stored facts only:
 * "Alpha + Bravo def. Char + Delta 500–320 · Joker". Cutthroat names the
 * winner and the full score line; a tie (more than one winning side) is
 * called a tie rather than inventing a loser.
 */
export function resultTickerLine(r: RecentResult): string {
  const mode = RESULT_MODE[r.mode] ?? r.mode;
  const won = r.sides.filter((s) => s.won);
  const lost = r.sides.filter((s) => !s.won);
  const names = (s: RecentResult['sides'][number]) => s.names.join(' + ');
  const flags = r.wheels ? ' · Wheels' : '';
  const scoresDesc = [...r.sides].sort((a, b) => b.score - a.score).map((s) => s.score).join('–');
  if (won.length !== 1) return `${won.map(names).join(' & ')} tied · ${mode} ${scoresDesc}${flags}`;
  if (r.kind === 'cutthroat') return `${names(won[0]!)} won ${mode} ${scoresDesc}${flags}`;
  if (!lost.length) return '';
  return `${names(won[0]!)} def. ${names(lost[0]!)} ${won[0]!.score}–${lost[0]!.score} · ${mode}${flags}`;
}

/**
 * The ticker's lines, built STRICTLY from payloads that already exist
 * (owner's data rule, 2026-10-20 — never fabricate a result):
 *  - the recent-results feed (GET /api/social/results — finished online
 *    matches the server recorded; empty until real games finish),
 *  - the all-time Rating board for the current kind (top 3, with numbers),
 *  - the live presence list (who's online / at a table right now),
 *  - the signed-in viewer's own stat line (/api/social/me/stats).
 */
export function buildTickerLines(o: { kind: Kind; top: Row[]; online: TickerOnline[]; mine: MyStats | null; power?: { name: string; power: number }[]; results?: RecentResult[] }): string[] {
  const lines: string[] = [];
  for (const r of (o.results ?? []).slice(0, 3)) {
    const line = resultTickerLine(r);
    if (line) lines.push(line);
  }
  const kindLabel = o.kind === 'team' ? 'Partnership' : 'Cutthroat';
  if (o.top.length) {
    lines.push(`Top rated · ${kindLabel} — ${o.top.slice(0, 3).map((r) => `${r.name} ${r.value}`).join(' · ')}`);
  }
  if (o.power?.length) {
    lines.push(`Power Rankings — ${o.power.slice(0, 3).map((r, i) => `#${i + 1} ${r.name} (${r.power})`).join(' · ')}`);
  }
  if (o.online.length) {
    lines.push(`Online now — ${o.online.slice(0, 6).map((p) => (p.detail && p.detail !== 'Online' ? `${p.name} (${p.detail.toLowerCase()})` : p.name)).join(' · ')}`);
  }
  const m = o.mine?.[o.kind];
  if (m && m.games > 0) {
    lines.push(`You — ${m.elo == null ? 'Unrated' : `Rating ${m.elo}`} · ${m.games} games · Win ${pct(m.winPct)}${m.accuracy !== null ? ` · Bid accuracy ${pct(m.accuracy)}` : ''}`);
  }
  return lines;
}

/**
 * The BottomLine: a fixed bar at the foot of the leaderboard view — the BWM
 * spade bug at its head (the Home Screen icon mark, favicon.svg), stat lines
 * scrolling to its right. It sits IN the layout flow (a flex footer under
 * the scroll area), so it reserves its own height and never covers rows.
 * Leaderboard surface only. Auto-scrolls in a seamless loop; holding it
 * pauses; reduced motion (OS or the app's Reduce effects) swaps the marquee
 * for lines that step every few seconds. The rating board refetches on a
 * 60s poll while the view is open; presence is live from the social store.
 */
export function RanksTicker({ kind, mine }: { kind: Kind; mine: MyStats | null }) {
  const s = useSocial();
  const reduceFx = useReduceEffects();
  const [osReduced, setOsReduced] = useState<boolean>(() => fx.osReducedMotion);
  const [top, setTop] = useState<Row[]>([]);
  const [powerTop, setPowerTop] = useState<{ name: string; power: number }[]>([]);
  const [results, setResults] = useState<RecentResult[]>([]);
  const [held, setHeld] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    let stop = false;
    const load = () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      get(`/api/social/leaderboard?board=rating&kind=${kind}&scope=global&period=all`)
        .then((j) => { if (!stop) setTop((j.rows ?? []) as Row[]); })
        .catch(() => { /* ticker is garnish — a failed poll just keeps the last lines */ });
      get(`/api/social/power?kind=${kind}`)
        .then((j) => { if (!stop) setPowerTop(((j.rows ?? []) as { name: string; power: number }[]).map((r) => ({ name: r.name, power: r.power }))); })
        .catch(() => { /* same */ });
      get('/api/social/results?limit=10')
        .then((j) => { if (!stop) setResults((j.results ?? []) as RecentResult[]); })
        .catch(() => { /* same */ });
    };
    load();
    const iv = setInterval(load, 60_000);
    return () => { stop = true; clearInterval(iv); };
  }, [kind]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setOsReduced(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const online = useMemo<TickerOnline[]>(() => Object.values(s.users)
    .filter((u) => !u.guest)
    .map((u) => ({ name: u.name, detail: statusLabel(u.status) }))
    .sort((a, b) => Number(a.detail === 'Online') - Number(b.detail === 'Online') || a.name.localeCompare(b.name)), [s.users]);
  const lines = useMemo(() => buildTickerLines({ kind, top, online, mine, power: powerTop, results }), [kind, top, online, mine, powerTop, results]);
  const reduced = reduceFx || osReduced;

  useEffect(() => {
    if (!reduced || lines.length < 2) return;
    const iv = setInterval(() => setStep((x) => x + 1), 4000);
    return () => clearInterval(iv);
  }, [reduced, lines.length]);

  if (!lines.length) return null;
  const duration = Math.max(16, Math.round(lines.join(' ').length * 0.32));
  return (
    <div className={`ranks-ticker${held ? ' held' : ''}`} data-testid="ranks-ticker"
      onPointerDown={() => setHeld(true)} onPointerUp={() => setHeld(false)}
      onPointerLeave={() => setHeld(false)} onPointerCancel={() => setHeld(false)}>
      <span className="ticker-bug" aria-hidden="true"><img src="/favicon.svg" alt="" width={30} height={30} /></span>
      <span className="sr-only" role="status">{lines.join(' ')}</span>
      {reduced
        ? <div className="ticker-still" aria-hidden="true">{lines[step % lines.length]}</div>
        : (
          <div className="ticker-track" aria-hidden="true" style={{ animationDuration: `${duration}s` }}>
            {[0, 1].map((copy) => (
              <span key={copy} className="ticker-copy">
                {lines.map((l, i) => <span key={i} className="ticker-line">{l}<i className="ticker-sep">♠</i></span>)}
              </span>
            ))}
          </div>
        )}
    </div>
  );
}

/* ------------------------------------------------------------- tournaments */

interface TRow { id: string; name: string; host_name: string; mode: string; format: string; rounds: number | null; team: number; max_entrants: number; start_at: number; status: string; entrants: number; champion: string | null; mine: number; bots: number }

export function Tournaments({ signedIn }: { signedIn: boolean }) {
  const s = useSocial();
  const [list, setList] = useState<'upcoming' | 'live' | 'finished'>('upcoming');
  const [rows, setRows] = useState<TRow[] | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => { setRows(null); get(`/api/tournaments?status=${list}`).then((j) => setRows(j.tournaments)).catch(() => setRows([])); }, [list]);
  useEffect(load, [load]);
  if (s.tour) return <TournamentDetail id={s.tour} signedIn={signedIn} />;
  if (creating) return <CreateTournament onDone={(id) => { setCreating(false); if (id) social.showTour(id); else load(); }} />;
  return (
    <div className="soc-tours" data-testid="tournaments">
      <div className="soc-tour-top">
        <div className="soc-seg" role="group">{(['upcoming', 'live', 'finished'] as const).map((k) => <button key={k} type="button" className={list === k ? 'on' : ''} onClick={() => setList(k)} data-testid={`tl-${k}`}>{k[0]!.toUpperCase() + k.slice(1)}</button>)}</div>
        {signedIn ? <button type="button" className="primary" onClick={() => setCreating(true)} data-testid="tour-create">＋ Host</button> : null}
      </div>
      {!signedIn && <p className="soc-note">Sign in to host or enter tournaments.</p>}
      {rows === null ? <p className="soc-empty">Loading…</p> : !rows.length ? <p className="soc-empty">No {list} tournaments{list === 'upcoming' && signedIn ? ': host one!' : '.'}</p> : (
        <ul className="soc-tour-list">
          {rows.map((t) => (
            <li key={t.id}>
              <button type="button" className="soc-tour-item" onClick={() => social.showTour(t.id)} data-testid={`tour-${t.name}`}>
                <b>{t.name}{t.mine ? <span className="soc-tag">entered</span> : null}</b>
                <small>{MODE[t.mode] ?? t.mode} · {t.format === 'swiss' ? `Swiss ${t.rounds}r` : 'Single elim'} · {t.entrants}/{t.max_entrants} {t.team ? 'teams' : 'players'}</small>
                <small className="soc-muted">{t.status === 'finished' ? (t.champion ? `🏆 ${t.champion}` : 'Finished') : t.status === 'live' ? 'Live now' : when(t.start_at)} · host {t.host_name}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function localInput(at: number): string {
  const d = new Date(at - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

function CreateTournament({ onDone }: { onDone: (id: string | null) => void }) {
  const [f, setF] = useState({ name: '', mode: 'joker', format: 'single', rounds: 3, max: 8, players: 4, start: localInput(Date.now() + 3600_000), bots: true, target: 500 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upd = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const t = (window as unknown as { __bwmTourFast?: Record<string, unknown> }).__bwmTourFast;
      const j = await post('/api/tournaments', { name: f.name, mode: f.mode, format: f.format, rounds: f.rounds, max: f.max, players: f.players, startAt: new Date(f.start).getTime(), bots: f.bots, target: f.target, ...(t ?? {}) });
      onDone(j.meta.id);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form className="soc-tour-form" onSubmit={submit} data-testid="tour-form">
      <button type="button" className="link" onClick={() => onDone(null)}>← Back</button>
      <h3>Host a tournament</h3>
      <label>Name<input value={f.name} maxLength={40} onChange={(e) => upd({ name: e.target.value })} placeholder="Friday Night Spades" data-testid="tf-name" required /></label>
      <label>Game<select value={f.mode} onChange={(e) => upd({ mode: e.target.value })} data-testid="tf-mode"><option value="joker">Joker (2v2 teams)</option><option value="aceDown">Ace Down (2v2 teams)</option><option value="cutthroat">Cutthroat (solo)</option></select></label>
      {f.mode === 'cutthroat' && <label>Players per table<select value={f.players} onChange={(e) => upd({ players: Number(e.target.value) })}><option value={4}>4</option><option value={3}>3</option></select></label>}
      <label>Format<select value={f.format} onChange={(e) => upd({ format: e.target.value })} data-testid="tf-format"><option value="single">Single elimination</option><option value="swiss">Swiss</option></select></label>
      {f.format === 'swiss' && <label>Rounds<input type="number" min={1} max={7} value={f.rounds} onChange={(e) => upd({ rounds: Number(e.target.value) })} data-testid="tf-rounds" /></label>}
      <label>Max {f.mode === 'cutthroat' ? 'players' : 'teams'}<input type="number" min={2} max={64} value={f.max} onChange={(e) => upd({ max: Number(e.target.value) })} data-testid="tf-max" /></label>
      <label>Game to<select value={f.target} onChange={(e) => upd({ target: Number(e.target.value) })}><option value={500}>500</option><option value={300}>300</option><option value={250}>250</option><option value={150}>150 (quick)</option></select></label>
      <label>Starts<input type="datetime-local" value={f.start} onChange={(e) => upd({ start: e.target.value })} data-testid="tf-start" required /></label>
      <label className="soc-check"><input type="checkbox" checked={f.bots} onChange={(e) => upd({ bots: e.target.checked })} /> Bots play for no-shows (off: no-shows forfeit)</label>
      <p className="soc-note">Registration is open until check-in. Check-in opens 10 minutes before the start; tables are seated automatically each round.</p>
      {err && <p className="soc-err" data-testid="tf-err">{err}</p>}
      <button type="submit" className="primary" disabled={busy} data-testid="tf-submit">{busy ? 'Creating…' : 'Create tournament'}</button>
    </form>
  );
}

interface TView {
  meta: { id: string; name: string; hostName: string; mode: string; format: string; rounds: number; team: boolean; max: number; startAt: number; regCloseAt: number; bots: boolean; status: string };
  entries: { id: string; name: string; members: string[]; checkedIn: boolean; seed: number; dropped: boolean }[];
  round: number; rounds: number;
  matches: { id: string; round: number; entries: { id: string; name: string }[]; status: string; table?: string; bye: boolean; result?: { places: number[]; scores: number[] } }[];
  standings: { id: string; name?: string; points: number; wins?: number; rank?: number }[];
  champion: string | null;
  you: { entry: string | null; checkedIn: boolean; host: boolean };
  checkinOpen: boolean; regOpen: boolean;
}

function TournamentDetail({ id, signedIn }: { id: string; signedIn: boolean }) {
  const acct = useAccount();
  const [v, setV] = useState<TView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [partner, setPartner] = useState('');
  const [team, setTeam] = useState('');
  const load = useCallback(() => get(`/api/tournaments/${id}`).then((j) => { setV(j); setErr(null); }).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { void load(); const t = window.setInterval(load, 5000); return () => window.clearInterval(t); }, [load]);
  const act = (a: string, b?: unknown) => post(`/api/tournaments/${id}/${a}`, b).then((j) => { setV(j); setErr(null); }).catch((e) => setErr(e.message));
  if (!v) return <div className="soc-tour-detail"><button type="button" className="link" onClick={() => social.showTour(null)}>← Tournaments</button><p className="soc-empty">{err ?? 'Loading…'}</p></div>;
  const m = v.meta;
  const nameOf = (eid: string) => v.entries.find((e) => e.id === eid)?.name ?? '—';
  const myMatch = v.you.entry ? v.matches.find((x) => x.status === 'live' && x.entries.some((e) => e.id === v.you.entry) && x.table) : undefined;
  const myName = acct.user?.username;
  const rounds = [...new Set(v.matches.map((x) => x.round))].sort((a, b) => a - b);
  return (
    <div className="soc-tour-detail" data-testid="tour-detail">
      <button type="button" className="link" onClick={() => social.showTour(null)} data-testid="tour-back">← Tournaments</button>
      <h3 data-testid="tour-name">{m.name}</h3>
      <p className="soc-muted">{MODE[m.mode]} · {m.format === 'swiss' ? `Swiss, ${m.rounds} rounds` : 'Single elimination'} · {v.entries.length}/{m.max} · host {m.hostName}{m.bots ? ' · bots for no-shows' : ''}</p>
      <p className="soc-tour-status" data-testid="tour-status">{m.status === 'upcoming' ? `Starts ${when(m.startAt)}` : m.status === 'live' ? `Live · round ${v.round}${m.format === 'swiss' ? ` of ${v.rounds}` : ''}` : m.status === 'finished' ? `🏆 Champion: ${v.champion ?? '—'}` : 'Cancelled'}</p>
      {v.champion && <p className="soc-champion" data-testid="tour-champion">🏆 {v.champion}</p>}
      {myMatch && <button type="button" className="primary big" data-testid="tour-go" onClick={() => { social.close(); navigate(`/t/${myMatch.table}`); }}>Go to your match · table {myMatch.table}</button>}
      {err && <p className="soc-err" data-testid="tour-err">{err}</p>}
      {m.status === 'upcoming' && signedIn && (
        <div className="soc-tour-acts">
          {!v.you.entry && v.regOpen && (
            <form onSubmit={(e) => { e.preventDefault(); void act('register', m.team ? { partner, teamName: team } : {}); }} className="soc-tour-reg">
              {m.team && <input value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="Partner's username" data-testid="tr-partner" required />}
              {m.team && <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="Team name (optional)" maxLength={24} data-testid="tr-team" />}
              <button type="submit" className="primary" data-testid="tr-register">Register{m.team ? ' team' : ''}</button>
            </form>
          )}
          {v.you.entry && !v.you.checkedIn && v.checkinOpen && <button type="button" className="primary" onClick={() => void act('checkin')} data-testid="tr-checkin">Check in</button>}
          {v.you.entry && v.you.checkedIn && <span className="soc-tag ok" data-testid="tr-checkedin">✓ Checked in</span>}
          {v.you.entry && !v.checkinOpen && <span className="soc-muted">You're in. Check-in opens 10 min before the start.</span>}
          {v.you.entry && <button type="button" className="ghost" onClick={() => void act('unregister')} data-testid="tr-unregister">Withdraw</button>}
          {v.you.host && <button type="button" onClick={() => void act('start')} data-testid="tr-start">Start now</button>}
          {v.you.host && <button type="button" className="ghost" onClick={() => { if (confirm('Cancel this tournament?')) void act('cancel'); }} data-testid="tr-cancel">Cancel</button>}
        </div>
      )}
      {rounds.length > 0 && (
        <>
          <h4>{m.format === 'swiss' ? 'Rounds' : 'Bracket'}</h4>
          <div className="soc-bracket" data-testid="tour-bracket">
            {rounds.map((r) => (
              <div key={r} className="soc-round">
                <span className="soc-round-h">Round {r}</span>
                {v.matches.filter((x) => x.round === r).map((x) => (
                  <div key={x.id} className={`soc-match ${x.status}`}>
                    {x.entries.map((e, i) => {
                      const place = x.result?.places[i];
                      return <div key={e.id} className={`soc-mrow${place === 1 ? ' won' : ''}${v.you.entry === e.id ? ' me' : ''}`}><span>{e.name}</span><b>{x.bye ? 'bye' : x.result ? x.result.scores[i] : ''}</b></div>;
                    })}
                    {x.status === 'live' && x.table && <button type="button" className="link soc-watch" onClick={() => { social.close(); navigate(`/t/${x.table}`); }}>{x.entries.some((e) => e.id === v.you.entry) ? 'Play' : 'Watch'} · {x.table}</button>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
      {v.standings.length > 0 && (
        <>
          <h4>Standings</h4>
          <table className="soc-lb-table" data-testid="tour-standings"><tbody>
            {v.standings.map((st, i) => <tr key={st.id}><td className="rk">{i + 1}</td><td>{st.name ?? nameOf(st.id)}</td><td className="v">{st.points} pts</td></tr>)}
          </tbody></table>
        </>
      )}
      <h4>Entrants</h4>
      <ul className="soc-entrants" data-testid="tour-entrants">
        {v.entries.map((e) => <li key={e.id} className={e.dropped ? 'dropped' : ''}>{e.checkedIn ? '✓ ' : ''}<b>{e.name}</b>{m.team ? <small> {e.members.join(' + ')}</small> : null}{e.members.includes(myName ?? '') ? <span className="soc-tag">you</span> : null}</li>)}
        {!v.entries.length && <li className="soc-muted">Nobody yet.</li>}
      </ul>
    </div>
  );
}
