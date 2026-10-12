import { describe, expect, it } from 'vitest';
import {
  type Card, type GameState, type Play, type TableRules, RuleError, applyAction, canRunIt, effectiveSuit, handSize, isTrump,
  legalPlaysFor, makeRules, newGame, spectatorView, trickWinner, viewFor,
} from '../src';
import { resetRunItProofs, runItProofsRun } from '../src/runIt';
import { rigged } from './helpers';

const joker = makeRules('joker');
const ace = makeRules('aceDown');
const cut3 = makeRules('cutthroat', { playerCount: 3 });

function expectRuleError(fn: () => unknown, code: string) {
  try { fn(); } catch (e) {
    expect(e).toBeInstanceOf(RuleError);
    expect((e as RuleError).code).toBe(code);
    expect((e as Error).message).not.toMatch(/\b[2-9TJQKA][SHDC]\b|\b[BL]J\b/);
    return;
  }
  throw new Error(`expected RuleError ${code}`);
}

/** Late position. `table` cards were already played this trick by `leader` and the seats after them, and are NOT still in `hands`. */
function playing(rules: TableRules, hands: Card[][], leader: number, table: Card[] = [], broken = true): GameState {
  const n = rules.playerCount;
  const st = rigged(rules, hands);
  const left = hands[leader]!.length + (table.length ? 1 : 0);
  const filler: GameState['tricks'][number] = { leader: 0, plays: [], winner: 1 };
  const plays = table.map((card, k) => ({ seat: (leader + k) % n, card }));
  return {
    ...st, phase: 'playing', bids: Array(n).fill(2),
    tricks: Array.from({ length: Math.max(0, handSize(rules) - left) }, () => ({ ...filler, plays: [] as Play[] })),
    tricksWon: Array(n).fill(0), turn: (leader + table.length) % n,
    trick: { leader, plays, winner: null }, spadesBroken: broken,
  };
}

function shownVoids(st: GameState): Set<string>[] {
  const n = st.rules.playerCount;
  const voids = Array.from({ length: n }, () => new Set<string>());
  const note = (plays: readonly Play[]) => {
    if (plays.length < 2) return;
    const led = effectiveSuit(plays[0]!.card, st.rules);
    for (const p of plays.slice(1)) if (effectiveSuit(p.card, st.rules) !== led) voids[p.seat]!.add(led);
  };
  for (const t of st.tricks) note(t.plays);
  note(st.trick.plays);
  return voids;
}

/** Every way to deal `st`'s outstanding cards that matches counts and shown voids. */
function enumerate(st: GameState, seat: number): Card[][][] {
  const n = st.rules.playerCount;
  const rules = st.rules;
  const voids = shownVoids(st);
  const unseen: Card[] = [];
  const counts: number[] = [];
  const seats: number[] = [];
  for (let s = 0; s < n; s++) if (s !== seat) { seats.push(s); counts.push(st.hands[s]!.length); unseen.push(...st.hands[s]!); }
  unseen.sort();
  const hands: Card[][] = seats.map(() => []);
  const deals: Card[][][] = [];
  const rec = (i: number) => {
    if (i === unseen.length) { deals.push(hands.map((h) => [...h])); return; }
    const card = unseen[i]!;
    const suit = effectiveSuit(card, rules);
    for (let k = 0; k < seats.length; k++) {
      if (hands[k]!.length >= counts[k]!) continue;
      if (voids[seats[k]!]!.has(suit)) continue;
      hands[k]!.push(card);
      rec(i + 1);
      hands[k]!.pop();
    }
  };
  rec(0);
  return deals;
}

