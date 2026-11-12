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
 *
 * Player Card (2026-10-23): the header's identity block is now the
 * flippable Player Card (profile/PlayerCard.tsx) whenever the cred payload
 * carries it — which both cred endpoints do. The card is a playing-card
 * face for the player's rank card (front) with their stats on the back.
 * Status up top (owner, 2026-10-23, annotated screenshot): the profile's
 * tagline + presence line and the card's own status render ABOVE the
 * card — centered, in the first viewport, where the BWM ticker can never
 * cover them (they used to ride under the card and the tagline/presence
 * row ended up at the screen's bottom edge). The two lines are DISTINCT
 * fields and stay distinct: the tagline is the profile's longer
 * link-friendly line (user.tagline, Edit profile), the status is the
 * card's short one-liner (card.status, Edit card) — each renders exactly
 * once. The region line alone stays under the card; the RepBlock +
 * action row keep their established order below that. A payload without
 * a card (stale cache) falls back to the legacy identity header above —
 * same lines, unflipped. The card's own fields (status, partner tags,
 * showcased badges) edit through the card's Edit card button
 * (profile/CardEditor.tsx), separate from the Edit profile stack.
 */
import { useEffect, useRef, useState } from 'react';
import { presenceLine } from '@spades/protocol';
import { STORY_SECRETS } from '@spades/bots';

/** Story Mode collectibles (storySecrets) read by name here, not raw id. */
const COLLECTIBLE_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(STORY_SECRETS).map((s) => [s.unlockable.itemId, s.unlockable.name]),
);
import { useAccount } from '../account/api';
import { noteDailyBonus } from '../dailyBonus';
import { accountUidOf, AvatarCircle, compressAvatarFile, forgetAvatar, useAvatar, validateAvatarDataUrl } from '../avatar';
import { BADGES } from '../badges';
import { offlineStats } from '../offlineStats';
import { CoinIcon, RepBlock } from '../RepBlock';
import { PlayerCard, quitStatRows, type PlayerCardData } from './PlayerCard';
import { CardEditor } from './CardEditor';
import { TaglineText } from '../tagline';
import { SOCIAL_PLATFORMS, SocialLinksChips, type SocialLinks } from '../socialLinks';
import { MODE_NAME, inviteTo } from '../social/Social';
import { social, useSocial } from '../social/store';
import { pairPraise, pairStreakText, pairWinPct, type PairRecordLike } from '../social/pairRecord';
import { personalBestTiles } from '../social/personalBests';
import { useRankPromotion } from '../social/CelebrationHost';
import { FavoriteStar } from '../social/FavoriteStar';
import { ejectTeamMember, fetchMyTeams, type TeamRoster } from '../social/teamsApi';
import { ChallengeButton } from '../social/Wager';
import StoryBadges, { badgeFactsOf } from '../story/StoryBadges';
import { fetchStoryProgress, type StoryProgress } from '../story/storyApi';
/* The badge component's styles live in story.css (its home since the map
 *  and win moment); every selector there is .story-* scoped, so importing
 *  it here styles the badges on this surface — in both themes, the sheet's
 *  own neon overrides included — and nothing else on the profile. */
import { mvpText } from '../mvp';
import '../story/story.css';

const modeName = (m: string) => MODE_NAME[m] ?? m;

/* ------------------------------------------------------------ data shapes */

/** The payload's division id — internal band logic only. No user-facing
 *  surface renders a division name anymore (owner, 2026-10-20: rankings are
 *  metric-based, "not some corny names"), so there is deliberately no label
 *  map here. */
type Division = 'stoop' | 'corner' | 'block' | 'avenue' | 'boulevard' | 'legend';

interface SeasonRank { division: Division; elo: number; games: number; wins: number; losses: number; peak: number; rank: number; of: number }
interface Challenge { id: string; title: string; metric: string; target: number; progress: number; xp: number; coins: number; claimed: boolean }
/** The season block of the challenges payload (2026-10-23): the dealt
 *  season set with progress, plus the server-derived upkeep view —
 *  `bigJoker` is non-null only for an earned Big Joker holder. Optional
 *  so a stale cached payload renders the daily/weekly sections alone. */
interface SeasonChallenges {
  id: string; name?: string; endsAt?: number; setComplete?: boolean;
  challenges: Challenge[];
  bigJoker?: { earned: true; active: boolean } | null;
}
interface Achievement { id: string; title: string; hint: string; xp: number; coins: number; unlockedAt: number | null }
interface Unlock { itemId: string; source: string; unlockedAt: number; slot: string | null; equipped: boolean }

/** The cred payload, normalized: /api/profile/me and /api/profile/:id share the
 *  shape; challenges/unlocks only exist on the /me payload. */
