import { describe, expect, it } from 'vitest';
import {
  type Card, type GameState, RuleError, applyAction, bidOptions, buildDeck, deckForHand, legalPlays, legalPlaysFor,
  makeRules, newGame, pendingTurn, trickWinner, viewFor, viewMustLeadTwoOfClubs, RulesConfigError,
} from '../src';
import { bidAll, fill, play, rigged } from './helpers';

const joker = makeRules('joker');

function expectRuleError(fn: () => unknown, code: string) {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(RuleError); expect((e as RuleError).code).toBe(code); return; }
  throw new Error(`expected RuleError ${code}`);
}

describe('newGame and dealing', () => {
  it('deals every card exactly once, 13 each, starting left of the dealer', () => {
    const st = newGame(joker, 'deal-1');
    expect(st.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    const all = st.hands.flat();
    expect(new Set(all).size).toBe(52);
    expect([...all].sort()).toEqual([...buildDeck(joker)].sort());
    const deck = deckForHand(joker, 'deal-1', 1);
    expect(st.hands[(st.dealer + 1) % 4]![0]).toBe(deck[0]);
    expect(st.phase).toBe('bidding');
    expect(st.turn).toBe((st.dealer + 1) % 4);
    expect(st.handNo).toBe(1);
  });
  it('3-player cutthroat deals 17 each', () => {
    const st = newGame(makeRules('cutthroat', { playerCount: 3 }), 'x');
    expect(st.hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(st.scores).toEqual([0, 0, 0]);
  });
  it('is deterministic per seed and different across seeds', () => {
    expect(newGame(joker, 'a').hands).toEqual(newGame(joker, 'a').hands);
    expect(newGame(joker, 'a').hands).not.toEqual(newGame(joker, 'b').hands);
  });
  it('the first dealer is random (varies by seed)', () => {
    const dealers = new Set(Array.from({ length: 40 }, (_, i) => newGame(joker, `d${i}`).dealer));
    expect(dealers.size).toBe(4);
  });
  it('rejects invalid rules', () => {
    expect(() => newGame({ ...joker, removedCards: [] }, 'x')).toThrow(RulesConfigError);
  });
  it('the deal passes to the left each hand', () => {
    let st = newGame(joker, 'pass');
    const d = st.dealer;
    st = { ...st, phase: 'handOver', turn: null };
    st = applyAction(st, { type: 'nextHand' });
    expect(st.dealer).toBe((d + 1) % 4);
    expect(st.handNo).toBe(2);
  });
  it('nextHand only when the hand is over', () => {
    expectRuleError(() => applyAction(newGame(joker, 'x'), { type: 'nextHand' }), 'WRONG_PHASE');
  });
});

describe('bidding', () => {
  const base = () => rigged(joker, fill(joker, [[], [], [], []]), 3);
  it('goes clockwise from left of the dealer and starts play left of dealer', () => {
    let st = base();
    expect(st.turn).toBe(0);
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 1, bid: 3 }), 'NOT_YOUR_TURN');
    st = bidAll(st, [3, 4, 2, 4]);
    expect(st.bids).toEqual([3, 4, 2, 4]);
    expect(st.phase).toBe('playing');
    expect(st.turn).toBe(0);
    expect(pendingTurn(st)).toEqual({ seat: 0, kind: 'play' });
  });
  it('validates range; 0 means nil', () => {
    const st = base();
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 0, bid: 14 }), 'BAD_BID');
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 0, bid: 2.5 }), 'BAD_BID');
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 0, bid: -1 }), 'BAD_BID');
    expect(applyAction(st, { type: 'bid', seat: 0, bid: 0 }).bids[0]).toBe('nil');
    expect(applyAction(st, { type: 'bid', seat: 0, bid: 13 }).bids[0]).toBe(13);
  });
  it('3-player bids go up to 17', () => {
    const r = makeRules('cutthroat', { playerCount: 3 });
    const st = rigged(r, fill(r, [[], [], []]), 2);
    expect(bidOptions(st, 0).max).toBe(17);
    expect(applyAction(st, { type: 'bid', seat: 0, bid: 17 }).bids[0]).toBe(17);
  });
  it('nil can be disabled', () => {
    const r = makeRules('joker', { nil: { allowed: false } });
    const st = rigged(r, fill(r, [[], [], [], []]));
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 0, bid: 'nil' }), 'NIL_NOT_ALLOWED');
  });
  it('partner of a nil bidder may also bid nil by default, but not when disabled', () => {
    let st = applyAction(base(), { type: 'bid', seat: 0, bid: 'nil' });
    st = applyAction(st, { type: 'bid', seat: 1, bid: 3 });
    expect(bidOptions(st, 2).nil).toBe(true);
    const r = makeRules('joker', { partnerMayAlsoNil: false });
    let s2 = rigged(r, fill(r, [[], [], [], []]));
    s2 = bidAll(s2, ['nil', 3] as never);
    expect(bidOptions(s2, 2).nil).toBe(false);
    expectRuleError(() => applyAction(s2, { type: 'bid', seat: 2, bid: 'nil' }), 'NIL_NOT_ALLOWED');
  });
  it('minimum team bid applies to the second partner', () => {
    const r = makeRules('joker', { minTeamBid: 4 });
    let st = rigged(r, fill(r, [[], [], [], []]));
    expect(bidOptions(st, 0).min).toBe(1); // partner still to bid
    st = bidAll(st, [1, 2] as never);
    expect(bidOptions(st, 2).min).toBe(3);
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 2, bid: 2 }), 'BID_TOO_LOW');
    expect(applyAction(st, { type: 'bid', seat: 2, bid: 'nil' }).bids[2]).toBe('nil'); // nil is exempt
    st = applyAction(st, { type: 'bid', seat: 2, bid: 3 });
    expect(bidOptions(st, 3).min).toBe(2);
  });
  it('minimum bid applies alone when the partner bid nil, and individually in cutthroat', () => {
    const r = makeRules('joker', { minTeamBid: 4 });
    const st = bidAll(rigged(r, fill(r, [[], [], [], []])), ['nil', 2] as never);
    expect(bidOptions(st, 2).min).toBe(4);
    const c = makeRules('cutthroat', { minTeamBid: 2 });
    expect(bidOptions(rigged(c, fill(c, [[], [], [], []])), 0).min).toBe(2);
  });
  it('blind nil: only when behind by ≥100 by default; cards stay hidden until chosen', () => {
    const st0 = newGame(joker, 'blind');
    expect(st0.revealed.every(Boolean)).toBe(true); // 0–0: not eligible, so nobody waits
    expect(bidOptions(st0, st0.turn!).blindNil).toBe(false);
    let st: GameState = { ...newGame(joker, 'blind'), scores: [0, 150], phase: 'handOver', turn: null };
    st = applyAction(st, { type: 'nextHand' });
    // team 0 (seats 0,2) is behind by 150 → may blind nil; team 1 may not
    expect(st.revealed).toEqual([false, true, false, true]);
    expect(viewFor(st, 0).hand).toBeNull();
    expect(viewFor(st, 1).hand).toHaveLength(13);
    expect(bidOptions(st, 0).blindNil).toBe(true);
    expect(bidOptions(st, 1).blindNil).toBe(false);
  });
  it('blind nil bid and reveal flow', () => {
    let st: GameState = { ...newGame(joker, 'bn'), scores: [0, 150], phase: 'handOver', turn: null, dealer: 2 };
    st = applyAction(st, { type: 'nextHand' }); // dealer 3, seat 0 bids first
    expect(st.turn).toBe(0);
    st = applyAction(st, { type: 'bid', seat: 0, bid: 'blindNil' });
    expect(st.bids[0]).toBe('blindNil');
    expect(st.revealed[0]).toBe(true);
    st = applyAction(st, { type: 'bid', seat: 1, bid: 3 });
    // seat 2 looks at cards first, then can no longer blind nil
    st = applyAction(st, { type: 'reveal', seat: 2 });
    expect(bidOptions(st, 2).blindNil).toBe(false);
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 2, bid: 'blindNil' }), 'BLIND_NIL_NOT_ALLOWED');
    expectRuleError(() => applyAction(st, { type: 'reveal', seat: 2 }), 'ALREADY_REVEALED');
    expectRuleError(() => applyAction(st, { type: 'reveal', seat: 0 }), 'WRONG_PHASE');
    st = applyAction(st, { type: 'bid', seat: 2, bid: 4 });
    st = applyAction(st, { type: 'bid', seat: 3, bid: 4 });
    expect(st.phase).toBe('playing');
    expectRuleError(() => applyAction(st, { type: 'reveal', seat: 1 }), 'WRONG_PHASE');
  });
  it('blind nil always allowed when onlyWhenBehindBy is null; disabled when not allowed', () => {
    const r = makeRules('joker', { blindNil: { onlyWhenBehindBy: null } });
    expect(newGame(r, 'x').revealed.every((x) => !x)).toBe(true);
    const off = makeRules('joker', { blindNil: { allowed: false, onlyWhenBehindBy: null } });
    expect(newGame(off, 'x').revealed.every(Boolean)).toBe(true);
  });
  it('cutthroat blind nil compares you with the leader', () => {
    const r = makeRules('cutthroat');
    let st: GameState = { ...newGame(r, 'ct'), scores: [120, 10, 30, 0], phase: 'handOver', turn: null };
    st = applyAction(st, { type: 'nextHand' });
    expect(st.revealed).toEqual([true, false, true, false]);
  });
  it('rejects actions in the wrong phase or from bad seats', () => {
    const st = base();
    expectRuleError(() => applyAction(st, { type: 'play', seat: 0, card: st.hands[0]![0]! }), 'WRONG_PHASE');
    expectRuleError(() => applyAction(st, { type: 'exchange', seat: 0, cards: [] }), 'WRONG_PHASE');
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 4, bid: 3 }), 'BAD_SEAT');
    const playing = bidAll(st, [3, 3, 3, 3]);
    expectRuleError(() => applyAction(playing, { type: 'bid', seat: 0, bid: 3 }), 'WRONG_PHASE');
    expectRuleError(() => applyAction(playing, { type: 'reveal', seat: 0 }), 'WRONG_PHASE');
  });
});

