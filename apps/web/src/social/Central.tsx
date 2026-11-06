/**
 * BWM Central — the destination components: Headlines (Phase 2 engine:
 * deterministic stories over existing payloads, seen-once), the Matchups
 * home (player picker + Rivalries + challenge surfacing + tournaments +
 * Big Bank), Favorite partners for Crew, and the broadcast match view.
 * Empty states are honest sentences and no stat is ever invented — a
 * missing field renders "—", never 0.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { InviteMsg } from '@spades/protocol';
import { useAccount } from '../account/api';
import { createTable } from '../online/connection';
import { serverUrl } from '../online/config';
import { navigate } from '../online/nav';
import { FeaturedTable, Tournaments } from './Compete';
import type { LiveHighlight, RecentResult } from './LeagueTicker';
import { social, useSocial, type MyTable } from './store';
import { ChallengeButton, WagerChallenges } from './Wager';
import { fetchWagerList, type WagerRow } from './wagerApi';
import {
  finalScores, matchTimelinePoints, matchTurning,
  statCell, type MatchPayload, type PowerRowLike,
} from './central';
import {
  HEADLINE_SEEN_KEY, buildHeadlines, headlineModeLabel, markSeenIds, parseSeenIds,
  type HeadlineCard, type MeProfileLike,
} from './headlines';
import { buildRivalries, type H2hRow, type RivalryCard } from './rivalries';
import { pairStreakText, pairWinPct, type PairRecordLike } from './pairRecord';
import { useFavorites, type FavoritePartner } from './favorites';
import { inviteTo } from './Social';
import { celebrationPresentation, hubCelebrations } from './celebration';
import { fx, useReduceEffects } from '../fx';
import { perfGovernor } from '../three/perfGovernor';

const get = (u: string) => fetch(u, { credentials: 'same-origin' }).then(async (r) => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j;
});


/** Payload-shape guard (crash hardening, 2026-11-06): the fetch layer
 *  casts 200 responses unchecked, so a present-but-wrong-typed
 *  collection flowed into the headline/rivalry engines and threw
 *  during render. A non-array where an array belongs is treated as
 *  absent — the same degradation a missing field already got. */
function arr<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }

const timeLabel = (at: number) => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const MODE_LABEL: Record<string, string> = { joker: 'Joker', aceDown: 'Ace Down', cutthroat: 'Cutthroat', cutthroat4: 'Cutthroat' };

function useFetch<T>(url: string | null): { data: T | null; failed: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!url) return;
    let live = true;
    setFailed(false);
    get(url).then((j) => { if (live) setData(j as T); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [url]);
  return { data, failed };
}

/** Accept a table invite the way the invite toast does: reply, close the
 *  panel, land on the table (or the story room for a co-op invite). */
function acceptInvite(inv: InviteMsg) {
  social.replyInvite(inv, true);
  social.close();
  if (inv.kind === 'story-coop') navigate(`/story?coop=${inv.code}`);
  else navigate(`/t/${inv.code}${inv.seat !== undefined ? `?seat=${inv.seat}` : ''}`);
}

/* -------------------------------------------------------------- Headlines */

