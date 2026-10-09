import { describe, expect, it } from 'vitest';
import {
  type Card, type GameState, type TableRules, applyAction, buildDeck, createRng, makeRules, newGame, viewFor,
} from '@spades/rules';
import { chooseBotAction, chooseBid, chooseExchange, choosePlay, estimateTricks, nilWorthy, simulateGame, wantsBlindNil } from '../src';

const joker = makeRules('joker');

function fill(rules: TableRules, partial: Card[][]): Card[][] {
  const used = new Set(partial.flat());
  const rest = buildDeck(rules).filter((c) => !used.has(c));
  const size = rules.playerCount === 4 ? 13 : 17;
  return partial.map((h) => { const o = [...h]; while (o.length < size) o.push(rest.shift()!); return o; });
}

function rig(rules: TableRules, hands: Card[][], patch: Partial<GameState> = {}): GameState {
  const st = newGame(rules, 'bot-test');
  return { ...st, dealer: 3, turn: 0, hands, revealed: Array(rules.playerCount).fill(true), trick: { leader: 0, plays: [], winner: null }, ...patch };
}

describe('bidding heuristics', () => {
  it('a monster hand bids high, a weak hand bids nil', () => {
    const strong: Card[] = ['BJ', 'LJ', 'AS', 'KS', 'QS', 'AH', 'KH', 'AD', 'KD', 'AC', 'KC', '3H', '3C'];
    const weak: Card[] = ['3S', '4H', '5H', '6H', '7H', '3D', '4D', '5D', '6D', '4C', '5C', '6C', '7C'];
    const st = rig(joker, [strong, weak, ...fill(joker, [strong, weak, [], []]).slice(2)]);
    const v0 = viewFor(st, 0);
    expect(estimateTricks(strong, v0)).toBeGreaterThan(9);
    expect(chooseBid(v0, 'normal', createRng(1))).toBeGreaterThanOrEqual(9);
    const v1 = viewFor({ ...st, turn: 1 }, 1);
    expect(nilWorthy(weak, v1)).toBe(true);
    expect(chooseBid(v1, 'normal', createRng(1))).toBe('nil');
    expect(nilWorthy(strong, v0)).toBe(false);
  });
  it('does not nil when the partner already bid nil, and respects minimum bids', () => {
    const r = makeRules('joker', { minTeamBid: 5 });
    const weak: Card[] = ['3S', '4H', '5H', '6H', '7H', '3D', '4D', '5D', '6D', '4C', '5C', '6C', '7C'];
    const hands = fill(r, [[], [], weak, []]);
    const st = rig(r, hands, { turn: 2, bids: ['nil', 3, null, null] });
    const bid = chooseBid(viewFor(st, 2), 'normal', createRng(1));
    expect(bid).toBeGreaterThanOrEqual(5);
  });
  it('easy bots never nil; all bids are within options', () => {
    for (let i = 0; i < 30; i++) {
      const st = newGame(joker, `easy${i}`);
      const v = viewFor(st, st.turn!);
      const b = chooseBid(v, 'easy', createRng(i));
      expect(typeof b).toBe('number');
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(13);
    }
  });
  it('blind nil only when far behind with a strong partner bid, never in cutthroat', () => {
    const r = makeRules('joker');
    const st = rig(r, fill(r, [[], [], [], []]), { turn: 2, bids: [6, 3, null, null], scores: [100, 450], revealed: [true, true, false, true] });
    expect(wantsBlindNil(viewFor(st, 2), 'normal')).toBe(true);
    expect(wantsBlindNil(viewFor(st, 2), 'easy')).toBe(false);
    expect(wantsBlindNil(viewFor({ ...st, bids: [2, 3, null, null] }, 2), 'normal')).toBe(false);
    expect(chooseBotAction(viewFor(st, 2), 'normal')).toEqual({ type: 'bid', seat: 2, bid: 'blindNil' });
    expect(chooseBotAction(viewFor({ ...st, bids: [2, 3, null, null] }, 2), 'normal')).toEqual({ type: 'reveal', seat: 2 });
    const c = makeRules('cutthroat');
    const cs = rig(c, fill(c, [[], [], [], []]), { scores: [0, 500, 0, 0], revealed: [false, true, true, true] });
    expect(wantsBlindNil(viewFor(cs, 0), 'normal')).toBe(false);
  });
});

