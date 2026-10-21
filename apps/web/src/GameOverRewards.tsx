import { useEffect, useState } from 'react';
import { CoinIcon } from './RepBlock';

/** Minimal profile shape (mirrors /api/profile/me) for reward deltas. */
export interface RewardsProfile {
  level: { level: number; xp: number; title: string; xpForNext: number; xpIntoLevel: number };
  coins: { balance: number };
  rank: {
    team: { elo: number };
    cutthroat: { elo: number };
  };
  achievements: { id: string; title: string; xp: number; coins: number; unlockedAt: number | null }[];
  challenges: {
    daily: { id: string; title: string; xp: number; coins: number; claimed: boolean; progress: number; target: number }[];
    weekly: { id: string; title: string; xp: number; coins: number; claimed: boolean; progress: number; target: number }[];
  };
}

export interface UnlockedItem { id: string; title: string; xp: number; coins: number }

/* ------------------------------------------------------ Postgame Report */

/** One side's line from the finished match (league P-D). */
export interface PostgameSide { label: string; score: number; books: number; nilsMade: number }
export interface PostgameData {
  sides: PostgameSide[];
  /** the viewer's own seat totals */
  myBooks: number;
  myNilsMade: number;
  /** plain-language best moments, in hand order (max 4) */
  moments: string[];
}

/** The structural slice of the engine's HandRecord the report needs. */
export interface PostgameHand {
  handNo: number;
  tricksWon: number[];
  sides: { side: number; tricks: number; points: number; nils: { seat: number; kind: 'nil' | 'blindNil'; made: boolean }[] }[];
}

/**
 * Postgame Report (league P-D): your line vs your opponents' + the match's
 * best moments, computed from the finished game's hand history — the same
 * records the recap shows. HONEST SCOPE: final scores, books and nils are
 * all in the hand records; a nuked trick is NOT (the hand record keeps only
 * trick counts), so nuke moments can't be called out here — reported as a
 * gap rather than reconstructed.
 */
export function buildPostgame(input: {
  history: PostgameHand[];
  finalScores: number[];
  sideLabels: string[];
  seatLabels: string[];
  mySeat: number;
  mySide: number;
}): PostgameData {
  const { history, finalScores, sideLabels, seatLabels, mySeat, mySide } = input;
  const sides: PostgameSide[] = finalScores.map((score, side) => ({
    label: sideLabels[side] ?? `Side ${side + 1}`,
    score,
    books: history.reduce((a, h) => a + (h.sides.find((s) => s.side === side)?.tricks ?? 0), 0),
    nilsMade: history.reduce((a, h) => a + (h.sides.find((s) => s.side === side)?.nils.filter((n) => n.made).length ?? 0), 0),
  }));
  const moments: string[] = [];
  let bestHand = 0;
  let bestHandNo = 0;
  for (const h of history) {
    const totalTricks = h.sides.reduce((a, s) => a + s.tricks, 0);
    for (const s of h.sides) {
      if (totalTricks >= 13 && s.tricks === totalTricks) {
        moments.push(`Boston — ${sideLabels[s.side] ?? `Side ${s.side + 1}`} took every book in hand ${h.handNo}`);
      }
      for (const n of s.nils) {
        if (n.made) moments.push(`${n.seat === mySeat ? 'You' : (seatLabels[n.seat] ?? 'A player')} made a ${n.kind === 'blindNil' ? 'blind nil' : 'nil'} in hand ${h.handNo}`);
      }
      if (s.side === mySide && s.points > bestHand) { bestHand = s.points; bestHandNo = h.handNo; }
    }
  }
  if (bestHand > 0) moments.push(`Your best hand: +${bestHand} points in hand ${bestHandNo}`);
  return {
    sides,
    myBooks: history.reduce((a, h) => a + (h.tricksWon[mySeat] ?? 0), 0),
    myNilsMade: history.reduce((a, h) => a + h.sides.reduce((x, s) => x + s.nils.filter((n) => n.seat === mySeat && n.made).length, 0), 0),
    moments: moments.slice(0, 4),
  };
}

export interface RewardsData {
  won: boolean;
  headline: string;
  sub: string;
  signedIn: boolean;
  xpGained: number;
  levelBefore: number;
  levelAfter: number;
  levelTitle: string;
  xpIntoLevel: number;
  xpForNext: number;
  coinsGained: number;
  eloBefore: number | null;
  eloAfter: number | null;
  eloKindLabel: string;
  achievements: UnlockedItem[];
  challenges: UnlockedItem[];
  /** Postgame Report (league P-D) — attached by Table from the hand history */
  postgame?: PostgameData | null;
}

