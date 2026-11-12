import { describe, expect, it } from 'vitest';
import { makeRules, type Bid, type SideHandResult } from '@spades/rules';
import { holeSmoking } from '../src/shotMarks';

/**
 * Which bullet holes smoke (owner, 2026-11-12): the first hole is a warning
 * that goes cold once the side comes through a hand unshot; the second and
 * third never go out.
 */
const r = makeRules('joker');
const bids = [3, 3, 3, 3] as unknown as Bid[];
const hand = (shot0: boolean, shot1 = false) => ({
  bids,
  sides: [
    { side: 0, seats: [0, 2], contract: 6, contractTricks: shot0 ? 4 : 6, tricks: shot0 ? 4 : 6, contractMade: !shot0, nils: [] } as unknown as SideHandResult,
    { side: 1, seats: [1, 3], contract: 6, contractTricks: shot1 ? 4 : 6, tricks: shot1 ? 4 : 6, contractMade: !shot1, nils: [] } as unknown as SideHandResult,
  ],
});

describe('holeSmoking', () => {
  it('no holes, no smoke', () => {
    expect(holeSmoking(r, [hand(false)])[0]).toEqual([false, false, false]);
  });
  it('the first hole smokes from the shot…', () => {
    expect(holeSmoking(r, [hand(false), hand(true)])[0]).toEqual([true, false, false]);
  });
  it('…and goes cold once the side comes through a hand unshot', () => {
    expect(holeSmoking(r, [hand(true), hand(false)])[0]).toEqual([false, false, false]);
  });
  it('a second shot smokes for good, even after made hands; the cold first hole stays cold', () => {
    const h = [hand(true), hand(false), hand(true), hand(false), hand(false)];
    expect(holeSmoking(r, h)[0]).toEqual([false, true, false]);
  });
  it('shot twice running: both smoke until a clean hand cools only the first', () => {
    expect(holeSmoking(r, [hand(true), hand(true)])[0]).toEqual([true, true, false]);
    expect(holeSmoking(r, [hand(true), hand(true), hand(false)])[0]).toEqual([false, true, false]);
  });
  it('sides are independent', () => {
    const s = holeSmoking(r, [hand(true, false), hand(false, true)]);
    expect(s[0]).toEqual([false, false, false]);
    expect(s[1]).toEqual([true, false, false]);
  });
});
