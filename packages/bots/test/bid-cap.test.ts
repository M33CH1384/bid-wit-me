import { describe, expect, it } from 'vitest';
import { type Card, type GameState, type TableRules, applyAction, buildDeck, createRng, makeRules, newGame, viewFor } from '@spades/rules';
import { chooseBid, estimateTricks, partnerBidIntent } from '../src';

const joker = makeRules('joker');
function fill(rules: TableRules, partial: Card[][]): Card[][] {
  const used = new Set(partial.flat());
  const rest = buildDeck(rules).filter((c) => !used.has(c));
  const size = rules.playerCount === 4 ? 13 : 17;
  return partial.map((h) => { const o = [...h]; while (o.length < size) o.push(rest.shift()!); return o; });
}
function rig(rules: TableRules, hands: Card[][], patch: Partial<GameState> = {}): GameState {
  const st = newGame({ ...rules, firstHandBidsItself: false }, 'bot-cap');
  return { ...st, phase: 'bidding', bids: Array(rules.playerCount).fill(null), dealer: 3, turn: 0, hands, revealed: Array(rules.playerCount).fill(true), trick: { leader: 0, plays: [], winner: null }, ...patch };
}
const strong: Card[] = ['BJ', 'LJ', 'AS', 'KS', 'QS', 'AH', 'KH', 'AD', 'KD', 'AC', 'KC', '3H', '3C'];

describe('bot bidding under the team cap', () => {
  it('bot bidding second caps itself at books minus the human partner bid (7 -> at most 6)', () => {
    const hands = fill(joker, [strong, [], [], []]);
    // seat 0 bot, partner seat 2 already bid 7
    const st = rig(joker, hands, { turn: 0, bids: [null, 3, 7, 4] });
    for (const level of ['novice', 'regular', 'pro', 'shark'] as const) {
      const bid = chooseBid(viewFor(st, 0), level, createRng(7));
      expect(bid === 'nil' || (typeof bid === 'number' && bid <= 6)).toBe(true);
    }
  });
  it('bot estimate is its own books only (same hand, partner bid changes only the cap, not the uncapped intent)', () => {
    const hands = fill(joker, [strong, [], [], []]);
    const alone = rig(joker, hands, { turn: 0, bids: [null, null, null, null] });
    const v = viewFor(alone, 0);
    // intent from its own hand alone; estimateTricks reads only that hand
    expect(estimateTricks(strong, v)).toBeGreaterThan(8);
    const intent = partnerBidIntent(viewFor(alone, 0), 'pro', createRng(1));
    expect(typeof intent).toBe('number');
    // with partner at 7 the same hand's intent is capped to the remainder
    const capped = partnerBidIntent(viewFor(rig(joker, hands, { turn: 0, bids: [null, 3, 7, 4] }), 0), 'pro', createRng(1));
    expect(capped === 'nil' || (typeof capped === 'number' && capped <= 6)).toBe(true);
  });
  it('combined team bid never exceeds 13 across seeds with bot-style max bidding through the engine', () => {
    const r = makeRules('joker', { firstHandBidsItself: false });
    for (let i = 0; i < 25; i++) {
      let st = newGame(r, `bot-cap-${i}`);
      while (st.phase === 'bidding' && st.turn !== null) {
        const v = viewFor(st, st.turn);
        const bid = v.hand === null ? null : chooseBid(v, 'pro', createRng(i));
        if (bid === null) { st = applyAction(st, { type: 'reveal', seat: st.turn }); continue; }
        st = applyAction(st, { type: 'bid', seat: st.turn, bid });
      }
      for (const [a, b] of [[0, 2], [1, 3]] as const) {
        const total = (typeof st.bids[a] === 'number' ? (st.bids[a] as number) : 0) + (typeof st.bids[b] === 'number' ? (st.bids[b] as number) : 0);
        expect(total).toBeLessThanOrEqual(13);
      }
    }
  });
  it('Cutthroat bot bid caps at that hand book count (17 in 3-player)', () => {
    const r = makeRules('cutthroat', { playerCount: 3 });
    const st = rig(r, fill(r, [[], [], []]), { turn: 0 });
    const bid = chooseBid(viewFor(st, 0), 'pro', createRng(3));
    expect(typeof bid).toBe('number');
    expect(bid as number).toBeLessThanOrEqual(17);
  });
});
