/**
 * The Player Card (owner-approved 2026-10-23): every profile becomes a
 * flippable player card — the FRONT is flair (big avatar, name + handle,
 * Rep level + title, story-progress ribbon, showcased badges, partner tags,
 * a one-line status in the player's own words) and the BACK is the scouting
 * report (rating, record, win%, streak, per-mode splits, story stops,
 * member-since, and a head-to-head line when the viewer has met the subject
 * across the table). This module owns the card's data: the closed tag
 * vocabulary, the save validators, the earned-badge pool, and the payload
 * builder shared by /api/profile/me, /api/profile/:id — and, later, the
 * Partner Finder deck (Build 2 reuses `cardFor` unchanged).
 *
 * DATA HONESTY (the standing rule): every number here comes from rows the
 * game already stores — game_players / season_ratings / xp_state /
 * story_progress — computed the same way the surfaces that already show
 * them compute them. Nothing is estimated, backfilled, or rounded into
 * existence; a player with no recorded games gets games: 0 and the client
 * renders "No games on record yet" instead of a wall of zeroes.
 *
 * Status vs tagline: the tagline (0013) is the profile's longer line where
 * links WORK by design. The card status is the card's own shorter line
 * (cap 90). Both pass through the same shared hygiene helpers
 * (cleanText + maskProfanity from @spades/protocol, via ../filter) — the
 * same treatment chat text gets; there is no second filter.
 */
import { STORY_BADGE_DEFS, STORY_STOPS, storyBadgesFor, type StoryBadgeFacts } from '@spades/bots';
import { cleanText, maskProfanity } from '../filter';
import { myStats, personalStats, type MyModeStats } from '../stats/boards';
import { ACHIEVEMENTS, achievementStates } from './achievements';
import { bigJokerSeasonActive } from './bigJokerSeason';
import { ensureSeason } from './seasons';
import { cardRankForLevel, xpSnapshot, type CardRank } from './xp';

/* ------------------------------------------------------------ vocabulary */

export const CARD_STATUS_MAX = 90;
export const CARD_TAGS_MAX = 3;
export const CARD_SHOWCASE_MAX = 3;

/** The fixed partner-tag vocabulary (ids; display labels live client-side). */
export const PARTNER_TAGS = ['story-coop', 'competitive', 'casual', 'big-bank', 'nil-hunter', 'boston-runner'] as const;
export type PartnerTag = (typeof PARTNER_TAGS)[number];
const TAG_SET: ReadonlySet<string> = new Set(PARTNER_TAGS);

/* ---------------------------------------------------------------- badges */

/**
 * Badge kinds in the showcase pool. The prefix matters: ids collide across
 * sets (the story badge 'untouchable' and the achievement 'untouchable' are
 * different honors), so a showcase pick is always stored as "kind:id".
 *  - achievement — the Rep achievements (user_achievements)
 *  - story       — the story-mode badge set, derived from stored story facts
 *  - badge       — the account's synced progress badges (progress.data)
 */
export type BadgeKind = 'achievement' | 'story' | 'badge';
export interface BadgeSummary {
  kind: BadgeKind;
  id: string;
  /** display name when the server knows it (achievements, story defs);
   *  null for synced progress badges — the client resolves those from its
   *  own badge catalog, exactly like the profile Achievements tab does */
  name: string | null;
  /** glyph when the server knows it (story defs); null otherwise */
  icon: string | null;
  /** when it was earned, when that fact is stored; story badges derive from
   *  facts that carry no earn timestamp, so theirs is honestly null */
  earnedAt: number | null;
}
export const badgeKey = (b: { kind: BadgeKind; id: string }): string => `${b.kind}:${b.id}`;

/* ------------------------------------------------------ Big Joker rule */

/**
 * "All badges" for the Big Joker (owner, 2026-10-23: step 51 is reserved
 * for anyone who's gone through the ranks AND earned all badges). The
 * EXACT set this derivation uses — auditable, owner-vetoable:
 *   - the Rep achievements: all 18 defs in cred/achievements.ts
 *     (ACHIEVEMENTS: first-dub … after-dark), AND
 *   - the story badges: all 13 defs in @spades/bots STORY_BADGE_DEFS
 *     (porch-graduate … run-it-back).
 * Total earnable = 31. The third pool — synced progress badges
 * (progress.data, e.g. storm-chaser) — is deliberately EXCLUDED: it is an
 * open-ended device-synced list with no closed server-side earnable set
 * (the client catalog defines exactly one), so no honest denominator
 * exists for it.
 */
