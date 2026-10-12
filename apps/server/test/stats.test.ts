import { describe, expect, it } from 'vitest';
import type { Card } from '@spades/rules';
import { makeRules } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import type { GameAction } from '@spades/protocol';
import { FakeEnv } from './harness';
import { makeD1 } from './d1';
import { type GameRecord, eloUpdate, expected, placementsOf, saveRecord } from '../src/stats/record';

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000, handEndHoldMs: 0 };

function playTurn(env: FakeEnv, cids: string[]): boolean {
  for (const cid of cids) {
    const st = env.last(cid, 'state');
    const v = st?.view;
    if (!v || st.room.phase !== 'playing') continue;
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
    expect(rated).toBe(true); // a guest human on the other side
    expect(rec.kind).toBe('team');
    expect(rec.seats.map((s) => s.kind)).toEqual(['user', 'guest', 'bot', 'bot']);
    expect(rec.players).toHaveLength(1);
    const p = rec.players[0]!;
    expect(p).toMatchObject({ seat: 0, uid: 'user-dee', side: 0, partner: null });
    expect(p.won).toBe(rec.winners.includes(0));
    expect(p.stats.hands).toBe(rec.hands);
    expect(p.stats.books).toBeGreaterThan(0);
    expect(p.stats.bidN + p.stats.playN).toBeGreaterThan(5);
    expect(p.stats.playMs / p.stats.playN).toBeGreaterThan(100);
    // saved to D1 (user must exist)
    const db = await makeD1();
    await db.prepare("INSERT INTO users (id, username, username_key, created_at) VALUES ('user-dee', 'Dee', 'dee', 1)").run();
    await saveRecord(db, rec, rated);
    await saveRecord(db, rec, rated); // idempotent
    expect((await db.prepare('SELECT COUNT(*) AS n FROM game_players').first<{ n: number }>())!.n).toBe(1);
    const r = await db.prepare("SELECT elo, games FROM ratings WHERE user_id = 'user-dee' AND kind = 'team'").first<{ elo: number; games: number }>();
    expect(r!.games).toBe(1);
    expect(r!.elo === 1200).toBe(false);
  });

  it('no record without an account; bots-only opponents are unrated', () => {
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
