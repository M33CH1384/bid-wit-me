import { describe, expect, it } from 'vitest';
import {
  type Bid, type Card, type GameState, type HandRecord,
  applyAction, makeRules, newGame, scoreHand, shotCounts, shotCovers, shotOutSides,
} from '../src';

/**
 * Sticky second notice (owner, 2026-10-28): "After a team gets shot the second time they
 * should stay 'on notice' — even if they make books on the next hand they can still lose
 * the next time they don't." The first notice still clears on a made hand; the second one
 * never does. Story mode plays through this same finishHand (both history producers build
 * their records there), so these sims are the story engine's sims too — no forked rules.
 */
const joker = makeRules('joker');
const clubs = ['AC', 'KC', 'QC', 'JC', 'TC', '9C'] as Card[];

/** Finish the current team hand by playing one last trick (the third-set.test.ts pattern). `finalWon` is per SEAT. */
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
const SET1 = { bids: [3, 5, 3, 2] as Bid[], tricks: [4, 2, 3, 4] }; // side 1 bids 7, takes 6

describe('shotOutSides sticky flag', () => {
  it('a shot while on a sticky second notice is out, even across a gap and on hand 2+', () => {
    expect(shotOutSides(joker, 5, [true, false], [false, false], [true, false])).toEqual([0]);
    expect(shotOutSides(joker, 3, [true, false], [false, false], [true, false])).toEqual([0]);
  });
  it('without the flag the old rule stands: a shot after a gap is not a loss', () => {
    expect(shotOutSides(joker, 5, [true, false], [false, false])).toEqual([]);
    expect(shotOutSides(joker, 5, [true, false], [false, false], [false, false])).toEqual([]);
  });
  it('stickiness alone never ends it — the side must actually be shot this hand', () => {
    expect(shotOutSides(joker, 5, [false, false], [false, false], [true, true])).toEqual([]);
  });
  it('the flag is inert when Shot = out is off', () => {
    expect(shotOutSides({ ...joker, shotOut: false }, 5, [true, false], [false, false], [true, false])).toEqual([]);
  });
});

