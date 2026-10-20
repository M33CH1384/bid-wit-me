/**
 * Big Bank Take Lil Bank (Phase 2): the Challenges tab of the Social panel — list grouped
 * by what needs you, the create sheet (both formats), the detail card with full terms and
 * the accept / check-in / cancel / join actions — plus the 🏦 Challenge button that lives
 * on player profiles. Server core: Phase 1 (see wagerApi.ts); logic: wagerLogic.ts.
 */
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAccount } from '../account/api';
import { navigate } from '../online/nav';
import { onNotice, social, useSocial } from './store';
import { createWager, fetchMyCred, fetchWager, fetchWagerEnabled, fetchWagerList, wagerAct, type MyCred, type WagerRow, type WagerView } from './wagerApi';
import { TIMER_PRESETS, WAGER_LADDER, challengeButtonState, createBody, gameLabel, groupChallenges, netText, startPresets, timerLabel, toLocalInput, validateCreate, whenText, type CreateFormState } from './wagerLogic';

function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => window.clearInterval(t); }, [ms]);
  return now;
}

/* ------------------------------------------------------------ challenge button */

/** 🏦 Challenge on a player's profile (Social view + in-game card). Hidden unless the
 *  feature is on AND you may challenge this player; a visible lock until you earn it. */
export function ChallengeButton({ name, blocked = false, targetIsGuest = false, onChallenge, testid }: {
  name: string; blocked?: boolean; targetIsGuest?: boolean;
  onChallenge?: () => void; testid?: string;
}) {
  const acct = useAccount();
  const signedIn = !!acct.user?.username;
  const [cred, setCred] = useState<MyCred | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (!signedIn) return;
    let on = true;
    void fetchMyCred().then((c) => { if (on) setCred(c); });
    void fetchWagerEnabled().then((v) => { if (on) setEnabled(v); });
    return () => { on = false; };
  }, [signedIn]);
  const state = challengeButtonState({
    signedIn, enabled,
    hasUnlock: !!cred?.unlocks.includes('big-bank'), dev: !!cred?.dev,
    isSelf: acct.user?.username === name, blocked, targetIsGuest,
  });
  if (state === 'hidden') return null;
  if (state === 'locked') {
    return <button type="button" disabled data-testid={testid ?? 'challenge-btn-locked'} title="Big Bank challenges unlock at Rep Level 20 · Block Captain">🔒 Challenge · Level 20</button>;
  }
  return (
    <button type="button" data-testid={testid ?? 'challenge-btn'} title="Challenge to a Big Bank wager match"
      onClick={() => { if (onChallenge) onChallenge(); else social.startChallenge(name); }}>🏦 Challenge</button>
  );
}

/* --------------------------------------------------------------- challenges */

const STATUS_WORD: Record<string, string> = {
  settled: 'Settled', forfeited: 'Forfeited', void: 'Void — refunded',
  declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled',
};

function playersLine(r: WagerRow): string {
  const mark = (p: WagerRow['players'][number]) => p.name + (p.checkedIn ? ' ✓' : p.status === 'invited' ? ' …' : '');
  if (r.format === 'partnership') {
    const side = (n: number) => r.players.filter((p) => p.side === n).map(mark);
    const s0 = side(0), s1 = side(1);
    const fill = (xs: string[]) => (xs.length >= 2 ? xs.join(' + ') : xs.length === 1 ? `${xs[0]} + partner` : '—');
    return `${fill(s0)} vs ${fill(s1)}`;
  }
  return r.players.map(mark).join(' · ');
}

function RowCard({ r, myUid, now }: { r: WagerRow; myUid: string | null; now: number }) {
  const me = r.players.find((p) => p.uid === myUid);
  const finished = !!STATUS_WORD[r.status];
  return (
    <li>
      <button type="button" className="soc-tour-item wg-card" onClick={() => social.showChallenge(r.id)} data-testid={`wg-row-${r.id}`}>
        <b>🏦 {gameLabel(r.format, r.mode)} · {r.wager.toLocaleString()} 🪙 each <span className="soc-muted">pot {r.pot.toLocaleString()} 🪙</span></b>
        <small>{playersLine(r)}</small>
        <small className="soc-muted">
          {r.status === 'live' ? `Live now${r.tableCode ? ` · table ${r.tableCode}` : ''}`
            : finished ? `${STATUS_WORD[r.status]}${r.endReason === 'no_show' ? ' (no-show)' : r.endReason === 'abandoned' ? ' (left mid-match)' : ''}${me?.net != null ? ` · you ${netText(me.net)}` : ''}`
            : now >= r.checkinOpensAt && r.status !== 'pending' ? `Check-in open · starts ${whenText(r.startAt, now)}`
            : `Starts ${whenText(r.startAt, now)}`}
        </small>
      </button>
    </li>
  );
}

