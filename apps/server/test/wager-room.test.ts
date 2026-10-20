/** Big Bank Take Lil Bank (Phase 1): challenge tables in the Room — reserved seats, no bot-fill ever, LOCKED table controls, the noshow/abandoned/played challengeResult callbacks. */
import { describe, expect, it } from 'vitest';
import type { Card } from '@spades/rules';
import { makeRules } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import type { GameAction } from '@spades/protocol';
import { FakeEnv } from './harness';
import { DEFAULT_TIMING, type ChallengeSeat } from '../src/room';

const FAST = { ...DEFAULT_TIMING, botMs: 10, trickPauseMs: 10, dealMs: 10, handOverMs: 50, handEndHoldMs: 0 };
const R = (u: string) => ({ uid: u, name: u.toUpperCase() });
const RESERVED: ChallengeSeat['reserved'] = [R('a'), R('b'), R('c'), R('d')];

function setup(rules = makeRules('joker', { targetScore: 100 })) {
  const env = new FakeEnv(undefined, FAST);
  env.room.setupChallenge({ id: 'cid000000001', reserved: RESERVED, autostartAt: env.t + 60_000 }, rules);
  return env;
}
function enter(env: FakeEnv, cid: string, uid: string) {
  env.join(cid, uid.toUpperCase());
  env.room.linkUser(cid, uid);
}
function enterAll(env: FakeEnv) {
  enter(env, 'c1', 'a'); enter(env, 'c2', 'b'); enter(env, 'c3', 'c'); enter(env, 'c4', 'd');
}

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
    env.advance(400);
    env.send(cid, { t: 'act', action, seq: st.room.seq });
    return true;
  }
  return false;
}

describe('challenge tables', () => {
  it('entrants land in their reserved seats; the match starts when all four are in — no bots, ever', () => {
    const env = setup();
    enter(env, 'c3', 'c');
    enter(env, 'c1', 'a');
    expect(env.room.data.seats[2]).toMatchObject({ kind: 'human' });
    expect(env.room.data.seats[0]).toMatchObject({ kind: 'human' });
    expect(env.room.data.phase).toBe('lobby');
    enter(env, 'c2', 'b');
    enter(env, 'c4', 'd');
    expect(env.room.data.phase).toBe('playing');
    expect(env.room.data.seats.every((x) => x.kind === 'human')).toBe(true);
    expect(env.last('c1', 'state')?.room.challenge?.id).toBe('cid000000001');
    expect(env.challengeResults).toHaveLength(0);
  });

  it('a stranger cannot take a reserved seat', () => {
    const env = setup();
    enter(env, 'c1', 'a');
    env.join('cx', 'Stranger');
    env.send('cx', { t: 'sit', seat: 3 });
    expect(env.room.data.seats[3]?.kind).toBe('empty');
    expect(env.errors('cx').at(-1)?.message).toMatch(/reserved/i);
  });

  it('table controls are locked: config, bots, kick; a manual start waits for the full table', () => {
    const env = setup();
    enter(env, 'c1', 'a');
    env.send('c1', { t: 'config', rules: makeRules('joker') });
    expect(env.errors('c1').at(-1)?.code).toBe('LOCKED');
    env.send('c1', { t: 'addBot', seat: 1 });
    expect(env.errors('c1').at(-1)?.code).toBe('LOCKED');
    env.send('c1', { t: 'kick', seat: 0 });
    expect(env.errors('c1').at(-1)?.code).toBe('LOCKED');
    env.send('c1', { t: 'start' });
    expect(env.errors('c1').at(-1)?.code).toBe('WAITING'); // starts automatically once all four are seated
    expect(env.room.data.phase).toBe('lobby');
  });

  it('three of four by the deadline: the table reports a no-show with who was present — nobody is bot-filled', () => {
    const env = setup();
    enter(env, 'c1', 'a'); enter(env, 'c2', 'b'); enter(env, 'c3', 'c');
    env.advance(61_000);
    expect(env.room.data.phase).toBe('over');
    expect(env.room.data.seats.some((x) => x.kind === 'bot')).toBe(false);
    expect(env.challengeResults).toEqual([{ kind: 'noshow', shown: ['a', 'b', 'c'] }]);
  });

  it('nobody shows: reported once with an empty shown list', () => {
    const env = setup();
    env.advance(61_000);
    expect(env.room.data.phase).toBe('over');
    expect(env.challengeResults).toEqual([{ kind: 'noshow', shown: [] }]);
    env.advance(120_000);
    expect(env.challengeResults).toHaveLength(1); // exactly once
  });

  it('a mid-match explicit leave reports abandoned with the leaver, exactly once', () => {
    const env = setup();
    enterAll(env);
    expect(env.room.data.phase).toBe('playing');
    env.send('c2', { t: 'leave' });
    expect(env.challengeResults).toEqual([{ kind: 'abandoned', leaverUid: 'b' }]);
    env.advance(120_000);
    expect(env.challengeResults).toHaveLength(1);
  });

  it('a fully played game reports played once, with the recorded game id and per-side places', () => {
    const env = setup(makeRules('joker', { targetScore: 100 }));
    enterAll(env);
    const cids = ['c1', 'c2', 'c3', 'c4'];
    for (let i = 0; i < 20000 && env.room.data.phase === 'playing'; i++) if (!playTurn(env, cids)) env.advance(200);
    expect(env.room.data.phase).toBe('over');
    expect(env.challengeResults).toHaveLength(1);
    const r = env.challengeResults[0]!;
    expect(r.kind).toBe('played');
    if (r.kind === 'played') {
      expect(r.gameId).toBe(env.records[0]!.rec.id);
      expect(r.scores).toHaveLength(2);
      expect([...r.places].sort()).toEqual([1, 2]);
    }
    // the game is a normal recorded (rated-eligible) game: the record exists for the cred hooks
    expect(env.records).toHaveLength(1);
    expect(env.records[0]!.rec.players.map((p) => p.uid).sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});
