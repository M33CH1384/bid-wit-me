/**
 * Story Mode HTTP routes (Phase 1 — solo route):
 *   GET  /api/story/progress?track=solo   → the caller's progress on a track
 *   POST /api/story/session { state: 'open'|'closed', stopId?, track? }
 *        → a story match opened/closed on this device (call-back nudges,
 *          see callback.ts; server-stamped, never a progress write)
 *   POST /api/story/result { track?, stopId, won, gameId }
 *        → record a finished solo stop game: attempt always recorded; a win
 *          clears the stop (server-validated sequential unlock), pays the
 *          first-clear reward once (or the small replay upkeep), and the
 *          King clear stamps the track's completion mark. A loss pays the
 *          small consolation (STORY_LOSS_REWARD — flat 5 XP, no coins),
 *          once per gameId like every reward here.
 *          THE KING'S DOUBLE (doubleOrNothing): a first King win records
 *          the attempt + sets a pending mark (migration 0024) and pays
 *          NOTHING; only a win posted while the mark stands clears — for
 *          double the first-clear reward. A loss while pending voids both
 *          legs. The mark lives on the stop's story_progress row, so the
 *          reset-stop DELETE wipes a live double with the row.
 *   POST /api/story/reset-stop { track?, stopId }
 *        → owner-only dev tool: wipe ONE stop's progress/claims/finds/
 *          session on the caller's own solo track so its next win presents
 *          as a first clear again. No XP/coin clawback (see the branch).
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
  STORY_LOSS_REWARD, STORY_SECRETS, STORY_STOPS, STORY_SOLO_TRACK, storyClearReward, storyCurrentStop, storyEggById, storyEggEventMet,
  storyFeatMet, storyReward, storyStopById, storyStopState, storyTrackKeyValid,
  type StoryGameFacts, type StoryMatchEvent,
} from '@spades/bots';
import { awardXp } from '../cred/xp';
import { move } from '../cred/coins';
import { grantUnlock } from '../cred/achievements';
import { closeStorySession, openStorySession } from './callback';
import { hasStoryAccess } from './access';

export interface StoryEnv extends AuthEnv, SocialEnv {}

/**
 * The story-mode lock switch lives with the access check in ./access
 * (STORY_OWNER_ONLY + STORY_ACCESS_USERNAMES + hasStoryAccess). The
 * switch is re-exported here because this file has been its home.
 */
export { STORY_OWNER_ONLY } from './access';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

interface StopFacts {
  attempts: number; clears: number; firstClearedAt: number | null;
  /** the King's double is live at this stop: he has been beaten once, nothing banked (migration 0024) */
  doublePending: boolean;
  /** JSON StoryGameFacts of the banked first leg — the deciding post merges them into the run's facts */
  doubleLegFacts: string | null;
}

