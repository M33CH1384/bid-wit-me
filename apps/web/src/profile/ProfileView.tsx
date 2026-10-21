/**
 * THE profile (Demetrius 2026-10-20): "I really don't get why we have a rep
 * profile and then a completely separate profile page if I tap on my name from
 * the players menu — it's confusing and bad user experience."
 *
 * There is exactly ONE full-profile implementation now — this component — and
 * every entry point lands on it: the Account REP PROFILE button (the /profile
 * route), Players / Friends / Ranks rows, profile-picture taps outside a game,
 * DM and chat name taps, head-to-head name taps. Two hosts render it (the
 * /profile route as a page, the Social panel as its profile view) and the ONLY
 * differences between hosts are the surrounding chrome (page bar vs panel
 * Back) — the profile itself, header and body alike, is the same component
 * fed by the same endpoints, so the surfaces cannot drift apart again.
 *
 * Data (no new endpoints, nothing invented):
 *  - /api/social/profile/:name — the social record: member-since, totals,
 *    social-record stats, badges, team names, head-to-head, champion awards.
 *    Public for any named player.
 *  - /api/profile/:id (public) — Rep: level/XP, full season rating (number,
 *    record, peak, leaderboard place), cred stats, achievements, coins,
 *    social links. Full ratings/stats ARE public; the Stats tab works for
 *    other players unchanged.
 *  - /api/profile/me (self only) — the same payload PLUS challenges and
 *    unlocks, which the server keeps private. The Challenges and Unlocks tabs
 *    therefore exist for your own profile only — a data difference, not a
 *    UI divergence: one code path, tabs derive from what the payload carries.
 *
 * Header (one markup for self and others, both hosts): picture, name,
 * member-since, tagline, presence line, the shared RepBlock (Level + title,
 * XP bar, both division chips, drawn-coin balance) — then the one-line action
 * row for other players, or the edit affordances (picture, tagline, social
 * links) for your own profile — and even those stay hidden behind a single
 * Edit profile button (Demetrius 2026-10-20: "All of this should be hidden.
 * There should be an edit profile button to change any of this if a user so
 * chooses"), so the profile's face is display-only. Body: the tabbed
 * structure (Challenges / Stats / Achievements / Unlocks — the old Rank tab
 * folded into the top of Stats, owner 2026-10-20) with the
 * social record folded in — the
 * games/wins summary and social stats live in Stats, badges and champion
 * awards in Achievements. Zero content lost, zero duplicated.
 *
 * The in-game profile modal (ProfileModal.tsx) is NOT this component: it
 * stays the compact quick-peek card the owner approved, sharing the header
 * components (RepBlock, AvatarCircle, presenceLine) with this view.
 */
import { useEffect, useRef, useState } from 'react';
import { presenceLine } from '@spades/protocol';
import { useAccount } from '../account/api';
import { accountUidOf, AvatarCircle, compressAvatarFile, forgetAvatar, useAvatar, validateAvatarDataUrl } from '../avatar';
import { BADGES } from '../badges';
import { offlineStats } from '../offlineStats';
import { RepBlock } from '../RepBlock';
import { TaglineText } from '../tagline';
import { SOCIAL_PLATFORMS, SocialLinksChips, type SocialLinks } from '../socialLinks';
import { MODE_NAME, inviteTo } from '../social/Social';
import { social, useSocial } from '../social/store';
import { ChallengeButton } from '../social/Wager';

const modeName = (m: string) => MODE_NAME[m] ?? m;

/* ------------------------------------------------------------ data shapes */

/** The payload's division id — internal band logic only. No user-facing
 *  surface renders a division name anymore (owner, 2026-10-20: rankings are
 *  metric-based, "not some corny names"), so there is deliberately no label
 *  map here. */
type Division = 'stoop' | 'corner' | 'block' | 'avenue' | 'boulevard' | 'legend';

interface SeasonRank { division: Division; elo: number; games: number; wins: number; losses: number; peak: number; rank: number; of: number }
interface Challenge { id: string; title: string; metric: string; target: number; progress: number; xp: number; coins: number; claimed: boolean }
interface Achievement { id: string; title: string; hint: string; xp: number; coins: number; unlockedAt: number | null }
interface Unlock { itemId: string; source: string; unlockedAt: number; slot: string | null; equipped: boolean }

/** The cred payload, normalized: /api/profile/me and /api/profile/:id share the
 *  shape; challenges/unlocks only exist on the /me payload. */
interface CredData {
  user: { id: string; name: string; avatar: string | null; avatarUpdatedAt: number | null; tagline: string | null; socialLinks: SocialLinks; region: string | null };
  level: { level: number; xp: number; title: string; xpForNext: number; xpIntoLevel: number };
  season?: { id: string; name: string; endsAt: number };
  rank: { team: SeasonRank; cutthroat: SeasonRank };
  stats: { team: Record<string, number | string | null>; cutthroat: Record<string, number | string | null> };
  challenges?: { daily: Challenge[]; weekly: Challenge[] };
  achievements: Achievement[];
  unlocks?: Unlock[];
  coins: { balance: number };
}

