/**
 * BWM Central Phase 3 — Crews (Crew destination). Built to the Phase 3
 * server contract (social/crews.ts):
 *   GET  /api/social/crews → { crews, invites }
 *   POST /api/social/crews { name } — create
 *   POST /api/social/crews/:id/invite { userId }
 *   POST /api/social/crews/:id/respond { accept }
 *   POST /api/social/crews/:id/leave
 *   GET  /api/social/crews/:id/leaderboard?board&kind&period → { rows }
 * Until the server lane lands, the GET 404s and this section shows its
 * honest unavailable state — never a fabricated crew or board. Standings
 * are opt-in by construction: only crew members see a crew's board, and
 * the section says so in plain copy.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useSocial } from './store';
import { crewLeaderboardUrl, normalizeCrewsPayload, type Crew, type CrewsPayload } from './crews';

const get = (u: string) => fetch(u, { credentials: 'same-origin' }).then(async (r) => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j;
});
const post = (u: string, b: unknown = {}) => fetch(u, {
  method: 'POST', credentials: 'same-origin',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(b),
}).then(async (r) => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j;
});

interface BoardRow { rank: number; id: string; name: string; value: number; games: number; extra?: string }

const BOARDS: [string, string][] = [['rating', 'Rating'], ['wins', 'Wins'], ['winpct', 'Win %'], ['accuracy', 'Bid accuracy'], ['books', 'Books/hand'], ['nils', 'Nils made'], ['pace', 'Fastest climbers']];
const KINDS: [string, string][] = [['team', '2v2'], ['cutthroat', 'Cutthroat']];
const PERIODS: [string, string][] = [['week', 'This week'], ['month', 'This month'], ['all', 'All-time']];

/** One crew's standings: the Rankings table idiom (rank / name / metric
 *  / GP) over the crew-filtered board, with its own board/kind/period
 *  selectors. Members only — the copy says who can see it. */
