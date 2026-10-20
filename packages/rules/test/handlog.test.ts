import { describe, expect, it } from 'vitest';
import {
  type Action, type Card, type GameState, type Play, type TableRules, applyAction,
  HandLogBuilder, legalPlays, makeRules, newGame,
} from '../src';
import { rigged } from './helpers';

const joker = makeRules('joker', { firstHandBidsItself: false });

function freshLog(st: GameState) {
  const b = HandLogBuilder.start(st, 1700000000000);
  return { b, log: b.snapshot(), seq: { n: 0 } };
}

function step(ctx: ReturnType<typeof freshLog>, st: GameState, action: Action) {
  const before = st;
  const after = applyAction(before, action);
  ctx.seq.n += 1;
  ctx.b.record(before, after, action, ctx.seq.n);
  return after;
}

/** Drive a full hand with every legal action recorded; no-op/idempotent actions are skipped. */
function playHand(st: GameState, ctx: ReturnType<typeof freshLog>) {
  while (st.phase === 'bidding' && st.turn !== null) {
    st = step(ctx, st, { type: 'bid', seat: st.turn, bid: 2 });
  }
  while (st.phase === 'playing') {
    const seat = st.turn!;
    const legal = legalPlays(st, seat);
    expect(legal.length).toBeGreaterThan(0);
    st = step(ctx, st, { type: 'play', seat, card: legal[0]! });
  }
  return st;
}

