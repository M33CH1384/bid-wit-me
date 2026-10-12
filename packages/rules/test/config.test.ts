import { describe, expect, it } from 'vitest';
import {
  CLASSIC_JOKER, RulesConfigError, acceptRules, bidOptions, buildDeck, cardPower, checkGameEnd, defaultRules, effectiveSuit, handSize, isTrump, makeRules, newGame, scoreHand, sortHand,
  trumpOrder, validateRules,
} from '../src';

describe('presets', () => {
  it('Joker 2v2 defaults (spec §3.2)', () => {
    const r = makeRules('joker');
    expect(r.partnerships).toBe(true);
    expect(r.playerCount).toBe(4);
    expect(r.removedCards).toEqual(['2C', '2H']);
    expect(r.trumpOrderTop).toEqual(['BJ', 'LJ', '2D', '2S']);
    expect(r.targetScore).toBe(500);
    expect(r.losingFloor).toBe(-200);
    expect(r.blindNil.onlyWhenBehindBy).toBe(100);
    const deck = buildDeck(r);
    expect(deck).toHaveLength(52);
    expect(deck).toContain('BJ');
    expect(deck).toContain('LJ');
    expect(deck).not.toContain('2H');
    expect(deck).not.toContain('2C');
    expect(deck).toContain('2D');
  });
  it('Cutthroat defaults: joker deck, target 300, 4p and 3p', () => {
    const r4 = makeRules('cutthroat');
    expect(r4.partnerships).toBe(false);
    expect(r4.targetScore).toBe(300);
    expect(buildDeck(r4)).toHaveLength(52);
    const r3 = makeRules('cutthroat', { playerCount: 3 });
    expect(r3.removedCards).toEqual(['2C', '2H', '3C']);
    expect(trumpOrder(r3).slice(0, 4)).toEqual(['BJ', 'LJ', '2D', '2S']);
    expect(buildDeck(r3)).toHaveLength(51);
    expect(handSize(r3)).toBe(17);
    const s3 = makeRules('cutthroat', { playerCount: 3, deck: 'standard52' });
    expect(s3.removedCards).toEqual(['2C']);
    expect(s3.trumpOrderTop).toEqual([]);
    expect(buildDeck(s3)).toHaveLength(51);
    expect(buildDeck(s3)).not.toContain('BJ');
  });
  it('Cutthroat deck choice: standard 52 (4p) has no jokers and A♠ on top', () => {
    const r = makeRules('cutthroat', { deck: 'standard52' });
    expect(r.removedCards).toEqual([]);
    expect(r.trumpOrderTop).toEqual([]);
    expect(buildDeck(r)).toHaveLength(52);
    expect(buildDeck(r)).not.toContain('BJ');
    expect(trumpOrder(r)).toEqual(['AS', 'KS', 'QS', 'JS', 'TS', '9S', '8S', '7S', '6S', '5S', '4S', '3S', '2S']);
    expect(effectiveSuit('2D', r)).toBe('D');
  });
  it('Cutthroat deck choice: Joker deck (default) uses the Joker house order', () => {
    for (const playerCount of [3, 4] as const) {
      const r = makeRules('cutthroat', { playerCount });
      expect(r.deck).toBe('joker54');
      expect(trumpOrder(r).slice(0, 5)).toEqual(['BJ', 'LJ', '2D', '2S', 'AS']);
      expect(buildDeck(r)).toHaveLength(playerCount === 4 ? 52 : 51);
    }
  });
  it('Ace Down: standard 52, no jokers, aces highest, deuce-high forced off', () => {
    const r = makeRules('aceDown', { deuceOfSpadesHigh: true });
    expect(r.deuceOfSpadesHigh).toBe(false);
    expect(r.partnerships).toBe(true);
    const deck = buildDeck(r);
    expect(deck).toHaveLength(52);
    expect(deck).not.toContain('BJ');
    expect(trumpOrder(r)[0]).toBe('AS');
    expect(trumpOrder(r)).toHaveLength(13);
    expect(cardPower('AH', r)).toBeGreaterThan(cardPower('KH', r));
    expect(cardPower('2S', r)).toBeGreaterThan(cardPower('AH', r));
  });
  it('Ace Down can run as cutthroat', () => {
    const r = makeRules('aceDown', { partnerships: false, playerCount: 3 });
    expect(r.removedCards).toEqual(['2C']);
    expect(buildDeck(r)).toHaveLength(51);
  });
  it('defaultRules(cutthroat, 3)', () => {
    expect(defaultRules('cutthroat', 3).removedCards).toHaveLength(3);
  });
});

