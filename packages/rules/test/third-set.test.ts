import { describe, expect, it } from 'vitest';
import {
  type Bid, type Card, type GameState, type HandRecord, type TableRules,
  applyAction, makeRules, newGame, scoreHand, shotCounts, shotCovers, thirdSetResult,
} from '../src';

const joker = makeRules('joker');
const clubs = ['AC', 'KC', 'QC', 'JC', 'TC', '9C'] as Card[];

/** Finish the current team hand by playing one last trick (the elimination.test.ts pattern). `finalWon` is per SEAT. */
function closeTeamHand(base: GameState, finalWon: number[], bids: readonly Bid[], winner = 0): GameState {
  const n = base.rules.playerCount;
  const books = base.trickCount ?? 13;
  const won = [...finalWon];
  won[winner] = (won[winner] ?? 0) - 1;
  if (won.reduce((a, b) => a + b, 0) !== books - 1) throw new Error(`books ${won.join('+')} !== ${books - 1}`);
  const hands = Array.from({ length: n }, (_, i) => [i === winner ? clubs[0]! : clubs[i + 1]!]);
  let st: GameState = {
    ...base, phase: 'playing', bids: [...bids], hands, tricksWon: won,
    tricks: Array.from({ length: books - 1 }, () => ({ leader: winner, plays: [], winner })),
    trick: { leader: winner, plays: [], winner: null }, turn: winner, spadesBroken: true,
    revealed: Array(n).fill(true),
  };
  for (let k = 0; k < n; k++) {
    const seat = st.turn!;
    st = applyAction(st, { type: 'play', seat, card: st.hands[seat]![0]! });
  }
  return st;
}

/** Play one scripted hand, dealing the next first when the previous hand is over. */
function hand(st: GameState, bids: Bid[], tricks: number[], winner = 0): GameState {
  return closeTeamHand(st.phase === 'handOver' ? applyAction(st, { type: 'nextHand' }) : st, tricks, bids, winner);
}

const MADE = { bids: [3, 3, 3, 3] as Bid[], tricks: [4, 3, 3, 3] }; // both sides make 6; side 0 takes 7
const SET0 = { bids: [4, 3, 2, 3] as Bid[], tricks: [3, 3, 1, 6] }; // side 0 bids 6, takes 4; side 1 makes 6 with 9

