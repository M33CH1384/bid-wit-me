/**
 * Quit metrics for RATED games (owner, 2026-11-02: "We also need metrics in
 * when or if players quit games" / "This should only apply to ranked games").
 *
 * Placement-agnostic derivation: this module measures and reports; it is
 * deliberately NOT wired to any route or board yet (the owner picks the
 * surface — owner-only, player card, or public board — separately).
 *
 * DATA TRUTH (verified against room.ts / record.ts / migration 0005 — no
 * new instrumentation and no backfill):
 * - A quit is already recorded. When a game dies mid-play, the room writes
 *   ONE abandoned row (games.end_reason = 'abandoned') carrying leaver_id
 *   (the signed-in player whose leave ended the deal), ended_at (when),
 *   hands (hands completed at that moment), final (per-side scores at that
 *   moment) and seats (who sat where, user/guest/bot). History therefore
 *   exists from when that recording shipped (migration 0005), not from
 *   this module.
 * - Only the FIRST leaver of a deal is recorded, by design: the deal is
 *   abandoned at that moment and later exits leave a bot-filled game. A
 *   "quit" here = the leave that ended the deal as a human contest. The
 *   host is the recorded leaver when a rematch/replacement starts over a
 *   live game (they ended the old deal); room expiry writes leaver_id
 *   NULL and counts as unattributed — never against a player.
 * - A disconnect or crash that never returns writes NO quit row: the seat
 *   auto-plays on the turn clock and the game finishes normally (or the
 *   room expires unattributed). These numbers are recorded leave actions,
 *   never inferred disconnects. The client_crashes telemetry is a
 *   separate owner-only dataset and is not merged in here.
 * - Kicks write no abandon record and name nobody: not quits, and in
 *   neither the numerator nor the denominator (the kicked player simply
 *   has no row for that deal).
 *
 * SCOPE mirrors the pace board's predicates (boards.ts): the game was
 * rated (games.rated = 1, written at save time when signed-in players sat
 * on at least two sides) AND the player had human opposition — for a
 * starter row, NOT the all-bot-opponents case (VS_BOTS); for a leaver, a
 * signed-in seat on another side. Unrated games and all-bot tables are
 * out entirely.
 */
import { since, type Period } from './boards';

export type QuitHandBucket = 'early' | 'mid' | 'late';
export interface QuitHandBuckets { early: number; mid: number; late: number }
export interface QuitScoreContext { behind: number; ahead: number; level: number; unknown: number }

/** The hand in progress when they left is hands+1 (hands = completed hands). */
export function quitHandBucket(hands: number): QuitHandBucket {
  if (hands <= 1) return 'early'; // left during hand 1–2
  if (hands <= 4) return 'mid'; // left during hand 3–5
  return 'late'; // left during hand 6+
}

/**
 * Where the leaver's side stood when they left: its score in `final`
 * against the best opposing side. Level covers the all-square cases
 * (including a first-hand quit at 0–0). Unknown when the stored scores
 * don't cover the leaver's side — counted, never guessed.
 */
export function quitScoreContext(final: number[], side: number): keyof QuitScoreContext {
  if (!Array.isArray(final) || final.length < 2 || side < 0 || side >= final.length) return 'unknown';
  const mine = Number(final[side]);
  if (!Number.isFinite(mine)) return 'unknown';
  let bestOpp = -Infinity;
  for (let i = 0; i < final.length; i++) {
    if (i === side) continue;
    const v = Number(final[i]);
    if (Number.isFinite(v)) bestOpp = Math.max(bestOpp, v);
  }
  if (bestOpp === -Infinity) return 'unknown';
  return mine < bestOpp ? 'behind' : mine > bestOpp ? 'ahead' : 'level';
}

const emptyBuckets = (): QuitHandBuckets => ({ early: 0, mid: 0, late: 0 });
const emptyScore = (): QuitScoreContext => ({ behind: 0, ahead: 0, level: 0, unknown: 0 });
const pct = (num: number, den: number) => Math.round((1000 * num) / den) / 10;

// Human-opposition guard for the game_players alias x — boards.ts's
// VS_BOTS fragment, kept in step deliberately: every opposing seat a bot
// means this player's game was not against people.
const VS_BOTS = `EXISTS (SELECT 1 FROM json_each(g.seats) je WHERE json_extract(je.value, '$.side') != x.side) AND NOT EXISTS (SELECT 1 FROM json_each(g.seats) je WHERE json_extract(je.value, '$.side') != x.side AND json_extract(je.value, '$.kind') != 'bot')`;

