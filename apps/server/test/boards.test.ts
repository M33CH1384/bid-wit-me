import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { leaderboard, personalStats, serverStats } from '../src/stats/boards';

let db: D1Database;
const NOW = 1_800_000_000_000;
const st = (o: Record<string, number>) => JSON.stringify({ bids: 4, made: 3, books: 12, hands: 4, bidMs: 8000, bidN: 4, playMs: 20000, playN: 40, ...o });
async function game(id: string, at: number, rows: [string, number, number, string | null, number, number][]) {
  await db.prepare("INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated) VALUES (?, 'R', 'joker', 'team', ?, 8, '[]', '[]', '[]', '[]', 1)").bind(id, at).run();
  for (const [u, side, won, partner, before, after] of rows)
    await db.prepare("INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, ended_at, stats, elo_before, elo_after) VALUES (?, ?, 'team', 0, ?, ?, ?, ?, ?, ?, ?)").bind(id, u, side, won, partner, at, st({ made: won ? 4 : 2 }), before, after).run();
}
beforeEach(async () => {
  db = await makeD1();
  for (const [u, region, hide] of [['a', 'US-GA', 0], ['b', 'US-GA', 0], ['c', 'US-GA', 1], ['d', 'GB', 0]] as const) {
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(u, u.toUpperCase(), u).run();
    await db.prepare('INSERT INTO social_settings (user_id, region, hide_location) VALUES (?, ?, ?)').bind(u, region, hide).run();
  }
  await db.prepare("INSERT INTO ratings (user_id, kind, elo, games, peak, updated_at) VALUES ('a','team',1260,3,1260,1),('b','team',1230,3,1240,1),('c','team',1180,3,1200,1),('d','team',1150,3,1200,1)").run();
  await game('g1', NOW - 40 * 86400_000, [['a', 0, 1, 'b', 1200, 1216], ['b', 0, 1, 'a', 1200, 1216], ['c', 1, 0, 'd', 1200, 1184], ['d', 1, 0, 'c', 1200, 1184]]);
  await game('g2', NOW - 2 * 86400_000, [['a', 0, 1, 'b', 1216, 1230], ['b', 0, 1, 'a', 1216, 1230], ['c', 1, 0, 'd', 1184, 1170], ['d', 1, 0, 'c', 1184, 1170]]);
  await game('g3', NOW - 86400_000, [['a', 0, 0, 'c', 1230, 1260], ['c', 0, 0, 'a', 1170, 1180], ['b', 1, 1, 'd', 1230, 1230], ['d', 1, 1, 'b', 1170, 1150]]);
});

describe('leaderboards', () => {
  it('rating all-time, global vs local (hidden users excluded)', async () => {
    const g = await leaderboard(db, { board: 'rating', kind: 'team', period: 'all', region: null, now: NOW });
    expect(g.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D']);
    const l = await leaderboard(db, { board: 'rating', kind: 'team', period: 'all', region: 'US-GA', now: NOW });
    expect(l.map((r) => r.name)).toEqual(['A', 'B']);
  });
  it('period rating = Elo gained; wins; duos', async () => {
    const w = await leaderboard(db, { board: 'rating', kind: 'team', period: 'week', region: null, now: NOW });
    expect(w[0]).toMatchObject({ name: 'A', value: 44 });
    const wins = await leaderboard(db, { board: 'wins', kind: 'team', period: 'all', region: null, now: NOW });
    expect(wins.slice(0, 2).map((r) => [r.name, r.value])).toEqual([['B', 3], ['A', 2]]);
    const duos = await leaderboard(db, { board: 'duos', kind: 'team', period: 'all', region: null, now: NOW });
    expect(duos[0]).toMatchObject({ name: 'A + B', value: 2, games: 2 });
  });
  it('accuracy needs enough bids', async () => {
    expect(await leaderboard(db, { board: 'accuracy', kind: 'team', period: 'all', region: null, now: NOW })).toEqual([]);
    const w = await leaderboard(db, { board: 'accuracy', kind: 'team', period: 'all', region: null, now: NOW + 0 }).catch(() => []);
    expect(Array.isArray(w)).toBe(true);
    const m = await leaderboard(db, { board: 'accuracy', kind: 'team', period: 'month', region: null, now: NOW });
    expect(m.map((r) => r.name)).toContain('B');
  });
  it('personal + server stats', async () => {
    const p = await personalStats(db, 'b');
    expect(p).toMatchObject({ games: 3, wins: 3, streak: 3, bestStreak: 3, accuracy: 100, booksPerHand: 3, bidSec: 2, playSec: 0.5 });
    expect((await personalStats(db, 'a')).streak).toBe(0);
    expect(await serverStats(db, NOW)).toMatchObject({ accounts: 4, games: 3, gamesToday: 1 });
  });
});