describe('third set ends the game (team games)', () => {
  it('non-consecutive sets accumulate; the second does not end it, the third does', () => {
    let st = newGame(joker, 'third');
    st = hand(st, MADE.bids, MADE.tricks); // hand 1: clean
    st = hand(st, SET0.bids, SET0.tricks); // hand 2: set #1
    expect(shotCounts(joker, st.history)).toEqual([1, 0]);
    expect(st.result).toBeNull();
    st = hand(st, MADE.bids, MADE.tricks); // hand 3: clean — the sets are NOT in a row
    st = hand(st, SET0.bids, SET0.tricks); // hand 4: set #2
    expect(shotCounts(joker, st.history)).toEqual([2, 0]);
    expect(st.phase).toBe('handOver');
    expect(st.result).toBeNull(); // two sets, even with Shot = out on, do not end it out of sequence
    st = hand(st, MADE.bids, MADE.tricks); // hand 5: clean
    st = hand(st, SET0.bids, SET0.tricks); // hand 6: set #3
    expect(shotCounts(joker, st.history)).toEqual([3, 0]);
    expect(st.phase).toBe('gameOver');
    expect(st.result).toMatchObject({ endReason: 'third-set', winners: [1], shotOut: [0] });
    // the finale-tier fact for the set-animation layer: the recorded result sheets the
    // knocked-out side on the final hand (shotCovers reads result.shotOut for 'third-set'
    // exactly as for 'shotOut')
    const covers = shotCovers(joker, st.history, st.result);
    expect(covers[0]).toMatchObject({ sheet: true, outHand: 6 });
    expect(covers[1]!.sheet).toBe(false);
  });

  it('applies with the Shot = out house rule OFF, including a set on hand 1', () => {
    const rules = makeRules('joker', { shotOut: false });
    let st = newGame(rules, 'third-off');
    st = hand(st, SET0.bids, SET0.tricks); // hand 1: set #1 — with Shot = out this alone would end it
    expect(st.phase).toBe('handOver');
    expect(st.result).toBeNull();
    st = hand(st, MADE.bids, MADE.tricks);
    st = hand(st, SET0.bids, SET0.tricks); // set #2
    expect(st.result).toBeNull();
    st = hand(st, MADE.bids, MADE.tricks);
    st = hand(st, SET0.bids, SET0.tricks); // set #3
    expect(st.phase).toBe('gameOver');
    expect(st.result).toMatchObject({ endReason: 'third-set', winners: [1], shotOut: [0] });
  });

  it('a busted Nil counts toward the three — the engine definition (contract made, side still set)', () => {
    const rules = makeRules('joker', { shotOut: false });
    const NILBUST = { bids: ['nil', 3, 4, 3] as Bid[], tricks: [1, 4, 4, 4] }; // partner makes the 4; the Nil bidder took a book
    let st = newGame(rules, 'third-nil');
    st = hand(st, NILBUST.bids, NILBUST.tricks);
    expect(st.history[0]!.sides[0]!.contractMade).toBe(true);
    expect(st.history[0]!.sides[0]!.nils[0]!.made).toBe(false);
    expect(shotCounts(rules, st.history)).toEqual([1, 0]); // isShot: a busted Nil is a shot for the side in 2v2
    st = hand(st, MADE.bids, MADE.tricks);
    st = hand(st, NILBUST.bids, NILBUST.tricks);
    st = hand(st, MADE.bids, MADE.tricks);
    expect(st.result).toBeNull();
    st = hand(st, NILBUST.bids, NILBUST.tricks); // third busted Nil
    expect(st.phase).toBe('gameOver');
    expect(st.result).toMatchObject({ endReason: 'third-set', winners: [1], shotOut: [0] });
  });

  it('the third set is named even when the set side crosses the target on the same hand', () => {
    const rec = (handNo: number, bids: Bid[], tricks: number[]): HandRecord => ({
      handNo, dealer: 3, bids: [...bids], tricksWon: [...tricks],
      sides: scoreHand(joker, bids, tricks, [0, 0], [0, 0]),
    });
    const history = [
      rec(1, SET0.bids, SET0.tricks), // side 0 set #1
      rec(2, MADE.bids, MADE.tricks),
      rec(3, SET0.bids, SET0.tricks), // side 0 set #2
    ];
    expect(shotCounts(joker, history)).toEqual([2, 0]);
    let st: GameState = { ...newGame(joker, 'third-target'), scores: [480, 100], bags: [0, 0], handNo: 4, history };
    // Side 0: partner's 4 missed (3 books) = set #3, but the Nil is MADE (+100) — the hand
    // scores +60 and crosses the 500 target. The third set still loses: same hand, set wins the copy.
    st = closeTeamHand(st, [0, 4, 3, 6], ['nil', 3, 4, 3], 3);
    expect(st.result).toMatchObject({ endReason: 'third-set', winners: [1], shotOut: [0], finalScores: [540, 164] });
  });

  it('both sides reach their third set on the same hand: higher score wins; an exact tie plays on', () => {
    const rec = (handNo: number, bids: Bid[], tricks: number[]): HandRecord => ({
      handNo, dealer: 3, bids: [...bids], tricksWon: [...tricks],
      sides: scoreHand(joker, bids, tricks, [0, 0], [0, 0]),
    });
    const SET1 = { bids: [3, 5, 3, 2] as Bid[], tricks: [4, 2, 3, 4] }; // side 1 bids 7, takes 6
    const history = [rec(1, SET0.bids, SET0.tricks), rec(2, SET1.bids, SET1.tricks), rec(3, SET0.bids, SET0.tricks), rec(4, SET1.bids, SET1.tricks)];
    expect(shotCounts(joker, history)).toEqual([2, 2]);
    const BOTH = { bids: [4, 5, 3, 3] as Bid[], tricks: [4, 4, 2, 3] }; // side 0 bids 7 takes 6; side 1 bids 8 takes 7 — both set
    const win = closeTeamHand({ ...newGame(joker, 'third-both'), scores: [100, 40], bags: [0, 0], handNo: 5, history }, BOTH.tricks, BOTH.bids);
    expect(win.result).toMatchObject({ endReason: 'third-set', winners: [0], shotOut: [0, 1], finalScores: [30, -40] });
    const tie = closeTeamHand({ ...newGame(joker, 'third-tie'), scores: [100, 110], bags: [0, 0], handNo: 5, history }, BOTH.tricks, BOTH.bids);
    expect(tie.phase).toBe('handOver');
    expect(tie.result).toBeNull(); // 30–30: nobody is awarded the game, same as a tied shot-out
  });

  it('the count survives a save/resume round-trip — it rides the serialized history', () => {
    const rules = makeRules('joker', { shotOut: false });
    let st = newGame(rules, 'third-resume');
    st = hand(st, SET0.bids, SET0.tricks);
    st = hand(st, MADE.bids, MADE.tricks);
    st = hand(st, SET0.bids, SET0.tricks); // two sets banked
    const revived = JSON.parse(JSON.stringify(st)) as GameState; // what the offline/story saves persist
    expect(shotCounts(revived.rules, revived.history)).toEqual([2, 0]);
    let st2 = hand(revived, MADE.bids, MADE.tricks);
    st2 = hand(st2, SET0.bids, SET0.tricks); // third set, after the resume
    expect(st2.phase).toBe('gameOver');
    expect(st2.result).toMatchObject({ endReason: 'third-set', winners: [1] });
  });
});