describe('trick play legality', () => {
  // seat 0 leads (dealer 3)
  const hands: Card[][] = fill(joker, [
    ['AH', '3H', 'KS', 'BJ'],
    ['KH', 'QC', '4S'],
    ['5C', '6C', '7C', '8C', '9C', 'TC', 'JC', '9D', 'TD', 'JD', 'QD', 'KD', 'AD'],
    ['LJ', '2S'],
  ]);
  const start = () => bidAll(rigged(joker, hands, 3), [3, 3, 3, 3]);

  it('cannot lead spades or jokers before spades are broken', () => {
    const st = start();
    expect(legalPlays(st, 0).some((c) => c === 'KS' || c === 'BJ')).toBe(false);
    expectRuleError(() => applyAction(st, { type: 'play', seat: 0, card: 'KS' }), 'SPADES_NOT_BROKEN');
    expectRuleError(() => applyAction(st, { type: 'play', seat: 0, card: 'BJ' }), 'SPADES_NOT_BROKEN');
  });
  it('must follow suit; jokers count as spades', () => {
    let st = play(start(), 'AH');
    expect(legalPlays(st, 1).every((c) => c[1] === 'H')).toBe(true);
    expectRuleError(() => applyAction(st, { type: 'play', seat: 1, card: '4S' }), 'MUST_FOLLOW_SUIT');
    expectRuleError(() => applyAction(st, { type: 'play', seat: 0, card: '3H' }), 'NOT_YOUR_TURN');
    st = play(st, 'KH');
    // seat 2 has no hearts → any card
    expect(legalPlays(st, 2)).toHaveLength(13);
    st = play(st, '5C');
    expectRuleError(() => applyAction(st, { type: 'play', seat: 3, card: 'XX' as Card }), 'CARD_NOT_IN_HAND');
  });
  it('trumping in breaks spades; highest trump wins; the winner leads next', () => {
    const fixed: Card[][] = [
      ['AH', 'KH', 'QH', 'JH', 'TH', '9H', '8H', '7H', '6H', '5H', '4H', '3H', '3C'],
      ['AC', 'KC', 'QC', 'JC', 'TC', '9C', '8C', '7C', '6C', '5C', '4C', '2C', 'AD'],
      ['KD', 'QD', 'JD', 'TD', '9D', '8D', '7D', '6D', '5D', '4D', '3D', 'AS', 'KS'],
      ['BJ', 'LJ', 'QS', 'JS', 'TS', '9S', '8S', '7S', '6S', '5S', '4S', '3S', '2S'],
    ];
    let st = bidAll(rigged(joker, fixed, 3), [1, 2, 3, 7]);
    st = play(st, 'AH', '2C', 'AS', '2S'); // seat 2 trumps with A♠; seat 3's 2♠ is lower
    expect(st.tricks[0]!.winner).toBe(2);
    expect(st.spadesBroken).toBe(true);
    expect(st.turn).toBe(2);
    st = play(st, 'KS', '3S', '3H', 'AC'); // spade led: seat 3 must follow
    expect(st.tricks[1]!.winner).toBe(2);
    st = play(st, 'KD', 'LJ', 'KH', 'AD'); // seat 3 void in diamonds trumps with LJ
    expect(st.tricks[2]!.winner).toBe(3);
    // play out the rest with the first legal card each turn
    while (st.phase === 'playing') st = play(st, legalPlays(st, st.turn!)[0]!);
    expect(st.phase).toBe('handOver');
    expect(st.tricksWon.reduce((a, b) => a + b)).toBe(13);
    expect(st.history).toHaveLength(1);
    expect(st.history[0]!.sides.map((x) => x.totalScore)).toEqual(st.scores);
  });
  it('a hand of only spades may lead spades before broken', () => {
    expect(legalPlaysFor(joker, ['AS', 'BJ'], [], false)).toEqual(['AS', 'BJ']);
    expect(legalPlaysFor(joker, ['AS', '3H'], [], false)).toEqual(['3H']);
    expect(legalPlaysFor(joker, ['AS', '3H'], [], true)).toEqual(['AS', '3H']);
  });
  it('spades-broken can be turned off', () => {
    const r = makeRules('joker', { spadesMustBeBroken: false });
    expect(legalPlaysFor(r, ['AS', '3H'], [], false)).toEqual(['AS', '3H']);
  });
  it('leading a joker requires following with spades', () => {
    expect(legalPlaysFor(joker, ['AS', '3H', 'LJ'], [{ seat: 0, card: 'BJ' }], true)).toEqual(['AS', 'LJ']);
    expect(legalPlaysFor(joker, ['3H'], [{ seat: 0, card: 'BJ' }], true)).toEqual(['3H']);
  });
  it('promoted 2♦ follows spades, not diamonds', () => {
    const r = makeRules('joker', { trumpOrderTop: ['BJ', 'LJ', '2D'], removedCards: ['2H', '2C'] });
    expect(legalPlaysFor(r, ['2D', '5D'], [{ seat: 0, card: '3S' }], true)).toEqual(['2D']);
    expect(legalPlaysFor(r, ['2D', '5D'], [{ seat: 0, card: '9D' }], true)).toEqual(['5D']);
  });
  it('legalPlays is empty when not your turn or not playing', () => {
    const st = start();
    expect(legalPlays(st, 1)).toEqual([]);
    expect(legalPlays(rigged(joker, hands), 0)).toEqual([]);
  });
});

