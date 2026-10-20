import { describe, expect, it } from 'vitest';
import { makeRules, newGame as realNewGame, applyAction, RuleError, legalPlays, type TableRules } from '../src';

const newGame = (r: TableRules, seed: string) => realNewGame({ ...r, firstHandBidsItself: false, shotOut: false }, seed);

describe('hand-end: turn validation', () => {
  it('rejects all plays after hand completes', () => {
    const r = makeRules('joker');
    let st: any = newGame(r, 'hand-end-1');
    // Bid
    for (let i = 0; i < 4; i++) {
      const seat = st.turn;
      st = applyAction(st, { type: 'bid', seat, bid: 3 });
    }
    // Play full hand
    let guard = 0;
    while (st.phase === 'playing' && guard++ < 1000) {
      const seat = st.turn;
      const legal = legalPlays(st, seat);
      st = applyAction(st, { type: 'play', seat, card: legal[0]! });
    }
    expect(st.phase).toBe('handOver');
    expect(st.turn).toBeNull();
    // All seats should be rejected
    for (let seat = 0; seat < 4; seat++) {
      expect(() => applyAction(st, { type: 'play', seat, card: 'AS' })).toThrowError(RuleError);
    }
  });
});

describe('mid-hand: turn validation', () => {
  it('rejects plays from non-turn seats during play', () => {
    const r = makeRules('joker');
    let st: any = newGame(r, 'mid-hand-1');
    for (let i = 0; i < 4; i++) {
      const seat = st.turn;
      st = applyAction(st, { type: 'bid', seat, bid: 3 });
    }
    // Play first trick leader's card
    const leader = st.turn;
    const legal = legalPlays(st, leader);
    st = applyAction(st, { type: 'play', seat: leader, card: legal[0]! });
    // Now it's next player's turn; others should be rejected
    const current = st.turn;
    expect(current).not.toBe(leader);
    for (let seat = 0; seat < 4; seat++) {
      if (seat === current) continue;
      // Skip seats that already played this trick
      if (st.trick.plays.some((p: any) => p.seat === seat)) continue;
      const seatLegal = legalPlays(st, seat);
      expect(seatLegal).toEqual([]);
      const someCard = st.hands[seat][0];
      if (someCard) {
        expect(() => applyAction(st, { type: 'play', seat, card: someCard })).toThrowError(RuleError);
      }
    }
  });
});