describe('thirdSetResult', () => {
  it('fires only on the hand the count crosses to 3', () => {
    expect(thirdSetResult([100, 50], [3, 1], [2, 1])).toMatchObject({ endReason: 'third-set', winners: [1], shotOut: [0] });
    expect(thirdSetResult([100, 50], [2, 0], [2, 0])).toBeNull();
    expect(thirdSetResult([100, 50], [4, 0], [3, 0])).toBeNull(); // already past 3 before this hand — not this hand's ending
    expect(thirdSetResult([100, 50], [3, 3], [2, 2])).toMatchObject({ winners: [0] }); // both cross: higher score wins
    expect(thirdSetResult([50, 50], [3, 3], [2, 2])).toBeNull(); // both cross, exact tie: play on
  });
});

describe('third failed bid eliminates in cutthroat (the per-player mapping)', () => {
  const ct = makeRules('cutthroat', { playerCount: 4, minTeamBid: 1, targetScore: 300 });

  /** A past record whose shot stamps say who failed (what finishCutthroat writes for active players). */
  function pastRecord(handNo: number, failed: boolean[]): HandRecord {
    const bids = [3, 3, 3, 3] as Bid[];
    const sides = scoreHand(ct, bids, [4, 3, 3, 3], [0, 0, 0, 0], [0, 0, 0, 0])
      .map((s, i) => ({ ...s, shot: failed[i]!, out: false }));
    return { handNo, dealer: 0, bids: [...bids], tricksWon: [4, 3, 3, 3], sides };
  }

  /** Two players already out; players 0 and 1 still in, on hand 6. */
  function endgame(priorFails: boolean[][]): GameState {
    return {
      ...newGame(ct, 'ct-third'), handNo: 6, scores: [100, 120, 30, 40], bags: [0, 0, 0, 0],
      eliminated: [false, false, true, true], failStreak: [0, 0, 0, 0],
      history: priorFails.map((f, i) => pastRecord(2 + i * 2, f)),
    };
  }

  /** Finish the current cutthroat hand with one last trick (elimination.test.ts pattern). */
  function closeCtHand(base: GameState, finalWon: number[], bids: readonly Bid[], winner: number): GameState {
    const n = base.rules.playerCount;
    const books = base.trickCount ?? 13;
    const won = [...finalWon];
    won[winner] = (won[winner] ?? 0) - 1;
    if (won.reduce((a, b) => a + b, 0) !== books - 1) throw new Error(`books ${won.join('+')} !== ${books - 1}`);
    const out = base.eliminated ?? [];
    const hands = Array.from({ length: n }, (_, i) => (out[i] ? [] : [i === winner ? clubs[0]! : clubs[i + 1]!]));
    let st: GameState = {
      ...base, phase: 'playing', bids: [...bids], hands, tricksWon: won,
      tricks: Array.from({ length: books - 1 }, () => ({ leader: winner, plays: [], winner })),
      trick: { leader: winner, plays: [], winner: null }, turn: winner, spadesBroken: true,
      revealed: Array(n).fill(true),
    };
    const live = hands.filter((h) => h.length > 0).length;
    for (let k = 0; k < live; k++) {
      const seat = st.turn!;
      st = applyAction(st, { type: 'play', seat, card: st.hands[seat]![0]! });
    }
    return st;
  }

  it('a third failed bid — not in a row — eliminates, and ends the game as third-set when one player remains', () => {
    const st = endgame([[true, false, false, false], [true, false, false, false]]); // player 0: two prior fails, streak reset since
    const after = closeCtHand(st, [2, 11, 0, 0], [5, 4, 'books', 'books'], 1); // player 0 bids 5, takes 2: fail #3, streak only 1
    expect(after.eliminated![0]).toBe(true);
    expect(after.failStreak![0]).toBe(1); // proof the streak rule did NOT do this — the cumulative count did
    expect(after.phase).toBe('gameOver');
    expect(after.result).toMatchObject({ endReason: 'third-set', winners: [1], shotOut: [0] });
  });

  it('a second cumulative failed bid does not eliminate', () => {
    const st = endgame([[true, false, false, false]]); // one prior fail
    const after = closeCtHand(st, [2, 11, 0, 0], [5, 4, 'books', 'books'], 1); // fail #2, streak 1
    expect(after.eliminated![0]).toBe(false);
    expect(after.phase).toBe('handOver');
    expect(after.result).toBeNull();
  });
});