/** The social-record payload (/api/social/profile/:name). */
interface SocialProfileData {
  id?: string; avatar?: string | null;
  username: string; memberSince: number; tagline?: string | null; region?: string | null; badges: { id: string; earnedAt: number }[]; teamNames: string[];
  ratings: { team?: number; cutthroat?: number }; totals: { games: number; wins: number };
  h2h: { id: string; name: string; games: number; wins: number; losses: number }[]; vsYou?: { games: number; wins: number; losses: number }; champion: number;
  stats?: { games: number; wins: number; streak: number; bestStreak: number; accuracy: number | null; booksPerHand: number | null; nil: string; shotsGiven: number; shotsTaken: number; wheels: number; bjWins: number; bidSec: number | null; playSec: number | null };
  awards?: { label: string; ref: string; at: number }[];
}

type Tab = 'challenges' | 'stats' | 'achievements' | 'unlocks';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  // Same-origin via the Pages Function /api proxy (first-party cookies work in Safari).
  // Do NOT use serverUrl() here — cross-site fetch to workers.dev gets third-party-cookie blocked.
  const r = await fetch(path, { credentials: 'include', ...init });
  if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/* --------------------------------------------------------- body fragments */

/** A rating card — ESPN player-header vitals, plain language only (owner,
 *  2026-10-20: "no one knows what elo is including me", and no named tiers):
 *  the big number is the Rating, the rows are metrics anyone can read. */
/**
 * The profile's Rivalry (league P-F): the most-played opponent from the
 * head-to-head payload; ties go to the closest series (smallest |W−L|).
 * The record reads from the profile subject's side, like the h2h table.
 */
export function topRivalry(h2h: { name: string; games: number; wins: number; losses: number }[]): { name: string; games: number; wins: number; losses: number } | null {
  if (!h2h.length) return null;
  return [...h2h].sort((a, b) => b.games - a.games || Math.abs(a.wins - a.losses) - Math.abs(b.wins - b.losses))[0]!;
}

interface HonorT { id: string; label: string; userId: string; name: string; value: string }

/** League awards this player currently holds (league P-F), from
 *  /api/social/honors — season honors computed server-side from real stats. */
function LeagueAwards({ userId }: { userId: string }) {
  const [held, setHeld] = useState<HonorT[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/social/honors', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('no'))))
      .then((j: { awards: HonorT[] }) => { if (alive) setHeld(j.awards.filter((a) => a.userId === userId)); })
      .catch(() => { if (alive) setHeld([]); });
    return () => { alive = false; };
  }, [userId]);
  if (!held?.length) return null;
  return (
    <>
      <h4>League awards</h4>
      <div className="soc-badges" data-testid="league-awards">
        {held.map((a) => <span key={a.id} className="soc-badge-chip" title={a.value}>🏅 {a.label} — {a.value}</span>)}
      </div>
    </>
  );
}

/**
 * Profile compare (league P-C): your public line vs theirs, category by
 * category, the better number marked. Both sides come from the SAME payload
 * shape — their social profile and yours — so every row is apples-to-apples.
 * Only categories both payloads honestly carry; a missing value shows '—'
 * and never wins a row.
 */
