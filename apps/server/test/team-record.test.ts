/**
 * Team records on the public profile (owner, 2026-11-04): "I should be able
 * to tap a team name and see the teams stats for that team." profileFor now
 * carries a `teams` entry per teamNames chip, computed from the player's
 * real recorded games under that name (game_players.team_name) — games,
 * W–L, streaks and the side's recorded performance, plus who the partner
 * was. A name with no recorded games gets an honest zero entry, never
 * invented numbers.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { profileFor } from '../src/social/routes';
import { saveRecord, type GameRecord, type PlayerGameStats, type SeatRef } from '../src/stats/record';

let db: D1Database;
const T = 1_800_000_000_000;

const stats = (o: Partial<PlayerGameStats> = {}): PlayerGameStats => ({
  won: false, hands: 5, bids: 0, bidSum: 0, made: 0, set: 0, bags: 0, nilBids: 0, nilMade: 0, blindNilMade: 0,
  books: 0, maxBooksHand: 0, bestRun: 0, tableRuns: 0, maxDeficit: 0, foeEliminated: false, runItClaims: 0,
  shotsTaken: 0, shotsGiven: 0, wheels: 0, bjWins: 0, bidMs: 0, bidN: 0, playMs: 0, playN: 0, ...o,
});

async function user(id: string, username: string, avatar: string | null = null) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at, avatar) VALUES (?, ?, ?, ?, ?)')
    .bind(id, username, username.toLowerCase(), 1, avatar).run();
}

/** ua + uc (both signed in) vs ub + a bot, playing as `teamName` on side 0. */
function duoGame(id: string, at: number, won: boolean, teamName: string, uaStats: Partial<PlayerGameStats>, ucStats: Partial<PlayerGameStats>): GameRecord {
  const seats: SeatRef[] = [
    { name: 'Alice', side: 0, kind: 'user', uid: 'ua' },
    { name: 'Bobby', side: 1, kind: 'user', uid: 'ub' },
    { name: 'Cee', side: 0, kind: 'user', uid: 'uc' },
    { name: 'Bot', side: 1, kind: 'bot' },
  ];
  return {
    id, room: 'R', mode: 'joker', kind: 'team', endedAt: at, hands: 5,
    final: won ? [500, 300] : [300, 500], winners: [won ? 0 : 1],
    names: [teamName, 'B'], seats,
    players: [
      { seat: 0, uid: 'ua', side: 0, won, partner: 'uc', teamName, stats: stats({ ...uaStats, won }) },
      { seat: 1, uid: 'ub', side: 1, won: !won, partner: null, teamName: null, stats: stats({ won: !won }) },
      { seat: 2, uid: 'uc', side: 0, won, partner: 'ua', teamName, stats: stats({ ...ucStats, won }) },
    ],
  };
}

/** ua + a bot partner (Dee), claimed from the device while signed in. */
function botGame(id: string, at: number, won: boolean, teamName: string, uaStats: Partial<PlayerGameStats>): GameRecord {
  const seats: SeatRef[] = [
    { name: 'Alice', side: 0, kind: 'user', uid: 'ua' },
    { name: 'Bot A', side: 1, kind: 'bot' },
    { name: 'Dee', side: 0, kind: 'bot' },
    { name: 'Bot B', side: 1, kind: 'bot' },
  ];
  return {
    id, room: 'offline', mode: 'joker', kind: 'team', endedAt: at, hands: 5,
    final: won ? [500, 300] : [300, 500], winners: [won ? 0 : 1],
    names: [teamName, 'Bots'], seats,
    players: [{ seat: 0, uid: 'ua', side: 0, won, partner: null, teamName, stats: stats({ ...uaStats, won }) }],
  };
}

beforeEach(async () => {
  db = await makeD1();
  await user('ua', 'Alice');
  await user('ub', 'Bobby');
  await user('uc', 'Cee', 'data:image/png;base64,CEE');
});

