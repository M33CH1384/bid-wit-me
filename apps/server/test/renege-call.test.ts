/**
 * Renege calls, online (owner, 2026-11-12): on a table with the "Renege
 * calls" house rule nobody is locked into following suit, and the room's
 * engine is the judge of every call. A seated player sends `renegeCall`
 * (real seats); the verdict and the moved books ride the next view to the
 * whole table. The engine's private renege record never leaves the server.
 */
import { describe, expect, it } from 'vitest';
import { type Card, type GameState, viewFor } from '@spades/rules';
import { chooseRenegeCall } from '@spades/bots';
import { type ServerMsg } from '@spades/protocol';
import { BOT_RENEGE_CALL_MS } from '../src/room';
import { FakeEnv } from './harness';

const TIMING = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

/** a: seat 0 (side 0), b: seat 1 (side 1), bots at 2 (side 0) and 3 (side 1). */
function started(renege = true) {
  const env = new FakeEnv(undefined, TIMING);
  env.join('a', 'Meech');
  env.join('b', 'Imani');
  env.send('a', { t: 'interactive', on: true });
  env.send('b', { t: 'interactive', on: true });
  env.send('a', { t: 'sit', seat: 0 });
  env.send('b', { t: 'sit', seat: 1 });
  env.send('a', { t: 'addBot', seat: 2 });
  env.send('a', { t: 'addBot', seat: 3 });
  env.room.data.rules = { ...env.room.data.rules, renege, shotOut: false };
  env.send('a', { t: 'start' });
  return env;
}

/**
 * A rigged hand, seat 0 on lead, everyone bid 3, three cards each:
 * seat 0 leads the A♥; seat 1 (human b) holds the 5♥ and the 3♠.
 */
function rig(env: FakeEnv, scores = [0, 0], bids = [3, 3, 3, 3]): GameState {
  const base = env.room.data.game!;
  const hands: Card[][] = [['AH', 'KH', '3C'], ['5H', '3S', '5C'], ['6H', '7H', '7C'], ['8H', '9H', '9C']];
  const g: GameState = {
    ...base, rules: env.room.data.rules,
    phase: 'playing', handNo: 3, dealer: 3, bids: [...bids], tricks: [], tricksWon: [0, 0, 0, 0],
    trick: { leader: 0, plays: [], winner: null }, turn: 0, hands, trickCount: 3,
    spadesBroken: false, scores: [...scores], bags: [0, 0], history: [], result: null,
    reneges: undefined, renegeCalls: undefined, renegeDebt: undefined,
    handStart: { scores: [...scores], bags: [0, 0] },
  };
  env.room.data.game = g;
  return g;
}

let actId = 0;
const play = (env: FakeEnv, cid: string, card: Card) => env.send(cid, { t: 'act', id: `p${++actId}`, action: { type: 'play', card }, seq: env.room.data.seq });
const chat = (env: FakeEnv, cid: string) => env.msgs(cid).filter((m) => m.t === 'chat').map((m) => (m as Extract<ServerMsg, { t: 'chat' }>).line.text);

