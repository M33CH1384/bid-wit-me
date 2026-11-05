/**
 * Match detail (BWM Central Phase 1): one recorded game in full — the game
 * row, every signed-in player's row, and the per-hand score timeline from
 * game_hands (migration 0036; empty for games recorded before it existed —
 * the timeline is never reconstructed from anything else).
 *
 * Visibility: the caller must be a participant (a game_players row) OR the
 * game must qualify as a public result under the SAME rule the /results
 * feed uses (recentResults in results.ts): a finished, non-partial ONLINE
 * game with signed-in players on at least two sides. Anything else is
 * indistinguishable from a game that does not exist (the route 404s).
 * Only data classes already exposed by the profile/results payloads leave
 * here: display seat list, final scores, per-player stat JSON, Elo deltas.
 */
import type { SeatRef } from './record';

export interface MatchDetail {
  game: { id: string; mode: string; kind: string; endedAt: number; hands: number; rated: boolean; winners: number[]; final: number[]; seats: SeatRef[] };
  players: { userId: string; name: string | null; seat: number; side: number; won: boolean; partnerId: string | null; teamName: string | null; stats: unknown; eloBefore: number | null; eloAfter: number | null }[];
  timeline: { hand: number; side: number; scoreAfter: number; books: number }[];
}

interface GameRow {
  id: string; mode: string; kind: string; ended_at: number; hands: number; rated: number;
  winners: string; final: string; seats: string; source: string; partial: number; end_reason: string | null;
}

const parse = <T>(s: string, fallback: T): T => { try { return JSON.parse(s) as T; } catch { return fallback; } };

export async function matchDetail(db: D1Database, gameId: string, viewerId: string | null): Promise<MatchDetail | null> {
  const g = await db.prepare('SELECT id, mode, kind, ended_at, hands, rated, winners, final, seats, source, partial, end_reason FROM games WHERE id = ?')
    .bind(gameId).first<GameRow>();
  if (!g) return null;
  const players = (await db.prepare(`SELECT gp.user_id AS user_id, u.username AS username, gp.seat AS seat, gp.side AS side, gp.won AS won,
      gp.partner_id AS partner_id, gp.team_name AS team_name, gp.stats AS stats, gp.elo_before AS elo_before, gp.elo_after AS elo_after
    FROM game_players gp LEFT JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? ORDER BY gp.seat ASC, gp.user_id ASC`).bind(gameId)
    .all<{ user_id: string; username: string | null; seat: number; side: number; won: number; partner_id: string | null; team_name: string | null; stats: string; elo_before: number | null; elo_after: number | null }>()).results;
  const seats = parse<SeatRef[]>(g.seats, []);
  const isParticipant = !!viewerId && players.some((p) => p.user_id === viewerId);
  if (!isParticipant) {
    // The /results rule (results.ts recentResults): finished online games,
    // never partial series rows, with signed-in players on ≥2 sides.
    const userSides = new Set(seats.filter((s) => s.kind === 'user').map((s) => s.side));
    const isPublic = g.source === 'online' && (g.end_reason ?? 'finished') === 'finished' && !g.partial && userSides.size >= 2;
    if (!isPublic) return null;
  }
  // Display name per player (client steer, Phase 1): the account's current
  // username, falling back to the name that seat played under (games.seats),
  // else null — the client falls back to teamName / "Seat N".
  const seatNames = new Map<number, string>();
  seats.forEach((s, i) => { if (s.name) seatNames.set(i, s.name); });
  const timeline = (await db.prepare('SELECT hand_no, side, score_after, books FROM game_hands WHERE game_id = ? ORDER BY hand_no ASC, side ASC')
    .bind(gameId).all<{ hand_no: number; side: number; score_after: number; books: number }>()).results;
  return {
    game: {
      id: g.id, mode: g.mode, kind: g.kind, endedAt: g.ended_at, hands: g.hands, rated: !!g.rated,
      winners: parse<number[]>(g.winners, []), final: parse<number[]>(g.final, []), seats,
    },
    players: players.map((p) => ({
      userId: p.user_id, name: p.username ?? seatNames.get(p.seat) ?? null, seat: p.seat, side: p.side, won: !!p.won, partnerId: p.partner_id, teamName: p.team_name,
      stats: parse<unknown>(p.stats, {}), eloBefore: p.elo_before, eloAfter: p.elo_after,
    })),
    timeline: timeline.map((t) => ({ hand: t.hand_no, side: t.side, scoreAfter: t.score_after, books: t.books })),
  };
}
