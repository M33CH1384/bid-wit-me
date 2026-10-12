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
interface Row { rank: number; id: string; name: string; value: number; games: number; extra?: string; vsPlayers?: number; vsBots?: number }
interface Stats { accounts: number; games: number; gamesToday: number; hands: number; tournamentsDone: number; tournamentsOpen: number }
interface ModeStats {
  games: number; wins: number; winPct: number | null;
  winsVsPlayers: number; winsVsBots: number; gamesVsPlayers: number; gamesVsBots: number;
  winPctPlayers: number | null; winPctBots: number | null;
  accuracy: number | null; bags: number; booksPerHand: number | null; nil: string;
  shotsGiven: number; shotsTaken: number; bjWins: number; bids: number;
  elo: number | null; unrated: string | null;
}
interface MyStats { team: ModeStats; cutthroat: ModeStats }

const pct = (n: number | null) => (n === null ? '—' : `${Number.isInteger(n) ? n : n}%`);
const num = (n: number | null) => (n === null ? '—' : String(n));

/** Server-wide count. Personal stats live on the Your stats card, not in this line. */
export function siteGamesToday(n: number): string {
  return `Site: ${n} ${n === 1 ? 'game' : 'games'} today`;
}

function emptyCopy(board: Board, period: 'all' | 'month' | 'week', scope: 'global' | 'local'): string {
  const local = scope === 'local' ? ' in your region' : '';
  if (board === 'rating' && period === 'all') return `No rated games yet${local}. Your games vs bots count toward Wins and your stats. Elo needs signed-in players on at least two sides.`;
  if (board === 'rating') return `No Elo change this ${period}${local}. Elo needs signed-in players on at least two sides. Your games vs bots still count toward Wins and your stats.`;
  if (board === 'wins') return `No wins${local} yet. Vs players is a win against a signed-in opponent. Vs bots is a win when every opponent is a bot. Wins against guests count toward neither.`;
  if (board === 'accuracy') return `No one${local} has enough bids for this board yet. Every finished signed-in game counts, including vs bots.`;
  return `No duos${local} yet. Best duos needs two signed-in partners and at least two games against signed-in opponents.`;
}

function YourStats({ mine, kind }: { mine: MyStats; kind: Kind }) {
  const primary = mine[kind];
  const otherKey: Kind = kind === 'cutthroat' ? 'team' : 'cutthroat';
  const other = mine[otherKey];
  const label = kind === 'cutthroat' ? 'Cutthroat' : '2v2';
  const otherLabel = otherKey === 'cutthroat' ? 'Cutthroat' : '2v2';
  const winLabel = (games: number, rate: number | null, name: string) => `${name}${games ? ` · ${pct(rate)}` : ''}`;
  return (
    <section className="soc-mystats" data-testid="your-stats">
      <h3 className="soc-mystats-title">Your stats</h3>
      <p className="soc-mystats-mode">{label}</p>
      {primary.games === 0 ? <p className="soc-my-unrated">No {label} games yet.</p>
        : primary.elo == null ? <p className="soc-my-unrated" data-testid="your-stats-unrated">{primary.unrated}</p>
        : <p className="soc-my-elo" data-testid="your-stats-elo">{primary.elo}<span>Elo</span></p>}
      {primary.games > 0 && (
        <div className="soc-stats" data-testid="your-stats-grid">
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
      )}
      <p className="soc-my-other" data-testid="your-stats-other">
        {other.games === 0 ? `${otherLabel}: no games yet`
          : `${otherLabel}: ${other.winsVsPlayers} vs players · ${other.winsVsBots} vs bots${other.elo == null ? ' · unrated' : ` · Elo ${other.elo}`}`}
      </p>
    </section>
  );
}