interface SeatLite { side: number; kind: string; uid?: string }
interface QuitGameRow { id: string; leaver_id: string; hands: number; final: string; seats: string; ended_at: number }

/** Attributed quit rows in scope for the window (rated, a named leaver). */
async function quitRows(db: D1Database, kind: 'team' | 'cutthroat', from: number): Promise<QuitGameRow[]> {
  return (await db.prepare(`SELECT g.id AS id, g.leaver_id AS leaver_id, g.hands AS hands, g.final AS final, g.seats AS seats, g.ended_at AS ended_at
    FROM games g
    WHERE g.kind = ? AND COALESCE(g.end_reason, 'finished') = 'abandoned' AND g.rated = 1 AND g.leaver_id IS NOT NULL AND g.ended_at >= ?`)
    .bind(kind, from).all<QuitGameRow>()).results;
}

/**
 * Fold quit rows into per-leaver aggregates. A row only counts when the
 * stored seats put the leaver at the table against signed-in opposition
 * (rated should guarantee it; the check keeps a stray row honest).
 */
function foldQuits(rows: QuitGameRow[]) {
  const perUser = new Map<string, { quits: number; byHand: QuitHandBuckets; score: QuitScoreContext }>();
  const byHand = emptyBuckets();
  const score = emptyScore();
  let quits = 0;
  for (const r of rows) {
    let seats: SeatLite[] = [];
    try { seats = JSON.parse(r.seats); } catch { continue; }
    const mine = seats.find((s) => s.kind === 'user' && s.uid === r.leaver_id);
    if (!mine) continue;
    if (!seats.some((s) => s.kind === 'user' && Number(s.side) !== Number(mine.side))) continue;
    let final: number[] = [];
    try { final = JSON.parse(r.final); } catch { /* score context stays unknown */ }
    const bucket = quitHandBucket(r.hands);
    const ctx = quitScoreContext(final, Number(mine.side));
    quits++;
    byHand[bucket]++;
    score[ctx]++;
    const agg = perUser.get(r.leaver_id) ?? { quits: 0, byHand: emptyBuckets(), score: emptyScore() };
    agg.quits++;
    agg.byHand[bucket]++;
    agg.score[ctx]++;
    perUser.set(r.leaver_id, agg);
  }
  return { perUser, byHand, score, quits };
}

/**
 * Rated games started per player in the window: game_players rows in
 * rated games with human opposition, deduped by deal family (a deal
 * abandoned then finished is one start for everyone — the personalStats
 * precedent; the leaver's row exists only in the abandoned record).
 */
async function startedByUser(db: D1Database, kind: 'team' | 'cutthroat', from: number, uid?: string): Promise<Map<string, number>> {
  const rows = (await db.prepare(`SELECT x.user_id AS uid, COUNT(DISTINCT COALESCE(g.family, g.id)) AS started
    FROM game_players x JOIN games g ON g.id = x.game_id
    WHERE x.kind = ? AND g.rated = 1 AND x.ended_at >= ? AND NOT (${VS_BOTS}) ${uid ? 'AND x.user_id = ?' : ''}
    GROUP BY x.user_id`)
    .bind(...(uid ? [kind, from, uid] : [kind, from])).all<{ uid: string; started: number }>()).results;
  return new Map(rows.map((r) => [r.uid, Number(r.started) || 0]));
}

export interface QuitPopulation {
  /** distinct rated deals with any record in the window (finished + abandoned) */
  ratedGames: number;
  /** deals ended by a named player's leave */
  quits: number;
  /** abandoned rated deals with no recorded leaver (room expiry) */
  unattributed: number;
  /** quits / ratedGames as a percentage, 1dp; null when there were no rated games */
  quitRate: number | null;
  byHand: QuitHandBuckets;
  score: QuitScoreContext;
}

export interface QuitLeaderRow {
  rank: number;
  /** 'u:'-prefixed, like the league boards */
  id: string;
  name: string;
  quits: number;
  started: number;
  /** quits / started as a percentage, 1dp */
  rate: number;
  byHand: QuitHandBuckets;
}

export interface QuitReport { population: QuitPopulation; leaders: QuitLeaderRow[] }

/**
 * Population aggregates + the per-player table for one pool and window.
 * Leaders floor: at least `floor` rated starts in the window (default 10,
 * the winpct board's rate-honesty precedent) so a 1-for-1 never tops a
 * rate table; ordering is quits first (the count is the headline), then
 * rate, then starts.
 */
