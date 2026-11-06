/**
 * Toss-the-hand poll, online (owner, 2026-11-05): the room owns the poll.
 * Any seated human may call it once a set is mathematically locked (and
 * no live Nil is in doubt); every human at the table votes; bots consent;
 * one No — or the poll's own expiry — kills it for the hand. Unanimous
 * Yes ends the hand on the flat contract score through the engine.
 *
 * While a poll is open the table is frozen: no bot moves, no auto-plays,
 * and the turn clock is preserved — closing the poll shifts the turn's
 * start by the poll's whole life, so the player on the clock keeps
 * exactly the time they had. Game actions sent mid-poll are refused.
 */
import { describe, expect, it } from 'vitest';
import { type Card, type GameState, type Trick } from '@spades/rules';
import { type ServerMsg } from '@spades/protocol';
import { TOSS_POLL_MS } from '../src/room';
import { FakeEnv } from './harness';

const TIMING = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

/** a: seat 0 (side 0), b: seat 1 (side 1), bots at 2 (side 0) and 3 (side 1). */
function started() {
  const env = new FakeEnv(undefined, TIMING);
  env.join('a', 'Meech');
  env.join('b', 'Imani');
  env.send('a', { t: 'interactive', on: true }); // the table is drawn: no loader hold on the turn clock
  env.send('b', { t: 'interactive', on: true });
  env.send('a', { t: 'sit', seat: 0 });
  env.send('b', { t: 'sit', seat: 1 });
  env.send('a', { t: 'addBot', seat: 2 });
  env.send('a', { t: 'addBot', seat: 3 });
  env.send('a', { t: 'start' });
  return env;
}

const dummy = ['3C', '4C', '5C', '6C'] as const;

/** Put the dealt game into a rigged mid-hand position (a fresh state object, as the engine would produce). */
function rig(env: FakeEnv, o: {
  bids: (number | 'nil' | 'blindNil')[]; winners: number[]; turn: number; hands?: Card[][];
}): GameState {
  const base = env.room.data.game!;
  const tricksWon = [0, 0, 0, 0];
  const tricks: Trick[] = o.winners.map((w) => {
    tricksWon[w]!++;
    return { leader: (w + 3) % 4, plays: [0, 1, 2, 3].map((s) => ({ seat: s, card: dummy[s]! })), winner: w };
  });
  const g: GameState = {
    ...base,
    phase: 'playing', handNo: 3, bids: [...o.bids], tricks, tricksWon,
    trick: { leader: o.turn, plays: [], winner: null }, turn: o.turn,
    spadesBroken: true, scores: [0, 0], bags: [0, 0], history: [], result: null,
    ...(o.hands ? { hands: o.hands.map((h) => [...h]) } : {}),
  };
  env.room.data.game = g;
  return g;
}

// Side 0 bid 8 (5+3) and took 5 of 11 — locked (needs 3, 2 remain). Side 1 bid 7.
const LOCKED = { bids: [5, 4, 3, 3] as (number | 'nil')[], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] };

