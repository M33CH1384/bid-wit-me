import { describe, expect, it } from 'vitest';
import {
  type Card, type GameState, type TableRules,
  RENEGE_PENALTY_BOOKS, RuleError, acceptRules, applyAction, canCallRenege, canRunIt, honestCards, lowestLegal, makeRules,
  playableCards, renegeCallTargets, scoreHand, spectatorView, validateRules, viewFor,
} from '../src';
import { bidAll, fill, play, rigged } from './helpers';

/**
 * Renege calls (owner, 2026-11-12): a table option under which nobody is
 * locked into following suit. The engine records every renege privately; any
 * player may call an opponent on a finished book. Right: three books move to
 * the caller's side. Wrong: three books move the other way.
 */

const base: TableRules = { ...makeRules('joker'), firstHandBidsItself: false, shotOut: false };
const rules: TableRules = { ...base, renege: true };

/**
 * Seat 0 leads hearts; seat 1 holds the 5♥ and spades. Dealer 3, so seat 0 leads.
 * Bids: 3 each (sides: 0&2 bid 6, 1&3 bid 6).
 */
function table(r: TableRules = rules): GameState {
  const hands = fill(r, [
    ['AH', 'KH', 'QH', '3C', '4C'],
    ['5H', '3S', '4S', '5C', '6C'],
    ['6H', '7H', '7C', '8C'],
    ['8H', '9H', '9C', 'TC'],
  ] as Card[][]);
  return bidAll(rigged(r, hands), [3, 3, 3, 3]);
}

/** Play the hand out honestly (lowest legal card each turn). */
function playOut(st: GameState): GameState {
  while (st.phase === 'playing') {
    const seat = st.turn!;
    const plays = st.trick.plays;
    st = applyAction(st, { type: 'play', seat, card: lowestLegal(st.rules, st.hands[seat]!, plays, st.spadesBroken) });
  }
  return st;
}

/** Book 0: A♥ led, seat 1 cuts with the 3♠ while holding the 5♥ (a renege), 6♥, 8♥. Seat 1 wins it. */
function reneged(): GameState {
  return play(table(), 'AH', '3S', '6H', '8H');
}

describe('the rule option', () => {
  it('is off by default and validates as a boolean', () => {
    expect(makeRules('joker').renege).toBeUndefined();
    expect(validateRules({ ...base, renege: true })).toEqual([]);
    expect(validateRules({ ...base, renege: 'yes' as unknown as boolean })).toContain('renege must be a boolean');
    expect(acceptRules({ mode: 'joker', renege: true }).renege).toBe(true);
  });
});

describe('playing off suit', () => {
  it('is still rejected on a regular table', () => {
    const st = play(table(base), 'AH');
    expect(() => applyAction(st, { type: 'play', seat: 1, card: '3S' })).toThrowError(RuleError);
    expect(viewFor(st, 1).playable).toEqual(viewFor(st, 1).legal);
    expect(viewFor(st, 1).renege).toBeUndefined();
  });

  it('is accepted on a renege table: every card in hand is playable when following', () => {
    const st = play(table(), 'AH');
    const hearts = st.hands[1]!.filter((c) => c.endsWith('H'));
    expect(hearts).toContain('5H');
    expect(honestCards(st, 1)).toEqual(hearts);
    expect([...playableCards(st, 1)].sort()).toEqual([...st.hands[1]!].sort());
    const v = viewFor(st, 1);
    expect(v.legal).toEqual(hearts); // bots, hints and timer fallbacks stay honest
    expect(v.playable).toHaveLength(13);
    const next = applyAction(st, { type: 'play', seat: 1, card: '3S' });
    expect(next.trick.plays.map((p) => p.card)).toEqual(['AH', '3S']);
  });

  it('keeps the lead rules: spades cannot be led before they are broken', () => {
    const st = table();
    expect(playableCards(st, 0).some((c) => c.endsWith('S') || c === 'BJ' || c === 'LJ' || c === '2D')).toBe(false);
  });

  it('records the renege privately — no view carries it', () => {
    const st = reneged();
    expect(st.reneges).toHaveLength(1);
    expect(st.reneges![0]).toMatchObject({ trick: 0, seat: 1, led: 'AH', card: '3S' });
    expect(st.reneges![0]!.held).toContain('5H');
    expect(st.reneges![0]!.held.every((c) => c.endsWith('H'))).toBe(true);
    for (const v of [viewFor(st, 0), viewFor(st, 1), viewFor(st, 2), spectatorView(st)]) {
      expect(JSON.stringify(v)).not.toContain('"reneges"');
      expect(JSON.stringify(v)).not.toContain('"held"');
      expect(v.renege?.calls).toEqual([]);
    }
  });

  it('does not record an honest cut (void in the led suit) or an honest follow', () => {
    // seat 1 follows with the 5♥: nothing recorded
    expect(play(table(), 'AH', '5H').reneges).toBeUndefined();
    // seat 1 has no clubs at all: cutting a club lead is honest
    const hands = fill(rules, [['3C', 'AH'], ['3S', '5H'], ['4C'], ['5C']] as Card[][], undefined);
    const noClubs = hands.map((h, i) => (i === 1 ? h.filter((c) => !c.endsWith('C')) : h));
    const st = bidAll(rigged(rules, noClubs), [3, 3, 3, 3]);
    const led = applyAction(st, { type: 'play', seat: 0, card: '3C' });
    expect(applyAction(led, { type: 'play', seat: 1, card: '3S' }).reneges).toBeUndefined();
  });
});

