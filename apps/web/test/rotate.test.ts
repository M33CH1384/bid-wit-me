import { describe, expect, it } from 'vitest';
import { type Card, type GameState, applyAction, makeRules, newGame, pendingTurn, scoreHand, sideOf, spectatorView, viewFor } from '@spades/rules';
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
          expect(sides).toEqual(rec.sides.map(({ shot: _s, out: _o, ...x }) => x));
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

  it("keeps the 'Run it!' and nuke auto-play flags on played cards (Release 6 hotfix: the online table lost them, so no zoom/tornado)", () => {
    const rules = makeRules('joker');
    const st = newGame(rules, 'rot-run');
    const seed: GameState = { ...st, tricks: [{ leader: 2, winner: 2, plays: [{ seat: 2, card: st.hands[2]![0]!, run: true }, { seat: 3, card: st.hands[3]![0]!, auto: true }, { seat: 0, card: st.hands[0]![0]! }, { seat: 1, card: st.hands[1]![0]! }] }] } as GameState;
    for (let me = 0; me < 4; me++) {
      const { st: L } = rotateView(viewFor(seed, me));
      const plays = L.tricks[0]!.plays;
      expect(plays.find((p) => p.card === st.hands[2]![0])!.run).toBe(true);
      expect(plays.find((p) => p.card === st.hands[3]![0])!.auto).toBe(true);
    }
  });

  it('rotates cleared Run it! hands into local seats, and omits them before the claim', () => {
    const rules = makeRules('joker');
    const dealt = newGame(rules, 'rot-run-hands');
    const hands: Card[][] = [['BJ', 'LJ'], ['3H', '4H'], ['5C', '6C'], ['3D', '7D']];
    const st: GameState = {
      ...dealt, phase: 'playing', hands, bids: [2, 2, 2, 2],
      tricks: Array.from({ length: 11 }, () => ({ leader: 0, plays: [], winner: 1 })),
      tricksWon: [0, 0, 0, 0], turn: 0, trick: { leader: 0, plays: [], winner: null }, spadesBroken: true,
    };
    for (let me = 0; me < 4; me++) expect(rotateView(viewFor(st, me)).view.runHands).toBeUndefined();
    expect(rotateView(spectatorView(st, 0)).view.runHands).toBeUndefined();
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    const sort = (xs: readonly { card: Card; played?: true }[]) => xs.map((x) => `${x.card}${x.played ? '*' : ''}`).sort();
    for (let me = 0; me < 4; me++) {
      const { view } = rotateView(viewFor(after, me));
      const real = viewFor(after, me).runHands!;
      expect(view.runHands).toHaveLength(4);
      for (let local = 0; local < 4; local++) expect(sort(view.runHands![local]!)).toEqual(sort(real[(local + me) % 4]!));
    }
    const watch = rotateView(spectatorView(after, 0)).view.runHands!;
    expect(watch.map(sort)).toEqual(viewFor(after, 0).runHands!.map(sort));
  });

  it('rotates a mid-trick Run it! recap, played flags included', () => {
    const rules = makeRules('cutthroat', { playerCount: 4 });
    const dealt = newGame(rules, 'rot-run-mid');
    const hands: Card[][] = [['BJ', 'LJ', '2D'], ['5C', '6C'], ['7C', '8C'], ['9C', 'TC', 'JC']];
    const st: GameState = {
      ...dealt, phase: 'playing', hands, bids: [2, 2, 2, 2],
      tricks: Array.from({ length: 10 }, () => ({ leader: 0, plays: [], winner: 1 })),
      tricksWon: [0, 0, 0, 0], turn: 3, trick: { leader: 1, plays: [{ seat: 1, card: '3H' }, { seat: 2, card: '4D' }], winner: null }, spadesBroken: true,
    };
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    const sig = (xs: readonly { card: Card; played?: true }[]) => xs.map((x) => `${x.card}${x.played ? '*' : ''}`).sort();
    for (let me = 0; me < 4; me++) {
      const { view } = rotateView(viewFor(after, me));
      const real = viewFor(after, me).runHands!;
      for (let local = 0; local < 4; local++) expect(sig(view.runHands![local]!)).toEqual(sig(real[(local + me) % 4]!));
    }
    const you = rotateView(viewFor(after, 0)).view.runHands!;
    expect(you.map((h) => h.length)).toEqual([3, 3, 3, 3]);
    expect(you[1]!.some((c) => c.card === '3H' && c.played)).toBe(true);
    expect(you[2]!.some((c) => c.card === '4D' && c.played)).toBe(true);
  });
});
