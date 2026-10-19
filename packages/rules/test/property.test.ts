import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CLASSIC_JOKER, type Bid, type GameState, type TableRules, RuleError, applyAction, buildDeck, createRng, handSize, hostMinimum, legalPlays, makeRules,
  newGame, scoreHand,
} from '../src';

const presets: [string, TableRules][] = [
  ['joker', makeRules('joker')],
  ['joker deuce-high', makeRules('joker', { ...CLASSIC_JOKER, deuceOfSpadesHigh: true, blindNil: { onlyWhenBehindBy: null, exchangeCards: 2 } })],
  ['cutthroat 4', makeRules('cutthroat')],
  ['cutthroat 3', makeRules('cutthroat', { playerCount: 3 })],
  ['cutthroat 4 standard deck', makeRules('cutthroat', { deck: 'standard52' })],
  ['cutthroat 3 standard deck', makeRules('cutthroat', { playerCount: 3, deck: 'standard52' })],
  ['aceDown', makeRules('aceDown')],
];
/** Classic play (every hand bid) for the bidding properties; the books first hand gets its own properties below. */
const modes: [string, TableRules][] = presets.map(([n, r]) => [n, { ...r, firstHandBidsItself: false }]);

/** Random-but-legal driver: picks uniformly among legal moves with a seeded RNG. */
function playRandomHand(rules: TableRules, seed: string, check: (st: GameState) => void): GameState {
  const rng = createRng(`driver:${seed}`);
  let st = newGame(rules, seed);
  while (st.phase !== 'handOver' && st.phase !== 'gameOver') {
    check(st);
    const s = st.turn!;
    if (st.phase === 'bidding') {
      if (!st.revealed[s] && rng.int(2) === 0) st = applyAction(st, { type: 'reveal', seat: s });
      const opts = [1, 2, 3, 4, 'nil', 'blindNil'] as Bid[];
      for (;;) {
        try { st = applyAction(st, { type: 'bid', seat: s, bid: opts[rng.int(opts.length)]! }); break; } catch (e) { if (!(e instanceof RuleError)) throw e; }
      }
    } else if (st.phase === 'exchange') {
      st = applyAction(st, { type: 'exchange', seat: s, cards: st.hands[s]!.slice(0, st.exchange[0]!.count) });
    } else {
      const legal = legalPlays(st, s);
      expect(legal.length).toBeGreaterThan(0); // a legal move always exists
      // no illegal move is accepted
      for (const c of st.hands[s]!) {
        if (legal.includes(c)) continue;
        expect(() => applyAction(st, { type: 'play', seat: s, card: c })).toThrow(RuleError);
      }
      st = applyAction(st, { type: 'play', seat: s, card: legal[rng.int(legal.length)]! });
    }
  }
  return st;
}

describe.each(modes)('properties: %s', (_name, rules) => {
  it('every card is dealt exactly once', () => {
    fc.assert(fc.property(fc.string(), (seed) => {
      const st = newGame(rules, seed);
      const all = st.hands.flat();
      expect(all).toHaveLength(buildDeck(rules).length);
      expect(new Set(all).size).toBe(all.length);
      st.hands.forEach((h) => expect(h).toHaveLength(handSize(rules)));
    }), { numRuns: 100 });
  });

  it('random legal hands: card conservation, legal move exists, illegal moves rejected, scores add up', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
      const total = buildDeck(rules).length;
      const st = playRandomHand(rules, seed, (s) => {
        const played = s.tricks.length * rules.playerCount + s.trick.plays.length;
        expect(s.hands.flat().length + played).toBe(total);
      });
      expect(st.tricks).toHaveLength(handSize(rules));
      expect(st.tricksWon.reduce((a, b) => a + b, 0)).toBe(handSize(rules));
      const allPlayed = st.tricks.flatMap((t) => t.plays.map((p) => p.card));
      expect(new Set(allPlayed).size).toBe(total);
      const rec = st.history[0]!;
      rec.sides.forEach((side, i) => {
        const nilPts = side.nils.reduce((a, n) => a + n.points, 0);
        expect(side.points).toBe(side.contractPoints + side.bagsAdded + nilPts + side.bagPenaltyPoints + side.bookPoints);
        expect(st.scores[i]).toBe(side.points);
        expect(side.tricks).toBe(side.seats.reduce((a, s) => a + st.tricksWon[s]!, 0));
      });
    }), { numRuns: 40 });
  });
});

describe.each(presets)('first hand bids itself: %s', (_name, rules) => {
  it('hand 1 skips bidding; each side scores exactly 10 per book, no bags; hand 2 bids normally', () => {
    fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 12 }), (seed) => {
      const fresh = newGame(rules, seed);
      expect(fresh.phase).toBe('playing');
      expect(fresh.bids.every((b) => b === 'books')).toBe(true);
      const st = playRandomHand(rules, seed, () => {});
      const rec = st.history[0]!;
      const floor = hostMinimum(rules);
      rec.sides.forEach((side, i) => {
        if (floor > 0 && side.tricks < floor) {
          expect(side.points).toBe(-10 * floor);
          expect(side.contractMade).toBe(false);
          expect(side.bookPoints).toBe(0);
        } else {
          expect(side.points).toBe(10 * side.tricks);
          expect(side.contractMade).toBeNull();
        }
        expect(side.bagsAdded).toBe(0);
        expect(side.nils).toEqual([]);
        expect(st.bags[i]).toBe(0);
      });
      if (st.phase === 'handOver') expect(applyAction(st, { type: 'nextHand' }).phase).toBe('bidding');
    }), { numRuns: 25 });
  });
});

describe('scoring properties', () => {
  const r = makeRules('joker');
  it('bags never reach the penalty threshold after scoring; points reconcile', () => {
    fc.assert(fc.property(
      fc.array(fc.oneof(fc.integer({ min: 1, max: 13 }), fc.constantFrom<Bid>('nil', 'blindNil')), { minLength: 4, maxLength: 4 }),
      fc.array(fc.nat(13), { minLength: 4, maxLength: 4 }),
      fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 }),
      (bids, tricks, b0, b1) => {
        const res = scoreHand(r, bids, tricks, [0, 0], [b0, b1]);
        res.forEach((s, i) => {
          expect(s.totalBags).toBeGreaterThanOrEqual(0);
          expect(s.totalBags).toBeLessThan(r.bagsPerPenalty);
          expect(s.totalBags + s.bagPenaltyCount * r.bagsPerPenalty).toBe([b0, b1][i]! + s.bagsAdded);
          expect(s.totalScore).toBe(s.points);
        });
      },
    ));
  });
});
