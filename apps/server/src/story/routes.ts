/**
 * Story Mode HTTP routes (Phase 1 — solo route):
 *   GET  /api/story/progress?track=solo   → the caller's progress on a track
 *   POST /api/story/result { track?, stopId, won, gameId }
 *        → record a finished solo stop game: attempt always recorded; a win
 *          clears the stop (server-validated sequential unlock), pays the
 *          first-clear reward once (or the small replay upkeep), and the
 *          King clear stamps the track's completion mark.
 *
 * Server-authoritative, like the rest of Rep: the client reports only which
 * stop it finished and whether its side won (the same trust level as the
 * offline-game upload, /api/stats/local — offline games are rebuilt and
 * checked there; story stops are offline games, so progress writes are
 * unlock-checked and reward-capped here). Rewards are computed from the stop
 * number by @spades/bots storyReward — never from client-sent amounts.
 * Idempotent per gameId: re-posting the same finished game returns the
 * stored outcome without re-crediting or re-counting the attempt.
 *
 * Story matches are UNRATED: nothing here touches ratings/season_ratings,
 * and the solo game itself is an offline game whose local upload is
 * suppressed client-side so it can't be double-counted as a normal bot game.
 *
 * Tracks: Phase 1 writes the 'solo' track only. The track-key shape
 * ('pair:<uidA>:<uidB>', see storyPairTrackKey in @spades/bots) is validated
 * now so Phase 2 co-op writes land in the same tables unchanged.
 */
import { type AuthEnv, currentUser } from '../auth/routes';
import { type SocialEnv, isAdmin } from '../social/routes';
import {
  STORY_SECRETS, STORY_STOPS, STORY_SOLO_TRACK, storyCurrentStop, storyEggById, storyEggEventMet,
  storyFeatMet, storyReward, storyStopById, storyStopState, storyTrackKeyValid,
  type StoryGameFacts, type StoryMatchEvent,
} from '@spades/bots';
import { awardXp } from '../cred/xp';
import { move } from '../cred/coins';
import { grantUnlock } from '../cred/achievements';

export interface StoryEnv extends AuthEnv, SocialEnv {}

/**
 * STORY_OWNER_ONLY — the one switch for the story-mode lock (owner,
 * 2026-10-21): story mode stays admin-only while it is being finished.
 * While true, every story endpoint answers 403 to non-admin accounts
 * (the same isAdmin machinery as The Pj's dev bypass) and the client
 * shows the locked state to non-dev players. TO OPEN STORY MODE TO
 * EVERYONE: set this to false here AND STORY_OWNER_ONLY to false in
 * apps/web/src/story/storyApi.ts — nothing else changes.
 */
export const STORY_OWNER_ONLY = true;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

interface StopFacts { attempts: number; clears: number; firstClearedAt: number | null }

async function factsFor(db: D1Database, userId: string, track: string): Promise<Map<string, StopFacts>> {
  const rows = await db.prepare('SELECT stop_id AS stopId, attempts, clears, first_cleared_at AS firstClearedAt FROM story_progress WHERE user_id = ? AND track_key = ?')
    .bind(userId, track).all<{ stopId: string; attempts: number; clears: number; firstClearedAt: number | null }>();
  return new Map(rows.results.map((r) => [r.stopId, { attempts: r.attempts, clears: r.clears, firstClearedAt: r.firstClearedAt }]));
}

/** Found eggs + earned feats on a track (story_finds, migration 0022). */
export async function findsFor(db: D1Database, userId: string, track: string): Promise<{ eggs: string[]; feats: string[] }> {
  const rows = await db.prepare('SELECT kind, find_id AS findId FROM story_finds WHERE user_id = ? AND track_key = ?')
    .bind(userId, track).all<{ kind: string; findId: string }>();
  return {
    eggs: rows.results.filter((r) => r.kind === 'egg').map((r) => r.findId),
    feats: rows.results.filter((r) => r.kind === 'feat').map((r) => r.findId),
  };
}

