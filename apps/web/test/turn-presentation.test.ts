import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyAction, bidOptions, legalPlays, makeRules, newGame, throwInOpen, viewFor,
  type GameState,
} from '@spades/rules';
import { highlightLegal, turnStateKey } from '../src/turnPresentation';
import { presentationCaughtUp } from '../src/three/sweepGate';

/**
 * Owner, 2026-10-30: "My card highlight which ones are available to play
 * about a second before anyone plays a card when it's not my turn."
 *
 * The state advances the instant a play is applied; the play's presentation
 * (flight, pacing spacing, review hold + sweep) finishes later on the
 * Scene's frame clock. The highlight set is therefore gated on the Scene's
 * presentation certification (turnPresentation.ts): Table shows it only
 * for a turnStateKey the Scene has certified as fully presented. These
 * tests pin that contract at the derivation level, composed the way Table
 * and Scene compose it.
 */

const HUMAN = 0;

/** Table's client mirror of the engine's last-card free-drop window (Table.tsx). */
function dropOpenView(st: GameState): boolean {
  const view = viewFor(st, HUMAN);
  return st.phase === 'playing'
    && (view.hand ?? []).length === 1
    && view.trick.plays.every((p) => p.seat !== HUMAN);
}

/** Table's highlight derivation, with the presentation flag as the only variable. */
function tableLegal(st: GameState, presented: boolean) {
  const view = viewFor(st, HUMAN);
  return highlightLegal({
    myTurn: st.phase === 'playing' && st.turn === HUMAN,
    dropOpen: dropOpenView(st),
    phase: st.phase,
    presented,
    viewLegal: view.legal,
    hand: view.hand,
  });
}

function dealAndBid(seed: string): GameState {
  const rules = makeRules('joker', { firstHandBidsItself: false });
  let st = newGame(rules, seed, { dealer: 1 });
  let guard = 0;
  while (st.phase === 'bidding') {
    if (++guard > 40) throw new Error('bidding did not finish');
    const seat = st.turn!;
    if (!st.revealed[seat]) { st = applyAction(st, { type: 'reveal', seat }); continue; }
    st = applyAction(st, { type: 'bid', seat, bid: bidOptions(st, seat).min });
  }
  return st;
}