/** Diff two profile snapshots into a RewardsData. `kind` is 'team' | 'cutthroat'. */
export function computeRewards(
  before: RewardsProfile | null,
  after: RewardsProfile | null,
  opts: { won: boolean; headline: string; sub: string; kind: 'team' | 'cutthroat' },
): RewardsData {
  const base: RewardsData = {
    won: opts.won,
    headline: opts.headline,
    sub: opts.sub,
    signedIn: !!(before && after),
    xpGained: 0,
    levelBefore: before?.level.level ?? 1,
    levelAfter: after?.level.level ?? before?.level.level ?? 1,
    levelTitle: after?.level.title ?? before?.level.title ?? '',
    xpIntoLevel: after?.level.xpIntoLevel ?? 0,
    xpForNext: after?.level.xpForNext ?? 1,
    coinsGained: 0,
    eloBefore: null,
    eloAfter: null,
    eloKindLabel: opts.kind === 'team' ? 'Partnership' : 'Cutthroat',
    achievements: [],
    challenges: [],
  };
  if (!before || !after) return base;
  base.xpGained = Math.max(0, after.level.xp - before.level.xp);
  base.coinsGained = Math.max(0, after.coins.balance - before.coins.balance);
  const rb = opts.kind === 'team' ? before.rank.team.elo : before.rank.cutthroat.elo;
  const ra = opts.kind === 'team' ? after.rank.team.elo : after.rank.cutthroat.elo;
  base.eloBefore = rb;
  base.eloAfter = ra;
  const beforeUnlocked = new Set(before.achievements.filter((a) => a.unlockedAt != null).map((a) => a.id));
  base.achievements = after.achievements
    .filter((a) => a.unlockedAt != null && !beforeUnlocked.has(a.id))
    .map((a) => ({ id: a.id, title: a.title, xp: a.xp, coins: a.coins }));
  const beforeClaimed = new Set([
    ...before.challenges.daily.filter((c) => c.claimed).map((c) => c.id),
    ...before.challenges.weekly.filter((c) => c.claimed).map((c) => c.id),
  ]);
  const newly = [
    ...after.challenges.daily.filter((c) => c.claimed && !beforeClaimed.has(c.id)),
    ...after.challenges.weekly.filter((c) => c.claimed && !beforeClaimed.has(c.id)),
  ];
  base.challenges = newly.map((c) => ({ id: c.id, title: c.title, xp: c.xp, coins: c.coins }));
  return base;
}

