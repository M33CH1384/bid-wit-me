import { describe, expect, it } from 'vitest';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, scoreHand, sideOf, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { HIDDEN, rotateView, rotation } from '../src/online/rotate';

function advance(st: GameState, steps: number): GameState {
  for (let i = 0; i < steps && st.phase !== 'gameOver'; i++) {
    if (st.phase === 'handOver') { st = applyAction(st, { type: 'nextHand' }); continue; }
    const t = pendingTurn(st)!;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat))!);
  }
  return st;
}

describe('online seat rotation', () => {
  for (const [label, rules] of [['joker 2v2', makeRules('joker')], ['cutthroat 4', makeRules('cutthroat', { playerCount: 4 })], ['cutthroat 3', makeRules('cutthroat', { playerCount: 3 })]] as const) {
    it(`${label}: every seat sees itself at local 0, with consistent seats/sides/history`, () => {
      let st = newGame(rules, `rot-${label}`);
      st = advance(st, 140); // a couple of hands in, mid-trick
      const n = rules.playerCount;
      for (let me = 0; me < n; me++) {
        const rot = rotation(rules, me);
        const { st: L, view } = rotateView(viewFor(st, me));
        expect(view.seat).toBe(0);
        expect(L.hands[0]).toEqual(st.hands[me]);
        for (let i = 1; i < n; i++) {
          expect(L.hands[i]!.length).toBe(st.hands[rot.R(i)]!.length);
          expect(L.hands[i]!.every((c) => c === HIDDEN)).toBe(true);
        }
        for (let i = 0; i < n; i++) {
          expect(L.bids[i]).toEqual(st.bids[rot.R(i)]);
          expect(L.tricksWon[i]).toBe(st.tricksWon[rot.R(i)]);
          // the side a local seat belongs to holds that real seat's side score
          expect(L.scores[sideOf(i, rules)]).toBe(st.scores[sideOf(rot.R(i), rules)]);
        }
        expect(rot.R(L.dealer)).toBe(st.dealer);
        if (st.turn !== null) expect(rot.R(L.turn!)).toBe(st.turn);
        L.trick.plays.forEach((p, k) => { expect(rot.R(p.seat)).toBe(st.trick.plays[k]!.seat); expect(p.card).toBe(st.trick.plays[k]!.card); });
        // re-scoring the rotated hand records reproduces the rotated results (sides/nils/seat indices all line up)
        let scores = st.history.length ? Array(L.scores.length).fill(0) : [];
        let bags = Array(L.scores.length).fill(0);
        for (const rec of L.history) {
          const sides = scoreHand(rules, rec.bids as never, rec.tricksWon, scores, bags);
          expect(sides).toEqual(rec.sides.map(({ shot: _s, ...x }) => x));
          scores = sides.map((s) => s.totalScore);
          bags = sides.map((s) => s.totalBags);
        }
        // legal moves / my own view stay as-is
        expect(view.legal).toEqual(viewFor(st, me).legal);
      }
    });
  }

  it('game result rotates: my side wins ⇔ I win', () => {
    let st = newGame(makeRules('joker', { targetScore: 100 }), 'rot-result');
    st = advance(st, 100_000);
    expect(st.phase).toBe('gameOver');
    for (let me = 0; me < 4; me++) {
      const { st: L } = rotateView(viewFor(st, me));
      const iWon = st.result!.winners.includes(sideOf(me, st.rules));
      expect(L.result!.winners.includes(sideOf(0, st.rules))).toBe(iWon);
      expect(L.result!.finalScores[0]).toBe(st.result!.finalScores[sideOf(me, st.rules)]);
    }
  });
});
