/**
 * Play-Well bonuses (owner, 2026-10-29 — "add incentives for playing well:
 * if you win multiple books in a row that should account for something when
 * you get points at the end of a game"). At game end, in the same cred pass
 * that pays base finish/win XP (cred/hooks.ts onGameEnd), a player's in-game
 * feats earn bonus XP (and, for running the table, coins):
 *
 *   Best Run     longest run of consecutive books inside one hand, paid
 *                once per game at the best tier: 3–4 → 4 · 5–6 → 8 ·
 *                7–9 → 14 · 10+ → 22 XP. The run is the Streak Fire
 *                definition (per-seat consecutive trick wins within a
 *                hand), stamped by the engine into the hand record
 *                (HandRecord.bestRuns) and aggregated in stats/record.ts.
 *   Ran the Table  all books in a hand, personally: +25 XP · +15 coins,
 *                per occurrence.
 *   Nil play     made Nil +6 XP, made Blind Nil +12 XP, per occurrence
 *                (a blind nil pays the 12, not 6+12). Counts are the cred
 *                hooks' own (stats.nilMade / blindNilMade).
 *   Set Them     +4 XP each time the player's side set the opponents —
 *                the challenge system's shots_given count — max +12 XP
 *                per game from this feat.
 *   Comeback     won after trailing by 100+ at the end of any hand (the
 *                stats.maxDeficit derivation): +10 XP.
 *   Domination   won by 150+: +8 XP.
 *
 * Guardrails, all owner-approved: total bonus XP ≤ 40 per player per game
 * (the table-run coins are separate); bot/unrated games pay at the base
 * game's half rate, applied per line and floored the way base rounds
 * (25 → 12); bonus XP stops accruing past 200 per player per UTC day
 * (PLAY_WELL_DAILY_CAP_XP — the anti-farming dial). Story games never
 * reach this code (their rewards live in story/routes.ts), and bonuses
 * never touch ratings. Every feat derives server-side from the recorded
 * game's stats — never from anything the client reports.
 *
 * The cred_playwell row (migration 0034) is written for EVERY credited
 * game, even a feat-less one (xp 0, lines []): it is the idempotency key,
 * the daily-cap ledger, and the rewards screen's itemization source.
 */
import type { PlayerGameStats } from '../stats/record';
import { awardXp } from './xp';
import { move } from './coins';

/** Per-player per-game cap on bonus XP (the table-run coins are separate). */
export const PLAY_WELL_GAME_CAP_XP = 40;
/** OWNER DIAL: per-player per-UTC-day cap on bonus XP (anti-farming). */
export const PLAY_WELL_DAILY_CAP_XP = 200;
/** Set Them pays +4 per set, up to this much per game. */
export const PLAY_WELL_SET_THEM_CAP_XP = 12;

export const BEST_RUN_TIERS: readonly (readonly [minRun: number, xp: number])[] = [
  [10, 22], [7, 14], [5, 8], [3, 4],
];
export const TABLE_RUN_XP = 25;
export const TABLE_RUN_COINS = 15;
export const NIL_XP = 6;
export const BLIND_NIL_XP = 12;
export const SET_THEM_XP = 4;
export const COMEBACK_XP = 10;
export const COMEBACK_MIN_DEFICIT = 100;
export const DOMINATION_XP = 8;
export const DOMINATION_MIN_MARGIN = 150;

export interface PlayWellLine { id: string; label: string; xp: number; coins: number }
export interface PlayWellAward {
  lines: PlayWellLine[];
  xp: number;
  coins: number;
  /** the bonus award itself crossed a level (hooks mirrors the base
   *  level-up coin grant for it, same as a base-XP crossing) */
  leveledUp: boolean;
  level: number;
}

export const bestRunXp = (run: number): number => BEST_RUN_TIERS.find(([min]) => run >= min)?.[1] ?? 0;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{n}', String(n)));

/**
 * The feats a game earned, at full rate, before multiplier and caps, in
 * display order. Pure: the same stats the cred hooks already consume.
 * `finalMargin` is the player's side's final score minus the best other
 * side's (negative when they lost the score line, e.g. a shot-out win).
 */
export function playWellLines(stats: PlayerGameStats, o: { won: boolean; finalMargin: number }): PlayWellLine[] {
  const lines: PlayWellLine[] = [];
  const runXp = bestRunXp(stats.bestRun ?? 0);
  if (runXp > 0) lines.push({ id: 'best-run', label: `Best run — ${stats.bestRun} books in a row`, xp: runXp, coins: 0 });
  const tables = stats.tableRuns ?? 0;
  if (tables > 0) lines.push({ id: 'ran-table', label: plural(tables, 'Ran the table', 'Ran the table ×{n}'), xp: TABLE_RUN_XP * tables, coins: TABLE_RUN_COINS * tables });
  const blind = stats.blindNilMade ?? 0;
  const nils = Math.max(0, (stats.nilMade ?? 0) - blind);
  if (nils > 0) lines.push({ id: 'nil', label: plural(nils, 'Made a nil', 'Made nils ×{n}'), xp: NIL_XP * nils, coins: 0 });
  if (blind > 0) lines.push({ id: 'blind-nil', label: plural(blind, 'Made a blind nil', 'Made blind nils ×{n}'), xp: BLIND_NIL_XP * blind, coins: 0 });
  const shots = stats.shotsGiven ?? 0;
  if (shots > 0) lines.push({ id: 'set-them', label: plural(shots, 'Set the opponents', 'Set the opponents ×{n}'), xp: Math.min(SET_THEM_XP * shots, PLAY_WELL_SET_THEM_CAP_XP), coins: 0 });
  if (o.won && (stats.maxDeficit ?? 0) >= COMEBACK_MIN_DEFICIT) lines.push({ id: 'comeback', label: 'Comeback win', xp: COMEBACK_XP, coins: 0 });
  if (o.won && o.finalMargin >= DOMINATION_MIN_MARGIN) lines.push({ id: 'domination', label: `Domination — won by ${o.finalMargin}`, xp: DOMINATION_XP, coins: 0 });
  return lines;
}

