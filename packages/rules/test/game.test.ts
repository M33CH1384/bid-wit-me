import { describe, expect, it } from 'vitest';
import {
  CLASSIC_JOKER, type Card, type GameState, type TableRules, scoreHand, bidOrder, isFreshDeal, RuleError, applyAction, bidOptions, buildDeck, deckForHand, legalPlays, legalPlaysFor, effectiveSuit,
  makeRules, newGame as realNewGame, pendingTurn, trickWinner, viewFor, spectatorView, viewMustLeadTwoOfClubs, RulesConfigError, lowestLegal, radioactiveBigJoker, canRunIt, type Play, type Trick,
} from '../src';
import { bidAll, fill, play, rigged } from './helpers';

const joker = makeRules('joker');

/** Most tests here exercise bidding, so they start with a normal (bid) first hand; the books first hand is tested below. */
const newGame = (r: TableRules, seed: string) => realNewGame({ ...r, firstHandBidsItself: false, shotOut: false }, seed);

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
  it('clears spades broken when the next hand is dealt', () => {
    // QA: hand 2's bid screen showed BROKEN before anyone played a card.
    // dealHand resets the flag; finishHand leaves the closed hand's value in place until then.
    const hands = fill(joker, [['3H'], ['2D'], [], []]);
    let st = bidAll(rigged(joker, hands, 3), [3, 3, 3, 3]);
    expect(st.spadesBroken).toBe(false);
    // Seat 1 is void in hearts so the 2♦ can trump in and break spades.
    st = { ...st, hands: st.hands.map((h, i) => (i === 1 ? h.filter((c) => c === '2D' || effectiveSuit(c, joker) !== 'H') : h)) };
    st = play(st, '3H', '2D');
    expect(st.spadesBroken).toBe(true);
    st = { ...st, phase: 'handOver', turn: null };
    expect(viewFor(st, 0).spadesBroken).toBe(true);
    st = applyAction(st, { type: 'nextHand' });
    expect(st.phase).toBe('bidding');
    expect(st.handNo).toBe(2);
    expect(st.spadesBroken).toBe(false);
    expect(st.tricks).toEqual([]);
    expect(st.trick.plays).toEqual([]);
    expect(viewFor(st, 0).spadesBroken).toBe(false);
    expect(spectatorView(st, 0).spadesBroken).toBe(false);
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
  it('missing nil and blind nil do not throw while bidding or dealing the next hand', () => {
    // Older saved games omit these objects. bidOptions used to throw reading `.allowed`,
    // which aborted the room tick before a spectator (or the seat to act) got a view.
    const hole = (st: GameState) => {
      delete (st.rules as { nil?: unknown }).nil;
      delete (st.rules as { blindNil?: unknown }).blindNil;
      return st;
    };
    let st = hole(newGame(joker, 'nil-hole'));
    expect(st.phase).toBe('bidding');
    const opt = bidOptions(st, st.turn!);
    expect(opt.min).toBeGreaterThanOrEqual(1);
    expect(opt.nil).toBe(true);
    expect(typeof opt.blindNil).toBe('boolean');
    const watched = spectatorView(st, 0);
    expect(watched.bidOptions).toBeNull();
    expect(watched.hand).toBeNull();
    expect(watched.rules.nil).toEqual({ allowed: true, value: 100 });
    expect(watched.rules.blindNil.allowed).toBe(true);
    st = applyAction(st, { type: 'bid', seat: st.turn!, bid: opt.min });
    expect(st.rules.nil).toEqual({ allowed: true, value: 100 });
    expect(st.bids.some((b) => b !== null)).toBe(true);
    st = hole({ ...st, phase: 'handOver', turn: null });
    expect(() => applyAction(st, { type: 'nextHand' })).not.toThrow();
    const cut = hole(rigged(makeRules('cutthroat'), fill(makeRules('cutthroat'), [[], [], [], []])));
    expect(bidOptions(cut, 0)).toMatchObject({ nil: false, blindNil: false });
    expect(spectatorView(cut, 0).rules.nil.allowed).toBe(false);
  });
  it('nil can be disabled', () => {
    const r = makeRules('joker', { nil: { allowed: false } });
    const st = rigged(r, fill(r, [[], [], [], []]));
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 0, bid: 'nil' }), 'NIL_NOT_ALLOWED');
  });
  it('partner of a nil bidder may also bid nil by default, but not when disabled', () => {
    // Floor off, so this is the partnerMayAlsoNil rule and not the host minimum.
    // dealer 3: bidding order 0, 2 (partners back to back), 1, 3 (dealer last)
    const open = makeRules('joker', { firstHandMin: null, minTeamBid: 0 });
    const st = applyAction(rigged(open, fill(open, [[], [], [], []]), 3), { type: 'bid', seat: 0, bid: 'nil' });
    expect(st.turn).toBe(2);
    expect(bidOptions(st, 2).nil).toBe(true);
    const r = makeRules('joker', { firstHandMin: null, minTeamBid: 0, partnerMayAlsoNil: false });
    const s2 = applyAction(rigged(r, fill(r, [[], [], [], []]), 3), { type: 'bid', seat: 0, bid: 'nil' });
    expect(bidOptions(s2, 2).nil).toBe(false);
    expectRuleError(() => applyAction(s2, { type: 'bid', seat: 2, bid: 'nil' }), 'NIL_NOT_ALLOWED');
  });
  it('minimum team bid applies to the second partner', () => {
    const r = makeRules('joker', { minTeamBid: 4 });
    let st = rigged(r, fill(r, [[], [], [], []]));
    expect(bidOptions(st, 0).min).toBe(1); // partner still to bid
    st = applyAction(st, { type: 'bid', seat: 0, bid: 1 });
    expect(bidOptions(st, 2).min).toBe(3);
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 2, bid: 2 }), 'BID_TOO_LOW');
    expect(bidOptions(st, 2).nilReason).toMatch(/Can't Nil/);
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 2, bid: 'nil' }), 'NIL_NOT_ALLOWED');
    st = applyAction(st, { type: 'bid', seat: 2, bid: 3 });
    expect(st.turn).toBe(1);
    expect(bidOptions(st, 1).min).toBe(1); // the dealer still to bid
    st = applyAction(st, { type: 'bid', seat: 1, bid: 2 });
    expect(st.turn).toBe(3);
    expect(bidOptions(st, 3).min).toBe(2);
  });
  it('minimum bid applies alone when the partner bid nil, and individually in cutthroat', () => {
    const r = makeRules('joker', { minTeamBid: 4 });
    const st = applyAction(rigged(r, fill(r, [[], [], [], []])), { type: 'bid', seat: 0, bid: 'nil' });
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
    st = applyAction(st, { type: 'nextHand' }); // dealer 3: order 0, 2, 1, 3
    expect(st.turn).toBe(0);
    st = applyAction(st, { type: 'bid', seat: 0, bid: 'blindNil' });
    expect(st.bids[0]).toBe('blindNil');
    expect(st.revealed[0]).toBe(true);
    expect(st.turn).toBe(2);
    // seat 2 looks at cards first, then can no longer blind nil
    st = applyAction(st, { type: 'reveal', seat: 2 });
    expect(bidOptions(st, 2).blindNil).toBe(false);
    expectRuleError(() => applyAction(st, { type: 'bid', seat: 2, bid: 'blindNil' }), 'BLIND_NIL_NOT_ALLOWED');
    expectRuleError(() => applyAction(st, { type: 'reveal', seat: 2 }), 'ALREADY_REVEALED');
    expectRuleError(() => applyAction(st, { type: 'reveal', seat: 0 }), 'WRONG_PHASE');
    st = applyAction(st, { type: 'bid', seat: 2, bid: 4 });
    st = applyAction(st, { type: 'bid', seat: 1, bid: 3 });
    st = applyAction(st, { type: 'bid', seat: 3, bid: 4 });
    expect(st.phase).toBe('playing');
    expect(st.trick.leader).toBe(0); // play still starts left of the dealer
    expectRuleError(() => applyAction(st, { type: 'reveal', seat: 1 }), 'WRONG_PHASE');
  });
  it('blind nil always allowed when onlyWhenBehindBy is null; disabled when not allowed', () => {
    const r = makeRules('joker', { blindNil: { onlyWhenBehindBy: null } });
    expect(newGame(r, 'x').revealed.every((x) => !x)).toBe(true);
    const off = makeRules('joker', { blindNil: { allowed: false, onlyWhenBehindBy: null } });
    expect(newGame(off, 'x').revealed.every(Boolean)).toBe(true);
  });
  it('Cutthroat never offers Blind Nil, even far behind and even if the override says on', () => {
    const r = makeRules('cutthroat', { blindNil: { allowed: true, onlyWhenBehindBy: 100 } });
    expect(r.blindNil.allowed).toBe(false);
    let st: GameState = { ...newGame(r, 'ct'), scores: [120, 10, 30, 0], phase: 'handOver', turn: null };
    st = applyAction(st, { type: 'nextHand' });
    expect(st.revealed).toEqual([true, true, true, true]);
    expect(bidOptions(st, st.turn!).blindNil).toBe(false);
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
    expectRuleError(() => applyAction(st, { type: 'play', seat: 0, card: '3H' }), 'ALREADY_PLAYED');
    st = play(st, 'KH');
    // seat 2 has no hearts → any card
    expect(legalPlays(st, 2)).toHaveLength(13);
    st = play(st, '5C');
    expectRuleError(() => applyAction(st, { type: 'play', seat: 3, card: 'XX' as Card }), 'CARD_NOT_IN_HAND');
  });

  it('rejects a second card from a seat that already played in this trick', () => {
    const st = play(start(), 'AH');
    expect(st.trick.plays).toEqual([{ seat: 0, card: 'AH' }]);
    // Turn has moved, and the turn pointer is also forced back: either way the other card stays in hand.
    expectRuleError(() => applyAction(st, { type: 'play', seat: 0, card: '3H' }), 'ALREADY_PLAYED');
    expectRuleError(() => applyAction({ ...st, turn: 0 }, { type: 'play', seat: 0, card: '3H' }), 'ALREADY_PLAYED');
    expect(st.trick.plays).toHaveLength(1);
    expect(st.hands[0]).toContain('3H');
    expect(st.hands[0]).not.toContain('AH');
  });

  it('treats a repeat of the card already in the trick as the same play', () => {
    const st = play(start(), 'AH');
    const again = applyAction(st, { type: 'play', seat: 0, card: 'AH' });
    expect(again).toBe(st);
    expect(again.trick.plays).toEqual([{ seat: 0, card: 'AH' }]);
    const forced = applyAction({ ...st, turn: 0 }, { type: 'play', seat: 0, card: 'AH' });
    expect(forced.trick.plays).toEqual([{ seat: 0, card: 'AH' }]);
    expect(forced.hands[0]).not.toContain('AH');
  });

  it('rejects a play when it is not that seat\'s turn', () => {
    const st = start();
    expect(st.turn).toBe(0);
    expectRuleError(() => applyAction(st, { type: 'play', seat: 1, card: 'KH' }), 'NOT_YOUR_TURN');
    expectRuleError(() => applyAction(st, { type: 'play', seat: 2, card: '5C' }), 'NOT_YOUR_TURN');
    expect(st.trick.plays).toEqual([]);
    expect(st.hands[1]).toContain('KH');
    expect(st.hands[2]).toContain('5C');
  });
  it('trumping in breaks spades; highest trump wins; the winner leads next', () => {
    const fixed: Card[][] = [
      ['AH', 'KH', 'QH', 'JH', 'TH', '9H', '8H', '7H', '6H', '5H', '4H', '3H', '3C'],
      ['AC', 'KC', 'QC', 'JC', 'TC', '9C', '8C', '7C', '6C', '5C', '4C', '2C', 'AD'],
      ['KD', 'QD', 'JD', 'TD', '9D', '8D', '7D', '6D', '5D', '4D', '3D', 'AS', 'KS'],
      ['BJ', 'LJ', 'QS', 'JS', 'TS', '9S', '8S', '7S', '6S', '5S', '4S', '3S', '2S'],
    ];
    const classic = makeRules('joker', { ...CLASSIC_JOKER, shotOut: false });
    let st = bidAll(rigged(classic, fixed, 3), [1, 2, 3, 7]);
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
  it('a void in the led suit, and a lead after spades are broken, plays the whole hand', () => {
    const hand = ['AS', 'KH', 'QC', 'JS', '9H', '7C'] as Card[];
    // Diamonds are led and this seat holds none, so every card is legal. Same when it leads.
    expect(legalPlaysFor(joker, hand, [{ seat: 1, card: 'KD' }], true)).toEqual(hand);
    expect(legalPlaysFor(joker, hand, [], true)).toEqual(hand);
    // 2♦ is trump, so it does not count as a diamond. The rest of the hand is still playable.
    expect(legalPlaysFor(joker, ['2D', 'AS', 'KH', 'QC'], [{ seat: 1, card: 'AD' }], true)).toEqual(['2D', 'AS', 'KH', 'QC']);
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

describe('Joker house order: 2♦ is a trump between Little Joker and 2♠', () => {
  it('2♦ follows spades, cannot be led before spades are broken, and is not a diamond', () => {
    expect(legalPlaysFor(joker, ['2D', '5D'], [{ seat: 0, card: '3S' }], true)).toEqual(['2D']);
    expect(legalPlaysFor(joker, ['2D', '5D'], [{ seat: 0, card: '9D' }], true)).toEqual(['5D']);
    expect(legalPlaysFor(joker, ['2D', '5D'], [], false)).toEqual(['5D']);
    expect(legalPlaysFor(joker, ['2D'], [{ seat: 0, card: 'KD' }], true)).toEqual(['2D']);
  });
  it('ranks: BJ > LJ > 2♦ > 2♠ > A♠', () => {
    const t = (cards: Card[]) => trickWinner(cards.map((card, seat) => ({ seat, card })), joker);
    expect(t(['AS', '2S', '2D', '3S'])).toBe(2);
    expect(t(['2D', 'LJ', '2S', 'AS'])).toBe(1);
    expect(t(['LJ', '2D', 'BJ', '2S'])).toBe(2);
    expect(t(['AS', '2S', 'KS', 'QS'])).toBe(1);
    expect(t(['KD', '2D', 'AD', '3D'])).toBe(1); // trumping a diamond lead with the 2♦
    expect(t(['3D', '4D', 'AH', 'KD'])).toBe(3);
  });
  it('playing the 2♦ breaks spades', () => {
    const hands = fill(joker, [['3H'], ['2D'], [], []]);
    let st = bidAll(rigged(joker, hands, 3), [3, 3, 3, 3]);
    st = { ...st, hands: st.hands.map((h, i) => (i === 1 ? h.filter((c) => c === '2D' || effectiveSuit(c, joker) !== 'H') : h)) };
    st = play(st, '3H', '2D');
    expect(st.spadesBroken).toBe(true);
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
    // Note: 2C is removed from all Joker decks (Demetrius 2026-10-19), so this rule only applies to standard52
    const r = makeRules('aceDown', { firstLead: 'twoOfClubs' });
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
      st = applyAction(st, { type: 'bid', seat: s, bid: 4 }); // covers a Nil partner under the default minimum of 4
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
    const r = makeRules('cutthroat', { blindNil: { allowed: true, onlyWhenBehindBy: null, exchangeCards: 2 } });
    let st = newGame(r, 'ct');
    expect(st.rules.nil.allowed).toBe(false);
    expect(st.rules.blindNil.allowed).toBe(false);
    for (let i = 0; i < 4; i++) st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 3 });
    expect(st.phase).toBe('playing');
    expect(st.exchange).toEqual([]);
  });
  it('both partners blind nil produce a single swap', () => {
    // Minimum off: with a floor, the partner of a Nil cannot also Nil.
    const r = makeRules('joker', { firstHandMin: null, minTeamBid: 0, blindNil: { onlyWhenBehindBy: null, exchangeCards: 1 } });
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

describe('first hand: books bid themselves', () => {
  it('is on by default for every mode', () => {
    for (const m of ['joker', 'cutthroat', 'aceDown'] as const) expect(makeRules(m).firstHandBidsItself).toBe(true);
  });
  it('hand 1 starts straight in play with everyone on "books"; nobody may bid', () => {
    const st = realNewGame(joker, 'books');
    expect(st.phase).toBe('playing');
    expect(st.bids).toEqual(['books', 'books', 'books', 'books']);
    expect(st.turn).toBe((st.dealer + 1) % 4);
    expect(st.revealed.every(Boolean)).toBe(true);
    expect(isFreshDeal(st)).toBe(true);
    expect(viewFor(st, 0).bidOptions).toBeNull();
    expectRuleError(() => applyAction(st, { type: 'bid', seat: st.turn!, bid: 3 }), 'WRONG_PHASE');
  });
  it('a player can never choose the books bid', () => {
    const st = newGame(joker, 'b2');
    expectRuleError(() => applyAction(st, { type: 'bid', seat: st.turn!, bid: 'books' }), 'BAD_BID');
  });
  it('scores 10 per book, no bags, no penalties, even with bags already at the edge', () => {
    const sides = scoreHand(joker, ['books', 'books', 'books', 'books'], [4, 2, 5, 2], [0, 0], [9, 9]);
    expect(sides.map((x) => x.points)).toEqual([90, 40]);
    expect(sides.map((x) => x.bookPoints)).toEqual([90, 40]);
    expect(sides.map((x) => x.bagsAdded)).toEqual([0, 0]);
    expect(sides.map((x) => x.bagPenaltyPoints)).toEqual([0, 0]);
    expect(sides.map((x) => x.totalBags)).toEqual([9, 9]);
    expect(sides.map((x) => x.contractMade)).toEqual([null, null]);
  });
  it('cutthroat 3: each player scores their own books', () => {
    const r = makeRules('cutthroat', { playerCount: 3 });
    const sides = scoreHand(r, ['books', 'books', 'books'], [7, 6, 4], [0, 0, 0], [0, 0, 0]);
    expect(sides.map((x) => x.points)).toEqual([70, 60, 40]);
  });
  it('only hand 1: hand 2 is bid as usual', () => {
    let st: GameState = { ...realNewGame(joker, 'h2'), phase: 'handOver', turn: null };
    st = applyAction(st, { type: 'nextHand' });
    expect(st.phase).toBe('bidding');
    expect(st.bids.every((b) => b === null)).toBe(true);
  });
  it('the host can switch it off', () => {
    const st = realNewGame(makeRules('aceDown', { firstHandBidsItself: false }), 'off');
    expect(st.phase).toBe('bidding');
  });
});

describe('last-trick nuke auto-finish (Joker Spades)', () => {
  // a hand on its final trick: every seat holds one card; seat 0 leads
  const lastTrick = (cards: Card[]): GameState => {
    const st = rigged(joker, cards.map((c) => [c]));
    const filler: Trick = { leader: 0, plays: [], winner: 0 };
    return { ...st, phase: 'playing', bids: [3, 3, 3, 3], tricks: Array(12).fill(filler), tricksWon: [3, 3, 3, 3], turn: 0, trick: { leader: 0, plays: [], winner: null }, spadesBroken: true };
  };
  it('Big Joker leads, Little Joker lands: the rest auto-play their last card and the Big Joker wins', () => {
    const after = play(lastTrick(['BJ', 'LJ', '4H', '5C']), 'BJ', 'LJ');
    const t = after.tricks[after.tricks.length - 1]!;
    expect(t.plays).toEqual([{ seat: 0, card: 'BJ' }, { seat: 1, card: 'LJ' }, { seat: 2, card: '4H', auto: true }, { seat: 3, card: '5C', auto: true }]);
    expect(t.winner).toBe(0);
    expect(after.hands.every((h) => h.length === 0)).toBe(true);
    expect(after.phase === 'handOver' || after.phase === 'gameOver').toBe(true);
    expect(after.history[after.history.length - 1]!.tricksWon).toEqual([4, 3, 3, 3]);
  });
  it('Little Joker first, Big Joker over it: same auto-finish, the Big Joker wins (and counts the nuke)', () => {
    const after = play(lastTrick(['LJ', 'BJ', '7S', '9D']), 'LJ', 'BJ');
    const t = after.tricks[after.tricks.length - 1]!;
    expect(t.plays.slice(2)).toEqual([{ seat: 2, card: '7S', auto: true }, { seat: 3, card: '9D', auto: true }]);
    expect(t.winner).toBe(1);
    expect(after.nukes).toEqual([0, 1]);
  });
  it('Jokers meeting as the last two cards: nothing left to auto-play', () => {
    let st = play(lastTrick(['4H', '5H', 'BJ', 'LJ']), '4H', '5H', 'BJ', 'LJ');
    const t = st.tricks[st.tricks.length - 1]!;
    expect(t.plays.some((p) => p.auto)).toBe(false);
    expect(t.winner).toBe(2);
  });
  it('radioactive Big Joker: only on the last trick, Big Joker down, Little Joker not seen yet this hand', () => {
    const st = lastTrick(['BJ', '3H', '4H', 'LJ']);
    expect(radioactiveBigJoker(st)).toBe(false);                 // nothing played yet
    const bj = play(st, 'BJ');
    expect(radioactiveBigJoker(bj)).toBe(true);
    expect(radioactiveBigJoker(play(bj, '3H', '4H'))).toBe(true); // still waiting on the last seat
    const early = { ...bj, tricks: bj.tricks.slice(1) };           // not the last trick
    expect(radioactiveBigJoker(early)).toBe(false);
    const seen = { ...bj, tricks: [...bj.tricks.slice(1), { leader: 0, plays: [{ seat: 3, card: 'LJ' as Card }], winner: 3 }] };
    expect(radioactiveBigJoker(seen)).toBe(false);               // Little Joker already played earlier this hand
  });
  it('earlier tricks play out normally: no auto-play when both Jokers meet before the last trick', () => {
    const hands = fill(joker, [['BJ', '3H'], ['LJ', '4H'], ['5H'], ['6H']]);
    let st = bidAll(rigged(joker, hands, 3), [3, 3, 3, 3]);
    st = { ...st, spadesBroken: true };
    st = play(st, 'BJ', 'LJ');
    expect(st.trick.plays).toHaveLength(2);
    expect(st.turn).toBe(2);
  });
  it('lowestLegal: follows suit with its lowest card, else lowest non-trump, else lowest trump (never a renege)', () => {
    const led: Play[] = [{ seat: 0, card: 'BJ' }]; // a Joker lead counts as spades
    expect(lowestLegal(joker, ['9S', '4S', '3H'], led, true)).toBe('4S');
    expect(lowestLegal(joker, ['KD', '5C', 'QH'], led, true)).toBe('5C');
    expect(lowestLegal(joker, ['QH', '9H'], [{ seat: 0, card: 'AH' }], true)).toBe('9H');
    expect(lowestLegal(joker, ['AS', 'LJ', '2D'], [{ seat: 0, card: 'AH' }], true)).toBe('AS');
    for (const hand of [['9S', '4S', '3H'], ['KD', '5C'], ['3S']] as Card[][]) expect(legalPlaysFor(joker, hand, led, true)).toContain(lowestLegal(joker, hand, led, true));
  });
});

describe("'Run it!' guarantee solver", () => {
  // seat 0 on lead with `cards[0]`, the others holding cards[1..3]; earlier tricks are filler
  const late = (cards: Card[][], broken = true): GameState => {
    const st = rigged(joker, cards);
    const filler: Trick = { leader: 0, plays: [], winner: 1 };
    const left = cards[0]!.length;
    return { ...st, phase: 'playing', bids: [3, 3, 3, 3], tricks: Array(13 - left).fill(filler), tricksWon: [3, 3, 3, 13 - left - 9], turn: 0, trick: { leader: 0, plays: [], winner: null }, spadesBroken: broken };
  };
  it('both Jokers: guaranteed, and running it credits every book (marked as a run)', () => {
    const st = late([['BJ', 'LJ'], ['3H', '4H'], ['5C', '6C'], ['3S', '7D']]);
    expect(canRunIt(st, 0)).toBe(true);
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    expect(after.phase === 'handOver' || after.phase === 'gameOver').toBe(true);
    expect(after.history[after.history.length - 1]!.tricksWon[0]).toBe(5);
    expect(after.tricks.slice(-2).every((t) => t.winner === 0 && t.plays.every((p) => p.run))).toBe(true);
    expect(viewFor(st, 0).canRunIt).toBe(true);
    expect(viewFor(st, 1).canRunIt).toBe(false);
    // the cleared hands are not on any view until the claim resolves, then every seat and a spectator gets them
    expect(viewFor(st, 0).runHands).toBeUndefined();
    expect(viewFor(st, 1).runHands).toBeUndefined();
    expect(spectatorView(st).runHands).toBeUndefined();
    const sorted = (hands: readonly (readonly (Card | { card: Card })[])[]) => hands.map((h) => h.map((c) => (typeof c === 'string' ? c : c.card)).sort());
    expect(sorted(viewFor(after, 3).runHands!)).toEqual(sorted(st.hands));
    expect(sorted(spectatorView(after).runHands!)).toEqual(sorted(st.hands));
    expect(viewFor(after, 0).runHands!.every((h) => h.every((c) => !c.played))).toBe(true);
    expect(viewFor(after, 2).hand).toEqual([]);
  });
  it('a seemingly strong hand (A♥ K♥ A♦) loses to a cut: not guaranteed, and the claim is refused', () => {
    const st = late([['AH', 'KH', 'AD'], ['3H', '4H', '5H'], ['6H', '7D', '8D'], ['4S', '7C', '8C']]);
    expect(canRunIt(st, 0)).toBe(false);
    expectRuleError(() => applyAction(st, { type: 'runIt', seat: 0 }), 'CANNOT_RUN_IT');
  });
  it('even the partner can spoil it (the claimer must take every trick itself)', () => {
    expect(canRunIt(late([['AH', 'KH'], ['3H', '4H'], ['5S', '6C'], ['5H', '6H']]), 0)).toBe(false);
  });
  it('breaking spades decides it: A♠ A♥ runs only once spades are broken', () => {
    const cards: Card[][] = [['AS', 'AH'], ['5S', '9C'], ['3H', '4C'], ['4H', '5C']];
    expect(canRunIt(late(cards, true), 0)).toBe(true);   // A♠ first draws the 5♠, then A♥ is safe
    expect(canRunIt(late(cards, false), 0)).toBe(false); // must lead A♥ first → cut by the 5♠
  });
  it('Joker trump order: a lone K♠ is not safe while the 2♦ is still out', () => {
    expect(canRunIt(late([['KS', 'QS'], ['2D', '3H'], ['4H', '5H'], ['6H', '7H']]), 0)).toBe(false);
    expect(canRunIt(late([['2D', 'KS'], ['QS', '3H'], ['4H', '5H'], ['6H', '7H']]), 0)).toBe(true);
  });
  it('only on lead, with 2..4 cards left', () => {
    expect(canRunIt(late([['BJ'], ['3H'], ['4H'], ['5H']]), 0)).toBe(false); // 1 card: just play it
    const five = late([['BJ', 'LJ', '2D', '2S', 'AS'], ['3H', '4H', '5H', '6H', '7H'], ['3C', '4C', '5C', '6C', '7C'], ['3D', '4D', '5D', '6D', '7D']]);
    expect(canRunIt(five, 0)).toBe(false);
    expect(canRunIt(late([['BJ', 'LJ'], ['3H', '4H'], ['5C', '6C'], ['3S', '7D']]), 1)).toBe(false);
  });
});

describe('bidding order', () => {
  it('team games: the non-dealing team bids first (back to back), then the dealer\'s partner, dealer last; play still starts left of the dealer', () => {
    for (const mode of ['joker', 'aceDown'] as const) {
      const r = makeRules(mode);
      for (let d = 0; d < 4; d++) {
        const L = (d + 1) % 4, P = (d + 2) % 4, R = (d + 3) % 4;
        expect(bidOrder(r, d)).toEqual([L, R, P, d]);
        let st = rigged(r, fill(r, [[], [], [], []]), d);
        const seen: number[] = [];
        while (st.phase === 'bidding') { seen.push(st.turn!); expectRuleError(() => applyAction(st, { type: 'bid', seat: (st.turn! + 1) % 4, bid: 3 }), 'NOT_YOUR_TURN'); st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 3 }); }
        expect(seen).toEqual([L, R, P, d]);
        expect(st.turn).toBe(L);
        expect(st.trick.leader).toBe(L);
      }
    }
  });
  it('the dealer rotates clockwise and every new hand starts bidding left of the new dealer', () => {
    let st = newGame(makeRules('joker', { firstHandBidsItself: false }), 'order');
    for (let h = 0; h < 4; h++) {
      const d = st.dealer;
      expect(st.turn).toBe((d + 1) % 4);
      expect(bidOrder(st.rules, d)).toEqual([(d + 1) % 4, (d + 3) % 4, (d + 2) % 4, d]);
      st = { ...st, phase: 'handOver', turn: null };
      st = applyAction(st, { type: 'nextHand' });
      expect(st.dealer).toBe((d + 1) % 4);
    }
  });
  it('cutthroat stays clockwise from the dealer\'s left', () => {
    for (const n of [3, 4] as const) {
      const r = makeRules('cutthroat', { playerCount: n });
      for (let d = 0; d < n; d++) expect(bidOrder(r, d)).toEqual(Array.from({ length: n }, (_, k) => (d + 1 + k) % n));
    }
  });
});

describe("'Run it!' in Cutthroat + mid-trick (Release 10)", () => {
  const cut4 = makeRules('cutthroat', { playerCount: 4 });
  const cut3 = makeRules('cutthroat', { playerCount: 3 });
  /** seat `me` to act; `table` = plays already in the current trick (led by `leader`); `gone` = earlier tricks (cards out) */
  const spot = (rules: TableRules, hands: Card[][], leader: number, table: Card[], gone: Card[] = []): GameState => {
    const n = rules.playerCount;
    const st = rigged(rules, hands);
    const size = n === 4 ? 13 : 17;
    const left = hands[leader]!.length + (table.length ? 1 : 0);
    const filler: Trick[] = Array.from({ length: size - left }, (_, i) => ({ leader: 0, plays: i === 0 ? gone.map((c, k) => ({ seat: k % n, card: c })) : [], winner: 1 }));
    const plays = table.map((card, k) => ({ seat: (leader + k) % n, card }));
    return { ...st, phase: 'playing', bids: Array(n).fill(2), tricks: filler, tricksWon: Array(n).fill(0), turn: (leader + table.length) % n, trick: { leader, plays, winner: null }, spadesBroken: true };
  };

  it('4-player Cutthroat (Joker deck), on lead with both Jokers: offered, and the run credits every book', () => {
    const st = spot(cut4, [['BJ', 'LJ'], ['3H', '4H'], ['5C', '6C'], ['3S', '7D']], 0, []);
    expect(canRunIt(st, 0)).toBe(true);
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    expect(after.tricks.slice(-2).every((t) => t.winner === 0)).toBe(true);
  });
  it('3-player Cutthroat (Joker deck): offered on lead with 3 sure winners', () => {
    const st = spot(cut3, [['BJ', 'LJ', '2S'], ['3H', '4H', '5H'], ['5C', '6C', '7C']], 0, []);
    expect(canRunIt(st, 0)).toBe(true);
  });
  it("Demetrius's spot: following with Little Joker + 2♦ (the trump right under it) after 10♠ / J♦, Big Joker gone: offered mid-trick", () => {
    // seats 2, 3 led 10♠, J♦; seat 0 (me) holds LJ + 2♦; the Big Joker was played earlier; seat 1 still holds a diamond
    const st = spot(cut4, [['LJ', '2D'], ['9D', '4C'], ['5C'], ['3C']], 2, ['TS', 'JD'], ['BJ']);
    expect(st.turn).toBe(0);
    expect(canRunIt(st, 0)).toBe(true);
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    expect(after.tricks.slice(-2).map((t) => t.winner)).toEqual([0, 0]);
  });
  it('the same spot when the 2♦ is safe (nobody can follow or cut): offered mid-trick, Little Joker boss once the Big Joker is gone', () => {
    const st = spot(cut4, [['LJ', '2D'], ['4C', '5C'], ['6C'], ['7C']], 2, ['TS', 'JD'], ['BJ']);
    expect(canRunIt(st, 0)).toBe(true);
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    expect(after.tricks.slice(-2).map((t) => t.winner)).toEqual([0, 0]);
  });
  it('mid-trick: not offered while the Big Joker is still out (the Little Joker can lose)', () => {
    const st = spot(cut4, [['LJ', '2D'], ['BJ', '5C'], ['6C'], ['7C']], 2, ['TS', 'JD']);
    expect(canRunIt(st, 0)).toBe(false);
  });
  // Release 10 (steering 2): any time the claimer's cards can't be beaten — even off-turn
  it('off-turn (4p Cutthroat): claimable before the claimer has to play; others play first, every book is the claimer\'s', () => {
    const st = spot(cut4, [['BJ', 'LJ'], ['3H', '4H'], ['5C', '6C'], ['3S', '7D']], 1, []);
    expect(st.turn).toBe(1);
    expect(canRunIt(st, 0)).toBe(true);
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    expect(after.tricks.slice(-2).map((t) => t.winner)).toEqual([0, 0]);
    expect(after.tricksWon[0]).toBe(2);
  });
  it('off-turn mid-trick (3p): the claimer already played the boss card, the trick is still open', () => {
    const st = spot(cut3, [['LJ', '2S'], ['3H', '4H', '5H'], ['5C', '6C', '7C']], 0, ['BJ']);
    expect(st.turn).toBe(1);
    expect(canRunIt(st, 0)).toBe(true);
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    expect(after.tricks.slice(-3).map((t) => t.winner)).toEqual([0, 0, 0]);
    // the card already on the table isn't part of the run; everything after the claim is
    expect(after.tricks.at(-3)!.plays[0]!.run).toBeUndefined();
    expect(after.tricks.at(-3)!.plays.slice(1).every((p) => p.run)).toBe(true);
    // the recap still counts that card, marked played, so every seat shows the same hand
    const rows = viewFor(after, 1).runHands!;
    expect(rows.map((h) => h.length)).toEqual([3, 3, 3]);
    expect(rows[0]!.find((c) => c.card === 'BJ')).toEqual({ card: 'BJ', played: true });
    expect(rows[0]!.filter((c) => c.card !== 'BJ').every((c) => !c.played)).toBe(true);
    expect(spectatorView(after).runHands).toEqual(rows);
  });
  it('mid-trick claim (4p): cards already on the table stay in the recap, marked played, so the hands match', () => {
    // The reported Cutthroat recap was 3, 2, 2, 3: two seats had already played one card, and those cards were dropped.
    const hands: Card[][] = [['BJ', 'LJ', '2D'], ['5C', '6C'], ['7C', '8C'], ['9C', 'TC', 'JC']];
    const st = spot(cut4, hands, 1, ['3H', '4D']);
    expect(st.turn).toBe(3);
    expect(st.trick.plays.map((p) => p.card)).toEqual(['3H', '4D']);
    expect(canRunIt(st, 0)).toBe(true);
    expect(viewFor(st, 0).runHands).toBeUndefined();
    expect(viewFor(st, 2).canRunIt).toBe(false);
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    const runTrick = after.tricks[st.tricks.length]!;
    expect(runTrick.plays[0]!.run).toBeUndefined();
    expect(runTrick.plays[1]!.run).toBeUndefined();
    expect(runTrick.plays.slice(2).every((p) => p.run)).toBe(true);
    const rows = viewFor(after, 0).runHands!;
    expect(rows.map((h) => h.length)).toEqual([3, 3, 3, 3]);
    const played = rows.flatMap((h, seat) => h.filter((c) => c.played).map((c) => `${seat}:${c.card}`));
    expect(played).toEqual(['1:3H', '2:4D']);
    expect(rows[0]!.map((c) => c.card).sort()).toEqual(['2D', 'BJ', 'LJ']);
    expect(rows[0]!.every((c) => !c.played)).toBe(true);
    expect(spectatorView(after).runHands).toEqual(rows);
    // A card already down that the claimer cannot beat is not a claim, even with two cards on the table.
    const beaten = spot(cut4, [['AH', 'KH', 'QH'], ['4C', '5C'], ['6C', '7C'], ['8C', '9C', 'TC']], 1, ['AS', '3D']);
    expect(canRunIt(beaten, 0)).toBe(false);
    expect(() => applyAction(beaten, { type: 'runIt', seat: 0 })).toThrow(RuleError);
  });
  it('a card already on the table that beats the claimer: no claim, and the server-side apply rejects it', () => {
    const st = spot(cut4, [['LJ', '2S'], ['BJ', '4H'], ['5C', '6C'], ['3S', '7D']], 1, []);
    const onTable = spot(cut4, [['LJ', '2S'], ['4H'], ['5C', '6C'], ['3S', '7D']], 1, ['BJ']);
    expect(canRunIt(st, 0)).toBe(false);
    expect(canRunIt(onTable, 0)).toBe(false);
    expect(() => applyAction(onTable, { type: 'runIt', seat: 0 })).toThrow(/guaranteed/);
  });
  it('2v2 Joker, off-turn: the books go to the claimer\'s team', () => {
    const j = makeRules('joker');
    const st = spot(j, [['BJ', 'LJ'], ['3H', '4H'], ['5C', '6C'], ['3D', '7D']], 3, []);
    expect(canRunIt(st, 0)).toBe(true);
    const after = applyAction(st, { type: 'runIt', seat: 0 });
    expect(after.tricks.slice(-2).map((t) => t.winner)).toEqual([0, 0]);
    expect(after.tricksWon[0]! + after.tricksWon[2]!).toBe(2);
  });
  it('Ace Down, off-turn: offered with the top spades', () => {
    const a = makeRules('aceDown');
    const st = spot(a, [['AS', 'KS'], ['3H', '4H'], ['5C', '6C'], ['3D', '7D']], 2, []);
    expect(canRunIt(st, 0)).toBe(true);
    expect(applyAction(st, { type: 'runIt', seat: 0 }).tricks.slice(-2).every((t) => t.winner === 0)).toBe(true);
  });
  it('off-turn, a still-outstanding higher trump: not offered, and a forced claim is rejected', () => {
    const st = spot(cut4, [['LJ', '2D'], ['3H', '4H'], ['BJ', '6C'], ['3S', '7D']], 1, []);
    expect(canRunIt(st, 0)).toBe(false);
    expect(() => applyAction(st, { type: 'runIt', seat: 0 })).toThrow(RuleError);
  });
  it('1 card left: no claim (it just plays)', () => {
    const st = spot(cut4, [['BJ'], ['3H'], ['5C'], ['3S']], 0, []);
    expect(canRunIt(st, 0)).toBe(false);
  });
});