/** Record a find idempotently; returns true when it is genuinely new. */
async function recordFind(db: D1Database, userId: string, track: string, kind: 'egg' | 'feat', findId: string, now: number): Promise<boolean> {
  const prior = await db.prepare('SELECT find_id AS findId FROM story_finds WHERE user_id = ? AND track_key = ? AND kind = ? AND find_id = ?')
    .bind(userId, track, kind, findId).first();
  if (prior) return false;
  await db.prepare('INSERT OR IGNORE INTO story_finds (user_id, track_key, kind, find_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(userId, track, kind, findId, now).run();
  return true;
}

/** Loose validation of the client-computed game facts (offline trust level — the same
 *  level as the result itself; every field is clamped to its honest range). */
function gameFactsOf(raw: unknown): StoryGameFacts | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : 0);
  return {
    margin: num(f.margin, -2000, 2000),
    handsPlayed: num(f.handsPlayed, 0, 200),
    setsAgainstUs: num(f.setsAgainstUs, 0, 200),
    setsAgainstThem: num(f.setsAgainstThem, 0, 200),
    ourNilsMade: num(f.ourNilsMade, 0, 50),
    ourBlindNilsMade: num(f.ourBlindNilsMade, 0, 50),
    deeNilsMade: num(f.deeNilsMade, 0, 50),
    deeSteady: f.deeSteady === true,
    setOnFirstHand: f.setOnFirstHand === true,
    oppSetTwice: f.oppSetTwice === true,
  };
}

export async function storyProgressPayload(db: D1Database, userId: string, track: string) {
  const facts = await factsFor(db, userId, track);
  const cleared = new Set<number>();
  for (const s of STORY_STOPS) if ((facts.get(s.id)?.clears ?? 0) > 0) cleared.add(s.n);
  const trackRow = await db.prepare('SELECT completed_at AS completedAt FROM story_tracks WHERE user_id = ? AND track_key = ?')
    .bind(userId, track).first<{ completedAt: number | null }>();
  const finds = await findsFor(db, userId, track);
  return {
    track,
    stops: STORY_STOPS.map((s) => {
      const f = facts.get(s.id);
      return {
        stopId: s.id, n: s.n, state: storyStopState(s.n, cleared),
        attempts: f?.attempts ?? 0, clears: f?.clears ?? 0, firstClearedAt: f?.firstClearedAt ?? null,
      };
    }),
    currentStop: storyCurrentStop(cleared),
    completed: trackRow?.completedAt != null,
    completedAt: trackRow?.completedAt ?? null,
    /** found Easter eggs (egg ids) + earned feats (unlockable itemIds) on this track */
    finds,
    /** the solo completion mark (Phase 3 displays it on profiles; the fact is stored now) */
    completionMark: track === STORY_SOLO_TRACK && trackRow?.completedAt != null ? 'story-solo-complete' : null,
  };
}