interface CredData {
  user: { id: string; name: string; avatar: string | null; avatarUpdatedAt: number | null; tagline: string | null; socialLinks: SocialLinks; region: string | null };
  /** the Player Card payload (2026-10-23): both cred endpoints carry it;
   *  optional here only so a stale cached payload degrades to the legacy
   *  identity header instead of breaking the profile */
  card?: PlayerCardData;
  level: { level: number; xp: number; title: string; xpForNext: number; xpIntoLevel: number };
  season?: { id: string; name: string; endsAt: number };
  rank: { team: SeasonRank; cutthroat: SeasonRank };
  stats: { team: Record<string, number | string | null>; cutthroat: Record<string, number | string | null> };
  challenges?: { daily: Challenge[]; weekly: Challenge[]; season?: SeasonChallenges };
  achievements: Achievement[];
  unlocks?: Unlock[];
  coins: { balance: number };
  /** the daily-login grant THIS read performed (self payload only): a
   *  granting read raises the one-time receipt — see dailyBonus.ts */
  dailyBonus?: { granted: boolean; amount: number; streak: number; day: string };
}

/** One partner on a team record: signed-in partners carry their social id
 *  ('u:<account id>') for profile tap-through; bot/guest partners are
 *  display names only — they have no profile. */
interface TeamPartnerData {
  id?: string; name: string; avatar?: string | null; bot?: boolean; guest?: boolean; games: number;
}

/** One team name's real recorded record, computed server-side from the
 *  profile player's games played under that name. `recorded` says whose
 *  rows the performance lines aggregate: 'side' = both partners recorded,
 *  'self' = only the profile player's rows exist (bot/guest partner). */
interface TeamStatData {
  name: string;
  games: number; wins: number; losses: number; winPct: number | null;
  streak: number; bestStreak: number;
  accuracy: number | null; booksPerHand: number | null; nil: string; wheels: number;
  recorded: 'side' | 'self';
  partner: TeamPartnerData | null;
  others: { name: string; games: number }[];
}

