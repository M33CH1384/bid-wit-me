import { describe, expect, it } from 'vitest';
import { makeRules } from '@spades/rules';
import { FakeEnv } from './harness';
import { makeD1 } from './d1';
import { type GameRecord, leaverLoss, saveRecord } from '../src/stats/record';
import { leaderboard, personalStats } from '../src/stats/boards';

const NOW = 1_800_000_000_000;

function ratedTable() {
  const env = new FakeEnv();
  env.join('a', 'Dee');
  env.join('b', 'Ray');
  env.room.linkUser('a', 'ua');
  env.room.linkUser('b', 'ub');
  env.send('a', { t: 'sit', seat: 0 });
  env.send('b', { t: 'sit', seat: 1 });
  env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 500 }) });
  env.send('a', { t: 'start' });
  return env;
}

const zeros = { won: false, hands: 0, bids: 0, bidSum: 0, made: 0, set: 0, bags: 0, nilBids: 0, nilMade: 0, books: 0, shotsTaken: 0, shotsGiven: 0, wheels: 0, bjWins: 0, bidMs: 0, bidN: 0, playMs: 0, playN: 0 };

function rec(id: string, players: GameRecord['players'], seats: GameRecord['seats']): GameRecord {
  return { id, room: 'R', mode: 'joker', kind: 'team', endedAt: NOW, hands: 2, final: [40, 20], winners: [], names: ['Us', 'Them'], seats, players };
}

describe('abandoned online games', () => {
  it('a leave records an abandon and the table keeps playing; a second leave does not write another', () => {
    const env = ratedTable();
    expect(env.room.data.rated).toBe(true);
    env.send('a', { t: 'leave' });
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.seats[0]?.kind).toBe('bot');
    expect(env.records).toHaveLength(1);
    expect(env.records[0]).toMatchObject({ rated: true, meta: { endReason: 'abandoned', leaverId: 'ua' } });
    expect(env.records[0]!.rec.winners).toEqual([]);
    expect(env.records[0]!.rec.players.map((p) => p.uid).sort()).toEqual(['ua', 'ub']);
    expect(env.records[0]!.rec.players.every((p) => p.won === false)).toBe(true);
    expect(env.records[0]!.rec.id.endsWith('-abandoned')).toBe(true);
    env.send('b', { t: 'leave' });
    expect(env.records).toHaveLength(1);
  });

  it('starting over a game in progress is still rejected, and does not record an abandon', () => {
    const env = ratedTable();
    env.send('a', { t: 'start' });
    expect(env.errors('a').some((e) => e.code === 'IN_GAME')).toBe(true);
    expect(env.records).toHaveLength(0);
    expect(env.room.data.phase).toBe('playing');
  });

  it('replacing an unfinished game records the host as the leaver', () => {
    const env = ratedTable();
    (env.room as unknown as { startGame(): void }).startGame();
    expect(env.records).toHaveLength(1);
    expect(env.records[0]!.meta).toMatchObject({ endReason: 'abandoned', leaverId: 'ua' });
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.gamesPlayed).toBe(2);
    expect(env.room.data.abandonReported).toBe(false);
  });

  it('an expired room records the deal with no leaver', () => {
    const env = ratedTable();
    env.room.expire();
    expect(env.records[0]!.meta).toMatchObject({ endReason: 'abandoned', leaverId: null });
    env.room.expire();
    expect(env.records).toHaveLength(1);
  });

  it('a rated leaver drops 20 Elo and takes the loss; everyone else only started the game', async () => {
    const seats: GameRecord['seats'] = [
      { name: 'Dee', side: 0, kind: 'user', uid: 'ua' },
      { name: 'Ray', side: 1, kind: 'user', uid: 'ub' },
      { name: 'Bot', side: 0, kind: 'bot' },
      { name: 'Bot', side: 1, kind: 'bot' },
    ];
    const db = await makeD1();
    await db.prepare("INSERT INTO users (id, username, username_key, created_at) VALUES ('ua', 'Dee', 'dee', 1), ('ub', 'Ray', 'ray', 1)").run();
    const family = 'R-fam';
    const abandoned = rec(`${family}-abandoned`, [
      { seat: 0, uid: 'ua', side: 0, won: false, partner: null, teamName: null, stats: zeros },
      { seat: 1, uid: 'ub', side: 1, won: false, partner: null, teamName: null, stats: zeros },
    ], seats);
    expect(leaverLoss(abandoned, {}, 'ua')).toEqual({ ua: { before: 1200, after: 1180 } });
    await saveRecord(db, abandoned, true, { endReason: 'abandoned', leaverId: 'ua', family });
    await saveRecord(db, abandoned, true, { endReason: 'abandoned', leaverId: 'ua', family });
    expect(await db.prepare("SELECT elo, games FROM ratings WHERE user_id = 'ua'").first()).toEqual({ elo: 1180, games: 1 });
    expect(await db.prepare("SELECT elo FROM ratings WHERE user_id = 'ub'").first()).toBeNull();
    const bye = await personalStats(db, 'ua', 'team');
    expect(bye).toMatchObject({ games: 1, wins: 0, started: 1, streak: 0, gamesVsPlayers: 1, winsVsPlayers: 0 });
    expect(await personalStats(db, 'ub', 'team')).toMatchObject({ games: 0, wins: 0, started: 1 });

    const finished: GameRecord = {
      ...rec(family, [{ seat: 1, uid: 'ub', side: 1, won: true, partner: null, teamName: null, stats: { ...zeros, won: true, hands: 4, bids: 4, made: 3, books: 16 } }], seats),
      winners: [1],
    };
    await saveRecord(db, finished, true, { endReason: 'finished', family });
    expect(await personalStats(db, 'ub', 'team')).toMatchObject({ games: 1, wins: 1, started: 1, accuracy: 75 });
    expect(await personalStats(db, 'ua', 'team')).toMatchObject({ games: 1, wins: 0, started: 1 });
  });

  it('an unrated abandon is a game started and not a loss', async () => {
    const db = await makeD1();
    await db.prepare("INSERT INTO users (id, username, username_key, created_at) VALUES ('ua', 'Dee', 'dee', 1)").run();
    const seats: GameRecord['seats'] = [
      { name: 'Dee', side: 0, kind: 'user', uid: 'ua' },
      { name: 'Ray', side: 1, kind: 'guest' },
      { name: 'Bot', side: 0, kind: 'bot' },
      { name: 'Bot', side: 1, kind: 'bot' },
    ];
    await saveRecord(db, rec('g-abandoned', [
      { seat: 0, uid: 'ua', side: 0, won: false, partner: null, teamName: null, stats: { ...zeros, bids: 9, made: 9 } },
    ], seats), false, { endReason: 'abandoned', leaverId: 'ua', family: 'g' });
    expect(await personalStats(db, 'ua', 'team')).toMatchObject({ games: 0, wins: 0, started: 1, accuracy: null });
    expect(await db.prepare("SELECT elo FROM ratings WHERE user_id = 'ua'").first()).toBeNull();
    expect(await leaderboard(db, { board: 'accuracy', kind: 'team', period: 'month', region: null, now: NOW })).toEqual([]);
    expect(await leaderboard(db, { board: 'wins', kind: 'team', period: 'all', region: null, now: NOW })).toEqual([]);
  });
});
