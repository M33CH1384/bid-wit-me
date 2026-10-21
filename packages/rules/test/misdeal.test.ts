import { describe, expect, it } from 'vitest';
import {
  type Card, type GameState, RuleError, applyAction, bidOrder, canMisdeal, isTrump, makeRules, newGame, nextDealer, spectatorView, viewFor,
} from '../src/index';

function expectRuleError(fn: () => unknown, code: string) {
  try { fn(); } catch (e) { expect((e as RuleError).code).toBe(code); return; }
  throw new Error(`expected RuleError ${code}`);
}

const joker = makeRules('joker', { firstHandBidsItself: false }); // hand 1 bids (no books hand) so the window exists
const noTrump = (st: GameState, seat: number) => !st.hands[seat]!.some((c) => isTrump(c, st.rules));

/** A fresh game (scanning seeds) where `seat` was dealt no spades at all. */
function spadeLessGame(rules = joker, seat = 0): GameState {
  for (let i = 0; i < 500; i++) {
    const st = newGame(rules, `misdeal-scan-${i}`);
    if (st.phase === 'bidding' && noTrump(st, seat)) return st;
  }
  throw new Error('no spade-less deal found');
}

describe('Call misdeal — eligibility', () => {
  it('a spade-less hand, seen, before bidding is a call', () => {
    const st = spadeLessGame();
    expect(st.hands[0]!.length).toBe(13);
    expect(canMisdeal(st, 0)).toBe(true);
  });

  it('any spade at all — suit card, Joker, or trump deuce — kills it', () => {
    const st = spadeLessGame();
    for (const trump of ['AS', 'BJ', '2D'] as Card[]) {
      const withTrump: GameState = { ...st, hands: st.hands.map((h, i) => (i === 0 ? [...h.slice(1), trump] : h)) };
      expect(canMisdeal(withTrump, 0)).toBe(false);
    }
    // and seats holding spades in the scanned game are refused
    for (let s = 1; s < 4; s++) if (!noTrump(st, s)) expect(canMisdeal(st, s)).toBe(false);
  });

  it('bidding is the decline: your own bid closes it, another seat’s bid does not', () => {
    const st = spadeLessGame();
    const someoneElseBid: GameState = { ...st, bids: st.bids.map((b, i) => (i === 1 ? 3 : b)) };
    expect(canMisdeal(someoneElseBid, 0)).toBe(true);
    const iBid: GameState = { ...st, bids: st.bids.map((b, i) => (i === 0 ? 3 : b)) };
    expect(canMisdeal(iBid, 0)).toBe(false);
  });

  it('it dies with the bidding phase — a first card played is far too late', () => {
    const st = spadeLessGame();
    expect(canMisdeal({ ...st, phase: 'playing' }, 0)).toBe(false);
    expect(canMisdeal({ ...st, phase: 'handOver' }, 0)).toBe(false);
  });

  it('you must have seen the hand (no calling on a Blind Nil peek)', () => {
    const st = spadeLessGame();
    const unseen: GameState = { ...st, revealed: st.revealed.map((r, i) => (i === 0 ? false : r)) };
    expect(canMisdeal(unseen, 0)).toBe(false);
    const seen = applyAction(unseen, { type: 'reveal', seat: 0 });
    expect(canMisdeal(seen, 0)).toBe(true);
  });

  it('an eliminated Cutthroat seat can never call', () => {
    const cut = makeRules('cutthroat', { playerCount: 4, firstHandBidsItself: false });
    const st = spadeLessGame(cut, 1);
    expect(canMisdeal(st, 1)).toBe(true);
    const out: GameState = { ...st, eliminated: [false, true, false, false] };
    expect(canMisdeal(out, 1)).toBe(false);
  });

  it('applyAction refuses an ineligible call with NO_MISDEAL', () => {
    const st = spadeLessGame();
    const withTrump: GameState = { ...st, hands: st.hands.map((h, i) => (i === 0 ? [...h.slice(1), 'AS'] : h)) };
    expectRuleError(() => applyAction(withTrump, { type: 'misdeal', seat: 0 }), 'NO_MISDEAL');
  });

  it('applyAction refuses the call once your own bid is in, even mid-round', () => {
    const st = spadeLessGame();
    const iBid: GameState = { ...st, bids: st.bids.map((b, i) => (i === 0 ? 3 : b)) };
    expectRuleError(() => applyAction(iBid, { type: 'misdeal', seat: 0 }), 'NO_MISDEAL');
  });

  it('the last bidder can still call with three bids in — and the redeal voids those bids', () => {
    // Real bidding through applyAction: everyone ahead of the spade-less seat bids in turn.
    // This is the owner's seat — he dealt, so he bids last — where the call must stay reachable.
    let cur: GameState | null = null;
    for (let i = 0; i < 500 && !cur; i++) {
      const st = newGame(joker, `misdeal-last-${i}`, { dealer: 0 });
      if (st.phase === 'bidding' && noTrump(st, 0)) cur = st;
    }
    if (!cur) throw new Error('no spade-less dealer deal found');
    let guard = 0;
    while (cur.turn !== 0 && guard++ < 8) {
      const turn = cur.turn;
      if (turn === null) break;
      const v = viewFor(cur, turn);
      cur = applyAction(cur, { type: 'bid', seat: turn, bid: Math.max(1, v.bidOptions!.min) });
    }
    expect(cur.bids.filter((b) => b !== null)).toHaveLength(3);
    expect(cur.phase).toBe('bidding');
    expect(canMisdeal(cur, 0)).toBe(true);
    expect(viewFor(cur, 0).canMisdeal).toBe(true);
    const next = applyAction(cur, { type: 'misdeal', seat: 0 });
    expect(next.phase).toBe('bidding');
    expect(next.bids.every((b) => b === null)).toBe(true); // the placed bids die with the hand
    expect(next.handNo).toBe(cur.handNo);
    expect(next.misdealReveal?.seat).toBe(0);
    // he dealt (seat 0), so the redeal passes the deal on: seat 1 deals, and bidding opens
    // with the first bidder of the NEW dealer's order
    expect(next.dealer).toBe(1);
    expect(next.turn).toBe(bidOrder(next.rules, next.dealer)[0]);
  });
});

