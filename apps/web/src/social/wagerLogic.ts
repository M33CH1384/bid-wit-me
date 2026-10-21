/**
 * Big Bank Take Lil Bank (Phase 2): the pure logic behind the wager UI — list grouping,
 * create-form validation, button states, and the unlock-celebration rules — kept free of
 * React and fetches so it can be unit-tested directly (apps/web/test/wager-logic.test.ts).
 */
import type { WagerRow } from './wagerApi';

export const WAGER_LADDER = [100, 250, 1000, 5000];
export const CHECKIN_MS = 10 * 60_000;
export const MIN_LEAD_MS = 15 * 60_000; // server: start ≥ check-in window + 5 min
export const HORIZON_MS = 7 * 24 * 3600_000;

export interface TimerPreset { id: 'chill' | 'normal' | 'fast'; label: string; bid: number; play: number }
export const TIMER_PRESETS: TimerPreset[] = [
  { id: 'chill', label: 'Chill', bid: 45, play: 45 },
  { id: 'normal', label: 'Normal', bid: 30, play: 30 },
  { id: 'fast', label: 'Fast', bid: 20, play: 20 },
];
export function timerLabel(t: { bid: number; play: number }): string {
  const p = TIMER_PRESETS.find((x) => x.bid === t.bid && x.play === t.play);
  return p ? `${p.label} ${p.bid}/${p.play}` : `${t.bid}/${t.play}`;
}

/** Compact "Tue Oct 20 · 7:30 PM · in 2 h" (mirrors the tournament list's when()). */
export function whenText(at: number, now = Date.now()): string {
  const d = at - now, m = Math.round(Math.abs(d) / 60_000);
  const rel = m < 1 ? 'now' : m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
  const abs = new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  return d > 0 ? `${abs} · in ${rel}` : abs;
}

/** Short label for a challenge's game: format + deck, from the row/view mode. */
export function gameLabel(format: string, mode: string): string {
  if (format === 'cutthroat') return 'Cutthroat';
  return mode === 'aceDown' ? 'Ace Down 2v2' : 'Joker 2v2';
}

/* ------------------------------------------------------------ list grouping */

export const TERMINAL_STATUSES = ['settled', 'forfeited', 'void', 'declined', 'expired', 'cancelled'];
export interface WagerGroups { needsYou: WagerRow[]; checkin: WagerRow[]; upcoming: WagerRow[]; live: WagerRow[]; finished: WagerRow[] }

/** Bucket the viewer's challenges by what they need next. "Needs you" = an invite waiting
 *  on your accept (incl. naming your partner, for the partnership opponent). */
export function groupChallenges(rows: WagerRow[], myUid: string | null, now: number): WagerGroups {
  const g: WagerGroups = { needsYou: [], checkin: [], upcoming: [], live: [], finished: [] };
  const byStart = (a: WagerRow, b: WagerRow) => a.startAt - b.startAt;
  for (const r of rows) {
    const me = myUid ? r.players.find((p) => p.uid === myUid) : undefined;
    if (TERMINAL_STATUSES.includes(r.status)) { g.finished.push(r); continue; }
    if (r.status === 'live') { g.live.push(r); continue; }
    if (r.status === 'pending' && me?.status === 'invited') { g.needsYou.push(r); continue; }
    if ((r.status === 'scheduled' || r.status === 'checkin') && me?.status === 'accepted' && !me.checkedIn && now >= r.checkinOpensAt) { g.checkin.push(r); continue; }
    g.upcoming.push(r);
  }
  g.needsYou.sort(byStart); g.checkin.sort(byStart); g.upcoming.sort(byStart); g.live.sort(byStart);
  g.finished.sort((a, b) => b.startAt - a.startAt);
  return g;
}

/** One-line per-player outcome for a resolved challenge. Amount only — call
 *  sites render the drawn CoinIcon beside it (no coin emoji anywhere). */
export function netText(net: number | null): string | null {
  if (net === null) return null;
  if (net > 0) return `+${net.toLocaleString()}`;
  if (net < 0) return `−${Math.abs(net).toLocaleString()}`;
  return 'refunded';
}

/* ---------------------------------------------------------- challenge button */

export type ChallengeButtonState = 'hidden' | 'locked' | 'ready';
/**
 * Whether a profile shows a Challenge action for this viewer:
 * — hidden: signed out, your own profile, a blocked pair, a guest target, or the feature
 *   flag is off (a dark feature doesn't advertise itself);
 * — locked: you haven't earned Big Bank yet (Rep Level 20);
 * — ready: challenge away.
 */
export function challengeButtonState(o: {
  signedIn: boolean; enabled: boolean | null; hasUnlock: boolean; dev: boolean;
  isSelf: boolean; blocked: boolean; targetIsGuest: boolean;
}): ChallengeButtonState {
  if (!o.signedIn || o.isSelf || o.blocked || o.targetIsGuest) return 'hidden';
  if (o.enabled !== true) return 'hidden';
  if (!o.hasUnlock && !o.dev) return 'locked';
  return 'ready';
}

/* -------------------------------------------------------------- create form */

export interface CreateFormState {
  format: 'partnership' | 'cutthroat';
  wager: number; deck: 'joker' | 'aceDown'; target: number;
  timers: 'chill' | 'normal' | 'fast'; startAt: number;
  opponent: string; partner: string; invitees: string[];
  /** partnership: YOUR side's team name for the pairing (you + partner), set at
   *  setup — prefilled from the pairing's saved name, carried on the challenge
   *  so the match table is seeded with it (owner, 2026-10-20). */
  teamName: string;
}