describe('validation', () => {
  const bad = (fn: () => unknown) => {
    try { fn(); } catch (e) { expect(e).toBeInstanceOf(RulesConfigError); return (e as RulesConfigError).problems.join('|'); }
    throw new Error('expected RulesConfigError');
  };
  it('rejects wrong deck sizes', () => {
    expect(bad(() => makeRules('joker', { removedCards: ['2H'] }))).toMatch(/52 cards/);
    expect(bad(() => makeRules('cutthroat', { playerCount: 3, removedCards: ['2H', '2D'] }))).toMatch(/51 cards/);
  });
  it('rejects removing spades, jokers, duplicates, unknown cards', () => {
    expect(bad(() => makeRules('joker', { removedCards: ['2S', '2D'] }))).toMatch(/spades/);
    expect(bad(() => makeRules('joker', { removedCards: ['BJ', '2D'] }))).toMatch(/jokers/);
    expect(bad(() => makeRules('joker', { removedCards: ['2D', '2D'] }))).toMatch(/duplicate/);
    expect(bad(() => makeRules('joker', { removedCards: ['XX' as never, '2D'] }))).toMatch(/unknown/);
  });
  it('rejects bad mode/partnership combos', () => {
    expect(bad(() => makeRules('joker', { playerCount: 3 }))).toMatch(/partnerships require 4/);
    expect(bad(() => makeRules('cutthroat', { partnerships: true }))).toMatch(/no partnerships/);
    expect(bad(() => makeRules('joker', { deck: 'standard52' }))).toMatch(/joker54/);
    expect(bad(() => makeRules('aceDown', { deck: 'joker54' }))).toMatch(/standard 52/);
    expect(bad(() => makeRules('aceDown', { trumpOrderTop: ['2D'] }))).toMatch(/no extra trumps/);
  });
  it('rejects bad trump order configs', () => {
    expect(bad(() => makeRules('joker', { trumpOrderTop: ['BJ'] }))).toMatch(/BJ and LJ/);
    expect(bad(() => makeRules('joker', { trumpOrderTop: ['BJ', 'LJ', '2C'] }))).toMatch(/cannot also be removed/);
    expect(bad(() => makeRules('joker', { trumpOrderTop: ['BJ', 'BJ', 'LJ'] }))).toMatch(/duplicate/);
    expect(bad(() => makeRules('joker', { trumpOrderTop: ['BJ', 'LJ', 'QQ' as never] }))).toMatch(/unknown/);
    expect(bad(() => makeRules('cutthroat', { deck: 'standard52', trumpOrderTop: ['BJ'] }))).toMatch(/joker54 deck/);
  });
  it('rejects other out-of-range settings', () => {
    expect(bad(() => makeRules('cutthroat', { playerCount: 3, firstLead: 'twoOfClubs' }))).toMatch(/2♣/);
    expect(bad(() => makeRules('joker', { minTeamBid: 14 }))).toMatch(/minTeamBid/);
    expect(bad(() => makeRules('joker', { bagsPerPenalty: 0 }))).toMatch(/bagsPerPenalty/);
    expect(bad(() => makeRules('joker', { targetScore: 0 }))).toMatch(/targetScore/);
    expect(bad(() => makeRules('joker', { losingFloor: 10 }))).toMatch(/losingFloor/);
    expect(bad(() => makeRules('joker', { blindNil: { exchangeCards: 3 as never } }))).toMatch(/exchangeCards/);
    expect(validateRules({ ...makeRules('joker'), playerCount: 5 as never }).join()).toMatch(/3 or 4/);
  });
  it('accepts a losing floor of null and every common removal pair', () => {
    expect(makeRules('joker', { losingFloor: null }).losingFloor).toBeNull();
    for (const pair of [['2H', '2D'], ['2C', '2D'], ['2C', '2H']] as const) {
      expect(buildDeck(makeRules('joker', { removedCards: [...pair] }))).toHaveLength(52);
    }
  });
  it('type-checks fields that used to pass straight through', () => {
    const joker = makeRules('joker');
    const stringNil = { ...joker, nil: { allowed: true, value: '100' as never } };
    expect(validateRules(stringNil).join()).toMatch(/nil\.value/);
    // 0 + "100" concatenates, then the numeric top never matches the string score, so the game cannot end
    const broken = scoreHand(stringNil, ['nil', 4, 4, 4], [0, 5, 4, 4], [400, 0], [0, 0]);
    expect(typeof broken[0]!.totalScore).toBe('string');
    expect(checkGameEnd(stringNil, broken.map((s) => s.totalScore))).toBeNull();
    const missing = { ...joker };
    delete (missing as { nil?: unknown }).nil;
    expect(validateRules(missing).join()).toMatch(/nil/);
    expect(() => newGame(missing, 'seed')).toThrow(RulesConfigError);
  });
});

