/**
 * 1st Round TKO — the stat's pinned definition (owner, 2026-11-05:
 * "1st round TKO should be a major stat").
 *
 * The stat counts exactly the outs the game's own ending logic produces
 * on hand 1 — nothing else. The ending name lives in the web layer
 * (shotOut.ts: SHOT_OUT_NAMES['first-hand'] = '1ST ROUND TKO', keyed by
 * shotOutPathFor: the final record is hand 1 of a shotOut ending); the
 * fact underneath it is engine-level:
 *  - partnership: the game ENDED by shotOut on hand 1 (finishHand's
 *    thirdSet ?? shotOut ?? checkGameEnd precedence — an exact-tie
 *    double-shot on hand 1 returns null from shotOutResult and the game
 *    plays on, so it is NOT a TKO);
 *  - cutthroat: a player ELIMINATED on hand 1 (finishCutthroat stamps
 *    `out: true` on the hand-1 record — the same fact shotCovers prints
 *    as "Time of death: Hand 1" via outHand).
 *
 * `tkoOutSides` is that fact as one derivation. These fixtures are built
 * the way finishHand / finishCutthroat build real games (scoreHand per
 * hand, the engine's own result functions), and every fixture also pins
 * agreement with shotCovers' outHand — the two derivations can never
 * drift apart silently.
 */
import { describe, expect, it } from 'vitest';
import {
  type Bid, type GameResult, type HandRecord, type TableRules,
  checkGameEnd, hostMinimum, isShot, makeRules, scoreHand, shotCounts, shotCovers,
  shotOutOn, shotOutResult, shotOutSides, thirdSetResult, tkoOutSides,
} from '../src';

/* ------------------------------------------------------------ fixtures */

/** A team game's history + result, built exactly the way finishHand builds them. */
function teamGame(hands: { bids: Bid[]; tricks: number[] }[], rules: TableRules = makeRules('joker')) {
  let scores = [0, 0];
  let bags = [0, 0];
  const history: HandRecord[] = [];
  let result: GameResult | null = null;
  for (const [i, h] of hands.entries()) {
    const sides = scoreHand(rules, h.bids, h.tricks, scores, bags);
    const shot = sides.map((s) => isShot(rules, h.bids, s));
    if (shotOutOn(rules)) sides.forEach((s, j) => { s.shot = shot[j]; });
    const prev = history[history.length - 1];
    const prevShot = sides.map((_, j) => !!prev?.sides[j]?.shot);
    const record: HandRecord = { handNo: i + 1, dealer: 0, bids: [...h.bids], tricksWon: [...h.tricks], sides };
    const countsBefore = shotCounts(rules, history);
    const newScores = sides.map((s) => s.totalScore);
    result = thirdSetResult(newScores, shotCounts(rules, [...history, record]), countsBefore)
      ?? shotOutResult(newScores, shotOutSides(rules, i + 1, shot, prevShot, countsBefore.map((c) => c >= 2)))
      ?? checkGameEnd(rules, newScores);
    history.push(record);
    scores = newScores;
    bags = sides.map((s) => s.totalBags);
    if (result) break;
  }
  return { rules, history, result };
}

/** A cutthroat game's history, built the way finishCutthroat stamps it:
 *  failed = missed number / busted nil / short of the books minimum;
 *  out on hand 1, on a 2-fail streak, or on the 3rd cumulative fail. */
