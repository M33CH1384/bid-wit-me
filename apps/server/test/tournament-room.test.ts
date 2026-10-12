import { describe, expect, it } from 'vitest';
import { makeRules } from '@spades/rules';
import { FakeEnv } from './harness';
import { DEFAULT_TIMING, TOURNAMENT_EMPTY_GRACE_MS, type TournamentSeat } from '../src/room';

const FAST = { ...DEFAULT_TIMING, botMs: 10, trickPauseMs: 10, dealMs: 10, handOverMs: 50, handEndHoldMs: 0 };
const R = (u: string) => ({ uid: u, name: u.toUpperCase() });

function setup(reserved: TournamentSeat['reserved'], bots = true, rules = makeRules('joker', { targetScore: 100 })) {
  const env = new FakeEnv(undefined, FAST);
  env.room.setupTournament({ id: 't1', match: 'm1', reserved, autostartAt: env.t + 60_000, bots }, rules);
  return env;
}
function enter(env: FakeEnv, cid: string, uid: string) {
  const j = env.join(cid, uid.toUpperCase());
  env.room.linkUser(cid, uid);
  return j;
}

describe('tournament tables', () => {
  it('entrants land in their reserved seats and the match starts when all are in', () => {
    const env = setup([R('a'), R('b'), R('c'), R('d')]);
    enter(env, 'c3', 'c');
    enter(env, 'c1', 'a');
    expect(env.room.data.seats[2]).toMatchObject({ kind: 'human' });
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human' });
    expect(env.room.data.phase).toBe('lobby');
    enter(env, 'c2', 'b');
    // a stranger can't take d's seat
    const s = env.join('cx', 'Stranger');
    env.send('cx', { t: 'sit', seat: 3 } as never);
    expect(env.room.data.seats[3]?.kind).toBe('empty');
    void s;
    enter(env, 'c4', 'd');
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.seats.every((x) => x.kind === 'human')).toBe(true);
  });

  it('no-shows get bots at the deadline; kicks, rule changes and early starts are locked', () => {
    const env = setup([R('a'), R('b'), R('c'), R('d')]);
    enter(env, 'c1', 'a');
    env.send('c1', { t: 'start' } as never);
    expect(env.errors('c1').at(-1)?.code).toBe('WAITING');
    env.send('c1', { t: 'kick', seat: 0 } as never);
    expect(env.errors('c1').at(-1)?.code).toBe('LOCKED');
    env.advance(61_000);
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.seats.filter((x) => x.kind === 'bot')).toHaveLength(3);
    expect(env.last('c1', 'state')?.room.tournament?.match).toBe('m1');
  });

  it('bots off: an absent side forfeits', () => {
    const env = setup([R('a'), R('b'), R('c'), R('d')], false);
    enter(env, 'c1', 'a');
    env.advance(61_000);
    expect(env.room.data.phase).toBe('over');
    expect(env.tourResults).toEqual([{ match: 'm1', scores: [0, 0], places: [1, 2] }]);
  });

  it('nobody shows: bots play it out at once and a result is reported', () => {
    const env = setup([R('a'), R('b'), R('c'), R('d')]);
    env.advance(61_000);
    expect(env.room.data.phase).toBe('over');
    expect(env.tourResults).toHaveLength(1);
    expect([...env.tourResults[0]!.places].sort()).toEqual([1, 2]);
  });

  it('everyone leaves mid-match: frozen during the grace period, then played out', () => {
    const env = setup([R('a'), R('b'), R('c'), R('d')]);
    enter(env, 'c1', 'a');
    env.advance(61_000);
    expect(env.room.data.phase).toBe('playing');
    env.room.close('c1');
    env.advance(TOURNAMENT_EMPTY_GRACE_MS - 5_000);
    expect(env.room.data.phase).toBe('playing');
    expect(env.tourResults).toHaveLength(0);
    for (let i = 0; i < 60 && env.room.data.phase === 'playing'; i++) env.advance(1000);
    expect(env.room.data.phase).toBe('over');
    expect(env.tourResults).toHaveLength(1);
  });

  it('solo Cutthroat seats each entrant in their own seat and reports per-seat places', () => {
    const env = setup([R('a'), R('b'), R('c'), null], true, makeRules('cutthroat', { playerCount: 4, targetScore: 100 }));
    enter(env, 'c1', 'a'); enter(env, 'c2', 'b'); enter(env, 'c3', 'c');
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.seats[3]?.kind).toBe('bot');
  });
});