describe('profile team records', () => {
  it('aggregates a signed-in duo under their team name (side rows, partner identity)', async () => {
    await saveRecord(db, duoGame('g1', T, true, 'Book Bandits',
      { bids: 4, made: 4, books: 14, hands: 5, nilBids: 1, nilMade: 1, wheels: 1 },
      { bids: 4, made: 2, books: 12, hands: 5 }), true);
    await saveRecord(db, duoGame('g2', T + 1000, false, 'Book Bandits',
      { bids: 2, made: 1, books: 10, hands: 5 },
      { bids: 2, made: 2, books: 11, hands: 5 }), true);
    await saveRecord(db, duoGame('g3', T + 2000, true, 'Book Bandits',
      { bids: 2, made: 2, books: 13, hands: 5, nilBids: 1 },
      { bids: 2, made: 1, books: 12, hands: 5 }), true);
    const p = (await profileFor(db, 'alice', null))!;
    expect(p.teamNames).toEqual(['Book Bandits']);
    const t = p.teams.find((x) => x.name === 'Book Bandits')!;
    expect(t).toMatchObject({ games: 3, wins: 2, losses: 1, winPct: 66.7, streak: 1, bestStreak: 1 });
    // side aggregate: bids 16, made 12 → 75; books 72 over 30 hands → 2.4; nils 1/2; wheels 1
    expect(t).toMatchObject({ accuracy: 75, booksPerHand: 2.4, nil: '1/2', wheels: 1, recorded: 'side' });
    expect(t.partner).toEqual({ id: 'u:uc', name: 'Cee', avatar: 'data:image/png;base64,CEE', games: 3 });
    expect(t.others).toEqual([]);
  });

  it('a bot pairing records the subject only, names the bot from the seats, and says so', async () => {
    await saveRecord(db, botGame('h1', T, true, 'Homies',
      { bids: 3, made: 3, books: 15, hands: 6, nilBids: 1, nilMade: 1 }), false, { source: 'offline' });
    await saveRecord(db, botGame('h2', T + 1000, false, 'Homies',
      { bids: 3, made: 1, books: 9, hands: 6 }), false, { source: 'offline' });
    const p = (await profileFor(db, 'alice', null))!;
    const t = p.teams.find((x) => x.name === 'Homies')!;
    expect(t).toMatchObject({ games: 2, wins: 1, losses: 1, winPct: 50, streak: 0, bestStreak: 1 });
    expect(t).toMatchObject({ accuracy: 66.7, booksPerHand: 2, nil: '1/1', recorded: 'self' });
    expect(t.partner).toEqual({ name: 'Dee', bot: true, games: 2 });
  });

  it('a legacy name with no recorded games gets an honest zero entry, in teamNames order', async () => {
    await saveRecord(db, botGame('h1', T, true, 'Homies', { bids: 1, made: 1, books: 5, hands: 5 }), false, { source: 'offline' });
    await db.prepare('INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, ?)')
      .bind('ua', JSON.stringify({ v: 1, badges: [], series: null, teamName: 'Old Crew', teamNames: {} }), T).run();
    const p = (await profileFor(db, 'alice', null))!;
    expect(p.teamNames).toEqual(['Old Crew', 'Homies']);
    expect(p.teams.map((t) => t.name)).toEqual(p.teamNames);
    const zero = p.teams.find((t) => t.name === 'Old Crew')!;
    expect(zero).toMatchObject({ games: 0, wins: 0, losses: 0, winPct: null, accuracy: null, booksPerHand: null, partner: null });
  });

  it('a name shared with two partners names the main one and lists the other', async () => {
    await saveRecord(db, duoGame('d1', T, true, 'Duo Flex', { bids: 1, made: 1 }, { bids: 1, made: 1 }), true);
    // ua + ub as partners under the same name (ub seats side 0 with ua)
    const seats: SeatRef[] = [
      { name: 'Alice', side: 0, kind: 'user', uid: 'ua' },
      { name: 'Cee', side: 1, kind: 'user', uid: 'uc' },
      { name: 'Bobby', side: 0, kind: 'user', uid: 'ub' },
      { name: 'Bot', side: 1, kind: 'bot' },
    ];
    const flex = (id: string, at: number, won: boolean): GameRecord => ({
      id, room: 'R', mode: 'joker', kind: 'team', endedAt: at, hands: 5,
      final: won ? [500, 300] : [300, 500], winners: [won ? 0 : 1], names: ['Duo Flex', 'B'], seats,
      players: [
        { seat: 0, uid: 'ua', side: 0, won, partner: 'ub', teamName: 'Duo Flex', stats: stats({ won, bids: 1, made: 1 }) },
        { seat: 1, uid: 'uc', side: 1, won: !won, partner: null, teamName: null, stats: stats({ won: !won }) },
        { seat: 2, uid: 'ub', side: 0, won, partner: 'ua', teamName: 'Duo Flex', stats: stats({ won, bids: 1, made: 0 }) },
      ],
    });
    await saveRecord(db, flex('d2', T + 1000, true), true);
    await saveRecord(db, flex('d3', T + 2000, false), true);
    const p = (await profileFor(db, 'alice', null))!;
    const t = p.teams.find((x) => x.name === 'Duo Flex')!;
    expect(t).toMatchObject({ games: 3, wins: 2, losses: 1 });
    expect(t.partner).toMatchObject({ id: 'u:ub', name: 'Bobby', games: 2 });
    expect(t.others).toEqual([{ name: 'Cee', games: 1 }]);
  });

  it("another player's profile carries their own team records (public, same code path)", async () => {
    await saveRecord(db, duoGame('g1', T, true, 'Book Bandits', { bids: 2, made: 2 }, { bids: 2, made: 1 }), true);
    const p = (await profileFor(db, 'cee', null))!;
    const t = p.teams.find((x) => x.name === 'Book Bandits')!;
    expect(t).toMatchObject({ games: 1, wins: 1, losses: 0 });
    expect(t.partner).toMatchObject({ id: 'u:ua', name: 'Alice', games: 1 });
  });
});
