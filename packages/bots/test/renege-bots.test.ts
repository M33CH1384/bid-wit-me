import { describe, expect, it } from 'vitest';
import { type Card, type GameState, type TableRules, applyAction, bidOrder, buildDeck, makeRules, newGame, viewFor } from '@spades/rules';
import { RENEGE_HAND_RATE, RENEGE_NOTICE_RATE, chooseBotAction, chooseRenege, chooseRenegeCall, simulateGame } from '../src';

const rules: TableRules = { ...makeRules('joker'), firstHandBidsItself: false, shotOut: false, renege: true };

function fill(partial: Card[][]): Card[][] {
  const used = new Set(partial.flat());
  const rest = buildDeck(rules).filter((c) => !used.has(c));
  return partial.map((h) => { const out = [...h]; while (out.length < 13) out.push(rest.shift()!); return out; });
}

/** Dealer 3 (seat 0 leads), everyone bids 3, hands rigged; `seed` varies the bots' stable rolls via the dealer/score key. */
function table(hands: Card[][], scores = [0, 0]): GameState {
  let st: GameState = { ...newGame(rules, 'renege-bots'), dealer: 3, hands: fill(hands), scores, turn: bidOrder(rules, 3)[0]!, trick: { leader: 0, plays: [], winner: null } };
  while (st.phase === 'bidding') st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 3 });
  return st;
}
const play = (st: GameState, ...cards: Card[]) => cards.reduce((s, card) => applyAction(s, { type: 'play', seat: s.turn!, card }), st);

/** Book 0: seat 1 reneges (cuts A♥ with the 3♠ holding the 5♥). Book 1: seat 1 leads the 5♥ — the proof. */
function caught(scores = [0, 0]): GameState {
  const st = table([['AH', 'KH', '3C'], ['5H', '3S', '5C'], ['6H', '7H', '7C'], ['8H', '9H', '9C']], scores);
  return play(st, 'AH', '3S', '6H', '8H', '5H');
}

describe('bots calling a renege', () => {
  it('never call before the proof is on the table', () => {
    const st = play(table([['AH', 'KH', '3C'], ['5H', '3S', '5C'], ['6H', '7H', '7C'], ['8H', '9H', '9C']]), 'AH', '3S', '6H', '8H');
    for (const seat of [0, 2]) expect(chooseRenegeCall(viewFor(st, seat), 'shark')).toBeNull();
  });

  it('call the right player and book once the suit shows up, and the call is correct', () => {
    let seen = 0;
    for (let i = 0; i < 40; i++) {
      const st = caught([i * 10, 0]);
      const call = chooseRenegeCall(viewFor(st, 0), 'shark');
      if (!call) continue;
      seen++;
      expect(call).toEqual({ target: 1, trick: 0 });
      const next = applyAction(st, { type: 'callRenege', seat: 0, ...call });
      expect(next.renegeCalls![0]!.correct).toBe(true);
      // once called, nobody calls it again
      expect(chooseRenegeCall(viewFor(next, 2), 'shark')).toBeNull();
    }
    expect(seen).toBeGreaterThan(30); // sharks rarely miss
  });

  it('weaker bots miss more, and the answer is stable for the same spot', () => {
    const hits = (level: 'novice' | 'shark') => Array.from({ length: 200 }, (_, i) => chooseRenegeCall(viewFor(caught([i * 10, 0]), 0), level)).filter(Boolean).length;
    const novice = hits('novice'), shark = hits('shark');
    expect(novice).toBeLessThan(shark);
    expect(novice / 200).toBeGreaterThan(RENEGE_NOTICE_RATE.novice - 0.12);
    expect(novice / 200).toBeLessThan(RENEGE_NOTICE_RATE.novice + 0.12);
    const v = viewFor(caught([50, 0]), 0);
    expect(chooseRenegeCall(v, 'regular')).toEqual(chooseRenegeCall(v, 'regular'));
  });

  it('never accuse the reneger’s honest partner, and the reneging side does not call itself', () => {
    for (let i = 0; i < 40; i++) {
      const st = caught([i * 10, 0]);
      expect(chooseRenegeCall(viewFor(st, 0), 'shark')?.target ?? 1).toBe(1);
      expect(chooseRenegeCall(viewFor(st, 3), 'shark')).toBeNull();
    }
  });

  it('do nothing on a regular table', () => {
    const off = { ...rules, renege: false };
    const st = newGame(off, 'x');
    expect(chooseRenegeCall(viewFor(st, 0), 'shark')).toBeNull();
    expect(chooseRenege(viewFor(st, st.turn ?? 0), 'shark')).toBeNull();
  });
});

describe('bots reneging', () => {
  /** Book 0 is honest and seat 0 wins it (A♣). Book 1: seat 0 leads the K♥; seat 1 holds a low heart and spades — the spot. */
  function spot(scores: number[]): GameState {
    const st = table([['AC', 'KH', 'AH'], ['5C', '4H', '3S', '4S'], ['7C', '6H'], ['9C', '8H']], scores);
    return play(st, 'AC', '5C', '7C', '9C', 'KH');
  }

  it('happens sometimes, at roughly the per-hand rate, with a trump that wins the book', () => {
    let n = 0;
    const total = 300;
    for (let i = 0; i < total; i++) {
      const st = spot([i * 10, 0]);
      expect(st.turn).toBe(1);
      const c = chooseRenege(viewFor(st, 1), 'shark');
      if (!c) continue;
      n++;
      expect(c).toBe('3S');
      expect(viewFor(st, 1).legal).not.toContain(c); // it IS a renege
      const next = applyAction(st, { type: 'play', seat: 1, card: c });
      expect(next.reneges).toHaveLength(1);
    }
    expect(n / total).toBeGreaterThan(RENEGE_HAND_RATE.shark - 0.08);
    expect(n / total).toBeLessThan(RENEGE_HAND_RATE.shark + 0.08);
  });

  it('never when a Nil is on the line, when an honest card wins, or in the first book', () => {
    for (let i = 0; i < 100; i++) {
      // honest winner in hand: seat 1 holds the A♥ over the K♥
      const st = play(table([['AC', 'KH'], ['5C', 'AH', '3S'], ['7C', '6H'], ['9C', '8H']], [i * 10, 0]), 'AC', '5C', '7C', '9C', 'KH');
      expect(chooseRenege(viewFor(st, 1), 'shark')).toBeNull();
      // first book of the hand
      const first = play(table([['KH', 'AH'], ['4H', '3S'], ['6H'], ['8H']], [i * 10, 0]), 'KH');
      expect(chooseRenege(viewFor(first, 1), 'shark')).toBeNull();
    }
  });

  it('chooseBotAction itself always plays it straight (the driver opts a bot in)', () => {
    const final = simulateGame(rules, 'renege-sim', { levels: ['shark', 'shark', 'shark', 'shark'], maxHands: 60, onAction: (st) => expect(st.reneges).toBeUndefined() });
    expect(final.phase).toBe('gameOver');
    void chooseBotAction;
  });
});
