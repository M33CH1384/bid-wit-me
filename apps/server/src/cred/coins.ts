/**
 * Street Cred System C: server-authoritative coin economy (Phase 3b).
 * Every movement is a ledger row (coin_ledger); coin_balances is a cached
 * write-through, never trusted from the client. Integer amounts only.
 * All writes are best-effort: callers wrap in try/catch so coins can never
 * break game recording or profile reads.
 */

export const WELCOME_GRANT = 1000;

/** Read a feature flag (string). Falls back to `dflt` when the row is missing. */
export async function flag(db: D1Database, key: string, dflt: string): Promise<string> {
  const row = await db.prepare('SELECT value FROM cred_flags WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? dflt;
}

export const coinsEnabled = (db: D1Database): Promise<boolean> => flag(db, 'coins_enabled', '1').then((v) => v === '1');
export const earnMultiplier = async (db: D1Database): Promise<number> => {
  const v = parseFloat(await flag(db, 'earn_multiplier', '1'));
  return Number.isFinite(v) && v > 0 ? v : 1;
};

/** Current balance (0 for new players; the welcome grant is applied on first profile read). */
export async function balance(db: D1Database, userId: string): Promise<number> {
  const row = await db.prepare('SELECT balance FROM coin_balances WHERE user_id = ?').bind(userId).first<{ balance: number }>();
  return row?.balance ?? 0;
}

/**
 * Move coins. Positive = credit, negative = debit. A debit that would take the
 * balance below zero is refused (returns false, no row written). Every move
 * carries a reason and optional ref id. No-op when the coin system is disabled.
 */
export async function move(db: D1Database, userId: string, delta: number, reason: string, refId: string | null, now: number): Promise<boolean> {
  delta = Math.trunc(delta);
  if (delta === 0) return true;
  if (!(await coinsEnabled(db))) return false;
  if (delta < 0) {
    const bal = await balance(db, userId);
    if (bal + delta < 0) return false;
  }
  await db.prepare('INSERT INTO coin_ledger (user_id, delta, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, delta, reason, refId, now).run();
  await db.prepare(`INSERT INTO coin_balances (user_id, balance, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET balance = coin_balances.balance + excluded.balance, updated_at = excluded.updated_at`)
    .bind(userId, delta, now).run();
  return true;
}

/** 1,000-coin welcome grant. Idempotent: keyed on the 'welcome' reason. */
export async function grantWelcome(db: D1Database, userId: string, now: number): Promise<boolean> {
  const row = await db.prepare("SELECT id FROM coin_ledger WHERE user_id = ? AND reason = 'welcome' LIMIT 1").bind(userId).first<{ id: number }>();
  if (row) return false;
  return move(db, userId, WELCOME_GRANT, 'welcome', null, now);
}

const dayId = (now: number): string => new Date(now).toISOString().slice(0, 10);
const prevDayId = (now: number): string => new Date(now - 86_400_000).toISOString().slice(0, 10);

/**
 * Daily login reward: 100 + 25/streak-day, capped at 200. Streak continues from
 * yesterday, otherwise resets to 1. Idempotent per UTC day.
 */
export async function dailyLogin(db: D1Database, userId: string, now: number): Promise<{ granted: boolean; amount: number; streak: number }> {
  const day = dayId(now);
  const existing = await db.prepare('SELECT streak FROM daily_logins WHERE user_id = ? AND day = ?').bind(userId, day).first<{ streak: number }>();
  if (existing) return { granted: false, amount: 0, streak: existing.streak };
  const yesterday = await db.prepare('SELECT streak FROM daily_logins WHERE user_id = ? AND day = ?').bind(userId, prevDayId(now)).first<{ streak: number }>();
  const streak = (yesterday?.streak ?? 0) + 1;
  const amount = Math.min(200, 100 + (streak - 1) * 25);
  await db.prepare('INSERT OR IGNORE INTO daily_logins (user_id, day, streak) VALUES (?, ?, ?)').bind(userId, day, streak).run();
  const granted = await move(db, userId, amount, 'daily_login', day, now);
  return { granted, amount, streak };
}

/** Sum of today's positive stake winnings (stake_win reason, UTC day). */
export async function todayStakeWinnings(db: D1Database, userId: string, now: number): Promise<number> {
  const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const row = await db.prepare(`SELECT COALESCE(SUM(delta),0) AS s FROM coin_ledger
    WHERE user_id = ? AND reason = 'stake_win' AND created_at >= ?`).bind(userId, start).first<{ s: number }>();
  return row?.s ?? 0;
}

/**
 * Daily net-win cap guard for stake tables. Returns true when crediting `amount`
 * would stay within the daily_stake_cap flag.
 */
export async function stakeCapCheck(db: D1Database, userId: string, amount: number, now: number): Promise<boolean> {
  const cap = parseInt(await flag(db, 'daily_stake_cap', '5000'), 10);
  if (!Number.isFinite(cap) || cap <= 0) return true;
  return (await todayStakeWinnings(db, userId, now)) + amount <= cap;
}

/** Recent ledger rows, newest first. */
export async function ledger(db: D1Database, userId: string, limit: number): Promise<{ delta: number; reason: string; refId: string | null; createdAt: number }[]> {
  const lim = Math.min(100, Math.max(1, Math.trunc(limit) || 25));
  const rows = await db.prepare(`SELECT delta, reason, ref_id AS refId, created_at AS createdAt FROM coin_ledger
    WHERE user_id = ? ORDER BY id DESC LIMIT ?`).bind(userId, lim).all<{ delta: number; reason: string; refId: string | null; createdAt: number }>();
  return rows.results;
}