describe('the playable highlight waits for the table', () => {
  it('across a full hand of rotations: present exactly on his turn (with the exact legal set), absent on all other turns', () => {
    // Several seeds: who leads the final trick varies, and the free-drop
    // window only opens out-of-turn when a bot acts there before him (in a
    // dealt hand his one-card moment is the final trick — the throw-in's old
    // home; the mid-hand case is crafted in the test below).
    let dropStates = 0;
    for (const seed of ['offturn-rotation', 'offturn-rotation-2', 'offturn-rotation-3', 'offturn-rotation-4']) {
      let st = dealAndBid(seed);
      expect(st.phase).toBe('playing');
      let states = 0;
      let hisTurns = 0;
      let guard = 0;
      while (st.phase === 'playing') {
        if (++guard > 60) throw new Error('hand did not finish');
        states++;
        const view = viewFor(st, HUMAN);
        const shown = tableLegal(st, true);
        if (st.turn === HUMAN) {
          hisTurns++;
          // Presented and his turn: exactly the engine's legal plays for him.
          expect(shown).toEqual(legalPlays(st, HUMAN));
          // The owner's shape: same state, presentation still pending -> nothing lit.
          expect(tableLegal(st, false)).toEqual([]);
        } else if (dropOpenView(st)) {
          dropStates++;
          // The deliberate exception: the last-card free drop is turn-free by
          // design (his last card, while the trick is still landing).
          expect(throwInOpen(st)).toBe(true);
          expect(shown).toEqual(view.legal.filter((c) => (view.hand ?? []).includes(c)));
          expect(tableLegal(st, false)).toEqual(shown);
        } else {
          expect(shown).toEqual([]);
          expect(tableLegal(st, false)).toEqual([]);
        }
        const seat = st.turn!;
        st = applyAction(st, { type: 'play', seat, card: legalPlays(st, seat)[0]! });
      }
      expect(st.phase).not.toBe('playing');
      expect(states).toBe(52);
      expect(hisTurns).toBe(13);
    }
    expect(dropStates).toBeGreaterThan(0);
  });

  it('mid-hand: his single card lights up out of turn, at full strength, the moment the trick is open — two cards never do', () => {
    // Dealt hands are uniform, so a mid-hand one-card seat is crafted onto a
    // dealt state (the rules suite pins the engine's acceptance of the drop).
    const dealt = dealAndBid('offturn-drop');
    const craft = (humanHand: string[]): GameState => ({
      ...dealt,
      hands: [humanHand, dealt.hands[1]!.slice(0, 3), dealt.hands[2]!.slice(0, 2), dealt.hands[3]!.slice(0, 3)] as GameState['hands'],
      trick: { leader: 1, plays: [], winner: null },
      turn: 1,
      tricks: Array.from({ length: 5 }, () => ({ leader: 0, plays: [], winner: 0 })),
      tricksWon: [0, 0, 0, 0],
      spadesBroken: true,
    });
    const one = craft(['7H']);
    expect(viewFor(one, HUMAN).legal).toEqual(['7H']);
    // Not his turn and the table has NOT certified presentation — the drop is
    // exempt by design: it reads available instantly, not after the last play lands.
    expect(tableLegal(one, false)).toEqual(['7H']);
    expect(tableLegal(one, true)).toEqual(['7H']);
    // Two cards: no drop, no highlight, presented or not.
    const two = craft(['7H', '8H']);
    expect(viewFor(two, HUMAN).legal).toEqual([]);
    expect(tableLegal(two, false)).toEqual([]);
    expect(tableLegal(two, true)).toEqual([]);
  });

  it('the owner’s exact timing shape: state advanced to his turn, the advancing play still presenting', () => {
    // A state where seat 3's play has been applied and the turn is now his.
    let st = dealAndBid('offturn-shape');
    let guard = 0;
    while (!(st.phase === 'playing' && st.turn === HUMAN && st.trick.plays.length > 0)) {
      if (++guard > 60) throw new Error('never reached a mid-trick human turn');
      const seat = st.turn!;
      st = applyAction(st, { type: 'play', seat, card: legalPlays(st, seat)[0]! });
    }
    // The advancing play is still in the air: its stamped rest is ~a second
    // of frame time ahead (pacing spacing + flight). No highlight yet.
    const rests = st.trick.plays.map((_, i) => (i === st.trick.plays.length - 1 ? 11.0 : 9.5));
    expect(presentationCaughtUp({ rests, sweepUntilFrameSec: 0, nowFrameSec: 10.0 })).toBe(false);
    expect(tableLegal(st, presentationCaughtUp({ rests, sweepUntilFrameSec: 0, nowFrameSec: 10.0 }))).toEqual([]);
    // The card lands: the certification flips and his full legal set arrives.
    expect(presentationCaughtUp({ rests, sweepUntilFrameSec: 0, nowFrameSec: 11.0 })).toBe(true);
    expect(tableLegal(st, true)).toEqual(legalPlays(st, HUMAN));
  });

  it('a pending collection also holds the highlight: the leader waits out the sweep', () => {
    // Every play rested, but the finished trick is still being collected.
    expect(presentationCaughtUp({ rests: [9.5], sweepUntilFrameSec: 11.55, nowFrameSec: 11.0 })).toBe(false);
    expect(presentationCaughtUp({ rests: [9.5], sweepUntilFrameSec: 11.55, nowFrameSec: 11.55 })).toBe(true);
    // A resumed table: plays already resting (no stamps) certify at once.
    expect(presentationCaughtUp({ rests: [undefined, undefined], sweepUntilFrameSec: 0, nowFrameSec: 3 })).toBe(true);
  });

  it('the turn key separates state the counts alone cannot: held vs live at a trick boundary', () => {
    let st = dealAndBid('offturn-key');
    let guard = 0;
    while (st.trick.plays.length < 3) {
      if (++guard > 60) throw new Error('trick did not fill');
      const seat = st.turn!;
      st = applyAction(st, { type: 'play', seat, card: legalPlays(st, seat)[0]! });
    }
    const midTrick = turnStateKey(st, false);
    const seat = st.turn!;
    st = applyAction(st, { type: 'play', seat, card: legalPlays(st, seat)[0]! });
    // The completing play lands the trick in the piles and empties the live
    // trick: same plays count as the next trick's start, different hand
    // progress — and the held presentation differs from the released one.
    expect(turnStateKey(st, true)).not.toBe(midTrick);
    expect(turnStateKey(st, true)).not.toBe(turnStateKey(st, false));
    expect(turnStateKey(st, false)).toBe(turnStateKey(st, false));
  });

  it('bid and exchange phases never produce a highlight set', () => {
    const rules = makeRules('joker', { firstHandBidsItself: false });
    const st = newGame(rules, 'offturn-phases', { dealer: 0 });
    const view = viewFor(st, HUMAN);
    expect(highlightLegal({ myTurn: true, dropOpen: false, phase: st.phase, presented: true, viewLegal: view.legal, hand: view.hand })).toEqual([]);
    expect(highlightLegal({ myTurn: true, dropOpen: false, phase: 'exchange', presented: true, viewLegal: view.legal, hand: view.hand })).toEqual([]);
  });

  it('the wiring is in place: Table gates on the certification the Scene issues', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    expect(table).toContain('highlightLegal({ myTurn, dropOpen: dropOpenView, phase: st.phase, presented, viewLegal: view.legal, hand })');
    expect(table).toContain('turnKey={turnKey}');
    expect(table).toContain('onTurnPresented={onTurnPresented}');
    const scene = readFileSync(new URL('../src/three/Scene.tsx', import.meta.url), 'utf8');
    expect(scene).toContain('presentationCaughtUp({ rests, sweepUntilFrameSec: pileSeq.current.sweepUntil, nowFrameSec: seqClock.current })');
    expect(scene).toContain('props.onTurnPresented(tk)');
  });
});