export interface BadgeCompletion {
  achievements: { earned: number; total: number };
  story: { earned: number; total: number };
  earned: number;
  total: number;
  complete: boolean;
}
export function badgeCompletionFor(badges: BadgeSummary[]): BadgeCompletion {
  const achievements = badges.filter((b) => b.kind === 'achievement').length;
  const story = badges.filter((b) => b.kind === 'story').length;
  const total = ACHIEVEMENTS.length + STORY_BADGE_DEFS.length;
  const earned = achievements + story;
  return {
    achievements: { earned: achievements, total: ACHIEVEMENTS.length },
    story: { earned: story, total: STORY_BADGE_DEFS.length },
    earned, total,
    complete: achievements >= ACHIEVEMENTS.length && story >= STORY_BADGE_DEFS.length,
  };
}

/** The story facts the badge set derives from — the union across ALL the
 *  player's tracks (solo + every pair run), user_id-only, mirroring
 *  anyTrackSummaryFor in story/routes.ts: a clear anywhere earns. */
async function storyFactsFor(db: D1Database, userId: string): Promise<{ facts: StoryBadgeFacts; stopsCleared: number; completed: boolean }> {
  const rows = await db.prepare('SELECT stop_id AS stopId, COALESCE(SUM(attempts), 0) AS attempts, COALESCE(SUM(clears), 0) AS clears FROM story_progress WHERE user_id = ? GROUP BY stop_id')
    .bind(userId).all<{ stopId: string; attempts: number; clears: number }>();
  const byStop = new Map(rows.results.map((r) => [r.stopId, r]));
  const findRows = await db.prepare('SELECT DISTINCT kind, find_id AS findId FROM story_finds WHERE user_id = ?')
    .bind(userId).all<{ kind: string; findId: string }>();
  const done = await db.prepare('SELECT COUNT(*) AS n FROM story_tracks WHERE user_id = ? AND completed_at IS NOT NULL')
    .bind(userId).first<{ n: number }>();
  const stops = STORY_STOPS.map((s) => ({ stopId: s.id, attempts: byStop.get(s.id)?.attempts ?? 0, clears: byStop.get(s.id)?.clears ?? 0 }));
  return {
    facts: {
      stops,
      finds: {
        eggs: findRows.results.filter((r) => r.kind === 'egg').map((r) => r.findId),
        feats: findRows.results.filter((r) => r.kind === 'feat').map((r) => r.findId),
      },
      completed: (done?.n ?? 0) > 0,
    },
    stopsCleared: stops.filter((s) => s.clears > 0).length,
    completed: (done?.n ?? 0) > 0,
  };
}

/** Every badge the player has actually earned, across all three sets —
 *  the showcase pool. A pick outside this list is not the player's to show. */
export async function earnedBadgesFor(db: D1Database, userId: string): Promise<BadgeSummary[]> {
  const [achievements, story, prog] = await Promise.all([
    achievementStates(db, userId),
    storyFactsFor(db, userId),
    db.prepare('SELECT data FROM progress WHERE user_id = ?').bind(userId).first<{ data: string }>(),
  ]);
  const out: BadgeSummary[] = [];
  for (const a of achievements) {
    if (a.unlockedAt != null) out.push({ kind: 'achievement', id: a.id, name: a.title, icon: null, earnedAt: a.unlockedAt });
  }
  for (const b of storyBadgesFor(story.facts)) {
    if (b.earned) out.push({ kind: 'story', id: b.id, name: b.name, icon: b.icon, earnedAt: null });
  }
  try {
    const p = prog ? JSON.parse(prog.data) as { badges?: { id: string; earnedAt: number }[] } : null;
    for (const b of p?.badges ?? []) {
      if (b && typeof b.id === 'string') out.push({ kind: 'badge', id: b.id, name: null, icon: null, earnedAt: typeof b.earnedAt === 'number' ? b.earnedAt : null });
    }
  } catch { /* a malformed progress blob earns nothing here — same as profileFor */ }
  return out;
}

/* ------------------------------------------------------------- validators */

type Clean<T> = { ok: true; value: T } | { ok: false; error: string };

/** Clean a candidate card status. Pure: shared by the route and the tests.
 *  Same helpers, same treatment as the tagline, capped at CARD_STATUS_MAX.
 *  An empty result means "no status" — saving blank clears it (stored NULL). */
export function cleanCardStatus(v: unknown): Clean<string | null> {
  if (typeof v !== 'string') return { ok: false, error: 'Send your status as text.' };
  const t = maskProfanity(cleanText(v, CARD_STATUS_MAX));
  return { ok: true, value: t === '' ? null : t };
}

/** Validate partner tags against the closed vocabulary (max CARD_TAGS_MAX).
 *  Unknown ids are rejected, never silently dropped — the editor should hear
 *  about a vocabulary drift, not lose a tag quietly. Duplicates collapse. */
