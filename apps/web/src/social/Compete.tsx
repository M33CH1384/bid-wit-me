/** Release 9b: Leaderboards and Tournaments tabs of the Social panel. */
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useAccount } from '../account/api';
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

type Board = 'rating' | 'wins' | 'accuracy' | 'duos';
type Kind = 'team' | 'cutthroat';
type Scope = 'global' | 'local';
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

const BOARD_LABEL: Record<Board, string> = { rating: 'Rating', wins: 'Wins', accuracy: 'Bid accuracy', duos: 'Best duos' };
const SCOPE_LABEL: Record<Scope, string> = { global: 'Global', local: 'Local' };
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
  if (board === 'accuracy') return `${r.value}%`;
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

function RankRow({ r, board, period, mine, onOpen, rowRef, testId }: {
  r: Row; board: Board; period: Period; mine: boolean; onOpen?: () => void; rowRef?: (el: HTMLElement | null) => void; testId?: string;
}) {
  const dir = trendDir(board, period, r.value);
  const tip = board === 'wins' ? `${r.vsPlayers ?? r.value} vs players, ${r.vsBots ?? 0} vs bots` : undefined;
  const body = (
    <>
      <span className={`ranks-rk${r.rank <= 3 ? ' top' : ''}`}>{r.rank}</span>
      <span className={`soc-av${initials(r.name).length > 1 ? ' duo' : ''}`} aria-hidden>{initials(r.name)}</span>
      <span className="ranks-name">{r.name}</span>
      <span className={`ranks-val ${dir}`} title={tip}>{metricText(board, period, r)}</span>
      <Trend dir={dir} />
    </>
  );
  const cls = `ranks-row${mine ? ' soc-me' : ''}`;
  if (!onOpen) return <div className={cls} ref={rowRef} role="listitem" data-testid={testId}>{body}</div>;
  return (
    <button type="button" className={cls} ref={rowRef} role="listitem" data-testid={testId} onClick={onOpen}>{body}</button>
  );
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

function FilterSheet({ board, scope, period, kind, onBoard, onScope, onPeriod, onClose }: {
  board: Board; scope: Scope; period: Period; kind: Kind;
  onBoard: (b: Board) => void; onScope: (s: Scope) => void; onPeriod: (p: Period) => void; onClose: () => void;
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
        {pills('lb-board', 'Metric', board, onBoard, [['rating', 'Rating'], ['wins', 'Wins'], ['accuracy', 'Bid accuracy'], ['duos', 'Best duos', kind === 'cutthroat']])}
        {pills('lb-scope', 'Scope', scope, onScope, [['global', 'Global'], ['local', 'Local']])}
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
  useEffect(() => {
    if (!ready) return;
    setRows(null); setNote(null);
    get(`/api/social/leaderboard?board=${board}&kind=${board === 'duos' ? 'team' : kind}&scope=${scope}&period=${period}`)
      .then((j) => { setRows(j.rows); setNote(j.note ?? (scope === 'local' && j.region ? `Region: ${j.region}` : null)); })
      .catch((e) => { setRows([]); setNote(String(e.message)); });
  }, [board, kind, scope, period, ready]);
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
  const mineIdx = rows?.findIndex((r) => isMineRow(r, youId, myName)) ?? -1;
  const onBoard = mineIdx >= 0;
  const ownAcc = board === 'accuracy' && mode && mode.accuracy !== null && mode.bids < accMin && !onBoard ? mode : null;
  const unknownRegion = !!note && /no local board/i.test(note);
  const mineRow = mineIdx >= 0 ? rows![mineIdx]! : null;
  const offscreen = useOffscreen(mineEl, scrollEl, !!mineRow);
  return (
    <div className="soc-lb ranks" data-testid="leaderboard">
      <div className="ranks-scroll" ref={setScrollEl}>
        {signedIn && mine && <YouCard mine={mine} kind={kind} rank={onBoard ? mineRow!.rank : null} onMore={() => setStatsOpen(true)} />}
        {signedIn && !ready && <p className="soc-empty">Loading your stats…</p>}
        <div className="ranks-controls">
          <div className="ranks-kind" role="group" aria-label="Game" data-testid="lb-kind">
            <button type="button" className={kind === 'team' ? 'on' : ''} data-testid="lb-kind-team" onClick={() => pickKind('team')}>2v2</button>
            <button type="button" className={kind === 'cutthroat' ? 'on' : ''} data-testid="lb-kind-cutthroat" onClick={() => pickKind('cutthroat')}>Cutthroat</button>
          </div>
          <button type="button" className={`ranks-filters-btn${filters ? ' on' : ''}`} aria-expanded={filters} data-testid="ranks-filters" onClick={() => setFilters(true)}>Filters</button>
        </div>
        <p className="ranks-summary" data-testid="ranks-summary">{ranksFilterSummary(board, scope, period)}</p>
        {note && <p className="ranks-note" data-testid="lb-note">{note}</p>}
        {ownAcc && <p className="ranks-note" data-testid="lb-own-accuracy">Your bid accuracy shows after {accMin} bids.</p>}
        {rows === null ? <p className="soc-empty">Loading…</p> : !rows.length ? (
          unknownRegion ? null : (
            <div className="ranks-empty" data-testid="lb-empty">
              <p>{ownAcc ? `Your bid accuracy shows after ${accMin} bids.` : ranksEmptyLine(board, period, scope)}</p>
              <button type="button" className="primary" data-testid="ranks-find-game" onClick={findGame}>Find a game</button>
            </div>
          )
        ) : (
          <div className="ranks-list" role="list" data-testid={board === 'wins' ? 'lb-wins' : 'lb-rows'}>
            {rows.map((r, i) => (
              <RankRow key={r.id} r={r} board={board} period={period} mine={i === mineIdx} rowRef={i === mineIdx ? setMineEl : undefined} testId={`lb-row-${r.rank}`} onOpen={board === 'duos' ? undefined : () => social.showProfile(r.name)} />
            ))}
          </div>
        )}
        <p className="soc-note">Ratings and Best duos count signed-in opponents. Wins split into vs players and vs bots.</p>
      </div>
      {offscreen && mineRow && (
        <div className="ranks-pin" data-testid="ranks-pin">
          <RankRow r={mineRow} board={board} period={period} mine onOpen={() => mineEl?.scrollIntoView({ block: 'nearest' })} />
        </div>
      )}
      {filters && (
        <FilterSheet board={board} scope={scope} period={period} kind={kind} onBoard={pickBoard} onScope={setScope} onPeriod={setPeriod} onClose={() => setFilters(false)} />
      )}
      {statsOpen && mine && <StatsSheet mine={mine} kind={kind} onClose={() => setStatsOpen(false)} />}
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
