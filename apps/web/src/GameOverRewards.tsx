import { useEffect, useRef, useState, type RefObject } from 'react';
import { CoinIcon } from './RepBlock';
import { CardTakeover, CARD_TAKEOVER_DELAY_MS, CARD_TAKEOVER_EXIT_MS, cardTakeoverKey, markTakeoverCelebrated, takeoverCelebrated } from './CardTakeover';
import { VictoryConfetti } from './RecapFx';
import { cardDisplayName, rankGlyph } from './cardRank';
import { fx, useReduceEffects } from './fx';
import { PlayerCard, type CardRankData, type PlayerCardData } from './profile/PlayerCard';

/** Minimal profile shape (mirrors /api/profile/me) for reward deltas. */
export interface RewardsProfile {
  level: { level: number; xp: number; title: string; xpForNext: number; xpIntoLevel: number };
  /** the Player Card payload (rank card + the full card for the reveal);
   *  optional because a before-snapshot pinned by an older build lacks it */
  card?: PlayerCardData;
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
  /** Play-Well bonuses (owner, 2026-10-29): the player's LATEST game's
   *  bonus row from the server (cred_playwell) — the feat lines exactly
   *  as paid at game end. Optional because a before-snapshot pinned by
   *  an older build lacks it. */
  playWell?: { gameId: string; xp: number; coins: number; lines: PlayWellLine[] } | null;
}

/** One Play-Well feat line, exactly as paid at game end (server-computed). */
export interface PlayWellLine { id: string; label: string; xp: number; coins: number }

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
  /** Rank cards from the before/after snapshots — server-derived
   *  (cred/xp.ts cardRankForLevel, carried on the card payload), never
   *  recomputed here. Null when a snapshot predates the card payload. */
  rankBefore: CardRankData | null;
  rankAfter: CardRankData | null;
  /** The full AFTER card payload — the card-up reveal presents it. */
  cardAfter: PlayerCardData | null;
  /** The rank stepped UP this match: a level gain (every level is a card
   *  step) or the Big Joker switching on at level 50. */
  cardUp: boolean;
  /** The step-up landed on the prestige Big Joker (step 51). */
  bigJokerUp: boolean;
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
  /** Play-Well bonus earned in THIS match (feat lines as paid), or null
   *  when the match earned none. The XP/coins are already inside
   *  xpGained/coinsGained — this section only itemizes them. Optional
   *  like postgame: stashes written by older builds lack it. */
  playWell?: { xp: number; coins: number; lines: PlayWellLine[] } | null;
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
    rankBefore: before?.card?.rank ?? null,
    rankAfter: after?.card?.rank ?? before?.card?.rank ?? null,
    cardAfter: after?.card ?? null,
    cardUp: false,
    bigJokerUp: false,
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
    playWell: null,
  };
  if (!before || !after) return base;
  /* The card-up test is a STEP comparison, not a level comparison: steps
   *  1–50 track levels, but the Big Joker (step 51) switches on at an
   *  unchanged level 50 — when this match's own achievements complete the
   *  badge set, or a season's upkeep activates the crown. A legacy
   *  before-snapshot without a card falls back to the level gain (a step
   *  gain everywhere except the prestige step, which it simply can't
   *  see — those pins are per-match and clear after one use). */
  const rankB = before.card?.rank ?? null;
  const rankA = after.card?.rank ?? null;
  base.cardUp = rankB && rankA ? rankA.step > rankB.step : (!rankB && !!rankA && base.levelAfter > base.levelBefore);
  base.bigJokerUp = base.cardUp && !!rankA?.isBigJoker;
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
  /* Play-Well: the after-snapshot's latest bonus row belongs to THIS
   *  match when its game id isn't the one the before-snapshot already
   *  carried (the server writes a row for every credited game, an empty
   *  one included — so a feat-less match's row reads lines: [] and
   *  renders nothing, and an older match's feats can never leak into
   *  this match's breakdown). */
  const pw = after.playWell;
  if (pw && pw.lines.length > 0 && pw.gameId !== before.playWell?.gameId) {
    base.playWell = { xp: pw.xp, coins: pw.coins, lines: pw.lines };
  }
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
 * The rows' own in-view gate (owner, 2026-10-28: "when this screen loads
 * in landscape I never get to see the animation"). The reveal gate above
 * proves the PAGE painted, but it says nothing about the ROWS: in
 * landscape the card is far taller than the viewport and the Postgame
 * Report sits ahead of the reward rows, so at load the rows are below
 * the fold — the mount gate spent their slide-in and count-ups unseen,
 * and scrolling down found the final numbers already sitting there
 * (portrait fits the whole card, which is why only landscape lost the
 * show). The rows now hold until they actually reach the viewport —
 * the same in-view discipline the set covers use (the sc-wait gate) —
 * then play exactly as before. Reduced motion skips the wait: the
 * final state is already the presentation there.
 */
