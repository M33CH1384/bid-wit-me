import { describe, expect, it } from 'vitest';
import {
  makeRules, newGame as realNewGame, applyAction, RuleError,
  legalPlays, playableCards, throwInOpen, liveSeats, nukeArmed,
  type TableRules, type Card,
} from '../src';

const newGame = (r: TableRules, seed: string) => realNewGame({ ...r, firstHandBidsItself: false, shotOut: false }, seed);

function bidOut(st: any): any {
  let guard = 0;
  while (st.phase === 'bidding' && guard++ < 100) {
    st = applyAction(st, { type: 'bid', seat: st.turn, bid: 3 });
  }
  return st;
}

/** Play tricks in strict turn order until the last-card throw-in window opens. */
function toFinalTrick(st: any): any {
  st = bidOut(st);
  let guard = 0;
  while (!throwInOpen(st) && guard++ < 3000) {
    const seat = st.turn;
    st = applyAction(st, { type: 'play', seat, card: legalPlays(st, seat)[0]! });
  }
  if (!throwInOpen(st)) throw new Error('never reached the final trick');
  return st;
}

const lastCard = (st: any, seat: number): Card => playableCards(st, seat)[0]!;

describe('last-card throw-in', () => {
  it('opens on the final trick: every live seat holds exactly one card', () => {
    const r = makeRules('aceDown');
    const st = toFinalTrick(newGame(r, 'throw-open'));
    expect(throwInOpen(st)).toBe(true);
    for (const s of liveSeats(st)) expect(st.hands[s].length).toBe(1);
    expect(st.tricks.length).toBe(12);
  });

  it('lets any seat throw their last card out of turn', () => {
    const r = makeRules('aceDown');
    let st = toFinalTrick(newGame(r, 'throw-any'));
    const turnSeat = st.turn;
    const other = [0, 1, 2, 3].find((s) => s !== turnSeat)!;
    st = applyAction(st, { type: 'play', seat: other, card: lastCard(st, other) });
    expect(st.trick.plays.some((p: any) => p.seat === other)).toBe(true);
    // the turn pointer moves to a seat that has not thrown yet
    expect(st.trick.plays.some((p: any) => p.seat === st.turn)).toBe(false);
  });

  it('completes the hand when all four throw in reverse order, winner matches in-order play', () => {
    const r = makeRules('aceDown');
    const start = toFinalTrick(newGame(r, 'throw-winner'));
    const leader = start.trick.leader;

    // control: strict in-order completion
    let a: any = start;
    while (a.phase === 'playing') {
      a = applyAction(a, { type: 'play', seat: a.turn, card: lastCard(a, a.turn) });
    }
    const inOrderWinner = a.tricks[a.tricks.length - 1].winner;

    // experiment: everyone throws before the leader, leader throws last
    let b: any = start;
    for (const s of [0, 1, 2, 3].filter((s) => s !== leader)) {
      b = applyAction(b, { type: 'play', seat: s, card: lastCard(b, s) });
    }
    b = applyAction(b, { type: 'play', seat: leader, card: lastCard(b, leader) });
    expect(b.phase).toBe('handOver');
    const done = b.tricks[b.tricks.length - 1];
    expect(done.winner).toBe(inOrderWinner);
    // the stored trick is leader-first even though the cards landed out of order
    expect(done.plays[0].seat).toBe(leader);
    expect(done.plays.map((p: any) => p.seat).sort()).toEqual([0, 1, 2, 3]);
  });

  it('still enforces turn order on non-final tricks', () => {
    const r = makeRules('aceDown');
    let st = bidOut(newGame(r, 'throw-turn'));
    expect(throwInOpen(st)).toBe(false);
    const leader = st.turn;
    st = applyAction(st, { type: 'play', seat: leader, card: legalPlays(st, leader)[0]! });
    const current = st.turn;
    expect(current).not.toBe(leader);
    const intruder = [0, 1, 2, 3].find((s) => s !== current && !st.trick.plays.some((p: any) => p.seat === s))!;
    const card = st.hands[intruder][0];
    expect(() => applyAction(st, { type: 'play', seat: intruder, card })).toThrowError(RuleError);
    expect(playableCards(st, intruder)).toEqual([]);
  });

  it('keeps one-card-per-seat and card legality during the throw-in', () => {
    const r = makeRules('aceDown');
    let st = toFinalTrick(newGame(r, 'throw-once'));
    const seat = [0, 1, 2, 3].find((s) => s !== st.turn)!;
    const card = lastCard(st, seat);
    st = applyAction(st, { type: 'play', seat, card });
    // retrying the same card is an idempotent no-op
    const again = applyAction(st, { type: 'play', seat, card });
    expect(again.trick.plays.filter((p: any) => p.seat === seat).length).toBe(1);
    // a card that is not theirs is still rejected
    const foreign: Card = st.hands[(seat + 1) % 4][0] ?? 'AS';
    expect(() => applyAction(st, { type: 'play', seat: (seat + 2) % 4, card: foreign })).toThrowError(RuleError);
  });

  it('playableCards mirrors the window: [] out of turn mid-hand, the card on the final trick', () => {
    const r = makeRules('aceDown');
    const mid = bidOut(newGame(r, 'throw-view-mid'));
    const nonTurn = [0, 1, 2, 3].find((s) => s !== mid.turn)!;
    expect(playableCards(mid, nonTurn)).toEqual([]);

    const fin = toFinalTrick(newGame(r, 'throw-view-fin'));
    for (const s of [0, 1, 2, 3]) {
      expect(playableCards(fin, s)).toEqual([fin.hands[s][0]]);
    }
  });

  it('armed nuke stays order-safe when both jokers are thrown out of turn on the final trick', () => {
    const r = makeRules('joker');
    // find a deal whose final trick has the jokers in two different live hands
    let found: any = null;
    for (let i = 0; i < 400 && !found; i++) {
      const st = toFinalTrick(newGame(r, `nuke-hunt-${i}`));
      const bj = [0, 1, 2, 3].find((s) => st.hands[s].includes('BJ'));
      const lj = [0, 1, 2, 3].find((s) => st.hands[s].includes('LJ'));
      if (bj !== undefined && lj !== undefined && bj !== lj) found = { st, bj, lj };
    }
    expect(found).not.toBeNull();
    let { st, bj, lj } = found;
    const leader = st.trick.leader;
    // throw both jokers out of turn (neither is the leader if possible)
    st = applyAction(st, { type: 'play', seat: bj, card: 'BJ' as Card });
    st = applyAction(st, { type: 'play', seat: lj, card: 'LJ' as Card });
    // the nuke is ARMED, not fired: nothing auto-plays, the trick stays open for the rest
    expect(st.phase).toBe('playing');
    expect(st.tricks.length).toBe(12);
    expect(st.trick.plays).toHaveLength(2);
    expect(nukeArmed(st)).toBe(true);
    expect(st.nukes).toBeUndefined();
    // the remaining seats throw their own last cards (out of turn, either order)
    const rest = [0, 1, 2, 3].filter((s) => s !== bj && s !== lj).reverse();
    for (const s of rest) st = applyAction(st, { type: 'play', seat: s, card: lastCard(st, s) });
    // now the trick completes with exactly one card per seat, leader first
    expect(st.tricks.length).toBe(13);
    const done = st.tricks[st.tricks.length - 1];
    expect(done.plays.map((p: any) => p.seat).sort()).toEqual([0, 1, 2, 3]);
    expect(done.plays.some((p: any) => p.auto)).toBe(false);
    expect(done.plays[0].seat).toBe(leader);
    expect(done.winner).toBe(bj);
    expect(st.nukes).toBeDefined();
    expect(st.phase === 'handOver' || st.phase === 'gameOver').toBe(true);
  });
});