function CrewLeaderboard({ crew }: { crew: Crew }) {
  const [board, setBoard] = useState('rating');
  const [kind, setKind] = useState('team');
  const [period, setPeriod] = useState('week');
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setRows(null); setFailed(false);
    get(crewLeaderboardUrl(crew.id, { board, kind, period }))
      .then((j) => { if (live) setRows(((j as { rows?: BoardRow[] }).rows ?? [])); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [crew.id, board, kind, period]);
  const sel = (label: string, value: string, set: (v: string) => void, opts: [string, string][], testid: string) => (
    <label className="crew-sel">{label}
      <select value={value} onChange={(e) => set(e.target.value)} data-testid={`${testid}-${crew.id}`}>
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
  return (
    <div className="crew-board" data-testid={`crew-board-${crew.id}`}>
      <div className="crew-sels">
        {sel('Board', board, setBoard, BOARDS, 'crew-board-sel')}
        {sel('Game', kind, setKind, KINDS, 'crew-kind-sel')}
        {sel('Period', period, setPeriod, PERIODS, 'crew-period-sel')}
      </div>
      <p className="soc-muted crew-optin">Only crew members see this board.</p>
      {failed ? <p className="soc-muted">Standings aren't available for this crew yet.</p>
        : rows === null ? <p className="soc-muted">Loading…</p>
        : !rows.length ? <p className="soc-muted">No crew standings yet — games crew members play show up here.</p>
        : (
          <div className="ranks-list" role="list">
            {rows.map((r) => (
              <div key={r.id} className="ranks-row" role="listitem" data-testid={`crew-row-${crew.id}-${r.rank}`}>
                <span className={`ranks-rk${r.rank <= 3 ? ' top' : ''}`}>{r.rank}</span>
                <span className="ranks-name"><span className="ranks-name-txt">{r.name}</span>{r.extra && <small className="ranks-sub">{r.extra}</small>}</span>
                <span className="ranks-val">{r.value}</span>
                <span className="ranks-gp">{r.games}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

function CrewCard({ crew, onChanged }: { crew: Crew; onChanged: () => void }) {
  const s = useSocial();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const friends = s.friends?.friends ?? [];
  const memberIds = new Set(crew.members.map((m) => m.userId.replace(/^u:/, '')));
  const invitable = friends.filter((f) => !memberIds.has(f.id.replace(/^u:/, '')));
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); onChanged(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <li className="crew-card" data-testid={`crew-card-${crew.id}`}>
      <div className="power-head">
        <b>{crew.name}</b>
        <span className="soc-muted">{crew.memberCount !== null ? `${crew.memberCount} member${crew.memberCount === 1 ? '' : 's'}` : ''}</span>
      </div>
      {crew.members.length > 0 && (
        <p className="soc-muted crew-members">{crew.members.map((m) => m.name ?? m.userId).join(' · ')}</p>
      )}
      <div className="rivalry-acts">
        <button type="button" onClick={() => setOpen((v) => !v)} data-testid={`crew-standings-${crew.id}`}>{open ? 'Hide standings' : 'Standings'}</button>
        <button type="button" className="ghost" disabled={busy} data-testid={`crew-leave-${crew.id}`}
          onClick={() => { if (confirm(`Leave ${crew.name}?`)) void act(() => post(`/api/social/crews/${encodeURIComponent(crew.id)}/leave`)); }}>Leave</button>
      </div>
      {invitable.length > 0 && (
        <div className="crew-invite-row">
          <span className="soc-muted">Invite a friend:</span>
          {invitable.map((f) => (
            <button key={f.id} type="button" disabled={busy} data-testid={`crew-invite-${crew.id}-${f.name}`}
              onClick={() => void act(() => post(`/api/social/crews/${encodeURIComponent(crew.id)}/invite`, { userId: f.id }))}>{f.name}</button>
          ))}
        </div>
      )}
      {err && <p className="soc-err">{err}</p>}
      {open && <CrewLeaderboard crew={crew} />}
    </li>
  );
}

export function Crews({ signedIn }: { signedIn: boolean }) {
  const [data, setData] = useState<CrewsPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    setFailed(false);
    get('/api/social/crews')
      .then((j) => { if (live) setData(normalizeCrewsPayload(j)); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [signedIn, tick]);
  const reload = () => setTick((t) => t + 1);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true); setErr(null);
    try { await post('/api/social/crews', { name: n }); setName(''); reload(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const respond = async (crewId: string, accept: boolean) => {
    setBusy(true); setErr(null);
    try { await post(`/api/social/crews/${encodeURIComponent(crewId)}/respond`, { accept }); reload(); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <section className="soc-sec crews" data-testid="crews">
      <h4>Crews</h4>
      {!signedIn ? <p className="soc-empty">Sign in to join a crew.</p>
        : failed ? (
          <p className="soc-empty" data-testid="crews-unavailable">Crews aren't available yet — the crew service hasn't landed on this build. Your friends list below is unaffected.</p>
        ) : data === null ? <p className="soc-empty">Loading…</p>
        : (
          <>
            {data.invites.map((inv) => (
              <div key={inv.id ?? inv.crewId} className="matchup-invite" data-testid={`crew-invite-row-${inv.crewId}`}>
                <span>You're invited to <b>{inv.crewName}</b>{inv.fromName ? <> by {inv.fromName}</> : null}</span>
                <span className="favorite-acts">
                  <button type="button" disabled={busy} onClick={() => void respond(inv.crewId, false)} data-testid={`crew-decline-${inv.crewId}`}>Decline</button>
                  <button type="button" className="primary" disabled={busy} onClick={() => void respond(inv.crewId, true)} data-testid={`crew-accept-${inv.crewId}`}>Accept</button>
                </span>
              </div>
            ))}
            {!data.crews.length && !data.invites.length && (
              <p className="soc-empty">No crew yet — start one below, or accept an invite when a friend sends one.</p>
            )}
            <ul className="crew-list">{data.crews.map((c) => <CrewCard key={c.id} crew={c} onChanged={reload} />)}</ul>
            <form className="crew-create" onSubmit={create}>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New crew name…" aria-label="New crew name" maxLength={32} data-testid="crew-create-name" />
              <button type="submit" className="primary" disabled={busy || !name.trim()} data-testid="crew-create-go">Create crew</button>
            </form>
            {err && <p className="soc-err" data-testid="crews-err">{err}</p>}
          </>
        )}
    </section>
  );
}