function useRowsInView(ref: RefObject<HTMLDivElement | null>, play: boolean, reduced: boolean): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (reduced || inView || !play) return;
    const el = ref.current;
    if (!el) return;
    const check = () => {
      // A readable band of the rows (~56 px — a row's header and number)
      // must be inside the viewport: at load in landscape only a sliver
      // of the first row peeks past the fold, and a gate that fired on
      // the sliver would still spend the show mostly unseen. Scrolled
      // fully past counts too (a fast flick to the actions must not
      // strand them).
      if (el.getBoundingClientRect().top < window.innerHeight - 56) { setInView(true); return true; }
      return false;
    };
    if (check()) return;
    const onMove = () => { check(); };
    window.addEventListener('scroll', onMove, { passive: true, capture: true });
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
    };
  }, [ref, play, reduced, inView]);
  return reduced || inView;
}

/* ── Count-up performance (owner, 2026-10-30: "as it counts up here the
 * rolling numbers should change colors and enlarge") ─────────────────────
 * One treatment for every rolling number on this screen, built on the
 * tween below: as a number counts it GROWS (transform scale only — zero
 * layout shift; tabular figures keep digit widths steady), its color
 * TRAVELS through the theme's accent ramp, crossing a round milestone
 * earns a micro-pulse (a beat of extra scale + brightness), and the
 * landing gets a settle pop — a slight overshoot, then rest. The
 * displayed integer is the tween's own value: it can arrive at the
 * target but never passes it; only the scale pops. At rest the inline
 * styles come off entirely, so the final color is exactly the surface's
 * own semantic color (the class on the wrapping element) — and a number
 * with nowhere to go (a zero delta) never performs at all. */

type Rgb = [number, number, number];

function hexRgb(hex: string, fallback: Rgb): Rgb {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

const rgbCss = (c: Rgb) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;

/** The theme's ramp colors, read from the CSS vars on <html> so Classic
 *  and Neon each travel their own palette. Resolved when a RollNum
 *  mounts — the theme is set before this page renders. */
function themeRamp() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    ink: hexRgb(v('--ink', '#f6f2ff'), [246, 242, 255]),
    muted: hexRgb(v('--muted', '#b3a7cc'), [179, 167, 204]),
    lav: hexRgb(v('--lav', '#cdb8ff'), [205, 184, 255]),
    accent: hexRgb(v('--purple-hot', '#b980ff'), [185, 128, 255]),
    gold: hexRgb(v('--gold', '#f5c542'), [245, 197, 66]),
    goldHi: hexRgb(v('--gold-hi', '#ffd969'), [255, 217, 105]),
    panel: hexRgb(v('--panel', '#140b22'), [20, 11, 34]),
    white: [255, 255, 255] as Rgb,
    up: [125, 255, 154] as Rgb,
    down: [255, 138, 138] as Rgb,
  };
}

type RampTheme = ReturnType<typeof themeRamp>;
type RampStop = [number, Rgb];

/** The color journey per surface. Every ramp starts at the resting ink
 *  family and its LAST stop is the surface's resting semantic color, so
 *  the travel is a visit, never a repaint: gold-class for gains/wins,
 *  gains through the accent to bright white (XP) or green (rating up);
 *  losses cool through lavender toward their red; table tallies land
 *  back on the table's ink. */
export type RollTone = 'gainGold' | 'gainBright' | 'gainGreen' | 'lossRed' | 'scoreWin' | 'scoreLoss' | 'scoreFlat' | 'smallGain';

