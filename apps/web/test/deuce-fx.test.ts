import { describe, expect, it } from 'vitest';
import { type Card, type GameState, type TableRules, makeRules, newGame } from '@spades/rules';
import { classifyDeuceFx, deuceLandCue } from '../src/deuceFx';
import { landCueFor } from '../src/landCue';

/**
 * Deuce Drop / Cut truth tables (deuceFx.ts). Seats are play order (seat =
 * index), so in 4-player partnerships seats 0+2 are one side, 1+3 the other.
 * Trump order in a Joker deck (engine truth, JOKER_TRUMP_TOP):
 * BJ > LJ > 2♦ > 2♠ > A♠ … 3♠. In a standard deck 2♠ is the LOWEST trump
 * and the other deuces are plain cards.
 */
function state(rules: TableRules, plays: Card[], done: Card[][] = []): GameState {
  const st = newGame(rules, 'deuce');
  const mk = (cs: Card[]) => ({ ...st.trick, plays: cs.map((card, seat) => ({ seat, card })) });
  return { ...st, tricks: done.map(mk), trick: mk(plays) } as GameState;
}
const joker = makeRules('joker');
const cutthroat = makeRules('cutthroat');
const standard = makeRules('aceDown');
const classic = makeRules('joker', { trumpOrderTop: ['BJ', 'LJ'] });
const deuceHigh = makeRules('joker', { trumpOrderTop: ['BJ', 'LJ'], deuceOfSpadesHigh: true });

describe('the Drop: trump deuces land heavy, nothing else does', () => {
  it('a led trump deuce drops (nothing to steal from)', () => {
    const st = state(joker, ['2D', '5H']);
    expect(classifyDeuceFx(st, '2D')).toEqual({ drop: true, cut: null, wasOvercut: false });
    expect(deuceLandCue(st, '2D')).toBe('play,broken,deuceThump'); // first trump of the hand + the thump
  });
  it('a deuce that does not beat the standing trump still drops, never cuts', () => {
    const st = state(joker, ['2D', '2S']); // 2♠ sits under 2♦ in the trump order
    expect(classifyDeuceFx(st, '2S')).toEqual({ drop: true, cut: null, wasOvercut: false });
    expect(deuceLandCue(st, '2S')).toBe('play,deuceThump');
  });
  it('in a Joker deck BOTH deuces outrank the ace: 2♠ over A♠ is a steal', () => {
    const st = state(joker, ['AS', '2S']);
    expect(classifyDeuceFx(st, '2S')).toEqual({ drop: true, cut: { victim: 'AS', victimSeat: 0 }, wasOvercut: false });
    expect(deuceLandCue(st, '2S')).toBe('play,deuceThump,trumpCut');
  });
  it('a deuce under the Big Joker drops only', () => {
    const st = state(joker, ['BJ', '2D']);
    expect(classifyDeuceFx(st, '2D').cut).toBeNull();
    expect(deuceLandCue(st, '2D')).toBe('play,deuceThump');
  });
  it('trumping a plain lead is a Drop, not a Cut (the standing winner is not trump)', () => {
    const st = state(joker, ['AH', '2D']);
    expect(classifyDeuceFx(st, '2D')).toEqual({ drop: true, cut: null, wasOvercut: false });
    expect(deuceLandCue(st, '2D')).toBe('play,broken,deuceThump');
  });
  it('plain off-suit deuces get nothing — they are the weakest cards in the deck', () => {
    const st = state(standard, ['2D', '5D']);
    expect(classifyDeuceFx(st, '2D')).toEqual({ drop: false, cut: null, wasOvercut: false });
    expect(deuceLandCue(st, '2D')).toBe(landCueFor(st, '2D'));
  });
  it('in a Classic Joker deck 2♦ is not trump at all: no Drop, no Cut', () => {
    const st = state(classic, ['2S', '2D']);
    expect(classifyDeuceFx(st, '2D')).toEqual({ drop: false, cut: null, wasOvercut: false });
  });
});

