/** Street Cred System B: XP and levels. Pure math, unit-tested. */

export const MAX_LEVEL = 50;

/** XP to go from level n to n+1. */
export const xpForLevel = (n: number): number => 100 + n * 25;

/** Total XP banked at the moment of reaching `level` (level 1 = 0). */
export function xpAtLevel(level: number): number {
  let t = 0;
  for (let n = 1; n < level; n++) t += xpForLevel(n);
  return t;
}

/** Level for a lifetime XP total (1..50). */
export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpAtLevel(level + 1)) level++;
  return level;
}

/** Milestone titles: the highest milestone at or below the level. */
const TITLES: [number, string][] = [
  [50, 'The Mayor'],
  [40, 'Hood Legend'],
  [30, 'Shot Caller'],
  [20, 'Block Captain'],
  [10, 'Block Member'],
  [5, 'Corner Regular'],
  [1, 'New Jack'],
];
export const titleForLevel = (level: number): string => TITLES.find(([m]) => level >= m)?.[1] ?? 'New Jack';

/** XP still needed to reach the next level (0 at cap). */
export const xpToNext = (level: number, xp: number): number => (level >= MAX_LEVEL ? 0 : Math.max(0, xpAtLevel(level + 1) - xp));

export interface AwardResult { xp: number; level: number; leveledUp: boolean; title: string }

/**
 * Add XP to a player's lifetime total. Creates the row on first touch.
 * Returns the new totals; leveledUp is true when the level increased.
 */
export async function awardXp(db: D1Database, userId: string, amount: number, now: number): Promise<AwardResult> {
  if (!(amount > 0)) {
    const row = await db.prepare('SELECT xp, level FROM xp_state WHERE user_id = ?').bind(userId).first<{ xp: number; level: number }>();
    const xp = row?.xp ?? 0, level = row?.level ?? levelForXp(xp);
    return { xp, level, leveledUp: false, title: titleForLevel(level) };
  }
  const row = await db.prepare('SELECT xp, level FROM xp_state WHERE user_id = ?').bind(userId).first<{ xp: number; level: number }>();
  const before = row?.xp ?? 0;
  const xp = before + Math.floor(amount);
  const level = levelForXp(xp);
  const prevLevel = row?.level ?? levelForXp(before);
  await db.prepare(`INSERT INTO xp_state (user_id, xp, level, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET xp = excluded.xp, level = excluded.level, updated_at = excluded.updated_at`).bind(userId, xp, level, now).run();
  return { xp, level, leveledUp: level > prevLevel, title: titleForLevel(level) };
}

/** Read-only snapshot for profile payloads. */
export async function xpSnapshot(db: D1Database, userId: string): Promise<{ level: number; xp: number; xpForNext: number; xpIntoLevel: number; title: string }> {
  const row = await db.prepare('SELECT xp, level FROM xp_state WHERE user_id = ?').bind(userId).first<{ xp: number; level: number }>();
  const xp = row?.xp ?? 0;
  const level = row?.level ?? levelForXp(xp);
  const base = xpAtLevel(level);
  return { level, xp, xpForNext: xpForLevel(level), xpIntoLevel: xp - base, title: titleForLevel(level) };
}
