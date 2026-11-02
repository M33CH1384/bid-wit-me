import { describe, expect, it } from 'vitest';
import {
  makeRules, newGame as realNewGame, applyAction, RuleError,
  legalPlays, playableCards, lastCardDropOpen, liveSeats, viewFor,
  type GameState, type TableRules, type Card,
} from '../src';

/**
 * Last-card free drop (Demetrius 2026-11-02): "When it's my last card I don't want
 * to have to wait to throw it out — all players should be able to drop the last
 * card out of the normal order." Any trick: a seat holding exactly one card may
 * play it out of turn. The play is forced, so what lands never changes — only the
 * wait goes away. These states are crafted directly (dealt hands are uniform, so
 * a mid-hand one-card seat is built by hand) plus one real game for the final trick.
 */

const newGame = (r: TableRules, seed: string) => realNewGame({ ...r, firstHandBidsItself: false, shotOut: false }, seed);

/** A mid-hand playing state with exactly the hands/trick the test wants. */
function craft(rules: TableRules, hands: Card[][], opts: {
  leader?: number; turn?: number; bids?: unknown[]; spadesBroken?: boolean; priorTricks?: number;
} = {}): GameState {
  const base = newGame(rules, 'craft');
  const leader = opts.leader ?? 0;
  return {
    ...base,
    phase: 'playing',
    bids: (opts.bids ?? hands.map(() => 3)) as GameState['bids'],
    hands,
    trick: { leader, plays: [], winner: null },
    turn: opts.turn ?? leader,
    tricks: Array.from({ length: opts.priorTricks ?? 5 }, () => ({ leader: 0, plays: [], winner: 0 })),
    tricksWon: hands.map(() => 0),
    spadesBroken: opts.spadesBroken ?? true,
    revealed: hands.map(() => true),
  };
}

const ACE = makeRules('aceDown');

