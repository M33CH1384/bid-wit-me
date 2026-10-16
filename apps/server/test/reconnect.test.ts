import { describe, expect, it } from 'vitest';
import type { GameState } from '@spades/rules';
import { dispatchTableMessage } from '../src/dispatch';
import { FakeEnv } from './harness';

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

/** Seat 0 to play the ace of spades, with three other seats holding off-suit cards. */
function pinLead(env: FakeEnv): void {
  const d = env.room.data;
  const g = d.game!;
  d.game = {
    ...g, phase: 'playing',
    hands: [['AS', 'KS'], ['3C', '4C'], ['5D', '6D'], ['7H', '8H']],
    bids: [1, 1, 1, 1], tricks: [], tricksWon: [0, 0, 0, 0], turn: 0,
    trick: { leader: 0, plays: [], winner: null }, spadesBroken: true,
  } as GameState;
  d.seq = (d.seq ?? 0) + 1;
  d.turnKey = null;
  d.deadline = null;
  env.room.tick();
}

function seated(name = 'Meech') {
  const env = new FakeEnv(undefined, FAST);
  const a = env.join('a', name, undefined, undefined, 'guestmeech000000000001');
  env.join('b', 'Imani');
  env.send('a', { t: 'sit', seat: 0 });
  env.send('b', { t: 'sit', seat: 2 });
  env.send('a', { t: 'addBot', seat: 1 });
  env.send('a', { t: 'addBot', seat: 3 });
  env.send('a', { t: 'start' });
  pinLead(env);
  return { env, a };
}

describe('reconnect keeps the seat and the name', () => {
  it('a reload mid-turn, then a play, keeps the seat and the name', () => {
    const { env, a } = seated();
    env.room.close('a');
    env.advance(1000);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    const again = env.join('z', 'Auntie Pat', a.token);
    expect(again.pid).toBe(a.pid);
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
    const st = env.last('z', 'state')!;
    expect(st.seat).toBe(0);
    expect(st.spectator).toBeUndefined();
    env.send('z', { t: 'act', id: 'reload-play', action: { type: 'play', card: 'AS' }, seq: env.room.data.seq });
    expect(env.room.data.game!.trick.plays.map((p) => ({ seat: p.seat, card: p.card }))).toEqual([{ seat: 0, card: 'AS' }]);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
    expect(env.last('z', 'state')!.spectator).toBeUndefined();
    expect(env.last('z', 'state')!.seat).toBe(0);
  });

  it('a second socket for the same player does not drop the seat when the old socket closes', () => {
    const { env, a } = seated();
    let reentered = false;
    env.onClose = (cid) => {
      if (cid !== 'a' || reentered) return;
      reentered = true;
      // The Durable Object restores the dying socket's player id, then close() runs again.
      env.room.restoreConnection('a', a.pid);
      env.room.close('a');
    };
    const again = env.join('z', 'Auntie Pat', a.token);
    expect(reentered).toBe(true);
    expect(again.pid).toBe(a.pid);
    expect(Object.values(env.room.data.members).filter((m) => m.token === a.token)).toHaveLength(1);
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    expect(env.last('z', 'state')!.spectator).toBeUndefined();
    env.send('z', { t: 'act', id: 'dup-play', action: { type: 'play', card: 'AS' }, seq: env.room.data.seq });
    expect(env.room.data.game!.trick.plays.map((p) => p.card)).toEqual(['AS']);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
  });

  it('a new seat token with the same guest id reclaims the seat and keeps the name', () => {
    const { env, a } = seated();
    env.room.close('a');
    const again = env.join('z', 'Auntie Pat', undefined, undefined, 'guestmeech000000000001');
    expect(again.pid).toBe(a.pid);
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    expect(env.last('z', 'state')!.seat).toBe(0);
    expect(env.last('z', 'state')!.spectator).toBeUndefined();
  });

  it('a bot takes the seat only after the disconnect grace, and the same player reclaims it', () => {
    const { env, a } = seated();
    env.join('w', 'Watcher');
    env.room.data.members[a.pid]!.timeouts = 2;
    env.room.close('a');
    env.advance(1000);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    env.advance(5000);
    const bot = env.room.data.seats[0];
    expect(bot).toMatchObject({ kind: 'bot', was: 'Meech', vacated: true, replacedPid: a.pid });
    expect(env.room.data.members[a.pid]!.seat).toBeNull();
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
    const again = env.join('z', 'Auntie Pat', a.token);
    expect(again.pid).toBe(a.pid);
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    expect(env.last('z', 'state')!.spectator).toBeUndefined();
    expect(env.last('z', 'state')!.seat).toBe(0);
  });

  it('binds hello before the account ticket resolves, so a play in that gap keeps the seat', async () => {
    const { env, a } = seated();
    let release!: (v: { uid: string } | null) => void;
    const gate = new Promise<{ uid: string } | null>((r) => { release = r; });
    const pending = dispatchTableMessage(
      env.room,
      'z',
      JSON.stringify({ t: 'hello', name: 'Auntie Pat', token: a.token, ticket: 'pending-ticket' }),
      () => gate,
    );
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
    env.room.message('z', JSON.stringify({ t: 'act', id: 'gap', action: { type: 'play', card: 'AS' }, seq: env.room.data.seq }));
    expect(env.room.data.game!.trick.plays.map((p) => p.card)).toContain('AS');
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
    release(null);
    await pending;
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
  });
});