describe('acceptRules', () => {
  const bad = (input: unknown) => {
    try { acceptRules(input); } catch (e) { expect(e).toBeInstanceOf(RulesConfigError); return (e as RulesConfigError).problems.join('|'); }
    throw new Error('expected RulesConfigError');
  };
  it('round-trips presets and drops fields that are not house rules', () => {
    const samples = [
      makeRules('joker'),
      makeRules('aceDown'),
      makeRules('cutthroat'),
      makeRules('cutthroat', { playerCount: 3, deck: 'standard52' }),
      makeRules('joker', {
        ...CLASSIC_JOKER, deuceOfSpadesHigh: true, targetScore: 250, minTeamBid: 4, nil: { allowed: false },
        blindNil: { allowed: true, onlyWhenBehindBy: null, exchangeCards: 2, value: 150 }, bagsPerPenalty: 5, bagPenalty: 50,
        tenForTwoHundred: true, losingFloor: null, firstHandMin: 3, shotOut: false, bagsOn: false, firstHandBidsItself: false,
        spadesMustBeBroken: false, firstLead: 'twoOfClubs', partnerMayAlsoNil: false, nilTricksCountForPartner: true,
        turnTimerSec: { bid: 45, play: 15 },
      }),
    ];
    for (const s of samples) expect(acceptRules(s)).toEqual(s);
    const extra = acceptRules({ ...makeRules('joker'), injected: true, nil: { ...makeRules('joker').nil, bonus: 5 } } as never);
    expect(extra).toEqual(makeRules('joker'));
    expect('injected' in extra).toBe(false);
  });
  it('refuses a string nil value and fills a missing nil from the preset', () => {
    const raw = { ...makeRules('joker', { targetScore: 250, firstHandBidsItself: false }), nil: { allowed: true, value: '100' } };
    expect(bad(raw)).toMatch(/nil\.value/);
    const hole = { ...makeRules('joker', { targetScore: 250, firstHandBidsItself: false }) } as { nil?: unknown };
    delete hole.nil;
    const r = acceptRules(hole);
    expect(r.nil).toEqual({ allowed: true, value: 100 });
    expect(r.targetScore).toBe(250);
    expect(r.firstHandBidsItself).toBe(false);
    const st = newGame(r, 'seed');
    expect(() => bidOptions(st, st.turn!)).not.toThrow();
    expect(bidOptions(st, st.turn!).nil).toBe(true);
    const hand = scoreHand(r, ['nil', 4, 4, 4], [0, 5, 4, 4], [150, 0], [0, 0]);
    expect(hand[0]!.totalScore).toBe(290);
    expect(typeof hand[0]!.totalScore).toBe('number');
  });
  it('rejects an unknown mode and clamps timers', () => {
    expect(bad(null)).toMatch(/object/);
    expect(bad({ mode: 'whist' })).toMatch(/mode/);
    expect(bad({ mode: 'joker', bagPenalty: '100' })).toMatch(/bagPenalty/);
    expect(acceptRules({ ...makeRules('joker'), turnTimerSec: { bid: 1, play: 500 } }).turnTimerSec).toEqual({ bid: 3, play: 120 });
    expect(acceptRules({ ...makeRules('joker'), turnTimerSec: { bid: 'fast', play: 10 } } as never).turnTimerSec).toEqual({ bid: 30, play: 10 });
  });
});