/** Independent imperfect-info search: a strategy exists iff it wins in every enumerated deal. */
function oracle(st: GameState, seat: number): boolean {
  const rules = st.rules;
  const n = rules.playerCount;
  const seats: number[] = [];
  for (let s = 0; s < n; s++) if (s !== seat) seats.push(s);
  const deals0 = enumerate(st, seat);
  const memo = new Map<string, boolean>();
  const wins = (deals: Card[][][], hand: readonly Card[], trick: Play[], turn: number, broken: boolean): boolean => {
    if (trick.length === n) {
      if (trickWinner(trick, rules) !== seat) return false;
      if (hand.length === 0) return true;
      return wins(deals, hand, [], trickWinner(trick, rules), broken);
    }
    const sig = deals.map((d) => d.map((h) => [...h].sort().join('.')).join('/')).sort().join('#')
      + `|${[...hand].sort().join('.')}|${trick.map((p) => p.seat + p.card).join(',')}|${turn}${broken ? '!' : ''}`;
    const hit = memo.get(sig);
    if (hit !== undefined) return hit;
    let ans: boolean;
    if (turn === seat) {
      const legal = legalPlaysFor(rules, hand, trick, broken);
      ans = legal.some((card) => wins(deals, hand.filter((c) => c !== card), [...trick, { seat, card }], (turn + 1) % n, broken || isTrump(card, rules)));
    } else {
      const oi = seats.indexOf(turn);
      const next = new Map<string, Card[][][]>();
      for (const deal of deals) {
        for (const card of legalPlaysFor(rules, deal[oi]!, trick, broken)) {
          let bag = next.get(card);
          if (!bag) next.set(card, bag = []);
          bag.push(deal.map((h, i) => (i === oi ? h.filter((c) => c !== card) : h.slice())));
        }
      }
      if (next.size === 0) ans = deals.length === 0;
      else {
        ans = true;
        for (const [card, bag] of next) {
          if (!wins(bag, hand, [...trick, { seat: turn, card: card as Card }], (turn + 1) % n, broken || isTrump(card as Card, rules))) { ans = false; break; }
        }
      }
    }
    memo.set(sig, ans);
    return ans;
  };
  const hand = [...st.hands[seat]!];
  return wins(deals0, hand, st.trick.plays.map((p) => ({ seat: p.seat, card: p.card })), st.turn!, st.spadesBroken);
}