export function Headlines({ signedIn }: { signedIn: boolean }) {
  const acct = useAccount();
  const s = useSocial();
  const myName = acct.user?.username ?? null;
  const myUid = acct.user?.id ?? null;
  const resultsQ = useFetch<{ results: RecentResult[] }>('/api/social/results?limit=25');
  const highlightsQ = useFetch<{ highlights: LiveHighlight[] }>('/api/social/highlights');
  const powerQ = useFetch<{ week: string; rows: PowerRowLike[] }>('/api/social/power?kind=team');
  const meQ = useFetch<Record<string, unknown>>(signedIn ? '/api/profile/me' : null);
  const myProfileQ = useFetch<{ h2h?: H2hRow[] }>(signedIn && myName ? `/api/social/profile/${encodeURIComponent(myName)}` : null);
  const [wagers, setWagers] = useState<WagerRow[]>([]);
  const [checkedAt] = useState(() => Date.now());
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetchWagerList().then((j) => { if (live) setWagers(j.challenges); }).catch(() => { if (live) setWagers([]); });
    return () => { live = false; };
  }, [signedIn]);
  /* Seen-set: read once on mount (a story is "new" on exactly one
   * visit), then every card this visit shows is folded in for the next. */
  const [seen] = useState<string[]>(() => {
    try { return parseSeenIds(localStorage.getItem(HEADLINE_SEEN_KEY)); } catch { return []; }
  });
  const results = arr<RecentResult>(resultsQ.data?.results);
  const cards = useMemo(() => buildHeadlines({
    myName: signedIn ? myName : null,
    myUid: signedIn ? myUid : null,
    results,
    me: (meQ.data as unknown as MeProfileLike | null) ?? null,
    h2h: arr<H2hRow>(myProfileQ.data?.h2h),
    powerRows: arr<PowerRowLike>(powerQ.data?.rows),
    highlights: arr<LiveHighlight>(highlightsQ.data?.highlights),
    wagers,
    invites: s.invites,
    sentInvites: Object.values(s.sent),
    friendNames: (s.friends?.friends ?? []).map((f) => f.name),
    tables: Object.values(s.tables).filter((t) => t.status !== 'over'),
    seen,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [signedIn, myName, myUid, resultsQ.data, meQ.data, myProfileQ.data, powerQ.data, highlightsQ.data, wagers, s.invites, s.friends, s.tables, seen]);
  useEffect(() => {
    if (!cards.length) return;
    try { localStorage.setItem(HEADLINE_SEEN_KEY, JSON.stringify(markSeenIds(seen, cards.map((c) => c.id)))); } catch { /* private mode */ }
  }, [cards, seen]);

  const actionFor = (c: HeadlineCard) => {
    const a = c.action;
    switch (a.kind) {
      case 'match': return <button type="button" className="headline-result" onClick={() => social.openMatch(a.id)}>View match</button>;
      case 'profile': return <button type="button" className="link" onClick={() => social.showProfile(a.name, a.id)}>View profile</button>;
      case 'rankings': return <button type="button" className="link" onClick={() => social.dest('rankings')}>View Rankings</button>;
      case 'career': return <button type="button" className="link" onClick={() => social.dest('career')}>View My Career</button>;
      case 'challenge': return <button type="button" className="link" onClick={() => social.showChallenge(a.id)}>View challenge</button>;
      case 'lobby': return <button type="button" className="link" onClick={() => { social.close(); navigate('/'); }}>Open tables</button>;
      case 'watch-table': return <button type="button" className="link" onClick={() => { social.close(); navigate(`/t/${a.code}?watch=1`); }}>Watch</button>;
      case 'invite': {
        const inv = s.invites.find((i) => i.id === a.id);
        if (!inv) return null;
        return (
          <span className="headline-invite-acts">
            <button type="button" onClick={() => social.replyInvite(inv, false)} data-testid="headline-invite-decline">Decline</button>
            <button type="button" className="primary" onClick={() => acceptInvite(inv)} data-testid="headline-invite-accept">Accept</button>
          </span>
        );
      }
      default: return null;
    }
  };

  return (
    <div className="central-headlines" data-testid="central-headlines">
      {cards.map((c) => (
        <section key={c.id} className="headline-card" data-testid={`headline-card-${c.type}`}>
          <div className="power-head">
            <h3>{c.title}</h3>
            {c.type === 'live' && <span className="headline-live-badge"><i className="ticker-live-dot" />LIVE</span>}
            {c.isNew && <span className="headline-new" data-testid="headline-new">NEW</span>}
            {c.at !== null && <span className="soc-muted">{timeLabel(c.at)}</span>}
          </div>
          <p className="headline-text">{c.text}</p>
          {actionFor(c)}
        </section>
      ))}
      {!cards.length && (
        <section className="headline-card" data-testid="headline-empty">
          <p className="soc-muted">{resultsQ.data || resultsQ.failed ? 'Nothing on the wire yet — finished matches, challenges and milestones show up here.' : 'Loading…'}</p>
        </section>
      )}
      <section className="headline-card" data-testid="headline-featured">
        <FeaturedTable />
        <p className="soc-muted headline-asof">Checked {timeLabel(checkedAt)}</p>
      </section>
    </div>
  );
}

/* -------------------------------------------------------- favorite partners */

function FavoritePartnerCard({ fav, myTable }: { fav: FavoritePartner; myTable: MyTable | null }) {
  const [rec, setRec] = useState<PairRecordLike | null>(null);
  const [failed, setFailed] = useState(false);
  const { toggleFavorite } = useFavorites();
  useEffect(() => {
    let live = true;
    setFailed(false);
    get(`/api/profile/pair/${encodeURIComponent(fav.userId)}`)
      .then((j) => { if (live) setRec(j as PairRecordLike); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [fav.userId]);
  const pct = rec ? pairWinPct(rec) : null;
  return (
    <li className="favorite-card" data-testid={`favorite-${fav.name}`}>
      <button type="button" className="link" onClick={() => social.showProfile(fav.name, `u:${fav.userId}`)}>{fav.name}</button>
      <span className="soc-muted favorite-rec" data-testid={`favorite-rec-${fav.name}`}>
        {failed ? 'Pair record unavailable.'
          : rec === null ? 'Loading…'
          : rec.games === 0 ? 'No recorded games together yet.'
          : `${rec.games} game${rec.games === 1 ? '' : 's'} together · ${rec.wins}–${rec.losses}${pct !== null ? ` · Win ${pct}%` : ''} · Streak ${pairStreakText(rec.streak)}`}
      </span>
      <span className="favorite-acts">
        <button type="button" className="primary" data-testid={`favorite-invite-${fav.name}`} onClick={() => void inviteTo(`u:${fav.userId}`, myTable)}>➕ Invite</button>
        <button type="button" data-testid={`favorite-unstar-${fav.name}`} aria-label={`Unstar ${fav.name}`} onClick={() => void toggleFavorite(fav, false)}>★</button>
      </span>
    </li>
  );
}

/** The Crew "Favorite partners" section: the caller's starred partners,
 *  each with the pair record and a one-tap Invite. Rendered inside the
 *  Crew destination's Friends view (Social.tsx). */
export function FavoritePartners({ signedIn }: { signedIn: boolean }) {
  const s = useSocial();
  const { favorites } = useFavorites();
  return (
    <section className="soc-sec favorite-partners" data-testid="favorite-partners">
      <h4>Favorite partners</h4>
      {!signedIn ? <p className="soc-empty">Sign in to star partners.</p>
        : favorites === null ? <p className="soc-empty">Loading…</p>
        : !favorites.length ? <p className="soc-empty">Star a partner to pin them here.</p>
        : <ul className="favorite-list">{favorites.map((f) => <FavoritePartnerCard key={f.userId} fav={f} myTable={s.myTable} />)}</ul>}
    </section>
  );
}

/* --------------------------------------------------------------- Matchups */

interface RecentPlayer { id: string; name: string; games: number; last: number; partner: boolean }

function Rivalries({ signedIn }: { signedIn: boolean }) {
  const acct = useAccount();
  const s = useSocial();
  const myName = acct.user?.username ?? null;
  const profileQ = useFetch<{ h2h?: H2hRow[] }>(signedIn && myName ? `/api/social/profile/${encodeURIComponent(myName)}` : null);
  const resultsQ = useFetch<{ results: RecentResult[] }>('/api/social/results?limit=25');
  const cards = useMemo(
    () => buildRivalries(arr<H2hRow>(profileQ.data?.h2h), arr<RecentResult>(resultsQ.data?.results), myName),
    [profileQ.data, resultsQ.data, myName],
  );
  /* ALL SQUARE (BWM Central Phase 3): a tied rivalry's marker animates
   * ONCE when its card first renders in a session — routed through the
   * celebration queue (key per rivalry; the queue's session dedupe is
   * the once-only latch, so re-renders and remounts never replay it).
   * The marker's own animation follows the queue's presentation gate:
   * motion animates, the governor's deepest trim renders it static,
   * reduced motion leaves the plain marker. */
  const reduceFx = useReduceEffects();
  const [squareCelebrated, setSquareCelebrated] = useState<Record<string, 'motion' | 'static'>>({});
  useEffect(() => {
    for (const c of cards) {
      if (!c.tied) continue;
      const item = { key: `allsquare:${c.id}`, kind: 'rivalry' as const, title: 'ALL SQUARE', text: `Series tied with ${c.name} — ${c.wins}–${c.losses}` };
      if (!hubCelebrations.enqueue(item)) continue;
      const mode = celebrationPresentation(item, { governorLevel: perfGovernor.level, reducedMotion: reduceFx || fx.osReducedMotion });
      if (mode !== 'instant') setSquareCelebrated((m) => ({ ...m, [c.id]: mode }));
    }
  }, [cards, reduceFx]);
  /** Run It Back: invite the rival (and any other opposing name from the
   *  anchored feed row that is online now) to a table under the SAME mode
   *  the feed recorded, via the existing invite machinery. Only rendered
   *  when runItBackMode is known — never a guessed mode. */
  const runItBack = async (card: RivalryCard) => {
    const mode = card.runItBackMode;
    if (!mode) return;
    const others = card.lastMeetingOpponents
      .filter((n) => n !== card.name)
      .map((n) => Object.values(s.users).find((u) => !u.guest && u.name === n)?.id)
      .filter((x): x is string => !!x);
    /* The current table only hosts the re-run when it plays the SAME
     * mode (cutthroat spellings aside) — otherwise the card's copy
     * ("re-runs: <mode>") would promise a mode the table isn't running,
     * so a fresh table carries the invite instead. */
    const sameMode = (a: string | undefined, b: string) => !!a && (a === b || (a.startsWith('cutthroat') && b.startsWith('cutthroat')));
    try {
      if (s.myTable && sameMode(s.myTable.mode, mode)) {
        social.invite(card.id, s.myTable);
        for (const o of others) social.invite(o, s.myTable);
        return;
      }
      const code = await createTable(serverUrl());
      try { sessionStorage.setItem(`bwm.created.${code}`, '1'); } catch { /* ignore */ }
      const seat = mode === 'joker' || mode === 'aceDown' ? 2 : 1;
      social.invite(card.id, { code, mode, seat, open: 3 });
      for (const o of others) social.invite(o, { code, mode, seat, open: 3 });
      social.close();
      navigate(`/t/${code}`);
    } catch { social.toast("Couldn't create a table. Try again.", 'error'); }
  };
  return (
    <section className="matchup-section" data-testid="matchup-rivalries">
      <h3>Rivalries</h3>
      {!signedIn ? <p className="soc-muted">Sign in to see your rivalries.</p>
        : profileQ.data && !cards.length ? <p className="soc-muted">No recorded rivalries yet — your head-to-head series show up here once you have played someone.</p>
        : !profileQ.data ? <p className="soc-muted">Loading…</p>
        : (
          <ul className="rivalry-list">
            {cards.map((c) => (
              <li key={c.id} className="rivalry-card" data-testid={`rivalry-card-${c.name}`}>
                <div className="power-head">
                  <button type="button" className="link" onClick={() => social.showProfile(c.name, c.id)}>{c.name}</button>
                  {c.tied
                    ? <span className={`rivalry-tied${squareCelebrated[c.id] ? ` celebrating-${squareCelebrated[c.id]}` : ''}`} data-testid={`rivalry-tied-${c.name}`}>ALL SQUARE</span>
                    : <span className="soc-muted">{c.leaderName === myName ? `You lead ${c.wins}–${c.losses}` : `${c.name} leads ${c.losses}–${c.wins}`}</span>}
                </div>
                <p className="soc-muted rivalry-line">
                  Series {c.wins}–{c.losses} · Win {c.winPct === null ? '—' : `${c.winPct}%`} · {c.games} game{c.games === 1 ? '' : 's'}
                  {c.lastMeeting && <> · Last meeting {timeLabel(c.lastMeeting.at)}</>}
                </p>
                <div className="rivalry-acts">
                  <button type="button" onClick={() => social.showProfile(c.name, c.id)}>Profile</button>
                  <button type="button" onClick={() => social.openCompare(c.name, c.id)} data-testid={`rivalry-compare-${c.name}`}>Compare</button>
                  <ChallengeButton name={c.name} />
                  {c.runItBackMode && (
                    <button type="button" className="primary" data-testid={`rivalry-run-it-back-${c.name}`} onClick={() => void runItBack(c)}>↩ Run It Back</button>
                  )}
                </div>
                {c.runItBackMode && (
                  <p className="soc-muted rivalry-rerun">Re-runs your last meeting: {headlineModeLabel(c.runItBackMode)} vs {c.lastMeetingOpponents.join(' + ')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

/** Challenge surfacing for Matchups: the caller's pending incoming table
 *  invites (Accept/Decline, the store's existing actions) and the invites
 *  they have sent, with their state. No new send paths — replyInvite and
 *  the store's sent map are the whole surface. */
function MatchupChallenges() {
  const s = useSocial();
  const sent = Object.entries(s.sent).map(([id, v]) => ({ id, ...v }));
  return (
    <section className="matchup-section" data-testid="matchup-challenges">
      <h3>Challenges</h3>
      {s.invites.map((inv) => (
        <div key={inv.id} className="matchup-invite" data-testid={`matchup-invite-${inv.id}`}>
          <span><b>{inv.fromName}</b> invited you to {inv.kind === 'story-coop' ? 'Story Mode co-op' : `${headlineModeLabel(inv.mode)} · table ${inv.code}`}</span>
          <span className="favorite-acts">
            <button type="button" onClick={() => social.replyInvite(inv, false)} data-testid={`matchup-invite-decline-${inv.id}`}>Decline</button>
            <button type="button" className="primary" onClick={() => acceptInvite(inv)} data-testid={`matchup-invite-accept-${inv.id}`}>Accept</button>
          </span>
        </div>
      ))}
      {sent.map((v) => (
        <p key={v.id} className="soc-muted matchup-sent" data-testid={`matchup-sent-${v.id}`}>
          Invite to {s.users[v.to]?.name ?? s.names[v.to] ?? 'a player'} — Sent · waiting (expires {timeLabel(v.expiresAt)})
        </p>
      ))}
      {!s.invites.length && !sent.length && <p className="soc-muted">No pending invites right now.</p>}
    </section>
  );
}

export function MatchupsHome({ signedIn }: { signedIn: boolean }) {
  const s = useSocial();
  const recentQ = useFetch<{ players: RecentPlayer[] }>(signedIn ? '/api/social/recent' : null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const friends = s.friends?.friends ?? [];
  const recent = arr<RecentPlayer>(recentQ.data?.players);
  const search = async (e: FormEvent) => {
    e.preventDefault();
    const name = q.trim();
    if (!name) return;
    setBusy(true); setErr(null);
    try {
      const j = await get(`/api/social/profile/${encodeURIComponent(name)}`);
      social.showProfile((j as { username?: string }).username ?? name);
    } catch { setErr(`No player named ${name}.`); }
    finally { setBusy(false); }
  };
  const pickerRow = (id: string | undefined, name: string, sub?: string) => (
    <li key={`${id ?? name}`}>
      <button type="button" className="matchup-pick" data-testid={`matchup-pick-${name}`} onClick={() => social.showProfile(name, id)}>
        <span>{name}</span>{sub && <small className="soc-muted">{sub}</small>}
      </button>
    </li>
  );
  return (
    <div className="central-matchups" data-testid="central-matchups">
      <section className="matchup-picker">
        <h3>Find a matchup</h3>
        <p className="soc-muted">Open a player to see their profile — the Compare on it lines the two of you up stat by stat.</p>
        <form className="matchup-search" onSubmit={search}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name…" aria-label="Search players by name" data-testid="matchup-search" />
          <button type="submit" className="primary" disabled={busy || !q.trim()} data-testid="matchup-search-go">Find</button>
        </form>
        {err && <p className="soc-err" data-testid="matchup-search-err">{err}</p>}
        {friends.length > 0 && (
          <>
            <h4>Friends</h4>
            <ul className="matchup-list">{friends.map((f) => pickerRow(f.id, f.name))}</ul>
          </>
        )}
        {recent.length > 0 && (
          <>
            <h4>Recent players</h4>
            <ul className="matchup-list">{recent.map((p) => pickerRow(p.id, p.name, `${p.games} game${p.games === 1 ? '' : 's'} together${p.partner ? ' · partner' : ''}`))}</ul>
          </>
        )}
        {!friends.length && !recent.length && (
          <p className="soc-muted">{signedIn ? 'No friends or recent players yet — search a name above.' : 'Sign in to pick from friends and recent players, or search a name above.'}</p>
        )}
      </section>
      <Rivalries signedIn={signedIn} />
      <MatchupChallenges />
      <section className="matchup-section">
        <h3>🏆 Tournaments</h3>
        <Tournaments signedIn={signedIn} />
      </section>
      <section className="matchup-section">
        <h3>🏦 Big Bank challenges</h3>
        <WagerChallenges signedIn={signedIn} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------- match view */

const STAT_FIELDS: [string, string][] = [
  ['books', 'Books'], ['bids', 'Bids'], ['made', 'Contracts made'], ['set', 'Times set'],
  ['bags', 'Bags'], ['nilBids', 'Nils bid'], ['nilMade', 'Nils made'], ['bestRun', 'Best run'], ['maxBooksHand', 'Best hand (books)'],
];

export function MatchView({ id }: { id: string }) {
  const s = useSocial();
  const q = useFetch<MatchPayload>(`/api/social/match/${encodeURIComponent(id)}`);
  if (!q.data) {
    return (
      <div className="match-view" data-testid="match-view">
        <button type="button" className="link" onClick={() => social.dest('matchups')}>← Matchups</button>
        <p className="soc-empty">{q.failed
          ? "This match isn't available — it may have been played before match records existed, or the record couldn't be loaded."
          : 'Loading…'}</p>
      </div>
    );
  }
  const { game, players, timeline } = q.data;
  if (!game || game.final == null || !Array.isArray(game.winners) || !Array.isArray(players) || !Array.isArray(timeline)) {
    // A 200 with the wrong shape is as unavailable as a failed fetch
    // (crash hardening): show the same state instead of throwing here.
    return (
      <div className="match-view" data-testid="match-view">
        <button type="button" className="link" onClick={() => social.dest('matchups')}>← Matchups</button>
        <p className="soc-empty">{"This match isn't available — it may have been played before match records existed, or the record couldn't be loaded."}</p>
      </div>
    );
  }
  const finals = finalScores(game.final);
  const points = matchTimelinePoints(timeline);
  const turning = matchTurning(timeline);
  const nameOf = (p: MatchPayload['players'][number]): string =>
    (p as { name?: string | null }).name
    ?? s.names[p.userId] ?? s.names[`u:${p.userId}`] ?? s.users[`u:${p.userId}`]?.name ?? s.users[p.userId]?.name
    ?? game.seats?.[p.seat]?.name
    ?? p.teamName ?? `Seat ${p.seat + 1}`;
  const sideLabel = (side: number): string => {
    const names = players.filter((p) => p.side === side).map(nameOf);
    return names.length ? names.join(' + ') : `Side ${side + 1}`;
  };
  return (
    <div className="match-view" data-testid="match-view">
      <button type="button" className="link" onClick={() => social.dest('matchups')}>← Matchups</button>
      <div className="power-head">
        <h3>{MODE_LABEL[game.mode] ?? game.mode} · {game.kind === 'cutthroat' ? 'Cutthroat' : 'Partnership'}</h3>
        <span className="soc-muted">{timeLabel(game.endedAt)}{game.rated ? ' · Rated' : ''} · {game.hands} hand{game.hands === 1 ? '' : 's'}</span>
      </div>
      <table className="cmp-table match-final" data-testid="match-final">
        <tbody>
          {finals.map((score, side) => (
            <tr key={side} className={game.winners.includes(side) ? 'match-winner' : ''}>
              <th>{sideLabel(side)}{game.winners.includes(side) ? ' 🏆' : ''}</th>
              <td>{score}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {turning.swing && !turning.wireToWire ? (
        <p className="match-turning" data-testid="match-turning">Turning point: biggest swing — Hand {turning.swing.hand}, {Math.abs(turning.swing.delta)} points</p>
      ) : turning.wireToWire ? (
        <p className="match-turning" data-testid="match-turning">No turning point — one side led wire to wire.</p>
      ) : null}
      {turning.leadChangeHand !== null && turning.swing && turning.leadChangeHand !== turning.swing.hand && (
        <p className="soc-muted" data-testid="match-lead-change">Final lead change — Hand {turning.leadChangeHand}</p>
      )}
      {points.length > 0 && (
        <>
          <h4>Score by hand</h4>
          <table className="cmp-table match-timeline" data-testid="match-timeline">
            <thead><tr><th>Hand</th>{finals.map((_, side) => <th key={side}>{sideLabel(side)}</th>)}</tr></thead>
            <tbody>
              {points.map((pt) => (
                <tr key={pt.hand}><th>{pt.hand}</th>{pt.scores.map((v, i) => <td key={i}>{v}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h4>Players</h4>
      <div className="match-players">
        {players.map((p) => (
          <section key={`${p.userId}-${p.seat}`} className="match-player" data-testid={`match-player-${p.seat}`}>
            <div className="power-head">
              <button type="button" className="link" onClick={() => social.showProfile(nameOf(p), p.userId)}>{nameOf(p)}</button>
              <span className="soc-muted">{p.won ? 'Won' : 'Lost'} · Seat {p.seat + 1}{p.teamName ? ` · ${p.teamName}` : ''}</span>
            </div>
            <table className="cmp-table">
              <tbody>
                {STAT_FIELDS.map(([key, label]) => (
                  <tr key={key}><th>{label}</th><td>{statCell(p.stats, key)}</td></tr>
                ))}
                <tr><th>Rating</th><td>{p.eloBefore != null && p.eloAfter != null ? `${p.eloBefore} → ${p.eloAfter}` : '—'}</td></tr>
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}