describe('calling a renege', () => {
  it('needs a finished book, an opponent who followed in it, and a renege table', () => {
    const mid = play(table(), 'AH', '3S');
    expect(canCallRenege(mid, 0)).toBe(false); // no finished book yet
    const st = reneged();
    expect(canCallRenege(st, 0)).toBe(true);
    expect(renegeCallTargets(st, 0)).toEqual([{ trick: 0, targets: [1, 3] }]);
    expect(renegeCallTargets(st, 1)).toEqual([{ trick: 0, targets: [2] }]); // seat 0 led: a leader cannot renege
    const bad = (target: number, trick: number, seat = 0) => () => applyAction(st, { type: 'callRenege', seat, target, trick });
    expect(bad(2, 0)).toThrowError(/opponent/); // partner
    expect(bad(0, 0)).toThrowError(/opponent/); // self
    expect(bad(1, 5)).toThrowError(/finished book/);
    expect(bad(0, 0, 1)).toThrowError(/led that book/);
    expect(canCallRenege(play(table(base), 'AH', '5H', '6H', '8H'), 0)).toBe(false);
  });

  it('a correct call moves three books to the caller’s side, with the proof', () => {
    // seat 1 won book 0 with the renege; play two more books so their side holds three
    let st = reneged();
    // give the reneging side books to lose: fabricate standing counts
    st = { ...st, tricksWon: [0, 2, 0, 2] };
    const next = applyAction(st, { type: 'callRenege', seat: 0, target: 1, trick: 0 });
    expect(next.tricksWon[1]! + next.tricksWon[3]!).toBe(4 - RENEGE_PENALTY_BOOKS);
    expect(next.tricksWon[0]! + next.tricksWon[2]!).toBe(RENEGE_PENALTY_BOOKS);
    expect(next.renegeCalls).toEqual([
      { by: 0, target: 1, trick: 0, correct: true, books: 3, from: 1, to: 0, proof: { led: 'AH', played: '3S', held: '5H' } },
    ]);
    expect(next.reneges![0]!.called).toBe(true);
    expect(next.phase).toBe('playing');
    expect(viewFor(next, 3).renege!.calls).toHaveLength(1); // the verdict is public
  });

  it('a wrong call moves three of the caller’s books to the accused side', () => {
    let st = reneged();
    st = { ...st, tricksWon: [2, 1, 2, 0] };
    const next = applyAction(st, { type: 'callRenege', seat: 0, target: 3, trick: 0 }); // seat 3 followed honestly
    expect(next.tricksWon[0]! + next.tricksWon[2]!).toBe(1);
    expect(next.tricksWon[1]! + next.tricksWon[3]!).toBe(4);
    expect(next.renegeCalls![0]).toEqual({ by: 0, target: 3, trick: 0, correct: false, books: 3, from: 0, to: 1 });
    expect(next.reneges![0]!.called).toBeUndefined(); // the real renege is still out there
  });

  it('the same play cannot be called twice, by anyone', () => {
    const st = applyAction(reneged(), { type: 'callRenege', seat: 0, target: 1, trick: 0 });
    expect(() => applyAction(st, { type: 'callRenege', seat: 2, target: 1, trick: 0 })).toThrowError(/already been called/);
  });

  it('a side short of three books pays the rest out of the books it wins later', () => {
    const st = reneged(); // the reneging side holds exactly one book
    expect(st.tricksWon).toEqual([0, 1, 0, 0]);
    const called = applyAction(st, { type: 'callRenege', seat: 0, target: 1, trick: 0 });
    expect(called.tricksWon).toEqual([1, 0, 0, 0]);
    expect(called.renegeDebt).toEqual([{ from: 1, toSeat: 0, books: 2 }]);
    const done = playOut(called);
    const rec = done.history[done.history.length - 1]!;
    const theirs = rec.tricksWon[1]! + rec.tricksWon[3]!;
    const ours = rec.tricksWon[0]! + rec.tricksWon[2]!;
    expect(ours + theirs).toBe(13);
    // they won w books at the table and ended with max(0, w - 3)
    const wonAtTable = done.tricks.filter((t) => t.winner === 1 || t.winner === 3).length;
    expect(theirs).toBe(Math.max(0, wonAtTable - 3));
    expect(rec.renegeCalls).toHaveLength(1);
  });

  it('never lands the books on the winning side’s Nil bidder', () => {
    const hands = fill(rules, [
      ['AH', 'KH', 'QH', '3C', '4C'], ['5H', '3S', '4S', '5C', '6C'], ['6H', '7H', '7C', '8C'], ['8H', '9H', '9C', 'TC'],
    ] as Card[][]);
    let st = bidAll(rigged(rules, hands), ['nil', 3, 4, 3]);
    st = play(st, 'AH', '3S', '6H', '8H');
    st = { ...st, tricksWon: [0, 3, 0, 0] };
    const next = applyAction(st, { type: 'callRenege', seat: 0, target: 1, trick: 0 });
    expect(next.tricksWon).toEqual([0, 0, 3, 0]); // the Nil caller's partner banks them
  });

  it('after the last card: the hand is re-scored with the books moved, until the next deal', () => {
    const over = playOut(reneged());
    expect(over.phase).toBe('handOver');
    expect(canCallRenege(over, 0)).toBe(true);
    const before = over.history[over.history.length - 1]!;
    const next = applyAction(over, { type: 'callRenege', seat: 0, target: 1, trick: 0 });
    expect(next.history).toHaveLength(over.history.length);
    const after = next.history[next.history.length - 1]!;
    const moved = Math.min(3, before.tricksWon[1]! + before.tricksWon[3]!);
    expect(after.tricksWon[0]! + after.tricksWon[2]!).toBe(before.tricksWon[0]! + before.tricksWon[2]! + moved);
    const expected = scoreHand(rules, next.bids as number[], next.tricksWon, [0, 0], [0, 0]);
    expect(next.scores).toEqual(expected.map((s) => s.totalScore));
    expect(next.bags).toEqual(expected.map((s) => s.totalBags));
    expect(after.renegeCalls).toHaveLength(1);
    // the window closes with the next deal
    const dealt = applyAction(next.phase === 'handOver' ? next : over, { type: 'nextHand' });
    expect(canCallRenege(dealt, 0)).toBe(false);
    expect(dealt.reneges).toBeUndefined();
    expect(dealt.renegeCalls).toBeUndefined();
  });

  it('an honest hand on a renege table scores exactly like a regular table', () => {
    const a = playOut(play(table(), 'AH', '5H', '6H', '8H'));
    const b = playOut(play(table(base), 'AH', '5H', '6H', '8H'));
    expect(a.scores).toEqual(b.scores);
    expect(a.history[0]!.tricksWon).toEqual(b.history[0]!.tricksWon);
    expect(a.history[0]!.renegeCalls).toBeUndefined();
  });
});

