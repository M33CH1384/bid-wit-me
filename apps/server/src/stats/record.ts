/**
 * Release 9: online game records → per-player stats + Elo. Pure (no Cloudflare imports) so it's unit-tested.
 * Only seats linked to an account (signed-in players) get stats rows; guests and bots appear in the game's seat list.
 */
import { type GameState, sideCount, sideOf } from '@spades/rules';

export type RatingKind = 'team' | 'cutthroat';
export const ELO_START = 1200;
export const ELO_BOT = 1200;

export interface SeatRef { name: string; side: number; kind: 'user' | 'guest' | 'bot'; uid?: string }

/** live per-seat counters the room keeps during a game */
export interface LiveStats { bidMs: number[]; bidN: number[]; playMs: number[]; playN: number[]; bj: number[] }
export const newLiveStats = (n: number): LiveStats => ({ bidMs: Array(n).fill(0), bidN: Array(n).fill(0), playMs: Array(n).fill(0), playN: Array(n).fill(0), bj: Array(n).fill(0) });

export interface PlayerGameStats {
  won: boolean;
  hands: number;
  /** contracts this player bid a number on: made / set; side bags added on those hands */
  bids: number; bidSum: number; made: number; set: number; bags: number;
  nilBids: number; nilMade: number;
  /** books (tricks) this player took */
  books: number;
  /** own side got shot (set) / opponents shot while this player was at the table */
  shotsTaken: number; shotsGiven: number;
  wheels: number;
  /** tricks won with the Big Joker */
  bjWins: number;
  bidMs: number; bidN: number; playMs: number; playN: number;
}

export interface GameRecord {
  id: string;
  room: string;
  mode: string;
  kind: RatingKind;
  endedAt: number;
  hands: number;
  final: number[];
  winners: number[];
  names: string[];
  seats: SeatRef[];
  /** per seat (users only) */
  players: { seat: number; uid: string; side: number; won: boolean; partner: string | null; teamName: string | null; stats: PlayerGameStats }[];
  tournamentId?: string;
}

export function buildRecord(o: { id: string; room: string; game: GameState; seats: SeatRef[]; names: string[]; teamNames?: (string | null)[]; live?: LiveStats; endedAt: number; tournamentId?: string }): GameRecord {
  const g = o.game;
  const r = g.rules;
  const n = r.playerCount;
  const kind: RatingKind = r.partnerships ? 'team' : 'cutthroat';
  const winners = g.result?.winners ?? [];
  const players: GameRecord['players'] = [];
  for (let seat = 0; seat < n; seat++) {
    const ref = o.seats[seat];
    if (!ref || ref.kind !== 'user' || !ref.uid) continue;
    const side = sideOf(seat, r);
    const st: PlayerGameStats = { won: winners.includes(side), hands: g.history.length, bids: 0, bidSum: 0, made: 0, set: 0, bags: 0, nilBids: 0, nilMade: 0, books: 0, shotsTaken: 0, shotsGiven: 0, wheels: 0, bjWins: o.live?.bj[seat] ?? 0, bidMs: o.live?.bidMs[seat] ?? 0, bidN: o.live?.bidN[seat] ?? 0, playMs: o.live?.playMs[seat] ?? 0, playN: o.live?.playN[seat] ?? 0 };
    for (const h of g.history) {
      const b = h.bids[seat];
      st.books += h.tricksWon[seat] ?? 0;
      const mine = h.sides.find((s) => s.side === side);
      if (!mine) continue;
      if (typeof b === 'number') {
        st.bids++; st.bidSum += b;
        if (mine.contractMade === true) st.made++;
        else if (mine.contractMade === false) st.set++;
      } else if (b === 'nil' || b === 'blindNil') {
        st.nilBids++;
        if (mine.nils.find((x) => x.seat === seat)?.made) st.nilMade++;
      }
      // Side bags from scoreHand: overtricks on a make, nil tricks on a set, tricks with no contract.
      // Books hands and "bags off" already store bagsAdded 0, so this matches the score pad.
      st.bags += mine.bagsAdded;
      if (mine.contractMade === false) st.shotsTaken++;
      st.shotsGiven += h.sides.filter((s) => s.side !== side && s.contractMade === false).length;
      const wheel = r.partnerships ? (mine.contract >= 10 && mine.contractMade === true) || (h.bids.every((x) => x === 'books') && mine.tricks >= 10) : mine.tricks >= 10;
      if (wheel) st.wheels++;
    }
    const partnerSeat = r.partnerships ? (seat + 2) % n : -1;
    const p = partnerSeat >= 0 ? o.seats[partnerSeat] : undefined;
    players.push({ seat, uid: ref.uid, side, won: st.won, partner: p?.kind === 'user' && p.uid ? p.uid : null, teamName: r.partnerships ? (o.teamNames?.[side] ?? null) : null, stats: st });
  }
  return {
    id: o.id, room: o.room, mode: r.mode ?? 'joker', kind, endedAt: o.endedAt, hands: g.history.length,
    final: [...(g.result?.finalScores ?? g.scores)], winners: [...winners], names: [...o.names], seats: o.seats, players, ...(o.tournamentId ? { tournamentId: o.tournamentId } : {}),
  };
}

/**
 * Rated for Elo only when signed-in players sit on at least two sides.
 * A guest does not count, and neither do bots. Those games still record stats.
 * Games already stored as rated keep the Elo written at the time; this does not recompute them.
 */