export async function quitReport(db: D1Database, o: { kind: 'team' | 'cutthroat'; period: Period; now: number; floor?: number }): Promise<QuitReport> {
  const from = since(o.period, o.now);
  const floor = o.floor ?? 10;
  const [rows, started, gamesRow, unattrRow] = await Promise.all([
    quitRows(db, o.kind, from),
    startedByUser(db, o.kind, from),
    db.prepare(`SELECT COUNT(DISTINCT COALESCE(family, id)) AS n FROM games WHERE kind = ? AND rated = 1 AND ended_at >= ?`).bind(o.kind, from).first<{ n: number }>(),
    db.prepare(`SELECT COUNT(*) AS n FROM games WHERE kind = ? AND COALESCE(end_reason, 'finished') = 'abandoned' AND rated = 1 AND leaver_id IS NULL AND ended_at >= ?`).bind(o.kind, from).first<{ n: number }>(),
  ]);
  const folded = foldQuits(rows);
  const ratedGames = Number(gamesRow?.n) || 0;
  const population: QuitPopulation = {
    ratedGames,
    quits: folded.quits,
    unattributed: Number(unattrRow?.n) || 0,
    quitRate: ratedGames ? pct(folded.quits, ratedGames) : null,
    byHand: folded.byHand,
    score: folded.score,
  };
  const names = new Map<string, string>();
  if (folded.perUser.size) {
    const ids = [...folded.perUser.keys()];
    const rs = (await db.prepare(`SELECT id, username FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string; username: string | null }>()).results;
    for (const r of rs) names.set(r.id, r.username ?? 'Player');
  }
  const leaders: QuitLeaderRow[] = [...folded.perUser.entries()]
    .map(([uid, agg]) => ({ uid, name: names.get(uid) ?? 'Player', quits: agg.quits, started: started.get(uid) ?? 0, byHand: agg.byHand }))
    .filter((r) => r.started >= floor)
    .map((r) => ({ ...r, rate: r.started ? pct(r.quits, r.started) : 0 }))
    .sort((a, b) => b.quits - a.quits || b.rate - a.rate || b.started - a.started || a.name.localeCompare(b.name))
    .map((r, i) => ({ rank: i + 1, id: `u:${r.uid}`, name: r.name, quits: r.quits, started: r.started, rate: r.rate, byHand: r.byHand }));
  return { population, leaders };
}

export interface PersonalQuitStats {
  started: number;
  quits: number;
  /** quits / started as a percentage, 1dp; null when the player has no rated starts in the window */
  rate: number | null;
  byHand: QuitHandBuckets;
  score: QuitScoreContext;
}

/** One player's quit line (all recorded history by default; pass a period to window it). */
export async function personalQuitStats(db: D1Database, uid: string, kind?: 'team' | 'cutthroat', period: Period = 'all', now: number = Date.now()): Promise<PersonalQuitStats> {
  const from = since(period, now);
  const kinds: ('team' | 'cutthroat')[] = kind ? [kind] : ['team', 'cutthroat'];
  let started = 0;
  const agg = { quits: 0, byHand: emptyBuckets(), score: emptyScore() };
  for (const k of kinds) {
    const [rows, starts] = await Promise.all([
      (await db.prepare(`SELECT g.id AS id, g.leaver_id AS leaver_id, g.hands AS hands, g.final AS final, g.seats AS seats, g.ended_at AS ended_at
        FROM games g
        WHERE g.kind = ? AND COALESCE(g.end_reason, 'finished') = 'abandoned' AND g.rated = 1 AND g.leaver_id = ? AND g.ended_at >= ?`)
        .bind(k, uid, from).all<QuitGameRow>()).results,
      startedByUser(db, k, from, uid),
    ]);
    started += starts.get(uid) ?? 0;
    const folded = foldQuits(rows);
    const mine = folded.perUser.get(uid);
    if (mine) {
      agg.quits += mine.quits;
      agg.byHand.early += mine.byHand.early; agg.byHand.mid += mine.byHand.mid; agg.byHand.late += mine.byHand.late;
      agg.score.behind += mine.score.behind; agg.score.ahead += mine.score.ahead; agg.score.level += mine.score.level; agg.score.unknown += mine.score.unknown;
    }
  }
  return { started, quits: agg.quits, rate: started ? pct(agg.quits, started) : null, byHand: agg.byHand, score: agg.score };
}
