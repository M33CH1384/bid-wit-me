import { describe, expect, it } from 'vitest';
import { type GameState, makeRules, scoreHand } from '@spades/rules';
import { buildRecord } from '../src/stats/record';

/** Minimal finished game whose history is whatever scoreHand produced. */
function finished(rules: ReturnType<typeof makeRules>, hands: { bids: GameState['history'][number]['bids']; tricks: number[] }[]): GameState {
  let scores = Array(rules.partnerships ? 2 : rules.playerCount).fill(0);
  let bags = [...scores];
  const history: GameState['history'] = [];
  for (const [i, h] of hands.entries()) {
    const sides = scoreHand(rules, h.bids, h.tricks, scores, bags);
    history.push({ handNo: i + 1, dealer: 0, bids: [...h.bids], tricksWon: [...h.tricks], sides });
    scores = sides.map((s) => s.totalScore);
    bags = sides.map((s) => s.totalBags);
  }
  const g = {
    rules, seed: 'bags', phase: 'gameOver', handNo: hands.length, dealer: 0, turn: null,
    hands: Array.from({ length: rules.playerCount }, () => []),
    bids: Array(rules.playerCount).fill(null), revealed: Array(rules.playerCount).fill(true),
    exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: Array(rules.playerCount).fill(0),
    spadesBroken: true, scores, bags, history,
    result: { endReason: 'target' as const, finalScores: scores, placements: scores.map(() => 1), winners: [0] },
  };
  return g as GameState;
}

const seats = [
  { name: 'You', side: 0, kind: 'user' as const, uid: 'u' },
  { name: 'Opp', side: 1, kind: 'bot' as const },
  { name: 'Partner', side: 0, kind: 'bot' as const },
  { name: 'Opp2', side: 1, kind: 'bot' as const },
];

describe('bags follow scoreHand, including sets', () => {
  it('a busted nil on a set still adds those bags', () => {
    const rules = makeRules('joker');
    const bids = ['nil', 3, 4, 3] as const;
    const tricks = [2, 3, 3, 5];
    const [side] = scoreHand(rules, bids, tricks, [0, 0], [0, 0]);
    expect(side!.contractMade).toBe(false);
    expect(side!.bagsAdded).toBe(2);
    const rec = buildRecord({ id: 'b1', room: 'R', game: finished(rules, [{ bids: [...bids], tricks }]), seats, names: ['You', 'Opp'], endedAt: 1 });
    expect(rec.players[0]!.stats.bags).toBe(2);
    expect(rec.players[0]!.stats.set).toBe(0); // the user bid nil, not the number
    expect(rec.players[0]!.stats.nilBids).toBe(1);
  });

  it('counts overtrick bags on a make, and nothing on a books hand or when bags are off', () => {
    const rules = makeRules('joker');
    const made = { bids: [4, 3, 2, 3] as const, tricks: [5, 3, 3, 2] };
    const [madeSide] = scoreHand(rules, made.bids, made.tricks, [0, 0], [0, 0]);
    expect(madeSide!.contractMade).toBe(true);
    expect(madeSide!.bagsAdded).toBeGreaterThan(0);
    const books = { bids: ['books', 'books', 'books', 'books'] as const, tricks: [4, 3, 4, 2] };
    const [booksSide] = scoreHand(rules, books.bids, books.tricks, [0, 0], [0, 0]);
    expect(booksSide!.bagsAdded).toBe(0);
    const off = makeRules('joker', { bagsOn: false });
    const [offSide] = scoreHand(off, made.bids, made.tricks, [0, 0], [0, 0]);
    expect(offSide!.bagsAdded).toBe(0);

    const rec = buildRecord({
      id: 'b2', room: 'R', endedAt: 1, names: ['You', 'Opp'], seats,
      game: finished(rules, [{ bids: [...made.bids], tricks: made.tricks }, { bids: [...books.bids], tricks: books.tricks }]),
    });
    expect(rec.players[0]!.stats.bags).toBe(madeSide!.bagsAdded);
    expect(rec.players[0]!.stats.made).toBe(1);

    const quiet = buildRecord({
      id: 'b3', room: 'R', endedAt: 1, names: ['You', 'Opp'], seats,
      game: finished(off, [{ bids: [...made.bids], tricks: made.tricks }]),
    });
    expect(quiet.players[0]!.stats.bags).toBe(0);
  });

  it('counts bags on a no-contract hand', () => {
    const rules = makeRules('joker');
    const bids = ['nil', 5, 'nil', 5] as const;
    const tricks = [1, 6, 0, 6];
    const [side] = scoreHand(rules, bids, tricks, [0, 0], [0, 0]);
    expect(side!.contractMade).toBeNull();
    expect(side!.bagsAdded).toBe(1);
    const rec = buildRecord({ id: 'b4', room: 'R', game: finished(rules, [{ bids: [...bids], tricks }]), seats, names: ['You', 'Opp'], endedAt: 1 });
    expect(rec.players[0]!.stats.bags).toBe(1);
  });
});
