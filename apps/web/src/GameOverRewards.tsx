import { useEffect, useRef, useState } from 'react';
import { CoinIcon } from './RepBlock';
import { fx, useReduceEffects } from './fx';

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
  /** the hand's nuked trick (both Jokers in one trick), stamped by the
   *  engine at record time — absent on histories saved before it existed */
  nuke?: { seat: number };
}

/**
 * Postgame Report (league P-D): your line vs your opponents' + the match's
 * best moments, computed from the finished game's hand history — the same
 * records the recap shows. The engine stamps the nuked trick into the hand
 * record at finish time (league data wave), so the nuke gets its callout
 * too; histories saved before the stamp existed simply omit the moment.
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
    if (h.nuke) {
      moments.push(`☢ ${h.nuke.seat === mySeat ? 'You' : (seatLabels[h.nuke.seat] ?? 'A player')} blew the nuke in hand ${h.handNo}`);
    }
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
  /** level-bar progress BEFORE this match (pinned before-snapshot): the
   *  reveal starts the bar here and fills to the after values above */
  xpIntoLevelBefore: number;
  xpForNextBefore: number;
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
    xpIntoLevelBefore: before?.level.xpIntoLevel ?? 0,
    xpForNextBefore: before?.level.xpForNext ?? 1,
    coinsGained: 0,
    eloBefore: null,
    eloAfter: null,
    eloKindLabel: opts.kind === 'team' ? 'Partnership' : 'Cutthroat',
    achievements: [],
    challenges: [],
  };
  if (!before || !after) return base;
  base.xpGained = Math.max(0, after.level.xp - before.level.xp);
  base.xpIntoLevelBefore = before.level.xpIntoLevel;
  base.xpForNextBefore = Math.max(1, before.level.xpForNext);
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

/**
 * The reveal gate (owner report, 2026-10-20: "the animation never plays on
 * this screen — when it loads the points are already present"). This screen
 * is reached by a FULL page load (Table's openRewards navigates with
 * location.href), and every part of the show used to be armed at MOUNT: the
 * CSS reveals (rw-in / rw-pop / rw-card-in) start their timelines the moment
 * the elements are styled, and the old count-up ran on a mount timer. On a
 * slow first paint — an installed PWA still showing the previous screen
 * while the bundle and fonts load — the whole ~1.5s sequence elapsed
 * before the page was ever visible, so the player only ever saw the end
 * state. The gate holds everything in its pre-reveal state until the
 * browser has actually painted the screen (two animation frames after
 * mount, and only once the document is visible), then flips `play` once:
 * the CSS animations start on the class change and the tweens start on the
 * same tick — all of it on-screen. Reduced motion (the app's Reduce
 * effects, or the OS reduce-motion setting) never arms: the final state,
 * rendered instantly, is the correct presentation there.
 */
function useRewardsReveal(): { play: boolean; reduced: boolean } {
  const reduceFx = useReduceEffects();
  const reduced = reduceFx || fx.osReducedMotion;
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (reduced || play) return;
    let raf1 = 0;
    let raf2 = 0;
    let offVis: (() => void) | null = null;
    const arm = () => {
      raf1 = requestAnimationFrame(() => {
        raf2 = requestAnimationFrame(() => setPlay(true));
      });
    };
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      const onVis = () => { if (document.visibilityState === 'visible') arm(); };
      document.addEventListener('visibilitychange', onVis);
      offVis = () => document.removeEventListener('visibilitychange', onVis);
    } else {
      arm();
    }
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); offVis?.(); };
  }, [reduced, play]);
  return { play, reduced };
}

/**
 * Ease-out cubic tween from `from` to `to`, driven by the reveal gate:
 * before the gate opens the value sits AT `from` (the pre-game value — 0
 * for the earned counters, the old rating for the rating row); reduced
 * motion jumps straight to `to`. If `to` changes mid-flight (a settled
 * re-check landing a corrected value), the tween re-targets from wherever
 * it currently is — never a snap back to the start.
 */