export function isRated(rec: GameRecord, rules: { playerCount: number; partnerships: boolean }): boolean {
  const sides = new Set(rec.seats.filter((s) => s.kind === 'user').map((s) => s.side));
  return rec.players.length > 0 && sides.size >= 2 && rules.playerCount === rec.seats.length;
}

export const kFactor = (games: number) => (games < 10 ? 40 : games < 30 ? 32 : 24);
export const expected = (a: number, b: number) => 1 / (1 + 10 ** ((b - a) / 400));

/**
 * New ratings for the signed-in players. Side strength = mean of its seats (accounts: their rating, guests/bots: 1200).
 * Teams: one opponent side. Cutthroat: every pair of sides by placement, averaged over the n−1 opponents.
 */
export function eloUpdate(rec: GameRecord, placements: number[], current: Record<string, { elo: number; games: number }>): Record<string, { before: number; after: number }> {
  const sides = Math.max(...rec.seats.map((s) => s.side)) + 1;
  const strength = Array.from({ length: sides }, (_, side) => {
    const seats = rec.seats.filter((s) => s.side === side);
    return seats.reduce((t, s) => t + (s.kind === 'user' && s.uid ? (current[s.uid]?.elo ?? ELO_START) : ELO_BOT), 0) / Math.max(1, seats.length);
  });
  const out: Record<string, { before: number; after: number }> = {};
  for (const p of rec.players) {
    const before = current[p.uid]?.elo ?? ELO_START;
    let delta = 0;
    for (let o = 0; o < sides; o++) {
      if (o === p.side) continue;
      const score = placements[p.side]! < placements[o]! ? 1 : placements[p.side] === placements[o] ? 0.5 : 0;
      delta += score - expected(strength[p.side]!, strength[o]!);
    }
    delta /= Math.max(1, sides - 1);
    const after = Math.round((before + kFactor(current[p.uid]?.games ?? 0) * delta) * 10) / 10;
    out[p.uid] = { before, after };
  }
  return out;
}

export function placementsOf(final: number[], winners: number[]): number[] {
  // winners always place 1st (shot-out endings can leave a higher score among the losers)
  return final.map((s, i) => (winners.includes(i) ? 1 : 1 + winners.length + final.filter((o, j) => !winners.includes(j) && o > s).length));
}

export interface SaveMeta {
  /** online (default) or an offline upload */
  source?: 'online' | 'offline';
  /** series backfill without a full hand history */
  partial?: boolean;
  /** idempotency key for an offline upload, already namespaced by user */
  clientGameId?: string | null;
}

/** Write a finished game + Elo to D1 (one batch). */
export async function saveRecord(db: D1Database, rec: GameRecord, rated: boolean, meta: SaveMeta = {}): Promise<void> {
  if (!rec.players.length) return;
  if (await db.prepare('SELECT 1 AS ok FROM games WHERE id = ?').bind(rec.id).first()) return; // already saved (retry)
  const uids = rec.players.map((p) => p.uid);
  const cur: Record<string, { elo: number; games: number; peak: number }> = {};
  const rows = (await db.prepare(`SELECT user_id, elo, games, peak FROM ratings WHERE kind = ? AND user_id IN (${uids.map(() => '?').join(',')})`).bind(rec.kind, ...uids)
    .all<{ user_id: string; elo: number; games: number; peak: number }>()).results;
  for (const r of rows) cur[r.user_id] = { elo: r.elo, games: r.games, peak: r.peak };
  // only accounts that still exist (a player may have deleted their account mid-game)
  const exist = new Set((await db.prepare(`SELECT id FROM users WHERE id IN (${uids.map(() => '?').join(',')})`).bind(...uids).all<{ id: string }>()).results.map((r) => r.id));
  const players = rec.players.filter((p) => exist.has(p.uid));
  if (!players.length) return;
  const elo = rated ? eloUpdate({ ...rec, players }, placementsOf(rec.final, rec.winners), cur) : {};
  const stmts = [
    db.prepare('INSERT OR IGNORE INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, tournament_id, source, client_game_id, partial) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(rec.id, rec.room, rec.mode, rec.kind, rec.endedAt, rec.hands, JSON.stringify(rec.final), JSON.stringify(rec.winners), JSON.stringify(rec.names), JSON.stringify(rec.seats), rated ? 1 : 0, rec.tournamentId ?? null, meta.source ?? 'online', meta.clientGameId ?? null, meta.partial ? 1 : 0),
  ];
  for (const p of players) {
    const e = elo[p.uid];
    stmts.push(db.prepare('INSERT OR IGNORE INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, team_name, ended_at, stats, elo_before, elo_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(rec.id, p.uid, rec.kind, p.seat, p.side, p.won ? 1 : 0, p.partner && exist.has(p.partner) ? p.partner : null, p.teamName, rec.endedAt, JSON.stringify(p.stats), e?.before ?? null, e?.after ?? null));
    if (e) {
      const peak = Math.max(cur[p.uid]?.peak ?? ELO_START, e.after);
      stmts.push(db.prepare(`INSERT INTO ratings (user_id, kind, elo, games, peak, updated_at) VALUES (?, ?, ?, 1, ?, ?)
        ON CONFLICT (user_id, kind) DO UPDATE SET elo = excluded.elo, games = ratings.games + 1, peak = MAX(ratings.peak, excluded.peak), updated_at = excluded.updated_at`).bind(p.uid, rec.kind, e.after, peak, rec.endedAt));
    }
  }
  await db.batch(stmts);
}

export { sideCount };