/** The social-record payload (/api/social/profile/:name). */
interface SocialProfileData {
  id?: string; avatar?: string | null;
  username: string; memberSince: number; tagline?: string | null; region?: string | null; badges: { id: string; earnedAt: number }[]; teamNames: string[];
  /** per-team records aligned with teamNames; optional so a payload from
   *  an older deploy keeps the inert name chips instead of dead buttons */
  teams?: TeamStatData[];
  ratings: { team?: number; cutthroat?: number }; totals: { games: number; wins: number };
  h2h: { id: string; name: string; games: number; wins: number; losses: number }[]; vsYou?: { games: number; wins: number; losses: number }; champion: number;
  stats?: { games: number; wins: number; streak: number; bestStreak: number; accuracy: number | null; booksPerHand: number | null; nil: string; shotsGiven: number; shotsTaken: number; tkoDealt: number; tkoSuffered: number; tossesForced: number; tossesConceded: number; wheels: number; mvps?: number; mvpPct?: number | null; bidSec: number | null; playSec: number | null };
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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  /* BWM Central: an explicit Compare ask (the profile's "Compare with me"
   * action, or the postgame Compare next-action via social.openCompare)
   * opens the block itself and scrolls it into view. */
  const compareFor = useSocial().compareFor;
  useEffect(() => {
    if (!compareFor || compareFor.toLowerCase() !== them.username.toLowerCase()) return;
    setOpen(true);
    const t = window.setTimeout(() => wrapRef.current?.scrollIntoView({ block: 'nearest' }), 60);
    return () => window.clearTimeout(t);
  }, [compareFor, them.username]);
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
    );
  }
  return (
    <div className="cmp-wrap" ref={wrapRef} data-testid="compare-block">
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

/**
 * BWM Central Phase 2: "You two together" — the caller's pair record
 * with this player (GET /api/profile/pair/:id, caller-scoped by design).
 * The record ALWAYS shows; the praise verdict renders only at the
 * documented minimum sample (pairPraise: >= 10 games AND >= 55% wins),
 * with the record printed right beside it. The pair endpoint carries no
 * team names, so names render only when the social payload's per-team
 * records name this partner — passed in by the caller, never inferred.
 */
function PairTogetherBlock({ partnerId, partnerName, teamNames }: { partnerId: string; partnerName: string; teamNames: string[] }) {
  const [rec, setRec] = useState<PairRecordLike | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(`/api/profile/pair/${encodeURIComponent(partnerId)}`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('missing'))))
      .then((j) => { if (alive) setRec(j as PairRecordLike); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [partnerId]);
  const pct = rec ? pairWinPct(rec) : null;
  return (
    <div className="pair-together" data-testid="pair-together">
      <div className="power-head">
        <h4>You two together</h4>
        <FavoriteStar userId={partnerId} name={partnerName} testid={`fav-star-pair-${partnerName}`} />
      </div>
      {failed ? <p className="soc-muted">Pair record unavailable.</p>
        : rec === null ? <p className="soc-muted">Loading…</p>
        : rec.games === 0 ? <p className="soc-muted">No recorded games together yet.</p>
        : (
          <>
            <p className="pair-rec" data-testid="pair-record">{rec.games} game{rec.games === 1 ? '' : 's'} · <b>{rec.wins}–{rec.losses}</b> · Win {pct === null ? '—' : `${pct}%`} · Current streak {pairStreakText(rec.streak)}</p>
            {pairPraise(rec) && <p className="pair-praise" data-testid="pair-praise">You two play well together — {rec.wins}–{rec.losses} in {rec.games} games.</p>}
            {teamNames.length > 0 && <p className="soc-muted">Team names: {teamNames.join(', ')}</p>}
          </>
        )}
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

function ChallengeRow({ c, onClaim, busy = false, celebrating = false }: {
  c: Challenge;
  onClaim: (id: string) => void;
  /** this row's claim POST is in flight — the button stays pressed and
   *  disabled, so the row can't be double-claimed (the server remains
   *  authoritative either way) */
  busy?: boolean;
  /** the claim just landed: the row celebrates briefly, then reads exactly
   *  like every other Claimed row */
  celebrating?: boolean;
}) {
  const done = c.progress >= c.target;
  const pct = Math.min(100, Math.round((c.progress / Math.max(1, c.target)) * 100));
  return (
    <div className={`challenge ${done ? 'done' : ''}${celebrating ? ' just-claimed' : ''}`} data-cid={c.id}>
      <div className="ch-main">
        <b>{c.title}</b>
        <div className="ch-bar"><i style={{ width: `${pct}%` }} /></div>
        <small className={celebrating ? 'affirm' : undefined}>{Math.min(c.progress, c.target)}/{c.target} · +{c.xp} XP{c.coins ? <> · +{c.coins} coins{celebrating && <> <CoinIcon size={12} /></>}</> : ''}</small>
      </div>
      {done && !c.claimed && (
        <button type="button" className="primary small" disabled={busy} onClick={() => onClaim(c.id)}>
          {busy ? 'Claiming…' : 'Claim'}
        </button>
      )}
      {c.claimed && <span className={`ch-claimed${celebrating ? ' in' : ''}`}>Claimed</span>}
    </div>
  );
}

/** The season section of the Challenges tab: the season's name and time
 *  left, the dealt set with live progress (the same ChallengeRow as
 *  daily/weekly), and — only for an earned Big Joker holder, the one
 *  player the upkeep framing can ever apply to — the crown's state.
 *  Everyone else sees pure content. Copy stays truthful by construction:
 *  the server derives `active` (earn season counts, a completed set
 *  lights it, a lapsed one darkens it) and this renders its verdict. */
function SeasonSection({ season, onClaim, claimingIds, justClaimedIds }: {
  season: SeasonChallenges;
  onClaim: (id: string) => void;
  claimingIds?: ReadonlySet<string>;
  justClaimedIds?: ReadonlySet<string>;
}) {
  const daysLeft = season.endsAt != null ? Math.max(0, Math.ceil((season.endsAt - Date.now()) / 86_400_000)) : null;
  const bj = season.bigJoker ?? null;
  return (
    <section data-testid="season-challenges">
      <h3>{season.name ?? 'This season'}{daysLeft != null && <small className="ch-season-left"> · {daysLeft} day{daysLeft === 1 ? '' : 's'} left</small>}</h3>
      {bj && (
        <p className="ch-upkeep" data-testid="season-upkeep">
          {bj.active
            ? season.setComplete
              ? <>👑 <b>Big Joker</b> — season set complete. The crown stays lit.</>
              : <>👑 <b>Big Joker</b> — the crown is lit. Finish a season's set to keep it burning past this one.</>
            : <>👑 <b>Big Joker</b> — crown's dark. Finish this season's set to light it back up.</>}
        </p>
      )}
      {season.challenges.map((c) => <ChallengeRow key={c.id} c={c} onClaim={onClaim} busy={claimingIds?.has(c.id)} celebrating={justClaimedIds?.has(c.id)} />)}
    </section>
  );
}

const STAT_LABELS: Record<string, string> = {
  games: 'Games', wins: 'Wins', streak: 'Win streak', bestStreak: 'Best streak',
  mvps: 'MVPs', accuracy: 'Bid accuracy', bags: 'Bags', booksPerHand: 'Books/hand', nil: 'Nil made',
  shotsGiven: 'Shots given', shotsTaken: 'Shots taken', tkoDealt: '1st Round TKOs', tkoSuffered: 'TKOs taken', tossesForced: 'Tosses forced', tossesConceded: 'Tosses conceded', wheels: 'Wheels',
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
        <div key={k} className="stat-row"><span>{label}</span><b>{k === 'mvps' ? mvpText(Number(stats.mvps), stats.mvpPct as number | null | undefined) : String(stats[k])}</b></div>
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

/** A team name's detail (owner, 2026-11-04: tapping a team name shows that
 *  team's stats) — rendered inline under the chip row, the profile family's
 *  drill-in pattern. Only what the server record honestly carries: a team
 *  with no recorded games gets the empty state, and a metric the aggregate
 *  cannot support (no bids, no hands) omits its row instead of showing a
 *  dressed-up zero. */
/** The team's roster (owner, 2026-11-05) — rendered only on the owner's own
 *  profile: you (the owner) plus the human partners holding spots under this
 *  name. Eject is an inline two-tap (arm, then confirm) and swaps the roster
 *  in place; the recorded record around it is history and never moves when
 *  a spot frees. Bot partners hold no spot and never appear here. */
function TeamRosterBlock({ roster, onEject }: { roster: TeamRoster; onEject: (memberId: string) => Promise<void> }) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const eject = async (memberId: string) => {
    setBusy(true);
    setErr('');
    try { await onEject(memberId); setConfirmId(null); }
    catch { setErr('That eject didn’t go through — try again.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="team-roster" data-testid="team-roster">
      <div className="team-roster-head"><b>Roster</b><span className="soc-muted">you + up to 3 partners</span></div>
      <div className="team-roster-row"><span>You</span><span className="soc-muted">owner</span></div>
      {roster.members.map((m) => (
        <div className="team-roster-row" key={m.id}>
          <span>{m.name}</span>
          {confirmId === m.id ? (
            <span className="team-roster-confirm">
              <button type="button" className="small danger" data-testid="team-roster-confirm" disabled={busy} onClick={() => void eject(m.id)}>Eject {m.name}</button>
              <button type="button" className="small" disabled={busy} onClick={() => setConfirmId(null)}>Keep</button>
            </span>
          ) : (
            <button type="button" className="small" data-testid="team-roster-eject" data-member={m.id} onClick={() => { setErr(''); setConfirmId(m.id); }}>Eject</button>
          )}
        </div>
      ))}
      {roster.members.length === 0 && (
        <p className="soc-muted">No partners on this roster yet — the first people who play under this name with you take the spots. Bot partners never take one.</p>
      )}
      {roster.full && <p className="soc-muted">Roster full — a new partner can’t join this name until someone is ejected.</p>}
      <p className="soc-muted team-roster-note">The record on this page counts everyone who ever played under the name. Ejecting frees a spot; it never changes the record.</p>
      {err && <small className="err" role="alert">{err}</small>}
    </div>
  );
}

function TeamDetail({ team, onPartner, roster, onEjectMember }: {
  team: TeamStatData;
  onPartner: (name: string, id?: string) => void;
  /** Self view only: the team's roster (null while it loads). */
  roster?: TeamRoster | null;
  onEjectMember?: (memberId: string) => Promise<void>;
}) {
  const partner = team.partner;
  const rows: [string, string][] = [
    ['Win streak', `${team.streak} (best ${team.bestStreak})`],
    ...(team.accuracy !== null ? [['Bid accuracy', `${team.accuracy}%`] as [string, string]] : []),
    ...(team.booksPerHand !== null ? [['Books / hand', String(team.booksPerHand)] as [string, string]] : []),
    ['Nils made', team.nil],
    ['Wheels', String(team.wheels)],
  ];
  return (
    <div className="team-detail" data-testid="team-detail">
      <div className="team-detail-name"><b>{team.name}</b></div>
      {partner && (
        <div className="team-partner-row">
          <AvatarCircle pic={partner.avatar ?? null} name={partner.name} className="soc-av"
            onTap={partner.id ? () => onPartner(partner.name, partner.id) : undefined} />
          {partner.id
            ? <button type="button" className="link" data-testid="team-partner" onClick={() => onPartner(partner.name, partner.id)}>{partner.name}</button>
            : <span>{partner.name}</span>}
          <span className="soc-muted">
            {partner.bot ? 'Bot partner · ' : partner.guest ? 'Guest partner · ' : ''}
            {partner.games} game{partner.games === 1 ? '' : 's'} together
          </span>
        </div>
      )}
      {team.others.length > 0 && (
        <p className="soc-muted team-others">Also teamed with {team.others.map((o) => `${o.name} (${o.games} game${o.games === 1 ? '' : 's'})`).join(', ')}</p>
      )}
      {roster && onEjectMember && <TeamRosterBlock roster={roster} onEject={onEjectMember} />}
      {team.games === 0 ? (
        <p className="soc-muted" data-testid="team-empty">No recorded games under this name yet. Games this team plays while signed in will build its record here.</p>
      ) : (
        <>
          <div className="soc-stats team-summary">
            <div><b>{team.games}</b><small>games</small></div>
            <div><b>{team.wins}–{team.losses}</b><small>record</small></div>
            <div><b>{team.winPct === null ? '—' : `${team.winPct}%`}</b><small>win %</small></div>
          </div>
          {team.recorded === 'self' && (
            <p className="soc-muted">Your numbers in these games — bot and guest partners are not recorded.</p>
          )}
          <StatRows rows={rows} />
        </>
      )}
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

export function ProfileView({ host, name, id, noBack }: {
  /** 'page' = the /profile route; 'panel' = the Social panel's profile view */
  host: 'panel' | 'page';
  /** subject username; omit on the page host for your own profile (identity comes from /api/profile/me) */
  name?: string;
  /** social pid or raw account id when the caller knew it (panel rows carry ids) */
  id?: string;
  /** BWM Central: the My Career destination IS this view — no Back chip */
  noBack?: boolean;
}) {
  const s = useSocial();
  const acct = useAccount();
  const selfRoute = host === 'page' && !name;
  const [tab, setTab] = useState<Tab>('stats');
  /** The team name whose stats are open under the Team names chips. */
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [p, setP] = useState<SocialProfileData | null | 'missing'>(null);
  const [cred, setCred] = useState<CredData | null>(null);
  const [credErr, setCredErr] = useState<string | null>(null);
  /* Claims are per-row state now (owner, 2026-11-01: claiming a reward
   *  "looks like the whole page refreshes" and the scroll jumped back to
   *  the top — the old claim ran reload(), whose reloadTick nulled the
   *  social payload and swapped this whole view for its Loading stub).
   *  A claim now updates its own row in place; see claim() below. */
  const [claimingIds, setClaimingIds] = useState<ReadonlySet<string>>(new Set());
  /** Rows inside their brief post-claim celebration beat. */
  const [justClaimedIds, setJustClaimedIds] = useState<ReadonlySet<string>>(new Set());
  const claimsInFlight = useRef(0);
  /** Synchronous twin of claimingIds: a second tap in the same tick (before
   *  the disabled state renders) still meets the guard. */
  const claimingRef = useRef<Set<string>>(new Set());
  const celebrateTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [claimErr, setClaimErr] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const reload = () => setReloadTick((t) => t + 1);
  useEffect(() => () => { celebrateTimers.current.forEach((t) => clearTimeout(t)); }, []);
  // Profile picture (Demetrius 2026-10-19): upload stands in for the camera at the table.
  const [uploading, setUploading] = useState(false);
  const [picBusy, setPicBusy] = useState(false);
  const [picErr, setPicErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Edit profile gate (Demetrius 2026-10-20): false = the profile is a
  // profile — header + tabs, zero editor UI. True = the full editor stack
  // (picture, tagline, social links) shows under the header.
  const [editing, setEditing] = useState(false);
  // Player Card editor (2026-10-23): the card's own Edit card button opens
  // its editor (status / tags / showcase) directly under the card — a
  // separate gate from Edit profile, which keeps the older editor stack.
  const [cardEditorOpen, setCardEditorOpen] = useState(false);
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
    setOpenTeam(null);
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
  /* Team rosters (owner, 2026-11-05): my own rosters, fetched only when this
   *  profile is mine — another player's profile never asks for them (the
   *  server would 403 anyway). Eject swaps the returned roster in place,
   *  like a claim: no reload, no scroll jump. */
  const myId = acct.user?.id;
  const [rosters, setRosters] = useState<TeamRoster[] | null>(null);
  useEffect(() => {
    if (!me || !myId) { setRosters(null); return; }
    let alive = true;
    fetchMyTeams()
      .then((t) => { if (alive) setRosters(t); })
      .catch(() => { if (alive) setRosters([]); });
    return () => { alive = false; };
  }, [me, myId]);
  const ejectMember = async (teamName: string, memberId: string) => {
    if (!myId) return;
    const updated = await ejectTeamMember(myId, teamName, memberId);
    setRosters((rs) => (rs ?? []).map((r) => (r.name === teamName ? updated : r)));
  };
  /* Rank-promotion watch (BWM Central Phase 3, Career side): only the
   * viewer's OWN level counts — another player's profile never touches
   * the viewer's high-water mark. Rankings runs the same check; the
   * shared storage mark + queue dedupe keep it to one celebration. */
  useRankPromotion(me && cred ? cred.level.level : null);

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

  /* Daily-bonus receipt (owner, 2026-10-23): if the /me read above was the
   *  one that landed today's grant, its payload says so — hand it to the
   *  receipt store, which dedupes per day and raises the "+N coins — you
   *  now have M" card. Covers both fetch paths (self route + own profile
   *  opened through Social); public payloads carry no grant and no-op. */
  useEffect(() => { if (cred) noteDailyBonus(cred); }, [cred]);

  /* Story badges (owner, 2026-10-22): the story collection joins the
   *  Achievements tab — SELF view only, because story progress is the
   *  account's own private payload (the server serves it for the caller
   *  alone). Any non-ok fetch — signed out, story mode locked to this
   *  account, a plain error — renders NOTHING: no zero-count placeholder,
   *  no invented facts (data honesty). */
  const [storyProg, setStoryProg] = useState<StoryProgress | null>(null);
  useEffect(() => {
    if (!me) return;
    let alive = true;
    fetchStoryProgress('solo').then((r) => { if (alive && r.status === 'ok') setStoryProg(r.progress); });
    return () => { alive = false; };
  }, [me]);

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

  /** Fold one landed claim into the local payload: the row flips to
   *  claimed and the header numbers (XP total + into-level, coin balance)
   *  gain the grant the server just confirmed. This is what the player
   *  sees the instant the claim lands; the exact server-derived figures
   *  (level-ups, the earn multiplier) arrive with the quiet reconcile
   *  below. Monotonic by construction — a challenge never un-claims here
   *  and the balances never step backwards. */
  const applyClaimLocally = (cid: string, grant: { xp: number; coins: number }) => {
    setCred((prev) => {
      if (!prev?.challenges) return prev;
      const mark = (list: Challenge[]) => list.map((c) => (c.id === cid && !c.claimed ? { ...c, claimed: true } : c));
      return {
        ...prev,
        challenges: {
          ...prev.challenges,
          daily: mark(prev.challenges.daily),
          weekly: mark(prev.challenges.weekly),
          season: prev.challenges.season
            ? { ...prev.challenges.season, challenges: mark(prev.challenges.season.challenges) }
            : prev.challenges.season,
        },
        level: { ...prev.level, xp: prev.level.xp + grant.xp, xpIntoLevel: prev.level.xpIntoLevel + grant.xp },
        coins: { balance: prev.coins.balance + grant.coins },
      };
    });
  };

  /** Quiet reconcile after a burst of claims settles: refetch ONLY the
   *  cred payload and apply it in place. Nothing is nulled and the tree's
   *  shape and keys never change, so the scroller — and the player's
   *  place in the list — are untouched (the old reload() bumped
   *  reloadTick, which nulled the social payload and remounted this
   *  whole view at scrollTop 0). A read issued before a just-landed
   *  claim can lag it, so a locally-claimed row is never un-claimed by
   *  the merge and the header numbers never step backwards. Silent on
   *  failure: local state already reflects the server's verdict, and
   *  the next natural load reconciles. */
  const reconcileCred = async () => {
    try {
      const fresh = await api<CredData>('/api/profile/me');
      setCred((prev) => {
        if (!prev || fresh.user.id !== prev.user.id) return prev;
        if (!fresh.challenges || !prev.challenges) return fresh;
        const keepClaimed = (freshList: Challenge[], localList: Challenge[]) =>
          freshList.map((c) => {
            const local = localList.find((l) => l.id === c.id);
            return local?.claimed && !c.claimed ? { ...c, claimed: true } : c;
          });
        return {
          ...fresh,
          challenges: {
            ...fresh.challenges,
            daily: keepClaimed(fresh.challenges.daily, prev.challenges.daily),
            weekly: keepClaimed(fresh.challenges.weekly, prev.challenges.weekly),
            season: fresh.challenges.season && prev.challenges.season
              ? { ...fresh.challenges.season, challenges: keepClaimed(fresh.challenges.season.challenges, prev.challenges.season.challenges) }
              : fresh.challenges.season,
          },
          level: { ...fresh.level, xp: Math.max(fresh.level.xp, prev.level.xp), xpIntoLevel: Math.max(fresh.level.xpIntoLevel, prev.level.xpIntoLevel) },
          coins: { balance: Math.max(fresh.coins.balance, prev.coins.balance) },
        };
      });
    } catch { /* silent by design — see above */ }
  };

  /** Claim one challenge reward IN PLACE (owner, 2026-11-01): the row
   *  celebrates into its Claimed state, the balances tick up, and the
   *  page never reloads or gives up the player's scroll position — so
   *  several rewards can be claimed in a row, top to bottom. A failure
   *  stays inline in the tab and leaves the row claimable. */
  const claim = async (cid: string) => {
    if (claimingRef.current.has(cid)) return;
    claimingRef.current.add(cid);
    setClaimErr(null);
    claimsInFlight.current += 1;
    setClaimingIds((prev) => new Set(prev).add(cid));
    try {
      const grant = await api<{ ok: boolean; xp: number; coins: number }>('/api/challenges/' + cid + '/claim', { method: 'POST' });
      applyClaimLocally(cid, grant);
      setJustClaimedIds((prev) => new Set(prev).add(cid));
      celebrateTimers.current.set(cid, setTimeout(() => {
        celebrateTimers.current.delete(cid);
        setJustClaimedIds((prev) => { const next = new Set(prev); next.delete(cid); return next; });
      }, 1600));
    } catch (e) {
      setClaimErr((e as Error).message);
    } finally {
      claimingRef.current.delete(cid);
      claimsInFlight.current -= 1;
      setClaimingIds((prev) => { const next = new Set(prev); next.delete(cid); return next; });
      if (claimsInFlight.current === 0) void reconcileCred();
    }
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
      ? <div className="soc-profile profile-view" data-testid="profile">{!noBack && <button type="button" className="link" onClick={() => social.showProfile(null)} data-testid="profile-back">← Back</button>}<p className="soc-empty">Loading…</p></div>
      : <div className="profile-page profile-view"><div className="prof-loading">Loading…</div></div>;
  }
  if (!selfRoute && p === 'missing') {
    return host === 'panel'
      ? <div className="soc-profile profile-view" data-testid="profile">{!noBack && <button type="button" className="link" onClick={() => social.showProfile(null)} data-testid="profile-back">← Back</button>}<p className="soc-empty">No profile for {name}.</p></div>
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
    ? [...cred.challenges.daily, ...cred.challenges.weekly, ...(cred.challenges.season?.challenges ?? [])].filter((c) => c.progress >= c.target && !c.claimed).length
    : 0;
  const cardData = cred?.card ?? null;
  /** The presence line, composed ONCE via the shared presence helper and
   *  rendered by both header shapes (card + legacy fallback) — never
   *  hand-joined. */
  const presenceText = presenceEntry ? presenceLine(presenceEntry.status, modeName) : 'Offline';
  const tagValue = tagDraft ?? cred?.user.tagline ?? '';
  const regionValue = regionDraft ?? cred?.user.region ?? '';
  /** Plain display region (league P-B): the social payload's, falling back to
   *  the cred payload on the self view. Unset = nothing shown, no fanfare. */
  const regionText = socialP?.region ?? (me ? cred?.user.region : undefined) ?? undefined;
  const rivalry = socialP ? topRivalry(socialP.h2h) : null;

  const content = (
    <>
      <div className="soc-prof-head">
        {cardData ? (
          <>
            {/* Status up top (owner, 2026-10-23): the profile's tagline +
                presence line render ABOVE the card, centered in the first
                viewport — and the card's own status goes up with them via
                statusPlacement="above". The region line stays under the
                card; then the shared RepBlock and the action row as before. */}
            <div className="prof-above-card">
              <TaglineText text={tagline} className="soc-tagline" />
              <p className={`soc-online-status ${presenceEntry ? 'on' : 'off'}`} data-testid="profile-online">
                <i className="soc-dot" aria-hidden />{presenceText}
              </p>
            </div>
            <PlayerCard data={cardData} pic={pic} champion={socialP?.champion} self={me} statusPlacement="above"
              onEditCard={me ? () => setCardEditorOpen((v) => !v) : undefined} />
            {me && cardEditorOpen && (
              <CardEditor card={cardData}
                onClose={() => setCardEditorOpen(false)}
                onSaved={(card) => { setCred((prev) => (prev ? { ...prev, card } : prev)); setCardEditorOpen(false); }} />
            )}
            {regionText && (
              <div className="prof-under-card">
                <p className="soc-muted" data-testid="profile-region">Region: {regionText}</p>
              </div>
            )}
          </>
        ) : (
          <>
            <AvatarCircle pic={pic} name={displayName} className="soc-av big" />
            <div>
              <h3 data-testid="profile-name">{displayName}{socialP && socialP.champion > 0 && <span className="soc-champ" title="Tournament champion">🏆×{socialP.champion}</span>}</h3>
              {memberSince !== undefined && <p className="soc-muted">Member since {new Date(memberSince).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>}
              <TaglineText text={tagline} className="soc-tagline" />
              <p className={`soc-online-status ${presenceEntry ? 'on' : 'off'}`} data-testid="profile-online">
                <i className="soc-dot" aria-hidden />{presenceText}
              </p>
              {regionText && <p className="soc-muted" data-testid="profile-region">Region: {regionText}</p>}
            </div>
          </>
        )}
        {cred && (
          <RepBlock testid="profile-rep" coinsTestid="profile-coins"
            level={cred.level} rank={cred.card?.rank ?? null} team={cred.rank.team} cutthroat={cred.rank.cutthroat} coins={cred.coins?.balance} />
        )}
        {!me && pid && (
          <div className="soc-prof-acts">
            {!blocked && acct.user?.username && (
              <button type="button" className="primary" data-testid="profile-compare"
                onClick={() => { setTab('stats'); social.requestCompare(displayName); }}>⚔️ Compare with me</button>
            )}
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
          const all = [...cred.challenges.daily, ...cred.challenges.weekly, ...(cred.challenges.season?.challenges ?? [])];
          const earnedXp = all.filter((c) => c.claimed).reduce((sum, c) => sum + c.xp, 0);
          const earnedCoins = all.filter((c) => c.claimed).reduce((sum, c) => sum + (c.coins ?? 0), 0);
          return (
            <>
              {(earnedXp > 0 || earnedCoins > 0) && (
                <p className="ch-earned" data-testid="challenges-earned">Earned: <b>{earnedXp} XP</b>{earnedCoins > 0 && <> · <b>{earnedCoins} coins</b></>}</p>
              )}
              <h3>Daily</h3>
              {cred.challenges.daily.map((c) => <ChallengeRow key={c.id} c={c} onClaim={claim} busy={claimingIds.has(c.id)} celebrating={justClaimedIds.has(c.id)} />)}
              <h3>Weekly</h3>
              {cred.challenges.weekly.map((c) => <ChallengeRow key={c.id} c={c} onClaim={claim} busy={claimingIds.has(c.id)} celebrating={justClaimedIds.has(c.id)} />)}
              {cred.challenges.season && <SeasonSection season={cred.challenges.season} onClaim={claim} claimingIds={claimingIds} justClaimedIds={justClaimedIds} />}
              {claimErr && <span className="prof-pic-err" role="alert">{claimErr}</span>}
            </>
          );
        })()}
        {activeTab === 'stats' && (
          <>
            {!me && socialP && acct.user?.username && <CompareBlock them={socialP} myName={acct.user.username} />}
            {!me && socialP?.id && acct.user?.username && (
              <PairTogetherBlock partnerId={socialP.id} partnerName={socialP.username}
                teamNames={(socialP.teams ?? []).filter((t) => t.partner?.name === socialP.username).map((t) => t.name)} />
            )}
            {cred && (
              <>
                <p className="rank-explainer" data-testid="rating-explainer">Rating starts at 1,200. Win rated games to raise it, lose and it drops — beating stronger players moves it more.</p>
                <div className="rank-cards">
                  <RankCard title="Partnership" rank={cred.rank.team} />
                  <RankCard title="Cutthroat" rank={cred.rank.cutthroat} />
                </div>
                {/* Personal bests (BWM Central Phase 3): tiles ONLY from
                    fields the payloads already carry (peak rating per
                    kind with rated games, best streak). "Most books in
                    a hand" has no field in either payload, so there is
                    no tile for it — see social/personalBests.ts. */}
                {(() => {
                  const tiles = personalBestTiles({ rank: cred.rank, stats: cred.stats });
                  return tiles.length ? (
                    <div className="personal-bests" data-testid="personal-bests">
                      <h4>Personal bests</h4>
                      <div className="soc-stats">
                        {tiles.map((t) => <div key={t.label}><b>{t.value}</b><small>{t.label}</small></div>)}
                      </div>
                    </div>
                  ) : null;
                })()}
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
            {cred?.card?.stats.quits && (
              <>
                <h3>Quits</h3>
                <div data-testid="profile-quits">
                  <StatRows rows={quitStatRows(cred.card.stats.quits)} />
                </div>
                <p className="soc-muted">Rated games only — a quit is a recorded leave that ended a rated game. Disconnects don’t count.</p>
              </>
            )}
            {socialP?.stats && socialP.stats.games > 0 && (
              <>
                <h4>Online record</h4>
                <div data-testid="profile-stats">
                  <StatRows rows={[
                    ['Win streak', `${socialP.stats.streak} (best ${socialP.stats.bestStreak})`],
                    ['MVPs', mvpText(socialP.stats.mvps, socialP.stats.mvpPct)],
                    ['Bid accuracy', `${socialP.stats.accuracy ?? '—'}${socialP.stats.accuracy !== null ? '%' : ''}`],
                    ['Books / hand', String(socialP.stats.booksPerHand ?? '—')],
                    ['Nils made', socialP.stats.nil],
                    ['Shots given', String(socialP.stats.shotsGiven)],
                    ['Shots taken', String(socialP.stats.shotsTaken)],
                    ['1st Round TKOs', String(socialP.stats.tkoDealt ?? 0)],
                    ['TKOs taken', String(socialP.stats.tkoSuffered ?? 0)],
                    ['Tosses forced', String(socialP.stats.tossesForced ?? 0)],
                    ['Tosses conceded', String(socialP.stats.tossesConceded ?? 0)],
                    ['Wheels', String(socialP.stats.wheels)],
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
                {socialP.teams ? (
                  <>
                    <div className="soc-badges">{socialP.teams.length ? socialP.teams.map((t) => (
                      <button type="button" key={t.name} className={`soc-badge-chip team-chip${openTeam === t.name ? ' on' : ''}`}
                        data-testid="team-chip" data-team={t.name} aria-expanded={openTeam === t.name}
                        onClick={() => setOpenTeam(openTeam === t.name ? null : t.name)}>{t.name}</button>
                    )) : <span className="soc-muted">None yet</span>}</div>
                    {openTeam && socialP.teams.find((t) => t.name === openTeam) && (
                      <TeamDetail team={socialP.teams.find((t) => t.name === openTeam)!} onPartner={openProfile}
                        roster={me ? (rosters?.find((r) => r.name === openTeam) ?? null) : undefined}
                        onEjectMember={me && openTeam ? (memberId) => ejectMember(openTeam, memberId) : undefined} />
                    )}
                  </>
                ) : (
                  <div className="soc-badges">{socialP.teamNames.length ? socialP.teamNames.map((t) => <span key={t} className="soc-badge-chip">{t}</span>) : <span className="soc-muted">None yet</span>}</div>
                )}
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
            {me && storyProg && <StoryBadges facts={badgeFactsOf(storyProg)} />}
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
                <b>{COLLECTIBLE_NAMES[u.itemId] ?? u.itemId}</b><small>from {u.source}</small>{u.equipped && <span className="equipped-tag">Equipped</span>}
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
        {!noBack && <button type="button" className="link" onClick={() => social.showProfile(null)} data-testid="profile-back">← Back</button>}
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