function rampFor(tone: RollTone, t: RampTheme): RampStop[] {
  switch (tone) {
    case 'gainGold': return [[0, t.muted], [0.45, t.accent], [0.8, t.goldHi], [1, t.gold]];
    case 'gainBright': return [[0, t.muted], [0.45, t.accent], [0.78, t.goldHi], [1, t.white]];
    case 'gainGreen': return [[0, t.muted], [0.55, t.lav], [1, t.up]];
    case 'lossRed': return [[0, t.muted], [0.5, t.lav], [1, t.down]];
    case 'scoreWin': return [[0, t.muted], [0.45, t.accent], [0.8, t.goldHi], [1, t.ink]];
    case 'scoreLoss': return [[0, t.muted], [0.5, t.lav], [0.82, mixRgb(t.lav, t.down, 0.55)], [1, t.ink]];
    case 'scoreFlat': return [[0, t.muted], [0.6, t.lav], [1, t.ink]];
    case 'smallGain': return [[0, mixRgb(t.muted, t.panel, 0.4)], [0.55, t.lav], [1, t.muted]];
  }
}

function sampleRamp(stops: RampStop[], p: number): Rgb {
  if (p <= 0) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    if (p <= stops[i]![0]) {
      const [p0, c0] = stops[i - 1]!;
      const [p1, c1] = stops[i]!;
      return mixRgb(c0, c1, (p - p0) / Math.max(1e-6, p1 - p0));
    }
  }
  return stops[stops.length - 1]![1];
}

/** How much a count grows, by the size of the count itself: big tallies
 *  earn a bigger swell, capped so nothing reads cartoonish. */
function growthFor(delta: number, cap: number): number {
  return Math.min(cap, 0.07 + 0.055 * Math.log10(Math.max(1, Math.abs(delta))));
}

interface RollState { val: number; p: number; pulse: number; done: boolean }

/**
 * Ease-out cubic tween from `from` to `to`, driven by the reveal gate:
 * before the gate opens the value sits AT `from` (the pre-game value — 0
 * for the earned counters, the old rating for the rating row); reduced
 * motion jumps straight to `to`. If `to` changes mid-flight (a settled
 * re-check landing a corrected value), the tween re-targets from wherever
 * it currently is — never a snap back to the start.
 *
 * Alongside the value it reports the performance signals for RollNum:
 * eased progress `p` (growth + color travel ride it, so size and color
 * track how much of the count is covered) and a milestone `pulse` — when
 * |value| crosses a multiple of `step`, the pulse envelope restarts and
 * decays over ~230 ms of frame time. Timing is the plain tween's own —
 * same delay, same duration, same ease — so counts finish exactly when
 * they always did and the XP bar stays in sync.
 */
