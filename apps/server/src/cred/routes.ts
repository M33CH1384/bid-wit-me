/**
 * Street Cred HTTP routes (Phase 3a + 3b):
 *   GET  /api/profile/me            → full profile (signed in)
 *   GET  /api/profile/:id           → public profile subset
 *   GET  /api/profile/pair/:id      → the CALLER's real team record with that player (signed in)
 *   GET  /api/challenges            → today's + this week's + this season's challenges with progress (signed in)
 *   POST /api/challenges/:id/claim  → claim a completed challenge reward — daily, weekly, or season (signed in)
 *   GET  /api/coins/balance         → coin balance (signed in)
 *   GET  /api/coins/ledger          → recent coin movements (signed in)
 *   POST /api/profile/me/avatar     → upload profile picture (signed in, JSON { dataUrl })
 *   DELETE /api/profile/me/avatar   → remove profile picture (signed in)
 *   POST /api/profile/me/tagline    → set profile tagline (signed in, JSON { tagline }; blank clears)
 *   POST /api/profile/me/social-links → set social links (signed in, JSON { links: { platform: urlOrHandle } })
 *   POST /api/profile/me/card       → set the Player Card's own fields (signed in,
 *                                     JSON { status, tags, showcase } → { ok, card })
 *
 * Both profile reads carry the Player Card payload (`card`, cred/card.ts):
 * the same self-contained card object for self and public views — the
 * public one additionally answers vsViewer when the caller has met the
 * subject across a table. The card carries ONLY public facts in both
 * shapes (the self payload's private extras stay challenges/unlocks).
 *
 * The profile picture (users.avatar, migration 0011) is a small data URL the client
 * compresses before upload. It is included in both profile responses so other players
 * can show it at the table — that visibility is the feature; nothing else extra leaks.
 */
import { type AuthEnv, currentUser } from '../auth/routes';
import { isAdmin } from '../social/routes';
import { hasStoryAccess } from '../story/access';
import { myStats } from '../stats/boards';
import { avatarOf, parseAvatarDataUrl } from './avatar';
import { cleanTagline, taglineOf } from './tagline';
import { badgeKey, cardFor, cleanCardShowcase, cleanCardStatus, cleanCardTags, earnedBadgesFor } from './card';
import { cleanRegion, regionOf } from './region';
import { applySocialLinksPatch, parseSocialLinks, socialLinksOf, validateSocialLinksPatch } from './socialLinks';
import { divisionOf, type Division } from './divisions';
import { ensureSeason } from './seasons';
import { xpSnapshot, awardXp, xpForLevel } from './xp';
import { progressFor, dailyChallenges, weeklyChallenges, dailyPeriodId, weeklyPeriodId, type ChallengesPayload } from './challenges';
import { currentSeasonId, seasonChallenges } from './seasonSets';
import { seasonUpkeepView, type SeasonUpkeepView } from './bigJokerSeason';
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

/** The challenges payload with its season block enriched: the season's
 *  display name + end and the Big Joker upkeep view ride the season
 *  object (progressFor deals in ids and progress only). Runs AFTER the
 *  profile's cardFor wherever both happen, so the upkeep latch it reads
 *  is fresh. */
export interface EnrichedChallenges extends ChallengesPayload {
  season: ChallengesPayload['season'] & SeasonUpkeepView;
}
async function enrichChallenges(db: D1Database, userId: string, challenges: ChallengesPayload, now: number): Promise<EnrichedChallenges> {
  const view = await seasonUpkeepView(db, userId, challenges.season.id, now);
  return { ...challenges, season: { ...challenges.season, ...view } };
}

async function unlockList(db: D1Database, userId: string) {
  const [owned, equipped] = await Promise.all([
    db.prepare('SELECT item_id AS itemId, source, unlocked_at AS unlockedAt FROM unlocks WHERE user_id = ?').bind(userId).all<{ itemId: string; source: string; unlockedAt: number }>(),
    db.prepare('SELECT slot, item_id AS itemId FROM equipped WHERE user_id = ?').bind(userId).all<{ slot: string; itemId: string | null }>(),
  ]);
  const byItem = new Map(equipped.results.filter((e) => e.itemId).map((e) => [e.itemId as string, e.slot]));
  return owned.results.map((u) => ({ itemId: u.itemId, source: u.source, unlockedAt: u.unlockedAt, slot: byItem.get(u.itemId) ?? null, equipped: byItem.has(u.itemId) }));
}

