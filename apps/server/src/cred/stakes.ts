/**
 * Street Cred System C: stake tables (Phase 3b).
 * Buy-ins are escrowed when a player sits down and settled when the game ends.
 * No table fees in beta — the full pot pays out. Server-authoritative: the
 * server decides every debit/credit; the client never supplies amounts.
 */
import { balance, move, coinsEnabled, flag, stakeCapCheck } from './coins';
import { divisionRank, type Division } from './divisions';
import { ensureSeason } from './seasons';

export interface StakeTable { id: string; buyIn: number; minGames: number; minDivision: Division | null }

export const STAKE_TABLES: StakeTable[] = [
  { id: 'casual', buyIn: 100, minGames: 0, minDivision: null },
  { id: 'competitive', buyIn: 250, minGames: 10, minDivision: null },
  { id: 'high-roller', buyIn: 1000, minGames: 20, minDivision: 'block' },
  { id: 'elite', buyIn: 5000, minGames: 50, minDivision: 'avenue' },
];

export const tableById = (id: string): StakeTable | undefined => STAKE_TABLES.find((t) => t.id === id);

/** Finished, rated games (abandons excluded) — the unlock gate for stake tables. */
async function ratedGames(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM game_players gp JOIN games g ON g.id = gp.game_id
    WHERE gp.user_id = ? AND g.rated = 1 AND COALESCE(g.end_reason,'finished') != 'abandoned'`)
    .bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

/** Best division across both ladders this season. */
async function bestDivision(db: D1Database, userId: string, now: number): Promise<Division> {
  const season = await ensureSeason(db, now);
  const rows = (await db.prepare('SELECT division FROM season_ratings WHERE user_id = ? AND season_id = ?')
    .bind(userId, season.id).all<{ division: Division }>()).results;
  return rows.reduce<Division>((b, r) => (divisionRank(r.division) > divisionRank(b) ? r.division : b), 'stoop');
}

export interface EnterCheck { ok: boolean; reason?: string }

/** Gate check before a player may sit at a stake table. */
export async function canEnter(db: D1Database, userId: string, tableId: string, now: number): Promise<EnterCheck> {
  if ((await flag(db, 'stake_tables_enabled', '1')) !== '1') return { ok: false, reason: 'Stake tables are disabled right now.' };
  if (!(await coinsEnabled(db))) return { ok: false, reason: 'Coins are disabled right now.' };
  const table = tableById(tableId);
  if (!table) return { ok: false, reason: 'Unknown table.' };
  const games = await ratedGames(db, userId);
  if (games < table.minGames) return { ok: false, reason: `Play ${table.minGames} rated games to unlock this table.` };
  if (table.minDivision && divisionRank(await bestDivision(db, userId, now)) < divisionRank(table.minDivision)) {
    return { ok: false, reason: `Reach the ${table.minDivision} division to unlock this table.` };
  }
  if ((await balance(db, userId)) < table.buyIn) return { ok: false, reason: 'Not enough coins for the buy-in.' };
  return { ok: true };
}

/** Escrow the buy-in when a player sits down. Returns false when the debit failed. */
export async function escrow(db: D1Database, userId: string, tableId: string, gameId: string, now: number): Promise<boolean> {
  const table = tableById(tableId);
  if (!table) return false;
  return move(db, userId, -table.buyIn, 'stake_escrow', gameId, now);
}

/**
 * Full-table settlement: every seated player escrowed `buyIn`; winners split the
 * whole pot, losers get nothing further. `seats` is every player who escrowed.
 */
export async function settleTable(db: D1Database, o: { gameId: string; seats: string[]; winners: string[]; buyIn: number; now: number }): Promise<void> {
  if (!o.seats.length || !o.winners.length) return;
  const pot = o.buyIn * o.seats.length;
  const share = Math.floor(pot / o.winners.length);
  const remainder = pot - share * o.winners.length;
  for (let i = 0; i < o.winners.length; i++) {
    const amount = share + (i === 0 ? remainder : 0);
    if (amount <= 0) continue;
    if (!(await stakeCapCheck(db, o.winners[i]!, amount, o.now))) {
      console.warn('cred', 'stake_cap_hit', { user: o.winners[i], game: o.gameId, forfeited: amount });
      continue; // excess forfeited — anti-farming
    }
    await move(db, o.winners[i]!, amount, 'stake_win', o.gameId, o.now);
  }
}

/** Refund every escrow when a table never fills or a game is voided. */
export async function voidGame(db: D1Database, o: { gameId: string; seats: string[]; buyIn: number; now: number }): Promise<void> {
  for (const uid of o.seats) {
    await move(db, uid, o.buyIn, 'stake_refund', o.gameId, o.now);
  }
}

/**
 * Rated abandon: the leaver forfeits their escrowed buy-in, split evenly among
 * the remaining players (floor division, remainder to the first).
 */
export async function leaverForfeit(db: D1Database, o: { gameId: string; leaver: string; remainers: string[]; buyIn: number; now: number }): Promise<void> {
  if (!o.remainers.length) return;
  const share = Math.floor(o.buyIn / o.remainers.length);
  const remainder = o.buyIn - share * o.remainers.length;
  for (let i = 0; i < o.remainers.length; i++) {
    const amount = share + (i === 0 ? remainder : 0);
    if (amount <= 0) continue;
    // forfeits are not stake winnings — they bypass the daily win cap
    await move(db, o.remainers[i]!, amount, 'stake_forfeit', o.gameId, o.now);
  }
}
