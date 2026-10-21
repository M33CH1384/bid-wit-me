import { describe, expect, it } from 'vitest';
import { type Action, type Card, type GameState, type Play, makeRules, newGame } from '@spades/rules';
import {
  MALCOLM_CARD, REV_FIGURES, REV_FIGURE_BY_CARD, REV_MALCOLM_CUT_LINES, REV_TRIBUTE_TEXTS,
  lineById, newRevTributeState, revLineIdForText, revTributeCommit, revTributeDetect, type RevTributeState,
} from '../src/index';

const always = () => 0; // every roll lands
const never = () => 0.99; // every roll misses

function playState(handNo = 1): GameState {
  const s = newGame(makeRules('joker'), 'rev');
  return { ...s, phase: 'playing', handNo };
}

/** a non-completing play step */
function throwCard(before: GameState, seat: number, card: Card): [Action, GameState] {
  const action: Action = { type: 'play', seat, card };
  const trick = { leader: before.trick?.leader ?? seat, plays: [...(before.trick?.plays ?? []), { seat, card }], winner: null };
  return [action, { ...before, trick }];
}

/** the step that completes a trick with the given plays (winner explicit, as the engine records it) */
function completeTrick(before: GameState, plays: Play[], winner: number): [Action, GameState] {
  const last = plays[plays.length - 1]!;
  const action: Action = { type: 'play', seat: last.seat, card: last.card };
  const after: GameState = {
    ...before,
    trick: { leader: winner, plays: [], winner: null },
    tricks: [...before.tricks, { leader: plays[0]!.seat, plays, winner }],
  };
  return [action, after];
}

function fire(st: RevTributeState, before: GameState, seat: number, card: Card, rnd: () => number = always) {
  const [a, after] = throwCard(before, seat, card);
  const ev = revTributeDetect(st, before, a, after, rnd);
  if (ev) revTributeCommit(st, ev, after.handNo, after.tricks.length - 1);
  return ev;
}

describe('the figure map (read off the deck’s lettered art)', () => {
  it('covers all twelve courts exactly once, Malcolm X on the King of Clubs', () => {
    expect(REV_FIGURES).toHaveLength(12);
    const cards = REV_FIGURES.map((f) => f.card).sort();
    expect(cards).toEqual(['JC', 'JD', 'JH', 'JS', 'KC', 'KD', 'KH', 'KS', 'QC', 'QD', 'QH', 'QS']);
    expect(MALCOLM_CARD).toBe('KC');
    expect(REV_FIGURE_BY_CARD['KS']!.name).toBe('Frederick Douglass');
    expect(REV_FIGURE_BY_CARD['QS']!.name).toBe('Harriet Tubman');
    expect(REV_FIGURE_BY_CARD['JS']!.name).toBe('Nat Turner');
    expect(REV_FIGURE_BY_CARD['KH']!.name).toBe('Martin Luther King Jr.');
    expect(REV_FIGURE_BY_CARD['QH']!.name).toBe('Sojourner Truth');
    expect(REV_FIGURE_BY_CARD['JH']!.name).toBe('Fannie Lou Hamer');
    expect(REV_FIGURE_BY_CARD['KD']!.name).toBe('Marcus Garvey');
    expect(REV_FIGURE_BY_CARD['QD']!.name).toBe('Ida B. Wells');
    expect(REV_FIGURE_BY_CARD['JD']!.name).toBe('W.E.B. Du Bois');
    expect(REV_FIGURE_BY_CARD['KC']!.name).toBe('Malcolm X');
    expect(REV_FIGURE_BY_CARD['QC']!.name).toBe('Angela Davis');
    expect(REV_FIGURE_BY_CARD['JC']!.name).toBe('Huey P. Newton');
  });

  it('June has alternate lines for Tubman, Wells and Hamer only; Malcolm has two cut variants on his phrase', () => {
    expect(REV_FIGURES.filter((f) => f.june).map((f) => f.card)).toEqual(['QS', 'JH', 'QD']);
    expect(REV_MALCOLM_CUT_LINES).toHaveLength(2);
    for (const l of REV_MALCOLM_CUT_LINES) expect(l).toContain('by any means necessary');
  });

  it('every tribute text resolves through the rev line ids both ways (the persona bake’s contract)', () => {
    for (const text of [...REV_TRIBUTE_TEXTS, ...REV_MALCOLM_CUT_LINES]) {
      const id = revLineIdForText(text);
      expect(id).toMatch(/^rev\.(tribute|malcolm)\.\d+$/);
      expect(lineById(id!)).toBe(text);
    }
  });
});

