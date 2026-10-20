/**
 * Street Cred HTTP routes (Phase 3a + 3b):
 *   GET  /api/profile/me            → full profile (signed in)
 *   GET  /api/profile/:id           → public profile subset
 *   GET  /api/challenges            → today's + this week's challenges with progress (signed in)
 *   POST /api/challenges/:id/claim  → claim a completed challenge reward (signed in)
 *   GET  /api/coins/balance         → coin balance (signed in)
 *   GET  /api/coins/ledger          → recent coin movements (signed in)
 *   POST /api/profile/me/avatar     → upload profile picture (signed in, JSON { dataUrl })
 *   DELETE /api/profile/me/avatar   → remove profile picture (signed in)
 *   POST /api/profile/me/tagline    → set profile tagline (signed in, JSON { tagline }; blank clears)
 *
 * The profile picture (users.avatar, migration 0011) is a small data URL the client
 * compresses before upload. It is included in both profile responses so other players
 * can show it at the table — that visibility is the feature; nothing else extra leaks.
 */
import { type AuthEnv, currentUser } from '../auth/routes';
import { isAdmin } from '../social/routes';
import { myStats } from '../stats/boards';
import { avatarOf, parseAvatarDataUrl } from './avatar';
import { cleanTagline, taglineOf } from './tagline';
import { divisionOf, type Division } from './divisions';
import { ensureSeason } from './seasons';
import { xpSnapshot, awardXp, xpForLevel } from './xp';
import { progressFor, dailyChallenges, weeklyChallenges, dailyPeriodId, weeklyPeriodId } from './challenges';
import { achievementStates } from './achievements';
import { balance, ledger, move, grantWelcome, dailyLogin, earnMultiplier } from './coins';

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

async function fullProfile(db: D1Database, userId: string, username: string, now: number, dev: boolean) {
  const season = await ensureSeason(db, now);
  // idempotent earners: welcome grant + daily login (cheap, safe to run on every profile read)
  try { await grantWelcome(db, userId, now); } catch { /* best-effort */ }
  try { await dailyLogin(db, userId, now); } catch { /* best-effort */ }
  const [level, team, cutthroat, challenges, achievements, unlocks, coins, pic, tagline] = await Promise.all([
    xpSnapshot(db, userId),
    seasonRank(db, userId, season.id, 'team'),
    seasonRank(db, userId, season.id, 'cutthroat'),
    progressFor(db, userId, now),
    achievementStates(db, userId),
    unlockList(db, userId),
    balance(db, userId),
    avatarOf(db, userId),
    taglineOf(db, userId),
  ]);
  const stats = await myStats(db, userId);
  return {
    user: { id: userId, name: username, avatar: pic.avatar, avatarUpdatedAt: pic.avatarUpdatedAt, tagline },
    /** developer (owner) accounts bypass unlock gates, e.g. The Pj's */
    dev,
    level: { ...level, xpForNext: xpForLevel(level.level) },
    season: { id: season.id, name: season.name, endsAt: season.endsAt },
    rank: { team, cutthroat },
    stats,
    challenges,
    achievements,
    unlocks,
    coins: { balance: coins },
  };
}