describe('the Cut: a marquee trump crosses the standing trump for its side', () => {
  it("the owner's case: 2♦ over 2♠ on a trump lead", () => {
    const st = state(joker, ['2S', '2D']);
    expect(classifyDeuceFx(st, '2D')).toEqual({ drop: true, cut: { victim: '2S', victimSeat: 0 }, wasOvercut: false });
    expect(deuceLandCue(st, '2D')).toBe('play,deuceThump,trumpCut');
  });
  it('Joker over a deuce: the rumble stays, the metal layers on', () => {
    const st = state(joker, ['2D', 'BJ']);
    expect(classifyDeuceFx(st, 'BJ')).toEqual({ drop: false, cut: { victim: '2D', victimSeat: 0 }, wasOvercut: false });
    expect(deuceLandCue(st, 'BJ')).toBe('play,jokerBig,trumpCut');
  });
  it('Little Joker over a deuce; Big over Little', () => {
    expect(classifyDeuceFx(state(joker, ['2S', 'LJ']), 'LJ').cut).toEqual({ victim: '2S', victimSeat: 0 });
    expect(deuceLandCue(state(joker, ['2S', 'LJ']), 'LJ')).toBe('play,jokerLittle,trumpCut');
    expect(classifyDeuceFx(state(joker, ['LJ', 'BJ']), 'BJ').cut).toEqual({ victim: 'LJ', victimSeat: 0 });
    expect(deuceLandCue(state(joker, ['LJ', 'BJ']), 'BJ')).toBe('play,jokerBig,trumpCut');
  });
  it('a Joker that does not cross gets its normal treatment, byte for byte', () => {
    const st = state(joker, ['BJ', 'LJ']);
    expect(classifyDeuceFx(st, 'LJ').cut).toBeNull();
    expect(deuceLandCue(st, 'LJ')).toBe(landCueFor(st, 'LJ'));
  });
  it("beating your own partner's trump never cuts (the side already held the trick)", () => {
    const st = state(joker, ['2S', '5H', '2D']); // seat 2 is seat 0's partner
    expect(classifyDeuceFx(st, '2D')).toEqual({ drop: true, cut: null, wasOvercut: false });
    expect(deuceLandCue(st, '2D')).toBe('play,deuceThump');
  });
  it('in Cutthroat the same play DOES cut — every seat is its own side', () => {
    const st = state(cutthroat, ['2S', '5H', '2D']);
    expect(classifyDeuceFx(st, '2D').cut).toEqual({ victim: '2S', victimSeat: 0 });
  });
  it('the victim is the CURRENT winner, not just any earlier trump', () => {
    // The 2♦ (seat 0) still stands: the last seat's 2♠ crosses nobody.
    const st = state(joker, ['2D', 'KH', '5C', '2S']);
    expect(classifyDeuceFx(st, '2S').cut).toBeNull();
    // …but with only the 2♠ standing, the fourth seat's 2♦ takes it from seat 0.
    const st2 = state(joker, ['2S', 'KH', '5C', '2D']);
    expect(classifyDeuceFx(st2, '2D').cut).toEqual({ victim: '2S', victimSeat: 0 });
  });
  it('deuceOfSpadesHigh (Classic top + toggle): 2♠ jumps the whole spade order, over A♠ too', () => {
    // Without the toggle this is the Classic case above: 2♠ is the lowest
    // trump and A♠ stands. With it, ctx() splices 2♠ in under the Jokers.
    const st = state(deuceHigh, ['AS', '2S']);
    expect(classifyDeuceFx(st, '2S')).toEqual({ drop: true, cut: { victim: 'AS', victimSeat: 0 }, wasOvercut: false });
    expect(deuceLandCue(st, '2S')).toBe('play,deuceThump,trumpCut');
  });
  it('in a standard deck the Cut can never fire: 2♠ is the lowest trump, and there are no Jokers', () => {
    for (const plays of [['AS', '2S'], ['KS', '2S'], ['3S', '2S']] as Card[][]) {
      const st = state(standard, plays);
      expect(classifyDeuceFx(st, '2S')).toEqual({ drop: true, cut: null, wasOvercut: false });
      expect(deuceLandCue(st, '2S')).toContain('deuceThump');
      expect(deuceLandCue(st, '2S')).not.toContain('trumpCut');
    }
  });
});

