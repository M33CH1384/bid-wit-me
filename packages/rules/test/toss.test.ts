import { describe, expect, it } from 'vitest';
import {
  type Card, type GameState, type HandRecord, type TableRules, type Trick,
  RuleError, applyAction, makeRules, newGame, scoreHand, scoreTossedHand, shotCounts,
  tossStatus, nilUnbustable, viewFor, spectatorView,
} from '../src';

/**
 * Toss-the-hand poll (owner, 2026-11-05): when a partnership side's set is
 * mathematically locked (books + tricks remaining < its bid), the table may
 * vote to toss the hand. The hand scores FLAT on the contracts: set side
 * −bid×10, winning side +bid×10, no books or bags from played tricks on top.
 * A live, still-bustable Nil blocks the toss outright — a Nil plays out
 * unless it is busted already or provably cannot be busted.
 */

const rules: TableRules = { ...makeRules('joker'), firstHandBidsItself: false };
const cutthroat = makeRules('cutthroat', { playerCount: 3 });

/** Fabricated completed tricks from a winner list (cards are dummies; only winners matter). */
function played(winners: number[]): { tricks: Trick[]; tricksWon: number[] } {
  const tricksWon = [0, 0, 0, 0];
  const dummy = ['3C', '4C', '5C', '6C'] as const; // in-deck cards; only winners matter
  const tricks: Trick[] = winners.map((w, i) => {
    tricksWon[w]!++;
    return { leader: (w + 3) % 4, plays: [0, 1, 2, 3].map((s) => ({ seat: s, card: dummy[s]! })), winner: w };
  });
  return { tricks, tricksWon };
}

/** A mid-hand state by surgery on a fresh deal: bids placed, some tricks played. */
function midHand(o: {
  bids: (number | 'nil' | 'blindNil')[]; winners: number[];
  scores?: number[]; bags?: number[]; handNo?: number; history?: HandRecord[];
  hands?: Card[][]; turn?: number; trickPlays?: { seat: number; card: Card }[];
  r?: TableRules;
}): GameState {
  const r = o.r ?? rules;
  const st = newGame(r, 'toss-test');
  const { tricks, tricksWon } = played(o.winners);
  const leader = o.turn ?? (o.winners.length ? (o.winners[o.winners.length - 1]! + 1) % 4 : 1);
  return {
    ...st,
    phase: 'playing',
    handNo: o.handNo ?? 3,
    dealer: 3,
    bids: [...o.bids],
    tricks, tricksWon,
    hands: o.hands ? o.hands.map((h) => [...h]) : st.hands.map((h) => h.slice(0, 13 - o.winners.length)),
    trick: { leader, plays: (o.trickPlays ?? []) as Trick['plays'], winner: null },
    turn: leader,
    spadesBroken: true,
    scores: o.scores ? [...o.scores] : [0, 0],
    bags: o.bags ? [...o.bags] : [0, 0],
    history: o.history ?? [],
    result: null,
  };
}

/** A scored hand record from normal play (for history fixtures). */
function record(handNo: number, bids: (number | 'nil' | 'blindNil' | 'books')[], tricks: number[]): HandRecord {
  const sides = scoreHand(rules, bids as never, tricks, [0, 0], [0, 0]);
  return { handNo, dealer: 0, bids: bids as never, tricksWon: tricks, sides };
}

