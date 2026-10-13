import { describe, expect, it } from 'vitest';
import type { Card } from '@spades/rules';
import { makeRules } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import type { GameAction } from '@spades/protocol';
import { FakeEnv } from './harness';
import { makeD1 } from './d1';
import { type GameRecord, eloUpdate, expected, isRated, placementsOf, saveRecord } from '../src/stats/record';
import { personalStats } from '../src/stats/boards';

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000, handEndHoldMs: 0 };

function playTurn(env: FakeEnv, cids: string[]): boolean {
  for (const cid of cids) {
    const st = env.last(cid, 'state');
    const v = st?.view;
    if (!v || st.room.phase !== 'playing' || st.spectator || st.seat === null) continue;
    if (v.phase === 'handOver') { env.send(cid, { t: 'next' }); continue; }
    if (v.turn !== v.seat) continue;
    const a = chooseBotAction(v, 'normal');
    if (!a) continue;
    const action: GameAction = a.type === 'reveal' ? { type: 'reveal' } : a.type === 'bid' ? { type: 'bid', bid: a.bid } : a.type === 'play' ? { type: 'play', card: a.card } : a.type === 'runIt' ? { type: 'runIt' } : { type: 'exchange', cards: (a as { cards: Card[] }).cards };
    env.advance(400); // think time
    env.send(cid, { t: 'act', action, seq: st.room.seq });
    return true;
  }
  return false;
}

function playOut(env: FakeEnv, cids: string[]) {
  for (let i = 0; i < 20000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, cids)) env.advance(200);
  expect(env.room.data.phase).toBe('over');
}

