/**
 * Big Bank Take Lil Bank: coin ledger layer for wager challenges.
 * Sits beside stakes.ts and reuses the same move()/cap machinery. Every wager
 * movement carries ref_id = challenge id, and each (user, challenge, reason)
 * pair may be written at most once — that ledger-ref check, not a transaction,
 * is what makes escrow/settlement idempotent across DO retries and restarts.
 *
 * Ledger convention for a played win: the winner's own escrow comes back as
 * `wager_refund`, and only the NET winnings land as `wager_win` (so the daily
 * cap in coins.ts — which now sums stake_win + wager_win — measures winnings,
 * not stake returns). Forfeit splits (`wager_forfeit`) bypass the cap, exactly
 * like stake_forfeit.
 */
import { flag, move, stakeCapCheck } from './coins';
import { xpSnapshot } from './xp';

/** The only wager amounts a challenge may use (owner's ladder — the stake tiers). */
export const WAGER_LADDER = [100, 250, 1000, 5000] as const;
export const isWagerAmount = (n: unknown): n is number => typeof n === 'number' && (WAGER_LADDER as readonly number[]).includes(n);

/** Rep level required to create or accept a challenge (Block Captain). */
export const WAGER_LEVEL = 20;
/** unlocks.item_id granted by the game-finish hook when a player reaches WAGER_LEVEL. */
export const WAGER_UNLOCK = 'big-bank';
export const WAGER_FLAG = 'wager_challenges_enabled';

/** Big Bank ships dark: off unless the flag is flipped (Phase 2). */
export const wagerEnabled = (db: D1Database): Promise<boolean> => flag(db, WAGER_FLAG, '0').then((v) => v === '1');

export async function wagerHorizonMs(db: D1Database): Promise<number> {
  const days = parseInt(await flag(db, 'wager_horizon_days', '7'), 10);
  return (Number.isFinite(days) && days > 0 ? days : 7) * 86_400_000;
}

export async function wagerMaxConcurrent(db: D1Database): Promise<number> {
  const n = parseInt(await flag(db, 'wager_max_concurrent', '3'), 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

/** The level gate's source of truth is xp_state (the unlock row is for the client's popup). */
export async function wagerLevelOk(db: D1Database, userId: string): Promise<boolean> {
  return (await xpSnapshot(db, userId)).level >= WAGER_LEVEL;
}

/** How many unsettled challenges this player currently has coins escrowed in. */
export async function wagerEscrowedCount(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM wager_challenge_players p
    JOIN wager_challenges c ON c.id = p.challenge_id
    WHERE p.user_id = ? AND p.escrowed = 1 AND c.status IN ('pending','scheduled','checkin','live')`)
    .bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

async function hasMove(db: D1Database, userId: string, reason: string, challengeId: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM coin_ledger WHERE user_id = ? AND reason = ? AND ref_id = ? LIMIT 1')
    .bind(userId, reason, challengeId).first<{ id: number }>();
  return !!row;
}

/** Escrow a player's wager. Idempotent: an existing escrow row counts as success. Refuses non-ladder amounts at the ledger layer too. */
export async function wagerEscrow(db: D1Database, userId: string, challengeId: string, amount: number, now: number): Promise<boolean> {
  if (!isWagerAmount(amount)) return false;
  if (await hasMove(db, userId, 'wager_escrow', challengeId)) return true;
  return move(db, userId, -amount, 'wager_escrow', challengeId, now);
}

/** Whether this player's wager is currently sitting in escrow for the challenge. */
export const wagerIsEscrowed = (db: D1Database, userId: string, challengeId: string): Promise<boolean> => hasMove(db, userId, 'wager_escrow', challengeId);

/** Return a player's escrow. Idempotent; false when they never escrowed. */
export async function wagerRefund(db: D1Database, userId: string, challengeId: string, amount: number, now: number): Promise<boolean> {
  if (!(await hasMove(db, userId, 'wager_escrow', challengeId))) return false;
  if (await hasMove(db, userId, 'wager_refund', challengeId)) return true;
  return move(db, userId, amount, 'wager_refund', challengeId, now);
}

export interface WinOutcome { winPaid: number; capped: boolean }

/**
 * Pay a winner of a played match: escrow back (`wager_refund`) + net winnings
 * (`wager_win`, gross payout minus their own escrow). The win part is subject
 * to the daily stake/wager cap via stakeCapCheck — if it would exceed the cap
 * the win part is skipped and logged (settleTable's convention); the escrow
 * refund always lands. Idempotent per (user, challenge).
 */
export async function wagerPayWin(db: D1Database, userId: string, challengeId: string, escrowAmount: number, grossPayout: number, now: number): Promise<WinOutcome> {
  await wagerRefund(db, userId, challengeId, escrowAmount, now);
  const net = Math.max(0, Math.trunc(grossPayout) - escrowAmount);
  if (net <= 0 || (await hasMove(db, userId, 'wager_win', challengeId))) return { winPaid: 0, capped: false };
  if (!(await stakeCapCheck(db, userId, net, now))) {
    console.warn('cred', 'wager_cap_hit', { user: userId, challenge: challengeId, forfeited: net });
    return { winPaid: 0, capped: true };
  }
  const ok = await move(db, userId, net, 'wager_win', challengeId, now);
  return { winPaid: ok ? net : 0, capped: false };
}

/**
 * Credit a forfeit split (no-show / abandon). Bypasses the daily win cap,
 * like stake_forfeit. Idempotent per (user, challenge).
 */
export async function wagerForfeit(db: D1Database, userId: string, challengeId: string, amount: number, now: number): Promise<boolean> {
  amount = Math.trunc(amount);
  if (amount <= 0) return true;
  if (await hasMove(db, userId, 'wager_forfeit', challengeId)) return true;
  return move(db, userId, amount, 'wager_forfeit', challengeId, now);
}