export function cleanCardTags(v: unknown): Clean<PartnerTag[]> {
  if (!Array.isArray(v)) return { ok: false, error: 'Send your tags as a list.' };
  const out: PartnerTag[] = [];
  for (const t of v) {
    if (typeof t !== 'string' || !TAG_SET.has(t)) return { ok: false, error: 'Pick tags from the list.' };
    if (!out.includes(t as PartnerTag)) out.push(t as PartnerTag);
  }
  if (out.length > CARD_TAGS_MAX) return { ok: false, error: `Pick at most ${CARD_TAGS_MAX} tags.` };
  return { ok: true, value: out };
}

/** Validate showcase picks ("kind:id" keys) against the badges the player
 *  has EARNED (max CARD_SHOWCASE_MAX). Showing an unearned badge is the one
 *  thing this endpoint must never allow, so membership is checked against a
 *  freshly computed earned set, not against anything the client claims. */
export function cleanCardShowcase(v: unknown, earnedKeys: ReadonlySet<string>): Clean<string[]> {
  if (!Array.isArray(v)) return { ok: false, error: 'Send your showcase as a list.' };
  const out: string[] = [];
  for (const k of v) {
    if (typeof k !== 'string' || !earnedKeys.has(k)) return { ok: false, error: 'You can only showcase badges you have earned.' };
    if (!out.includes(k)) out.push(k);
  }
  if (out.length > CARD_SHOWCASE_MAX) return { ok: false, error: `Showcase at most ${CARD_SHOWCASE_MAX} badges.` };
  return { ok: true, value: out };
}

/* ---------------------------------------------------------------- payload */

export interface CardModeSplit { rating: number; games: number; wins: number; losses: number }
export interface PlayerCardData {
  userId: string;
  name: string;
  avatar: string | null;
  avatarUpdatedAt: number | null;
  memberSince: number;
  level: { level: number; title: string };
  /** the player's rank card, derived from their Rep level by the one
   *  ladder derivation (cred/xp.ts cardRankForLevel) — payload-carried so
   *  no client ever recomputes it */
  rank: CardRank;
  /** the Big Joker two-layer status: `earned` is the permanent latched
   *  feat (level 50 + all badges, users.big_joker_at); `active` is the
   *  seasonal crown (cred/bigJokerSeason.ts) — step 51 displays only
   *  while earned && active, else an earned-but-inactive holder shows
   *  step 50. Exposed so clients can render upkeep states later with
   *  no payload change. */
  bigJoker: { earned: boolean; active: boolean };
  status: string | null;
  tags: PartnerTag[];
  /** the resolved showcase (stored picks ∩ earned, in pick order; when the
   *  player has made no picks, the 3 most recently earned by default) */
  showcase: BadgeSummary[];
  /** the full earned pool — the editor's pick list, and Build 2's catalog */
  badges: BadgeSummary[];
  story: { stopsCleared: number; stopsTotal: number; completed: boolean };
  stats: {
    games: number; wins: number; losses: number;
    winPct: number | null;
    /** current streak: consecutive wins across the latest recorded games
     *  (personalStats semantics — the same streak the social profile shows) */
    streak: number;
    bestStreak: number;
    team: CardModeSplit;
    cutthroat: CardModeSplit;
  };
  /** head-to-head vs the viewer, FROM THE VIEWER'S perspective
   *  ({games, wins: viewer's wins, losses: viewer's losses}); present only
   *  when a signed-in viewer who is not the subject has actually shared a
   *  table with the subject as an opponent. Partner-only history never
   *  counts here — riding together is the pair record's story, not this. */
  vsViewer?: { games: number; wins: number; losses: number };
}

const pctOf = (wins: number, games: number) => (games ? Math.round((1000 * wins) / games) / 10 : null);

function parseStoredList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as unknown;
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

async function seasonSplit(db: D1Database, userId: string, seasonId: string, kind: 'team' | 'cutthroat'): Promise<CardModeSplit> {
  const row = await db.prepare('SELECT rating, games, wins, losses FROM season_ratings WHERE user_id = ? AND season_id = ? AND kind = ?')
    .bind(userId, seasonId, kind).first<{ rating: number; games: number; wins: number; losses: number }>();
  // Defaults mirror seasonRank() in routes.ts exactly (a player with no
  // season row sits at the 1,000 base with no games) so the card back and
  // the profile's rating cards can never tell two stories.
  return { rating: Math.round(row?.rating ?? 1000), games: row?.games ?? 0, wins: row?.wins ?? 0, losses: row?.losses ?? 0 };
}

/**
 * Build the card payload for `userId` as seen by `viewerId` (null =
 * anonymous, == userId = self view). Self-contained by design: the profile
 * routes pass their already-computed level/stats in `pre` to avoid paying
 * for the same reads twice; the Partner Finder will call it bare.
 */
