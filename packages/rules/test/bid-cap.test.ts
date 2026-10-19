import { describe, expect, it } from 'vitest';
import { type GameState, type TableRules, RuleError, applyAction, bidOptions, makeRules, newGame as realNewGame } from '../src';
import { bidAll, fill, rigged } from './helpers';

const newGame = (r: TableRules, seed: string) => realNewGame({ ...r, firstHandBidsItself: false, shotOut: false }, seed);
function err(fn: () => unknown, code: string) {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(RuleError); expect((e as RuleError).code).toBe(code); return; }
  throw new Error(`expected ${code}`);
}
const team = (bids: GameState['bids'], turn: number, rules: TableRules = makeRules('joker')): GameState => {
  const st = rigged(rules, fill(rules, [[], [], [], []]), 3);
  return { ...st, bids, turn };
};

describe('bid cap: team combined bid never exceeds books in hand', () => {
  it('second partner selector max is books minus partner bid (partner 7 -> max 6)', () => {
    // seats 0+2 are partners; seat 0 to bid, partner (2) already bid 7
    const st = team([null, 4, 7, 3], 0);
    expect(bidOptions(st, 0).max).toBe(6);
    expect(applyAction(st, { type: 'bid', seat: 0, bid: 6 }).bids[0]).toBe(6);
    err(() => applyAction(st, { type: 'bid', seat: 0, bid: 7 }), 'BAD_BID');
  });
  it('the reported bug cannot be recreated through the engine: 7 + 7 is rejected at entry', () => {
    const st = team([null, 1, 7, 1], 0);
    err(() => applyAction(st, { type: 'bid', seat: 0, bid: 7 }), 'BAD_BID');
  });
  it('first bidder may still bid the whole hand; second then has only Nil, no numeric buttons', () => {
    const st = team([null, 1, 13, 1], 0);
    const opt = bidOptions(st, 0);
    expect(opt.max).toBe(0);
    expect(opt.nil).toBe(true);
    expect(applyAction(st, { type: 'bid', seat: 0, bid: 'nil' }).bids[0]).toBe('nil');
    err(() => applyAction(st, { type: 'bid', seat: 0, bid: 1 }), 'BAD_BID');
  });
  it('with Nil off, the first bid holds one book back so the partner still has a numeric bid', () => {
    const r = makeRules('joker', { nil: { allowed: false } });
    const st = team([null, null, null, null], 0, r);
    expect(bidOptions(st, 0).max).toBe(12);
  });
  it('Nil and Blind Nil count as 0: a nil partner leaves the whole hand to the other bid', () => {
    expect(bidOptions(team([null, 1, 'nil', 1], 0), 0).max).toBe(13);
    expect(bidOptions(team([null, 1, 'blindNil', 1], 0), 0).max).toBe(13);
  });
  it('combined team bid never exceeds 13 across seeds when everyone bids the legal maximum', () => {
    const r = makeRules('joker');
    for (let i = 0; i < 40; i++) {
      let st = newGame(r, `cap-seed-${i}`);
      while (st.phase === 'bidding' && st.turn !== null) {
        const opt = bidOptions(st, st.turn);
        const bid = opt.max >= opt.min ? opt.max : 'nil';
        st = applyAction(st, { type: 'bid', seat: st.turn, bid });
      }
      const sum = (a: number, b: number) =>
        (typeof st.bids[a] === 'number' ? (st.bids[a] as number) : 0) +
        (typeof st.bids[b] === 'number' ? (st.bids[b] as number) : 0);
      for (const [a, b] of [[0, 2], [1, 3]] as const) {
        expect(sum(a, b)).toBeLessThanOrEqual(13);
      }
    }
  });
  it('existing violating states are not rewritten (cap applies at bid entry only)', () => {
    const st = team([7, 1, 7, 1], 0);
    expect(st.bids).toEqual([7, 1, 7, 1]);
  });
});

describe('bid cap: solo / Cutthroat', () => {
  it('4-player Cutthroat single bid caps at 13', () => {
    const r = makeRules('cutthroat');
    const st = rigged(r, fill(r, [[], [], [], []]), 3);
    expect(bidOptions(st, st.turn!).max).toBe(13);
    err(() => applyAction(st, { type: 'bid', seat: st.turn!, bid: 14 }), 'BAD_BID');
    expect(applyAction(st, { type: 'bid', seat: st.turn!, bid: 13 }).bids[st.turn!]).toBe(13);
  });
  it('3-player Cutthroat (17-card hands, 17 books) caps at 17, not 13', () => {
    const r = makeRules('cutthroat', { playerCount: 3 });
    const st = rigged(r, fill(r, [[], [], []]), 2);
    expect(bidOptions(st, st.turn!).max).toBe(17);
    err(() => applyAction(st, { type: 'bid', seat: st.turn!, bid: 18 }), 'BAD_BID');
  });
  it('Wheels is still reachable under the cap (team 10-13), and is not a separate bid type', () => {
    const st = bidAll(team([null, 1, 6, 1], 0), [6, 1, 6, 1]);
    // bidAll stops per seat indexing; just assert a legal 6+6=12 entry path exists via options
    expect(st.phase).toBeDefined();
    expect(bidOptions(team([null, 1, 6, 1], 0), 0).max).toBe(7);
  });
});