describe('trick resolution', () => {
  it('highest of the suit led wins without trumps', () => {
    expect(trickWinner([{ seat: 0, card: '9H' }, { seat: 1, card: 'KH' }, { seat: 2, card: 'AD' }, { seat: 3, card: 'QH' }], joker)).toBe(1);
  });
  it('any trump beats the suit led; highest trump wins', () => {
    expect(trickWinner([{ seat: 0, card: 'AH' }, { seat: 1, card: '2S' }, { seat: 2, card: 'KH' }, { seat: 3, card: 'AD' }], joker)).toBe(1);
    expect(trickWinner([{ seat: 0, card: 'AH' }, { seat: 1, card: '2S' }, { seat: 2, card: 'AS' }, { seat: 3, card: 'LJ' }], joker)).toBe(3);
    expect(trickWinner([{ seat: 0, card: 'LJ' }, { seat: 1, card: 'BJ' }, { seat: 2, card: 'AS' }], joker)).toBe(1);
  });
  it('deuce-high 2♠ beats A♠ but not jokers', () => {
    const r = makeRules('joker', { deuceOfSpadesHigh: true });
    expect(trickWinner([{ seat: 0, card: 'AS' }, { seat: 1, card: '2S' }], r)).toBe(1);
    expect(trickWinner([{ seat: 0, card: 'LJ' }, { seat: 1, card: '2S' }], r)).toBe(0);
  });
  it('Ace Down: A♠ is the top trump', () => {
    const r = makeRules('aceDown');
    expect(trickWinner([{ seat: 0, card: 'KS' }, { seat: 1, card: 'AS' }, { seat: 2, card: '2S' }], r)).toBe(1);
    expect(trickWinner([{ seat: 0, card: 'KD' }, { seat: 1, card: 'AD' }], r)).toBe(1);
  });
  it('off-suit discards never win', () => {
    expect(trickWinner([{ seat: 0, card: '2C' }, { seat: 1, card: 'AH' }, { seat: 2, card: 'AD' }], makeRules('aceDown'))).toBe(0);
  });
  it('empty trick throws', () => {
    expect(() => trickWinner([], joker)).toThrow();
  });
});

