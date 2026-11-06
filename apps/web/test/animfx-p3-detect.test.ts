/**
 * BWM Central Phase 3 AnimFx additions — the two detectors the audit
 * proved absent (contract secured, nil in danger). SET at hand end and
 * the sealed-nil bloom already exist (setSides / sealedNilSeats) and are
 * NOT re-tested or re-built here.
 */
import { describe, expect, it } from 'vitest';
import { makeRules, type GameState } from '@spades/rules';
import { NIL_DANGER_REMAINING, contractSecuredSides, nilDangerSeats } from '../src/animfx/detect';

const joker = makeRules('joker'); // partnerships, nil tricks do NOT count for partner by default
const booksRules = { ...joker }; // hand-1 style books hand is expressed via bids below

type Slice = Pick<GameState, 'rules' | 'bids' | 'tricksWon' | 'tricks' | 'trickCount' | 'phase'>;
const st = (o: Partial<Slice>): Slice => ({
  rules: joker,
  bids: [5, 4, 3, 4],
  tricksWon: [0, 0, 0, 0],
  tricks: [],
  trickCount: 13,
  phase: 'playing',
  ...o,
} as Slice);
const doneTricks = (n: number) => Array.from({ length: n }, () => ({ leader: 0, plays: [], winner: 0 }));

describe('contract secured: made contract mathematically certain', () => {
  it('side 0 (contract 5+3=8) secures the moment its 8th book lands', () => {
    expect(contractSecuredSides(st({ tricksWon: [5, 0, 3, 0] }))).toEqual([0]);
  });
  it('one book short is not secured', () => {
    expect(contractSecuredSides(st({ tricksWon: [5, 0, 2, 0] }))).toEqual([]);
  });
  it('both sides can be secured independently', () => {
    expect(contractSecuredSides(st({ tricksWon: [5, 4, 3, 4] }))).toEqual([0, 1]);
  });
  it('a nil partner contributes no contract and their tricks do not secure it (default rules)', () => {
    // seat 2 bids nil: side 0's contract is seat 0's 5 alone
    expect(contractSecuredSides(st({ bids: [5, 4, 'nil', 4], tricksWon: [4, 0, 1, 0] }))).toEqual([]);
    expect(contractSecuredSides(st({ bids: [5, 4, 'nil', 4], tricksWon: [5, 0, 1, 0] }))).toEqual([0]);
  });
  it('a nil-only side has no contract to secure', () => {
    expect(contractSecuredSides(st({ bids: ['nil', 4, 'blindNil', 4], tricksWon: [0, 0, 0, 0] }))).toEqual([]);
  });
  it('NEVER during a no-bidding (books) hand', () => {
    expect(contractSecuredSides(st({ bids: ['books', 'books', 'books', 'books'], tricksWon: [6, 0, 6, 0] }))).toEqual([]);
  });
  it('bidding unfinished → nothing is certain yet', () => {
    expect(contractSecuredSides(st({ bids: [5, null, 3, 4], tricksWon: [5, 0, 3, 0] }))).toEqual([]);
  });
  it('not while bidding is still the phase', () => {
    expect(contractSecuredSides(st({ phase: 'bidding', tricksWon: [5, 0, 3, 0] }))).toEqual([]);
  });
});

describe('nil in danger: clean nil, ≤4 tricks remaining', () => {
  it('fires at exactly 4 remaining and below', () => {
    expect(NIL_DANGER_REMAINING).toBe(4);
    const s = st({ bids: ['nil', 4, 3, 4], tricks: doneTricks(9) }); // 13-9 = 4 remaining
    expect(nilDangerSeats(s)).toEqual([0]);
    expect(nilDangerSeats(st({ bids: ['nil', 4, 3, 4], tricks: doneTricks(12) }))).toEqual([0]);
  });
  it('more than 4 remaining → not yet in danger', () => {
    expect(nilDangerSeats(st({ bids: ['nil', 4, 3, 4], tricks: doneTricks(8) }))).toEqual([]);
  });
  it('a busted nil (a trick taken) is no longer in danger — it is over', () => {
    expect(nilDangerSeats(st({ bids: ['nil', 4, 3, 4], tricks: doneTricks(10), tricksWon: [1, 0, 0, 0] }))).toEqual([]);
  });
  it('non-nil seats never qualify; blind nils do', () => {
    expect(nilDangerSeats(st({ bids: [5, 4, 3, 4], tricks: doneTricks(10) }))).toEqual([]);
    expect(nilDangerSeats(st({ bids: ['blindNil', 4, 3, 4], tricks: doneTricks(10) }))).toEqual([0]);
  });
});