function cutGame(hands: { bids: Bid[]; tricks: number[] }[], rules: TableRules = makeRules('cutthroat')) {
  const n = rules.playerCount;
  let scores = Array.from({ length: n }, () => 0);
  let bags = Array.from({ length: n }, () => 0);
  const history: HandRecord[] = [];
  const eliminated = Array.from({ length: n }, () => false);
  const streak = Array.from({ length: n }, () => 0);
  for (const [i, h] of hands.entries()) {
    const handNo = i + 1;
    const wasOut = [...eliminated];
    const sides = scoreHand(rules, h.bids, h.tricks, scores, bags);
    const books = h.bids.every((b) => b === 'books');
    const cumFails = Array.from({ length: n }, () => 0);
    for (const rec of history) for (const s of rec.sides) if (s.shot) cumFails[s.side] = (cumFails[s.side] ?? 0) + 1;
    for (let seat = 0; seat < n; seat++) {
      if (wasOut[seat]) {
        sides[seat] = { ...sides[seat]!, points: 0, bookPoints: 0, contractPoints: 0, contractMade: null, bagsAdded: 0, totalScore: scores[seat]!, totalBags: bags[seat]!, shot: false, out: true };
        continue;
      }
      const b = h.bids[seat];
      const failed = books
        ? hostMinimum(rules) > 0 && sides[seat]!.tricks < hostMinimum(rules)
        : b === null || b === 'books' ? false
          : (b === 'nil' || b === 'blindNil') ? sides[seat]!.tricks > 0
            : sides[seat]!.contractMade === false;
      streak[seat] = failed ? (streak[seat] ?? 0) + 1 : 0;
      const cum = (cumFails[seat] ?? 0) + (failed ? 1 : 0);
      const out = failed && (handNo === 1 || (streak[seat] ?? 0) >= 2 || cum >= 3);
      if (out) eliminated[seat] = true;
      sides[seat] = { ...sides[seat]!, shot: failed, out };
    }
    history.push({ handNo, dealer: 0, bids: [...h.bids], tricksWon: [...h.tricks], sides });
    scores = sides.map((s) => s.totalScore);
    bags = sides.map((s) => s.totalBags);
  }
  return { rules, history };
}

const BOOKS: Bid[] = ['books', 'books', 'books', 'books'];
const coversOuts = (r: TableRules, history: HandRecord[], result: GameResult | null) =>
  shotCovers(r, history, result).flatMap((c, side) => (c.outHand === 1 ? [side] : []));

/* ------------------------------------------------------------ the battery */

describe('tkoOutSides — partnership', () => {
  it('hand-1 books hand: the side short of the minimum is out — a TKO', () => {
    // side 1 takes 3 books against the first-hand minimum of 4
    const g = teamGame([{ bids: BOOKS, tricks: [6, 2, 4, 1] }]);
    expect(g.result?.endReason).toBe('shotOut');
    expect(g.result?.shotOut).toEqual([1]);
    expect(tkoOutSides(g.rules, g.history, g.result)).toEqual([1]);
    expect(coversOuts(g.rules, g.history, g.result)).toEqual([1]);
  });

  it('a shot-out that lands on hand 3 (back-to-back) is NOT a TKO', () => {
    const g = teamGame([
      { bids: BOOKS, tricks: [4, 4, 3, 2] },            // both sides reach the minimum
      { bids: [3, 6, 2, 3], tricks: [4, 3, 3, 3] },     // side 1 set — first shot
      { bids: [3, 6, 2, 3], tricks: [4, 3, 3, 3] },     // side 1 set again — out, hand 3
    ]);
    expect(g.result?.endReason).toBe('shotOut');
    expect(g.history).toHaveLength(3);
    expect(tkoOutSides(g.rules, g.history, g.result)).toEqual([]);
    expect(coversOuts(g.rules, g.history, g.result)).toEqual([]);
  });

  it('both sides shot on hand 1: the higher score wins, BOTH are TKO outs', () => {
    // host had "books bid themselves" off: real bids on hand 1, both sides set
    const g = teamGame([{ bids: [5, 5, 4, 3], tricks: [3, 3, 5, 2] }]);
    expect(g.result?.endReason).toBe('shotOut');
    expect(g.result?.shotOut).toEqual([0, 1]);
    expect(g.result?.winners).toEqual([1]); // −80 beats −90
    expect(tkoOutSides(g.rules, g.history, g.result)).toEqual([0, 1]);
    expect(coversOuts(g.rules, g.history, g.result)).toEqual([0, 1]);
  });

  it('both sides shot on hand 1 with EQUAL scores: the game plays on — no TKO', () => {
    const rules = makeRules('joker', { targetScore: 100 });
    const g = teamGame([
      { bids: [5, 5, 4, 4], tricks: [3, 3, 5, 2] },     // both set at −90: shotOutResult is null on the tie
      { bids: [6, 3, 4, 3], tricks: [6, 2, 4, 1] },     // side 0 makes 10 → 10; side 1 set again (−150, no floor, no out)
      { bids: [7, 2, 4, 2], tricks: [6, 4, 5, 0] },     // side 0 makes 11 → 120 ≥ 100, target; side 1 makes its 4
    ], rules);
    expect(g.result?.endReason).toBe('target');
    expect(tkoOutSides(g.rules, g.history, g.result)).toEqual([]);
    expect(coversOuts(g.rules, g.history, g.result)).toEqual([]);
  });

  it('a hand-1 TARGET ending (nobody shot) is NOT a TKO', () => {
    const rules = makeRules('joker', { targetScore: 100 });
    const g = teamGame([{ bids: BOOKS, tricks: [6, 4, 4, 0] }], rules); // side 0: 10 books = 100; side 1: 4 books, safe
    expect(g.result?.endReason).toBe('target');
    expect(tkoOutSides(g.rules, g.history, g.result)).toEqual([]);
    expect(coversOuts(g.rules, g.history, g.result)).toEqual([]);
  });
});