function useRollValue(from: number, to: number, o: { play: boolean; reduced: boolean; duration?: number; delay?: number; step?: number }): RollState {
  const duration = o.duration ?? 1000;
  const delay = o.delay ?? 0;
  const step = o.step ?? 0;
  const [st, setSt] = useState<RollState>({ val: from, p: 0, pulse: 0, done: false });
  const valRef = useRef(from);
  const startedRef = useRef(false);
  useEffect(() => { valRef.current = st.val; }, [st.val]);
  useEffect(() => {
    if (o.reduced) { setSt({ val: to, p: 1, pulse: 0, done: true }); return; }
    if (!o.play) { setSt({ val: from, p: 0, pulse: 0, done: false }); return; }
    let raf = 0;
    let start: number | null = null;
    const startVal = valRef.current;
    const wait = startedRef.current ? 0 : delay;
    const t = window.setTimeout(() => {
      startedRef.current = true;
      let lastMile = step > 0 ? Math.floor(Math.abs(startVal) / step) : 0;
      let pulseStart = Number.NEGATIVE_INFINITY;
      const frame = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min(1, (ts - start) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = Math.round(startVal + (to - startVal) * eased);
        if (step > 0 && p < 1) {
          const mile = Math.floor(Math.abs(val) / step);
          if (mile > lastMile) { lastMile = mile; pulseStart = ts; }
        }
        const pulse = pulseStart === Number.NEGATIVE_INFINITY ? 0 : Math.max(0, 1 - (ts - pulseStart) / 230);
        setSt({ val, p: eased, pulse, done: p >= 1 });
        if (p < 1) raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
    }, wait);
    return () => { window.clearTimeout(t); cancelAnimationFrame(raf); };
  }, [from, to, o.play, o.reduced, duration, delay, step]);
  return st;
}

/**
 * The tone for a FINAL TALLY on a standings surface (the in-table victory
 * overlay's placements, the box score's Final row). Those surfaces rest
 * the winning side's tally at gold and everyone else at ink, so the
 * winner warms to gold — whatever the sign of their score (a side can
 * win a shot-out ending while behind on points, and the sheet still
 * crowns them in gold) — while a non-winner NEVER travels gold: a
 * negative tally cools through the lavender-red path, any other stays
 * flat. Every ramp lands exactly on the surface's resting color.
 */
export function tallyTone(score: number, winner: boolean): RollTone {
  if (winner) return 'gainGold';
  return score < 0 ? 'scoreLoss' : 'scoreFlat';
}

/**
 * A rolling number with the count-up performance. Renders PLAIN text —
 * no element, no styles — whenever there is nothing to perform: reduced
 * motion, a zero delta, the pre-gate hold, and the final rest state.
 * During the count (and the brief settle that follows it) it renders an
 * inline-block span carrying only transform + color, so the surrounding
 * layout never moves.
 */
export function RollNum({
  from = 0, to, play, reduced, duration, delay, step, tone, format, origin = '50% 50%', maxGrow = 0.26,
}: {
  from?: number;
  to: number;
  play: boolean;
  reduced: boolean;
  duration?: number;
  delay?: number;
  step?: number;
  tone: RollTone;
  format: (v: number) => string;
  origin?: string;
  maxGrow?: number;
}) {
  const st = useRollValue(from, to, { play, reduced, duration, delay, step });
  const [ramp] = useState<RampStop[]>(() => rampFor(tone, themeRamp()));
  const [phase, setPhase] = useState<'roll' | 'pop' | 'rest' | 'gone'>('roll');
  const active = !reduced && to !== from;
  useEffect(() => {
    if (!active) return;
    if (!st.done) { setPhase('roll'); return; }
    setPhase('pop');
    const t1 = window.setTimeout(() => setPhase('rest'), 170);
    const t2 = window.setTimeout(() => setPhase('gone'), 540);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [active, st.done]);
  if (!active || (phase === 'gone' && st.done)) return <>{format(to)}</>;
  if (!play && !st.done) return <>{format(from)}</>;
  const grow = growthFor(to - from, maxGrow);
  let scale: number;
  let transition: string | undefined;
  if (!st.done || phase === 'roll') {
    scale = 1 + grow * st.p + 0.055 * st.pulse;
  } else if (phase === 'pop') {
    scale = 1.05 + grow * 0.25;
    transition = 'transform 170ms cubic-bezier(.3,1.5,.4,1)';
  } else {
    scale = 1;
    transition = 'transform 340ms cubic-bezier(.2,.8,.3,1)';
  }
  let color = sampleRamp(ramp, st.done ? 1 : st.p);
  if (!st.done && st.pulse > 0) color = mixRgb(color, [255, 255, 255], st.pulse * 0.4);
  return (
    <span
      className="roll-num"
      data-roll={st.done ? 'done' : 'rolling'}
      style={{
        display: 'inline-block',
        transform: `scale(${scale.toFixed(4)})`,
        transformOrigin: origin,
        color: rgbCss(color),
        ...(transition ? { transition } : {}),
      }}
    >
      {format(st.val)}
    </span>
  );
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
        <div className="rw-top"><span>XP earned</span><b className="rw-num"><RollNum to={d.xpGained} play={play} reduced={reduced} delay={200 + index * 160} step={10} tone="gainBright" origin="100% 50%" format={(v) => `+${v.toLocaleString()}`} /></b></div>
        <div className="rw-levelbar"><div className={`rw-levelbar-fill${bar.cls}`} style={{ width: `${bar.pct}%` }} /></div>
        <div className="rw-sub">
          {d.rankAfter ? <>{rankGlyph(d.rankAfter)} · </> : <>Level {d.levelAfter} · </>}{d.xpIntoLevel.toLocaleString()}/{d.xpForNext.toLocaleString()} XP
          {leveled && <span className="rw-levelup">{d.cardUp ? ' NEW CARD!' : ' LEVEL UP!'}</span>}
        </div>
      </div>
    </div>
  );
}

/**
 * The CARD-UP REVEAL (owner, 2026-10-23: rank is a playing card now, so a
 * rank gain is presented as one): the old card → the new card, the new
 * card itself rendered by the PlayerCard component at deck size — the
 * same object the profile header and (later) the Finder deck show. The
 * Big Joker activation is the grandest version: it can arrive on a match
 * that didn't move the level at all (the badge set completing, a season
 * turning), so the reveal keys on the STEP, not the level. Entrance runs
 * on the reveal gate like every other piece of this screen (held pre-
 * paint by the .rw-armed CSS, instant under reduced motion).
 */
function CardUpRow({ d, index }: { d: RewardsData; index: number }) {
  if (!d.cardUp || !d.rankAfter || !d.cardAfter) return null;
  const from = d.rankBefore;
  const to = d.rankAfter;
  return (
    <div className="rw-cardup" data-testid="rewards-cardup" style={{ animationDelay: `${index * 160}ms` }}>
      <div className="rw-cardup-head">{d.bigJokerUp ? '★ THE BIG JOKER ★' : 'NEW CARD'}</div>
      <div className="rw-cardup-flow">
        {from && (
          <>
            <span className="rw-cardup-chip" data-testid="cardup-from"><b>{rankGlyph(from)}</b><small>{cardDisplayName(from)}</small></span>
            <span className="rw-cardup-arrow" aria-hidden="true">→</span>
          </>
        )}
        <span className="rw-cardup-chip is-new" data-testid="cardup-to"><b>{rankGlyph(to)}</b><small>{cardDisplayName(to)}</small></span>
      </div>
      <div className="rw-cardup-card">
        <PlayerCard data={d.cardAfter} variant="deck" />
      </div>
      <p className="rw-cardup-note">{d.bigJokerUp
        ? 'The prestige card past the Little Joker — every rank climbed, every badge earned.'
        : 'Your rank is your card — this is the new one.'}</p>
    </div>
  );
}

function CoinsRow({ d, index, play, reduced }: { d: RewardsData; index: number; play: boolean; reduced: boolean }) {
  return (
    <div className="rw-row" style={{ animationDelay: `${index * 160}ms` }}>
      <div className="rw-icon"><CoinIcon size={22} /></div>
      <div className="rw-body">
        <div className="rw-top"><span>Coins earned</span><b className="rw-num gold"><RollNum to={d.coinsGained} play={play} reduced={reduced} delay={200 + index * 160} step={25} tone="gainGold" origin="100% 50%" format={(v) => `+${v.toLocaleString()}`} /></b></div>
        <div className="rw-sub">Spend them at the stake tables</div>
      </div>
    </div>
  );
}

function EloRow({ d, index, play, reduced }: { d: RewardsData; index: number; play: boolean; reduced: boolean }) {
  const delta = d.eloBefore != null && d.eloAfter != null ? d.eloAfter - d.eloBefore : 0;
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
          <b className={`rw-num ${up ? 'up' : 'down'}`}><RollNum to={Math.abs(delta)} play={play} reduced={reduced} delay={200 + index * 160} step={10} tone={up ? 'gainGreen' : 'lossRed'} origin="100% 50%" format={(v) => `${up ? '▲' : '▼'} ${v.toLocaleString()}`} /></b>
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
  // The rows wait for their own gate: presented AND in view (in
  // landscape they start below the fold — see useRowsInView).
  const rowsRef = useRef<HTMLDivElement>(null);
  const rowsPlay = useRowsInView(rowsRef, play, reduced);
  const rowGate = play && rowsPlay;
  // The victory celebration on THIS screen (owner, 2026-10-28): the
  // seeded confetti rain, fired by the reveal gate (presented — two
  // painted frames, document visible), never at mount; a tap anywhere
  // on the page clears it early. Wins only; reduced motion collapses
  // it to the still pose like every other surface.
  const [fxOff, setFxOff] = useState(false);
  // Level-up CARD TAKEOVER (owner, 2026-10-29): when this report grants a
  // new rank card, the card itself takes the screen (see CardTakeover.tsx).
  // Armed off the ROWS' gate — the XP count and the level bar run on it —
  // and delayed so it rises as the bar settles into the new level. Fires
  // once per grant: the celebrated key is written when the takeover shows,
  // so a refreshed /rewards stash or a remount never replays it. Reduced
  // motion never arms it; the static panel is the whole show there.
  const tKey = cardTakeoverKey(data);
  const [takeover, setTakeover] = useState<{ key: string; leaving: boolean } | null>(null);
  useEffect(() => {
    if (!rowGate || reduced || !tKey) return;
    if (takeoverCelebrated(tKey)) return;
    // No "armed" latch: the cleanup clears the timer on ANY effect re-run
    // (a remount-in-place, a gate flicker), so a latch would silently eat
    // the celebration — the re-run must be free to arm again. Once per
    // grant is guaranteed by the cleanup discipline (one live timer per
    // instance) plus the celebrated mark written when the takeover shows.
    const t = window.setTimeout(() => {
      markTakeoverCelebrated(tKey);
      setTakeover({ key: tKey, leaving: false });
    }, CARD_TAKEOVER_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [rowGate, reduced, tKey]);
  useEffect(() => {
    if (!takeover?.leaving) return;
    const t = window.setTimeout(() => setTakeover(null), CARD_TAKEOVER_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [takeover?.leaving]);
  const dismissTakeover = () => setTakeover((s) => (s && !s.leaving ? { ...s, leaving: true } : s));
  let row = 0;
  const rows: React.ReactNode[] = [];
  if (data.signedIn) {
    rows.push(<XpRow key="xp" d={data} index={row++} play={rowGate} reduced={reduced} />);
    if (data.cardUp) rows.push(<CardUpRow key="cardup" d={data} index={row++} />);
    if (data.coinsGained > 0) rows.push(<CoinsRow key="coins" d={data} index={row++} play={rowGate} reduced={reduced} />);
    rows.push(<EloRow key="elo" d={data} index={row++} play={rowGate} reduced={reduced} />);
    if (data.playWell && data.playWell.lines.length > 0) {
      const pw = data.playWell;
      const i = row++;
      rows.push(
        <div key="playwell" className="rw-row rw-playwell" data-testid="rewards-playwell" style={{ animationDelay: `${i * 160}ms` }}>
          <div className="rw-icon">⭐</div>
          <div className="rw-body">
            <div className="rw-top"><span>Playing well</span><b className="rw-num small"><RollNum to={pw.xp} play={rowGate} reduced={reduced} delay={200 + i * 160} step={10} tone="smallGain" maxGrow={0.12} origin="100% 50%" format={(v) => `+${v.toLocaleString()} XP`} />{pw.coins ? <> · +{pw.coins} <CoinIcon size={12} /></> : ''}</b></div>
            <ul className="rw-playwell-lines">
              {pw.lines.map((l) => (
                <li key={l.id}>
                  <span>{l.label}</span>
                  <b>{l.xp ? `+${l.xp} XP` : ''}{l.xp && l.coins ? ' · ' : ''}{l.coins ? <>+{l.coins} <CoinIcon size={11} /></> : ''}</b>
                </li>
              ))}
            </ul>
          </div>
        </div>,
      );
    }
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
    <div
      className={`rewards-page rw-armed${play ? ' rw-play' : ''}${rowsPlay ? ' rw-rows-play' : ''}${reduced ? ' rw-reduced' : ''}`}
      aria-label="Match rewards"
      data-testid="rewards"
      onPointerDown={() => setFxOff(true)}
    >
      {data.won && play && !fxOff && <VictoryConfetti seed={data.sub || null} still={reduced} />}
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
                {data.postgame.sides.map((s) => {
                  const top = Math.max(...data.postgame!.sides.map((x) => x.score));
                  const tone: RollTone = s.score < 0 ? 'scoreLoss' : s.score > 0 && s.score === top ? 'scoreWin' : 'scoreFlat';
                  return (
                    <tr key={s.label}><th>{s.label}</th><td><RollNum to={s.score} play={play} reduced={reduced} duration={1150} delay={250} step={50} tone={tone} origin="100% 50%" format={(v) => v.toLocaleString()} /></td><td>{s.books}</td><td>{s.nilsMade}</td></tr>
                  );
                })}
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
        <div className="rw-rows" ref={rowsRef}>
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
      {takeover && data.cardUp && data.cardAfter && data.rankAfter && (
        <CardTakeover d={data} leaving={takeover.leaving} onDismiss={dismissTakeover} />
      )}
    </div>
  );
}
