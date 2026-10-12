/**
 * One-shot backfill of M33CH's imported offline 2v2 Joker win (Homies 296–192).
 * The progress row only has the rematch series, not a full hand history, so the stored
 * record is source='offline', partial=1, and unrated. Unknown per-hand totals (books, bags, bids)
 * stay 0 so they do not move accuracy or books per hand. Safe to run twice.
 */
export const HOMIES_USER = 'ed41194162a842d61600fdf573d9a9d5';
export const HOMIES_GAME_ID = `backfill:${HOMIES_USER}:homies-296-192`;

export interface HomiesHit {
  at: number;
  hands: number;
  final: [number, number];
  winners: number[];
  names: [string, string];
  side: number;
  sets: number;
  oppSets: number;
  wheels: number;
  nilMade: number;
  nilBids: number;
}

function at(a: unknown, i: number): number {
  if (!Array.isArray(a)) return 0;
  const v = a[i];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** The Homies 296–192 Joker win inside an imported progress blob, or null. */
export function findHomiesWin(data: unknown): HomiesHit | null {
  const root = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const series = root?.series && typeof root.series === 'object' ? (root.series as Record<string, unknown>) : null;
  if (!series || series.mode !== 'joker' || !Array.isArray(series.games)) return null;
  const sides = Array.isArray(series.sides) ? series.sides : [];
  for (const raw of series.games) {
    if (!raw || typeof raw !== 'object') continue;
    const g = raw as Record<string, unknown>;
    const names = Array.isArray(g.names) ? g.names : [];
    const final = Array.isArray(g.final) ? g.final : [];
    if (names.length !== 2 || final.length !== 2) continue;
    if (names.some((n) => typeof n !== 'string') || final.some((n) => typeof n !== 'number' || !Number.isFinite(n))) continue;
    const side = (names as string[]).findIndex((n) => n.trim().toLowerCase() === 'homies');
    if (side < 0) continue;
    const other = side === 0 ? 1 : 0;
    if (final[side] !== 296 || final[other] !== 192) continue;
    const winners = Array.isArray(g.winners) ? g.winners : [];
    if (!winners.includes(side)) continue;
    const sideRow = sides[side] && typeof sides[side] === 'object' ? (sides[side] as { members?: unknown }).members : null;
    if (Array.isArray(sideRow) && sideRow.length > 0 && !sideRow.includes('you')) continue;
    const hands = Number.isInteger(g.hands) && (g.hands as number) >= 1 && (g.hands as number) <= 40 ? (g.hands as number) : 1;
    const when = typeof g.at === 'number' && Number.isFinite(g.at) && g.at > 0 ? g.at : 0;
    const nilMade = at(g.nilsMade, side);
    return {
      at: when, hands, final: [final[0] as number, final[1] as number], winners: [side], names: [names[0] as string, names[1] as string],
      side, sets: at(g.sets, side), oppSets: at(g.sets, other), wheels: at(g.wheels, side), nilMade, nilBids: nilMade + at(g.nilsBusted, side),
    };
  }
  return null;
}

export type BackfillResult = { inserted: boolean; reason: 'saved' | 'exists' | 'no-match' | 'no-user' | 'schema' };

async function columnsReady(db: D1Database): Promise<boolean> {
  try {
    await db.prepare('SELECT source, partial, client_game_id FROM games LIMIT 0').all();
    return true;
  } catch (e) {
    if (/no such column/i.test(String(e))) return false;
    throw e;
  }
}

/** Insert the win if this account's progress still has it. Does nothing when the row is already there. */
export async function backfillHomiesWin(db: D1Database): Promise<BackfillResult> {
  if (!(await columnsReady(db))) return { inserted: false, reason: 'schema' };
  const existing = await db.prepare('SELECT 1 AS ok FROM games WHERE id = ?').bind(HOMIES_GAME_ID).first();
  if (existing) return { inserted: false, reason: 'exists' };
  const user = await db.prepare('SELECT username FROM users WHERE id = ?').bind(HOMIES_USER).first<{ username: string | null }>();
  if (!user) return { inserted: false, reason: 'no-user' };
  const row = await db.prepare('SELECT data FROM progress WHERE user_id = ?').bind(HOMIES_USER).first<{ data: string }>();
  if (!row) return { inserted: false, reason: 'no-match' };
  let data: unknown;
  try { data = JSON.parse(row.data); } catch { return { inserted: false, reason: 'no-match' }; }
  const hit = findHomiesWin(data);
  if (!hit) return { inserted: false, reason: 'no-match' };

  const username = user.username || 'M33CH';
  const seats = [0, 1, 2, 3].map((seat) => {
    const side = seat % 2;
    if (seat === hit.side) return { name: username, side, kind: 'user' as const, uid: HOMIES_USER };
    return { name: 'Bot', side, kind: 'bot' as const };
  });
  // hands in the player blob stay 0: books are not in the series, and books/hand divides by hands
  const stats = {
    won: true, hands: 0, bids: 0, bidSum: 0, made: 0, set: hit.sets, bags: 0,
    nilBids: hit.nilBids, nilMade: hit.nilMade, books: 0,
    shotsTaken: hit.sets, shotsGiven: hit.oppSets, wheels: hit.wheels, bjWins: 0,
    bidMs: 0, bidN: 0, playMs: 0, playN: 0,
  };
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, source, client_game_id, partial)
      VALUES (?, 'offline', 'joker', 'team', ?, ?, ?, ?, ?, ?, 0, 'offline', ?, 1)`)
      .bind(HOMIES_GAME_ID, hit.at, hit.hands, JSON.stringify(hit.final), JSON.stringify(hit.winners), JSON.stringify(hit.names), JSON.stringify(seats), HOMIES_GAME_ID),
    db.prepare(`INSERT OR IGNORE INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, team_name, ended_at, stats, elo_before, elo_after)
      VALUES (?, ?, 'team', ?, ?, 1, NULL, 'Homies', ?, ?, NULL, NULL)`)
      .bind(HOMIES_GAME_ID, HOMIES_USER, hit.side, hit.side, hit.at, JSON.stringify(stats)),
  ]);
  return { inserted: true, reason: 'saved' };
}

let job: Promise<void> | null = null;
let finished = false;

/** Once per isolate, after the migration that adds source/partial. A missing column retries on the next request. */
export function backfillHomiesOnce(db: D1Database): Promise<void> {
  if (finished) return Promise.resolve();
  if (!job) {
    job = backfillHomiesWin(db).then((r) => {
      if (r.reason === 'schema') job = null;
      else finished = true;
    }).catch((e) => {
      job = null;
      console.error('homies backfill', e);
    });
  }
  return job;
}