function CompareBlock({ them, myName }: { them: SocialProfileData; myName: string }) {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState<SocialProfileData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || mine || failed) return;
    let alive = true;
    fetch(`/api/social/profile/${encodeURIComponent(myName)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('missing'))))
      .then((j) => { if (alive) setMine(j as SocialProfileData); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [open, mine, failed, myName]);

  const pct = (w: number, g: number) => (g ? Math.round((w / g) * 1000) / 10 : null);
  const nilMade = (s?: string) => { const n = Number(String(s ?? '').split('/')[0]); return Number.isFinite(n) ? n : null; };
  const rows: { label: string; a: number | null; b: number | null; fmt: (n: number) => string }[] = [];
  if (mine?.stats && them.stats) {
    const ms = mine.stats; const ts = them.stats;
    const whole = (n: number) => String(Math.round(n));
    rows.push(
      { label: 'Partnership rating', a: mine.ratings.team ?? null, b: them.ratings.team ?? null, fmt: whole },
      { label: 'Cutthroat rating', a: mine.ratings.cutthroat ?? null, b: them.ratings.cutthroat ?? null, fmt: whole },
      { label: 'Games', a: ms.games, b: ts.games, fmt: whole },
      { label: 'Wins', a: ms.wins, b: ts.wins, fmt: whole },
      { label: 'Win %', a: pct(ms.wins, ms.games), b: pct(ts.wins, ts.games), fmt: (n) => `${n}%` },
      { label: 'Current streak', a: ms.streak, b: ts.streak, fmt: (n) => (n > 0 ? `W${n}` : '—') },
      { label: 'Best streak', a: ms.bestStreak, b: ts.bestStreak, fmt: whole },
      { label: 'Bid accuracy', a: ms.accuracy, b: ts.accuracy, fmt: (n) => `${n}%` },
      { label: 'Books / hand', a: ms.booksPerHand, b: ts.booksPerHand, fmt: (n) => n.toFixed(2) },
      { label: 'Nils made', a: nilMade(ms.nil), b: nilMade(ts.nil), fmt: whole },
      { label: 'Wheels', a: ms.wheels, b: ts.wheels, fmt: whole },
      { label: 'Bostons', a: ms.bjWins, b: ts.bjWins, fmt: whole },
    );
  }
  return (
    <div className="cmp-wrap">
      <button type="button" className="prof-pic-btn" data-testid="compare-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide compare' : 'Compare with you'}
      </button>
      {open && (failed ? <p className="soc-empty">Couldn’t load your stats to compare.</p>
        : !mine ? <p className="soc-empty">Loading…</p>
        : !rows.length ? <p className="soc-empty">Not enough stats on both sides to compare yet.</p>
        : (
          <table className="cmp-table" data-testid="compare-table">
            <thead><tr><th></th><th>You</th><th>{them.username}</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const winA = r.a !== null && r.b !== null && r.a > r.b;
                const winB = r.a !== null && r.b !== null && r.b > r.a;
                return (
                  <tr key={r.label}>
                    <th>{r.label}</th>
                    <td className={winA ? 'cmp-win' : ''}>{r.a === null ? '—' : r.fmt(r.a)}</td>
                    <td className={winB ? 'cmp-win' : ''}>{r.b === null ? '—' : r.fmt(r.b)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
    </div>
  );
}

function RankCard({ title, rank }: { title: string; rank: SeasonRank }) {
  return (
    <div className="rank-card glass">
      <div className="rank-head"><h3>{title}</h3></div>
      <div className="rank-elo">{rank.elo}<small>Rating</small></div>
      <div className="rank-rows">
        <div><span>This season</span><b>{rank.wins} win{rank.wins === 1 ? '' : 's'} – {rank.losses} loss{rank.losses === 1 ? '' : 'es'}</b></div>
        <div><span>Leaderboard</span><b>#{rank.rank} of {rank.of} players</b></div>
        <div><span>Best rating</span><b>{rank.peak}</b></div>
        <div><span>Rated games</span><b>{rank.games}</b></div>
      </div>
    </div>
  );
}

function ChallengeRow({ c, onClaim }: { c: Challenge; onClaim: (id: string) => void }) {
  const done = c.progress >= c.target;
  const pct = Math.min(100, Math.round((c.progress / Math.max(1, c.target)) * 100));
  return (
    <div className={`challenge ${done ? 'done' : ''}`}>
      <div className="ch-main">
        <b>{c.title}</b>
        <div className="ch-bar"><i style={{ width: `${pct}%` }} /></div>
        <small>{Math.min(c.progress, c.target)}/{c.target} · +{c.xp} XP{c.coins ? ` · +${c.coins} coins` : ''}</small>
      </div>
      {done && !c.claimed && <button type="button" className="primary small" onClick={() => onClaim(c.id)}>Claim</button>}
      {c.claimed && <span className="ch-claimed">Claimed</span>}
    </div>
  );
}

const STAT_LABELS: Record<string, string> = {
  games: 'Games', wins: 'Wins', streak: 'Win streak', bestStreak: 'Best streak',
  accuracy: 'Bid accuracy', bags: 'Bags', booksPerHand: 'Books/hand', nil: 'Nil made',
  shotsGiven: 'Shots given', shotsTaken: 'Shots taken', wheels: 'Wheels', bjWins: 'Blackjack wins',
  winsVsPlayers: 'Wins vs players', winsVsBots: 'Wins vs bots',
};

/** ESPN-style stat table (owner, 2026-10-20: stats should look "like looking
 *  at ESPN but for Spades players") — label left, number right, striped rows,
 *  no tiles, no fluff. Every stat the payload carries keeps its row. */
function StatsGrid({ stats }: { stats: Record<string, number | string | null> }) {
  const rows = Object.entries(STAT_LABELS).filter(([k]) => stats[k] !== undefined && stats[k] !== null);
  return (
    <div className="stat-table">
      {rows.map(([k, label]) => (
        <div key={k} className="stat-row"><span>{label}</span><b>{String(stats[k])}</b></div>
      ))}
    </div>
  );
}

/** One stat-table row set for the online record — same table language. */
function StatRows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="stat-table">
      {rows.map(([label, value]) => (
        <div key={label} className="stat-row"><span>{label}</span><b>{value}</b></div>
      ))}
    </div>
  );
}

/** Social-links editor: one row per platform; the server normalizes handles to
 *  canonical profile URLs and rejects anything that isn't really on the platform.
 *  It renders only inside Edit profile mode (Demetrius 2026-10-20: the whole
 *  editor stack — picture, tagline, links — hides behind the one Edit profile
 *  button; the old separate Edit-links collapse is subsumed by that gate), so
 *  the inputs + Save show directly here. The saved links render as gold chips
 *  under the header in display mode. Cancel discards the draft back to the
 *  saved links. */
function SocialLinksEditor({ initial, onSaved }: { initial: SocialLinks; onSaved: () => void }) {
  const blank = () => {
    const d: Record<string, string> = {};
    for (const p of SOCIAL_PLATFORMS) d[p.id] = initial[p.id] ?? '';
    return d;
  };
  const [draft, setDraft] = useState<Record<string, string>>(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dirty = SOCIAL_PLATFORMS.some((p) => (draft[p.id] ?? '') !== (initial[p.id] ?? ''));

  const cancel = () => { setDraft(blank()); setErr(null); };

  const save = async () => {
    setErr(null); setBusy(true);
    try {
      await api<{ ok: boolean; socialLinks: SocialLinks }>('/api/profile/me/social-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ links: draft }),
      });
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="prof-links-edit">
      <span className="prof-pic-note">Social links — these link to your public profiles and show on your profile for other players.</span>
      {SOCIAL_PLATFORMS.map((p) => (
        <label key={p.id} className="prof-link-row">
          <span className="prof-link-name"><span aria-hidden>{p.glyph}</span> {p.label}</span>
          <input type="text" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false}
            data-testid={`social-input-${p.id}`} placeholder={p.hint} value={draft[p.id] ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, [p.id]: e.target.value }))} />
        </label>
      ))}
      <div className="prof-link-actions">
        <button type="button" className="prof-pic-btn" data-testid="social-save" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save links'}
        </button>
        <button type="button" className="prof-pic-btn ghost" data-testid="social-cancel" disabled={busy} onClick={cancel}>Cancel</button>
        {err && <span className="prof-pic-err" role="alert">{err}</span>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- the view */

export function ProfileView({ host, name, id }: {
  /** 'page' = the /profile route; 'panel' = the Social panel's profile view */
  host: 'panel' | 'page';
  /** subject username; omit on the page host for your own profile (identity comes from /api/profile/me) */
  name?: string;
  /** social pid or raw account id when the caller knew it (panel rows carry ids) */
  id?: string;
}) {
  const s = useSocial();
  const acct = useAccount();
  const selfRoute = host === 'page' && !name;
  const [tab, setTab] = useState<Tab>('stats');
  const [p, setP] = useState<SocialProfileData | null | 'missing'>(null);
  const [cred, setCred] = useState<CredData | null>(null);
  const [credErr, setCredErr] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((t) => t + 1);
  // Profile picture (Demetrius 2026-10-19): upload stands in for the camera at the table.
  const [uploading, setUploading] = useState(false);
  const [picBusy, setPicBusy] = useState(false);
  const [picErr, setPicErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Edit profile gate (Demetrius 2026-10-20): false = the profile is a
  // profile — header + tabs, zero editor UI. True = the full editor stack
  // (picture, tagline, social links) shows under the header.
  const [editing, setEditing] = useState(false);
  // Tagline (Demetrius 2026-10-20): null draft = untouched, showing the saved line.
  const [tagDraft, setTagDraft] = useState<string | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagErr, setTagErr] = useState<string | null>(null);
  const [regionDraft, setRegionDraft] = useState<string | null>(null);
  const [regionBusy, setRegionBusy] = useState(false);
  const [regionErr, setRegionErr] = useState<string | null>(null);

  const subjectName = name ?? (selfRoute ? cred?.user.name : undefined);

  /* The social record: public for any named player, self included. */
  useEffect(() => {
    if (!subjectName) return;
    let alive = true;
    setP(null);
    fetch(`/api/social/profile/${encodeURIComponent(subjectName)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : 'missing'))
      .then((j) => { if (alive) setP(j as SocialProfileData | 'missing'); })
      .catch(() => { if (alive) setP('missing'); });
    return () => { alive = false; };
  }, [subjectName, reloadTick]);

  // pid is a SOCIAL id ('u:<uid>', or raw '<uid>' from the chat name tap) — hub actions
  // (DMs, invites, presence) speak that form, but /api/profile/:id looks the user up by
  // the RAW account id. Fetching with a 'u:'-prefixed pid 404s, which silently cost the
  // old Social view its picture, Rep and achievements (2026-10-20). Always normalize
  // first; the social payload's own id covers name-only opens (offline, not a friend).
  const pid = id ?? (p && p !== 'missing'
    ? Object.values(s.users).find((u) => !u.guest && u.name === p.username)?.id
      ?? [...(s.friends?.friends ?? []), ...(s.friends?.incoming ?? []), ...(s.friends?.outgoing ?? []), ...(s.friends?.blocked ?? [])].find((f) => f.name === p.username)?.id
    : undefined);
  const uid = accountUidOf(pid) ?? (p && p !== 'missing' ? p.id : undefined) ?? (selfRoute ? cred?.user.id : undefined);
  const me = selfRoute
    ? cred !== null
    : (!!uid && !!acct.user && acct.user.id === uid) || (!!acct.user?.username && !!subjectName && acct.user.username === subjectName);

  /* The Rep payload: /me for self (the superset — challenges + unlocks ride
   *  along), the public /:id for everyone else. */
  const lastUidRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (selfRoute) {
      setCredErr(null);
      api<CredData>('/api/profile/me').then(setCred).catch((e: Error) => setCredErr(e.message));
      return;
    }
    if (!uid) return;
    let alive = true;
    if (lastUidRef.current !== uid) { lastUidRef.current = uid; setCred(null); }
    fetch(me ? '/api/profile/me' : `/api/profile/${encodeURIComponent(uid)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setCred(j as CredData | null); })
      .catch(() => { if (alive) setCred(null); });
    return () => { alive = false; };
  }, [selfRoute, uid, me, reloadTick]);

  // The header picture resolves the same way chat faces do (useAvatar → /api/profile/:id,
  // cached), seeded by whichever payload already carries it — so the photo shows even if
  // one of the two fetches fails.
  const pic = useAvatar(uid, cred?.user.avatar ?? (p && p !== 'missing' ? p.avatar : undefined), cred?.user.avatarUpdatedAt ?? undefined);

  const friend = !!pid && (s.friends?.friends ?? []).some((f) => f.id === pid);
  const pending = !!pid && (s.friends?.outgoing ?? []).some((f) => f.id === pid);
  const incoming = !!pid && (s.friends?.incoming ?? []).some((f) => f.id === pid);
  const blocked = !!pid && (s.friends?.blocked ?? []).some((f) => f.id === pid);

  const presenceKey = pid ?? (uid ? `u:${uid}` : '');
  const presenceEntry = presenceKey ? s.users[presenceKey] : undefined;
  const displayName = (p && p !== 'missing' ? p.username : undefined) ?? cred?.user.name ?? subjectName ?? '';
  const memberSince = (p && p !== 'missing' ? p.memberSince : undefined) ?? (me ? acct.user?.createdAt : undefined);
  const tagline = (p && p !== 'missing' ? p.tagline : undefined) ?? cred?.user.tagline;

  /** open another player's profile from inside this one (head-to-head rows):
   *  the panel host just swaps its profile; the page host opens the panel over
   *  the page — the same unified view either way. */
  const openProfile = (n: string, i?: string) => {
    if (host === 'page') social.open();
    social.showProfile(n, i);
  };

  /* ------------------------------------------------ self-only edit flows */

  const onPickFile = async (file: File | undefined) => {
    if (!file || !cred) return;
    setPicErr(null); setUploading(true);
    try {
      const dataUrl = await compressAvatarFile(file);
      const v = validateAvatarDataUrl(dataUrl);
      if (!v.ok) throw new Error(v.error);
      setPicBusy(true);
      await api<{ ok: boolean }>('/api/profile/me/avatar', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dataUrl }),
      });
      // Drop this device's cached "no picture" for me (same as onRemovePic):
      // list faces resolve through the avatar cache, and a null cached before
      // this upload would otherwise keep the initial on my own rows.
      forgetAvatar(cred.user.id);
      reload();
    } catch (e) { setPicErr((e as Error).message); } finally { setUploading(false); setPicBusy(false); }
  };

  const onRemovePic = async () => {
    if (!cred || !confirm('Remove your profile picture?')) return;
    setPicErr(null); setPicBusy(true);
    try {
      await api<{ ok: boolean }>('/api/profile/me/avatar', { method: 'DELETE' });
      forgetAvatar(cred.user.id);
      reload();
    } catch (e) { setPicErr((e as Error).message); } finally { setPicBusy(false); }
  };

  const onSaveTagline = async () => {
    if (tagDraft === null) return;
    setTagErr(null); setTagBusy(true);
    try {
      await api<{ ok: boolean; tagline: string | null }>('/api/profile/me/tagline', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tagline: tagDraft }),
      });
      setTagDraft(null);
      reload();
    } catch (e) { setTagErr((e as Error).message); } finally { setTagBusy(false); }
  };

  const onSaveRegion = async () => {
    if (regionDraft === null) return;
    setRegionErr(null); setRegionBusy(true);
    try {
      await api<{ ok: boolean; region: string | null }>('/api/profile/me/region', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ region: regionDraft }),
      });
      setRegionDraft(null);
      reload();
    } catch (e) { setRegionErr((e as Error).message); } finally { setRegionBusy(false); }
  };

  const claim = async (cid: string) => {
    setClaiming(cid); setClaimErr(null);
    try {
      await api<{ ok: boolean }>('/api/challenges/' + cid + '/claim', { method: 'POST' });
      reload();
    } catch (e) { setClaimErr((e as Error).message); } finally { setClaiming(null); }
  };

  /* ------------------------------------------------------------ states */

  if (selfRoute && credErr) {
    return (
      <div className="profile-page profile-view">
        <header className="prof-bar"><button type="button" className="back-chip" onClick={() => history.back()}>← BACK</button></header>
        <div className="prof-error"><p>{credErr}</p>{credErr.includes('sign') || credErr.includes('auth') ? <p>Sign in to view your Rep profile.</p> : <button type="button" className="primary" onClick={reload}>Retry</button>}</div>
      </div>
    );
  }
  if (selfRoute && !cred) {
    return <div className="profile-page profile-view"><div className="prof-loading">Loading your Rep…</div></div>;
  }
  if (!selfRoute && p === null) {
    return host === 'panel'
      ? <div className="soc-profile profile-view" data-testid="profile"><button type="button" className="link" onClick={() => social.showProfile(null)} data-testid="profile-back">← Back</button><p className="soc-empty">Loading…</p></div>
      : <div className="profile-page profile-view"><div className="prof-loading">Loading…</div></div>;
  }
  if (!selfRoute && p === 'missing') {
    return host === 'panel'
      ? <div className="soc-profile profile-view" data-testid="profile"><button type="button" className="link" onClick={() => social.showProfile(null)} data-testid="profile-back">← Back</button><p className="soc-empty">No profile for {name}.</p></div>
      : <div className="profile-page profile-view"><div className="prof-error"><p>No profile for {name}.</p></div></div>;
  }

  const socialP = p && p !== 'missing' ? p : null;

  /* Tabs derive from the payload, never from the host or the subject:
   *  Challenges/Unlocks ride only on the self payload (the server keeps them
   *  private), Stats/Achievements merge both payloads. There is no Rank tab
   *  anymore (owner, 2026-10-20) — the rating cards live at the top of Stats. */
  const tabs: { id: Tab; label: string }[] = [];
  if (cred?.challenges) tabs.push({ id: 'challenges', label: 'Challenges' });
  if (cred || socialP) { tabs.push({ id: 'stats', label: 'Stats' }); tabs.push({ id: 'achievements', label: 'Achievements' }); }
  if (cred?.unlocks) tabs.push({ id: 'unlocks', label: 'Unlocks' });
  const activeTab: Tab = tabs.some((t) => t.id === tab) ? tab : (tabs[0]?.id ?? 'stats');
  const pendingClaims = cred?.challenges
    ? [...cred.challenges.daily, ...cred.challenges.weekly].filter((c) => c.progress >= c.target && !c.claimed).length
    : 0;
  const tagValue = tagDraft ?? cred?.user.tagline ?? '';
  const regionValue = regionDraft ?? cred?.user.region ?? '';
  /** Plain display region (league P-B): the social payload's, falling back to
   *  the cred payload on the self view. Unset = nothing shown, no fanfare. */
  const regionText = socialP?.region ?? (me ? cred?.user.region : undefined) ?? undefined;
  const rivalry = socialP ? topRivalry(socialP.h2h) : null;

  const content = (
    <>
      <div className="soc-prof-head">
        <AvatarCircle pic={pic} name={displayName} className="soc-av big" />
        <div>
          <h3 data-testid="profile-name">{displayName}{socialP && socialP.champion > 0 && <span className="soc-champ" title="Tournament champion">🏆×{socialP.champion}</span>}</h3>
          {memberSince !== undefined && <p className="soc-muted">Member since {new Date(memberSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>}
          <TaglineText text={tagline} className="soc-tagline" />
          <p className={`soc-online-status ${presenceEntry ? 'on' : 'off'}`} data-testid="profile-online">
            <i className="soc-dot" aria-hidden />{presenceEntry ? presenceLine(presenceEntry.status, modeName) : 'Offline'}
          </p>
          {regionText && <p className="soc-muted" data-testid="profile-region">Region: {regionText}</p>}
        </div>
        {cred && (
          <RepBlock testid="profile-rep" coinsTestid="profile-coins"
            level={cred.level} team={cred.rank.team} cutthroat={cred.rank.cutthroat} coins={cred.coins?.balance} />
        )}
        {!me && pid && (
          <div className="soc-prof-acts">
            {!blocked && <button type="button" onClick={() => { social.openDm(pid); if (host === 'page') social.open(); }}>💬 Chat</button>}
            {!blocked && s.users[pid] && <button type="button" onClick={() => void inviteTo(pid, s.myTable)}>➕ Invite</button>}
            {!blocked && <ChallengeButton name={displayName} blocked={blocked} />}
            {friend && <span className="soc-friend-tag" data-testid="profile-friends">★ Friends</span>}
            {incoming && !friend && !blocked && <button type="button" className="primary" onClick={() => social.friend('accept', pid)} data-testid="profile-accept">Accept request</button>}
            {incoming && !friend && !blocked && <button type="button" className="ghost" onClick={() => social.friend('decline', pid)} data-testid="profile-decline">Decline</button>}
            {!friend && !incoming && !blocked && <button type="button" disabled={pending} onClick={() => social.friend('request', pid)} data-testid="profile-add">{pending ? 'Requested' : '👋 Add friend'}</button>}
            {blocked ? <button type="button" onClick={() => social.friend('unblock', pid)}>Unblock</button> : <button type="button" className="ghost" onClick={() => { if (confirm(`Block ${displayName}? They won't see you online, can't message or invite you, and their chat is hidden.`)) social.friend('block', pid); }} data-testid="profile-block">Block</button>}
            <button type="button" className="ghost" onClick={() => social.report('user', { user: pid })}>Report</button>
          </div>
        )}
      </div>

      <SocialLinksChips links={cred?.user.socialLinks} testid="profile-social-links" />

      {me && cred && (
        <div className="prof-edit-toggle">
          <button type="button" className="prof-pic-btn" data-testid="profile-edit" aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}>
            {editing ? 'Done' : 'Edit profile'}
          </button>
        </div>
      )}

      {me && cred && editing && (
        <>
          {/* Profile picture: shows at the table when your camera is off (Demetrius 2026-10-19). */}
          <div className="prof-pic-row">
            <span className="prof-pic-note">Profile picture — other players see it when your camera is off.</span>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/*" hidden
              data-testid="avatar-file" onChange={(e) => { void onPickFile(e.target.files?.[0]); e.target.value = ''; }} />
            <button type="button" className="prof-pic-btn" data-testid="avatar-upload" disabled={uploading || picBusy} onClick={() => fileRef.current?.click()}>
              {uploading ? 'Working…' : cred.user.avatar ? 'Change picture' : 'Add a picture'}
            </button>
            {cred.user.avatar && (
              <button type="button" className="prof-pic-btn ghost" data-testid="avatar-remove" disabled={picBusy} onClick={() => void onRemovePic()}>Remove</button>
            )}
            {picErr && <span className="prof-pic-err" role="alert">{picErr}</span>}
          </div>

          {/* Tagline: a short line on your profile — links in it work (Demetrius 2026-10-20). */}
          <div className="prof-tag-row">
            <label className="prof-pic-note" htmlFor="prof-tagline-input">Tagline — shown on your profile. Links work.</label>
            <div className="prof-tag-edit">
              <input id="prof-tagline-input" data-testid="tagline-input" type="text" maxLength={140}
                placeholder="Say something about yourself…" value={tagValue}
                onChange={(e) => { setTagDraft(e.target.value); setTagErr(null); }} />
              <button type="button" className="prof-pic-btn" data-testid="tagline-save"
                disabled={tagBusy || tagDraft === null || tagValue === (cred.user.tagline ?? '')}
                onClick={() => void onSaveTagline()}>
                {tagBusy ? 'Saving…' : 'Save tagline'}
              </button>
            </div>
            <small className="prof-tag-count">{tagValue.length}/140 · clear it and save to remove</small>
            {tagErr && <span className="prof-pic-err" role="alert">{tagErr}</span>}
          </div>

          {/* Region: self-declared, powers the regional leaderboard (league P-B). */}
          <div className="prof-tag-row">
            <label className="prof-pic-note" htmlFor="prof-region-input">Region — your city or block. It powers your regional leaderboard.</label>
            <div className="prof-tag-edit">
              <input id="prof-region-input" data-testid="region-input" type="text" maxLength={24}
                placeholder="e.g. Harlem" value={regionValue}
                onChange={(e) => { setRegionDraft(e.target.value); setRegionErr(null); }} />
              <button type="button" className="prof-pic-btn" data-testid="region-save"
                disabled={regionBusy || regionDraft === null || regionValue === (cred.user.region ?? '')}
                onClick={() => void onSaveRegion()}>
                {regionBusy ? 'Saving…' : 'Save region'}
              </button>
            </div>
            <small className="prof-tag-count">{regionValue.length}/24 · clear it and save to remove</small>
            {regionErr && <span className="prof-pic-err" role="alert">{regionErr}</span>}
          </div>

          {/* Social links: public profile links on fixed platforms, server-normalized (Demetrius 2026-10-20). */}
          <SocialLinksEditor key={JSON.stringify(cred.user.socialLinks)} initial={cred.user.socialLinks} onSaved={reload} />
        </>
      )}
      <nav className="prof-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={activeTab === t.id} className={activeTab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}{t.id === 'challenges' && pendingClaims > 0 && <i className="tab-dot">{pendingClaims}</i>}
          </button>
        ))}
      </nav>

      <main className="prof-body">
        {activeTab === 'challenges' && cred?.challenges && (() => {
          const all = [...cred.challenges.daily, ...cred.challenges.weekly];
          const earnedXp = all.filter((c) => c.claimed).reduce((sum, c) => sum + c.xp, 0);
          const earnedCoins = all.filter((c) => c.claimed).reduce((sum, c) => sum + (c.coins ?? 0), 0);
          return (
            <>
              {(earnedXp > 0 || earnedCoins > 0) && (
                <p className="ch-earned" data-testid="challenges-earned">Earned: <b>{earnedXp} XP</b>{earnedCoins > 0 && <> · <b>{earnedCoins} coins</b></>}</p>
              )}
              <h3>Daily</h3>
              {cred.challenges.daily.map((c) => <ChallengeRow key={c.id} c={c} onClaim={claim} />)}
              <h3>Weekly</h3>
              {cred.challenges.weekly.map((c) => <ChallengeRow key={c.id} c={c} onClaim={claim} />)}
              {claiming && <p className="ch-claiming">Claiming…</p>}
              {claimErr && <span className="prof-pic-err" role="alert">{claimErr}</span>}
            </>
          );
        })()}
        {activeTab === 'stats' && (
          <>
            {!me && socialP && acct.user?.username && <CompareBlock them={socialP} myName={acct.user.username} />}
            {cred && (
              <>
                <p className="rank-explainer" data-testid="rating-explainer">Rating starts at 1,200. Win rated games to raise it, lose and it drops — beating stronger players moves it more.</p>
                <div className="rank-cards">
                  <RankCard title="Partnership" rank={cred.rank.team} />
                  <RankCard title="Cutthroat" rank={cred.rank.cutthroat} />
                </div>
              </>
            )}
            {socialP && (
              <div className="soc-stats wins-summary">
                <div><b>{socialP.totals.games}</b><small>online games</small></div>
                <div><b>{socialP.totals.games ? Math.round((socialP.totals.wins / socialP.totals.games) * 100) : 0}%</b><small>wins</small></div>
              </div>
            )}
            {cred && (
              <>
                <h3>Partnership</h3><StatsGrid stats={cred.stats.team} />
                <h3>Cutthroat</h3><StatsGrid stats={cred.stats.cutthroat} />
              </>
            )}
            {socialP?.stats && socialP.stats.games > 0 && (
              <>
                <h4>Online record</h4>
                <div data-testid="profile-stats">
                  <StatRows rows={[
                    ['Win streak', `${socialP.stats.streak} (best ${socialP.stats.bestStreak})`],
                    ['Bid accuracy', `${socialP.stats.accuracy ?? '—'}${socialP.stats.accuracy !== null ? '%' : ''}`],
                    ['Books / hand', String(socialP.stats.booksPerHand ?? '—')],
                    ['Nils made', socialP.stats.nil],
                    ['Shots given', String(socialP.stats.shotsGiven)],
                    ['Shots taken', String(socialP.stats.shotsTaken)],
                    ['Wheels', String(socialP.stats.wheels)],
                    ['Big Joker wins', String(socialP.stats.bjWins)],
                    ['Avg bid', `${socialP.stats.bidSec ?? '—'}s`],
                    ['Avg play', `${socialP.stats.playSec ?? '—'}s`],
                  ]} />
                </div>
              </>
            )}
            {socialP?.vsYou && <p className="soc-vs" data-testid="profile-vs">You vs {socialP.username}: <b>{socialP.vsYou.wins}–{socialP.vsYou.losses}</b> in {socialP.vsYou.games} game{socialP.vsYou.games === 1 ? '' : 's'}</p>}
            {socialP && (
              <>
                <h4>Team names</h4>
                <div className="soc-badges">{socialP.teamNames.length ? socialP.teamNames.map((t) => <span key={t} className="soc-badge-chip">{t}</span>) : <span className="soc-muted">None yet</span>}</div>
                {rivalry && <p className="soc-vs" data-testid="profile-rivalry">🔥 Rivalry — {rivalry.name}: <b>{rivalry.wins}–{rivalry.losses}</b> in {rivalry.games} game{rivalry.games === 1 ? '' : 's'}</p>}
                <h4>Head-to-head</h4>
                {socialP.h2h.length ? (
                  <table className="soc-h2h" data-testid="profile-h2h"><tbody>
                    {socialP.h2h.map((r) => <tr key={r.id}><td><button type="button" className="link" onClick={() => openProfile(r.name, r.id)}>{r.name}</button></td><td>{r.wins}–{r.losses}</td><td className="soc-muted">{r.games} game{r.games === 1 ? '' : 's'}</td></tr>)}
                  </tbody></table>
                ) : <p className="soc-muted">No series against signed-in players yet.</p>}
              </>
            )}
            {me && (() => { const o = offlineStats(); return o.games > 0 ? <p className="soc-muted" data-testid="profile-offline">On this device vs bots: {o.wins}/{o.games} wins · streak {o.streak} (best {o.bestStreak})</p> : null; })()}
          </>
        )}
        {activeTab === 'achievements' && (
          <>
            {cred && (
              <div className="ach-grid">
                {cred.achievements.map((a) => (
                  <div key={a.id} className={`ach ${a.unlockedAt ? 'unlocked' : 'locked'}`}>
                    <b>{a.title}</b><small>{a.unlockedAt ? 'Unlocked' : a.hint}</small><span>+{a.xp} XP{a.coins ? ` · +${a.coins} coins` : ''}</span>
                  </div>
                ))}
              </div>
            )}
            {socialP && (
              <>
                <h4>Badges</h4>
                <div className="soc-badges">{socialP.badges.length ? socialP.badges.map((b) => <span key={b.id} className="soc-badge-chip" title={BADGES[b.id]?.desc}>{BADGES[b.id]?.icon ?? '🏅'} {BADGES[b.id]?.name ?? b.id}</span>) : <span className="soc-muted">None yet</span>}</div>
              </>
            )}
            {socialP?.awards && socialP.awards.length > 0 && (
              <>
                <h4>Champion</h4>
                <div className="soc-badges" data-testid="profile-awards">{socialP.awards.map((a) => <button type="button" key={a.ref} className="soc-badge-chip champ" onClick={() => social.showTour(a.ref)}>🏆 {a.label}</button>)}</div>
              </>
            )}
            {uid && <LeagueAwards userId={uid} />}
          </>
        )}
        {activeTab === 'unlocks' && cred?.unlocks && (
          <div className="unlock-list">
            {cred.unlocks.length === 0 && <p className="muted">No unlocks yet — level up and earn achievements to unlock card backs, venues, and more.</p>}
            {cred.unlocks.map((u) => (
              <div key={u.itemId} className="unlock-row">
                <b>{u.itemId}</b><small>from {u.source}</small>{u.equipped && <span className="equipped-tag">Equipped</span>}
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );

  if (host === 'panel') {
    return (
      <div className="soc-profile profile-view" data-testid="profile">
        <button type="button" className="link" onClick={() => social.showProfile(null)} data-testid="profile-back">← Back</button>
        {content}
      </div>
    );
  }
  return (
    <div className="profile-page profile-view">
      <header className="prof-bar">
        <button type="button" className="back-chip" onClick={() => history.back()}>← BACK</button>
        <span className="prof-season">{cred?.season?.name}</span>
      </header>
      {content}
    </div>
  );
}
