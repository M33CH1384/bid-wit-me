import { describe, expect, it } from 'vitest';
import {
  type GameState, applyAction, dealComplete, dealFirstHand, expectedHandCounts, isTrump, makeRules, newGame, newGameUndealt,
} from '../src/index';

/**
 * Deal completion, proven from state (owner, 2026-10-29: the misdeal window must
 * not show until the cards are fully dealt). `dealComplete` is the source of
 * truth the offer's gate reads: it must accept exactly the states `dealHand`
 * produces — every mode, the odd deck, a short Cutthroat table — and reject
 * everything short of that: the undealt shell, a card missing anywhere, a
 * card shifted between seats.
 */

const MODES = [makeRules('joker'), makeRules('aceDown'), makeRules('cutthroat'), makeRules('joker', { deck: 'joker54' })];

describe('dealComplete — freshly dealt games are complete in every mode', () => {
  it('accepts newGame across modes, seeds and dealers, with counts summing to the deck', () => {
    for (const rules of MODES) {
      for (const dealer of [0, 1, 2, 3]) {
        const st = newGame(rules, `deal-complete-${dealer}`, { dealer });
        expect(dealComplete(st), `${rules.mode}/${rules.deck ?? 'std'} dealer ${dealer}`).toBe(true);
        const expected = expectedHandCounts(st);
        expect(expected.reduce((a, b) => a + b, 0)).toBe(st.hands.reduce((a, h) => a + h.length, 0));
        expect(st.hands.map((h) => h.length)).toEqual(expected);
      }
    }
  });

  it('a three-player table deals 17 each (the deck and removals differ — the counts follow the deal, not a constant)', () => {
    // handSize() would say 13 here; the deal gives 17. The gate must read the
    // deal's own arithmetic or it would hold the offer shut forever at 3 seats.
    const st = newGame(makeRules('cutthroat', { playerCount: 3 }), 'three-handed', { dealer: 0 });
    expect(expectedHandCounts(st)).toEqual([17, 17, 17]);
    expect(st.hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(dealComplete(st)).toBe(true);
  });

  it('a misdeal redeal is itself a complete deal', () => {
    const rules = makeRules('joker', { firstHandBidsItself: false }); // hand 1 bids, so the window exists
    let st: GameState | null = null;
    for (let i = 0; i < 500 && !st; i++) {
      const g = newGame(rules, `redeal-scan-${i}`);
      if (g.phase === 'bidding' && !g.hands[0]!.some((c) => isTrump(c, g.rules))) st = g;
    }
    expect(st, 'a spade-less deal to call on').toBeTruthy();
    const redealt = applyAction(st!, { type: 'misdeal', seat: 0 });
    expect(redealt.handNo).toBe(st!.handNo);
    expect(dealComplete(redealt)).toBe(true);
  });
});

describe('dealComplete — anything short of the full deal fails', () => {
  it('the undealt shell (the server pre-deal window) is not complete; dealing it makes it so', () => {
    const shell = newGameUndealt(makeRules('joker'), 'shell');
    expect(shell.phase).toBe('bidding');
    expect(shell.hands.every((h) => h.length === 0)).toBe(true);
    expect(dealComplete(shell)).toBe(false);
    expect(dealComplete(dealFirstHand(shell))).toBe(true);
  });

  it('one card missing from ANY seat breaks it, as does a card shifted between seats', () => {
    const st = newGame(makeRules('joker'), 'short-one');
    for (let seat = 0; seat < 4; seat++) {
      const short = { ...st, hands: st.hands.map((h, s) => (s === seat ? h.slice(1) : h)) };
      expect(dealComplete(short), `seat ${seat} short`).toBe(false);
    }
    const shifted = {
      ...st,
      hands: st.hands.map((h, s) => (s === 0 ? h.slice(1) : s === 1 ? [...h, st.hands[0]![0]!] : h)),
    };
    expect(shifted.hands.reduce((a, h) => a + h.length, 0)).toBe(52); // the deck is whole — the DEAL is not
    expect(dealComplete(shifted)).toBe(false);
  });

  it('a hand mid-play (cards already down) is not a fresh complete deal', () => {
    const st = newGame(makeRules('joker'), 'mid-play');
    const played = { ...st, phase: 'playing' as const, hands: st.hands.map((h, s) => (s === 0 ? h.slice(1) : h)) };
    expect(dealComplete(played)).toBe(false);
  });
});

describe('dealComplete — a short Cutthroat table (eliminated seat)', () => {
  // Mirror of what dealHand produces once a seat is eliminated: the live seats
  // split the deck evenly (17 each at three), the eliminated seat holds nothing.
  function shortTable(liveCards: number): GameState {
    const st = newGame(makeRules('cutthroat'), 'short-table');
    const pool = st.hands.flat();
    return {
      ...st,
      eliminated: [false, false, true, false],
      trickCount: 17,
      hands: [pool.slice(0, liveCards), pool.slice(17, 17 + liveCards), [], pool.slice(34, 34 + liveCards)],
    };
  }

  it('live seats at the book count and the eliminated seat empty is complete', () => {
    const st = shortTable(17);
    expect(expectedHandCounts(st)).toEqual([17, 17, 0, 17]);
    expect(dealComplete(st)).toBe(true);
  });

  it('a live seat one card short is not', () => {
    expect(dealComplete(shortTable(16))).toBe(false);
  });
});