export function WagerChallenges({ signedIn }: { signedIn: boolean }) {
  const s = useSocial();
  const acct = useAccount();
  const now = useNow(1000);
  const [rows, setRows] = useState<WagerRow[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [creating, setCreating] = useState(false);
  const load = useCallback(() => {
    fetchWagerList().then((j) => { setRows(j.challenges); setEnabled(j.enabled ?? true); }).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); const t = window.setInterval(load, 20_000); return () => window.clearInterval(t); }, [load]);
  // wager notices arrive live over the hub (invite, check-in open, outcome): refetch on them
  useEffect(() => onNotice((n) => { if (n.cid) load(); }), [load]);
  useEffect(() => { if (s.wagerCreate) setCreating(true); }, [s.wagerCreate]);

  if (s.wager) return <WagerDetail id={s.wager} />;
  if (creating) {
    return <CreateWager presetOpponent={s.wagerCreate?.opponent}
      onDone={(id) => { social.clearWagerCreate(); setCreating(false); if (id) social.showChallenge(id); else load(); }} />;
  }
  if (!signedIn) return <p className="soc-note">Sign in to send and accept Big Bank challenges.</p>;
  if (enabled === false) return <p className="soc-empty">Big Bank isn't open yet.</p>;
  const groups = rows ? groupChallenges(rows, acct.user?.id ?? null, now) : null;
  const section = (title: string, list: WagerRow[], testid: string) => list.length ? (
    <div key={title} className="wg-group">
      <h4>{title}</h4>
      <ul className="soc-tour-list" data-testid={testid}>{list.map((r) => <RowCard key={r.id} r={r} myUid={acct.user?.id ?? null} now={now} />)}</ul>
    </div>
  ) : null;
  return (
    <div className="wg" data-testid="wager-challenges">
      <div className="soc-tour-top">
        <b className="wg-title">🏦 Big Bank Take Lil Bank</b>
        <button type="button" className="primary" onClick={() => setCreating(true)} data-testid="wg-new">＋ New challenge</button>
      </div>
      {rows === null || !groups ? <p className="soc-empty">Loading…</p> : (
        <>
          {section('Needs you', groups.needsYou, 'wg-needs')}
          {section('Check-in open', groups.checkin, 'wg-checkin')}
          {section('Live', groups.live, 'wg-live')}
          {section('Upcoming', groups.upcoming, 'wg-upcoming')}
          {section('Finished', groups.finished, 'wg-finished')}
          {!rows.length && <p className="soc-empty">No challenges yet — challenge a player from their profile, or start one here.</p>}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- create */

function PlayerPicker({ label, value, onChange, exclude, testid }: {
  label: string; value: string; onChange: (v: string) => void; exclude: string[]; testid: string;
}) {
  const s = useSocial();
  const [focus, setFocus] = useState(false);
  const pool = useMemo(() => {
    const names = new Map<string, string>();
    for (const f of [...(s.friends?.friends ?? []), ...(s.friends?.incoming ?? []), ...(s.friends?.outgoing ?? [])]) names.set(f.name.toLowerCase(), f.name);
    for (const u of Object.values(s.users)) if (!u.guest) names.set(u.name.toLowerCase(), u.name);
    for (const n of Object.values(s.names)) names.set(n.toLowerCase(), n);
    return [...names.values()].sort((a, b) => a.localeCompare(b));
  }, [s.friends, s.users, s.names]);
  const q = value.trim().toLowerCase();
  const sugg = focus && q ? pool.filter((n) => n.toLowerCase().includes(q) && !exclude.some((e) => e.trim().toLowerCase() === n.toLowerCase())).slice(0, 6) : [];
  return (
    <label>{label}
      <input value={value} onChange={(e) => onChange(e.target.value)} onFocus={() => setFocus(true)}
        onBlur={() => window.setTimeout(() => setFocus(false), 150)}
        placeholder="Player's username" autoComplete="off" data-testid={testid} />
      {sugg.length > 0 && (
        <span className="wg-sugg">{sugg.map((n) => <button type="button" key={n} onClick={() => onChange(n)}>{n}</button>)}</span>
      )}
    </label>
  );
}

function CreateWager({ presetOpponent, onDone }: { presetOpponent?: string; onDone: (id: string | null) => void }) {
  const acct = useAccount();
  const myName = acct.user?.username ?? '';
  const presets = useMemo(() => startPresets(Date.now()), []);
  const [f, setF] = useState<CreateFormState>({
    format: 'partnership', wager: 250, deck: 'joker', target: 500, timers: 'normal',
    startAt: presets[0]!.at, opponent: presetOpponent ?? '', partner: '', invitees: ['', '', ''],
  });
  const [startTxt, setStartTxt] = useState(() => toLocalInput(presets[0]!.at));
  const [cred, setCred] = useState<MyCred | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetchMyCred(0).then(setCred); }, []);
  const upd = (p: Partial<CreateFormState>) => setF((x) => ({ ...x, ...p }));
  const pickFormat = (format: 'partnership' | 'cutthroat') => upd({ format, target: format === 'partnership' ? 500 : 300 });
  const hint = validateCreate(f, { myName, balance: cred?.coins ?? Number.MAX_SAFE_INTEGER, now: Date.now() });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (hint || busy) return;
    setBusy(true); setErr(null);
    try {
      const v = await createWager(createBody(f));
      onDone(v.id);
    } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const targets = f.format === 'partnership' ? [300, 500, 750] : [250, 300, 500];
  return (
    <form className="soc-tour-form wg-form" onSubmit={submit} data-testid="wg-form">
      <button type="button" className="link" onClick={() => onDone(null)}>← Challenges</button>
      <h3>🏦 New Big Bank challenge</h3>
      <div className="soc-seg" role="group" aria-label="Format" data-testid="wg-format">
        <button type="button" className={f.format === 'partnership' ? 'on' : ''} onClick={() => pickFormat('partnership')}>Partnership 2v2</button>
        <button type="button" className={f.format === 'cutthroat' ? 'on' : ''} onClick={() => pickFormat('cutthroat')}>Cutthroat</button>
      </div>
      {f.format === 'partnership' ? (
        <>
          <PlayerPicker label="Opponent" value={f.opponent} onChange={(v) => upd({ opponent: v })} exclude={[myName, f.partner]} testid="wg-opponent" />
          <PlayerPicker label="Your partner" value={f.partner} onChange={(v) => upd({ partner: v })} exclude={[myName, f.opponent]} testid="wg-partner" />
        </>
      ) : (
        <>
          {f.invitees.map((n, i) => (
            <PlayerPicker key={i} label={`Player ${i + 2}`} value={n} testid={`wg-invitee-${i}`}
              exclude={[myName, ...f.invitees.filter((_, j) => j !== i)]}
              onChange={(v) => upd({ invitees: f.invitees.map((x, j) => (j === i ? v : x)) })} />
          ))}
        </>
      )}
      <span className="wg-field-label">Wager (each player){cred ? ` · your balance ${cred.coins.toLocaleString()} 🪙` : ''}</span>
      <div className="wg-chips" role="group" aria-label="Wager" data-testid="wg-wager">
        {WAGER_LADDER.map((w) => (
          <button type="button" key={w} className={f.wager === w ? 'on' : ''} disabled={!!cred && w > cred.coins}
            onClick={() => upd({ wager: w })} data-testid={`wg-wager-${w}`}>{w.toLocaleString()} 🪙</button>
        ))}
      </div>
      {f.format === 'partnership' && (
        <>
          <span className="wg-field-label">Deck</span>
          <div className="soc-seg" role="group" aria-label="Deck" data-testid="wg-deck">
            <button type="button" className={f.deck === 'joker' ? 'on' : ''} onClick={() => upd({ deck: 'joker' })}>Joker</button>
            <button type="button" className={f.deck === 'aceDown' ? 'on' : ''} onClick={() => upd({ deck: 'aceDown' })}>Ace Down</button>
          </div>
        </>
      )}
      <span className="wg-field-label">Game to</span>
      <div className="wg-chips" role="group" aria-label="Target score" data-testid="wg-target">
        {targets.map((t) => <button type="button" key={t} className={f.target === t ? 'on' : ''} onClick={() => upd({ target: t })}>{t}</button>)}
      </div>
      <span className="wg-field-label">Timers (bid / play)</span>
      <div className="wg-chips" role="group" aria-label="Timers" data-testid="wg-timers">
        {TIMER_PRESETS.map((p) => <button type="button" key={p.id} className={f.timers === p.id ? 'on' : ''} onClick={() => upd({ timers: p.id })}>{p.label} {p.bid}/{p.play}</button>)}
      </div>
      <span className="wg-field-label">Starts</span>
      <div className="wg-chips" role="group" aria-label="Start time" data-testid="wg-start-presets">
        {presets.map((p) => (
          <button type="button" key={p.id} className={f.startAt === p.at ? 'on' : ''}
            onClick={() => { upd({ startAt: p.at }); setStartTxt(toLocalInput(p.at)); }}>{p.label}</button>
        ))}
      </div>
      <label>Or pick a time
        <input type="datetime-local" value={startTxt} data-testid="wg-start"
          onChange={(e) => { setStartTxt(e.target.value); const at = new Date(e.target.value).getTime(); if (Number.isFinite(at)) upd({ startAt: at }); }} />
      </label>
      <p className="wg-terms" data-testid="wg-terms">
        You escrow <b>{f.wager.toLocaleString()} 🪙</b> now; each player escrows {f.wager.toLocaleString()} 🪙 when they accept.
        Pot: <b>{(f.wager * 4).toLocaleString()} 🪙</b> — winners take it, no fee. Check-in opens 10 minutes before the start;
        a player who doesn't show loses their wager. If nobody shows, everyone is refunded.
      </p>
      {(err ?? hint) && <p className="soc-err" data-testid="wg-err">{err ?? hint}</p>}
      <button type="submit" className="primary" disabled={busy || !!hint} data-testid="wg-submit">{busy ? 'Sending…' : `Send challenge · escrow ${f.wager.toLocaleString()} 🪙`}</button>
    </form>
  );
}

/* -------------------------------------------------------------------- detail */

const END_TEXT: Record<string, string> = {
  played: 'Played — the pot went to the winners.',
  no_show: 'Settled by no-show — the players who showed split the missing wagers.',
  double_no_show: 'Called off — not enough players showed. All wagers refunded.',
  abandoned: 'A player left mid-match — their wager was split by the table.',
  declined: 'Declined — all wagers refunded.',
  expired: 'Expired before everyone accepted — all wagers refunded.',
  cancelled: 'Cancelled — all wagers refunded.',
};

function WagerDetail({ id }: { id: string }) {
  const acct = useAccount();
  const myUid = acct.user?.id;
  const now = useNow(1000);
  const [v, setV] = useState<WagerView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [partner, setPartner] = useState('');
  const load = useCallback(() => { fetchWager(id).then((j) => { setV(j); setErr(null); }).catch((e) => setErr((e as Error).message)); }, [id]);
  useEffect(() => { load(); const t = window.setInterval(load, 10_000); return () => window.clearInterval(t); }, [load]);
  useEffect(() => onNotice((n) => { if (n.cid === id) load(); }), [id, load]);
  const act = async (a: 'accept' | 'decline' | 'cancel' | 'checkin', body?: Record<string, unknown>) => {
    setBusy(true);
    try { setV(await wagerAct(id, a, body)); setErr(null); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  if (!v) return (
    <div className="wg-detail">
      <button type="button" className="link" onClick={() => social.showChallenge(null)}>← Challenges</button>
      <p className="soc-empty">{err ?? 'Loading…'}</p>
    </div>
  );
  const you = v.you;
  const needsPartner = v.format === 'partnership' && you?.role === 'opponent' && you?.canAccept;
  const finished = !!STATUS_WORD[v.status];
  const statusLine = v.status === 'pending' ? 'Waiting for accepts'
    : v.status === 'scheduled' ? (now >= v.checkinOpensAt ? 'Check-in open' : 'Scheduled')
    : v.status === 'checkin' ? 'Check-in open'
    : v.status === 'live' ? `Live now${v.tableCode ? ` · table ${v.tableCode}` : ''}`
    : STATUS_WORD[v.status] ?? v.status;
  return (
    <div className="wg-detail" data-testid="wg-detail">
      <button type="button" className="link" onClick={() => social.showChallenge(null)}>← Challenges</button>
      <h3>🏦 Big Bank — {gameLabel(v.format, v.mode)}</h3>
      <p className="soc-tour-status" data-testid="wg-status">{statusLine}</p>
      <div className="wg-terms-grid">
        <div><b>{v.wager.toLocaleString()} 🪙</b><small>each player</small></div>
        <div><b>{v.pot.toLocaleString()} 🪙</b><small>pot</small></div>
        <div><b>{v.rules.targetScore}</b><small>game to</small></div>
        <div><b>{timerLabel(v.rules.turnTimerSec)}</b><small>timers</small></div>
      </div>
      <p className="soc-muted">
        {v.format === 'partnership' ? (v.rules.deck === 'standard52' ? 'Ace Down deck' : 'Joker deck') : 'Joker deck'} · starts {whenText(v.startAt, now)} · check-in opens {whenText(v.checkinOpensAt, now)}
      </p>
      <h4>Players</h4>
      <ul className="wg-players" data-testid="wg-players">
        {v.players.map((p) => (
          <li key={p.uid}>
            <b>{p.name}</b>{p.uid === myUid && <span className="soc-tag">you</span>}
            <span className="soc-muted">{p.role}{v.format === 'partnership' && p.side !== null ? ` · side ${p.side + 1}` : ''}</span>
            <span className="wg-pstate">
              {p.checkedIn ? <i className="soc-tag ok">✓ checked in</i>
                : p.status === 'invited' ? <i className="soc-tag">invited</i>
                : p.status === 'declined' ? <i className="soc-tag">declined</i>
                : <i className="soc-tag">accepted{p.escrowed ? ' · 🔒 escrowed' : ''}</i>}
              {p.net != null && <i className={`wg-net ${p.net > 0 ? 'up' : p.net < 0 ? 'down' : ''}`}>{netText(p.net)}</i>}
            </span>
          </li>
        ))}
        {v.format === 'partnership' && v.players.length < 4 && <li className="soc-muted">+ the opponent's partner (named when they accept)</li>}
      </ul>
      {finished && v.endReason && <p className="soc-note" data-testid="wg-outcome">{END_TEXT[v.endReason] ?? v.endReason}</p>}
      {err && <p className="soc-err" data-testid="wg-detail-err">{err}</p>}
      {you && (
        <div className="soc-tour-acts wg-acts">
          {you.canAccept && (
            <>
              {needsPartner && (
                <PlayerPicker label="Your partner" value={partner} onChange={setPartner} testid="wg-accept-partner"
                  exclude={v.players.map((p) => p.name)} />
              )}
              <button type="button" className="primary" disabled={busy || (needsPartner && !partner.trim())} data-testid="wg-accept"
                onClick={() => void act('accept', needsPartner ? { partner: partner.trim() } : {})}>Accept · escrow {v.wager.toLocaleString()} 🪙</button>
              <button type="button" className="ghost" disabled={busy} data-testid="wg-decline" onClick={() => void act('decline')}>Decline</button>
            </>
          )}
          {you.canCheckin && <button type="button" className="primary" disabled={busy} data-testid="wg-checkin" onClick={() => void act('checkin')}>Check in</button>}
          {!you.canCheckin && (v.status === 'scheduled' || v.status === 'checkin') && you.checkedIn && <span className="soc-tag ok" data-testid="wg-checkedin">✓ You're checked in</span>}
          {v.status === 'live' && v.tableCode && (
            <button type="button" className="primary big" data-testid="wg-join" onClick={() => { social.close(); navigate(`/t/${v.tableCode}`); }}>Go to your table · {v.tableCode}</button>
          )}
          {you.canCancel && <button type="button" className="ghost" disabled={busy} data-testid="wg-cancel"
            onClick={() => { if (confirm('Cancel this challenge? All wagers are refunded.')) void act('cancel'); }}>Cancel challenge</button>}
        </div>
      )}
    </div>
  );
}