async function fullProfile(db: D1Database, userId: string, username: string, now: number, dev: boolean, storyAccess: boolean) {
  const season = await ensureSeason(db, now);
  // idempotent earners: welcome grant + daily login (cheap, safe to run on every profile read)
  try { await grantWelcome(db, userId, now); } catch { /* best-effort */ }
  try { await dailyLogin(db, userId, now); } catch { /* best-effort */ }
  const [level, team, cutthroat, challenges, achievements, unlocks, coins, pic, tagline, links, region] = await Promise.all([
    xpSnapshot(db, userId),
    seasonRank(db, userId, season.id, 'team'),
    seasonRank(db, userId, season.id, 'cutthroat'),
    progressFor(db, userId, now),
    achievementStates(db, userId),
    unlockList(db, userId),
    balance(db, userId),
    avatarOf(db, userId),
    taglineOf(db, userId),
    socialLinksOf(db, userId),
    regionOf(db, userId),
  ]);
  const stats = await myStats(db, userId);
  const card = await cardFor(db, userId, userId, now, { level, stats });
  // after cardFor: the Big Joker latch it maintains is fresh for the upkeep view
  const enrichedChallenges = await enrichChallenges(db, userId, challenges, now);
  return {
    user: { id: userId, name: username, avatar: pic.avatar, avatarUpdatedAt: pic.avatarUpdatedAt, tagline, socialLinks: links, region },
    card,
    /** developer (owner) accounts bypass unlock gates, e.g. The Pj's */
    dev,
    /** story-mode access (see story/access): admins, the named player
     *  allowlist while story mode is owner-only, everyone once the lock
     *  is off. The client keys the story lock off this — never off dev —
     *  so an allowlisted player plays without holding any dev surface. */
    storyAccess,
    level: { ...level, xpForNext: xpForLevel(level.level) },
    season: { id: season.id, name: season.name, endsAt: season.endsAt },
    rank: { team, cutthroat },
    stats,
    challenges: enrichedChallenges,
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
    return json(await fullProfile(db, me.id, me.username ?? 'Player', now, isAdmin(env, me.id, me.username ?? null), hasStoryAccess(env, me.id, me.username ?? null)));
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
  if (parts[1] === 'profile' && parts[2] === 'me' && parts[3] === 'card' && req.method === 'POST') {
    if (!me) return json({ error: 'Sign in to edit your card.' }, 401);
    let body: { status?: unknown; tags?: unknown; showcase?: unknown };
    try { body = (await req.json()) as { status?: unknown; tags?: unknown; showcase?: unknown }; } catch { return json({ error: 'Send your card as JSON.' }, 400); }
    const status = cleanCardStatus(body?.status);
    if (!status.ok) return json({ error: status.error }, 400);
    const tags = cleanCardTags(body?.tags);
    if (!tags.ok) return json({ error: tags.error }, 400);
    // Showcase membership is judged against a freshly computed earned set —
    // never against anything the client claims to have earned.
    const earned = await earnedBadgesFor(db, me.id);
    const showcase = cleanCardShowcase(body?.showcase, new Set(earned.map(badgeKey)));
    if (!showcase.ok) return json({ error: showcase.error }, 400);
    await db.prepare('UPDATE users SET card_status = ?, card_tags = ?, card_showcase = ? WHERE id = ?')
      .bind(status.value, tags.value.length ? JSON.stringify(tags.value) : null, showcase.value.length ? JSON.stringify(showcase.value) : null, me.id).run();
    return json({ ok: true, card: await cardFor(db, me.id, me.id, now) });
  }
  if (parts[1] === 'profile' && parts[2] === 'me' && parts[3] === 'region' && req.method === 'POST') {
    if (!me) return json({ error: 'Sign in to set your region.' }, 401);
    let body: { region?: unknown };
    try { body = (await req.json()) as { region?: unknown }; } catch { return json({ error: 'Send the region as JSON.' }, 400); }
    const cleaned = cleanRegion(body?.region);
    if (!cleaned.ok) return json({ error: cleaned.error }, 400);
    await db.prepare('UPDATE users SET region = ? WHERE id = ?').bind(cleaned.region, me.id).run();
    return json({ ok: true, region: cleaned.region });
  }
  if (parts[1] === 'profile' && parts[2] === 'me' && parts[3] === 'social-links' && req.method === 'POST') {
    if (!me) return json({ error: 'Sign in to edit your links.' }, 401);
    let body: { links?: unknown };
    try { body = (await req.json()) as { links?: unknown }; } catch { return json({ error: 'Send your links as JSON.' }, 400); }
    const checked = validateSocialLinksPatch(body?.links);
    if (!checked.ok) return json({ error: checked.error }, 400);
    const merged = applySocialLinksPatch(await socialLinksOf(db, me.id), checked.patch);
    await db.prepare('UPDATE users SET social_links = ? WHERE id = ?')
      .bind(Object.keys(merged).length ? JSON.stringify(merged) : null, me.id).run();
    return json({ ok: true, socialLinks: merged });
  }
  if (parts[1] === 'profile' && parts[2] === 'pair' && parts[3] && parts.length === 4 && req.method === 'GET') {
    // The caller's OWN established-team record with one other player, computed
    // from real recorded games (game_players.partner_id — the same rows the
    // pair leaderboards aggregate). Caller-scoped by design: it answers "our
    // record together" for the signed-in player only, never a third party's.
    // streak is signed: + current win streak, − current loss streak.
    if (!me) return json({ error: 'Sign in to see your team record.' }, 401);
    const other = parts[3].slice(0, 64);
    if (other === me.id) return json({ games: 0, wins: 0, losses: 0, streak: 0 });
    const totals = await db.prepare(
      "SELECT COUNT(*) AS games, COALESCE(SUM(won), 0) AS wins FROM game_players WHERE user_id = ? AND partner_id = ? AND kind = 'team'",
    ).bind(me.id, other).first<{ games: number; wins: number }>();
    const games = totals?.games ?? 0;
    const wins = totals?.wins ?? 0;
    let streak = 0;
    if (games > 0) {
      const recent = await db.prepare(
        "SELECT won FROM game_players WHERE user_id = ? AND partner_id = ? AND kind = 'team' ORDER BY ended_at DESC, game_id DESC LIMIT 500",
      ).bind(me.id, other).all<{ won: number }>();
      const rows = recent.results ?? [];
      if (rows.length) {
        const dir = rows[0]!.won ? 1 : -1;
        let run = 0;
        for (const r of rows) { if ((r.won ? 1 : -1) !== dir) break; run++; }
        streak = dir * run;
      }
    }
    return json({ games, wins, losses: games - wins, streak });
  }
  if (parts[1] === 'profile' && parts[2] && parts.length === 3 && req.method === 'GET') {
    const u = await db.prepare('SELECT id, username, avatar, avatar_updated_at AS avatarUpdatedAt, tagline, social_links AS socialLinks FROM users WHERE id = ?').bind(parts[2].slice(0, 64)).first<{ id: string; username: string | null; avatar: string | null; avatarUpdatedAt: number | null; tagline: string | null; socialLinks: string | null }>();
    if (!u) return json({ error: 'not found' }, 404);
    const season = await ensureSeason(db, now);
    const [level, team, cutthroat, achievements, coinBalance] = await Promise.all([
      xpSnapshot(db, u.id),
      seasonRank(db, u.id, season.id, 'team'),
      seasonRank(db, u.id, season.id, 'cutthroat'),
      achievementStates(db, u.id),
      balance(db, u.id),
    ]);
    const stats = await myStats(db, u.id);
    const card = await cardFor(db, u.id, me?.id ?? null, now, { level, stats });
    // coins: the public balance is part of the profile by the owner's call (players see
    // each other's balance on profile cards, 2026-10-20). Read-only: no grants fire here —
    // a user with no coin row yet genuinely sits at 0 until their own profile read grants.
    return json({ user: { id: u.id, name: u.username ?? 'Player', avatar: u.avatar, avatarUpdatedAt: u.avatarUpdatedAt, tagline: u.tagline, socialLinks: parseSocialLinks(u.socialLinks) }, card, level, season: { id: season.id, name: season.name, endsAt: season.endsAt }, rank: { team, cutthroat }, stats, achievements, coins: { balance: coinBalance } });
  }
  if (parts[1] === 'challenges' && parts.length === 2 && req.method === 'GET') {
    if (!me) return json({ error: 'Sign in to see your challenges.' }, 401);
    return json(await enrichChallenges(db, me.id, await progressFor(db, me.id, now), now));
  }
  if (parts[1] === 'challenges' && parts[3] === 'claim' && req.method === 'POST') {
    if (!me) return json({ error: 'Sign in to claim rewards.' }, 401);
    const id = parts[2] ?? '';
    const daily = dailyChallenges(now), weekly = weeklyChallenges(now);
    const def = [...daily, ...weekly, ...seasonChallenges(now)].find((c) => c.id === id);
    if (!def) return json({ error: 'That challenge is not active right now.' }, 400);
    const pid = def.cadence === 'daily' ? dailyPeriodId(now) : def.cadence === 'weekly' ? weeklyPeriodId(now) : currentSeasonId(now);
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
