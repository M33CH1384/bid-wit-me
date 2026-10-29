/**
 * GET /api/profile/pair/:id (2026-10-23): the caller's OWN established-team
 * record with one other player, computed from real recorded games
 * (game_players.partner_id). Caller-scoped: it can only ever answer for the
 * signed-in player, and games played AGAINST someone never count as games
 * played WITH them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { handleCredHttp } from '../src/cred/routes';
import { saveRecord, type GameRecord, type PlayerGameStats, type SeatRef } from '../src/stats/record';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';

const stats = (o: Partial<PlayerGameStats> = {}): PlayerGameStats => ({
  won: false, hands: 4, bids: 4, bidSum: 12, made: 3, set: 1, bags: 2, nilBids: 0, nilMade: 0, blindNilMade: 0,
  books: 12, maxBooksHand: 5, bestRun: 0, tableRuns: 0, maxDeficit: 0, foeEliminated: false, runItClaims: 0,
  shotsTaken: 1, shotsGiven: 2, wheels: 0, bjWins: 0, bidMs: 8000, bidN: 4, playMs: 20000, playN: 40, ...o,
});
const SEATS: SeatRef[] = [
  { name: 'A', side: 0, kind: 'user', uid: 'a' },
  { name: 'B', side: 0, kind: 'user', uid: 'b' },
  { name: 'C', side: 1, kind: 'user', uid: 'c' },
  { name: 'D', side: 1, kind: 'user', uid: 'd' },
];
function rec(id: string, wonSide: number, at = NOW): GameRecord {
  return {
    id, room: 'R', mode: 'joker', kind: 'team', endedAt: at, hands: 4,
    final: wonSide === 0 ? [100, 50] : [50, 100], winners: [wonSide],
    names: ['A', 'B', 'C', 'D'], seats: SEATS,
    players: SEATS.map((s, seat) => ({
      seat, uid: s.uid!, side: s.side, won: s.side === wonSide, partner: s.side === 0 ? (s.uid === 'a' ? 'b' : 'a') : (s.uid === 'c' ? 'd' : 'c'),
      teamName: null, stats: { ...stats(), won: s.side === wonSide },
    })),
  };
}
async function user(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id, 1).run();
}
async function session(uid: string, tok = `${uid}-tok`) {
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), uid, 1, NOW + 10_000_000).run();
  return tok;
}
const call = (tok: string | null, path: string) =>
  handleCredHttp(
    new Request(new URL(path, ORIGIN), tok ? { headers: { cookie: `__Host-bwm_sid=${tok}` } } : {}),
    { DB: db, PUBLIC_ORIGIN: ORIGIN } as never,
    new URL(path, ORIGIN), path.split('/').filter(Boolean), NOW,
  );

beforeEach(async () => {
  db = await makeD1();
  for (const u of ['a', 'b', 'c', 'd']) await user(u);
});

describe('pair record endpoint', () => {
  it('requires sign-in', async () => {
    const res = await call(null, '/api/profile/pair/b');
    expect(res.status).toBe(401);
  });

  it('no shared games is an honest zero record (not an error)', async () => {
    const tok = await session('a');
    const res = await call(tok, '/api/profile/pair/b');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ games: 0, wins: 0, losses: 0, streak: 0 });
  });

  it('computes games/wins/losses and the signed current streak from real rows, newest first', async () => {
    await saveRecord(db, rec('g1', 0, NOW - 4000), true);  // a+b win
    await saveRecord(db, rec('g2', 0, NOW - 3000), true);  // a+b win
    await saveRecord(db, rec('g3', 1, NOW - 2000), true);  // a+b lose (opponents' side won)
    const tok = await session('a');
    expect(await (await call(tok, '/api/profile/pair/b')).json()).toEqual({ games: 3, wins: 2, losses: 1, streak: -1 });
    await saveRecord(db, rec('g4', 0, NOW - 1000), true);  // a+b win again → streak flips to +1
    expect(await (await call(tok, '/api/profile/pair/b')).json()).toEqual({ games: 4, wins: 3, losses: 1, streak: 1 });
    await saveRecord(db, rec('g5', 0, NOW - 500), true);
    await saveRecord(db, rec('g6', 0, NOW - 100), true);
    expect(await (await call(tok, '/api/profile/pair/b')).json()).toEqual({ games: 6, wins: 5, losses: 1, streak: 3 });
  });

  it('games AGAINST a player never count as games WITH them', async () => {
    await saveRecord(db, rec('g1', 0, NOW - 1000), true); // a+b vs c+d — a played c, but not WITH c
    const tokA = await session('a');
    expect(await (await call(tokA, '/api/profile/pair/c')).json()).toEqual({ games: 0, wins: 0, losses: 0, streak: 0 });
    // while the actual pairs see their shared game
    const tokC = await session('c');
    expect(await (await call(tokC, '/api/profile/pair/d')).json()).toEqual({ games: 1, wins: 0, losses: 1, streak: -1 });
    expect(await (await call(tokA, '/api/profile/pair/b')).json()).toEqual({ games: 1, wins: 1, losses: 0, streak: 1 });
  });

  it('is symmetric and caller-scoped: the partner reads the same record from their side', async () => {
    await saveRecord(db, rec('g1', 0, NOW - 2000), true);
    await saveRecord(db, rec('g2', 1, NOW - 1000), true);
    const tokB = await session('b');
    expect(await (await call(tokB, '/api/profile/pair/a')).json()).toEqual({ games: 2, wins: 1, losses: 1, streak: -1 });
  });

  it('asking about yourself is a zero record, and unknown players are a zero record', async () => {
    await saveRecord(db, rec('g1', 0, NOW - 1000), true);
    const tok = await session('a');
    expect(await (await call(tok, '/api/profile/pair/a')).json()).toEqual({ games: 0, wins: 0, losses: 0, streak: 0 });
    expect(await (await call(tok, '/api/profile/pair/zzz')).json()).toEqual({ games: 0, wins: 0, losses: 0, streak: 0 });
  });
});