describe('scoreTossedHand — the flat ruling', () => {
  it('pays the winning side exactly bid×10 with zero bags, even when its played books passed the bid', () => {
    // side 0 bid 8, took 2 (set, locked). side 1 bid 7, took 9 — two PAST its bid.
    const sides = scoreTossedHand(rules, [5, 4, 3, 3], [2, 5, 0, 4], [10, 200], [3, 4], [0]);
    expect(sides[0]).toMatchObject({ contract: 8, contractMade: false, contractPoints: -80, points: -80, totalScore: -70, tricks: 2, contractTricks: 2, bagsAdded: 0, totalBags: 3, bookPoints: 0 });
    expect(sides[1]).toMatchObject({ contract: 7, contractMade: true, contractPoints: 70, points: 70, totalScore: 270, tricks: 9, bagsAdded: 0, totalBags: 4 });
  });

  it('both sides short: both are scored as set (−bid each), there is no winning team', () => {
    // side 0 bid 8 took 5, side 1 bid 10 took 6, 2 tricks left: neither can get there.
    const sides = scoreTossedHand(rules, [5, 5, 3, 5], [3, 3, 2, 3], [0, 0], [0, 0], [0, 1]);
    expect(sides[0]).toMatchObject({ contractMade: false, contractPoints: -80, points: -80 });
    expect(sides[1]).toMatchObject({ contractMade: false, contractPoints: -100, points: -100 });
  });

  it('decided nils ride the engine’s normal nil accounting on top of the flat contract', () => {
    // seat 0 bid Nil and already busted (took 1); partner bid 4 and took 4: contract made.
    // side 1 bid 9, took 3 — the set side.
    const bust = scoreTossedHand(rules, ['nil', 5, 4, 4], [1, 2, 4, 1], [0, 0], [0, 0], [1]);
    expect(bust[0]!.nils).toEqual([{ seat: 0, kind: 'nil', tricks: 1, made: false, points: -100 }]);
    expect(bust[0]).toMatchObject({ contractMade: true, contractPoints: 40, points: -60 });
    expect(bust[1]).toMatchObject({ contractMade: false, points: -90 });
    // the same Nil standing as made (decided — no book ever reached the bidder)
    const made = scoreTossedHand(rules, ['nil', 5, 4, 4], [0, 2, 4, 1], [0, 0], [0, 0], [1]);
    expect(made[0]!.nils).toEqual([{ seat: 0, kind: 'nil', tricks: 0, made: true, points: 100 }]);
    expect(made[0]!.points).toBe(140);
    // a busted Blind Nil costs its full 200
    const blind = scoreTossedHand(rules, ['blindNil', 5, 4, 4], [2, 2, 4, 1], [0, 0], [0, 0], [1]);
    expect(blind[0]!.nils[0]).toMatchObject({ kind: 'blindNil', made: false, points: -200 });
  });

  it('a tossed hand adds no bags and triggers no bag penalty, whatever was played', () => {
    // side 1 sits on 9 bags; its played overtricks would normally push it over.
    const sides = scoreTossedHand(rules, [5, 4, 3, 3], [2, 5, 0, 4], [0, 0], [0, 9], [0]);
    expect(sides[1]).toMatchObject({ bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, totalBags: 9 });
    expect(sides[0]!.totalBags).toBe(0);
  });
});

describe('tossStatus — the lock', () => {
  // side 0 bid 8 (5+3), side 1 bid 7 (4+3) throughout.
  const bids = [5, 4, 3, 3];
  it('is not available one trick before the set locks, and is at the exact lock', () => {
    // 9 tricks played, side 0 took 5: needs 3, 4 tricks remain — still reachable.
    const open = midHand({ bids, winners: [0, 0, 0, 0, 0, 1, 1, 1, 1] });
    expect(tossStatus(open)?.available).toBe(false);
    expect(tossStatus(open)?.setSides).toEqual([]);
    // 10 played: needs 3, 3 remain — needs every one, still not locked.
    const edge = midHand({ bids, winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1] });
    expect(tossStatus(edge)?.available).toBe(false);
    // 11 played: needs 3, 2 remain — locked.
    const locked = midHand({ bids, winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] });
    const t = tossStatus(locked);
    expect(t?.available).toBe(true);
    expect(t?.setSides).toEqual([0]);
    expect(t?.blockedByNil).toBe(false);
    expect(t?.points).toEqual([-80, 70]);
  });

  it('a trick in progress does not change the count (it is still a trick remaining)', () => {
    const locked = midHand({ bids, winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], trickPlays: [{ seat: 1, card: 'AH' }] });
    expect(tossStatus(locked)?.available).toBe(true);
  });

  it('names both sides when both are short', () => {
    const both = midHand({ bids: [5, 5, 3, 5], winners: [0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1] });
    // side 0: bid 8, took 5, needs 3 > 2 left. side 1: bid 10, took 6, needs 4 > 2.
    expect(tossStatus(both)?.setSides).toEqual([0, 1]);
    expect(tossStatus(both)?.points).toEqual([-80, -100]);
  });

  it('is unavailable outside trick play, in cutthroat, and on a books hand', () => {
    const locked = midHand({ bids, winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] });
    expect(tossStatus({ ...locked, phase: 'bidding' })).toBeNull();
    expect(tossStatus({ ...locked, phase: 'handOver' })).toBeNull();
    const ct = midHand({ bids: [5, 4, 3], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], r: cutthroat });
    expect(tossStatus(ct)).toBeNull();
    const books = midHand({ bids: bids, winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] });
    books.bids = ['books', 'books', 'books', 'books'];
    expect(tossStatus(books)?.available).toBe(false);
  });
});