describe('play heuristics', () => {
  const hands: Card[][] = [
    ['AH', '9H', '3H', 'KC', '5C', '4D', '3S', '4S', '5S', 'QD', 'TC', '6D', '8C'],
    ['KH', 'QH', 'JH', 'TH', '8H', '7H', '6H', '5H', '4H', 'AD', 'KD', 'JD', 'TD'],
    ['AC', 'QC', 'JC', '9C', '7C', '6C', '4C', '3C', '2C', '9D', '8D', '7D', '5D'],
    ['BJ', 'LJ', 'AS', 'KS', 'QS', 'JS', 'TS', '9S', '8S', '7S', '6S', '2S', '3D'],
  ];
  it('a nil bidder ducks under the current winner', () => {
    const st = rig(joker, hands, { phase: 'playing', bids: ['nil', 4, 4, 5], turn: 0, trick: { leader: 3, plays: [{ seat: 3, card: '3D' }], winner: null } });
    // following diamonds: holds 4D, 6D, QD; 4D/6D/QD all beat 3D → must win; plays lowest since others follow
    expect(choosePlay(viewFor(st, 0), 'normal')).toBe('4D');
    const st2 = { ...st, trick: { leader: 1, plays: [{ seat: 1, card: 'KH' as Card }], winner: null } };
    // hearts: AH, 9H, 3H — dump the highest loser (9H)
    expect(choosePlay(viewFor({ ...st2, turn: 0 }, 0), 'normal')).toBe('9H');
  });
  it('a nil bidder leads low', () => {
    const st = rig(joker, hands, { phase: 'playing', bids: ['nil', 4, 4, 5], turn: 0 });
    expect(choosePlay(viewFor(st, 0), 'normal')).toBe('3H');
  });
  it('covers a nil partner by playing high', () => {
    // seat 2 covers partner seat 0 (nil), who plays after seat 2 in this trick (leader 1)
    const st = rig(joker, hands, { phase: 'playing', bids: ['nil', 4, 4, 5], turn: 2, trick: { leader: 1, plays: [{ seat: 1, card: 'AD' }], winner: null } });
    // seat 2 has diamonds 9D 8D 7D 5D — cannot beat AD → plays low
    expect(choosePlay(viewFor(st, 2), 'normal')).toBe('5D');
    const st2 = { ...st, trick: { leader: 1, plays: [{ seat: 1, card: '8H' as Card }], winner: null } };
    // seat 2 void in hearts, no trumps → discard; but partner nil still to play
    expect(viewFor(st2, 2).legal.length).toBe(13);
    const lead = rig(joker, hands, { phase: 'playing', bids: ['nil', 4, 4, 5], turn: 2 });
    expect(choosePlay(viewFor(lead, 2), 'normal')).toBe('AC');
  });
  it('ducks to avoid bags once the contract is made', () => {
    const st = rig(joker, hands, {
      phase: 'playing', bids: [1, 4, 1, 5], tricksWon: [1, 0, 1, 0], turn: 0,
      trick: { leader: 1, plays: [{ seat: 1, card: 'TH' }], winner: null },
    });
    expect(choosePlay(viewFor(st, 0), 'normal')).toBe('9H');
  });
  it('wins with the lowest winning card when last to play and tricks are needed', () => {
    const st = rig(joker, hands, {
      phase: 'playing', bids: [4, 4, 4, 1], turn: 0,
      trick: { leader: 1, plays: [{ seat: 1, card: 'TH' }, { seat: 2, card: '2C' }, { seat: 3, card: '3D' }], winner: null },
    });
    expect(choosePlay(viewFor(st, 0), 'normal')).toBe('AH');
  });
  it('does not overtake a partner who is winning on the last seat', () => {
    const st = rig(joker, hands, {
      phase: 'playing', bids: [4, 4, 4, 1], turn: 0,
      trick: { leader: 1, plays: [{ seat: 1, card: '2C' }, { seat: 2, card: 'AC' }, { seat: 3, card: '3D' }], winner: null },
    });
    expect(choosePlay(viewFor(st, 0), 'normal')).toBe('5C');
  });
  it('blind nil exchange: nil passes high, partner passes low', () => {
    const r = makeRules('joker', { blindNil: { onlyWhenBehindBy: null, exchangeCards: 2 } });
    const st = rig(r, hands, { phase: 'exchange', bids: ['blindNil', 3, 4, 5], turn: 0, exchange: [{ from: 0, to: 2, count: 2 }, { from: 2, to: 0, count: 2 }] });
    expect(chooseExchange(viewFor(st, 0)).sort()).toEqual(['4S', '5S']);
    const st2 = { ...st, turn: 2, exchange: [{ from: 2, to: 0, count: 2 }] };
    expect(chooseExchange(viewFor(st2, 2)).sort()).toEqual(['2C', '3C']);
    expect(chooseBotAction(viewFor(st2, 2))).toMatchObject({ type: 'exchange', seat: 2 });
  });
  it('returns null when it is not the seat\'s turn', () => {
    const st = newGame(joker, 'x');
    expect(chooseBotAction(viewFor(st, (st.turn! + 1) % 4))).toBeNull();
    expect(chooseBotAction(viewFor({ ...st, phase: 'handOver' }, st.turn!))).toBeNull();
  });
});