const cleanName = (n: string) => n.trim();
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** First validation problem with the form, or null. Mirrors the server's create contract. */
export function validateCreate(f: CreateFormState, o: { myName: string; balance: number; now: number }): string | null {
  if (!WAGER_LADDER.includes(f.wager)) return 'Pick a wager: 100, 250, 1,000 or 5,000 coins.';
  if (f.wager > o.balance) return `Your balance is ${o.balance.toLocaleString()} — pick a smaller wager.`;
  if (f.startAt < o.now + MIN_LEAD_MS) return 'Start at least 15 minutes from now — players need time to accept before check-in opens.';
  if (f.startAt > o.now + HORIZON_MS) return 'Start within 7 days.';
  if (f.format === 'partnership') {
    const opp = cleanName(f.opponent), par = cleanName(f.partner);
    if (!opp) return 'Name your opponent.';
    if (!par) return 'Name your partner.';
    if (sameName(opp, o.myName) || sameName(par, o.myName)) return "You can't challenge yourself.";
    if (sameName(opp, par)) return 'Your opponent and your partner must be different players.';
  } else {
    const inv = f.invitees.map(cleanName);
    if (inv.length !== 3 || inv.some((n) => !n)) return 'Name all three players.';
    if (inv.some((n) => sameName(n, o.myName))) return "You can't invite yourself.";
    if (new Set(inv.map((n) => n.toLowerCase())).size !== 3) return 'The three players must be different people.';
  }
  return null;
}

/** The POST body for a validated form (shape per the Phase 1 API contract). */
export function createBody(f: CreateFormState): Record<string, unknown> {
  const base = { format: f.format, wager: f.wager, timers: f.timers, startAt: f.startAt };
  if (f.format === 'partnership') return { ...base, deck: f.deck, target: f.target, opponent: cleanName(f.opponent), partner: cleanName(f.partner), teamName: cleanName(f.teamName) };
  return { ...base, target: f.target, invitees: f.invitees.map(cleanName) };
}

/** Quick start-time picks on the create form. "Tonight" rolls to tomorrow once it's too close. */
export function startPresets(now: number): { id: string; label: string; at: number }[] {
  const tonight = new Date(now);
  tonight.setHours(20, 0, 0, 0);
  if (tonight.getTime() < now + MIN_LEAD_MS) tonight.setDate(tonight.getDate() + 1);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(19, 0, 0, 0);
  return [
    { id: 'hour', label: 'In 1 hour', at: now + 3600_000 },
    { id: 'tonight', label: 'Tonight 8 PM', at: tonight.getTime() },
    { id: 'tomorrow', label: 'Tomorrow 7 PM', at: tomorrow.getTime() },
  ];
}

/** datetime-local input value for a timestamp (local time, minute precision). */
export function toLocalInput(at: number): string {
  const d = new Date(at - new Date(at).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

/* ------------------------------------------------------------ unlock popup */

/** Unlocks that get a one-time celebration popup, in the order they were earned. */
export const CELEBRATED_UNLOCKS = ['big-bank', 'after-dark'];
export interface UnlockInfo { itemId: string; unlockedAt: number }

/** Unlocks the client hasn't celebrated yet for this account (server payload carries the
 *  grant timestamp in `unlockedAt`; the seen set is per-account localStorage). */
export function unseenUnlocks(unlocks: UnlockInfo[], seen: string[]): UnlockInfo[] {
  return unlocks
    .filter((u) => CELEBRATED_UNLOCKS.includes(u.itemId) && !seen.includes(u.itemId))
    .sort((a, b) => a.unlockedAt - b.unlockedAt);
}

export const seenKey = (accountId: string) => `bwm.unlockSeen.${accountId}`;
export function parseSeen(raw: string | null): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw) as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
export function withSeen(seen: string[], itemId: string): string[] {
  return seen.includes(itemId) ? seen : [...seen, itemId];
}

/** The popup NEVER opens over a table: at an online table the path is /t/CODE; at an
 *  offline bot game the tab's in-game marker (save.ts) is set. It waits in the queue
 *  until the player is back in menus/lobby. */
export function popupDeferred(pathname: string, inGame: boolean): boolean {
  return inGame || /^\/t\/[^/]+\/?$/.test(pathname);
}

/* ------------------------------------------------ Tale of the Tape (P-C) */

/**
 * Win expectancy from a rating gap — the standard Elo expectancy the whole
 * Rep system is built on: P(a beats b) = 1 / (1 + 10^(−(ra−rb)/400)).
 * Ratings are the mode ratings from the public profile payload; a side's
 * rating is the average of its named players' ratings.
 */
export function expectancy(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, -(ra - rb) / 400));
}

/** Free-for-all win shares: each player's expectancy weight normalized —
 *  the multiway extension of the same formula (cutthroat tape). */
export function ffaShares(ratings: number[]): number[] {
  const w = ratings.map((r) => Math.pow(10, r / 400));
  const sum = w.reduce((a, b) => a + b, 0);
  return sum > 0 ? w.map((x) => x / sum) : ratings.map(() => (ratings.length ? 1 / ratings.length : 0));
}

/** Blend a rating-based probability with a head-to-head record when one
 *  actually exists (≥3 meetings): 75% expectancy, 25% the h2h win share.
 *  No record → the expectancy stands alone; nothing is invented. */
export function blendH2h(p: number, h2h: { games: number; wins: number } | null): number {
  if (!h2h || h2h.games < 3) return p;
  return 0.75 * p + 0.25 * (h2h.wins / h2h.games);
}

/** Average of the ratings that exist; null when a side has no rated player. */
export function avgRating(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
