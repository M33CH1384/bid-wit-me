import { describe, expect, it } from 'vitest';
import { applyAction, makeRules, runClearedHands, runPlayout, viewFor, type GameState } from '@spades/rules';
import { simulateGame } from '@spades/bots';

const norm = (cs: readonly string[]) => [...cs].sort().join(',');

describe('run it! simulateGame invariants', () => {
  it('claimer recap/zoom equal the claimer real remaining cards in real bot games', () => {
    let claims = 0;
    for (const mode of ['joker', 'cutthroat', 'aceDown'] as const) {
      for (let g = 0; g < 25; g++) {
        simulateGame(makeRules(mode, { playerCount: 4 }), `sim-${mode}-${g}`, {
          maxHands: 30,
          onAction: (st: GameState, action) => {
            if (action.type !== 'runIt') return;
            claims++;
            const seat = action.seat;
            const after = applyAction(st, action);
            // truth: the claimer's cards in hand at claim time + its card already on the table
            const onTable = st.trick.plays.filter((p) => p.seat === seat).map((p) => p.card);
            const truth = norm([...st.hands[seat]!, ...onTable]);
            const cleared = runClearedHands(after)!;
            expect(cleared, `${mode} game ${g}: recap null`).toBeTruthy();
            expect(norm(cleared[seat]!.map((x) => x.card)), `${mode} game ${g}: recap != claimer truth`).toBe(truth);
            const playout = runPlayout(st, after, seat)!;
            const zoomSet = norm([
              ...playout.tricks.flatMap((t) => t.plays.filter((p) => !p.played && p.seat === seat)).map((p) => p.card),
              ...playout.tricks.flatMap((t) => t.plays.filter((p) => p.played && p.seat === seat)).map((p) => p.card),
            ]);
            expect(zoomSet, `${mode} game ${g}: zoom != claimer truth`).toBe(truth);
            // view-level: every viewer's runHands row for the claimer matches truth
            for (let me = 0; me < 4; me++) {
              const v = viewFor(after, me);
              expect(norm(v.runHands![seat]!.map((x) => x.card))).toBe(truth);
            }
          },
        });
      }
    }
    console.log(`simulateGame claims checked: ${claims}`);
    expect(claims).toBeGreaterThan(20);
  });
});
