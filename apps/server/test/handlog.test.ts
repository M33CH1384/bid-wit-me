import { describe, expect, it } from 'vitest';
import { chooseBotAction } from '@spades/bots';
import { makeRules, type Card } from '@spades/rules';
import type { GameAction } from '@spades/protocol';
import { newRoomData } from '../src/room';
import { FakeEnv } from './harness';

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

// The room deals from a crypto-random seed, so with the default house rules a side can be
// "shot out" on hand 1 (or hit the -200 floor) and the game ends before a next hand exists —
// these tests need hand 2 to be reachable, so pin rules that always deal one.
function fourHumans(env = new FakeEnv(newRoomData('ABCDE', 1_000_000, makeRules('joker', { shotOut: false, losingFloor: null })), FAST)) {
  const ps = ['a', 'b', 'c', 'd'].map((cid, i) => {
    const p = env.join(cid, ['Dee', 'Ray', 'Kim', 'Jo'][i]!);
    env.send(cid, { t: 'sit', seat: i });
    return { cid, ...p };
  });
  return { env, ps };
}

/** Drives whoever's turn it is with the bot brain until the current hand completes. */
function playHandToEnd(env: FakeEnv, cids: string[]): void {
  const cidsByTurn: string[] = cids;
  for (let guard = 0; guard < 2000; guard++) {
    const g = env.room.data.game!;
    if (g.phase !== 'playing' || g.handNo > 1) return;
    let moved = false;
    for (const cid of cidsByTurn) {
      const st = env.last(cid, 'state');
      const v = st?.view;
      if (!v || st.room.phase !== 'playing' || v.turn !== v.seat) continue;
      const a = chooseBotAction(v, 'normal');
      if (!a) continue;
      const action: GameAction = a.type === 'reveal' ? { type: 'reveal' } : a.type === 'bid' ? { type: 'bid', bid: a.bid } : a.type === 'play' ? { type: 'play', card: a.card } : a.type === 'runIt' ? { type: 'runIt' } : { type: 'exchange', cards: (a as { cards: Card[] }).cards };
      env.send(cid, { t: 'act', action, seq: st.room.seq });
      moved = true;
      break;
    }
    if (!moved) throw new Error('stuck: nobody could act');
  }
  throw new Error('hand did not finish');
}

describe('hand log (room)', () => {
  it('records the deal, actions and outcome of a hand driven through the room', () => {
    const { env, ps } = fourHumans();
    const cids = ps.map((p) => p.cid);
    env.send('a', { t: 'start' });
    expect(env.room.data.game).not.toBeNull();

    playHandToEnd(env, cids);

    const log = env.room.handLogJson();
    expect(log).not.toBeNull();
    expect(log!.v).toBe(1);
    expect(log!.hands).toHaveLength(1);
    const hand = log!.hands[0]!;
    expect(hand.handNo).toBe(1);
    expect(hand.dealer).toBe(env.room.data.game!.dealer);

    // the full deal was captured (4 seats, 52 unique cards)
    expect(hand.deal).toHaveLength(4);
    expect(new Set(hand.deal.flat()).size).toBe(52);

    // every applied action is in the log in seq order
    expect(hand.actions.length).toBeGreaterThan(4);
    const seqs = hand.actions.map((a) => a.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(hand.actions.some((a) => a.action.type === 'play')).toBe(true);

    // tricks with winners were recorded, and the hand completed with engine scores
    expect(hand.tricks.length).toBeGreaterThan(0);
    expect(hand.tricks.every((t) => t.winner !== null)).toBe(true);
    expect(hand.complete).toBe(true);
    expect(hand.scores).toEqual(env.room.data.game!.scores);

    // runIt entries always carry the claimer's real remaining cards at claim time
    for (const r of hand.runIts) {
      expect(r.claimerHand.length).toBeGreaterThan(0);
      expect(r.played.length).toBeGreaterThan(0);
      expect(r.cleared[r.claimer]!.map((c) => c.card).sort())
        .toEqual(r.played.filter((p) => p.seat === r.claimer).map((p) => p.card).sort());
    }
  });

  it('survives a room restart and opens a fresh entry on the next hand', () => {
    const { env, ps } = fourHumans();
    const cids = ps.map((p) => p.cid);
    env.send('a', { t: 'start' });
    playHandToEnd(env, cids);
    const before = JSON.parse(JSON.stringify(env.room.handLogJson()));

    // DO restart / hibernation: the in-memory builder is gone, the log lives in room data
    env.restart(cids.map((cid, i) => [cid, ps[i]!.pid] as [string, string | null]));

    const afterRestart = env.room.handLogJson();
    expect(afterRestart).not.toBeNull();
    expect(afterRestart!.hands).toHaveLength(1);
    expect(afterRestart!.hands[0]!.complete).toBe(true);

    // deal the next hand: the same log object (still in RoomData) gains hand 2
    for (const cid of cids) env.send(cid, { t: 'next' });
    env.advance(100);
    const log = env.room.handLogJson()!;
    expect(log.hands).toHaveLength(2);
    expect(log.hands[1]!.handNo).toBe(2);
    expect(log.hands[1]!.deal).toHaveLength(4);
    expect(JSON.stringify(log.hands[0])).toBe(JSON.stringify(before.hands[0]));
  });
});