export async function handleCredHttp(req: Request, env: CredEnv, url: URL, parts: string[], now: number): Promise<Response> {
  if (!env.DB) return json({ error: 'accounts are not configured' }, 503);
  const db = env.DB;
  const me = await currentUser(req, env, url, now);

  if (parts[1] === 'profile' && parts[2] === 'me' && req.method === 'GET') {
    if (!me) return json({ error: 'Sign in to see your profile.' }, 401);
    return json(await fullProfile(db, me.id, me.username ?? 'Player', now, isAdmin(env, me.id, me.username ?? null)));
  }
  if (parts[1] === 'profile' && parts[2] === 'me' && parts[3] === 'avatar' && (req.method === 'POST' || req.method === 'DELETE')) {
    if (!me) return json({ error: 'Sign in to change your picture.' }, 401);
    if (req.method === 'DELETE') {
      await db.prepare('UPDATE users SET avatar = NULL, avatar_updated_at = ? WHERE id = ?').bind(now, me.id).run();
      return json({ ok: true, avatar: null });
    }
    let body: { dataUrl?: unknown };
    try { body = (await req.json()) as { dataUrl?: unknown }; } catch { return json({ error: 'Send the picture as JSON.' }, 400); }
    const parsed = parseAvatarDataUrl(body?.dataUrl);
    if (!parsed.ok) return json({ error: parsed.error }, 400);
    await db.prepare('UPDATE users SET avatar = ?, avatar_updated_at = ? WHERE id = ?').bind(parsed.dataUrl, now, me.id).run();
    return json({ ok: true, avatar: parsed.dataUrl, avatarUpdatedAt: now });
  }
  if (parts[1] === 'profile' && parts[2] === 'me' && parts[3] === 'tagline' && req.method === 'POST') {
    if (!me) return json({ error: 'Sign in to set your tagline.' }, 401);
    let body: { tagline?: unknown };
    try { body = (await req.json()) as { tagline?: unknown }; } catch { return json({ error: 'Send the tagline as JSON.' }, 400); }
    const cleaned = cleanTagline(body?.tagline);
    if (!cleaned.ok) return json({ error: cleaned.error }, 400);
    await db.prepare('UPDATE users SET tagline = ? WHERE id = ?').bind(cleaned.tagline, me.id).run();
    return json({ ok: true, tagline: cleaned.tagline });
  }
  if (parts[1] === 'profile' && parts[2] && parts.length === 3 && req.method === 'GET') {
    const u = await db.prepare('SELECT id, username, avatar, avatar_updated_at AS avatarUpdatedAt, tagline FROM users WHERE id = ?').bind(parts[2].slice(0, 64)).first<{ id: string; username: string | null; avatar: string | null; avatarUpdatedAt: number | null; tagline: string | null }>();
    if (!u) return json({ error: 'not found' }, 404);
    const season = await ensureSeason(db, now);
    const [level, team, cutthroat, achievements] = await Promise.all([
      xpSnapshot(db, u.id),
      seasonRank(db, u.id, season.id, 'team'),
      seasonRank(db, u.id, season.id, 'cutthroat'),
      achievementStates(db, u.id),
    ]);
    const stats = await myStats(db, u.id);
    return json({ user: { id: u.id, name: u.username ?? 'Player', avatar: u.avatar, avatarUpdatedAt: u.avatarUpdatedAt, tagline: u.tagline }, level, season: { id: season.id, name: season.name, endsAt: season.endsAt }, rank: { team, cutthroat }, stats, achievements });
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
    const awarded = await awardXp(db, me.id, def.xp, now);
    // coins: challenge reward (× earn multiplier) + level-up bonus when the XP leveled them up
    const mult = await earnMultiplier(db);
    await move(db, me.id, Math.round(def.coins * mult), 'challenge', id, now);
    if (awarded.leveledUp) await move(db, me.id, 50 * awarded.level, 'level_up', `challenge:${id}`, now);
    return json({ ok: true, xp: def.xp, coins: def.coins });
  }
  if (parts[1] === 'coins' && parts[2] === 'balance' && req.method === 'GET') {
    if (!me) return json({ error: 'Sign in to see your coins.' }, 401);
    return json({ balance: await balance(db, me.id) });
  }
  if (parts[1] === 'coins' && parts[2] === 'ledger' && req.method === 'GET') {
    if (!me) return json({ error: 'Sign in to see your ledger.' }, 401);
    const limit = parseInt(url.searchParams.get('limit') ?? '25', 10);
    return json({ rows: await ledger(db, me.id, limit) });
  }
  return json({ error: 'not found' }, 404);
}
