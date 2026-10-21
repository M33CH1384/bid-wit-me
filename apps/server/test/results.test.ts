/**
 * Recent-results feed (league data wave, item 1): the read side over the
 * games rows saveRecord already writes. Pins the honest scope: finished
 * ONLINE games only (no abandoned, no offline uploads, no partial series
 * rows), at least two signed-in players on different sides, and the Wheels
 * flag sourced from the stored per-player stat JSON — never reconstructed.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { recentResults } from '../src/stats/results';

let db: D1Database;
const NOW = 1_800_000_000_000;

const seats = (list: [string, number, string, string?][]): string =>
  JSON.stringify(list.map(([name, side, kind, uid]) => ({ name, side, kind, ...(uid ? { uid } : {}) })));
const TEAM = seats([['Alpha', 0, 'user', 'a'], ['Bravo', 0, 'user', 'b'], ['Char', 1, 'user', 'c'], ['Delta', 1, 'user', 'd']]);
const CUT = seats([['Alpha', 0, 'user', 'a'], ['Bravo', 1, 'user', 'b'], ['Botty', 2, 'bot'], ['Delta', 3, 'user', 'd']]);
const SOLO = seats([['Alpha', 0, 'user', 'a'], ['Bravo', 0, 'user', 'b'], ['Botty', 1, 'bot'], ['Robo', 1, 'bot']]);

async function game(id: string, at: number, o: {
  kind?: string; mode?: string; final?: number[]; winners?: number[]; seats?: string;
  source?: string; endReason?: string; partial?: number; stats?: Record<string, Record<string, number>>;
} = {}) {
  await db.prepare(`INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, source, partial, end_reason)
    VALUES (?, 'TBL1', ?, ?, ?, 9, ?, ?, '[]', ?, 1, ?, ?, ?)`)
    .bind(id, o.mode ?? (o.kind === 'cutthroat' ? 'cutthroat' : 'joker'), o.kind ?? 'team', at,
      JSON.stringify(o.final ?? [500, 320]), JSON.stringify(o.winners ?? [0]), o.seats ?? TEAM,
      o.source ?? 'online', o.partial ?? 0, o.endReason ?? 'finished').run();
  for (const [uid, st] of Object.entries(o.stats ?? {})) {
    await db.prepare(`INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, ended_at, stats, elo_before, elo_after)
      VALUES (?, ?, ?, 0, 0, 0, NULL, ?, ?, NULL, NULL)`)
      .bind(id, uid, o.kind ?? 'team', at, JSON.stringify({ bids: 4, made: 3, books: 30, hands: 9, wheels: 0, maxBooksHand: 6, ...st })).run();
  }
}

beforeEach(async () => {
  db = await makeD1();
  for (const u of ['a', 'b', 'c', 'd']) {
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(u, u.toUpperCase(), u).run();
  }
});

describe('recentResults', () => {
  it('shapes a finished team game: sides in order, winners flagged, score kept', async () => {
    await game('g1', NOW - 60_000);
    const [r] = await recentResults(db, 10);
    expect(r).toMatchObject({ id: 'g1', kind: 'team', mode: 'joker', code: 'TBL1', wheels: false });
    expect(r!.sides).toEqual([
      { names: ['Alpha', 'Bravo'], score: 500, won: true },
      { names: ['Char', 'Delta'], score: 320, won: false },
    ]);
  });

  it('newest first, limit respected', async () => {
    await game('g1', NOW - 3000);
    await game('g2', NOW - 2000);
    await game('g3', NOW - 1000);
    expect((await recentResults(db, 2)).map((r) => r.id)).toEqual(['g3', 'g2']);
  });

  it('excludes abandoned, offline, partial and one-human-side games', async () => {
    await game('ok', NOW - 500);
    await game('aban', NOW - 400, { endReason: 'abandoned' });
    await game('offl', NOW - 300, { source: 'offline' });
    await game('part', NOW - 200, { partial: 1 });
    await game('solo', NOW - 100, { seats: SOLO });
    expect((await recentResults(db, 10)).map((r) => r.id)).toEqual(['ok']);
  });

  it('cutthroat: every side listed, the winning side flagged', async () => {
    await game('gc', NOW, { kind: 'cutthroat', mode: 'cutthroat', seats: CUT, final: [210, 500, 150, 320], winners: [1] });
    const [r] = await recentResults(db, 10);
    expect(r!.kind).toBe('cutthroat');
    expect(r!.sides.map((s) => [s.names.join('+'), s.score, s.won])).toEqual([
      ['Alpha', 210, false], ['Bravo', 500, true], ['Botty', 150, false], ['Delta', 320, false],
    ]);
  });

  it('wheels flag comes from the stored per-player stats', async () => {
    await game('gw', NOW, { stats: { a: { wheels: 1 } } });
    await game('gn', NOW - 1000, { stats: { a: { wheels: 0 } } });
    const rows = await recentResults(db, 10);
    expect(rows.find((r) => r.id === 'gw')!.wheels).toBe(true);
    expect(rows.find((r) => r.id === 'gn')!.wheels).toBe(false);
  });

  it('empty when nothing real has finished', async () => {
    expect(await recentResults(db, 10)).toEqual([]);
  });
});