describe('online game records', () => {
  it('a signed-in seat produces a record with per-player stats; guests/bots are listed but get no row', async () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Dee'); env.join('b', 'Ray');
    env.room.linkUser('a', 'user-dee');
    env.send('a', { t: 'sit', seat: 0 }); env.send('b', { t: 'sit', seat: 1 });
    env.send('a', { t: 'config', rules: makeRules('joker', { targetScore: 200 }) });
    env.send('a', { t: 'start' });
    playOut(env, ['a', 'b']);
    expect(env.records).toHaveLength(1);
    const { rec, rated } = env.records[0]!;
    expect(rated).toBe(false); // a guest on the other side does not make the game rated
    expect(rec.kind).toBe('team');
    expect(rec.seats.map((s) => s.kind)).toEqual(['user', 'guest', 'bot', 'bot']);
    expect(rec.players).toHaveLength(1);
    const p = rec.players[0]!;
    expect(p).toMatchObject({ seat: 0, uid: 'user-dee', side: 0, partner: null });
    expect(p.won).toBe(rec.winners.includes(0));
    expect(p.stats.hands).toBe(rec.hands);
    expect(p.stats.books).toBeGreaterThanOrEqual(0);
    expect(p.stats.bidN + p.stats.playN).toBeGreaterThan(5);
    expect(p.stats.playMs / p.stats.playN).toBeGreaterThan(100);
    // saved to D1 (user must exist)
    const db = await makeD1();
    await db.prepare("INSERT INTO users (id, username, username_key, created_at) VALUES ('user-dee', 'Dee', 'dee', 1)").run();
    await saveRecord(db, rec, rated);
    await saveRecord(db, rec, rated); // idempotent
    expect((await db.prepare('SELECT COUNT(*) AS n FROM game_players').first<{ n: number }>())!.n).toBe(1);
    const row = await db.prepare("SELECT elo_before, elo_after, stats FROM game_players WHERE user_id = 'user-dee'").first<{ elo_before: number | null; elo_after: number | null; stats: string }>();
    expect(row!.elo_before).toBeNull();
    expect(row!.elo_after).toBeNull();
    expect(JSON.parse(row!.stats).hands).toBeGreaterThan(0);
    expect(await db.prepare("SELECT elo FROM ratings WHERE user_id = 'user-dee'").first()).toBeNull();
  });

  it('no record without an account; a bots-only game records stats and a null Elo', async () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Dee');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('cutthroat', { targetScore: 150 }) });
    env.send('a', { t: 'start' });
    playOut(env, ['a']);
    expect(env.records).toHaveLength(0);
    const env2 = new FakeEnv(undefined, FAST);
    env2.join('a', 'Dee');
    env2.room.linkUser('a', 'u1');
    env2.send('a', { t: 'sit', seat: 0 });
    env2.send('a', { t: 'config', rules: makeRules('cutthroat', { targetScore: 150 }) });
    env2.send('a', { t: 'start' });
    playOut(env2, ['a']);
    expect(env2.records[0]!.rated).toBe(false);
    expect(env2.records[0]!.rec.kind).toBe('cutthroat');
    const db = await makeD1();
    await db.prepare("INSERT INTO users (id, username, username_key, created_at) VALUES ('u1', 'M33CH', 'm33ch', 1)").run();
    await db.prepare("INSERT INTO ratings (user_id, kind, elo, games, peak, updated_at) VALUES ('u1', 'cutthroat', 1310, 4, 1310, 1)").run();
    const { rec, rated } = env2.records[0]!;
    await saveRecord(db, rec, rated);
    const row = await db.prepare("SELECT stats, elo_before, elo_after FROM game_players WHERE user_id = 'u1'").first<{ stats: string; elo_before: number | null; elo_after: number | null }>();
    expect(row!.elo_before).toBeNull();
    expect(row!.elo_after).toBeNull();
    const stats = JSON.parse(row!.stats) as { hands: number; bags: number };
    expect(stats.hands).toBeGreaterThan(0);
    expect(typeof stats.bags).toBe('number');
    expect(await db.prepare("SELECT elo, games FROM ratings WHERE user_id = 'u1' AND kind = 'cutthroat'").first()).toEqual({ elo: 1310, games: 4 });
    const cut = await personalStats(db, 'u1', 'cutthroat');
    expect(cut.games).toBe(1);
    expect(cut.gamesVsBots).toBe(1);
    expect(cut.winsVsBots).toBe(cut.wins);
    expect(cut.winsVsPlayers).toBe(0);
    expect(cut.bags).toBe(stats.bags);
    expect((await personalStats(db, 'u1', 'team')).games).toBe(0);
  });

  it('still records a signed-in player who was eliminated before the game ended', () => {
    const env = new FakeEnv(undefined, FAST);
    env.join('a', 'Dee');
    env.room.linkUser('a', 'u1');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'config', rules: makeRules('cutthroat', { playerCount: 4, targetScore: 50, firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    const g = env.room.data.game!;
    g.phase = 'handOver';
    g.eliminated = [true, false, false, false];
    g.scores = [0, 0, 1000, 0];
    env.room.testLoadGame(g);
    expect(env.room.data.seats[0]).toEqual({ kind: 'empty' });
    playOut(env, ['a']);
    expect(env.records).toHaveLength(1);
    expect(env.records[0]!.rated).toBe(false);
    expect(env.records[0]!.rec.kind).toBe('cutthroat');
    expect(env.records[0]!.rec.seats[0]).toMatchObject({ kind: 'user', uid: 'u1' });
    expect(env.records[0]!.rec.players[0]).toMatchObject({ seat: 0, uid: 'u1' });
    expect(env.records[0]!.rec.players[0]!.stats.hands).toBeGreaterThan(0);
  });
});