describe('the Cut replaces the generic over-cut treatment — for marquee steals only', () => {
  it('non-trump lead, A♠ cut in, 2♦ over it: popup + slam give way to thump + metal', () => {
    const st = state(joker, ['KH', 'AS', '2D']);
    expect(landCueFor(st, '2D')).toMatch(/^play,overcut\|/); // the old treatment
    expect(classifyDeuceFx(st, '2D')).toEqual({ drop: true, cut: { victim: 'AS', victimSeat: 1 }, wasOvercut: true });
    expect(deuceLandCue(st, '2D')).toBe('play,deuceThump,trumpCut');
  });
  it('a deuce over a smaller trump (2♠ over 3♠) is a Cut too — the victim need not be a deuce', () => {
    const st = state(joker, ['KH', '3S', '2S']);
    expect(classifyDeuceFx(st, '2S')).toEqual({ drop: true, cut: { victim: '3S', victimSeat: 1 }, wasOvercut: true });
    expect(deuceLandCue(st, '2S')).toBe('play,deuceThump,trumpCut');
  });
  it('wasOvercut pins the preserved flight: jokers never had the over-cut flight', () => {
    const st = state(joker, ['KH', 'AS', 'BJ']);
    expect(classifyDeuceFx(st, 'BJ')).toEqual({ drop: false, cut: { victim: 'AS', victimSeat: 1 }, wasOvercut: false });
    expect(deuceLandCue(st, 'BJ')).toBe('play,jokerBig,trumpCut');
  });
  it('a non-marquee over-cut (Q♠ over 9♠) keeps the generic treatment byte for byte', () => {
    const st = state(standard, ['KH', '9S', 'QS']);
    expect(classifyDeuceFx(st, 'QS')).toEqual({ drop: false, cut: null, wasOvercut: false });
    expect(deuceLandCue(st, 'QS')).toBe(landCueFor(st, 'QS'));
    expect(deuceLandCue(st, 'QS')).toMatch(/^play,overcut\|/);
  });
  it('the A♠ that cut in first is untouched (it is nobody’s marquee)', () => {
    const st = state(joker, ['KH', 'AS', '2D']);
    expect(classifyDeuceFx(st, 'AS')).toEqual({ drop: false, cut: null, wasOvercut: false });
    expect(deuceLandCue(st, 'AS')).toBe(landCueFor(st, 'AS'));
  });
});

describe('non-marquee plays: the composed cue is landCueFor, byte for byte', () => {
  const cases: [TableRules, Card[], Card][] = [
    [joker, ['AH', 'KH'], 'KH'],
    [joker, ['KH', '3S'], '3S'],
    [joker, ['AH', 'LJ'], 'LJ'],
    [standard, ['AH', '2D'], '2D'],
    [standard, ['KH', '9S'], '9S'],
  ];
  it('byte identity across plain plays', () => {
    for (const [rules, plays, card] of cases) {
      const st = state(rules, plays);
      const info = classifyDeuceFx(st, card);
      if (info.drop || info.cut) continue;
      expect(deuceLandCue(st, card)).toBe(landCueFor(st, card));
    }
  });
  it('classic-deck 2♠ is a low trump deuce: it drops (and only drops)', () => {
    const st = state(classic, ['AS', '2S']);
    expect(classifyDeuceFx(st, '2S')).toEqual({ drop: true, cut: null, wasOvercut: false });
    expect(deuceLandCue(st, '2S')).toBe('play,deuceThump');
  });
});