export async function cardFor(
  db: D1Database,
  userId: string,
  viewerId: string | null,
  now: number,
  pre?: { level?: { level: number; title: string }; stats?: { team: MyModeStats; cutthroat: MyModeStats } },
): Promise<PlayerCardData | null> {
  const u = await db.prepare(`SELECT username, avatar, avatar_updated_at AS avatarUpdatedAt, created_at AS createdAt,
      card_status AS status, card_tags AS tagsRaw, card_showcase AS showcaseRaw, big_joker_at AS bigJokerAt FROM users WHERE id = ?`)
    .bind(userId).first<{ username: string | null; avatar: string | null; avatarUpdatedAt: number | null; createdAt: number; status: string | null; tagsRaw: string | null; showcaseRaw: string | null; bigJokerAt: number | null }>();
  if (!u) return null;

  const season = await ensureSeason(db, now);
  const [level, stats, badges, story, combined, team, cutthroat] = await Promise.all([
    pre?.level ?? xpSnapshot(db, userId),
    pre?.stats ?? myStats(db, userId),
    earnedBadgesFor(db, userId),
    storyFactsFor(db, userId),
    personalStats(db, userId),
    seasonSplit(db, userId, season.id, 'team'),
    seasonSplit(db, userId, season.id, 'cutthroat'),
  ]);

  const tags = parseStoredList(u.tagsRaw).filter((t): t is PartnerTag => TAG_SET.has(t)).slice(0, CARD_TAGS_MAX);

  const byKey = new Map(badges.map((b) => [badgeKey(b), b] as const));
  const picks = parseStoredList(u.showcaseRaw).filter((k) => byKey.has(k)).slice(0, CARD_SHOWCASE_MAX);
  const showcase = picks.length
    ? picks.map((k) => byKey.get(k)!)
    : [...badges].sort((a, b) => (b.earnedAt ?? 0) - (a.earnedAt ?? 0)).slice(0, CARD_SHOWCASE_MAX);

  const games = stats.team.games + stats.cutthroat.games;
  const wins = stats.team.wins + stats.cutthroat.wins;

  /* The Big Joker (owner, 2026-10-23): the FEAT latches the first time a
   * level-50 player is seen with every badge earned — written once, here,
   * on the read path every profile surface shares (the same idempotent-
   * earner pattern fullProfile uses for its grants), and never cleared.
   * The ACTIVE crown is seasonal (cred/bigJokerSeason.ts): step 51
   * displays only while earned && seasonActive. */
  let bigJokerEarnedAt = u.bigJokerAt;
  if (bigJokerEarnedAt == null && level.level >= 50 && badgeCompletionFor(badges).complete) {
    bigJokerEarnedAt = now;
    try {
      await db.prepare('UPDATE users SET big_joker_at = ? WHERE id = ? AND big_joker_at IS NULL').bind(now, userId).run();
    } catch { /* the latch is best-effort on a read; the next read retries */ }
  }
  const bigJokerEarned = bigJokerEarnedAt != null;
  const bigJokerActive = bigJokerEarned
    ? await bigJokerSeasonActive(db, userId, bigJokerEarnedAt, season.id, undefined, now)
    : false;

  const card: PlayerCardData = {
    userId,
    name: u.username ?? 'Player',
    avatar: u.avatar,
    avatarUpdatedAt: u.avatarUpdatedAt,
    memberSince: u.createdAt,
    level: { level: level.level, title: level.title },
    rank: cardRankForLevel(level.level, { bigJoker: bigJokerActive }),
    bigJoker: { earned: bigJokerEarned, active: bigJokerActive },
    status: u.status,
    tags,
    showcase,
    badges,
    story: { stopsCleared: story.stopsCleared, stopsTotal: STORY_STOPS.length, completed: story.completed },
    stats: {
      games, wins, losses: games - wins,
      winPct: pctOf(wins, games),
      streak: combined.streak,
      bestStreak: combined.bestStreak,
      team, cutthroat,
    },
  };

  if (viewerId && viewerId !== userId) {
    // The same self-join the social profile's head-to-head runs on:
    // shared games on OPPOSITE sides, abandoned games excluded. Wins are
    // counted from each side's own rows, so a cutthroat game a third
    // player took counts as a meeting for both and a win for neither.
    const v = await db.prepare(`SELECT COUNT(*) AS games, COALESCE(SUM(o.won), 0) AS viewerWins, COALESCE(SUM(me.won), 0) AS subjectWins
      FROM game_players me JOIN game_players o ON o.game_id = me.game_id AND o.side != me.side
      JOIN games g ON g.id = me.game_id AND COALESCE(g.end_reason, 'finished') != 'abandoned'
      WHERE me.user_id = ? AND o.user_id = ?`).bind(userId, viewerId)
      .first<{ games: number; viewerWins: number; subjectWins: number }>();
    if (v && v.games > 0) card.vsViewer = { games: v.games, wins: v.viewerWins, losses: v.subjectWins };
  }
  return card;
}