export async function handleStoryHttp(req: Request, env: StoryEnv, url: URL, parts: string[], now: number): Promise<Response> {
  if (!env.DB) return json({ error: 'accounts are not configured' }, 503);
  const db = env.DB;
  const me = await currentUser(req, env, url, now);
  if (!me) return json({ error: 'Sign in to run the route.' }, 401);
  // Owner-only while story mode is being finished (see STORY_OWNER_ONLY).
  if (STORY_OWNER_ONLY && !isAdmin(env, me.id, me.username)) {
    return json({ error: 'Story mode is locked while it is being finished.' }, 403);
  }

  if (parts[1] === 'story' && parts[2] === 'progress' && req.method === 'GET') {
    const track = url.searchParams.get('track') ?? STORY_SOLO_TRACK;
    if (!storyTrackKeyValid(track)) return json({ error: 'bad track' }, 400);
    return json(await storyProgressPayload(db, me.id, track));
  }

  // A scene-side Easter egg was found (sceneTap / deeTap / chain). Match-event
  // eggs are NOT accepted here — they are granted from result facts only.
  if (parts[1] === 'story' && parts[2] === 'found' && req.method === 'POST') {
    let body: { track?: unknown; eggId?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return json({ error: 'Send the find as JSON.' }, 400); }
    const track = typeof body.track === 'string' ? body.track : STORY_SOLO_TRACK;
    if (!storyTrackKeyValid(track) || track !== STORY_SOLO_TRACK) return json({ error: 'bad track' }, 400);
    const found = typeof body.eggId === 'string' ? storyEggById(body.eggId) : undefined;
    if (!found) return json({ error: 'unknown egg' }, 400);
    if (found.egg.trigger.type === 'matchEvent') return json({ error: 'that one is earned in the game, not reported' }, 400);
    const stop = storyStopById(found.stopId)!;
    const facts = await factsFor(db, me.id, track);
    const cleared = new Set<number>();
    for (const s of STORY_STOPS) if ((facts.get(s.id)?.clears ?? 0) > 0) cleared.add(s.n);
    if (storyStopState(stop.n, cleared) === 'locked') return json({ error: 'That stop is locked — clear the route in order.' }, 409);
    if (found.egg.trigger.type === 'chain') {
      const fromEgg = STORY_SECRETS[found.egg.trigger.fromStopId]?.egg;
      const finds = await findsFor(db, me.id, track);
      if (!fromEgg || !finds.eggs.includes(fromEgg.id)) return json({ error: 'the chain fact is not in hand' }, 409);
    }
    const isNew = await recordFind(db, me.id, track, 'egg', found.egg.id, now);
    const progress = await storyProgressPayload(db, me.id, track);
    return json({ ok: true, eggId: found.egg.id, new: isNew, ...progress });
  }

  if (parts[1] === 'story' && parts[2] === 'result' && req.method === 'POST') {
    let body: { track?: unknown; stopId?: unknown; won?: unknown; gameId?: unknown; facts?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return json({ error: 'Send the result as JSON.' }, 400); }
    const track = typeof body.track === 'string' ? body.track : STORY_SOLO_TRACK;
    if (!storyTrackKeyValid(track)) return json({ error: 'bad track' }, 400);
    if (track !== STORY_SOLO_TRACK) return json({ error: 'Co-op story tracks arrive in Phase 2.' }, 400);
    const stop = typeof body.stopId === 'string' ? storyStopById(body.stopId) : undefined;
    if (!stop) return json({ error: 'unknown stop' }, 400);
    const won = body.won === true;
    const gameId = typeof body.gameId === 'string' ? body.gameId.slice(0, 80) : '';
    if (!gameId) return json({ error: 'gameId required' }, 400);

    // Idempotency: one finished game = one recorded result, ever.
    const prior = await db.prepare('SELECT stop_id AS stopId, won, first_clear AS firstClear, xp, coins FROM story_claims WHERE user_id = ? AND game_id = ?')
      .bind(me.id, gameId).first<{ stopId: string; won: number; firstClear: number; xp: number; coins: number }>();
    if (prior) {
      if (prior.stopId !== stop.id) return json({ error: 'gameId already recorded for another stop' }, 409);
      const progress = await storyProgressPayload(db, me.id, track);
      return json({ ok: true, replayed: true, stopId: stop.id, won: !!prior.won, firstClear: !!prior.firstClear, rewards: { xp: prior.xp, coins: prior.coins }, ...progress });
    }

    const facts = await factsFor(db, me.id, track);
    const cleared = new Set<number>();
    for (const s of STORY_STOPS) if ((facts.get(s.id)?.clears ?? 0) > 0) cleared.add(s.n);
    // Sequential unlock, server-side: a locked stop can never be recorded.
    if (storyStopState(stop.n, cleared) === 'locked') return json({ error: 'That stop is locked — clear the route in order.' }, 409);

    const before = facts.get(stop.id) ?? { attempts: 0, clears: 0, firstClearedAt: null };
    const firstClear = won && before.clears === 0;
    const rewards = won ? storyReward(stop.n, firstClear) : { xp: 0, coins: 0 };

    await db.prepare(`INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, first_cleared_at, last_played_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT (user_id, track_key, stop_id) DO UPDATE SET
        attempts = story_progress.attempts + 1,
        clears = story_progress.clears + excluded.clears,
        first_cleared_at = COALESCE(story_progress.first_cleared_at, excluded.first_cleared_at),
        last_played_at = excluded.last_played_at`)
      .bind(me.id, track, stop.id, won ? 1 : 0, firstClear ? now : null, now).run();
    await db.prepare('INSERT INTO story_claims (user_id, game_id, track_key, stop_id, won, first_clear, xp, coins, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(me.id, gameId, track, stop.id, won ? 1 : 0, firstClear ? 1 : 0, rewards.xp, rewards.coins, now).run();

    let completed = false;
    if (firstClear && stop.id === STORY_STOPS[STORY_STOPS.length - 1]!.id) {
      await db.prepare(`INSERT INTO story_tracks (user_id, track_key, completed_at, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, track_key) DO UPDATE SET completed_at = COALESCE(story_tracks.completed_at, excluded.completed_at), updated_at = excluded.updated_at`)
        .bind(me.id, track, now, now).run();
      completed = true;
    } else {
      await db.prepare(`INSERT INTO story_tracks (user_id, track_key, completed_at, updated_at) VALUES (?, ?, NULL, ?)
        ON CONFLICT (user_id, track_key) DO UPDATE SET updated_at = excluded.updated_at`)
        .bind(me.id, track, now).run();
    }

    if (rewards.xp > 0) { try { await awardXp(db, me.id, rewards.xp, now); } catch { /* rewards never break progress */ } }
    if (rewards.coins > 0) { try { await move(db, me.id, rewards.coins, firstClear ? 'story_clear' : 'story_replay', `${track}:${stop.id}`, now); } catch { /* best-effort */ } }

    // Secrets (scene pass): feats + match-event eggs, evaluated from the
    // finished game's honestly-computed facts. Idempotent by primary key —
    // doing the feat twice grants once. Never gates progress.
    const newFinds: { kind: 'egg' | 'feat'; id: string; name: string }[] = [];
    const gameFacts = gameFactsOf(body.facts);
    if (gameFacts) {
      try {
        const secret = STORY_SECRETS[stop.id];
        if (secret && storyFeatMet(stop.id, gameFacts, won)) {
          if (await recordFind(db, me.id, track, 'feat', secret.unlockable.itemId, now)) {
            await grantUnlock(db, me.id, secret.unlockable.itemId, `story-feat:${stop.id}`, now);
            newFinds.push({ kind: 'feat', id: secret.unlockable.itemId, name: secret.unlockable.name });
          }
        }
        if (secret?.egg.trigger.type === 'matchEvent') {
          const events: StoryMatchEvent[] = ['deeNilMade', 'setOnFirstHand', 'ourNilMade', 'oppSetTwice'];
          for (const ev of events) {
            if (storyEggEventMet(stop.id, ev, gameFacts) && await recordFind(db, me.id, track, 'egg', secret.egg.id, now)) {
              newFinds.push({ kind: 'egg', id: secret.egg.id, name: secret.egg.name });
            }
          }
        }
      } catch { /* secrets never break a recorded result */ }
    }

    const progress = await storyProgressPayload(db, me.id, track);
    return json({ ok: true, replayed: false, stopId: stop.id, won, firstClear, rewards, newFinds, ...progress, completed: completed || progress.completed });
  }

  return json({ error: 'not found' }, 404);
}
