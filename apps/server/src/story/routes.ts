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
  STORY_LOSS_REWARD, STORY_SECRETS, STORY_STOPS, STORY_SOLO_TRACK, awarenessCaseFor, storyClearReward, storyCurrentStop, storyEggById, storyEggEventMet,
  storyFeatMet, storyPairTrackKey, storyPairUids, storyReward, storyStopById, storyStopState, storyTrackKeyValid,
  type AwarenessCase, type StoryGameFacts, type StoryMatchEvent, type StoryStop,
} from '@spades/bots';
import { CODE_ALPHABET, CODE_LENGTH, isRoomCode, normalizeRoomCode } from '@spades/protocol';
import { awardXp } from '../cred/xp';
import { move } from '../cred/coins';
import { grantUnlock } from '../cred/achievements';
import { closeStorySession, openStorySession } from './callback';
import { hasStoryAccess } from './access';

/** The slice of the TABLES Durable Object namespace the story routes use
 *  (room creation, share-code bind, pair-context member resolution). */
export interface StoryTableNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(url: string, init?: RequestInit): Promise<Response> };
}

export interface StoryEnv extends AuthEnv, SocialEnv {
  TABLES?: StoryTableNamespace;
}

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

/**
 * The UNION summary across ALL the caller's tracks (Phase 4, spec §3.9):
 * per-stop attempts/clears summed over the solo run and every pair track
 * the caller belongs to, finds unioned, completed if ANY track completed.
 * User_id-only, like personalHistoryMapFor — a player's rows exist solely
 * under their own id. The profile's story badges read this ('cleared
 * anywhere' earns); the per-track payload above it stays exact.
 */
async function anyTrackSummaryFor(db: D1Database, userId: string) {
  const rows = await db.prepare('SELECT stop_id AS stopId, COALESCE(SUM(attempts), 0) AS attempts, COALESCE(SUM(clears), 0) AS clears FROM story_progress WHERE user_id = ? GROUP BY stop_id')
    .bind(userId).all<{ stopId: string; attempts: number; clears: number }>();
  const byStop = new Map(rows.results.map((r) => [r.stopId, r]));
  const findRows = await db.prepare('SELECT DISTINCT kind, find_id AS findId FROM story_finds WHERE user_id = ?')
    .bind(userId).all<{ kind: string; findId: string }>();
  const done = await db.prepare('SELECT COUNT(*) AS n FROM story_tracks WHERE user_id = ? AND completed_at IS NOT NULL')
    .bind(userId).first<{ n: number }>();
  return {
    stops: STORY_STOPS.map((s) => ({
      stopId: s.id,
      attempts: byStop.get(s.id)?.attempts ?? 0,
      clears: byStop.get(s.id)?.clears ?? 0,
    })),
    finds: {
      eggs: findRows.results.filter((r) => r.kind === 'egg').map((r) => r.findId),
      feats: findRows.results.filter((r) => r.kind === 'feat').map((r) => r.findId),
    },
    completed: (done?.n ?? 0) > 0,
  };
}

export async function storyProgressPayload(db: D1Database, userId: string, track: string) {
  const facts = await factsFor(db, userId, track);
  const cleared = new Set<number>();
  for (const s of STORY_STOPS) if ((facts.get(s.id)?.clears ?? 0) > 0) cleared.add(s.n);
  const trackRow = await db.prepare('SELECT completed_at AS completedAt FROM story_tracks WHERE user_id = ? AND track_key = ?')
    .bind(userId, track).first<{ completedAt: number | null }>();
  const finds = await findsFor(db, userId, track);
  const anyTrack = await anyTrackSummaryFor(db, userId);
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
    /** the completion mark (Phase 3 displays it on profiles; the fact is stored now):
     *  solo runs earn 'story-solo-complete'; a pair track earns its own mark,
     *  'story-pair-complete', when the pair's King clear posts (spec §3.8) */
    completionMark: trackRow?.completedAt != null
      ? (track === STORY_SOLO_TRACK ? 'story-solo-complete' : 'story-pair-complete')
      : null,
    /** the union across all the caller's tracks (Phase 4, §3.9) — the
     *  profile's story badges read it; per-track surfaces ignore it */
    anyTrack,
  };
}

/** The cleared stop numbers on a track, from one player's stored copy. */
async function clearedSetFor(db: D1Database, userId: string, track: string): Promise<Set<number>> {
  const facts = await factsFor(db, userId, track);
  const cleared = new Set<number>();
  for (const s of STORY_STOPS) if ((facts.get(s.id)?.clears ?? 0) > 0) cleared.add(s.n);
  return cleared;
}