async function factsFor(db: D1Database, userId: string, track: string): Promise<Map<string, StopFacts>> {
  const rows = await db.prepare('SELECT stop_id AS stopId, attempts, clears, first_cleared_at AS firstClearedAt, double_pending AS doublePending, double_leg_facts AS doubleLegFacts FROM story_progress WHERE user_id = ? AND track_key = ?')
    .bind(userId, track).all<{ stopId: string; attempts: number; clears: number; firstClearedAt: number | null; doublePending: number; doubleLegFacts: string | null }>();
  return new Map(rows.results.map((r) => [r.stopId, {
    attempts: r.attempts, clears: r.clears, firstClearedAt: r.firstClearedAt,
    doublePending: !!r.doublePending, doubleLegFacts: r.doubleLegFacts ?? null,
  }]));
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

/** Parse the banked first-leg facts of a live double (stored as JSON by the
 *  leg-1 post; re-clamped through gameFactsOf so a corrupt value fails as null). */
function legFactsOf(raw: string | null): StoryGameFacts | null {
  if (!raw) return null;
  try { return gameFactsOf(JSON.parse(raw)); } catch { return null; }
}

/** The double's run facts = leg 1 + leg 2, field by field: set counts and
 *  scoring accumulate, steady must hold in BOTH legs, one-leg events stick. */
function mergeLegFacts(a: StoryGameFacts, b: StoryGameFacts): StoryGameFacts {
  return {
    margin: a.margin + b.margin,
    handsPlayed: a.handsPlayed + b.handsPlayed,
    setsAgainstUs: a.setsAgainstUs + b.setsAgainstUs,
    setsAgainstThem: a.setsAgainstThem + b.setsAgainstThem,
    ourNilsMade: a.ourNilsMade + b.ourNilsMade,
    ourBlindNilsMade: a.ourBlindNilsMade + b.ourBlindNilsMade,
    deeNilsMade: a.deeNilsMade + b.deeNilsMade,
    deeSteady: a.deeSteady && b.deeSteady,
    setOnFirstHand: a.setOnFirstHand || b.setOnFirstHand,
    oppSetTwice: a.oppSetTwice || b.oppSetTwice,
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
        /** the King's double or nothing is live at this stop (server truth — any device sees it) */
        doublePending: f?.doublePending ?? false,
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
  // Owner-only while story mode is being finished (see ./access):
  // admins and the named player allowlist get in; everyone else 403s.
  // (reset-stop below re-checks isAdmin on its own — the allowlist is
  // a player admit, never an owner tool.)
  if (!hasStoryAccess(env, me.id, me.username)) {
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

  // A story session ping (call-backs, 2026-10-21): the story save is
  // device-local, so the client reports when a story match is open and
  // when it closes (finish / discard / resume-completion). The server
  // stamps its own receive time — the body's savedAt is accepted for
  // debugging and never trusted for the nudge schedule. Sessions drive
  // the character call-back sweep in callback.ts; they are NOT progress
  // writes (no unlock check, no rewards) — the worst a forged ping can
  // do is nudge the caller themselves.
  if (parts[1] === 'story' && parts[2] === 'session' && req.method === 'POST') {
    let body: { state?: unknown; stopId?: unknown; track?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return json({ error: 'Send the session as JSON.' }, 400); }
    const track = typeof body.track === 'string' ? body.track : STORY_SOLO_TRACK;
    if (!storyTrackKeyValid(track) || track !== STORY_SOLO_TRACK) return json({ error: 'bad track' }, 400);
    if (body.state === 'closed') {
      await closeStorySession(db, me.id, track, now);
      return json({ ok: true, state: 'closed' });
    }
    if (body.state !== 'open') return json({ error: 'bad state' }, 400);
    const stop = typeof body.stopId === 'string' ? storyStopById(body.stopId) : undefined;
    if (!stop) return json({ error: 'unknown stop' }, 400);
    await openStorySession(db, me.id, track, stop.id, now);
    return json({ ok: true, state: 'open', stopId: stop.id });
  }

  // Owner-only dev tool (owner, 2026-10-21): reset ONE stop on the caller's
  // own solo track so a win can be re-run end to end and present as a first
  // clear again — the owner cleared the Porch once without ever seeing the
  // win presentation and wants to watch the whole ceremony fire. Wipes the
  // stop's story_progress row (attempts + clears back to zero), its
  // story_claims rows (claims are the per-game idempotency record; with the
  // progress row gone the re-win is classified firstClear from clears === 0
  // and pays the first-clear reward again), its story_finds rows (the
  // stop's egg + feat from STORY_SECRETS, so both can be found/earned — and
  // presented — again), and its story_sessions row when the open session
  // belongs to this stop. Deliberately NOT a clawback: XP and coins
  // already granted stay granted (no negative ledger entries — the
  // re-win re-paying first-clear is intended test behavior), the Rep
  // `unlocks` row a feat granted stays on the profile, and every other
  // stop, track and user is untouched. Admin-only in its own right: even
  // if STORY_OWNER_ONLY is ever flipped off, this stays an owner tool
  // (the client renders the control only for dev accounts), and the
  // STORY_ACCESS_USERNAMES player allowlist never admits anyone here.
  if (parts[1] === 'story' && parts[2] === 'reset-stop' && req.method === 'POST') {
    if (!isAdmin(env, me.id, me.username)) return json({ error: 'Stop reset is an owner tool.' }, 403);
    let body: { track?: unknown; stopId?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return json({ error: 'Send the reset as JSON.' }, 400); }
    const track = typeof body.track === 'string' ? body.track : STORY_SOLO_TRACK;
    if (!storyTrackKeyValid(track) || track !== STORY_SOLO_TRACK) return json({ error: 'bad track' }, 400);
    const stop = typeof body.stopId === 'string' ? storyStopById(body.stopId) : undefined;
    if (!stop) return json({ error: 'unknown stop' }, 400);
    const secret = STORY_SECRETS[stop.id];
    const wiped: Record<string, number> = {};
    const rp = await db.prepare('DELETE FROM story_progress WHERE user_id = ? AND track_key = ? AND stop_id = ?')
      .bind(me.id, track, stop.id).run();
    wiped.progress = rp.meta?.changes ?? 0;
    const rc = await db.prepare('DELETE FROM story_claims WHERE user_id = ? AND track_key = ? AND stop_id = ?')
      .bind(me.id, track, stop.id).run();
    wiped.claims = rc.meta?.changes ?? 0;
    if (secret) {
      const rf = await db.prepare("DELETE FROM story_finds WHERE user_id = ? AND track_key = ? AND ((kind = 'egg' AND find_id = ?) OR (kind = 'feat' AND find_id = ?))")
        .bind(me.id, track, secret.egg.id, secret.unlockable.itemId).run();
      wiped.finds = rf.meta?.changes ?? 0;
    }
    const rs = await db.prepare('DELETE FROM story_sessions WHERE user_id = ? AND track_key = ? AND stop_id = ?')
      .bind(me.id, track, stop.id).run();
    wiped.sessions = rs.meta?.changes ?? 0;
    // The track completion mark is the final stop's own fact: resetting the
    // King un-completes the track. Resetting any other stop leaves a mark
    // the King's clear genuinely earned standing.
    let completionCleared = false;
    if (stop.id === STORY_STOPS[STORY_STOPS.length - 1]!.id) {
      const rt = await db.prepare('UPDATE story_tracks SET completed_at = NULL, updated_at = ? WHERE user_id = ? AND track_key = ? AND completed_at IS NOT NULL')
        .bind(now, me.id, track).run();
      completionCleared = (rt.meta?.changes ?? 0) > 0;
    }
    const progress = await storyProgressPayload(db, me.id, track);
    return json({ ok: true, stopId: stop.id, wiped, completionCleared, ...progress });
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
      // The game this session was about already finished — no call-backs owed.
      try { await closeStorySession(db, me.id, track, now); } catch { /* sessions never break results */ }
      const progress = await storyProgressPayload(db, me.id, track);
      return json({ ok: true, replayed: true, stopId: stop.id, won: !!prior.won, firstClear: !!prior.firstClear, rewards: { xp: prior.xp, coins: prior.coins }, doubleOutcome: null, doublePending: progress.stops.find((s) => s.stopId === stop.id)?.doublePending ?? false, ...progress });
    }

    const facts = await factsFor(db, me.id, track);
    const cleared = new Set<number>();
    for (const s of STORY_STOPS) if ((facts.get(s.id)?.clears ?? 0) > 0) cleared.add(s.n);
    // Sequential unlock, server-side: a locked stop can never be recorded.
    if (storyStopState(stop.n, cleared) === 'locked') return json({ error: 'That stop is locked — clear the route in order.' }, 409);

    const before = facts.get(stop.id) ?? { attempts: 0, clears: 0, firstClearedAt: null, doublePending: false, doubleLegFacts: null };
    const gameFacts = gameFactsOf(body.facts);
    let firstClear = won && before.clears === 0;
    // A finished loss pays the small consolation (STORY_LOSS_REWARD:
    // 5 XP, no coins) — recorded on the claim like any reward, so a
    // repost returns it without paying twice. The King's double below
    // overrides rewards only on its win branches; a leg loss keeps it.
    let rewards = won ? storyReward(stop.n, firstClear) : { ...STORY_LOSS_REWARD };
    // THE KING'S DOUBLE OR NOTHING — first-clear gate only: once the crown
    // is taken (clears > 0) every King game is an ordinary single match.
    //   win, no mark  → 'started': attempt recorded, mark set, leg facts
    //     banked; NO clear, NO rewards.
    //   win, mark set → 'cleared': the clear posts for DOUBLE the
    //     first-clear reward; the mark is consumed.
    //   loss, mark set → 'lost': both legs void — no clear and no clear
    //     rewards (the leg-1 win banked nothing to lose); the loss itself
    //     posts the standard loss consolation like any story loss, the
    //     mark clears, the stop stays current. Attempts still count:
    //     attempts count finished matches, and both legs finished.
    // A King clear post is honored ONLY while the mark stands server-side —
    // there is no client path around the second win.
    const inDouble = stop.doubleOrNothing === true && before.clears === 0;
    let doubleOutcome: 'started' | 'cleared' | 'lost' | null = null;
    if (inDouble) {
      if (won && !before.doublePending) {
        doubleOutcome = 'started';
        firstClear = false;
        rewards = { xp: 0, coins: 0 };
      } else if (won && before.doublePending) {
        doubleOutcome = 'cleared';
        firstClear = true;
        rewards = storyClearReward(stop);
      } else if (!won && before.doublePending) {
        doubleOutcome = 'lost';
      }
    }
    // A leg-1 win is a win the player earned and a clear they have NOT:
    // the claims row records won=1 with first_clear=0 and zero rewards.
    const countsAsClear = won && doubleOutcome !== 'started';

    await db.prepare(`INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, first_cleared_at, last_played_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT (user_id, track_key, stop_id) DO UPDATE SET
        attempts = story_progress.attempts + 1,
        clears = story_progress.clears + excluded.clears,
        first_cleared_at = COALESCE(story_progress.first_cleared_at, excluded.first_cleared_at),
        last_played_at = excluded.last_played_at`)
      .bind(me.id, track, stop.id, countsAsClear ? 1 : 0, firstClear ? now : null, now).run();
    await db.prepare('INSERT INTO story_claims (user_id, game_id, track_key, stop_id, won, first_clear, xp, coins, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(me.id, gameId, track, stop.id, won ? 1 : 0, firstClear ? 1 : 0, rewards.xp, rewards.coins, now).run();

    // Pending-mark transitions (the mark lives on the progress row the
    // upsert just wrote, so a stop reset deleting that row wipes it too).
    if (doubleOutcome === 'started') {
      await db.prepare('UPDATE story_progress SET double_pending = 1, double_leg_facts = ? WHERE user_id = ? AND track_key = ? AND stop_id = ?')
        .bind(gameFacts ? JSON.stringify(gameFacts) : null, me.id, track, stop.id).run();
    } else if (doubleOutcome === 'cleared' || doubleOutcome === 'lost') {
      await db.prepare('UPDATE story_progress SET double_pending = 0, double_leg_facts = NULL WHERE user_id = ? AND track_key = ? AND stop_id = ?')
        .bind(me.id, track, stop.id).run();
    }

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
    if (gameFacts) {
      try {
        const secret = STORY_SECRETS[stop.id];
        // An unresolved first leg earns NOTHING yet — no feat, no egg: the
        // run is not a clear, so nothing that hangs off a clear may fire.
        // The deciding post evaluates the feat on the MERGED run facts
        // (banked leg 1 + this leg), never on the last leg alone — and
        // fails closed: a deciding post whose banked leg facts are missing
        // grants no feat rather than judging half a run.
        if (secret && doubleOutcome !== 'started') {
          let featFacts: StoryGameFacts | null = gameFacts;
          if (doubleOutcome === 'cleared') {
            const leg = legFactsOf(before.doubleLegFacts);
            featFacts = leg ? mergeLegFacts(leg, gameFacts) : null;
          }
          if (featFacts && storyFeatMet(stop.id, featFacts, won)) {
            if (await recordFind(db, me.id, track, 'feat', secret.unlockable.itemId, now)) {
              await grantUnlock(db, me.id, secret.unlockable.itemId, `story-feat:${stop.id}`, now);
              newFinds.push({ kind: 'feat', id: secret.unlockable.itemId, name: secret.unlockable.name });
            }
          }
        }
        if (secret?.egg.trigger.type === 'matchEvent' && doubleOutcome !== 'started') {
          const events: StoryMatchEvent[] = ['deeNilMade', 'setOnFirstHand', 'ourNilMade', 'oppSetTwice'];
          for (const ev of events) {
            if (storyEggEventMet(stop.id, ev, gameFacts) && await recordFind(db, me.id, track, 'egg', secret.egg.id, now)) {
              newFinds.push({ kind: 'egg', id: secret.egg.id, name: secret.egg.name });
            }
          }
        }
      } catch { /* secrets never break a recorded result */ }
    }

    // A recorded finish closes the open session: the table stops calling.
    try { await closeStorySession(db, me.id, track, now); } catch { /* sessions never break results */ }

    const progress = await storyProgressPayload(db, me.id, track);
    return json({
      ok: true, replayed: false, stopId: stop.id, won, firstClear, rewards, newFinds, ...progress,
      completed: completed || progress.completed,
      /** the King's double, when this post moved it: 'started' | 'cleared' | 'lost' (null elsewhere) */
      doubleOutcome,
      doublePending: progress.stops.find((s) => s.stopId === stop.id)?.doublePending ?? false,
    });
  }

  return json({ error: 'not found' }, 404);
}

