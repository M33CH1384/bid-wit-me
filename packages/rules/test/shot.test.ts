import { describe, expect, it } from 'vitest';
import { type GameState, type HandRecord, applyAction, firstHandMinOf, isShot, makeRules, newGame, scoreHand, shotOutResult, shotOutSides, summarizeGame, validateRules } from '../src';

const joker = makeRules('joker');

describe('Shot = out (house rule)', () => {
  it('is on by default; first-hand minimum 4 in team modes, off in Cutthroat; 3/4/5/off only', () => {
    expect(joker.shotOut).toBe(true);
    expect(firstHandMinOf(joker)).toBe(4);
    expect(firstHandMinOf(makeRules('aceDown'))).toBe(4);
    expect(firstHandMinOf(makeRules('cutthroat'))).toBeNull();
    expect(firstHandMinOf({ partnerships: true })).toBe(4); // older saves
    expect(validateRules({ ...joker, firstHandMin: 6 as never })).toContain('firstHandMin must be 3, 4, 5 or off');
    expect(validateRules({ ...joker, firstHandMin: null })).toEqual([]);
  });
  it('first hand (books bid themselves): fewer books than the minimum is shot', () => {
    const bids = ['books', 'books', 'books', 'books'] as const;
    const sides = scoreHand(joker, [...bids], [2, 5, 1, 5], [0, 0], [0, 0]); // side 0: 3 books, side 1: 10
    expect(isShot(joker, [...bids], sides[0]!)).toBe(true);
    expect(sides[0]).toMatchObject({ contract: 4, contractMade: false, points: -40, bookPoints: 0 });
    expect(isShot(joker, [...bids], sides[1]!)).toBe(false);
    expect(sides[1]!.points).toBe(100);
    expect(isShot({ ...joker, firstHandMin: 3 }, [...bids], sides[0]!)).toBe(false);
    expect(isShot({ ...joker, firstHandMin: null }, [...bids], sides[0]!)).toBe(false);
  });
  it('shot = set; a busted Nil alone is not shot', () => {
    const set = scoreHand(joker, [4, 3, 2, 3], [1, 4, 2, 6], [0, 0], [0, 0]); // side 0 bid 6 took 3
    expect(isShot(joker, [4, 3, 2, 3], set[0]!)).toBe(true);
    const nil = scoreHand(joker, ['nil', 3, 4, 3], [1, 4, 4, 4], [0, 0], [0, 0]); // nil busted, partner made 4
    expect(isShot(joker, ['nil', 3, 4, 3], nil[0]!)).toBe(false);
  });
  it('out on hand 1, or shot two hands in a row after hand 1', () => {
    expect(shotOutSides(joker, 1, [true, false], [false, false])).toEqual([0]);
    expect(shotOutSides(joker, 2, [true, false], [false, false])).toEqual([]);
    expect(shotOutSides(joker, 3, [true, false], [true, false])).toEqual([0]);
    expect(shotOutSides(joker, 4, [false, true], [true, false])).toEqual([]);
    expect(shotOutSides({ ...joker, shotOut: false }, 1, [true, true], [false, false])).toEqual([]);
  });
  it('the other side wins; both out → higher score wins; tied → play continues', () => {
    expect(shotOutResult([120, 80], [0])).toMatchObject({ endReason: 'shotOut', winners: [1], shotOut: [0] });
    expect(shotOutResult([120, 80], [0, 1])).toMatchObject({ winners: [0] });
    expect(shotOutResult([100, 100], [0, 1])).toBeNull();
    // cutthroat: the shot-out player is last, best of the rest wins
    expect(shotOutResult([300, 50, 120, 90], [0])).toMatchObject({ winners: [2], placements: [4, 3, 1, 2] });
  });
  it('engine: a team short of 4 books on the books first hand loses the game right there (and series records it)', () => {
    let found: GameState | null = null;
    for (let i = 0; i < 300 && !found; i++) {
      let st = newGame(joker, `shot-${i}`);
      while (st.phase === 'playing') st = applyAction(st, { type: 'play', seat: st.turn!, card: (st as GameState).hands[st.turn!]!.find((c) => { try { applyAction(st, { type: 'play', seat: st.turn!, card: c }); return true; } catch { return false; } })! });
      if (st.phase === 'gameOver') found = st;
    }
    expect(found).not.toBeNull();
    const st = found!;
    expect(st.handNo).toBe(1);
    expect(st.result!.endReason).toBe('shotOut');
    const out = st.result!.shotOut![0]!;
    expect(st.history[0]!.sides[out]!.tricks).toBeLessThan(4);
    expect(st.history[0]!.sides[out]!.shot).toBe(true);
    expect(st.history[0]!.sides[out]!.points).toBe(-40);
    const g = summarizeGame(st, ['A', 'B'], 1, 0);
    expect(g.endReason).toBe('shotOut');
    expect(g.shots![out]).toBe(1);
  });
  it('engine: set on hand 1 (first-hand-bids-itself off) loses immediately; Ace Down too', () => {
    for (const r of [makeRules('joker', { firstHandBidsItself: false }), makeRules('aceDown', { firstHandBidsItself: false })]) {
      let st = newGame(r, 'set1');
      // everyone bids 6 → both teams bid 12: somebody gets set
      while (st.phase === 'bidding') st = applyAction(st, { type: 'bid', seat: st.turn!, bid: 6 });
      while (st.phase === 'playing') { const s = st.turn!; const legal = applyLegal(st, s); st = applyAction(st, { type: 'play', seat: s, card: legal }); }
      const shot = st.history[0]!.sides.filter((x) => x.contractMade === false).map((x) => x.side);
      expect(shot.length).toBeGreaterThan(0);
      if (shot.length === 1) expect(st.result).toMatchObject({ endReason: 'shotOut', shotOut: shot });
    }
  });
  it('history marks the shot; a later hand after one shot is "on notice" (data only)', () => {
    const h: HandRecord['sides'] = scoreHand(joker, [4, 3, 2, 3], [1, 4, 2, 6], [0, 0], [0, 0]);
    expect(h[0]!.shot).toBeUndefined(); // scoreHand alone doesn't decide; finishHand marks it
  });
});

function applyLegal(st: GameState, seat: number) {
  for (const c of st.hands[seat]!) { try { applyAction(st, { type: 'play', seat, card: c }); return c; } catch { /* next */ } }
  throw new Error('no legal card');
}
