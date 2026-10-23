/** Street Cred System A: monthly seasons. */
import { divisionOf } from './divisions';
import { DAILY_POOL, WEEKLY_POOL } from './challenges';
import { SEASON_POOL } from './seasonSets';
import { ACHIEVEMENTS } from './achievements';

export interface Season { id: string; name: string; startsAt: number; endsAt: number }

const MONTH = 'YYYY-MM';
const monthId = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/** 'Season N' where N counts from 2026-10 = Season 1. */
export function seasonName(id: string): string {
  const [y, m] = id.split('-').map(Number);
  return `Season ${(y! - 2026) * 12 + (m! - 10) + 1}`;
}

/** Season boundaries in UTC: 1st 00:00:00 to 1st of next month. */
export function seasonBounds(id: string): { startsAt: number; endsAt: number } {
  const [y, m] = id.split('-').map(Number);
  return { startsAt: Date.UTC(y!, m! - 1, 1), endsAt: Date.UTC(m === 12 ? y! + 1 : y!, m === 12 ? 0 : m!, 1) };
}

/** Soft reset at season start: rating drifts halfway back to 1000. */
export const softReset = (rating: number): number => Math.round(1000 + (rating - 1000) * 0.5);

/**
 * Create the current month's season row if missing, and on first touch carry every
 * rated player's all-time Elo forward (soft-reset) into season_ratings. Also backfills
 * challenge/achievement defs if a DB predates their seed rows. Idempotent.
 */
export async function ensureSeason(db: D1Database, now: number): Promise<Season> {
  const id = monthId(new Date(now));
  let row = await db.prepare('SELECT id, name, starts_at AS startsAt, ends_at AS endsAt FROM seasons WHERE id = ?').bind(id).first<Season & { startsAt: number; endsAt: number }>();
  if (!row) {
    const { startsAt, endsAt } = seasonBounds(id);
    const name = seasonName(id);
    await db.prepare('INSERT OR IGNORE INTO seasons (id, name, starts_at, ends_at, status) VALUES (?, ?, ?, ?, ?)').bind(id, name, startsAt, endsAt, now < endsAt ? 'active' : 'final').run();
    // first touch: carry ratings forward, soft-reset
    const rated = (await db.prepare('SELECT user_id, kind, elo, games FROM ratings').all<{ user_id: string; kind: string; elo: number; games: number }>()).results;
    const stmts = rated.filter((r) => r.games > 0).map((r) => {
      const rating = softReset(Math.round(r.elo));
      return db.prepare(`INSERT OR IGNORE INTO season_ratings (user_id, season_id, kind, rating, division, games, wins, losses, peak_rating)
        VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?)`).bind(r.user_id, id, r.kind, rating, divisionOf(rating), rating);
    });
    if (stmts.length) await db.batch(stmts);
    await backfillDefs(db);
    row = { id, name, startsAt, endsAt } as unknown as Season & { startsAt: number; endsAt: number };
  }
  return { id: row.id, name: row.name, startsAt: (row as unknown as { startsAt: number }).startsAt, endsAt: (row as unknown as { endsAt: number }).endsAt };
}

/** Re-seed def tables when a database was created before their seed rows existed. */
export async function backfillDefs(db: D1Database): Promise<void> {
  const have = await db.prepare('SELECT COUNT(*) AS n FROM challenge_defs').first<{ n: number }>();
  if (!have?.n) {
    const all = [...DAILY_POOL, ...WEEKLY_POOL, ...SEASON_POOL];
    await db.batch(all.map((c) => db.prepare('INSERT OR IGNORE INTO challenge_defs (id, cadence, title, metric, target, xp, coins, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(c.id, c.cadence, c.title, c.metric, c.target, c.xp, c.coins, c.kind ?? null)));
  }
  const haveA = await db.prepare('SELECT COUNT(*) AS n FROM achievement_defs').first<{ n: number }>();
  if (!haveA?.n) {
    await db.batch(ACHIEVEMENTS.map((a) => db.prepare('INSERT OR IGNORE INTO achievement_defs (id, title, hint, xp, condition_json) VALUES (?, ?, ?, ?, ?)')
      .bind(a.id, a.title, a.hint, a.xp, JSON.stringify(a.condition))));
  }
}

export { MONTH };