describe('who counts for Elo', () => {
  const rules = { playerCount: 4, partnerships: true };
  const st = {} as GameRecord['players'][number]['stats'];
  const rec = (seats: GameRecord['seats']): GameRecord => ({
    id: 'x', room: 'R', mode: 'joker', kind: 'team', endedAt: 0, hands: 1, final: [1, 0], winners: [0], names: [], seats,
    players: seats.filter((s) => s.kind === 'user' && s.uid).map((s, i) => ({ seat: i, uid: s.uid!, side: s.side, won: true, partner: null, teamName: null, stats: st })),
  });
  it('requires signed-in players on two sides; guests and same-side partners do not rate', () => {
    const user = (side: number, uid: string, seatKind: GameRecord['seats'][number]['kind'] = 'user'): GameRecord['seats'][number] => ({ name: uid, side, kind: seatKind, ...(seatKind === 'user' ? { uid } : {}) });
    expect(isRated(rec([user(0, 'a'), user(1, 'b'), { name: 'c', side: 0, kind: 'bot' }, { name: 'd', side: 1, kind: 'bot' }]), rules)).toBe(true);
    expect(isRated(rec([user(0, 'a'), { name: 'g', side: 1, kind: 'guest' }, { name: 'c', side: 0, kind: 'bot' }, { name: 'd', side: 1, kind: 'bot' }]), rules)).toBe(false);
    expect(isRated(rec([user(0, 'a'), user(0, 'b'), { name: 'c', side: 1, kind: 'bot' }, { name: 'd', side: 1, kind: 'bot' }]), rules)).toBe(false);
    expect(isRated(rec([{ name: 'a', side: 0, kind: 'bot' }, { name: 'b', side: 1, kind: 'bot' }, { name: 'c', side: 0, kind: 'bot' }, { name: 'd', side: 1, kind: 'bot' }]), rules)).toBe(false);
  });
  it('a rated game writes Elo, and saving it again leaves that Elo alone', async () => {
    const db = await makeD1();
    for (const id of ['a', 'b']) await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(id, id.toUpperCase(), id).run();
    const seats: GameRecord['seats'] = [{ name: 'A', side: 0, kind: 'user', uid: 'a' }, { name: 'B', side: 1, kind: 'user', uid: 'b' }];
    const players = seats.map((s, i) => ({ seat: i, uid: s.uid!, side: s.side, won: s.side === 0, partner: null, teamName: null, stats: st }));
    const game: GameRecord = { id: 'rated-1', room: 'R', mode: 'joker', kind: 'team', endedAt: 5, hands: 1, final: [500, 200], winners: [0], names: [], seats, players };
    expect(isRated(game, { playerCount: 2, partnerships: true })).toBe(true);
    await saveRecord(db, game, true);
    const first = await db.prepare("SELECT elo, games FROM ratings WHERE user_id = 'a' AND kind = 'team'").first<{ elo: number; games: number }>();
    expect(first!.games).toBe(1);
    expect(first!.elo).not.toBe(1200);
    await saveRecord(db, game, true);
    expect(await db.prepare("SELECT elo, games FROM ratings WHERE user_id = 'a' AND kind = 'team'").first()).toEqual(first);
  });
});

describe('Elo', () => {
  const base = (seats: GameRecord['seats'], players: GameRecord['players'], final: number[], winners: number[]): GameRecord =>
    ({ id: 'x', room: 'R', mode: 'joker', kind: 'team', endedAt: 0, hands: 1, final, winners, names: [], seats, players });
  const st = {} as GameRecord['players'][number]['stats'];
  it('team: winners gain what losers lose; upsets pay more', () => {
    const seats: GameRecord['seats'] = [{ name: 'A', side: 0, kind: 'user', uid: 'a' }, { name: 'B', side: 1, kind: 'user', uid: 'b' }, { name: 'C', side: 0, kind: 'user', uid: 'c' }, { name: 'D', side: 1, kind: 'user', uid: 'd' }];
    const players = seats.map((s, i) => ({ seat: i, uid: s.uid!, side: s.side, won: s.side === 0, partner: null, teamName: null, stats: st }));
    const even = eloUpdate(base(seats, players, [500, 200], [0]), [1, 2], {});
    expect(even.a!.after).toBe(1220);
    expect(even.b!.after).toBe(1180);
    const upset = eloUpdate(base(seats, players, [500, 200], [0]), [1, 2], { a: { elo: 1000, games: 50 }, c: { elo: 1000, games: 50 }, b: { elo: 1400, games: 50 }, d: { elo: 1400, games: 50 } });
    expect(upset.a!.after - 1000).toBeGreaterThan(20);
    expect(expected(1200, 1200)).toBe(0.5);
  });
  it('cutthroat: placements against every opponent; shot-out winners place first', () => {
    expect(placementsOf([300, 100, 200], [1])).toEqual([2, 1, 3]);
    expect(placementsOf([300, 300, 100], [0, 1])).toEqual([1, 1, 3]);
    const seats: GameRecord['seats'] = [0, 1, 2, 3].map((i) => ({ name: `P${i}`, side: i, kind: 'user', uid: `p${i}` }));
    const players = seats.map((s, i) => ({ seat: i, uid: s.uid!, side: i, won: i === 0, partner: null, teamName: null, stats: st }));
    const r = eloUpdate({ ...base(seats, players, [400, 300, 200, 100], [0]), kind: 'cutthroat' }, [1, 2, 3, 4], {});
    expect(r.p0!.after).toBeGreaterThan(r.p1!.after);
    expect(r.p1!.after).toBeGreaterThan(1200);
    expect(r.p2!.after).toBeLessThan(1200);
    expect(r.p3!.after).toBeLessThan(r.p2!.after);
  });
});