describe('the nil gate — a live, bustable nil always plays out', () => {
  // Side 1 is locked-set in all of these (bid 9, took 3 of 11, 2 tricks left).
  // Seat 0 bid Nil; two cards remain per seat; seat 1 leads.
  const base = {
    bids: ['nil', 5, 4, 4] as (number | 'nil')[],
    winners: [1, 2, 1, 2, 1, 2, 2, 2, 3, 3, 3], // tricksWon: seat0 0, seat1 3, seat2 5, seat3 3
    turn: 1,
  };
  it('blocks the toss while the nil can still be busted (low trump in hand looks safe — it is not)', () => {
    const st = midHand({
      ...base,
      hands: [['3H', '2S'], ['AH', 'KH'], ['QH', 'JH'], ['TH', '9H']],
    });
    // seat 0 holds the 2 of spades: led hearts twice, the second lead finds
    // the nil seat out of hearts and the little trump takes the book.
    expect(nilUnbustable(st, 0)).toBe(false);
    const t = tossStatus(st);
    expect(t?.setSides).toEqual([1]);
    expect(t?.blockedByNil).toBe(true);
    expect(t?.available).toBe(false);
    expect(() => applyAction(st, { type: 'toss', seat: 1 })).toThrowError(RuleError);
  });

  it('unlocks when the nil is provably unbustable (lowest cards, no trump anywhere near)', () => {
    const st = midHand({
      ...base,
      hands: [['3H', '4H'], ['AH', 'KH'], ['QH', 'JH'], ['TH', '9H']],
    });
    expect(nilUnbustable(st, 0)).toBe(true);
    const t = tossStatus(st);
    expect(t?.blockedByNil).toBe(false);
    expect(t?.available).toBe(true);
    // the decided-made nil scores in the preview: side 0 = +40 contract + 100 nil
    expect(t?.points).toEqual([140, -90]);
  });

  it('unlocks when the nil is already busted by played tricks', () => {
    const st = midHand({
      bids: ['nil', 5, 4, 4],
      winners: [0, 2, 1, 2, 1, 2, 2, 2, 3, 3, 3], // seat 0 took the first trick: busted
      hands: [['3H', '4H'], ['AH', 'KH'], ['QH', 'JH'], ['TH', '9H']],
      turn: 1,
    });
    const t = tossStatus(st);
    expect(t?.blockedByNil).toBe(false);
    expect(t?.available).toBe(true);
    expect(t?.points).toEqual([-60, -90]); // +40 contract, −100 busted nil
  });

  it('a nil bidder who must lead a boss card is bustable (never unlocks on a guess)', () => {
    const st = midHand({
      ...base,
      hands: [['AH', '3H'], ['KH', 'QH'], ['JH', 'TH'], ['9H', '8H']],
      turn: 0, // the nil seat leads — and its ace is a book the moment it lands
    });
    expect(nilUnbustable(st, 0)).toBe(false);
    expect(tossStatus(st)?.available).toBe(false);
  });

  it('one-card finishes: a sloughed low off-suit card cannot win; a trump ace always does', () => {
    const winners = [1, 2, 1, 2, 1, 2, 2, 2, 3, 3, 3, 2]; // 12 played, 1 trick left
    const safe = midHand({ ...base, winners, hands: [['3D'], ['KH'], ['QH'], ['9H']], turn: 1 });
    expect(nilUnbustable(safe, 0)).toBe(true);
    const trumped = midHand({ ...base, winners, hands: [['AS'], ['KH'], ['QH'], ['9H']], turn: 1 });
    expect(nilUnbustable(trumped, 0)).toBe(false);
  });
});

