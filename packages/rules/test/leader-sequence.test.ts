/**
 * Leader-sequence regression pin (owner correction, 2026-11-05).
 *
 * The owner's report at the Cookout table read as a turn-order bug —
 * "my partner won the last book, but it's waiting for me to play" — and
 * he corrected it himself minutes later: "it just froze a bit, the
 * correct order played." Hana led the next trick, as she should.
 *
 * This suite pins the order contract so it can never quietly break:
 * after EVERY completed trick, the engine's turn pointer and the new
 * trick's leader are the trick's winner — for every seat, mid-hand and
 * at hand boundaries — and pendingTurn (what the offline driver reads)
 * names that same seat. If a future change breaks the order, it fails
 * here, not at the owner's table.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, makeRules, newGame, pendingTurn, trickWinner, viewFor, type GameState } from '../src/index';
import { chooseBotAction } from '@spades/bots';

/** Drive one game start-to-finish with the bot brain on every seat —
 *  the same pendingTurn -> chooseBotAction loop the offline driver runs. */
function driveGame(seed: string, mode: 'joker' | 'cutthroat' = 'joker', onTrick?: (st: GameState) => void): GameState {
  let st = newGame(makeRules(mode), seed);
  let guard = 0;
  let prevTricks = 0;
  while (st.phase !== 'gameOver' && guard++ < 20000) {
    // between hands the table advances on the intermission's word — the
    // same nextHand action Table applies (Table.tsx Intermission onReady)
    if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
    const turn = pendingTurn(st);
    if (!turn) throw new Error(`seed ${seed}: no pending turn in phase ${st.phase}`);
    const action = chooseBotAction(viewFor(st, turn.seat), 'novice');
    if (!action) throw new Error(`seed ${seed}: bot at seat ${turn.seat} had no action in phase ${st.phase}`);
    st = applyAction(st, action);
    if (st.tricks.length > prevTricks) {
      prevTricks = st.tricks.length;
      onTrick?.(st);
    }
  }
  if (st.phase !== 'gameOver') throw new Error(`seed ${seed}: game did not finish`);
  return st;
}

describe('trick winner leads the next trick', () => {
  it('holds after every completed trick, for every seat, across seeded games', () => {
    const winnersSeen = new Set<number>();
    let tricksChecked = 0;
    for (let i = 0; i < 24; i++) {
      driveGame(`leader-pin-${i}`, 'joker', (st) => {
        const done = st.tricks[st.tricks.length - 1]!;
        // the recorded winner is the rules' own verdict on the plays
        expect(done.winner).toBe(trickWinner(done.plays, st.rules));
        winnersSeen.add(done.winner!);
        tricksChecked++;
        if (st.phase === 'playing') {
          // mid-hand: the winner leads the next trick and holds the turn
          expect(st.trick.leader).toBe(done.winner);
          expect(st.turn).toBe(done.winner);
          expect(pendingTurn(st)).toEqual({ seat: done.winner, kind: 'play' });
        }
      });
    }
    // every seat dealt a next-trick lead somewhere in the sweep
    expect(winnersSeen).toEqual(new Set([0, 1, 2, 3]));
    expect(tricksChecked).toBeGreaterThan(200);
  }, 120_000);

  it('the first leader of a hand is the designated opener, then winners lead', () => {
    for (let i = 0; i < 8; i++) {
      let st = newGame(makeRules('joker'), `leader-open-${i}`);
      let guard = 0;
      let lastHand = -1;
      while (st.phase !== 'gameOver' && guard++ < 20000) {
        if (st.phase === 'playing' && st.trick.plays.length === 0 && st.handNo !== lastHand) {
          lastHand = st.handNo;
          // at a hand's first trick the turn is the trick's leader — one source
          expect(st.turn).toBe(st.trick.leader);
          expect(pendingTurn(st)).toEqual({ seat: st.trick.leader, kind: 'play' });
        }
        if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
        const turn = pendingTurn(st);
        if (!turn) break;
        const action = chooseBotAction(viewFor(st, turn.seat), 'novice');
        if (!action) break;
        st = applyAction(st, action);
      }
      expect(st.phase).toBe('gameOver');
    }
  }, 120_000);
});

describe('offline soak: no stalls, no wrong-turn waits', () => {
  it('drives 60 seeded games to completion; every named seat can move', () => {
    let tricks = 0;
    for (let i = 0; i < 60; i++) {
      const mode = i % 5 === 4 ? 'cutthroat' : 'joker';
      driveGame(`leader-soak-${i}`, mode, () => { tricks++; });
    }
    expect(tricks).toBeGreaterThan(600);
  }, 180_000);
});
