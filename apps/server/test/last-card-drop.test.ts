import { describe, expect, it } from 'vitest';
import { trickWinner, type Card, type GameState } from '@spades/rules';
import { FakeEnv } from './harness';

/**
 * Last-card free drop, server side (Demetrius 2026-11-02): the authoritative room
 * accepts a one-card seat's out-of-turn play, two simultaneous drops both land
 * exactly once, a bot on its last card drops on the pacing clock without waiting
 * for its turn, and a two-card seat jumping the turn is still refused.
 */

const FAST = { botMs: 10, trickPauseMs: 0, dealMs: 0, disconnectGraceMs: 5000, handOverMs: 3000 };

/** Replace the dealt game with a crafted mid-trick state (dealt hands are uniform,
 *  so a mid-hand one-card seat is built by hand, on the room's own rules/seed). */
function craft(env: FakeEnv, hands: Card[][], leader = 0): void {
  const d = env.room.data;
  const g = d.game!;
  d.game = {
    ...g,
    phase: 'playing',
    bids: [3, 3, 3, 3] as GameState['bids'],
    hands,
    trick: { leader, plays: [], winner: null },
    turn: leader,
    tricks: Array.from({ length: 5 }, () => ({ leader: 0, plays: [], winner: 0 })),
    tricksWon: [0, 0, 0, 0],
    spadesBroken: true,
    revealed: [true, true, true, true],
  };
  d.turnKey = null; // re-arm the turn machinery on the crafted state
  d.deadline = null;
  d.botDueAt = null;
}

function table(humans: number[]) {
  const env = new FakeEnv(undefined, FAST);
  const cidOf = ['a', 'b', 'c', 'd']; // connection id per seat
  for (let seat = 0; seat < 4; seat++) {
    if (!humans.includes(seat)) continue;
    env.join(cidOf[seat]!, ['Dee', 'Ray', 'Kim', 'Jo'][seat]!);
    env.send(cidOf[seat]!, { t: 'sit', seat });
  }
  for (let seat = 0; seat < 4; seat++) if (!humans.includes(seat)) env.send('a', { t: 'addBot', seat });
  env.send('a', { t: 'start' });
  return { env, cidOf };
}

describe('last-card free drop (room)', () => {
  it('accepts a human’s out-of-turn drop, and two simultaneous drops both land exactly once', () => {
    const { env, cidOf } = table([0, 2, 3]); // seat 1 is the bot; seats 2 and 3 both hold one card
    const [ca, , cc, cd] = cidOf as [string, string, string, string];
    craft(env, [['9S', '4C'], ['2S', 'KH'], ['7H'], ['3D']], 0);
    const seq0 = env.room.data.seq ?? 0;

    // seat 2 drops with the current seq (the normal path)
    env.send(cc, { t: 'act', id: 'drop-2', action: { type: 'play', card: '7H' }, seq: seq0 });
    let g = env.room.data.game!;
    expect(g.trick.plays).toEqual([{ seat: 2, card: '7H' }]);
    expect(g.turn).toBe(0); // the leader is still to lead
    expect(env.errors(cc)).toEqual([]);

    // seat 3's drop was composed against the same seq — the first drop bumped it,
    // but a one-card drop is pinned to this trick by the already-played + legality
    // checks, so it lands too (the simultaneous-drop race)
    env.send(cd, { t: 'act', id: 'drop-3', action: { type: 'play', card: '3D' }, seq: seq0 });
    g = env.room.data.game!;
    expect(g.trick.plays).toEqual([{ seat: 2, card: '7H' }, { seat: 3, card: '3D' }]);
    expect(g.turn).toBe(0);
    expect(env.last(cd, 'ack')).toMatchObject({ id: 'drop-3', ok: true });

    // a retry of the landed drop (same message id) is a duplicate ack — no second card
    const seqAfter = env.room.data.seq;
    env.send(cc, { t: 'act', id: 'drop-2', action: { type: 'play', card: '7H' }, seq: seq0 });
    g = env.room.data.game!;
    expect(g.trick.plays).toHaveLength(2);
    expect(env.room.data.seq).toBe(seqAfter);
    expect(env.last(cc, 'ack')).toMatchObject({ id: 'drop-2', ok: true, dup: true });

    // and a second, different play from the dropped seat in the same trick is refused
    env.send(cc, { t: 'act', id: 'drop-2b', action: { type: 'play', card: '7H' }, seq: env.room.data.seq });
    expect(env.room.data.game!.trick.plays).toHaveLength(2);

    // the leader leads, the bot follows — the trick completes by arrival set,
    // stored leader-first, and the pointer skipped both droppers on the way
    env.send(ca, { t: 'act', id: 'lead', action: { type: 'play', card: '9S' }, seq: env.room.data.seq });
    g = env.room.data.game!;
    expect(g.turn).toBe(1);
    env.advance(5000);
    g = env.room.data.game!;
    expect(g.tricks).toHaveLength(6);
    const done = g.tricks[5]!;
    expect(done.plays.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(done.winner).toBe(trickWinner(done.plays, g.rules));
  });

  it('refuses an out-of-turn play from a seat holding two cards', () => {
    const { env, cidOf } = table([0, 2]);
    craft(env, [['9S', '4C'], ['2S', 'KH'], ['7H', '8H'], ['AS', '5D']], 0);
    env.send(cidOf[2]!, { t: 'act', id: 'jump', action: { type: 'play', card: '7H' }, seq: env.room.data.seq });
    expect(env.room.data.game!.trick.plays).toEqual([]);
    expect(env.last(cidOf[2]!, 'ack')).toMatchObject({ id: 'jump', ok: false });
  });

  it('a bot on its last card drops on the pacing clock, out of turn, exactly once', () => {
    const { env } = table([0, 2]); // bots at 1 (two cards) and 3 (one card)
    craft(env, [['9S', '4C'], ['2S', 'KH'], ['7C', '8C'], ['3D']], 0);
    env.room.tick(); // one drive pass: the drop gets scheduled, it has not landed yet
    const d = env.room.data;
    expect(d.game!.trick.plays).toEqual([]);
    expect(d.dropSeat).toBe(3);
    expect(d.dropDueAt).not.toBeNull();
    env.advance(2000); // past the drop's beat; the human leader has not moved
    const g = env.room.data.game!;
    expect(g.trick.plays).toEqual([{ seat: 3, card: '3D' }]);
    expect(g.turn).toBe(0);
    // the two-card bot did not jump its turn, and the drop landed exactly once
    env.advance(2000);
    expect(env.room.data.game!.trick.plays).toEqual([{ seat: 3, card: '3D' }]);
  });
});
