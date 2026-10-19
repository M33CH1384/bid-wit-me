/**
 * Street Cred HTTP routes (Phase 3a):
 *   GET  /api/profile/me            → full profile (signed in)
 *   GET  /api/profile/:id           → public profile subset
 *   GET  /api/challenges            → today's + this week's challenges with progress (signed in)
 *   POST /api/challenges/:id/claim  → claim a completed challenge reward (signed in)
 * Coins are Phase 3b: defs carry coin values, nothing is credited yet.
 */
import { type AuthEnv, currentUser } from '../auth/routes';
import { myStats } from '../stats/boards';
import { divisionOf, type Division } from './divisions';
import { ensureSeason } from './seasons';
import { xpSnapshot, awardXp, xpForLevel } from './xp';
import { progressFor, dailyChallenges, weeklyChallenges, dailyPeriodId, weeklyPeriodId } from './challenges';
import { achievementStates } from './achievements';

export interface CredEnv extends AuthEnv {}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

interface SeasonRank { division: Division; elo: number; games: number; wins: number; losses: number; peak: number; rank: number; of: number }

async function seasonRank(db: D1Database, userId: string, seasonId: string, kind: 'team' | 'cutthroat'): Promise<SeasonRank> {
  const row = await db.prepare(`SELECT rating, division, games, wins, losses, peak_rating AS peak FROM season_ratings
    WHERE user_id = ? AND season_id = ? AND kind = ?`).bind(userId, seasonId, kind)
    .first<{ rating: number; division: Division; games: number; wins: number; losses: number; peak: number }>();
  const rating = row?.rating ?? 1000;
  const division = row?.division ?? divisionOf(rating);
  const [above, total] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM season_ratings WHERE season_id = ? AND kind = ? AND division = ? AND rating > ?').bind(seasonId, kind, division, rating).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM season_ratings WHERE season_id = ? AND kind = ? AND division = ?').bind(seasonId, kind, division).first<{ n: number }>(),
  ]);
  return { division, elo: Math.round(rating), games: row?.games ?? 0, wins: row?.wins ?? 0, losses: row?.losses ?? 0, peak: Math.round(row?.peak ?? rating), rank: (above?.n ?? 0) + 1, of: total?.n ?? 1 };
}

async function unlockList(db: D1Database, userId: string) {
  const [owned, equipped] = await Promise.all([
    db.prepare('SELECT item_id AS itemId, source, unlocked_at AS unlockedAt FROM unlocks WHERE user_id = ?').bind(userId).all<{ itemId: string; source: string; unlockedAt: number }>(),
    db.prepare('SELECT slot, item_id AS itemId FROM equipped WHERE user_id = ?').bind(userId).all<{ slot: string; itemId: string | null }>(),
  ]);
  const byItem = new Map(equipped.results.filter((e) => e.itemId).map((e) => [e.itemId as string, e.slot]));
  return owned.results.map((u) => ({ itemId: u.itemId, source: u.source, unlockedAt: u.unlockedAt, slot: byItem.get(u.itemId) ?? null, equipped: byItem.has(u.itemId) }));
}

async function fullProfile(db: D1Database, userId: string, username: string, now: number) {
  const season = await ensureSeason(db, now);
  const [level, team, cutthroat, challenges, achievements, unlocks] = await Promise.all([
    xpSnapshot(db, userId),
    seasonRank(db, userId, season.id, 'team'),
    seasonRank(db, userId, season.id, 'cutthroat'),
    progressFor(db, userId, now),
    achievementStates(db, userId),
    unlockList(db, userId),
  ]);
  const stats = await myStats(db, userId);
  return {
    user: { id: userId, name: username },
    level: { ...level, xpForNext: xpForLevel(level.level) },
    season: { id: season.id, name: season.name, endsAt: season.endsAt },
    rank: { team, cutthroat },
    stats,
    challenges,
    achievements,
    unlocks,
  };
}

export async function handleCredHttp(req: Request, env: CredEnv, url: URL, parts: string[], now: number): Promise<Response> {
  if (!env.DB) return json({ error: 'accounts are not configured' }, 503);
  const db = env.DB;
  const me = await currentUser(req, env, url, now);

  if (parts[1] === 'profile' && parts[2] === 'me' && req.method === 'GET') {
    if (!me) return json({ error: 'Sign in to see your profile.' }, 401);
    return json(await fullProfile(db, me.id, me.username ?? 'Player', now));
  }
  if (parts[1] === 'profile' && parts[2] && req.method === 'GET') {
    const u = await db.prepare('SELECT id, username FROM users WHERE id = ?').bind(parts[2].slice(0, 64)).first<{ id: string; username: string | null }>();
    if (!u) return json({ error: 'not found' }, 404);
    const season = await ensureSeason(db, now);
    const [level, team, cutthroat, achievements] = await Promise.all([
      xpSnapshot(db, u.id),
      seasonRank(db, u.id, season.id, 'team'),
      seasonRank(db, u.id, season.id, 'cutthroat'),
      achievementStates(db, u.id),
    ]);
    const stats = await myStats(db, u.id);
    return json({ user: { id: u.id, name: u.username ?? 'Player' }, level, season: { id: season.id, name: season.name, endsAt: season.endsAt }, rank: { team, cutthroat }, stats, achievements });
  }
  if (parts[1] === 'challenges' && parts.length === 2 && req.method === 'GET') {
    if (!me) return json({ error: 'Sign in to see your challenges.' }, 401);
    return json(await progressFor(db, me.id, now));
  }
  if (parts[1] === 'challenges' && parts[3] === 'claim' && req.method === 'POST') {
    if (!me) return json({ error: 'Sign in to claim rewards.' }, 401);
    const id = parts[2] ?? '';
    const daily = dailyChallenges(now), weekly = weeklyChallenges(now);
    const def = [...daily, ...weekly].find((c) => c.id === id);
    if (!def) return json({ error: 'That challenge is not active right now.' }, 400);
    const pid = def.cadence === 'daily' ? dailyPeriodId(now) : weeklyPeriodId(now);
    const row = await db.prepare('SELECT progress, claimed_at AS claimedAt FROM challenge_progress WHERE user_id = ? AND challenge_id = ? AND period_id = ?')
      .bind(me.id, id, pid).first<{ progress: number; claimedAt: number | null }>();
    if (row?.claimedAt) return json({ error: 'Already claimed.' }, 400);
    if ((row?.progress ?? 0) < def.target) return json({ error: 'Challenge not complete yet.', progress: row?.progress ?? 0, target: def.target }, 400);
    await db.prepare('UPDATE challenge_progress SET claimed_at = ? WHERE user_id = ? AND challenge_id = ? AND period_id = ?').bind(now, me.id, id, pid).run();
    await awardXp(db, me.id, def.xp, now);
    // coins: value only — no ledger until Phase 3b
    return json({ ok: true, xp: def.xp, coins: def.coins });
  }
  return json({ error: 'not found' }, 404);
}
