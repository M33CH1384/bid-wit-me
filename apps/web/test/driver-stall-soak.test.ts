import { describe, expect, it } from 'vitest';
import { type GameState, applyAction, canRunIt, lastCardDropOpen, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction, chooseRenege, chooseRenegeCall } from '@spades/bots';

/** Mirror of useGame's bot driver, seat 0 = the human (played by a bot brain, dropping its last card early). */
function drive(seed: string, renege: boolean): string | null {
  const rules = makeRules('joker', renege ? ({ renege: true } as never) : undefined);
  let st: GameState = newGame(rules, seed);
  const HUMAN = 0;
  for (let step = 0; step < 4000; step++) {
    if (st.phase === 'gameOver') return null;
    if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' } as never); continue; }
    // human: drop the last card early when open
    if (st.phase === 'playing' && st.turn !== HUMAN && lastCardDropOpen(st, HUMAN)) {
      const v = viewFor(st, HUMAN);
      if (v.legal.length !== 1) return `human drop not legal: hand ${st.handNo} trick ${st.tricks.length} legal=${v.legal.length} hand=${st.hands[HUMAN]}`;
      st = applyAction(st, { type: 'play', seat: HUMAN, card: v.legal[0]! } as never); continue;
    }
    if (st.phase === 'playing') {
      const claimer = [1, 2, 3].find((i) => i !== st.turn && canRunIt(st, i));
      if (claimer !== undefined) { st = applyAction(st, { type: 'runIt', seat: claimer } as never); continue; }
      const dropper = [1, 2, 3].find((i) => i !== st.turn && lastCardDropOpen(st, i));
      if (dropper !== undefined) {
        const v = viewFor(st, dropper);
        if (v.legal.length !== 1) return `STALL dropper seat ${dropper}: hand ${st.handNo} trick ${st.tricks.length} legal=${JSON.stringify(v.legal)} holds=${st.hands[dropper]} plays=${JSON.stringify(st.trick.plays)} leader=${st.trick.leader} turn=${st.turn} broken=${st.spadesBroken}`;
        try { st = applyAction(st, { type: 'play', seat: dropper, card: v.legal[0]! } as never); } catch (e) { return `STALL dropper apply threw: ${(e as Error).message}`; }
        continue;
      }
    }
    if (renege && (st.phase === 'playing')) {
      const caller = [1, 2, 3].find((i) => chooseRenegeCall(viewFor(st, i), 'regular' as never));
      if (caller !== undefined) {
        const call = chooseRenegeCall(viewFor(st, caller), 'regular' as never)!;
        const before = st;
        try { st = applyAction(st, { type: 'callRenege', seat: caller, ...call } as never); } catch (e) { return `STALL call threw: ${(e as Error).message}`; }
        if (st === before) return 'STALL call no-op';
        continue;
      }
    }
    const turn = pendingTurn(st);
    if (!turn) return `no pending turn in phase ${st.phase}`;
    let action;
    try { action = chooseBotAction(viewFor(st, turn.seat), 'regular' as never) as never; } catch (e) { return `bot brain threw: ${(e as Error).message}`; }
    if (renege && (action as { type: string }).type === 'play' && turn.seat % 2 === 1) {
      const cut = chooseRenege(viewFor(st, turn.seat), 'regular' as never);
      if (cut) action = { type: 'play', seat: turn.seat, card: cut } as never;
    }
    try { st = applyAction(st, action); } catch (e) { return `STALL turn apply threw seat ${turn.seat}: ${(e as Error).message} action=${JSON.stringify(action)} hand ${st.handNo} trick ${st.tricks.length}`; }
  }
  return 'did not finish in 4000 steps';
}

describe('soak: the offline driver never stalls', () => {
  for (const renege of [false, true]) {
    it(`renege ${renege ? 'on' : 'off'}`, () => {
      const problems: string[] = [];
      for (let i = 0; i < 150; i++) { const p = drive(`soak-${renege}-${i}`, renege); if (p) problems.push(`${i}: ${p}`); }
      expect(problems.slice(0, 5)).toEqual([]);
    });
  }
});
