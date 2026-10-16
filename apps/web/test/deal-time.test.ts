import { describe, expect, it } from 'vitest';
import { dealClockArmed, dealHeld, handDealsIn } from '../src/three/dealFlight';
import { fanMotion } from '../src/three/handLift';
import { actingSeat } from '../src/turnState';

describe('fresh deal', () => {
  it('holds the intro hand until the table is up (empty hand first)', () => {
    expect(dealHeld({ intro: true, dealReady: false })).toBe(true);
    expect(dealHeld({ intro: true, dealReady: true })).toBe(false);
  });
  it('flies your cards in from the deck while the deal runs', () => {
    expect(handDealsIn({ intro: true, dealing: true, flip: false })).toBe(true);
    expect(fanMotion({ flip: false, fresh: true, closing: false }).kind).toBe('deal');
  });
  it('does not start the deal clock behind the loader', () => {
    expect(dealClockArmed(1, false)).toBe(false);
    expect(dealClockArmed(1, true)).toBe(true);
  });
  it('no turn while dealing', () => {
    expect(actingSeat({ turn: 0, phase: 'playing', pause: false, dealing: true, locked: false, covered: false } as Parameters<typeof actingSeat>[0])).toBe(null);
  });
});

describe('resumed hand', () => {
  it('is drawn at once, never held or re-dealt', () => {
    expect(dealHeld({ intro: false, dealReady: false })).toBe(false);
    expect(handDealsIn({ intro: false, dealing: false, flip: false })).toBe(false);
    expect(dealClockArmed(null, true)).toBe(false);
  });
});

describe('hand 2', () => {
  it('animates like hand 1 (every later hand is an intro hand)', () => {
    expect(handDealsIn({ intro: true, dealing: true, flip: false })).toBe(true);
  });
  it('a Blind Nil reveal flips in place instead of a second deal', () => {
    expect(handDealsIn({ intro: true, dealing: true, flip: true })).toBe(false);
  });
});