describe('the toss poll (online room)', () => {
  it('unanimous Yes ends the hand on the flat score; the poll rides the room state while open', () => {
    const env = started();
    rig(env, { ...LOCKED, turn: 0 });
    env.send('a', { t: 'tossCall' });
    const st = env.last('b', 'state')!;
    expect(st.room.tossPoll).toMatchObject({ handNo: 3, caller: 0, voters: [0, 1], yes: [0], no: [] });
    expect(env.room.data.tossPoll).not.toBeNull();
    env.send('b', { t: 'tossVote', yes: true });
    const d = env.room.data;
    expect(d.tossPoll).toBeNull();
    expect(d.game?.phase).toBe('handOver');
    expect(d.game?.scores).toEqual([-80, 70]);
    const rec = d.game!.history[0]!;
    expect(rec.tossed).toEqual({ setSides: [0] });
    expect(rec.tricksWon).toEqual([5, 6, 0, 0]); // played tricks only
    // the chat tells the truth about what happened
    const chat = env.msgs('b').filter((m) => m.t === 'chat').map((m) => (m as Extract<ServerMsg, { t: 'chat' }>).line.text);
    expect(chat.some((t) => t.includes('calls a toss'))).toBe(true);
    expect(chat.some((t) => t.includes('Cards tossed'))).toBe(true);
  });

  it('one No kills the poll for the hand — no re-call', () => {
    const env = started();
    rig(env, { ...LOCKED, turn: 0 });
    env.send('a', { t: 'tossCall' });
    env.send('b', { t: 'tossVote', yes: false });
    const d = env.room.data;
    expect(d.tossPoll).toBeNull();
    expect(d.tossDeadHand).toBe(3);
    expect(d.game?.phase).toBe('playing');
    env.clear();
    env.send('a', { t: 'tossCall' });
    expect(env.errors('a').map((e) => e.code)).toContain('POLL_DEAD');
    expect(env.room.data.tossPoll).toBeNull();
  });

  it('a lone human at a bot table resolves on their own call (bots consent)', () => {
    const env = new FakeEnv(undefined, TIMING);
    env.join('a', 'Meech');
    env.send('a', { t: 'sit', seat: 0 });
    env.send('a', { t: 'addBot', seat: 1 });
    env.send('a', { t: 'addBot', seat: 2 });
    env.send('a', { t: 'addBot', seat: 3 });
    env.send('a', { t: 'start' });
    rig(env, { ...LOCKED, turn: 0 });
    env.send('a', { t: 'tossCall' });
    expect(env.room.data.tossPoll).toBeNull();
    expect(env.room.data.game?.phase).toBe('handOver');
    expect(env.room.data.game?.scores).toEqual([-80, 70]);
  });

  it('refuses the call when no set is locked, and while a live Nil is in doubt', () => {
    const env = started();
    rig(env, { bids: [5, 4, 3, 3], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1], turn: 0 }); // needs 3, 4 remain
    env.send('a', { t: 'tossCall' });
    expect(env.errors('a').map((e) => e.code)).toContain('CANNOT_TOSS');
    // locked, but seat 0's Nil is live and bustable (the little trump finds it)
    rig(env, {
      bids: ['nil', 5, 4, 4], winners: [1, 2, 1, 2, 1, 2, 2, 2, 3, 3, 3], turn: 1,
      hands: [['3H', '2S'], ['AH', 'KH'], ['QH', 'JH'], ['TH', '9H']],
    });
    env.clear();
    env.send('a', { t: 'tossCall' });
    expect(env.errors('a').map((e) => e.code)).toContain('CANNOT_TOSS');
    expect(env.room.data.tossPoll).toBeNull();
  });

  it('freezes the table while the poll is open: bots do not move, acts are refused', () => {
    const env = started();
    const g = rig(env, { ...LOCKED, turn: 2 }); // a bot is on the clock
    env.send('a', { t: 'tossCall' });
    expect(env.room.data.tossPoll).not.toBeNull();
    env.advance(5_000); // bots move in ~10 ms when unfrozen
    expect(g.turn).toBe(2);
    expect(g.trick.plays).toHaveLength(0);
    expect(g.tricks).toHaveLength(11);
    env.send('b', { t: 'act', action: { type: 'play', card: 'AH' }, seq: env.room.data.seq ?? 0 });
    expect(env.errors('b').map((e) => e.code)).toContain('POLL_OPEN');
    // the No releases the table: drive time to the bot's OWN scheduled play
    // (its pace beat — plus the +900 ms talk beat on the runs where the bot's
    // live-random persona roll speaks a pre-play line first). No fixed window
    // covers both worlds; the state does. Frozen meant NO play while open.
    env.send('b', { t: 'tossVote', yes: false });
    env.advance(env.room.data.botDueAt! - env.t);
    const live = env.room.data.game!;
    expect(live.trick.plays.length + live.tricks.length).toBeGreaterThan(11);
  });

  it("the poll never eats the current player's clock: closing makes the turn whole", () => {
    const env = started();
    rig(env, { ...LOCKED, turn: 1 }); // b (human) is on the clock
    env.room.tick(); // a timer pass runs drive: the rigged turn settles (a chat send cannot settle it — handle() returns before after() for chat)
    const d = env.room.data;
    const startedAt = d.turnStartedAt!;
    expect(startedAt).not.toBeNull();
    expect(d.deadline).not.toBeNull();
    env.send('a', { t: 'tossCall' });
    expect(d.deadline).toBeNull(); // no clock runs during the poll
    const openedAt = d.tossPoll!.openedAt;
    env.advance(12_000);
    expect(d.game?.turn).toBe(1); // b was never auto-played
    expect(d.game?.trick.plays).toHaveLength(0);
    env.send('b', { t: 'tossVote', yes: false });
    expect(d.turnStartedAt).toBe(startedAt + (env.t - openedAt)); // shifted by the poll's whole life
    expect(d.deadline).not.toBeNull();
    expect(d.deadline!).toBeGreaterThan(env.t + 20_000); // b keeps (nearly) a full 30 s
  });

  it('expiry kills the poll for the hand and the hand plays on', () => {
    const env = started();
    rig(env, { ...LOCKED, turn: 1 });
    env.room.tick(); // settle the rigged turn (chat never drives)
    env.send('a', { t: 'tossCall' });
    expect(env.room.data.tossPoll).not.toBeNull();
    env.advance(TOSS_POLL_MS + 1);
    const d = env.room.data;
    expect(d.tossPoll).toBeNull();
    expect(d.tossDeadHand).toBe(3);
    expect(d.game?.phase).toBe('playing');
    env.clear();
    env.send('b', { t: 'tossCall' });
    expect(env.errors('b').map((e) => e.code)).toContain('POLL_DEAD');
  });
});
