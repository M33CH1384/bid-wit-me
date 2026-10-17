import { describe, expect, it } from 'vitest';
import {
  applyAction, bidOptions, hostMinimum, isShot, makeRules, newGame, scoreHand, shotCovers, shotOutSides,
} from '../src';
import { fill, rigged } from './helpers';

const books = ['books', 'books', 'books', 'books'] as const;

describe('host minimum books / bid', () => {
  it('is the higher of the books setting and the bid setting, and 0 when both are off', () => {
    expect(hostMinimum(makeRules('joker'))).toBe(4);
    expect(hostMinimum(makeRules('aceDown'))).toBe(4);
    expect(hostMinimum(makeRules('joker', { firstHandMin: 3, minTeamBid: 5 }))).toBe(5);
    expect(hostMinimum(makeRules('joker', { firstHandMin: null, minTeamBid: 0 }))).toBe(0);
    expect(hostMinimum(makeRules('cutthroat'))).toBe(1);
    expect(hostMinimum(makeRules('cutthroat', { minTeamBid: 4 }))).toBe(4);
  });

  it('hand 1: took 3 with minimum 4 is a shot, scored as a set at 4, and an instant loss', () => {
    const r = makeRules('joker'); // minimum 4, table MX8H9
    const sides = scoreHand(r, [...books], [2, 5, 1, 5], [0, 0], [0, 0]); // side 0 took 3, side 1 took 10
    expect(sides[0]).toMatchObject({ tricks: 3, contract: 4, contractMade: false, contractPoints: -40, bookPoints: 0, points: -40 });
    expect(isShot(r, [...books], sides[0]!)).toBe(true);
    expect(sides[1]).toMatchObject({ tricks: 10, contractMade: null, bookPoints: 100, points: 100 });
    expect(isShot(r, [...books], sides[1]!)).toBe(false);
    expect(shotOutSides(r, 1, [true, false], [false, false])).toEqual([0]);
    expect(shotCovers(r, [{ handNo: 1, bids: [...books], sides }])[0]).toEqual({ tape: true, sheet: true, siren: true, outHand: 1 });
    expect(shotCovers(r, [{ handNo: 1, bids: [...books], sides }])[1]).toEqual({ tape: false, sheet: false, siren: false, outHand: null });
  });

  it('hand 1: meeting the minimum is safe and still scores 10 per book', () => {
    const r = makeRules('joker', { firstHandMin: 4 });
    const sides = scoreHand(r, [...books], [2, 2, 2, 7], [0, 0], [0, 0]); // 4 and 9
    expect(sides.map((s) => s.points)).toEqual([40, 90]);
    expect(sides.every((s) => s.contractMade === null)).toBe(true);
    expect(isShot(r, [...books], sides[0]!)).toBe(false);
    expect(shotOutSides(r, 1, [false, false], [false, false])).toEqual([]);
    expect(shotCovers(r, [{ handNo: 1, bids: [...books], sides }]).every((c) => !c.tape && !c.sheet)).toBe(true);
  });

  it('hand 2: bids must reach the minimum, and a set is a shot', () => {
    const r = makeRules('joker', { firstHandMin: 4, minTeamBid: 0, firstHandBidsItself: false });
    let st = rigged(r, fill(r, [[], [], [], []]));
    expect(bidOptions(st, 0).min).toBe(1); // partner has not bid, so they can cover
    st = applyAction(st, { type: 'bid', seat: 0, bid: 1 });
    expect(bidOptions(st, 2)).toMatchObject({ min: 3, blockReason: 'Minimum is 4' });
    expect(() => applyAction(st, { type: 'bid', seat: 2, bid: 2 })).toThrow(/Minimum is 4/);
    st = applyAction(st, { type: 'bid', seat: 2, bid: 3 });
    const set = scoreHand(r, [1, 4, 3, 4], [1, 4, 1, 7], [0, 0], [0, 0]); // side 0 bid 4, took 2
    expect(isShot(r, [1, 4, 3, 4], set[0]!)).toBe(true);
    expect(set[0]!.points).toBe(-40);
  });

  it('with no minimum, 2v2 Nil is offered and accepted in either order', () => {
    const r = makeRules('joker', { firstHandMin: null, minTeamBid: 0, firstHandBidsItself: false });
    expect(r.nil.allowed).toBe(true);
    expect(hostMinimum(r)).toBe(0);
    let st = rigged(r, fill(r, [[], [], [], []]), 3);
    expect(bidOptions(st, 0)).toMatchObject({ min: 1, nil: true, nilReason: null, blockReason: null });
    st = applyAction(st, { type: 'bid', seat: 0, bid: 'nil' });
    expect(st.bids[0]).toBe('nil');
    // No floor, and partners may both go Nil: the other seat is still offered Nil.
    expect(bidOptions(st, 2)).toMatchObject({ nil: true, nilReason: null });
    let other = rigged(r, fill(r, [[], [], [], []]), 1);
    other = applyAction(other, { type: 'bid', seat: 2, bid: 1 });
    expect(bidOptions(other, 0)).toMatchObject({ nil: true, nilReason: null, blockReason: null });
    expect(applyAction(other, { type: 'bid', seat: 0, bid: 'nil' }).bids[0]).toBe('nil');
  });

  it('2v2 Nil is allowed, but the partner bid alone must reach the minimum, in either order', () => {
    const r = makeRules('joker', { firstHandMin: 4, minTeamBid: 0, firstHandBidsItself: false });
    // Seat 0 bids first (dealer 3).
    let first = rigged(r, fill(r, [[], [], [], []]), 3);
    expect(bidOptions(first, 0)).toMatchObject({ min: 1, nil: true, nilReason: null, blockReason: null });
    first = applyAction(first, { type: 'bid', seat: 0, bid: 'nil' });
    expect(bidOptions(first, 2)).toMatchObject({
      min: 4, nil: false, blockReason: 'Partner bid Nil — you need 4', nilReason: "Can't Nil — partner bid Nil",
    });
    expect(() => applyAction(first, { type: 'bid', seat: 2, bid: 3 })).toThrow(/Partner bid Nil — you need 4/);
    expect(() => applyAction(first, { type: 'bid', seat: 2, bid: 'nil' })).toThrow(/Can't Nil — partner bid Nil/);
    expect(applyAction(first, { type: 'bid', seat: 2, bid: 4 }).bids[2]).toBe(4);

    // The other partner bids the low number first. Nil is then blocked.
    let low = rigged(r, fill(r, [[], [], [], []]), 3);
    low = applyAction(low, { type: 'bid', seat: 0, bid: 2 });
    expect(bidOptions(low, 2)).toMatchObject({ min: 2, nil: false, blockReason: 'Minimum is 4', nilReason: "Can't Nil — partner bid 2" });
    expect(() => applyAction(low, { type: 'bid', seat: 2, bid: 'nil' })).toThrow(/Can't Nil — partner bid 2/);

    // Reverse the partners: seat 2 bids first when the dealer is seat 1 (order 2, 0, 3, 1).
    let other = rigged(r, fill(r, [[], [], [], []]), 1);
    expect(other.turn).toBe(2);
    other = applyAction(other, { type: 'bid', seat: 2, bid: 'nil' });
    expect(bidOptions(other, 0)).toMatchObject({ min: 4, nil: false, blockReason: 'Partner bid Nil — you need 4' });
    other = rigged(r, fill(r, [[], [], [], []]), 1);
    other = applyAction(other, { type: 'bid', seat: 2, bid: 5 });
    expect(bidOptions(other, 0)).toMatchObject({ min: 1, nil: true, nilReason: null });
    expect(applyAction(other, { type: 'bid', seat: 0, bid: 'nil' }).bids[0]).toBe('nil');
  });

  it('a second shot while the tape is still on loses; making the books takes the tape off', () => {
    const r = makeRules('joker');
    const clear = scoreHand(r, [...books], [4, 4, 4, 1], [0, 0], [0, 0]);
    const setBids = [4, 5, 2, 3] as const;
    const set = scoreHand(r, [...setBids], [4, 1, 2, 2], [0, 0], [0, 0]); // side 1 bid 8, took 3
    const made = scoreHand(r, [3, 3, 3, 3], [3, 3, 3, 4], [0, 0], [0, 0]);
    const again = scoreHand(r, [3, 4, 3, 4], [4, 1, 3, 1], [0, 0], [0, 0]);
    const hands = (rows: { handNo: number; bids: readonly (number | 'books')[]; sides: typeof clear }[]) => rows;
    expect(shotCovers(r, hands([
      { handNo: 1, bids: [...books], sides: clear },
      { handNo: 2, bids: [...setBids], sides: set },
    ]))[1]).toEqual({ tape: true, sheet: false, siren: false, outHand: null });
    expect(shotOutSides(r, 2, [false, true], [false, false])).toEqual([]);
    expect(shotCovers(r, hands([
      { handNo: 1, bids: [...books], sides: clear },
      { handNo: 2, bids: [...setBids], sides: set },
      { handNo: 3, bids: [3, 3, 3, 3], sides: made },
    ]))[1]).toEqual({ tape: false, sheet: false, siren: false, outHand: null });
    expect(shotOutSides(r, 3, [false, true], [false, true])).toEqual([1]);
    expect(shotCovers(r, hands([
      { handNo: 1, bids: [...books], sides: clear },
      { handNo: 2, bids: [...setBids], sides: set },
      { handNo: 3, bids: [3, 4, 3, 4], sides: again },
    ]))[1]).toEqual({ tape: false, sheet: true, siren: true, outHand: 3 });
  });

  it('Cutthroat: Nil and Blind Nil are off, and each bid must reach the minimum', () => {
    const r = makeRules('cutthroat', { playerCount: 4, minTeamBid: 4, nil: { allowed: true }, blindNil: { allowed: true }, firstHandBidsItself: false });
    expect(r.nil.allowed).toBe(false);
    expect(r.blindNil.allowed).toBe(false);
    const st = newGame(r, 'ct-min');
    expect(bidOptions(st, st.turn!)).toMatchObject({ min: 4, nil: false, blindNil: false, blockReason: 'Minimum bid is 4' });
    expect(() => applyAction(st, { type: 'bid', seat: st.turn!, bid: 'nil' })).toThrow(/Nil is off in Cutthroat/);
    expect(() => applyAction(st, { type: 'bid', seat: st.turn!, bid: 'blindNil' })).toThrow(/Blind Nil is off in Cutthroat/);
    expect(() => applyAction(st, { type: 'bid', seat: st.turn!, bid: 3 })).toThrow(/Minimum bid is 4/);
    // Hand 1 with minimum 4: 3 books is a shot for that player.
    const books3 = ['books', 'books', 'books', 'books'] as const;
    const ct = makeRules('cutthroat', { minTeamBid: 4 });
    const sides = scoreHand(ct, [...books3], [3, 4, 4, 2], [0, 0, 0, 0], [0, 0, 0, 0]);
    expect(sides[0]).toMatchObject({ points: -40, contractMade: false });
    expect(isShot(ct, [...books3], sides[0]!)).toBe(true);
    expect(isShot(ct, [...books3], sides[1]!)).toBe(false);
    expect(shotOutSides(ct, 1, [true, false, false, false], [false, false, false, false])).toEqual([0]);
  });
});
