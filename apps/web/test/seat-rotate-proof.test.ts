import { describe, expect, it } from 'vitest';
import { makeRules, sideOf } from '@spades/rules';
import { permute, rotation } from '../src/online/rotate';

/**
 * PROOF (passes on master): the online client's rotation cannot cross team
 * names with scores. OnlineTable.tsx builds the per-side names with
 * `room.teamNames?.[sideOf(rot.R(L), rules)]` over the same rotation that
 * permutes the scores — for every viewer seat, local side 0's name is the
 * name of the side that owns local side 0's score. (Owner report 2026-11-06:
 * the render layer is NOT where his names crossed.)
 */
describe('online rotation: names and scores cannot cross', () => {
  it('local side 0 name and score belong to the same real side, for every viewer seat', () => {
    const rules = makeRules('joker');
    const teamNames = ['Homies', 'Big Joker Energy'];
    const scores = [120, 45];
    for (const me of [0, 1, 2, 3]) {
      const rot = rotation(rules, me);
      const localScores = permute(scores, rot, true);
      const localNames = [0, 1].map((L) => teamNames[sideOf(rot.R(L), rules)] ?? null);
      const myRealSide = sideOf(me, rules);
      expect(localScores[0]).toBe(scores[myRealSide]);
      expect(localNames[0]).toBe(teamNames[myRealSide]);
      expect(localNames[1]).toBe(teamNames[1 - myRealSide]);
      expect(localScores[1]).toBe(scores[1 - myRealSide]);
    }
  });
});