describe('no peeking', () => {
  it('decisions depend only on the seat view (shuffling hidden hands changes nothing)', () => {
    for (let i = 0; i < 20; i++) {
      let st = newGame(joker, `peek${i}`);
      // bid through so we're in play
      while (st.phase === 'bidding') st = applyAction(st, chooseBotAction(viewFor(st, st.turn!))!);
      for (let k = 0; k < 9; k++) st = applyAction(st, chooseBotAction(viewFor(st, st.turn!))!);
      const me = st.turn!;
      const others = [0, 1, 2, 3].filter((s) => s !== me);
      const pool = others.flatMap((s) => st.hands[s]!).reverse();
      const swapped = st.hands.map((h, s) => (s === me ? h : pool.splice(0, h.length)));
      const a = chooseBotAction(viewFor(st, me));
      const b = chooseBotAction(viewFor({ ...st, hands: swapped }, me));
      expect(b).toEqual(a);
    }
  });
});

describe('full bot games', () => {
  const modes: [string, TableRules][] = [
    ['joker', joker],
    ['cutthroat 4', makeRules('cutthroat')],
    ['cutthroat 3', makeRules('cutthroat', { playerCount: 3 })],
    ['aceDown', makeRules('aceDown')],
    ['joker exchange + 2C lead', makeRules('joker', { firstLead: 'twoOfClubs', blindNil: { onlyWhenBehindBy: null, exchangeCards: 2 } })],
  ];
  it.each(modes)('%s: games finish without illegal moves', (_n, rules) => {
    for (let g = 0; g < 8; g++) {
      const st = simulateGame(rules, `full:${g}`, { levels: g % 2 ? ['easy', 'normal', 'easy', 'normal'] : undefined });
      expect(st.phase).toBe('gameOver');
      expect(st.result!.winners.length).toBeGreaterThan(0);
      expect(st.history.reduce((a, h) => a + h.sides.reduce((x, s) => x + s.points, 0), 0)).toBe(st.scores.reduce((a, b) => a + b, 0));
    }
  });
  it('maxHands guard', () => {
    expect(() => simulateGame(joker, 'guard', { maxHands: 1 })).toThrow(/exceeded/);
  });
  it('golden: a seeded Joker game is fully deterministic', () => {
    const run = () => simulateGame(joker, 'golden-1');
    const a = run();
    expect(run().history).toEqual(a.history);
    expect({
      hands: a.history.length,
      perHand: a.history.map((h) => ({ bids: h.bids, tricks: h.tricksWon, totals: h.sides.map((s) => s.totalScore), bags: h.sides.map((s) => s.totalBags) })),
      result: a.result,
    }).toMatchSnapshot();
  });
  it.each(modes.slice(1, 4))('golden: %s final result', (_n, rules) => {
    const st = simulateGame(rules, `golden:${_n}`);
    expect({ hands: st.history.length, scores: st.scores, bags: st.bags, result: st.result }).toMatchSnapshot();
  });
});