function useTweenValue(from: number, to: number, o: { play: boolean; reduced: boolean; duration?: number; delay?: number }): number {
  const duration = o.duration ?? 1000;
  const delay = o.delay ?? 0;
  const [val, setVal] = useState(from);
  const valRef = useRef(from);
  const startedRef = useRef(false);
  useEffect(() => { valRef.current = val; }, [val]);
  useEffect(() => {
    if (o.reduced) { setVal(to); return; }
    if (!o.play) { setVal(from); return; }
    let raf = 0;
    let start: number | null = null;
    const startVal = valRef.current;
    const wait = startedRef.current ? 0 : delay;
    const t = window.setTimeout(() => {
      startedRef.current = true;
      const step = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min(1, (ts - start) / duration);
        setVal(Math.round(startVal + (to - startVal) * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, wait);
    return () => { window.clearTimeout(t); cancelAnimationFrame(raf); };
  }, [from, to, o.play, o.reduced, duration, delay]);
  return val;
}

const pctOf = (into: number, span: number) => Math.min(100, Math.max(0, (into / Math.max(1, span)) * 100));

/**
 * The level bar's choreography: it renders at the PRE-game progress (from
 * the pinned before-snapshot) and, once the reveal plays, fills to the
 * post-game progress. A level-up fills the old level's bar to full, snaps
 * to empty, and fills into the new level. Reduced motion shows the final
 * width immediately; a value that changes after the fill simply updates.
 */
function useXpBar(o: { play: boolean; reduced: boolean; beforePct: number; afterPct: number; leveled: boolean; delay: number }): { pct: number; cls: string } {
  const [pct, setPct] = useState(() => (o.reduced ? o.afterPct : o.beforePct));
  const [instant, setInstant] = useState(false);
  const [fast, setFast] = useState(false);
  useEffect(() => {
    if (o.reduced) { setInstant(true); setPct(o.afterPct); return; }
    if (!o.play) { setPct(o.beforePct); return; }
    const timers: number[] = [];
    let raf1 = 0;
    let raf2 = 0;
    if (!o.leveled) {
      timers.push(window.setTimeout(() => setPct(o.afterPct), o.delay));
    } else {
      setFast(true);
      timers.push(window.setTimeout(() => setPct(100), o.delay));
      timers.push(window.setTimeout(() => {
        setInstant(true);
        setPct(0);
        raf1 = requestAnimationFrame(() => {
          raf2 = requestAnimationFrame(() => { setInstant(false); setPct(o.afterPct); });
        });
      }, o.delay + 620));
    }
    return () => { timers.forEach((t) => window.clearTimeout(t)); cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [o.play, o.reduced, o.beforePct, o.afterPct, o.leveled, o.delay]);
  return { pct, cls: `${instant ? ' instant' : ''}${fast ? ' fast' : ''}` };
}

function XpRow({ d, index, play, reduced }: { d: RewardsData; index: number; play: boolean; reduced: boolean }) {
  const xp = useTweenValue(0, d.xpGained, { play, reduced, duration: 1000, delay: 200 + index * 160 });
  const bar = useXpBar({
    play, reduced,
    beforePct: pctOf(d.xpIntoLevelBefore ?? 0, d.xpForNextBefore ?? 1),
    afterPct: pctOf(d.xpIntoLevel, d.xpForNext),
    leveled: d.levelAfter > d.levelBefore,
    delay: 200 + index * 160,
  });
  const leveled = d.levelAfter > d.levelBefore;
  return (
    <div className="rw-row" style={{ animationDelay: `${index * 160}ms` }}>
      <div className="rw-icon">⚡</div>
      <div className="rw-body">
        <div className="rw-top"><span>XP earned</span><b className="rw-num">+{xp.toLocaleString()}</b></div>
        <div className="rw-levelbar"><div className={`rw-levelbar-fill${bar.cls}`} style={{ width: `${bar.pct}%` }} /></div>
        <div className="rw-sub">
          Level {d.levelAfter}{d.levelTitle ? ` · ${d.levelTitle}` : ''} · {d.xpIntoLevel.toLocaleString()}/{d.xpForNext.toLocaleString()} XP
          {leveled && <span className="rw-levelup"> LEVEL UP!</span>}
        </div>
      </div>
    </div>
  );
}

function CoinsRow({ d, index, play, reduced }: { d: RewardsData; index: number; play: boolean; reduced: boolean }) {
  const coins = useTweenValue(0, d.coinsGained, { play, reduced, duration: 1000, delay: 200 + index * 160 });
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

function EloRow({ d, index, play, reduced }: { d: RewardsData; index: number; play: boolean; reduced: boolean }) {
  const delta = d.eloBefore != null && d.eloAfter != null ? d.eloAfter - d.eloBefore : 0;
  const shown = useTweenValue(0, Math.abs(delta), { play, reduced, duration: 1000, delay: 200 + index * 160 });
  if (d.eloBefore == null || d.eloAfter == null) return null;
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
          <b className={`rw-num ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {shown.toLocaleString()}</b>
        </div>
        <div className="rw-sub">{d.eloBefore.toLocaleString()} → {d.eloAfter.toLocaleString()} · Went {up ? 'up' : 'down'} {Math.abs(delta)} after this {d.won ? 'win' : 'loss'}</div>
      </div>
    </div>
  );
}

/** Guest-claim panel state (retroactive claim, 2026-10-22): the finished
 *  match was played signed-out and its result is held as a pending claim. */
export interface GuestClaimUi {
  /** a claim for this match is being held on this device */
  held: boolean;
  /** the claim post is in flight */
  claiming: boolean;
  onSignIn: () => void;
}

export default function GameOverRewards({
  data,
  onHome,
  onRematch,
  onProfile,
  onOpenTables,
  guestClaim,
}: {
  data: RewardsData;
  onHome: () => void;
  onRematch: () => void;
  onProfile: () => void;
  onOpenTables: () => void;
  guestClaim?: GuestClaimUi;
}) {
  const { play, reduced } = useRewardsReveal();
  let row = 0;
  const rows: React.ReactNode[] = [];
  if (data.signedIn) {
    rows.push(<XpRow key="xp" d={data} index={row++} play={play} reduced={reduced} />);
    if (data.coinsGained > 0) rows.push(<CoinsRow key="coins" d={data} index={row++} play={play} reduced={reduced} />);
    rows.push(<EloRow key="elo" d={data} index={row++} play={play} reduced={reduced} />);
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
    <div className={`rewards-page rw-armed${play ? ' rw-play' : '' }${reduced ? ' rw-reduced' : ''}`} aria-label="Match rewards" data-testid="rewards">
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
          {data.signedIn ? rows : guestClaim && (guestClaim.held || guestClaim.claiming) ? (
            <div className="rw-row" style={{ animationDelay: '160ms' }} aria-busy={guestClaim.claiming || undefined}>
              <div className="rw-icon">👤</div>
              <div className="rw-body">
                <div className="rw-top"><span>{guestClaim.claiming ? 'Claiming your rewards…' : 'This game’s rewards are held for you'}</span></div>
                <div className="rw-sub">{guestClaim.claiming ? 'Putting this match on your account.' : 'Sign in to claim the XP, coins, and achievements from this match.'}</div>
                {!guestClaim.claiming && (
                  <button type="button" className="primary rw-claim-btn" data-testid="rewards-claim-signin" onClick={guestClaim.onSignIn}>Sign in &amp; claim</button>
                )}
              </div>
            </div>
          ) : (
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