async function api<T>(path: string): Promise<T> {
  const r = await fetch(path, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export function fetchRewardsProfile(): Promise<RewardsProfile | null> {
  return api<RewardsProfile>('/api/profile/me').catch(() => null);
}

// ── Before-snapshot pinning (owner-approved fix, 2026-10-20) ───────────────
// The rewards breakdown is a diff of two profile snapshots (before/after), so
// the "before" MUST be the profile as it was when the match started. Table used
// to capture it in a mount-only effect: a mid-game remount (e.g. the 30-minute
// inactivity sign-out bounce, which never sends a room leave) silently retook
// it — and once the server's game-end credit landed, before == after and the
// player saw +0 for a game they had actually earned in (LovleyT714's 24 XP).
// Pin the FIRST snapshot per match (keyed by the game seed) in sessionStorage
// — same storage family as the bwm.rewards.v1 breakdown stash — and reuse it
// across remounts. openRewards clears the pin after consuming it.
const BEFORE_KEY = 'bwm.rewards.before.v1';

interface PinnedBefore { seed: string; profile: RewardsProfile }

/** The pinned before-snapshot for `seed`, or undefined if none was pinned for this match. */
export function loadPinnedBefore(seed: string): RewardsProfile | null | undefined {
  if (!seed) return undefined;
  try {
    const raw = sessionStorage.getItem(BEFORE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as PinnedBefore;
    if (!parsed || parsed.seed !== seed || !parsed.profile) return undefined;
    return parsed.profile;
  } catch { return undefined; }
}

export function pinBefore(seed: string, profile: RewardsProfile): void {
  if (!seed) return;
  try {
    sessionStorage.setItem(BEFORE_KEY, JSON.stringify({ seed, profile } satisfies PinnedBefore));
  } catch { /* storage full/blocked — pinning is best-effort */ }
}

export function clearPinnedBefore(): void {
  try { sessionStorage.removeItem(BEFORE_KEY); } catch { /* ignore */ }
}

/**
 * Resolve the "before" snapshot for a match: the pinned snapshot for this seed
 * if one exists (remount-safe — never retaken), otherwise fetch the profile
 * now and pin it. A failed fetch (null — guest or transient error) is NOT
 * pinned, so a later remount can retry the capture.
 */
export async function resolveBeforeSnapshot(
  seed: string,
  fetchProfile: () => Promise<RewardsProfile | null> = fetchRewardsProfile,
): Promise<RewardsProfile | null> {
  const pinned = loadPinnedBefore(seed);
  if (pinned !== undefined) return pinned;
  const profile = await fetchProfile();
  if (profile) pinBefore(seed, profile);
  return profile;
}

// ── After-snapshot bounded retry ────────────────────────────────────────────
// Game-end credits are written asynchronously on the server (ctx.waitUntil),
// so the first "after" fetch in openRewards can beat them and diff to +0. For
// a signed-in ONLINE match whose computed XP/coins delta is exactly zero,
// re-fetch a few times over ~2s and keep the first diff that moves; proceed
// with whatever we have once retries run out — the leave flow never hangs.
export const AFTER_RETRY_DELAYS_MS = [400, 600, 1000];

const sleepMs = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export async function computeRewardsSettled(
  before: RewardsProfile | null,
  opts: { won: boolean; headline: string; sub: string; kind: 'team' | 'cutthroat' },
  cfg: {
    online: boolean;
    fetchProfile?: () => Promise<RewardsProfile | null>;
    sleep?: (ms: number) => Promise<void>;
    delaysMs?: number[];
  },
): Promise<RewardsData> {
  const fetchProfile = cfg.fetchProfile ?? fetchRewardsProfile;
  const sleep = cfg.sleep ?? sleepMs;
  const delays = cfg.delaysMs ?? AFTER_RETRY_DELAYS_MS;
  let after = await fetchProfile();
  let data = computeRewards(before, after, opts);
  // Only a signed-in online match can be owed an async credit; guests and
  // offline games keep the old single-fetch behavior.
  if (!cfg.online || !before) return data;
  for (const delay of delays) {
    if (data.xpGained > 0 || data.coinsGained > 0) break;
    await sleep(delay);
    after = await fetchProfile();
    data = computeRewards(before, after, opts);
  }
  return data;
}

/** Ease-out cubic count-up. */
function useCountUp(target: number, duration = 900, delay = 0): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0;
    let start: number | null = null;
    const t = window.setTimeout(() => {
      const step = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min(1, (ts - start) / duration);
        setVal(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, delay);
    return () => { window.clearTimeout(t); cancelAnimationFrame(raf); };
  }, [target, duration, delay]);
  return val;
}

function XpRow({ d, index }: { d: RewardsData; index: number }) {
  const xp = useCountUp(d.xpGained, 1000, 200 + index * 160);
  const pct = Math.min(100, Math.max(0, (d.xpIntoLevel / Math.max(1, d.xpForNext)) * 100));
  const leveled = d.levelAfter > d.levelBefore;
  return (
    <div className="rw-row" style={{ animationDelay: `${index * 160}ms` }}>
      <div className="rw-icon">⚡</div>
      <div className="rw-body">
        <div className="rw-top"><span>XP earned</span><b className="rw-num">+{xp.toLocaleString()}</b></div>
        <div className="rw-levelbar"><div className="rw-levelbar-fill" style={{ width: `${pct}%` }} /></div>
        <div className="rw-sub">
          Level {d.levelAfter}{d.levelTitle ? ` · ${d.levelTitle}` : ''} · {d.xpIntoLevel.toLocaleString()}/{d.xpForNext.toLocaleString()} XP
          {leveled && <span className="rw-levelup"> LEVEL UP!</span>}
        </div>
      </div>
    </div>
  );
}

function CoinsRow({ d, index }: { d: RewardsData; index: number }) {
  const coins = useCountUp(d.coinsGained, 1000, 200 + index * 160);
  return (
    <div className="rw-row" style={{ animationDelay: `${index * 160}ms` }}>
      <div className="rw-icon"><CoinIcon size={22} /></div>
      <div className="rw-body">
        <div className="rw-top"><span>Coins earned</span><b className="rw-num gold">+{coins.toLocaleString()}</b></div>
        <div className="rw-sub">Spend them at the stake tables</div>
      </div>
    </div>
  );
}

function EloRow({ d, index }: { d: RewardsData; index: number }) {
  if (d.eloBefore == null || d.eloAfter == null) return null;
  const delta = d.eloAfter - d.eloBefore;
  // Plain-language labels (Demetrius 2026-10-19): "Partnership rating / 1,000 → 1,000 Elo"
  // meant nothing to players. Say what it is and what happened, in words.
  const label = d.eloKindLabel === 'Partnership' ? 'Team rating' : 'Cutthroat rating';
  if (delta === 0) {
    return (
      <div className="rw-row" style={{ animationDelay: `${index * 160}ms` }}>
        <div className="rw-icon">➖</div>
        <div className="rw-body">
          <div className="rw-top">
            <span>{label}</span>
            <b className="rw-num">{d.eloAfter.toLocaleString()}</b>
          </div>
          <div className="rw-sub">No change — ratings only move in rated games vs. real opponents</div>
        </div>
      </div>
    );
  }
  const up = delta > 0;
  return (
    <div className="rw-row" style={{ animationDelay: `${index * 160}ms` }}>
      <div className="rw-icon">{up ? '📈' : '📉'}</div>
      <div className="rw-body">
        <div className="rw-top">
          <span>{label}</span>
          <b className={`rw-num ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(delta)}</b>
        </div>
        <div className="rw-sub">{d.eloBefore.toLocaleString()} → {d.eloAfter.toLocaleString()} · Went {up ? 'up' : 'down'} {Math.abs(delta)} after this {d.won ? 'win' : 'loss'}</div>
      </div>
    </div>
  );
}

export default function GameOverRewards({
  data,
  onHome,
  onRematch,
  onProfile,
  onOpenTables,
}: {
  data: RewardsData;
  onHome: () => void;
  onRematch: () => void;
  onProfile: () => void;
  onOpenTables: () => void;
}) {
  let row = 0;
  const rows: React.ReactNode[] = [];
  if (data.signedIn) {
    rows.push(<XpRow key="xp" d={data} index={row++} />);
    if (data.coinsGained > 0) rows.push(<CoinsRow key="coins" d={data} index={row++} />);
    rows.push(<EloRow key="elo" d={data} index={row++} />);
    for (const a of data.achievements) {
      const i = row++;
      rows.push(
        <div key={`a-${a.id}`} className="rw-row" style={{ animationDelay: `${i * 160}ms` }}>
          <div className="rw-icon">🏆</div>
          <div className="rw-body">
            <div className="rw-top"><span>Achievement: {a.title}</span><b className="rw-num small">+{a.xp} XP{a.coins ? ` · +${a.coins}` : ''}</b></div>
          </div>
        </div>,
      );
    }
    for (const c of data.challenges) {
      const i = row++;
      rows.push(
        <div key={`c-${c.id}`} className="rw-row" style={{ animationDelay: `${i * 160}ms` }}>
          <div className="rw-icon">✅</div>
          <div className="rw-body">
            <div className="rw-top"><span>Challenge: {c.title}</span><b className="rw-num small">+{c.xp} XP{c.coins ? ` · +${c.coins}` : ''}</b></div>
          </div>
        </div>,
      );
    }
  }
  return (
    <div className="rewards-page" aria-label="Match rewards" data-testid="rewards">
      <div className="rw-card">
        <div className="rw-head" style={{ animationDelay: '0ms' }}>
          <div className="rw-trophy">{data.won ? '🏆' : '♠'}</div>
          <h2 className={data.won ? 'win' : 'lose'}>{data.headline}</h2>
          <p className="rw-sub0">{data.sub}</p>
        </div>
        {data.postgame && (
          <div className="rw-postgame" data-testid="postgame-report">
            <h3 className="rw-pg-title">Postgame Report</h3>
            <table className="cmp-table">
              <thead><tr><th></th><th>Final</th><th>Books</th><th>Nils made</th></tr></thead>
              <tbody>
                {data.postgame.sides.map((s) => (
                  <tr key={s.label}><th>{s.label}</th><td>{s.score}</td><td>{s.books}</td><td>{s.nilsMade}</td></tr>
                ))}
                <tr><th>Your books</th><td colSpan={3}>{data.postgame.myBooks} books{data.postgame.myNilsMade > 0 ? ` · ${data.postgame.myNilsMade} nil${data.postgame.myNilsMade === 1 ? '' : 's'} made` : ''}</td></tr>
              </tbody>
            </table>
            {data.postgame.moments.length > 0 && (
              <ul className="rw-moments">
                {data.postgame.moments.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="rw-rows">
          {data.signedIn ? rows : (
            <div className="rw-row" style={{ animationDelay: '160ms' }}>
              <div className="rw-icon">👤</div>
              <div className="rw-body">
                <div className="rw-top"><span>Sign in to earn Rep rewards</span></div>
                <div className="rw-sub">XP, coins, and achievements are tracked on your account</div>
              </div>
            </div>
          )}
        </div>
        <div className="rw-actions" style={{ animationDelay: `${(row + 1) * 160}ms` }}>
          <button type="button" className="primary big" data-testid="rewards-home" onClick={onHome}>Home</button>
          <button type="button" className="ghost-btn rw-rematch-btn" data-testid="rewards-rematch" onClick={onRematch}>Rematch</button>
          <div className="rw-actions-row">
            <button type="button" className="ghost-btn" data-testid="rewards-profile" onClick={onProfile}>Profile</button>
            <button type="button" className="ghost-btn" data-testid="rewards-tables" onClick={onOpenTables}>Open Tables</button>
          </div>
        </div>
      </div>
    </div>
  );
}