/**
 * Settle full-rate lines into what is actually paid: the half rate for
 * bot/unrated games applies per line, floored the way base rounds
 * (25 → 12), coins included; then one XP budget — the smaller of the
 * per-game cap and the day's remaining allowance — trims lines in
 * display order. Coins are never trimmed by the XP caps. A line whose
 * XP trims to zero survives only if it still carries coins.
 */
export function settlePlayWell(lines: PlayWellLine[], o: { half: boolean; dailyAllowance: number }): { lines: PlayWellLine[]; xp: number; coins: number } {
  let budget = Math.max(0, Math.min(PLAY_WELL_GAME_CAP_XP, o.dailyAllowance));
  const out: PlayWellLine[] = [];
  let xp = 0;
  let coins = 0;
  for (const l of lines) {
    let lx = o.half ? Math.floor(l.xp / 2) : l.xp;
    const lc = o.half ? Math.floor(l.coins / 2) : l.coins;
    if (lx > budget) lx = budget;
    budget -= lx;
    if (lx <= 0 && lc <= 0) continue;
    out.push({ id: l.id, label: l.label, xp: lx, coins: lc });
    xp += lx;
    coins += lc;
  }
  return { lines: out, xp, coins };
}

const DAY_MS = 86_400_000;

/** Bonus XP this player has already been paid for games ended on the UTC day containing `endedAt`. */
export async function playWellPaidToday(db: D1Database, userId: string, endedAt: number): Promise<number> {
  const dayStart = Math.floor(endedAt / DAY_MS) * DAY_MS;
  const row = await db.prepare('SELECT COALESCE(SUM(xp), 0) AS xp FROM cred_playwell WHERE user_id = ? AND ended_at >= ? AND ended_at < ?')
    .bind(userId, dayStart, dayStart + DAY_MS).first<{ xp: number }>();
  return row?.xp ?? 0;
}

/**
 * Compute, persist, and credit one player's Play-Well bonus for one game.
 * The INSERT OR IGNORE on cred_playwell (game_id, user_id) is the
 * idempotency gate: an already-bonused game credits nothing, independent
 * of the cred_processed gate upstream.
 */
export async function creditPlayWell(
  db: D1Database,
  o: { gameId: string; userId: string; stats: PlayerGameStats; won: boolean; finalMargin: number; half: boolean; endedAt: number },
): Promise<PlayWellAward> {
  const none: PlayWellAward = { lines: [], xp: 0, coins: 0, leveledUp: false, level: 0 };
  const full = playWellLines(o.stats, { won: o.won, finalMargin: o.finalMargin });
  const paidToday = await playWellPaidToday(db, o.userId, o.endedAt);
  const settled = settlePlayWell(full, { half: o.half, dailyAllowance: PLAY_WELL_DAILY_CAP_XP - paidToday });
  const ins = await db.prepare('INSERT OR IGNORE INTO cred_playwell (game_id, user_id, xp, coins, lines, ended_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(o.gameId, o.userId, settled.xp, settled.coins, JSON.stringify(settled.lines), o.endedAt).run();
  const changed = (ins as unknown as { meta?: { changes?: number } }).meta?.changes ?? 1;
  if (!changed) return none; // already bonused (repost / retry)
  let leveledUp = false;
  let level = 0;
  if (settled.xp > 0) {
    const awarded = await awardXp(db, o.userId, settled.xp, o.endedAt);
    leveledUp = awarded.leveledUp;
    level = awarded.level;
  }
  if (settled.coins > 0) {
    try { await move(db, o.userId, settled.coins, 'play_well', `game:${o.gameId}`, o.endedAt); } catch { /* best-effort, like every coin move */ }
  }
  return { lines: settled.lines, xp: settled.xp, coins: settled.coins, leveledUp, level };
}

/** The player's most recent Play-Well row (the rewards screen's source). */
export async function latestPlayWell(db: D1Database, userId: string): Promise<{ gameId: string; xp: number; coins: number; lines: PlayWellLine[] } | null> {
  const row = await db.prepare('SELECT game_id AS gameId, xp, coins, lines FROM cred_playwell WHERE user_id = ? ORDER BY ended_at DESC, game_id DESC LIMIT 1')
    .bind(userId).first<{ gameId: string; xp: number; coins: number; lines: string }>();
  if (!row) return null;
  let lines: PlayWellLine[] = [];
  try { const p = JSON.parse(row.lines) as PlayWellLine[]; if (Array.isArray(p)) lines = p; } catch { /* a bad row reads as no lines */ }
  return { gameId: row.gameId, xp: row.xp, coins: row.coins, lines };
}