describe('the toss action', () => {
  const lockedState = () => midHand({
    bids: [5, 4, 3, 3], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1],
    trickPlays: [{ seat: 2, card: 'AH' }, { seat: 3, card: 'KH' }],
  });

  it('ends the hand on the flat score, records only played tricks, and stamps the toss', () => {
    const st = lockedState();
    const next = applyAction(st, { type: 'toss', seat: 0 });
    expect(next.phase).toBe('handOver');
    expect(next.scores).toEqual([-80, 70]);
    expect(next.history).toHaveLength(1);
    const rec = next.history[0]!;
    expect(rec.tossed).toEqual({ setSides: [0] });
    // played tricks only: 11 completed tricks; the two cards down in the
    // unfinished trick never became a book for anyone.
    expect(rec.tricksWon).toEqual([5, 6, 0, 0]);
    expect(rec.sides[0]!.tricks).toBe(5);
    expect(rec.sides[1]!.tricks).toBe(6);
    // the hand counts as a SET for the losing side in the derived counts
    expect(shotCounts(rules, next.history)).toEqual([1, 0]);
    // and play moves to the next dealer
    const h2 = applyAction(next, { type: 'nextHand' });
    expect(h2.handNo).toBe(4);
    expect(h2.dealer).toBe(0); // was 3
    expect(h2.phase).toBe('bidding');
  });

  it('refuses when the set is not locked, and in cutthroat', () => {
    const open = midHand({ bids: [5, 4, 3, 3], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1] });
    expect(() => applyAction(open, { type: 'toss', seat: 0 })).toThrowError(RuleError);
    const ct = midHand({ bids: [5, 4, 3], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], r: cutthroat });
    expect(() => applyAction(ct, { type: 'toss', seat: 0 })).toThrowError(RuleError);
  });

  it('a hand-1 toss that ends the game classifies as a shot-out, like any hand-1 set ending', () => {
    const st = midHand({ bids: [5, 4, 3, 3], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], handNo: 1 });
    const next = applyAction(st, { type: 'toss', seat: 2 });
    expect(next.phase).toBe('gameOver');
    expect(next.result?.endReason).toBe('shotOut');
    expect(next.result?.shotOut).toEqual([0]);
    expect(next.result?.winners).toEqual([1]);
  });

  it("a tossed third set ends the game as 'third-set' through the same derivation", () => {
    const history = [
      record(1, [4, 3, 2, 3], [1, 4, 2, 6]), // side 0 bid 6, took 3: set
      record(2, [3, 3, 2, 3], [3, 3, 2, 5]), // made
      record(3, [4, 3, 2, 3], [2, 4, 1, 6]), // side 0 bid 6, took 3: set (2)
    ];
    expect(shotCounts(rules, history)).toEqual([2, 0]);
    const st = midHand({ bids: [5, 4, 3, 3], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], handNo: 4, history });
    const next = applyAction(st, { type: 'toss', seat: 1 });
    expect(next.phase).toBe('gameOver');
    expect(next.result?.endReason).toBe('third-set');
    expect(next.result?.shotOut).toEqual([0]);
  });

  it('target and floor endings run on the flat score', () => {
    const history = [record(1, [3, 3, 2, 3], [3, 3, 2, 5]), record(2, [3, 3, 2, 3], [4, 3, 2, 4])];
    // side 0 is the set side (bid 8, took 5); side 1 wins the toss +70 → 430 + 70 = 500.
    const toTarget = midHand({ bids: [5, 4, 3, 3], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1], handNo: 5, history, scores: [100, 430] });
    const won = applyAction(toTarget, { type: 'toss', seat: 0 });
    expect(won.result?.endReason).toBe('target');
    expect(won.result?.winners).toEqual([1]);
    const toFloor = midHand({ bids: [4, 5, 3, 3], winners: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0], handNo: 5, history, scores: [100, -150] });
    // side 1 bid 8, took 5, needs 3 > 2 left: set. −80 → −230 ≤ −200 floor.
    const floored = applyAction(toFloor, { type: 'toss', seat: 1 });
    expect(floored.result?.endReason).toBe('floor');
    expect(floored.result?.winners).toEqual([0]);
  });
});

describe('the seat view carries the poll', () => {
  it('shows the flat outcome to every seat and to spectators while the poll is live', () => {
    const st = midHand({ bids: [5, 4, 3, 3], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1] });
    expect(viewFor(st, 0).toss).toEqual({ setSides: [0], points: [-80, 70] });
    expect(viewFor(st, 3).toss).toEqual({ setSides: [0], points: [-80, 70] });
    expect(spectatorView(st, 0).toss).toEqual({ setSides: [0], points: [-80, 70] });
  });

  it('shows the nil block instead of the poll while a nil is in doubt', () => {
    const st = midHand({
      bids: ['nil', 5, 4, 4], winners: [1, 2, 1, 2, 1, 2, 2, 2, 3, 3, 3],
      hands: [['3H', '2S'], ['AH', 'KH'], ['QH', 'JH'], ['TH', '9H']], turn: 1,
    });
    const v = viewFor(st, 0);
    // the locked set is visible (the table can say why the call is held);
    // the block flag is what keeps the call itself shut
    expect(v.toss).toEqual({ setSides: [1], points: [140, -90] });
    expect(v.tossBlockedByNil).toBe(true);
    expect(tossStatus(st)?.available).toBe(false);
  });

  it('shows nothing when no set is locked', () => {
    const st = midHand({ bids: [5, 4, 3, 3], winners: [0, 0, 0, 0, 0, 1, 1, 1, 1] });
    expect(viewFor(st, 0).toss).toBeNull();
    expect(viewFor(st, 0).tossBlockedByNil).toBe(false);
  });
});