describe('court played', () => {
  it('a court draws its figure’s tribute, whoever threw it', () => {
    const st = newRevTributeState();
    const ev = fire(st, playState(), 2, 'KH');
    expect(ev?.kind).toBe('tribute');
    expect(ev?.figure).toBe('Martin Luther King Jr.');
    expect(ev?.cardSeat).toBe(2);
    expect(ev?.text).toContain('381 days');
  });

  it('the probability roll gates it', () => {
    const st = newRevTributeState();
    expect(fire(st, playState(), 1, 'KS', never)).toBeNull();
  });

  it('non-court cards and non-play actions never fire', () => {
    const st = newRevTributeState();
    expect(fire(st, playState(), 1, 'AS')).toBeNull(); // aces are not courts
    expect(fire(st, playState(), 1, '7H')).toBeNull();
    const s = playState();
    expect(revTributeDetect(st, s, { type: 'bid', seat: 1, bid: 4 }, s, always)).toBeNull();
  });

  it('each figure speaks at most once per game', () => {
    const st = newRevTributeState();
    expect(fire(st, playState(1), 1, 'KS')).not.toBeNull();
    expect(fire(st, playState(2), 3, 'KS')).toBeNull(); // same figure, next hand
  });

  it('at most one regular tribute per hand, and at most four per game', () => {
    const st = newRevTributeState();
    expect(fire(st, playState(1), 1, 'KS')).not.toBeNull();
    expect(fire(st, playState(1), 2, 'QS')).toBeNull(); // same hand
    expect(fire(st, playState(2), 2, 'QS')).not.toBeNull();
    expect(fire(st, playState(3), 0, 'JS')).not.toBeNull();
    expect(fire(st, playState(4), 0, 'KD')).not.toBeNull();
    expect(fire(st, playState(5), 0, 'QD')).toBeNull(); // fifth regular tribute
  });

  it('Malcolm thrown mid-trick is NOT judged yet — his beat waits for the trick to close', () => {
    const st = newRevTributeState();
    expect(fire(st, playState(), 1, 'KC')).toBeNull();
  });
});

describe('Malcolm gets cut (the signature)', () => {
  // clubs led small, Malcolm lands winning, an opposing spade takes it, a club closes
  const cutPlays: Play[] = [
    { seat: 0, card: '5C' }, { seat: 1, card: 'KC' }, { seat: 2, card: '7S' }, { seat: 3, card: '9C' },
  ];

  it('fires near-guaranteed — no tribute roll stands in its way', () => {
    const st = newRevTributeState();
    const [a, after] = completeTrick(playState(), cutPlays, 2);
    const ev = revTributeDetect(st, playState(), a, after, never); // roll misses everything…
    expect(ev?.kind).toBe('malcolmCut'); // …and the signature still fires
    expect(ev?.cardSeat).toBe(1);
    expect(ev?.cutterSeat).toBe(2);
    expect(REV_MALCOLM_CUT_LINES).toContain(ev?.text);
  });

  it('fires once per game only', () => {
    const st = newRevTributeState();
    const s = playState();
    const [a, after] = completeTrick(s, cutPlays, 2);
    const ev = revTributeDetect(st, s, a, after, always);
    revTributeCommit(st, ev!, after.handNo, after.tricks.length - 1);
    expect(revTributeDetect(st, playState(2), a, { ...after, handNo: 2 }, always)).toBeNull();
  });

  it('is exempt from the regular caps (a spent tribute budget cannot mute it)', () => {
    const st = newRevTributeState();
    st.total = 4; st.figures = new Set(['KS', 'QS', 'JS', 'KH']);
    const [a, after] = completeTrick(playState(), cutPlays, 2);
    expect(revTributeDetect(st, playState(), a, after, always)?.kind).toBe('malcolmCut');
  });

  it('does NOT fire when Malcolm’s card wins the trick — that is his regular tribute instead', () => {
    const st = newRevTributeState();
    const plays: Play[] = [
      { seat: 0, card: '5C' }, { seat: 1, card: 'KC' }, { seat: 2, card: '9C' }, { seat: 3, card: '3C' },
    ];
    const [a, after] = completeTrick(playState(), plays, 1);
    const ev = revTributeDetect(st, playState(), a, after, always);
    expect(ev?.kind).toBe('tribute');
    expect(ev?.card).toBe('KC');
  });

  it('does NOT fire when Malcolm is discarded into a trick he never led (spades led)', () => {
    const st = newRevTributeState();
    const plays: Play[] = [
      { seat: 0, card: 'AS' }, { seat: 1, card: 'KC' }, { seat: 2, card: '9C' }, { seat: 3, card: '2C' },
    ];
    const [a, after] = completeTrick(playState(), plays, 0);
    expect(revTributeDetect(st, playState(), a, after, always)).toBeNull();
  });

  it('does NOT fire when the trump was already down before Malcolm landed', () => {
    const st = newRevTributeState();
    const plays: Play[] = [
      { seat: 0, card: '4C' }, { seat: 1, card: '7S' }, { seat: 2, card: 'KC' }, { seat: 3, card: '9C' },
    ];
    const [a, after] = completeTrick(playState(), plays, 1);
    expect(revTributeDetect(st, playState(), a, after, always)).toBeNull();
  });

  it('does NOT fire when his own partner trumps him — a partner play is not a cut', () => {
    const st = newRevTributeState();
    const plays: Play[] = [
      { seat: 0, card: '5C' }, { seat: 1, card: 'KC' }, { seat: 2, card: '9C' }, { seat: 3, card: '7S' },
    ];
    const [a, after] = completeTrick(playState(), plays, 3);
    expect(revTributeDetect(st, playState(), a, after, always)).toBeNull();
  });

  it('a joker counts as the trump that cut him (joker decks)', () => {
    const st = newRevTributeState();
    const s = { ...newGame(makeRules('joker'), 'rev-joker'), phase: 'playing' as const, handNo: 1 };
    const plays: Play[] = [
      { seat: 0, card: '5C' }, { seat: 1, card: 'KC' }, { seat: 2, card: 'LJ' }, { seat: 3, card: '9C' },
    ];
    const [a, after] = completeTrick(s, plays, 2);
    expect(revTributeDetect(st, s, a, after, always)?.kind).toBe('malcolmCut');
  });
});