describe('Call misdeal — the redeal', () => {
  // Owner-ordered rule change (2026-10-21): a misdeal redeal now PASSES the deal to the next
  // dealer, like a normal end of hand. The previous pin asserted the same dealer stayed; that
  // was the old rule, not a regression guard.
  it('same hand, same scores and series — but the deal passes to the next dealer', () => {
    const base = spadeLessGame();
    const st: GameState = {
      ...base,
      scores: [140, -60], bags: [3, 7],
      history: [{ handNo: 0, dealer: 0, bids: [], tricksWon: [], sides: [] }],
      failStreak: [1, 0, 2, 0],
    };
    const thrown = [...st.hands[0]!];
    const next = applyAction(st, { type: 'misdeal', seat: 0 });
    expect(next.handNo).toBe(st.handNo);
    expect(next.dealer).toBe(nextDealer(st));
    expect(next.dealer).not.toBe(st.dealer);
    expect(next.scores).toEqual([140, -60]);
    expect(next.bags).toEqual([3, 7]);
    expect(next.history).toEqual(st.history);
    expect(next.failStreak).toEqual([1, 0, 2, 0]);
    expect(next.phase).toBe('bidding');
    expect(next.bids.every((b) => b === null)).toBe(true);
    expect(next.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(next.misdeals).toBe(1);
    // a fresh shuffle, not the same cards back
    expect(next.hands).not.toEqual(st.hands);
  });

  it('is deterministic: host and every client derive the same redeal', () => {
    const st = spadeLessGame();
    expect(applyAction(st, { type: 'misdeal', seat: 0 })).toEqual(applyAction(st, { type: 'misdeal', seat: 0 }));
  });

  it('the thrown hand rides face up in EVERY seat’s view — the online proof', () => {
    const st = spadeLessGame();
    const thrown = [...st.hands[0]!];
    const next = applyAction(st, { type: 'misdeal', seat: 0 });
    expect(next.misdealReveal).toEqual({ seat: 0, cards: thrown });
    for (let s = 0; s < 4; s++) {
      expect(viewFor(next, s).misdealReveal).toEqual({ seat: 0, cards: thrown });
    }
    expect(spectatorView(next).misdealReveal).toEqual({ seat: 0, cards: thrown });
    expect(spectatorView(next).canMisdeal).toBe(false);
    // the next ordinary deal clears it
    const later = { ...next, phase: 'handOver' as const };
    const hand2 = applyAction(later, { type: 'nextHand' });
    expect(hand2.misdealReveal).toBeUndefined();
    expect(hand2.misdeals).toBe(0);
  });

  it('the rule reapplies to the fresh deal (misdeal loops are legal)', () => {
    const st = spadeLessGame();
    const next = applyAction(st, { type: 'misdeal', seat: 0 });
    // rig the fresh deal spade-less again: eligibility is a pure read of the state
    const rigged: GameState = { ...next, hands: st.hands };
    expect(canMisdeal(rigged, 0)).toBe(true);
    const twice = applyAction(rigged, { type: 'misdeal', seat: 0 });
    expect(twice.misdeals).toBe(2);
    expect(twice.handNo).toBe(st.handNo);
    // and the deal passed on BOTH calls — two seats on from where the hand started
    expect(next.dealer).toBe((st.dealer + 1) % 4);
    expect(twice.dealer).toBe((st.dealer + 2) % 4);
  });

  it('the deal advances exactly one seat per misdeal, from every starting dealer (wrap-around included)', () => {
    for (let d = 0; d < 4; d++) {
      let cur: GameState | null = null;
      let caller = -1;
      for (let i = 0; i < 500 && !cur; i++) {
        const st = newGame(joker, `misdeal-pass-${d}-${i}`, { dealer: d });
        if (st.phase !== 'bidding') continue;
        const s = st.hands.findIndex((h, seat) => h.length > 0 && noTrump(st, seat));
        if (s >= 0) { cur = st; caller = s; }
      }
      if (!cur) throw new Error(`no spade-less deal found for dealer ${d}`);
      expect(cur.dealer).toBe(d);
      const next = applyAction(cur, { type: 'misdeal', seat: caller });
      expect(next.dealer).toBe((d + 1) % 4); // seat 3 wraps to seat 0
      expect(next.handNo).toBe(cur.handNo);
      // bidding opens with the new dealer's first bidder, exactly like a fresh hand
      expect(next.turn).toBe(bidOrder(next.rules, next.dealer)[0]);
    }
  });

  it('whoever calls it, the deal passes the same one seat', () => {
    const st = spadeLessGame();
    // rig a second eligible caller (seat 2 holds the same spade-less cards — eligibility
    // is a pure read, and the redeal deals a fresh deck from the seed either way)
    const rigged: GameState = { ...st, hands: st.hands.map((h, i) => (i === 2 ? [...st.hands[0]!] : h)) };
    expect(canMisdeal(rigged, 2)).toBe(true);
    expect(applyAction(st, { type: 'misdeal', seat: 0 }).dealer).toBe((st.dealer + 1) % 4);
    expect(applyAction(rigged, { type: 'misdeal', seat: 2 }).dealer).toBe((st.dealer + 1) % 4);
  });

  it('Cutthroat: the pass is the normal hand-end rotation — the button can land on an eliminated seat', () => {
    const cut = makeRules('cutthroat', { playerCount: 4, firstHandBidsItself: false });
    const st = spadeLessGame(cut, 0);
    // the same rotation a normal next hand takes from this exact state
    const viaNextHand = applyAction({ ...st, phase: 'handOver' as const }, { type: 'nextHand' });
    const viaMisdeal = applyAction(st, { type: 'misdeal', seat: 0 });
    expect(viaMisdeal.dealer).toBe(viaNextHand.dealer);
    expect(viaMisdeal.dealer).toBe((st.dealer + 1) % 4);
    // and when the incoming dealer is already out, the button still sits on them by design;
    // the cards just deal around them (nobody new is dealt in or out by the pass)
    let base: GameState | null = null;
    for (let i = 0; i < 500 && !base; i++) {
      const g = newGame(cut, `misdeal-cut-out-${i}`, { dealer: 1 });
      if (g.phase === 'bidding' && noTrump(g, 0)) base = g;
    }
    if (!base) throw new Error('no spade-less cutthroat deal found');
    const withOut: GameState = { ...base, eliminated: [false, false, true, false] }; // seat 2 = the incoming dealer
    const next = applyAction(withOut, { type: 'misdeal', seat: 0 });
    expect(next.dealer).toBe(2);
    expect(next.hands[2]).toHaveLength(0);
    expect(next.hands.filter((h) => h.length > 0)).toHaveLength(3);
  });

  it('view.canMisdeal tracks the engine exactly', () => {
    const st = spadeLessGame();
    expect(viewFor(st, 0).canMisdeal).toBe(true);
    const bid: GameState = { ...st, bids: st.bids.map((b, i) => (i === 0 ? 4 : b)) };
    expect(viewFor(bid, 0).canMisdeal).toBe(false);
  });
});
