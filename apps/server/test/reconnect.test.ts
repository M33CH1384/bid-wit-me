import { describe, expect, it } from 'vitest';
import { makeRules, type GameState } from '@spades/rules';
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
    expect(st.view!.turn).toBe(0);
    expect(st.view!.legal).toContain('AS');
    expect(Array.isArray(st.view!.history)).toBe(true);
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

  it('a disconnect past the grace auto-plays the turn and never gives the seat or the name to a bot', () => {
    const { env, a } = seated();
    env.join('w', 'Watcher');
    env.room.data.afkLimit = 1;
    env.room.data.members[a.pid]!.timeouts = 5;
    const seq = env.room.data.seq!;
    env.room.close('a');
    env.advance(1000);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    env.advance(6000);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
    expect(env.room.data.members[a.pid]!.seat).toBe(0);
    expect(env.room.data.seq!).toBeGreaterThan(seq);
    expect(env.room.data.game!.turn !== 0 || env.room.data.game!.trick.plays.length > 0).toBe(true);
    const again = env.join('z', 'Ty', a.token);
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

  it('holds the turn clock while the table is drawing, then starts a full timer without giving up the seat', () => {
    const { env, a } = seated();
    const seq = env.room.data.seq!;
    env.send('a', { t: 'interactive', on: false });
    env.advance(20_000);
    expect(env.room.data.seq).toBe(seq);
    expect(env.room.data.game!.trick.plays).toEqual([]);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    expect(env.room.data.deadline).toBeNull();
    env.send('a', { t: 'interactive', on: true });
    const left = env.room.data.deadline! - env.t;
    expect(left).toBeGreaterThan(19_000);
    env.advance(left - 500);
    expect(env.room.data.game!.trick.plays).toEqual([]);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid, });
    env.advance(1000);
    expect(env.room.data.seq!).toBeGreaterThan(seq);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    expect(env.room.data.members[a.pid]!.name).toBe('Meech');
  });

  it('applies the chosen card when the seq is behind but this turn has not moved', () => {
    const { env } = seated();
    const seq = env.room.data.seq!;
    expect(env.room.data.turnSeq).toBeLessThanOrEqual(seq);
    env.room.data.seq = seq + 1;
    env.send('a', { t: 'act', id: 'behind', action: { type: 'play', card: 'AS' }, seq });
    expect(env.room.data.game!.trick.plays.map((p) => p.card)).toEqual(['AS']);
    expect(env.last('a', 'ack')).toMatchObject({ id: 'behind', ok: true });
    expect(env.room.data.seats[0]?.kind).toBe('human');
  });

  it('drops a card chosen before this turn and resends the full turn', () => {
    const { env } = seated();
    const seq = env.room.data.seq!;
    env.room.data.seq = seq + 2;
    env.room.data.turnSeq = seq + 1;
    env.send('a', { t: 'act', id: 'old-turn', action: { type: 'play', card: 'KS' }, seq });
    expect(env.room.data.game!.trick.plays).toEqual([]);
    expect(env.last('a', 'ack')).toMatchObject({ id: 'old-turn', ok: false, stale: true });
    const st = env.last('a', 'state')!;
    expect(st.view!.turn).toBe(0);
    expect(st.view!.legal).toContain('AS');
    expect(Array.isArray(st.view!.history)).toBe(true);
  });

  it('keeps a Relaxed play clock through a reconnect and does not auto-play at 12s', () => {
    const env = new FakeEnv();
    const a = env.join('a', 'Meech', undefined, undefined, 'guestmeech000000000001');
    env.join('b', 'Imani');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('b', { t: 'sit', seat: 2 });
    env.send('a', { t: 'addBot', seat: 1 });
    env.send('a', { t: 'addBot', seat: 3 });
    env.send('a', { t: 'config', rules: makeRules('joker', { turnTimerSec: { bid: 45, play: 30 }, firstHandBidsItself: false }) });
    env.send('a', { t: 'start' });
    pinLead(env);
    expect(env.room.data.rules.turnTimerSec).toEqual({ bid: 45, play: 30 });
    expect(env.room.data.deadline! - env.t).toBe(30_000);
    env.join('w', 'Watcher');
    env.room.close('a');
    env.advance(2_000);
    env.join('z', 'Someone', a.token);
    expect(env.room.data.members[a.pid]!.interactive).toBe(false);
    expect(env.room.data.deadline).toBeNull();
    env.advance(12_000);
    expect(env.room.data.game!.trick.plays).toEqual([]);
    env.send('z', { t: 'interactive', on: true });
    expect(env.room.data.deadline! - env.t).toBe(30_000);
    env.advance(12_000);
    expect(env.room.data.game!.trick.plays).toEqual([]);
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
    env.send('z', { t: 'act', id: 'relaxed-play', action: { type: 'play', card: 'AS' }, seq: env.room.data.seq });
    expect(env.room.data.game!.trick.plays.map((p) => p.card)).toEqual(['AS']);
  });

  it('logs the socket close, the reconnect, and a leave that is the only way a bot gets the seat', () => {
    const lines: string[] = [];
    const orig = console.log;
    console.log = (m?: unknown) => { lines.push(String(m ?? '')); };
    try {
      const { env, a } = seated();
      env.room.noteSocketClose('a', 1001, 'going away', false);
      env.room.close('a');
      env.join('z', 'Ty', a.token);
      expect(env.room.data.seats[0]).toMatchObject({ kind: 'human', playerId: a.pid });
      env.send('z', { t: 'leave' });
    } finally {
      console.log = orig;
    }
    const events = lines.flatMap((line) => {
      try {
        const row = JSON.parse(line) as { src?: string; event?: string };
        return row.src === 'bwm.table' ? [row] : [];
      } catch { return []; }
    });
    const close = events.find((e) => e.event === 'socket_close') as { code?: number; reason?: string; seat?: number };
    const again = events.find((e) => e.event === 'reconnect' && (e as { how?: string }).how === 'token') as { seat?: number; returning?: boolean };
    const seat = events.find((e) => e.event === 'seat' && (e as { cause?: string }).cause === 'leave') as { toKind?: string; fromPid?: string };
    expect(close).toMatchObject({ code: 1001, reason: 'going away', seat: 0 });
    expect(again).toMatchObject({ seat: 0, returning: true });
    expect(seat).toMatchObject({ toKind: 'bot', fromPid: expect.any(String) });
  });
});
