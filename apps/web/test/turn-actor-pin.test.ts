/**
 * Plate == engine actor pin (owner correction, 2026-11-05).
 *
 * During the Cookout freeze, the owner's plate showed YOUR TURN while
 * the engine's actor was his partner (she had just taken the book and
 * was to lead). The order itself was never wrong — she led — so this
 * pin locks the derivation contract that made the badge's claim
 * impossible to sustain: the turn plate (turnView, fed Table's offline
 * inputs) and the bot driver (pendingTurn) read ONE state field, and
 * at every reachable state the plate's actor is the driver's seat —
 * and during the finished-trick hold (pause) the plate names NOBODY,
 * so a held frame can never claim a turn the engine isn't waiting on.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, makeRules, newGame, pendingTurn, viewFor, type GameState } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { turnView } from '../src/turnState';

const HUMAN = 0;

/** Table's offline turnView inputs for a state (Table.tsx: localTurn = st.turn). */
function plate(st: GameState, pause: boolean) {
  return turnView({
    turn: st.turn, phase: st.phase, pause, dealing: false, locked: false, covered: false,
    viewerSeat: HUMAN, spectating: false,
    legalCount: viewFor(st, HUMAN).legal.length, selected: false,
  });
}

describe('the turn plate never disagrees with the engine actor', () => {
  it('actor and badge match pendingTurn at every state of scripted games', () => {
    let states = 0;
    let trickBoundaries = 0;
    for (let g = 0; g < 10; g++) {
      let st = newGame(makeRules('joker'), `actor-pin-${g}`);
      let guard = 0;
      let prevTricks = 0;
      while (st.phase !== 'gameOver' && guard++ < 20000) {
        if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
        const driver = pendingTurn(st);
        // live table: the plate's actor IS the driver's seat (or nobody)
        const live = plate(st, false);
        expect(live.actor).toBe(driver ? driver.seat : null);
        if (live.badge) {
          expect(live.badge.seat).toBe(driver!.seat);
          if (driver!.seat === HUMAN) {
            expect(live.badge.testId).toBe(st.phase === 'bidding' ? 'your-bid' : 'your-turn');
          } else if (st.phase === 'bidding') {
            expect(live.badge.testId).toBe(`bidding-${driver!.seat}`);
          } else {
            expect(live.badge.testId).toBe(`to-play-${driver!.seat}`);
          }
        }
        // the finished-trick hold: the plate names nobody, whoever won
        const held = plate(st, true);
        expect(held.actor).toBeNull();
        expect(held.badge).toBeNull();
        states++;
        const action = chooseBotAction(viewFor(st, driver!.seat), 'novice');
        if (!action) throw new Error(`seed actor-pin-${g}: no action in ${st.phase}`);
        st = applyAction(st, action);
        if (st.tricks.length > prevTricks) {
          prevTricks = st.tricks.length;
          trickBoundaries++;
          // the exact beat from the owner's screenshot: the trick just
          // completed — in the live (unpaused) derivation the badge sits
          // on the WINNER's plate, and on the human's only if he won it.
          if (st.phase === 'playing') {
            const winner = st.tricks[st.tricks.length - 1]!.winner!;
            const after = plate(st, false);
            expect(after.actor).toBe(winner);
            if (winner !== HUMAN) expect(after.badge?.testId).toBe(`to-play-${winner}`);
            // and in the hold that follows, nobody is named at all
            expect(plate(st, true).badge).toBeNull();
          }
        }
      }
      expect(st.phase).toBe('gameOver');
    }
    expect(states).toBeGreaterThan(2000);
    expect(trickBoundaries).toBeGreaterThan(100);
  }, 120_000);
});