/** Is this stop reachable on this track (sequential unlock, read from the caller's copy)? */
async function stopUnlockedFor(db: D1Database, userId: string, track: string, stop: StoryStop): Promise<boolean> {
  return storyStopState(stop.n, await clearedSetFor(db, userId, track)) !== 'locked';
}

/**
 * A player's PERSONAL history at a stop (spec §7.1): their record across ALL
 * their tracks — solo plus every pair track they belong to. The query is by
 * user_id only: a player's pair rows exist solely under their own user_id, so
 * no other player's tracks can ever surface here. Drives the awareness layer
 * (§7) via the pair-context endpoint — booleans and a count, nothing more.
 */
export async function personalHistoryFor(db: D1Database, userId: string, stopId: string): Promise<{ knowsStop: boolean; clearedStop: boolean; clearedStops: number }> {
  const row = await db.prepare('SELECT COALESCE(SUM(attempts), 0) AS attempts, COALESCE(SUM(clears), 0) AS clears FROM story_progress WHERE user_id = ? AND stop_id = ?')
    .bind(userId, stopId).first<{ attempts: number; clears: number }>();
  const cnt = await db.prepare('SELECT COUNT(DISTINCT stop_id) AS n FROM story_progress WHERE user_id = ? AND clears > 0')
    .bind(userId).first<{ n: number }>();
  return {
    knowsStop: (row?.attempts ?? 0) > 0,
    clearedStop: (row?.clears ?? 0) > 0,
    clearedStops: cnt?.n ?? 0,
  };
}

/** A player's personal history at EVERY stop in two queries (the
 *  all-stops sibling of personalHistoryFor, same user_id-only rule). */
async function personalHistoryMapFor(db: D1Database, userId: string): Promise<Map<string, { knowsStop: boolean; clearedStop: boolean }>> {
  const rows = await db.prepare('SELECT stop_id AS stopId, COALESCE(SUM(attempts), 0) AS attempts, COALESCE(SUM(clears), 0) AS clears FROM story_progress WHERE user_id = ? GROUP BY stop_id')
    .bind(userId).all<{ stopId: string; attempts: number; clears: number }>();
  return new Map(rows.results.map((r) => [r.stopId, { knowsStop: r.attempts > 0, clearedStop: r.clears > 0 }]));
}

/**
 * The awareness case at every stop for a pair (spec §7.2), computed
 * where D1 lives and handed to the story room at creation / partner
 * bind: the room's guide layer needs the case for Dee's once-per-match
 * awareness callback, and the room has no database. Inputs are exactly
 * the pair-context facts — pair attempts/clears/doublePending from the
 * pair track (either member's identical copy) plus each player's
 * personal booleans. Handles play no part in case selection.
 */
export async function awarenessCasesFor(db: D1Database, uidA: string, uidB: string, track: string): Promise<Record<string, AwarenessCase>> {
  const [pairFacts, ha, hb] = await Promise.all([factsFor(db, uidA, track), personalHistoryMapFor(db, uidA), personalHistoryMapFor(db, uidB)]);
  const blank = { knowsStop: false, clearedStop: false };
  const player = (h: Map<string, { knowsStop: boolean; clearedStop: boolean }>, stopId: string) => ({
    handle: '', clearedStops: 0, ...(h.get(stopId) ?? blank),
  });
  const out: Record<string, AwarenessCase> = {};
  for (const stop of STORY_STOPS) {
    const pf = pairFacts.get(stop.id);
    out[stop.id] = awarenessCaseFor(stop.id, {
      players: [player(ha, stop.id), player(hb, stop.id)],
      pair: { attempts: pf?.attempts ?? 0, clears: pf?.clears ?? 0, doublePending: pf?.doublePending ?? false },
    });
  }
  return out;
}

/** A fresh table code, the same alphabet/length as /api/tables. */
function randomStoryCode(): string {
  const b = new Uint8Array(CODE_LENGTH * 2);
  crypto.getRandomValues(b);
  let out = '';
  for (const x of b) {
    if (x >= 248) continue; // rejection sampling, no modulo bias (as index.ts)
    out += CODE_ALPHABET[x % CODE_ALPHABET.length];
    if (out.length === CODE_LENGTH) return out;
  }
  return randomStoryCode();
}