describe('the owner timeline (engine)', () => {
  it('set → notice; make → cleared; set → notice again; make → notice STAYS; set → out', () => {
    let st = newGame(joker, 'sticky');
    st = hand(st, MADE.bids, MADE.tricks); // hand 1: clean
    st = hand(st, SET0.bids, SET0.tricks); // hand 2: set #1 — first notice arms
    expect(shotCounts(joker, st.history)).toEqual([1, 0]);
    expect(st.result).toBeNull();
    st = hand(st, MADE.bids, MADE.tricks); // hand 3: made — the FIRST notice clears (no out, play on)
    expect(st.result).toBeNull();
    expect(st.phase).toBe('handOver');
    st = hand(st, SET0.bids, SET0.tricks); // hand 4: set #2 — the second notice arms, sticky now
    expect(shotCounts(joker, st.history)).toEqual([2, 0]);
    expect(st.result).toBeNull(); // two sets do not end it on the spot
    st = hand(st, MADE.bids, MADE.tricks); // hand 5: made — the sticky notice does NOT clear, and a make never ends it
    expect(st.result).toBeNull();
    expect(st.phase).toBe('handOver');
    st = hand(st, SET0.bids, SET0.tricks); // hand 6: set — out, across the gap
    expect(st.phase).toBe('gameOver');
    expect(st.result!.shotOut).toContain(0);
    expect(st.result!.winners).toEqual([1]);
    // Banner precedence (pinned by third-set.test.ts and kept deliberately): this losing hand
    // is also the side's third cumulative set, and the end-check order names the third set
    // first. The sticky branch is proven on its own in the tie-reprieve case below, where
    // the third-set rule cannot fire and the same timeline ends as 'shotOut'.
    expect(st.result!.endReason).toBe('third-set');
  });

  it('first notice behavior is unchanged: two shots in a row still end it as shotOut', () => {
    let st = newGame(joker, 'sticky-consec');
    st = hand(st, MADE.bids, MADE.tricks);
    st = hand(st, SET0.bids, SET0.tricks); // notice arms
    st = hand(st, SET0.bids, SET0.tricks); // shot again right away: out, and only 2 sets banked
    expect(shotCounts(joker, st.history)).toEqual([2, 0]);
    expect(st.phase).toBe('gameOver');
    expect(st.result).toMatchObject({ endReason: 'shotOut', winners: [1], shotOut: [0] });
  });

  it('hand-1 instant shot-out is unchanged', () => {
    const st = hand(newGame(joker, 'sticky-h1'), SET0.bids, SET0.tricks);
    expect(st.phase).toBe('gameOver');
    expect(st.result).toMatchObject({ endReason: 'shotOut', winners: [1], shotOut: [0] });
  });

  it('with Shot = out OFF there is no notice to stick — the third set still ends it on its own', () => {
    const rules = makeRules('joker', { shotOut: false });
    let st = newGame(rules, 'sticky-off');
    st = hand(st, SET0.bids, SET0.tricks);
    st = hand(st, MADE.bids, MADE.tricks);
    st = hand(st, SET0.bids, SET0.tricks); // set #2 — nothing arms with the house rule off
    expect(st.result).toBeNull();
    st = hand(st, MADE.bids, MADE.tricks);
    st = hand(st, SET0.bids, SET0.tricks); // set #3
    expect(st.phase).toBe('gameOver');
    expect(st.result).toMatchObject({ endReason: 'third-set', winners: [1], shotOut: [0] });
  });

  it('the sticky branch alone names the ending when the third-set rule cannot fire', () => {
    // Both sides cross to 3 sets on the same hand with an exact tie: thirdSetResult returns
    // null (play on) and the tied shotOutResult does too. The counts stay past 3 afterwards,
    // so no later hand can "cross" again — only the sticky notice can end it, as shotOut.
    const rec = (handNo: number, bids: Bid[], tricks: number[]): HandRecord => ({
      handNo, dealer: 3, bids: [...bids], tricksWon: [...tricks],
      sides: scoreHand(joker, bids, tricks, [0, 0], [0, 0]),
    });
    const history = [rec(1, SET0.bids, SET0.tricks), rec(2, SET1.bids, SET1.tricks), rec(3, SET0.bids, SET0.tricks), rec(4, SET1.bids, SET1.tricks)];
    expect(shotCounts(joker, history)).toEqual([2, 2]);
    const BOTH = { bids: [4, 5, 3, 3] as Bid[], tricks: [4, 4, 2, 3] }; // both set
    let st = closeTeamHand({ ...newGame(joker, 'sticky-tie'), scores: [100, 110], bags: [0, 0], handNo: 5, history }, BOTH.tricks, BOTH.bids);
    expect(st.scores).toEqual([30, 30]);
    expect(st.result).toBeNull(); // the reprieve: tied at the crossing, nobody is awarded the game
    st = hand(st, MADE.bids, MADE.tricks); // hand 6: clean — both notices stay up (sticky)
    expect(st.result).toBeNull();
    st = hand(st, SET0.bids, SET0.tricks); // hand 7: side 0 shot while stickied
    expect(shotCounts(joker, st.history)).toEqual([4, 3]); // no fresh crossing to 3 this hand
    expect(st.phase).toBe('gameOver');
    expect(st.result).toMatchObject({ endReason: 'shotOut', winners: [1], shotOut: [0] });
  });

  it('a resumed game restores the stickiness exactly — it rides the serialized history', () => {
    let st = newGame(joker, 'sticky-resume');
    st = hand(st, MADE.bids, MADE.tricks);
    st = hand(st, SET0.bids, SET0.tricks); // notice #1
    st = hand(st, MADE.bids, MADE.tricks);
    st = hand(st, SET0.bids, SET0.tricks); // notice #2 — sticky from here
    const revived = JSON.parse(JSON.stringify(st)) as GameState; // what the offline/story saves persist
    expect(shotCounts(revived.rules, revived.history)).toEqual([2, 0]);
    let st2 = hand(revived, MADE.bids, MADE.tricks); // made after the resume: notice stays
    expect(st2.result).toBeNull();
    st2 = hand(st2, SET0.bids, SET0.tricks); // shot after the resume: out
    expect(st2.phase).toBe('gameOver');
    expect(st2.result!.shotOut).toContain(0);
    expect(st2.result!.winners).toEqual([1]);
  });
});

describe('shotCovers mirrors the sticky ending (result omitted)', () => {
  const rec = (handNo: number, bids: Bid[], tricks: number[]): HandRecord => ({
    handNo, dealer: 3, bids: [...bids], tricksWon: [...tricks],
    sides: scoreHand(joker, bids, tricks, [0, 0], [0, 0]),
  });
  const timeline = [
    rec(1, MADE.bids, MADE.tricks),
    rec(2, SET0.bids, SET0.tricks), // set #1
    rec(3, MADE.bids, MADE.tricks),
    rec(4, SET0.bids, SET0.tricks), // set #2 — sticky arms
    rec(5, MADE.bids, MADE.tricks), // made: tape still comes off (tape is a per-hand marker)
    rec(6, SET0.bids, SET0.tricks), // set across the gap: the loss
  ];
  it('sheets the side on the sticky-out hand, with its real time of death', () => {
    const covers = shotCovers(joker, timeline);
    expect(covers[0]).toMatchObject({ sheet: true, siren: true, outHand: 6 });
    expect(covers[1]!.sheet).toBe(false);
  });
  it('tape semantics are untouched: a made hand still pulls the tape off a stickied side', () => {
    const covers = shotCovers(joker, timeline.slice(0, 5));
    expect(covers[0]).toEqual({ tape: false, sheet: false, siren: false, outHand: null });
  });
});