describe('first lead: two of clubs house rule', () => {
  it('holder of the 2♣ leads it, then normal play', () => {
    const r = makeRules('joker', { firstLead: 'twoOfClubs' });
    const hands = fill(r, [[], [], ['2C'], []]);
    let st = bidAll(rigged(r, hands, 3), [3, 3, 3, 3]);
    expect(st.turn).toBe(2);
    expect(legalPlays(st, 2)).toEqual(['2C']);
    expect(viewMustLeadTwoOfClubs(viewFor(st, 2))).toBe(true);
    const other = st.hands[2]!.find((c) => c !== '2C')!;
    expectRuleError(() => applyAction(st, { type: 'play', seat: 2, card: other }), 'MUST_LEAD_TWO_OF_CLUBS');
    st = play(st, '2C');
    expect(st.trick.plays).toHaveLength(1);
  });
});

describe('blind nil exchange', () => {
  it('nil bidder passes first, partner passes back, then play starts', () => {
    const r = makeRules('joker', { blindNil: { onlyWhenBehindBy: null, exchangeCards: 2 } });
    let st = newGame(r, 'ex');
    const first = st.turn!;
    st = applyAction(st, { type: 'bid', seat: first, bid: 'blindNil' });
    for (let i = 1; i < 4; i++) {
      const s = st.turn!;
      if (!st.revealed[s]) st = applyAction(st, { type: 'reveal', seat: s });
      st = applyAction(st, { type: 'bid', seat: s, bid: 3 });
    }
    expect(st.phase).toBe('exchange');
    expect(st.exchange).toEqual([{ from: first, to: (first + 2) % 4, count: 2 }, { from: (first + 2) % 4, to: first, count: 2 }]);
    expect(st.turn).toBe(first);
    expect(pendingTurn(st)).toEqual({ seat: first, kind: 'exchange' });
    const give = st.hands[first]!.slice(0, 2);
    expectRuleError(() => applyAction(st, { type: 'exchange', seat: (first + 2) % 4, cards: give }), 'NOT_YOUR_TURN');
    expectRuleError(() => applyAction(st, { type: 'exchange', seat: first, cards: give.slice(0, 1) }), 'BAD_EXCHANGE');
    expectRuleError(() => applyAction(st, { type: 'exchange', seat: first, cards: [give[0]!, give[0]!] }), 'BAD_EXCHANGE');
    expectRuleError(() => applyAction(st, { type: 'exchange', seat: first, cards: [give[0]!, st.hands[(first + 1) % 4]![0]!] }), 'BAD_EXCHANGE');
    st = applyAction(st, { type: 'exchange', seat: first, cards: give });
    expect(st.hands[first]).toHaveLength(11);
    expect(st.hands[(first + 2) % 4]).toHaveLength(15);
    const back = st.hands[(first + 2) % 4]!.slice(0, 2);
    st = applyAction(st, { type: 'exchange', seat: (first + 2) % 4, cards: back });
    expect(st.hands.map((h) => h.length)).toEqual([13, 13, 13, 13]);
    expect(st.phase).toBe('playing');
    expect(new Set(st.hands.flat()).size).toBe(52);
  });
  it('no exchange in cutthroat even if configured', () => {
    const r = makeRules('cutthroat', { blindNil: { onlyWhenBehindBy: null, exchangeCards: 2 } });
    let st = newGame(r, 'ct');
    for (let i = 0; i < 4; i++) st = applyAction(st, { type: 'bid', seat: st.turn!, bid: i === 0 ? 'blindNil' : 3 });
    expect(st.phase).toBe('playing');
  });
  it('both partners blind nil produce a single swap', () => {
    const r = makeRules('joker', { blindNil: { onlyWhenBehindBy: null, exchangeCards: 1 } });
    let st = newGame(r, 'ex2');
    const a = st.turn!;
    st = applyAction(st, { type: 'bid', seat: a, bid: 'blindNil' });
    st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 'blindNil' });
    st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 'blindNil' });
    st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 'blindNil' });
    expect(st.exchange).toHaveLength(4);
  });
});

describe('views (no peeking)', () => {
  it('a view contains only your own hand and public info', () => {
    const st = newGame(joker, 'view');
    const v = viewFor(st, 1);
    expect(v.hand).toEqual(st.hands[1]);
    expect(JSON.stringify(v)).not.toContain(JSON.stringify(st.hands[0]));
    expect(v.handCounts).toEqual([13, 13, 13, 13]);
    expect(v.bidOptions === null).toBe(st.turn !== 1);
    expect(v.legal).toEqual([]);
    expect(pendingTurn({ ...st, turn: null })).toBeNull();
    expect(pendingTurn({ ...st, phase: 'handOver' })).toBeNull();
  });
});