/** Old full-information question: does THIS layout have a winning line? Used only to show a peek would leak. */
function fullInfo(rules: TableRules, hands: Card[][], seat: number, trick: Play[], turn: number, broken: boolean): boolean {
  const n = rules.playerCount;
  const memo = new Map<string, boolean>();
  const ok = (h: Card[][], tr: Play[], tn: number, br: boolean): boolean => {
    if (tr.length === n) {
      if (trickWinner(tr, rules) !== seat) return false;
      if (h[seat]!.length === 0) return true;
      return ok(h, [], trickWinner(tr, rules), br);
    }
    const key = h.map((x) => [...x].sort().join('.')).join('|') + `/${tr.map((p) => p.seat + p.card).join(',')}${tn}${br ? '!' : ''}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const legal = legalPlaysFor(rules, h[tn]!, tr, br);
    const ans = tn === seat
      ? legal.some((c) => ok(h.map((x, i) => (i === tn ? x.filter((y) => y !== c) : x)), [...tr, { seat: tn, card: c }], (tn + 1) % n, br || isTrump(c, rules)))
      : legal.every((c) => ok(h.map((x, i) => (i === tn ? x.filter((y) => y !== c) : x)), [...tr, { seat: tn, card: c }], (tn + 1) % n, br || isTrump(c, rules)));
    memo.set(key, ans);
    return ans;
  };
  return ok(hands.map((h) => [...h]), trick.map((p) => ({ ...p })), turn, broken);
}

function shuffle(cards: Card[], seed: number): Card[] {
  const a = [...cards];
  let s = seed >>> 0;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

describe('Run it! hides the layout', () => {
  it('a win that depends on where the king sits is refused in every layout, and the refusal names no card', () => {
    // A♥ then Q♥ takes both books only when K♥ is singleton. If its holder keeps a second heart, they save the king.
    const peek = playing(joker, [['AH', 'QH'], ['KH', '3C'], ['4H', '5C'], ['6C', '7C']], 0);
    const save = playing(joker, [['AH', 'QH'], ['KH', '4H'], ['3C', '5C'], ['6C', '7C']], 0);
    expect(fullInfo(joker, peek.hands, 0, [], 0, true)).toBe(true);
    expect(fullInfo(joker, save.hands, 0, [], 0, true)).toBe(false);
    expect(canRunIt(peek, 0)).toBe(false);
    expect(canRunIt(save, 0)).toBe(false);
    expect(viewFor(peek, 0).canRunIt).toBe(viewFor(save, 0).canRunIt);
    expect(viewFor(peek, 0).hand).toEqual(viewFor(save, 0).hand);
    // seat 3 holds the same cards in both layouts, so its flag cannot change either
    expect(viewFor(peek, 3).hand).toEqual(viewFor(save, 3).hand);
    expect(viewFor(peek, 3).canRunIt).toBe(viewFor(save, 3).canRunIt);
    expectRuleError(() => applyAction(peek, { type: 'runIt', seat: 0 }), 'CANNOT_RUN_IT');
    expectRuleError(() => applyAction(save, { type: 'runIt', seat: 0 }), 'CANNOT_RUN_IT');
    // the peeked line really does cash both books
    let st = peek;
    for (const card of ['AH', 'KH', '4H', '6C', 'QH', '3C', '5C', '7C'] as Card[]) st = applyAction(st, { type: 'play', seat: st.turn!, card });
    expect(st.tricks.slice(-2).map((t) => t.winner)).toEqual([0, 0]);
  });

  it('an off-turn runIt probe gets the same answer for every layout of the cards that seat can see', () => {
    const yesA = playing(joker, [['BJ', 'LJ'], ['3H', '4H'], ['5C', '6C'], ['7D', '8D']], 1);
    const yesB = playing(joker, [['BJ', 'LJ'], ['8D', '6C'], ['4H', '7D'], ['5C', '3H']], 1);
    expect(yesA.turn).toBe(1);
    expect(canRunIt(yesA, 0)).toBe(true);
    expect(canRunIt(yesB, 0)).toBe(true);
    expect(viewFor(yesA, 0).canRunIt).toBe(true);
    expect(viewFor(yesB, 0).canRunIt).toBe(true);
    for (const st of [yesA, yesB]) {
      const after = applyAction(st, { type: 'runIt', seat: 0 });
      const fresh = after.tricks.slice(st.tricks.length);
      expect(fresh.map((t) => t.winner)).toEqual([0, 0]);
      expect(fresh.every((t) => t.plays.every((p) => p.run))).toBe(true);
    }
    const noA = playing(joker, [['AH', 'QH'], ['KH', '3C'], ['4H', '5C'], ['6C', '7C']], 1);
    const noB = playing(joker, [['AH', 'QH'], ['KH', '4H'], ['3C', '5C'], ['6C', '7C']], 1);
    expect(canRunIt(noA, 0)).toBe(false);
    expect(canRunIt(noB, 0)).toBe(false);
    expect(viewFor(noA, 0).canRunIt).toBe(false);
    expect(viewFor(noB, 0).canRunIt).toBe(false);
    const handsBefore = noA.hands.map((h) => [...h]);
    expectRuleError(() => applyAction(noA, { type: 'runIt', seat: 0 }), 'CANNOT_RUN_IT');
    expectRuleError(() => applyAction(noB, { type: 'runIt', seat: 0 }), 'CANNOT_RUN_IT');
    expect(noA.hands).toEqual(handsBefore);
    expect(noA.phase).toBe('playing');
  });

  it('two outstanding trumps are not a claim: one layout still has a trump left after a single spade lead', () => {
    const stacked = playing(joker, [['AS', 'AH', 'AD', 'AC'], ['3S', '4S', '5C', '6C'], ['7C', '8C', '9C', 'TC'], ['3D', '4D', '5D', '6D']], 0);
    const split = playing(joker, [['AS', 'AH', 'AD', 'AC'], ['3S', '5C', '6C', '7C'], ['4S', '8C', '9C', 'TC'], ['3D', '4D', '5D', '6D']], 0);
    expect(fullInfo(joker, stacked.hands, 0, [], 0, true)).toBe(false);
    expect(fullInfo(joker, split.hands, 0, [], 0, true)).toBe(true);
    expect(canRunIt(stacked, 0)).toBe(false);
    expect(canRunIt(split, 0)).toBe(false);
    expect(viewFor(stacked, 0).canRunIt).toBe(viewFor(split, 0).canRunIt);
    expectRuleError(() => applyAction(stacked, { type: 'runIt', seat: 0 }), 'CANNOT_RUN_IT');
    expectRuleError(() => applyAction(split, { type: 'runIt', seat: 0 }), 'CANNOT_RUN_IT');
  });

  it('one outstanding lower trump is a claim in every layout, and the play-out still takes every book', () => {
    const layouts = [
      playing(joker, [['AS', 'KS', 'AH', 'KH'], ['3S', '4C', '5C', '6C'], ['7C', '8C', '9C', 'TC'], ['3D', '4D', '5D', '6D']], 0),
      playing(joker, [['AS', 'KS', 'AH', 'KH'], ['4C', '5C', '6C', '7C'], ['3S', '8C', '9C', 'TC'], ['3D', '4D', '5D', '6D']], 0),
    ];
    for (const st of layouts) {
      expect(canRunIt(st, 0)).toBe(true);
      expect(viewFor(st, 0).canRunIt).toBe(true);
      const after = applyAction(st, { type: 'runIt', seat: 0 });
      expect(after.tricks.slice(-4).every((t) => t.winner === 0 && t.plays.every((p) => p.run))).toBe(true);
    }
  });

  it('is offered when the king has to fall in every layout', () => {
    const st = playing(joker, [['AH', 'QH'], ['KH', '3C'], ['4C', '5C'], ['6C', '7C']], 0);
    const swapped = playing(joker, [['AH', 'QH'], ['4C', '5C'], ['KH', '6C'], ['3C', '7C']], 0);
    expect(canRunIt(st, 0)).toBe(true);
    expect(canRunIt(swapped, 0)).toBe(true);
    expect(viewFor(st, 0).canRunIt).toBe(true);
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    expect(after.tricks.slice(st.tricks.length).every((t) => t.winner === 0)).toBe(true);
  });

  it('agrees with a deal-enumerating strategy search across layouts, leads, and modes', () => {
    const pool = ['AS', 'KS', 'QS', 'JS', 'AH', 'KH', 'QH', 'JH', 'AD', 'KD', '2D', '5S', '9C', '3H', '4C', '7D', '8C', '6H', 'BJ', 'LJ'] as Card[];
    const cases: { rules: TableRules; n: number; seed: number; turn: number; broken: boolean; table: boolean }[] = [];
    for (let seed = 1; seed <= 12; seed++) cases.push({ rules: joker, n: 4, seed, turn: seed % 4, broken: seed % 2 === 0, table: seed % 3 === 0 });
    for (let seed = 1; seed <= 6; seed++) cases.push({ rules: cut3, n: 3, seed: seed + 20, turn: seed % 3, broken: true, table: seed % 2 === 0 });
    for (let seed = 1; seed <= 4; seed++) cases.push({ rules: ace, n: 4, seed: seed + 40, turn: 0, broken: true, table: false });
    for (const c of cases) {
      const deck = shuffle(pool.filter((card) => c.rules.deck === 'joker54' || (card !== 'BJ' && card !== 'LJ')), c.seed);
      const hands: Card[][] = Array.from({ length: c.n }, () => []);
      deck.slice(0, c.n * 2).forEach((card, i) => hands[i % c.n]!.push(card));
      // A card already on the table comes from someone else, so seat 0 still has two cards to claim with.
      const leader = c.table ? (c.turn === 0 ? 1 : c.turn) : c.turn;
      const table: Card[] = [];
      if (c.table) table.push(hands[leader]!.pop()!);
      const st = playing(c.rules, hands, leader, table, c.broken);
      const got = canRunIt(st, 0);
      const want = oracle(st, 0);
      expect(got, JSON.stringify({ seed: c.seed, hands, table, broken: c.broken })).toBe(want);
      if (got) {
        for (const deal of enumerate(st, 0)) {
          const laid = st.hands.map((h, s) => (s === 0 ? [...h] : [...deal[s - 1]!]));
          expect(fullInfo(c.rules, laid, 0, st.trick.plays, st.turn!, st.spadesBroken)).toBe(true);
        }
        const after = applyAction(st, { type: 'runIt', seat: 0 });
        expect(after.tricks.slice(st.tricks.length).every((t) => t.winner === 0)).toBe(true);
      } else {
        expect(() => applyAction(st, { type: 'runIt', seat: 0 })).toThrow(RuleError);
      }
    }
  });
});

describe('Run it! mid-trick claim validation', () => {
  it('agrees with a deal-enumerating search when two cards are already on the table', () => {
    const pool = ['AS', 'KS', 'QS', 'JS', 'AH', 'KH', 'QH', 'JH', 'AD', 'KD', '2D', '5S', '9C', '3H', '4C', '7D', '8C', '6H', 'BJ', 'LJ'] as Card[];
    const layouts: { rules: TableRules; n: number; seed: number }[] = [];
    for (let seed = 1; seed <= 8; seed++) layouts.push({ rules: joker, n: 4, seed });
    for (let seed = 1; seed <= 4; seed++) layouts.push({ rules: cut3, n: 3, seed: seed + 20 });
    for (const c of layouts) {
      const deck = shuffle(pool.filter((card) => c.rules.deck === 'joker54' || (card !== 'BJ' && card !== 'LJ')), c.seed);
      const hands: Card[][] = Array.from({ length: c.n }, () => []);
      deck.slice(0, c.n * 2).forEach((card, i) => hands[i % c.n]!.push(card));
      // Two cards down, neither of them the claimer's, so seat 0 still holds two cards.
      const leader = 1;
      const table = [hands[leader]!.pop()!, hands[(leader + 1) % c.n]!.pop()!];
      const st = playing(c.rules, hands, leader, table, true);
      expect(st.trick.plays).toHaveLength(2);
      expect(st.hands[0]).toHaveLength(2);
      const got = canRunIt(st, 0);
      expect(got, JSON.stringify({ seed: c.seed, n: c.n, hands: st.hands, table })).toBe(oracle(st, 0));
      if (got) {
        const after = applyAction(st, { type: 'runIt', seat: 0 });
        expect(after.tricks.slice(st.tricks.length).every((t) => t.winner === 0)).toBe(true);
        const rows = viewFor(after, 0).runHands!;
        expect(rows.every((h) => h.length === rows[0]!.length)).toBe(true);
        const marked = rows.flat().filter((x) => x.played).map((x) => x.card).sort();
        expect(marked).toEqual([...table].sort());
      }
    }
  });
});

describe('Run it! is proved once per state and never for a spectator', () => {
  it('does not search on long hands, searches each short seat once, and spectators add nothing', () => {
    resetRunItProofs();
    const early = newGame(joker, 'early');
    for (let s = 0; s < 4; s++) expect(canRunIt(early, s)).toBe(false);
    expect(spectatorView(early).canRunIt).toBe(false);
    expect(runItProofsRun()).toBe(0);

    resetRunItProofs();
    const st = playing(joker, [['AS', 'KS', 'AH', 'KH'], ['QS', 'JS', 'QH', 'JH'], ['TS', '9S', 'TH', '9H'], ['8S', '7S', '8H', '7H']], 0);
    expect(spectatorView(st).canRunIt).toBe(false);
    expect(spectatorView(st).hand).toBeNull();
    expect(spectatorView(st).legal).toEqual([]);
    expect(runItProofsRun()).toBe(0);
    const t0 = performance.now();
    for (let s = 0; s < 4; s++) viewFor(st, s);
    const cold = performance.now() - t0;
    const proofs = runItProofsRun();
    expect(proofs).toBe(4);
    expect(cold).toBeLessThan(1000);
    const t1 = performance.now();
    for (let i = 0; i < 25; i++) {
      for (let s = 0; s < 4; s++) viewFor(st, s);
      spectatorView(st);
    }
    expect(performance.now() - t1).toBeLessThan(50);
    expect(runItProofsRun()).toBe(proofs);
  });
});