describe('renege calls (online room)', () => {
  it('a regular table still refuses an off-suit card', () => {
    const env = started(false);
    rig(env);
    play(env, 'a', 'AH');
    play(env, 'b', '3S');
    expect(env.msgs('b').filter((m) => m.t === 'ack' && !m.ok).map((m) => (m as Extract<ServerMsg, { t: 'ack' }>).code)).toContain('MUST_FOLLOW_SUIT');
    expect(env.room.data.game!.trick.plays).toHaveLength(1);
    env.send('a', { t: 'renegeCall', target: 1, trick: 0 });
    expect(env.errors('a').map((e) => e.code)).toContain('BAD_RENEGE_CALL');
  });

  it('accepts the off-suit card, keeps the truth on the server, and rules a correct call for the caller', () => {
    const env = started();
    rig(env);
    play(env, 'a', 'AH');
    expect(env.last('b', 'state')!.view!.playable).toEqual(['5H', '3S', '5C']);
    expect(env.last('b', 'state')!.view!.legal).toEqual(['5H']);
    play(env, 'b', '3S'); // the renege
    expect(env.errors('b')).toEqual([]);
    expect(env.room.data.game!.reneges).toHaveLength(1);
    // nothing sent to anyone carries the private record
    for (const cid of ['a', 'b']) expect(JSON.stringify(env.msgs(cid))).not.toContain('"reneges"');
    env.advance(1200); // the bots finish book 1 (seat 1 wins it with the cut)
    const g = env.room.data.game!;
    expect(g.tricks).toHaveLength(1);
    expect(g.tricks[0]!.winner).toBe(1);
    env.clear();
    env.send('a', { t: 'renegeCall', target: 1, trick: 0 });
    expect(env.errors('a')).toEqual([]);
    const after = env.room.data.game!;
    expect(after.renegeCalls![0]).toMatchObject({ by: 0, target: 1, trick: 0, correct: true, from: 1, to: 0, proof: { led: 'AH', played: '3S', held: '5H' } });
    expect(after.tricksWon[1]).toBe(0);
    expect(after.tricksWon[0]! + after.tricksWon[2]!).toBe(1);
    // the whole table sees the ruling
    for (const cid of ['a', 'b']) expect(env.last(cid, 'state')!.view!.renege!.calls).toHaveLength(1);
    expect(chat(env, 'b').some((t) => t.includes('RENEGE') && t.includes('Meech') && t.includes('Imani'))).toBe(true);
  });

  it('a wrong call costs the caller’s side, and the same play cannot be called twice', () => {
    const env = started();
    rig(env);
    play(env, 'a', 'AH');
    play(env, 'b', '5H'); // honest
    env.advance(1200);
    const won = env.room.data.game!.tricksWon.slice();
    expect(won[0]).toBe(1); // the A♥ took book 1
    env.clear();
    env.send('b', { t: 'renegeCall', target: 2, trick: 0 }); // seat 2 followed with a heart: clean... but b's side has no books to give
    const g = env.room.data.game!;
    expect(g.renegeCalls![0]).toMatchObject({ by: 1, target: 2, correct: false, from: 1, to: 0 });
    expect(g.renegeDebt).toEqual([{ from: 1, toSeat: 2, books: 3 }]); // owed out of the books b's side wins later
    expect(chat(env, 'a').some((t) => t.includes('no renege'))).toBe(true);
    env.clear();
    env.send('b', { t: 'renegeCall', target: 2, trick: 0 });
    expect(env.errors('b').map((e) => e.code)).toContain('BAD_RENEGE_CALL');
  });

  it('only seated players may call, and never a partner', () => {
    const env = started();
    env.join('w', 'Watcher');
    rig(env);
    play(env, 'a', 'AH');
    play(env, 'b', '3S');
    env.advance(1200);
    env.send('w', { t: 'renegeCall', target: 1, trick: 0 });
    expect(env.errors('w').map((e) => e.code)).toContain('NOT_SEATED');
    env.send('a', { t: 'renegeCall', target: 2, trick: 0 });
    expect(env.errors('a').map((e) => e.code)).toContain('BAD_RENEGE_CALL');
    expect(env.room.data.game!.renegeCalls).toBeUndefined();
  });

  it('a bot calls a renege once the proof is on the table — after a beat, and only then', () => {
    // find a spot where seat 2's bot (a's partner) notices: the roll is a stable function of the position
    let env!: FakeEnv;
    let found = false;
    for (let i = 0; i < 30 && !found; i++) {
      env = started();
      for (const s of [2, 3]) { const slot = env.room.data.seats[s]!; if (slot.kind === 'bot') slot.level = 'shark'; }
      rig(env, [i * 10, 0]);
      play(env, 'a', 'AH');
      play(env, 'b', '3S'); // renege; bots finish the book; b (seat 1) leads next
      env.advance(1200);
      expect(env.room.data.game!.turn).toBe(1);
      // no proof yet: no bot has anything to call
      expect(env.room.data.game!.renegeCalls).toBeUndefined();
      play(env, 'b', '5H'); // the heart shows up: proof
      const g = env.room.data.game!;
      found = [2].some((s) => chooseRenegeCall(viewFor(g, s), 'shark') !== null);
    }
    expect(found).toBe(true);
    // the call lands after the beat, not with the card
    expect(env.room.data.game!.renegeCalls).toBeUndefined();
    env.advance(BOT_RENEGE_CALL_MS + 50);
    const call = env.room.data.game!.renegeCalls?.[0];
    expect(call).toMatchObject({ by: 2, target: 1, trick: 0, correct: true });
  });

  it('after the last card: a call on the hand-over screen re-scores the hand before the next deal', () => {
    const env = started();
    rig(env, [0, 0], [1, 1, 1, 1]); // low bids: any book that moves changes a score
    play(env, 'a', 'AH');
    play(env, 'b', '3S');
    env.advance(1200);
    // play the last two books out honestly, whoever is up
    for (let guard = 0; guard < 40 && env.room.data.game!.phase === 'playing'; guard++) {
      const g = env.room.data.game!;
      const seat = g.turn!;
      if (seat === 0 || seat === 1) play(env, seat === 0 ? 'a' : 'b', viewFor(g, seat).legal[0]!);
      else env.advance(400); // a bot's turn — or the beat the table holds before a bot's call
    }
    const over = env.room.data.game!;
    expect(over.phase).toBe('handOver');
    const before = over.scores.slice();
    // a bot may already have caught it; if not, the human does — either way the score moves once
    if (!over.renegeCalls?.length) env.send('a', { t: 'renegeCall', target: 1, trick: 0 });
    const after = env.room.data.game!;
    expect(after.renegeCalls).toHaveLength(1);
    expect(after.history).toHaveLength(1);
    expect(after.history[0]!.renegeCalls).toHaveLength(1);
    if (!over.renegeCalls?.length) expect(after.scores).not.toEqual(before);
    // the next deal clears the hand's calls
    env.advance(10_000);
    expect(env.room.data.game!.handNo).toBe(4);
    expect(env.room.data.game!.renegeCalls).toBeUndefined();
  });
});