/**
 * The shipped result pipeline, verbatim, parameterized by the account being
 * credited: idempotency (story_claims), sequential unlock, rewards, the
 * King's double state machine, finds, completion mark, session close.
 * Solo posts run it once for the caller. Pair posts run it for BOTH pair
 * members with the room-witnessed won/facts (the two-copies rule, §3.6), so
 * the pair's two stored copies can never diverge and both players are
 * credited identically, exactly once each.
 */
/** The finale outcomes a pair-track King witness can carry (Phase 4,
 *  spec §6.2; migration 0029). Solo posts never carry one. */
export type StoryFinaleOutcome = 'double' | 'clear' | 'lost' | 'declined';

async function recordStoryResult(
  db: D1Database, userId: string, track: string, stop: StoryStop,
  won: boolean, gameId: string, rawFacts: unknown, now: number,
  opts?: { finaleOutcome?: StoryFinaleOutcome | null },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const finaleOutcome = opts?.finaleOutcome ?? null;
  // Idempotency: one finished game = one recorded result, ever.
  const prior = await db.prepare('SELECT stop_id AS stopId, won, first_clear AS firstClear, xp, coins FROM story_claims WHERE user_id = ? AND game_id = ?')
    .bind(userId, gameId).first<{ stopId: string; won: number; firstClear: number; xp: number; coins: number }>();
  if (prior) {
    if (prior.stopId !== stop.id) return { status: 409, body: { error: 'gameId already recorded for another stop' } };
    // The game this session was about already finished — no call-backs owed.
    try { await closeStorySession(db, userId, track, now); } catch { /* sessions never break results */ }
    const progress = await storyProgressPayload(db, userId, track);
    return { status: 200, body: { ok: true, replayed: true, stopId: stop.id, won: !!prior.won, firstClear: !!prior.firstClear, rewards: { xp: prior.xp, coins: prior.coins }, doubleOutcome: null, finale: null, doublePending: progress.stops.find((s) => s.stopId === stop.id)?.doublePending ?? false, ...progress } };
  }

  const facts = await factsFor(db, userId, track);
  const cleared = new Set<number>();
  for (const s of STORY_STOPS) if ((facts.get(s.id)?.clears ?? 0) > 0) cleared.add(s.n);
  // Sequential unlock, server-side: a locked stop can never be recorded.
  if (storyStopState(stop.n, cleared) === 'locked') return { status: 409, body: { error: 'That stop is locked — clear the route in order.' } };

  const before = facts.get(stop.id) ?? { attempts: 0, clears: 0, firstClearedAt: null, doublePending: false, doubleLegFacts: null };
  const gameFacts = gameFactsOf(rawFacts);
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
  // THE FINALE (Phase 4, pair tracks only): while a pair's double mark
  // stands, the mark is settled ONLY by a finale witness — a plain
  // partnership leg-2 post no longer resolves it (fail closed), and a
  // finale outcome is honored only while the mark stands server-side.
  // Solo never reaches either guard (its posts carry no finale outcome
  // and the solo track is excluded), so the solo machine below is
  // byte-identical to the shipped one.
  if (track !== STORY_SOLO_TRACK && stop.doubleOrNothing === true) {
    if (finaleOutcome && !before.doublePending) {
      return { status: 409, body: { error: 'No double is standing for that finale.' } };
    }
    if (!finaleOutcome && before.doublePending) {
      return { status: 409, body: { error: 'That double is settled at the King’s finale.' } };
    }
  }
  let doubleOutcome: 'started' | 'cleared' | 'lost' | null = null;
  if (inDouble) {
    if (finaleOutcome === 'double') {
      // A human won the cutthroat outright: the double pays EACH member
      // at the clear rate — even if the other human finished last.
      doubleOutcome = 'cleared';
      firstClear = true;
      rewards = storyClearReward(stop);
    } else if (finaleOutcome === 'clear' || finaleOutcome === 'declined') {
      // The King/Ringer took the cutthroat with a human 2nd — or the pair
      // banked leg 1 without playing it: the normal King clear posts.
      doubleOutcome = 'cleared';
      firstClear = true;
      rewards = storyReward(stop.n, true);
    } else if (finaleOutcome === 'lost') {
      // Both humans 3rd/4th (or a finale concede): the clear is lost
      // entirely; the witness's won=false already set the consolation.
      doubleOutcome = 'lost';
    } else if (won && !before.doublePending) {
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
  // A decline plays no game: the banked clear posts WITHOUT counting a
  // further attempt (leg 1's attempt already stands — spec §6.2).
  const countAttempt = finaleOutcome !== 'declined';

  await db.prepare(`INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, first_cleared_at, last_played_at)
    VALUES (?, ?, ?, ${countAttempt ? 1 : 0}, ?, ?, ?)
    ON CONFLICT (user_id, track_key, stop_id) DO UPDATE SET
      attempts = story_progress.attempts + ${countAttempt ? 1 : 0},
      clears = story_progress.clears + excluded.clears,
      first_cleared_at = COALESCE(story_progress.first_cleared_at, excluded.first_cleared_at),
      last_played_at = excluded.last_played_at`)
    .bind(userId, track, stop.id, countsAsClear ? 1 : 0, firstClear ? now : null, now).run();
  await db.prepare('INSERT INTO story_claims (user_id, game_id, track_key, stop_id, won, first_clear, xp, coins, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(userId, gameId, track, stop.id, won ? 1 : 0, firstClear ? 1 : 0, rewards.xp, rewards.coins, now).run();

  // Pending-mark transitions (the mark lives on the progress row the
  // upsert just wrote, so a stop reset deleting that row wipes it too).
  if (doubleOutcome === 'started') {
    await db.prepare('UPDATE story_progress SET double_pending = 1, double_leg_facts = ? WHERE user_id = ? AND track_key = ? AND stop_id = ?')
      .bind(gameFacts ? JSON.stringify(gameFacts) : null, userId, track, stop.id).run();
  } else if (doubleOutcome === 'cleared' || doubleOutcome === 'lost') {
    await db.prepare('UPDATE story_progress SET double_pending = 0, double_leg_facts = NULL WHERE user_id = ? AND track_key = ? AND stop_id = ?')
      .bind(userId, track, stop.id).run();
  }

  let completed = false;
  if (firstClear && stop.id === STORY_STOPS[STORY_STOPS.length - 1]!.id) {
    await db.prepare(`INSERT INTO story_tracks (user_id, track_key, completed_at, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, track_key) DO UPDATE SET completed_at = COALESCE(story_tracks.completed_at, excluded.completed_at), updated_at = excluded.updated_at`)
      .bind(userId, track, now, now).run();
    completed = true;
  } else {
    await db.prepare(`INSERT INTO story_tracks (user_id, track_key, completed_at, updated_at) VALUES (?, ?, NULL, ?)
      ON CONFLICT (user_id, track_key) DO UPDATE SET updated_at = excluded.updated_at`)
      .bind(userId, track, now).run();
  }

  if (rewards.xp > 0) { try { await awardXp(db, userId, rewards.xp, now); } catch { /* rewards never break progress */ } }
  if (rewards.coins > 0) { try { await move(db, userId, rewards.coins, firstClear ? 'story_clear' : 'story_replay', `${track}:${stop.id}`, now); } catch { /* best-effort */ } }

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
          // A decline banks leg 1 itself: the feat judges the banked leg
          // facts alone (the witness's facts ARE leg 1's in the same-room
          // case — merging would double-count the run).
          featFacts = finaleOutcome === 'declined' ? leg : (leg ? mergeLegFacts(leg, gameFacts) : null);
        }
        if (featFacts && storyFeatMet(stop.id, featFacts, won)) {
          if (await recordFind(db, userId, track, 'feat', secret.unlockable.itemId, now)) {
            await grantUnlock(db, userId, secret.unlockable.itemId, `story-feat:${stop.id}`, now);
            newFinds.push({ kind: 'feat', id: secret.unlockable.itemId, name: secret.unlockable.name });
          }
        }
      }
      if (secret?.egg.trigger.type === 'matchEvent' && doubleOutcome !== 'started') {
        // Match-event eggs judge the deciding game — for a decline, the
        // banked leg (its facts are the run's deciding facts).
        const eggFacts = finaleOutcome === 'declined' ? legFactsOf(before.doubleLegFacts) : gameFacts;
        const events: StoryMatchEvent[] = ['deeNilMade', 'setOnFirstHand', 'ourNilMade', 'oppSetTwice'];
        for (const ev of events) {
          if (eggFacts && storyEggEventMet(stop.id, ev, eggFacts) && await recordFind(db, userId, track, 'egg', secret.egg.id, now)) {
            newFinds.push({ kind: 'egg', id: secret.egg.id, name: secret.egg.name });
          }
        }
      }
    } catch { /* secrets never break a recorded result */ }
  }

  // A recorded finish closes the open session: the table stops calling.
  try { await closeStorySession(db, userId, track, now); } catch { /* sessions never break results */ }

  const progress = await storyProgressPayload(db, userId, track);
  return { status: 200, body: {
    ok: true, replayed: false, stopId: stop.id, won, firstClear, rewards, newFinds, ...progress,
    completed: completed || progress.completed,
    /** the King's double, when this post moved it: 'started' | 'cleared' | 'lost' (null elsewhere) */
    doubleOutcome,
    /** the finale outcome this post resolved, on a pair track (Phase 4) — null elsewhere */
    finale: finaleOutcome,
    doublePending: progress.stops.find((s) => s.stopId === stop.id)?.doublePending ?? false,
  } };
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

  // Pair-track membership: a pair track belongs to exactly the two accounts
  // its key names. Any story surface keyed by a pair track 403s everyone else.
  const isPairMember = (track: string): boolean => {
    const pair = storyPairUids(track);
    return !!pair && pair.includes(me.id);
  };
  const trackAllowed = (track: string): boolean =>
    storyTrackKeyValid(track) && (track === STORY_SOLO_TRACK || isPairMember(track));

  if (parts[1] === 'story' && parts[2] === 'progress' && req.method === 'GET') {
    const track = url.searchParams.get('track') ?? STORY_SOLO_TRACK;
    if (!storyTrackKeyValid(track)) return json({ error: 'bad track' }, 400);
    if (track !== STORY_SOLO_TRACK && !isPairMember(track)) return json({ error: 'That run belongs to another pair.' }, 403);
    return json(await storyProgressPayload(db, me.id, track));
  }

  // A scene-side Easter egg was found (sceneTap / deeTap / chain). Match-event
  // eggs are NOT accepted here — they are granted from result facts only.
  if (parts[1] === 'story' && parts[2] === 'found' && req.method === 'POST') {
    let body: { track?: unknown; eggId?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return json({ error: 'Send the find as JSON.' }, 400); }
    const track = typeof body.track === 'string' ? body.track : STORY_SOLO_TRACK;
    if (!trackAllowed(track)) return json({ error: 'bad track' }, 400);
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
    if (!trackAllowed(track)) return json({ error: 'bad track' }, 400);
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
    if (!trackAllowed(track)) return json({ error: 'bad track' }, 400);
    const stop = typeof body.stopId === 'string' ? storyStopById(body.stopId) : undefined;
    if (!stop) return json({ error: 'unknown stop' }, 400);
    const secret = STORY_SECRETS[stop.id];
    // Pair tracks live twice (once per member — §3.6): a reset wipes BOTH
    // copies, or the pair's two views of the run would diverge.
    const targets = track === STORY_SOLO_TRACK ? [me.id] : storyPairUids(track)!;
    const wiped: Record<string, number> = {};
    const sum = (k: string, n: number) => { wiped[k] = (wiped[k] ?? 0) + n; };
    for (const uid of targets) {
      const rp = await db.prepare('DELETE FROM story_progress WHERE user_id = ? AND track_key = ? AND stop_id = ?')
        .bind(uid, track, stop.id).run();
      sum('progress', rp.meta?.changes ?? 0);
      const rc = await db.prepare('DELETE FROM story_claims WHERE user_id = ? AND track_key = ? AND stop_id = ?')
        .bind(uid, track, stop.id).run();
      sum('claims', rc.meta?.changes ?? 0);
      if (secret) {
        const rf = await db.prepare("DELETE FROM story_finds WHERE user_id = ? AND track_key = ? AND ((kind = 'egg' AND find_id = ?) OR (kind = 'feat' AND find_id = ?))")
          .bind(uid, track, secret.egg.id, secret.unlockable.itemId).run();
        sum('finds', rf.meta?.changes ?? 0);
      }
      const rs = await db.prepare('DELETE FROM story_sessions WHERE user_id = ? AND track_key = ? AND stop_id = ?')
        .bind(uid, track, stop.id).run();
      sum('sessions', rs.meta?.changes ?? 0);
    }
    // The track completion mark is the final stop's own fact: resetting the
    // King un-completes the track. Resetting any other stop leaves a mark
    // the King's clear genuinely earned standing.
    let completionCleared = false;
    if (stop.id === STORY_STOPS[STORY_STOPS.length - 1]!.id) {
      for (const uid of targets) {
        const rt = await db.prepare('UPDATE story_tracks SET completed_at = NULL, updated_at = ? WHERE user_id = ? AND track_key = ? AND completed_at IS NOT NULL')
          .bind(now, uid, track).run();
        completionCleared = completionCleared || (rt.meta?.changes ?? 0) > 0;
      }
    }
    const progress = await storyProgressPayload(db, me.id, track);
    return json({ ok: true, stopId: stop.id, wiped, completionCleared, ...progress });
  }

  if (parts[1] === 'story' && parts[2] === 'result' && req.method === 'POST') {
    let body: { track?: unknown; stopId?: unknown; won?: unknown; gameId?: unknown; facts?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return json({ error: 'Send the result as JSON.' }, 400); }
    const track = typeof body.track === 'string' ? body.track : STORY_SOLO_TRACK;
    if (!storyTrackKeyValid(track)) return json({ error: 'bad track' }, 400);
    const stop = typeof body.stopId === 'string' ? storyStopById(body.stopId) : undefined;
    if (!stop) return json({ error: 'unknown stop' }, 400);
    const gameId = typeof body.gameId === 'string' ? body.gameId.slice(0, 80) : '';
    if (!gameId) return json({ error: 'gameId required' }, 400);

    if (track === STORY_SOLO_TRACK) {
      // Solo: the game is played locally against bots, so the client's own
      // report is the record (the shipped trust level) — unchanged.
      const out = await recordStoryResult(db, me.id, track, stop, body.won === true, gameId, body.facts, now);
      return json(out.body, out.status);
    }

    // Pair track (spec §3.3): the room witnessed this game — won and facts
    // come FROM the witness row, never from the request body.
    const pair = storyPairUids(track);
    if (!pair || !pair.includes(me.id)) return json({ error: 'That run belongs to another pair.' }, 403);
    const witness = await db.prepare(`SELECT track_key AS trackKey, stop_id AS stopId, uid_a AS uidA, uid_b AS uidB, won, facts_json AS factsJson, finale_outcome AS finaleOutcome
      FROM story_room_results WHERE game_id = ?`).bind(gameId)
      .first<{ trackKey: string; stopId: string; uidA: string; uidB: string; won: number; factsJson: string | null; finaleOutcome: string | null }>();
    const named = witness ? [witness.uidA, witness.uidB] : [];
    if (!witness || witness.trackKey !== track || witness.stopId !== stop.id
      || !pair.every((u) => named.includes(u)) || !named.includes(me.id)) {
      return json({ error: 'No witnessed result for that game.' }, 409);
    }
    let witnessedFacts: unknown = null;
    if (witness.factsJson) { try { witnessedFacts = JSON.parse(witness.factsJson); } catch { witnessedFacts = null; } }
    // The finale outcome rides the witness row too (migration 0029) —
    // validated here, mapped onto the double machine in recordStoryResult.
    const finaleOutcome = witness.finaleOutcome === 'double' || witness.finaleOutcome === 'clear'
      || witness.finaleOutcome === 'lost' || witness.finaleOutcome === 'declined'
      ? witness.finaleOutcome : null;
    // A finale outcome is authoritative for the win bit too ('lost' is
    // the only losing one) — the two can never disagree in crediting.
    const witnessedWon = finaleOutcome ? finaleOutcome !== 'lost' : !!witness.won;
    const out = await recordStoryResult(db, me.id, track, stop, witnessedWon, gameId, witnessedFacts, now, { finaleOutcome });
    if (out.status !== 200) return json(out.body, out.status);
    // Equal credit: the partner's copy receives the identical mutation in
    // this same request (§3.6). Their outcome is their own claim row — a
    // later post of theirs returns it as a replay, never a second credit.
    const other = pair.find((u) => u !== me.id)!;
    await recordStoryResult(db, other, track, stop, witnessedWon, gameId, witnessedFacts, now, { finaleOutcome }).catch(() => null);
    return json(out.body, out.status);
  }

  // The caller's runs (partner step, §1.2): the solo summary + one row per
  // pair track — partner handle, the pair's current stop, last played. Reads
  // only the caller's own rows; a pair track appears here only because the
  // caller is one of its two members by construction.
  if (parts[1] === 'story' && parts[2] === 'tracks' && req.method === 'GET') {
    const soloFacts = await factsFor(db, me.id, STORY_SOLO_TRACK);
    const soloCleared = new Set<number>();
    for (const s of STORY_STOPS) if ((soloFacts.get(s.id)?.clears ?? 0) > 0) soloCleared.add(s.n);
    const soloTrackRow = await db.prepare('SELECT completed_at AS completedAt FROM story_tracks WHERE user_id = ? AND track_key = ?')
      .bind(me.id, STORY_SOLO_TRACK).first<{ completedAt: number | null }>();
    const pairRows = await db.prepare('SELECT track_key AS trackKey FROM story_tracks WHERE user_id = ? AND track_key != ?')
      .bind(me.id, STORY_SOLO_TRACK).all<{ trackKey: string }>();
    const pairs: { track: string; partnerUid: string; partnerHandle: string | null; currentStop: number | null; completed: boolean; lastPlayedAt: number | null }[] = [];
    for (const row of pairRows.results) {
      const uids = storyPairUids(row.trackKey);
      if (!uids) continue;
      const partnerUid = uids.find((u) => u !== me.id);
      if (!partnerUid) continue;
      const prow = await db.prepare('SELECT username FROM users WHERE id = ?').bind(partnerUid).first<{ username: string }>();
      const facts = await factsFor(db, me.id, row.trackKey);
      const cleared = new Set<number>();
      let lastPlayedAt: number | null = null;
      for (const s of STORY_STOPS) {
        const f = facts.get(s.id);
        if ((f?.clears ?? 0) > 0) cleared.add(s.n);
      }
      const lp = await db.prepare('SELECT MAX(last_played_at) AS lp FROM story_progress WHERE user_id = ? AND track_key = ?')
        .bind(me.id, row.trackKey).first<{ lp: number | null }>();
      lastPlayedAt = lp?.lp ?? null;
      const trow = await db.prepare('SELECT completed_at AS completedAt FROM story_tracks WHERE user_id = ? AND track_key = ?')
        .bind(me.id, row.trackKey).first<{ completedAt: number | null }>();
      pairs.push({
        track: row.trackKey, partnerUid, partnerHandle: prow?.username ?? null,
        currentStop: storyCurrentStop(cleared), completed: trow?.completedAt != null, lastPlayedAt,
      });
    }
    return json({
      solo: { track: STORY_SOLO_TRACK, currentStop: storyCurrentStop(soloCleared), completed: soloTrackRow?.completedAt != null },
      pairs,
    });
  }

  // Awareness facts for a sit-down (spec §7.3): the caller names the room
  // code; the room's own member list (from its Durable Object) names the
  // pair — the caller must be one of them. What crosses the wire about the
  // OTHER player: their handle, two booleans about THIS stop, and one
  // count. No track keys, no other partners, no XP/coins, no breakdowns.
  if (parts[1] === 'story' && parts[2] === 'pair-context' && req.method === 'POST') {
    if (!env.TABLES) return json({ error: 'tables are not configured' }, 503);
    let body: { code?: unknown; stopId?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return json({ error: 'Send the context request as JSON.' }, 400); }
    const stop = typeof body.stopId === 'string' ? storyStopById(body.stopId) : undefined;
    if (!stop) return json({ error: 'unknown stop' }, 400);
    const code = typeof body.code === 'string' ? normalizeRoomCode(body.code) : '';
    if (!isRoomCode(code)) return json({ error: 'bad code' }, 400);
    const stub = env.TABLES.get(env.TABLES.idFromName(code));
    const mr = await stub.fetch(`https://table/story-members?code=${code}`).catch(() => null);
    if (!mr || !mr.ok) return json({ error: 'no such story table' }, 404);
    const members = (await mr.json()) as { hostUid: string; partnerUid: string | null; track: string | null };
    if (!members.partnerUid || !members.track) return json({ error: 'waiting for the pair to bind' }, 409);
    if (me.id !== members.hostUid && me.id !== members.partnerUid) return json({ error: 'That run belongs to another pair.' }, 403);
    const players: { handle: string; knowsStop: boolean; clearedStop: boolean; clearedStops: number }[] = [];
    for (const uid of [members.hostUid, members.partnerUid]) {
      const u = await db.prepare('SELECT username FROM users WHERE id = ?').bind(uid).first<{ username: string }>();
      const h = await personalHistoryFor(db, uid, stop.id);
      players.push({ handle: u?.username ?? 'Player', knowsStop: h.knowsStop, clearedStop: h.clearedStop, clearedStops: h.clearedStops });
    }
    const pf = (await factsFor(db, me.id, members.track)).get(stop.id);
    return json({
      players,
      pair: { attempts: pf?.attempts ?? 0, clears: pf?.clears ?? 0, doublePending: pf?.doublePending ?? false },
    });
  }

  // Open a story room (spec §2): the host picks the stop and, for an invite,
  // the partner. Both accounts must pass the story lock (§3.4) and the stop
  // must be unlocked on the PAIR track (§2.2) — never on anyone's solo run.
  if (parts[1] === 'story' && parts[2] === 'room' && req.method === 'POST') {
    if (!env.TABLES) return json({ error: 'tables are not configured' }, 503);
    let body: { stopId?: unknown; partnerUid?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return json({ error: 'Send the room request as JSON.' }, 400); }
    const stop = typeof body.stopId === 'string' ? storyStopById(body.stopId) : undefined;
    if (!stop) return json({ error: 'unknown stop' }, 400);
    let partnerUid: string | null = null;
    let track: string | null = null;
    if (typeof body.partnerUid === 'string' && body.partnerUid) {
      if (body.partnerUid === me.id) return json({ error: 'You are your own solo partner — pick someone else for co-op.' }, 400);
      const prow = await db.prepare('SELECT username FROM users WHERE id = ?').bind(body.partnerUid).first<{ username: string }>();
      if (!prow) return json({ error: 'unknown partner' }, 400);
      if (!hasStoryAccess(env, body.partnerUid, prow.username)) {
        return json({ error: 'Story mode is locked for that player while it is being finished.' }, 403);
      }
      partnerUid = body.partnerUid;
      track = storyPairTrackKey(me.id, partnerUid);
      if (!(await stopUnlockedFor(db, me.id, track, stop))) {
        return json({ error: 'That stop is locked for your run together — the pair advances together.' }, 409);
      }
    }
    // The room's awareness cases (spec §7): only computable once the
    // pair exists — invite rooms know both accounts now; share-code
    // rooms get theirs at bind (room-join below).
    const aware = partnerUid && track ? await awarenessCasesFor(db, me.id, partnerUid, track) : undefined;
    for (let i = 0; i < 6; i++) {
      const code = randomStoryCode();
      const stub = env.TABLES.get(env.TABLES.idFromName(code));
      const r = await stub.fetch(`https://table/story-setup?code=${code}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stopId: stop.id, hostUid: me.id, partnerUid, ...(aware ? { aware } : {}) }),
      }).catch(() => null);
      if (r && r.status === 201) return json({ ok: true, code, track, stopId: stop.id }, 201);
      if (r && r.status === 400) return json({ error: 'unknown stop' }, 400);
    }
    return json({ error: 'could not allocate a table code' }, 503);
  }

  // Share-code join (spec §2.1): whoever opens the link and signs in becomes
  // the partner — the account binds to the room, which fixes the pair track.
  // The stop must be unlocked on the pair track (§2.2), checked before binding.
  if (parts[1] === 'story' && parts[2] === 'room-join' && req.method === 'POST') {
    if (!env.TABLES) return json({ error: 'tables are not configured' }, 503);
    let body: { code?: unknown };
    try { body = (await req.json()) as typeof body; } catch { return json({ error: 'Send the join as JSON.' }, 400); }
    const code = typeof body.code === 'string' ? normalizeRoomCode(body.code) : '';
    if (!isRoomCode(code)) return json({ error: 'bad code' }, 400);
    const stub = env.TABLES.get(env.TABLES.idFromName(code));
    const mr = await stub.fetch(`https://table/story-members?code=${code}`).catch(() => null);
    if (!mr || !mr.ok) return json({ error: 'no such story table' }, 404);
    const members = (await mr.json()) as { hostUid: string; partnerUid: string | null; stopId: string; track: string | null };
    if (members.hostUid === me.id) return json({ ok: true, code, track: members.track, stopId: members.stopId });
    if (members.partnerUid) {
      if (members.partnerUid === me.id) return json({ ok: true, code, track: members.track, stopId: members.stopId });
      return json({ error: 'This story table is spoken for.' }, 409);
    }
    const stop = storyStopById(members.stopId);
    if (!stop) return json({ error: 'unknown stop' }, 400);
    const track = storyPairTrackKey(members.hostUid, me.id);
    if (!(await stopUnlockedFor(db, me.id, track, stop))) {
      return json({ error: 'That stop is locked for your run together — the pair advances together.' }, 409);
    }
    const aware = await awarenessCasesFor(db, members.hostUid, me.id, track);
    const br = await stub.fetch(`https://table/story-bind?code=${code}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid: me.id, aware }),
    }).catch(() => null);
    if (!br || !br.ok) return json({ error: 'This story table is spoken for.' }, 409);
    const bound = (await br.json()) as { track: string | null; stopId: string };
    return json({ ok: true, code, track: bound.track, stopId: bound.stopId });
  }

  return json({ error: 'not found' }, 404);
}