describe('hand log', () => {
  it('captures the deal, every action, every trick and the outcome of a full hand', () => {
    let st = newGame(joker, 'handlog-full-hand');
    const ctx = freshLog(st);
    st = playHand(st, ctx);

    const log = ctx.b.snapshot();
    expect(log.v).toBe(1);
    expect(log.seed).toBe(st.seed);
    expect(log.hands).toHaveLength(1);
    const hand = log.hands[0]!;
    expect(hand.handNo).toBe(1);
    expect(hand.dealer).toBe(st.dealer);

    // the deal: 4 seats × 13 cards, 52 unique
    expect(hand.deal).toHaveLength(4);
    expect(hand.deal.every((h) => h.length === 13)).toBe(true);
    expect(new Set(hand.deal.flat()).size).toBe(52);

    // actions in order: 4 bids, then only plays (a nuke can merge the trick's remaining plays into one action)
    const types = hand.actions.map((a) => a.action.type);
    expect(types.slice(0, 4)).toEqual(['bid', 'bid', 'bid', 'bid']);
    expect(types.slice(4).every((t) => t === 'play')).toBe(true);
    // seqs monotone
    const seqs = hand.actions.map((a) => a.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));

    // 13 tricks, every one with a winner
    expect(hand.tricks).toHaveLength(13);
    expect(hand.tricks.every((t) => t.winner !== null && t.plays.length === 4)).toBe(true);
    // every played card appears exactly once across the tricks
    const trickCards = hand.tricks.flatMap((t) => t.plays.map((p) => `${p.seat}:${p.card}`));
    expect(new Set(trickCards).size).toBe(52);
    expect(new Set(trickCards.map((s) => s.split(':')[1]))).toEqual(new Set(hand.deal.flat()));

    // hand-end outcome from the engine's own record
    expect(hand.complete).toBe(true);
    expect(hand.bids).toEqual([2, 2, 2, 2]);
    expect(hand.tricksWon.reduce((a, b) => a + b, 0)).toBe(13);
    expect(hand.scores).toEqual(st.scores);
    expect(hand.bags).toEqual(st.bags);
    expect(hand.runIts).toHaveLength(0);
  });

  it('logs a runIt claim with the claimer\'s real remaining cards next to what the play-out played', () => {
    // mid-hand: seat 0 holds the two jokers and is guaranteed the last two tricks (off-turn claim)
    const n = joker.playerCount;
    const base = rigged(joker, [
      ['BJ', 'LJ'],
      ['3H', '4H'],
      ['5C', '6C'],
      ['7D', '8D'],
    ]);
    const filler: GameState['tricks'][number] = { leader: 0, plays: [], winner: 1 };
    let st: GameState = {
      ...base, phase: 'playing', bids: Array(n).fill(2),
      tricks: Array.from({ length: 11 }, () => ({ ...filler, plays: [] as Play[] })),
      tricksWon: Array(n).fill(0), turn: 1,
      trick: { leader: 1, plays: [], winner: null }, spadesBroken: true,
    };
    const ctx = freshLog(st);
    const before = st;
    st = step(ctx, st, { type: 'runIt', seat: 0 });

    expect(st.phase).toBe('handOver');
    const run = ctx.b.snapshot().hands[0]!.runIts[0]!;
    expect(run.claimer).toBe(0);
    // ground truth: the claimer's actual remaining cards when the claim landed
    expect(run.claimerHand).toEqual(before.hands[0]);
    // the play-out's plays, in order: the claimer's winning cards and everyone else's lowest
    expect(run.played.filter((p) => p.seat === 0).map((p) => p.card).sort()).toEqual(['BJ', 'LJ']);
    expect(run.played).toHaveLength(8);
    // the play-out played exactly the cards everyone still held, in order
    expect(run.played.map((p) => p.card).sort())
      .toEqual(['3H', '4H', '5C', '6C', '7D', '8D', 'BJ', 'LJ']);
    // what the recap is handed per seat matches the actual play-out
    expect(run.cleared[0]!.map((c) => c.card).sort()).toEqual(['BJ', 'LJ']);
    expect(run.cleared.flatMap((row) => row?.map((c) => c.card) ?? []).sort())
      .toEqual(run.played.map((p) => p.card).sort());
  });

  it('records a misdeal redeal without advancing the hand', () => {
    const st0 = rigged(joker, [
      ['3H', '4H', '5H', '6H', '7H', '8H', '9H', 'TH', 'JH', 'QH', 'KH', 'AH', '3C'],
      ['2S', '3S', '4S', '5S', '6S', '7S', '8S', '9S', 'TS', 'JS', 'QS', 'KS', 'AS'],
      ['2D', '3D', '4D', '5D', '6D', '7D', '8D', '9D', 'TD', 'JD', 'QD', 'KD', 'AD'],
      ['4C', '5C', '6C', '7C', '8C', '9C', 'TC', 'JC', 'QC', 'KC', 'AC', 'BJ', 'LJ'],
    ]);
    const ctx = freshLog(st0);
    // seat 0 holds no spades and no jokers: may call misdeal
    const st = step(ctx, st0, { type: 'misdeal', seat: 0 });

    expect(st.handNo).toBe(1);
    expect(st.misdeals).toBe(1);
    const hand = ctx.b.snapshot().hands[0]!;
    expect(hand.misdealRedeals).toHaveLength(1);
    expect(hand.misdealRedeals[0]!.by).toBe(0);
    expect(hand.misdealRedeals[0]!.deal).not.toEqual(hand.deal);
    expect(hand.misdealRedeals[0]!.deal[0]).toHaveLength(13);
    expect(hand.actions.map((a) => a.action.type)).toEqual(['misdeal']);
    expect(hand.complete).toBe(false);
  });

  it('opens a fresh hand entry on nextHand and keeps a per-hand action stream', () => {
    let st = newGame(joker, 'handlog-two-hands');
    const ctx = freshLog(st);
    st = playHand(st, ctx);
    const seq0 = ctx.seq.n;
    st = step(ctx, st, { type: 'nextHand' });

    const log = ctx.b.snapshot();
    expect(log.hands).toHaveLength(2);
    expect(log.hands[0]!.complete).toBe(true);
    expect(log.hands[1]!.handNo).toBe(2);
    expect(log.hands[1]!.dealer).toBe(st.dealer);
    expect(log.hands[1]!.deal).toHaveLength(4);
    expect(log.hands[1]!.actions).toHaveLength(0);
    expect(log.hands[1]!.complete).toBe(false);
    expect(log.hands[1]!.deal).not.toEqual(log.hands[0]!.deal);
    expect(ctx.seq.n).toBe(seq0 + 1);
  });
});