describe('trump ranking', () => {
  it('default Joker order (Demetrius): BJ > LJ > 2♦ > 2♠ > A♠ … 3♠', () => {
    const r = makeRules('joker');
    expect(trumpOrder(r)).toEqual(['BJ', 'LJ', '2D', '2S', 'AS', 'KS', 'QS', 'JS', 'TS', '9S', '8S', '7S', '6S', '5S', '4S', '3S']);
    expect(effectiveSuit('2D', r)).toBe('S');
    expect(isTrump('2D', r)).toBe(true);
    expect(cardPower('2D', r)).toBeGreaterThan(cardPower('2S', r));
    expect(cardPower('2S', r)).toBeGreaterThan(cardPower('AS', r));
    expect(cardPower('LJ', r)).toBeGreaterThan(cardPower('2D', r));
    // diamonds have no 2: lowest diamond is the 3
    const diamonds = buildDeck(r).filter((c) => effectiveSuit(c, r) === 'D');
    expect(diamonds).toHaveLength(12);
    expect(diamonds).not.toContain('2D');
  });
  it('classic Joker variant: BJ > LJ > A♠ … 2♠ with 2♥ 2♦ removed', () => {
    const r = makeRules('joker', CLASSIC_JOKER);
    expect(trumpOrder(r)).toEqual(['BJ', 'LJ', 'AS', 'KS', 'QS', 'JS', 'TS', '9S', '8S', '7S', '6S', '5S', '4S', '3S', '2S']);
    expect(buildDeck(r)).toHaveLength(52);
  });
  it('removing the 2♦ drops it from the default trump order', () => {
    expect(trumpOrder(makeRules('joker', { removedCards: ['2H', '2D'] })).slice(0, 4)).toEqual(['BJ', 'LJ', '2S', 'AS']);
  });
  it('deuceOfSpadesHigh puts 2♠ right under the jokers', () => {
    const r = makeRules('joker', { ...CLASSIC_JOKER, deuceOfSpadesHigh: true });
    expect(trumpOrder(r).slice(0, 4)).toEqual(['BJ', 'LJ', '2S', 'AS']);
    expect(trumpOrder(r)).toHaveLength(15);
    expect(cardPower('2S', r)).toBeGreaterThan(cardPower('AS', r));
  });
  it('extraHighTrumps via trumpOrderTop: 2♦ becomes a spade', () => {
    const r = makeRules('joker', { trumpOrderTop: ['BJ', 'LJ', '2D', '2S'], removedCards: ['2H', '2C'] });
    expect(trumpOrder(r).slice(0, 5)).toEqual(['BJ', 'LJ', '2D', '2S', 'AS']);
    expect(isTrump('2D', r)).toBe(true);
    expect(effectiveSuit('2D', r)).toBe('S');
    expect(effectiveSuit('3D', r)).toBe('D');
  });
  it('deuceOfSpadesHigh does not duplicate an explicit 2♠', () => {
    const r = makeRules('joker', { trumpOrderTop: ['BJ', 'LJ', '2S'], deuceOfSpadesHigh: true });
    expect(trumpOrder(r).filter((c) => c === '2S')).toHaveLength(1);
  });
  it('jokers are spades; every trump beats every non-trump', () => {
    const r = makeRules('joker');
    expect(effectiveSuit('BJ', r)).toBe('S');
    expect(isTrump('LJ', r)).toBe(true);
    expect(cardPower('BJ', r)).toBeGreaterThan(cardPower('LJ', r));
    expect(cardPower('LJ', r)).toBeGreaterThan(cardPower('AS', r));
    expect(cardPower('2S', r)).toBeGreaterThan(cardPower('AH', r));
    expect(() => cardPower('2H', r)).toThrow(/not in this deck/);
  });
  it('sortHand groups by suit, trumps first, high to low', () => {
    const r = makeRules('joker');
    expect(sortHand(['3H', 'AS', 'BJ', 'KC', '9D', 'AH'], r)).toEqual(['BJ', 'AS', 'AH', '3H', 'KC', '9D']);
  });
});
