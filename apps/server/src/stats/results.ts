/**
 * Recent-results feed (league data wave, item 1): the ticker's results lines.
 *
 * The persistence already exists — saveRecord writes one `games` row per
 * finished game (final scores per side, winning sides, the seat list with
 * public display names) plus per-player stat JSON in `game_players`. This
 * module is the READ side: the latest finished ONLINE games with at least
 * two signed-in players at the table (the same "real match" bar the rated
 * boards use), shaped for the ticker. Nothing is reconstructed or invented:
 * a game that was never recorded simply isn't here, and the feed starts
 * accumulating from games already stored — no backfill is needed because
 * the rows were always written.
 *
 * Notable flags, honestly scoped:
 *  - wheels: a player's stored per-game `wheels` count > 0 → the game had a
 *    Wheels hand. Stored per player per game, so this is exact.
 *  - boston is deliberately NOT flagged here: per-hand side book totals
 *    aren't stored (a team Boston splits books across two seats), and in
 *    cutthroat a hand can run to 17 tricks after an elimination, so a
 *    stored maxBooksHand of 13 isn't proof of a Boston either. Bostons are
 *    captured live at hand end instead (the highlights feed), where the
 *    real hand record exists.
 */
import type { SeatRef } from './record';

export interface ResultSide { names: string[]; score: number; won: boolean }

export interface RecentResult {
  id: string;
  at: number;
  kind: 'team' | 'cutthroat';
  mode: string;
  /** the table code the game was played at */
  code: string;
  sides: ResultSide[];
  wheels: boolean;
}

interface GameRow {
  id: string; room: string; mode: string; kind: string; ended_at: number;
  final: string; winners: string; seats: string;
}

const parse = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };

/** The latest finished online matches, newest first. `limit` is clamped by the route. */
export async function recentResults(db: D1Database, limit: number): Promise<RecentResult[]> {
  // Over-fetch: some recent rows are vs-bots-only games (one signed-in
  // player), which the feed skips — pull extra so the page still fills.
  const rows = (await db.prepare(`SELECT id, room, mode, kind, ended_at, final, winners, seats FROM games
    WHERE source = 'online' AND end_reason = 'finished' AND partial = 0
    ORDER BY ended_at DESC, id DESC LIMIT ?`).bind(Math.max(limit * 3, limit)).all<GameRow>()).results;
  const out: RecentResult[] = [];
  const picked: GameRow[] = [];
  for (const g of rows) {
    if (out.length >= limit) break;
    const seats = parse<SeatRef[]>(g.seats, []);
    // A real match: signed-in players on at least two sides (guests and bots
    // appear in the seat list but don't make a game a league result).
    const userSides = new Set(seats.filter((s) => s.kind === 'user').map((s) => s.side));
    if (userSides.size < 2) continue;
    const final = parse<number[]>(g.final, []);
    const winners = parse<number[]>(g.winners, []);
    if (!final.length || !winners.length) continue;
    const bySide = new Map<number, string[]>();
    for (const s of seats) {
      const list = bySide.get(s.side) ?? [];
      list.push(s.name);
      bySide.set(s.side, list);
    }
    const sides: ResultSide[] = final.map((score, side) => ({
      names: bySide.get(side) ?? [],
      score,
      won: winners.includes(side),
    }));
    out.push({ id: g.id, at: g.ended_at, kind: g.kind === 'cutthroat' ? 'cutthroat' : 'team', mode: g.mode, code: g.room, sides, wheels: false });
    picked.push(g);
  }
  if (picked.length) {
    const ids = picked.map((g) => g.id);
    const stats = (await db.prepare(`SELECT game_id, stats FROM game_players WHERE game_id IN (${ids.map(() => '?').join(',')})`)
      .bind(...ids).all<{ game_id: string; stats: string }>()).results;
    const wheelsGames = new Set<string>();
    for (const r of stats) {
      const st = parse<{ wheels?: number }>(r.stats, {});
      if ((st.wheels ?? 0) > 0) wheelsGames.add(r.game_id);
    }
    for (const res of out) res.wheels = wheelsGames.has(res.id);
  }
  return out;
}