describe('tkoOutSides — cutthroat', () => {
  it('zero books on the hand-1 books hand eliminates — a TKO suffered', () => {
    const g = cutGame([
      { bids: BOOKS, tricks: [5, 4, 0, 4] },            // seat 2 takes nothing — out on hand 1
      { bids: [4, 4, 'books', 4], tricks: [5, 4, 0, 4] },
      { bids: [5, 3, 'books', 5], tricks: [6, 3, 0, 4] },
    ]);
    const result: GameResult = { endReason: 'target', finalScores: [0, 0, 0, 0], placements: [1, 2, 3, 4], winners: [0] };
    expect(tkoOutSides(g.rules, g.history, result)).toEqual([2]);
    expect(coversOuts(g.rules, g.history, result)).toEqual([2]);
  });

  it('two players out on hand 1: both are TKO outs', () => {
    const g = cutGame([
      { bids: BOOKS, tricks: [5, 4, 0, 0] },
      { bids: [4, 4, 'books', 'books'], tricks: [7, 6, 0, 0] },
    ]);
    const result: GameResult = { endReason: 'target', finalScores: [0, 0, 0, 0], placements: [1, 2, 3, 4], winners: [0] };
    expect(tkoOutSides(g.rules, g.history, result)).toEqual([2, 3]);
    expect(coversOuts(g.rules, g.history, result)).toEqual([2, 3]);
  });

  it('an elimination that lands on hand 3 is NOT a TKO', () => {
    const g = cutGame([
      { bids: BOOKS, tricks: [4, 3, 3, 3] },            // everyone takes a book — nobody out
      { bids: [4, 4, 5, 3], tricks: [4, 4, 2, 4] },     // seat 2 misses — first fail
      { bids: [4, 4, 5, 3], tricks: [4, 4, 2, 4] },     // seat 2 misses again — streak 2, out on hand 3
    ]);
    const result: GameResult = { endReason: 'target', finalScores: [0, 0, 0, 0], placements: [1, 2, 3, 4], winners: [0] };
    expect(g.history[2]!.sides[2]!.out).toBe(true);
    expect(tkoOutSides(g.rules, g.history, result)).toEqual([]);
    expect(coversOuts(g.rules, g.history, result)).toEqual([]);
  });

  it('3-player: two out on hand 1 ends the game by shotOut — both are TKO outs', () => {
    const rules = makeRules('cutthroat', { playerCount: 3 });
    const g = cutGame([{ bids: ['books', 'books', 'books'], tricks: [13, 0, 0] }], rules);
    const result: GameResult = { endReason: 'shotOut', shotOut: [1, 2], finalScores: [130, -10, -10], placements: [1, 2, 2], winners: [0] };
    expect(tkoOutSides(g.rules, g.history, result)).toEqual([1, 2]);
    expect(coversOuts(g.rules, g.history, result)).toEqual([1, 2]);
  });

  it('no result yet / empty history: no outs', () => {
    const rules = makeRules('joker');
    expect(tkoOutSides(rules, [], null)).toEqual([]);
  });
});