export function Leaderboards() {
  const s = useSocial();
  const acct = useAccount();
  const signedIn = !!acct.user?.username;
  const [board, setBoard] = useState<Board>('rating');
  const [kind, setKind] = useState<Kind>('team');
  const [scope, setScope] = useState<'global' | 'local'>('global');
  const [period, setPeriod] = useState<'all' | 'month' | 'week'>('all');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mine, setMine] = useState<MyStats | null>(null);
  const [ready, setReady] = useState(false);
  const touched = useRef(false);
  useEffect(() => { get('/api/social/stats').then(setStats).catch(() => undefined); }, []);
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
  const seg = <T extends string>(v: T, set: (x: T) => void, opts: [T, string][], id: string) => (
    <div className="soc-seg" role="group" data-testid={`lb-${id}`}>{opts.map(([k, l]) => <button key={k} type="button" className={v === k ? 'on' : ''} onClick={() => set(k)} data-testid={`lb-${id}-${k}`}>{l}</button>)}</div>
  );
  const pickKind = (k: Kind) => { touched.current = true; setKind(k); };
  const unit = board === 'rating' ? (period === 'all' ? '' : ' Elo') : board === 'accuracy' ? '%' : '';
  const accMin = period === 'all' ? 20 : 8;
  const modeKey: Kind = board === 'duos' ? 'team' : kind;
  const mode = mine?.[modeKey];
  const myName = acct.user?.username;
  const onBoard = !!rows?.some((r) => (s.you && r.id === s.you.id) || (!!myName && r.name === myName));
  const ownAcc = board === 'accuracy' && mode && mode.accuracy !== null && mode.bids < accMin && !onBoard ? mode : null;
  const unknownRegion = !!note && /no local board/i.test(note);
  const mineRow = (r: Row) => ((s.you && r.id === s.you.id) || (myName && r.name === myName) ? 'soc-me' : '');
  return (
    <div className="soc-lb" data-testid="leaderboard">
      {stats && <p className="soc-serverstats" data-testid="server-stats">{Object.keys(s.users).length} online · {stats.accounts} players · {siteGamesToday(stats.gamesToday)} · {stats.tournamentsOpen} open tournament{stats.tournamentsOpen === 1 ? '' : 's'}</p>}
      {signedIn && mine && <YourStats mine={mine} kind={kind} />}
      {signedIn && !ready && <p className="soc-empty">Loading your stats…</p>}
      {seg(board, setBoard, [['rating', 'Rating'], ['wins', 'Wins'], ['accuracy', 'Bid accuracy'], ['duos', 'Best duos']], 'board')}
      <div className="soc-lb-filters">
        {board !== 'duos' && seg(kind, pickKind, [['team', '2v2'], ['cutthroat', 'Cutthroat']], 'kind')}
        {seg(scope, setScope, [['global', 'Global'], ['local', 'Local']], 'scope')}
        {seg(period, setPeriod, [['all', 'All-time'], ['month', 'Month'], ['week', 'Week']], 'period')}
      </div>
      {note && <p className="soc-muted" data-testid="lb-note">{note}</p>}
      {rows === null ? <p className="soc-empty">Loading…</p> : (
        <>
          {ownAcc && (
            <table className="soc-lb-table soc-own-acc" data-testid="lb-own-accuracy"><tbody>
              <tr className="soc-me">
                <td className="rk">you</td>
                <td>{myName ?? 'You'}</td>
                <td className="v">{ownAcc.accuracy}%</td>
                <td className="soc-muted">needs {accMin} bids</td>
              </tr>
            </tbody></table>
          )}
          {!rows.length ? (
            unknownRegion ? null : <p className="soc-empty soc-lb-empty" data-testid="lb-empty">{ownAcc ? `The board lists players with at least ${accMin} bids. Yours counts now, including games vs bots.` : emptyCopy(board, period, scope)}</p>
          ) : board === 'wins' ? (
            <table className="soc-lb-table soc-wins" data-testid="lb-wins"><thead>
              <tr><th /><th /><th>vs players</th><th>vs bots</th></tr>
            </thead><tbody>
              {rows.map((r) => (
                <tr key={r.id} className={mineRow(r)}>
                  <td className="rk">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
                  <td><button type="button" className="link" onClick={() => social.showProfile(r.name)}>{r.name}</button></td>
                  <td className="v" data-testid={`lb-vs-players-${r.name}`}>{r.vsPlayers ?? r.value}</td>
                  <td className="v" data-testid={`lb-vs-bots-${r.name}`}>{r.vsBots ?? 0}</td>
                </tr>
              ))}
            </tbody></table>
          ) : (
            <table className="soc-lb-table"><tbody>
              {rows.map((r) => (
                <tr key={r.id} className={mineRow(r)}>
                  <td className="rk">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
                  <td>{board === 'duos' ? r.name : <button type="button" className="link" onClick={() => social.showProfile(r.name)}>{r.name}</button>}</td>
                  <td className="v">{board === 'rating' && period !== 'all' && r.value > 0 ? '+' : ''}{r.value}{unit}</td>
                  <td className="soc-muted">{r.extra ?? `${r.games} g`}</td>
                </tr>
              ))}
            </tbody></table>
          )}
        </>
      )}
      <p className="soc-note">Stats and bid accuracy count every finished signed-in game, including vs bots. Elo needs signed-in players on at least two sides. Wins split into vs players and vs bots; wins against guests count toward neither. Best duos only counts games against signed-in opponents.</p>
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
