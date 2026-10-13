import { describe, expect, it } from 'vitest';
import {
  type Card, RuleError, applyAction, bidOptions, bidOrder, buildDeck, defaultRules, handSize, isTrump, makeRules, newGame,
  scoreHand, sideCount, validateRules, viewFor,
} from '../src';

const noBooks = { firstHandBidsItself: false } as const;

describe('Cutthroat', () => {
  it('defaults: no teams, to 300, min bid 1, Nil and Blind Nil off, bags on, no separate books minimum', () => {
    for (const pc of [3, 4] as const) {
      const r = defaultRules('cutthroat', pc);
      expect(r.partnerships).toBe(false);
      expect(sideCount(r)).toBe(pc); // bids, scores and bags are per player
      expect(r.targetScore).toBe(300);
      expect(r.minTeamBid).toBe(1);
      expect(r.nil.allowed).toBe(false);
      expect(r.blindNil.allowed).toBe(false);
      expect(r.bagsOn).not.toBe(false);
      expect(r.firstHandMin).toBeNull();
      expect(validateRules(r)).toEqual([]);
    }
  });

  for (const deck of ['standard52', 'joker54'] as const) {
    it(`4-man (${deck}): 52 cards in play, 13 each, 13 books`, () => {
      const r = makeRules('cutthroat', { playerCount: 4, deck, ...noBooks });
      expect(buildDeck(r)).toHaveLength(52);
      expect(handSize(r)).toBe(13);
      if (deck === 'standard52') expect(r.removedCards).toEqual([]);
      const st = newGame(r, `ct4-${deck}`);
      expect(st.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
      expect(new Set(st.hands.flat()).size).toBe(52);
    });
  }

  it('3-man standard deck: the 2♣ is removed (lowest non-trump), 17 each, 17 books', () => {
    const r = makeRules('cutthroat', { playerCount: 3, deck: 'standard52', ...noBooks });
    expect(r.removedCards).toEqual(['2C']);
    expect(buildDeck(r)).toHaveLength(51);
    expect(handSize(r)).toBe(17);
  });

  it('3-man Joker deck (54): 2♣, 2♥, 3♣ removed, the 2♦ / 2♠ trumps stay, 17 each', () => {
    const r = makeRules('cutthroat', { playerCount: 3, deck: 'joker54', ...noBooks });
    expect(r.removedCards).toEqual(['2C', '2H', '3C']);
    const d = buildDeck(r);
    expect(d).toHaveLength(51);
    for (const c of ['BJ', 'LJ', '2D', '2S'] as Card[]) expect(d).toContain(c);
  });

  it('removed cards are never a spade or any trump', () => {
    for (const deck of ['standard52', 'joker54'] as const) {
      for (const pc of [3, 4] as const) {
        const r = makeRules('cutthroat', { playerCount: pc, deck });
        for (const c of r.removedCards) { expect(isTrump(c, r)).toBe(false); expect(c.endsWith('S')).toBe(false); }
      }
    }
    expect(() => makeRules('cutthroat', { playerCount: 3, deck: 'standard52', removedCards: ['2S'] })).toThrow(/spades/);
  });

  it('3-man: the removed card is never dealt, in any hand or any seat view, across many hands', () => {
    for (const deck of ['standard52', 'joker54'] as const) {
      const r = makeRules('cutthroat', { playerCount: 3, deck, ...noBooks });
      let st = newGame(r, `ct3-${deck}`);
      for (let h = 0; h < 25; h++) {
        expect(st.hands.map((x) => x.length)).toEqual([17, 17, 17]);
        expect(new Set(st.hands.flat()).size).toBe(51);
        for (const c of r.removedCards) {
          expect(st.hands.flat()).not.toContain(c);
          for (let s = 0; s < 3; s++) expect(viewFor(st, s).hand ?? []).not.toContain(c);
        }
        // fast-forward: everyone bids 1 and plays their first legal card until the hand ends
        while (st.phase === 'bidding') st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 1 });
        while (st.phase === 'playing') {
          const v = viewFor(st, st.turn!);
          st = applyAction(st, { type: 'play', seat: st.turn!, card: v.legal[0]! });
        }
        expect(st.tricks).toHaveLength(17); // 17 books
        if (st.phase === 'gameOver') break;
        st = applyAction(st, { type: 'nextHand' });
      }
    }
  });

  it('bids go clockwise from the dealer\'s left (3 and 4 players)', () => {
    expect(bidOrder({ partnerships: false, playerCount: 4 }, 2)).toEqual([3, 0, 1, 2]);
    expect(bidOrder({ partnerships: false, playerCount: 3 }, 1)).toEqual([2, 0, 1]);
    const st = newGame(makeRules('cutthroat', { playerCount: 3, ...noBooks }), 'order');
    expect(st.turn).toBe((st.dealer + 1) % 3);
  });

  it('Nil and Blind Nil stay off, and the minimum bid applies', () => {
    const off = newGame(makeRules('cutthroat', { playerCount: 4, nil: { allowed: true }, blindNil: { allowed: true }, minTeamBid: 3, ...noBooks }), 'nil-off');
    expect(off.rules.nil.allowed).toBe(false);
    expect(off.rules.blindNil.allowed).toBe(false);
    const opt = bidOptions(off, off.turn!);
    expect(opt).toMatchObject({ min: 3, nil: false, blindNil: false, blockReason: 'Minimum bid is 3' });
    expect(() => applyAction(off, { type: 'bid', seat: off.turn!, bid: 0 })).toThrow(/Nil is off in Cutthroat/);
    expect(() => applyAction(off, { type: 'bid', seat: off.turn!, bid: 'blindNil' })).toThrow(/Blind Nil is off in Cutthroat/);
    expect(() => applyAction(off, { type: 'bid', seat: off.turn!, bid: 2 })).toThrow(/Minimum bid is 3/);
    expect(applyAction(off, { type: 'bid', seat: off.turn!, bid: 3 }).bids[off.turn!]).toBe(3);
  });

  it('minimum bid 1–4 is each player\'s own minimum', () => {
    for (const min of [1, 2, 3, 4]) {
      const st = newGame(makeRules('cutthroat', { playerCount: 3, minTeamBid: min, ...noBooks }), `min${min}`);
      for (let s = 0; s < 3; s++) expect(bidOptions(st, s).min).toBe(min);
    }
  });

  it('Blind Nil off by default: nobody is offered it, cards are revealed', () => {
    const r = makeRules('cutthroat', { playerCount: 4, ...noBooks });
    let st = newGame(r, 'bn');
    st = { ...st, scores: [0, 400, 0, 0] }; // even far behind
    expect(st.revealed.every(Boolean)).toBe(true);
    expect(bidOptions(st, 0).blindNil).toBe(false);
    expect(() => applyAction(st, { type: 'bid', seat: st.turn!, bid: 'blindNil' })).toThrow(RuleError);
    // A host override cannot turn it back on.
    const on = newGame(makeRules('cutthroat', { playerCount: 4, blindNil: { allowed: true, onlyWhenBehindBy: null }, ...noBooks }), 'bn-on');
    expect(on.rules.blindNil.allowed).toBe(false);
    expect(on.revealed.every(Boolean)).toBe(true);
    expect(bidOptions(on, on.turn!).blindNil).toBe(false);
  });

  it('per-player scoring; bags and penalties can be turned off', () => {
    const r = makeRules('cutthroat', { playerCount: 3 });
    const bids = [3, 'nil', 5] as const;
    const won = [6, 0, 11];
    const on = scoreHand(r, [...bids], won, [0, 0, 0], [0, 0, 8]);
    expect(on.map((s) => s.points)).toEqual([33, 100, 50 + 6 - 100]); // P3's 6 bags hit 14 → one penalty
    expect(on.map((s) => s.totalBags)).toEqual([3, 0, 4]);
    const off = scoreHand({ ...r, bagsOn: false }, [...bids], won, [0, 0, 0], [0, 0, 8]);
    expect(off.map((s) => s.points)).toEqual([30, 100, 50]);
    expect(off.map((s) => s.bagPenaltyCount)).toEqual([0, 0, 0]);
  });
});