describe('last-card free drop', () => {
  it('opens for exactly one card, out of turn, before the leader has led', () => {
    const st = craft(ACE, [['9S', '4C'], ['2S', 'KH'], ['7H'], ['AS', '5D']], { leader: 0 });
    expect(lastCardDropOpen(st, 2)).toBe(true);
    expect(lastCardDropOpen(st, 1)).toBe(false); // two cards: still waits for the turn
    expect(lastCardDropOpen(st, 0)).toBe(false); // the leader plays on the turn, not the drop
    expect(playableCards(st, 2)).toEqual(['7H']);
    expect(playableCards(st, 1)).toEqual([]);
    // the seat view (what the server sends and the client lights up) agrees
    expect(viewFor(st, 2).legal).toEqual(['7H']);
    expect(viewFor(st, 1).legal).toEqual([]);
    const after = applyAction(st, { type: 'play', seat: 2, card: '7H' });
    expect(after.trick.plays).toEqual([{ seat: 2, card: '7H' }]);
    // the pointer does not move: the leader is still to lead
    expect(after.turn).toBe(0);
  });

  it('the leader still leads freely after a drop — the drop never sets the suit', () => {
    let st = craft(ACE, [['9S', '4C'], ['2S', 'KH'], ['7H'], ['AS', '5D']], { leader: 0 });
    st = applyAction(st, { type: 'play', seat: 2, card: '7H' });
    // hearts landed first, but the leader may lead anything (spades are broken here)
    expect(legalPlays(st, 0)).toEqual(expect.arrayContaining(['9S', '4C']));
    expect(legalPlays(st, 0)).toHaveLength(2);
    st = applyAction(st, { type: 'play', seat: 0, card: '9S' });
    expect(st.turn).toBe(1);
  });

  it('followers follow the LEADER’s suit, not the dropped card’s', () => {
    let st = craft(ACE, [['9S', '4C'], ['2S', 'KH'], ['7H'], ['AS', '5D']], { leader: 0 });
    st = applyAction(st, { type: 'play', seat: 2, card: '7H' });
    st = applyAction(st, { type: 'play', seat: 0, card: '9S' });
    // seat 1 holds a heart (the drop's suit) and a spade (the led suit): the spade is forced
    expect(legalPlays(st, 1)).toEqual(['2S']);
    let err: unknown = null;
    try { applyAction(st, { type: 'play', seat: 1, card: 'KH' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RuleError);
    expect((err as RuleError).code).toBe('MUST_FOLLOW_SUIT');
    st = applyAction(st, { type: 'play', seat: 1, card: '2S' });
    // the pointer skips the seat that already dropped
    expect(st.turn).toBe(3);
    st = applyAction(st, { type: 'play', seat: 3, card: 'AS' });
    const done = st.tricks[st.tricks.length - 1]!;
    expect(done.winner).toBe(3);
    // the stored trick is leader-first even though the cards landed 2,0,1,3
    expect(done.plays.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
  });

  it('the trick winner is the same as strict in-order play from the same state', () => {
    const start = craft(ACE, [['9S', '4C'], ['2S', 'KH'], ['7H'], ['AS', '5D']], { leader: 0 });
    let a: GameState = start; // in order
    a = applyAction(a, { type: 'play', seat: 0, card: '9S' });
    a = applyAction(a, { type: 'play', seat: 1, card: '2S' });
    a = applyAction(a, { type: 'play', seat: 2, card: '7H' });
    a = applyAction(a, { type: 'play', seat: 3, card: 'AS' });
    let b: GameState = start; // drop first, then the rotation
    b = applyAction(b, { type: 'play', seat: 2, card: '7H' });
    b = applyAction(b, { type: 'play', seat: 0, card: '9S' });
    b = applyAction(b, { type: 'play', seat: 1, card: '2S' });
    b = applyAction(b, { type: 'play', seat: 3, card: 'AS' });
    expect(b.tricks[b.tricks.length - 1]!.winner).toBe(a.tricks[a.tricks.length - 1]!.winner);
    expect(b.tricks[b.tricks.length - 1]!.plays).toEqual(a.tricks[a.tricks.length - 1]!.plays);
  });

  it('two one-card players can both drop in the same trick, in either order', () => {
    let st = craft(ACE, [['9S', '4C'], ['KH'], ['2S', '5C'], ['3D']], { leader: 0 });
    st = applyAction(st, { type: 'play', seat: 3, card: '3D' });
    expect(st.turn).toBe(0);
    st = applyAction(st, { type: 'play', seat: 1, card: 'KH' });
    expect(st.turn).toBe(0);
    st = applyAction(st, { type: 'play', seat: 0, card: '9S' });
    // rotation resumes after the leader, skipping both droppers
    expect(st.turn).toBe(2);
    st = applyAction(st, { type: 'play', seat: 2, card: '2S' });
    const done = st.tricks[st.tricks.length - 1]!;
    expect(done.plays.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    expect(done.winner).toBe(0);
  });

  it('rejects an out-of-turn play from a hand of two or more', () => {
    const st = craft(ACE, [['9S', '4C'], ['2S', 'KH'], ['7H', '8H'], ['AS', '5D']], { leader: 0 });
    let err: unknown = null;
    try { applyAction(st, { type: 'play', seat: 2, card: '7H' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RuleError);
    expect((err as RuleError).code).toBe('NOT_YOUR_TURN');
  });

  it('one card per seat per trick stays absolute: played from two, the last card cannot follow in the same trick', () => {
    let st = craft(ACE, [['9S', '4C'], ['2S', 'KH'], ['7H', '8H'], ['AS', '5D']], { leader: 0 });
    st = applyAction(st, { type: 'play', seat: 0, card: '9S' });
    st = applyAction(st, { type: 'play', seat: 1, card: '2S' }); // seat 1 now holds exactly one card…
    expect(st.hands[1]).toEqual(['KH']);
    expect(lastCardDropOpen(st, 1)).toBe(false); // …but already played in this trick
    expect(playableCards(st, 1)).toEqual([]);
    let err: unknown = null;
    try { applyAction(st, { type: 'play', seat: 1, card: 'KH' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RuleError);
    expect((err as RuleError).code).toBe('ALREADY_PLAYED');
    // and the same-card retry stays the idempotent no-op the duplicate guard promises
    const again = applyAction(st, { type: 'play', seat: 1, card: '2S' });
    expect(again).toBe(st);
  });

  it('a play after the trick completes is just an out-of-turn play in the next trick', () => {
    let st = craft(ACE, [['9S', '4C'], ['2S', 'KH'], ['7H'], ['AS', '5D']], { leader: 0 });
    st = applyAction(st, { type: 'play', seat: 2, card: '7H' });
    st = applyAction(st, { type: 'play', seat: 0, card: '9S' });
    st = applyAction(st, { type: 'play', seat: 1, card: '2S' });
    st = applyAction(st, { type: 'play', seat: 3, card: 'AS' }); // trick completes; seat 3 leads the next
    expect(st.trick.plays).toEqual([]);
    expect(st.turn).toBe(3);
    // seat 0 holds a card and seat 1 holds a card, but the fresh trick belongs to the rotation:
    // seat 1 (one card, unplayed in THIS trick) may drop; seat 0 (one card) may too — that IS the rule.
    expect(lastCardDropOpen(st, 1)).toBe(true);
    // a two-card seat may not jump the new trick
    const two: GameState = { ...st, hands: [['4C'], ['KH', 'QD'], [], ['5D']] };
    let err: unknown = null;
    try { applyAction(two, { type: 'play', seat: 1, card: 'QD' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(RuleError);
    expect((err as RuleError).code).toBe('NOT_YOUR_TURN');
  });

  it('a one-card leader simply leads it', () => {
    const st = craft(ACE, [['9S'], ['2S', 'KH'], ['7H', '8H'], ['AS', '5D']], { leader: 0 });
    expect(legalPlays(st, 0)).toEqual(['9S']);
    const after = applyAction(st, { type: 'play', seat: 0, card: '9S' });
    expect(after.turn).toBe(1);
  });

  it('a Nil or Blind Nil bidder on their last card drops like anyone else', () => {
    for (const bid of ['nil', 'blindNil'] as const) {
      const st = craft(ACE, [['9S', '4C'], ['2S', 'KH'], ['7H'], ['AS', '5D']], { leader: 0, bids: [3, 3, bid, 3] });
      expect(lastCardDropOpen(st, 2)).toBe(true);
      const after = applyAction(st, { type: 'play', seat: 2, card: '7H' });
      expect(after.trick.plays).toEqual([{ seat: 2, card: '7H' }]);
    }
  });

  it('cutthroat: the drop works, and the trick completes on the live-seat count', () => {
    const r = makeRules('cutthroat');
    let st = craft(r, [['9S', '4C'], ['2S', 'KH'], ['7H'], ['AS', '5D']], { leader: 0 });
    st = applyAction(st, { type: 'play', seat: 2, card: '7H' });
    st = applyAction(st, { type: 'play', seat: 0, card: '9S' });
    st = applyAction(st, { type: 'play', seat: 1, card: '2S' });
    expect(st.tricks).toHaveLength(5); // not yet: three plays of four
    st = applyAction(st, { type: 'play', seat: 3, card: 'AS' });
    expect(st.tricks).toHaveLength(6);
    // cutthroat keeps the deuce of spades high (only ace-down turns it off): 2♠ takes it
    expect(st.tricks[5]!.winner).toBe(1);
  });

  it('legacy 3-player cutthroat: the trick completes on three plays', () => {
    const r = makeRules('cutthroat', { playerCount: 3 });
    let st = craft(r, [['9S', '4C'], ['2S', 'KH'], ['7H']], { leader: 0 });
    expect(liveSeats(st)).toEqual([0, 1, 2]);
    st = applyAction(st, { type: 'play', seat: 2, card: '7H' });
    st = applyAction(st, { type: 'play', seat: 0, card: '9S' });
    st = applyAction(st, { type: 'play', seat: 1, card: '2S' });
    expect(st.tricks).toHaveLength(6);
    expect(st.tricks[5]!.plays.map((p) => p.seat)).toEqual([0, 1, 2]);
    expect(st.tricks[5]!.winner).toBe(1); // deuce of spades high, as above
  });

  it('an eliminated seat is never open', () => {
    const r = makeRules('cutthroat');
    const st = { ...craft(r, [['9S', '4C'], [] as Card[], ['7H'], ['AS', '5D']], { leader: 0 }), eliminated: [false, true, false, false] };
    expect(lastCardDropOpen(st, 1)).toBe(false);
    expect(playableCards(st, 1)).toEqual([]);
  });

  it('a saved mid-trick state with a drop already down round-trips and finishes the same', () => {
    let st = craft(ACE, [['9S', '4C'], ['2S', 'KH'], ['7H'], ['AS', '5D']], { leader: 0 });
    st = applyAction(st, { type: 'play', seat: 2, card: '7H' });
    const revived = JSON.parse(JSON.stringify(st)) as GameState;
    for (const s of [0, 1, 2, 3]) expect(playableCards(revived, s)).toEqual(playableCards(st, s));
    let a = applyAction(revived, { type: 'play', seat: 0, card: '9S' });
    a = applyAction(a, { type: 'play', seat: 1, card: '2S' });
    a = applyAction(a, { type: 'play', seat: 3, card: 'AS' });
    let b = applyAction(st, { type: 'play', seat: 0, card: '9S' });
    b = applyAction(b, { type: 'play', seat: 1, card: '2S' });
    b = applyAction(b, { type: 'play', seat: 3, card: 'AS' });
    expect(a.tricks[a.tricks.length - 1]).toEqual(b.tricks[b.tricks.length - 1]);
  });

  it('final trick of a real game: drops interleave with the rotation and the hand ends cleanly', () => {
    const r = makeRules('aceDown');
    let st = realNewGame({ ...r, firstHandBidsItself: false, shotOut: false }, 'free-drop-final');
    let guard = 0;
    while (st.phase === 'bidding' && guard++ < 100) st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 3 });
    guard = 0;
    while (!(st.tricks.length === 12 && st.trick.plays.length === 0) && guard++ < 3000) {
      const seat = st.turn!;
      st = applyAction(st, { type: 'play', seat, card: legalPlays(st, seat)[0]! });
    }
    expect(st.tricks).toHaveLength(12);
    for (const s of liveSeats(st)) expect(st.hands[s]).toHaveLength(1);
    const leader = st.trick.leader;
    const others = [0, 1, 2, 3].filter((s) => s !== leader);
    // first non-leader drops before the lead; the pointer stays on the leader
    st = applyAction(st, { type: 'play', seat: others[0]!, card: st.hands[others[0]!]![0]! });
    expect(st.turn).toBe(leader);
    st = applyAction(st, { type: 'play', seat: leader, card: st.hands[leader]![0]! });
    st = applyAction(st, { type: 'play', seat: others[1]!, card: st.hands[others[1]!]![0]! });
    st = applyAction(st, { type: 'play', seat: others[2]!, card: st.hands[others[2]!]![0]! });
    expect(st.phase === 'handOver' || st.phase === 'gameOver').toBe(true);
    const done = st.tricks[st.tricks.length - 1]!;
    expect(done.plays.map((p) => p.seat)).toEqual([0, 1, 2, 3].map((k) => (leader + k) % 4));
  });
});