describe('Run it!', () => {
  it('is never offered on a renege table: a renege would break the proof (found live, 2026-11-12)', () => {
    // every seat, every point of an honest hand: no claim, and so no play-out that can lose its line
    let st = table();
    while (st.phase === 'playing') {
      for (let s = 0; s < 4; s++) {
        expect(canRunIt(st, s)).toBe(false);
        expect(viewFor(st, s).canRunIt).toBe(false);
      }
      const seat = st.turn!;
      st = applyAction(st, { type: 'play', seat, card: lowestLegal(st.rules, st.hands[seat]!, st.trick.plays, st.spadesBroken) });
    }
    expect(() => applyAction(reneged(), { type: 'runIt', seat: 0 })).toThrowError(RuleError);
  });
});

describe('cutthroat', () => {
  it('the penalty books go to the caller', () => {
    const r: TableRules = { ...makeRules('cutthroat', { playerCount: 3 }), firstHandBidsItself: false, renege: true };
    const hands = fill(r, [['AH', 'KH'], ['5H', '3S'], ['6H', '7H']] as Card[][]);
    let st = bidAll(rigged(r, hands, 2), [3, 3, 3]);
    st = play(st, 'AH', '3S', '6H');
    expect(st.tricksWon).toEqual([0, 1, 0]);
    const next = applyAction(st, { type: 'callRenege', seat: 2, target: 1, trick: 0 });
    expect(next.tricksWon).toEqual([0, 0, 1]);
    expect(next.renegeCalls![0]).toMatchObject({ by: 2, target: 1, correct: true, from: 1, to: 2 });
  });
});
