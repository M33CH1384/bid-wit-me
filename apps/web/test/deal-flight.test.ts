import { describe, expect, it } from 'vitest';
import type { Xform } from '../src/three/layout';
import { dealHoldReleased, handNeedsDeal, handOnFan, handSlotKey, openingFlight } from '../src/three/dealFlight';
import { dealTimeline, dealtSlotCount, seatDealDelay } from '../src/three/dealTimeline';

const deck: Xform = { p: [1, 2, 3], q: [0, 0, 0, 1], s: 1 };
const hand: Xform = { p: [0, 0, 4], q: [0, 0, 0, 1], s: 2 };

describe('opening deal flight', () => {
  it('keeps the mounted deck flight when a later render clears it before the first frame', () => {
    const mounted = { from: deck, delay: 1.4 };
    expect(openingFlight({ from: undefined, delay: 0 }, mounted, true)).toEqual({ from: deck, delay: 1.4 });
  });

  it('uses a live flight when one is still set', () => {
    expect(openingFlight({ from: deck, delay: 0.8 }, { from: hand, delay: 0 }, true)).toEqual({ from: deck, delay: 0.8 });
  });

  it('does not replay the deal delay once the card has already tweened', () => {
    expect(openingFlight({ from: undefined, delay: 0 }, { from: deck, delay: 1.4 }, false)).toEqual({ from: undefined, delay: 0 });
  });
});

describe('which hand cards are still being dealt', () => {
  it('deals a face-up card and a face-down slot until they have been shown', () => {
    expect(handSlotKey('AS', 0)).toBe('AS');
    expect(handSlotKey('', 2)).toBe('down-2');
    const seen = new Set<string>();
    expect(handNeedsDeal({ intro: true, flip: false, seen, slotKey: 'AS' })).toBe(true);
    expect(handNeedsDeal({ intro: true, flip: false, seen, slotKey: 'down-2' })).toBe(true);
    seen.add('AS');
    seen.add('down-2');
    expect(handNeedsDeal({ intro: true, flip: false, seen, slotKey: 'AS' })).toBe(false);
    expect(handNeedsDeal({ intro: true, flip: false, seen, slotKey: 'down-2' })).toBe(false);
  });

  it('draws every card in the current hand, and does not draw the queen twice', () => {
    const fan = handOnFan(['QS', '10S', 'QS', '8D', null]);
    expect(fan.map((slot) => slot.card)).toEqual(['QS', '10S', '8D', null]);
    expect(fan.every((slot) => slot.hidden === false)).toBe(true);
    expect(handOnFan<string>([]).length).toBe(0);
  });

  it('does not deal on a resume or on a Blind Nil flip', () => {
    const seen = new Set<string>();
    expect(handNeedsDeal({ intro: false, flip: false, seen, slotKey: 'AS' })).toBe(false);
    expect(handNeedsDeal({ intro: true, flip: true, seen, slotKey: 'AS' })).toBe(false);
  });
});

describe('cards dealt so far', () => {
  const tl = dealTimeline(1, 4);
  // Dealer is seat 3, so seat 0 is dealt first: delay is just the shuffle.
  const first = seatDealDelay(tl, 4, 0, 0, 3);

  it('waits out the shuffle, then reveals one card per round', () => {
    expect(first).toBeCloseTo(tl.shuffle);
    expect(dealtSlotCount(first - 0.01, tl, 4, 0, 3, 13)).toBe(0);
    expect(dealtSlotCount(first, tl, 4, 0, 3, 13)).toBe(1);
    expect(dealtSlotCount(first + 4 * tl.step - 0.001, tl, 4, 0, 3, 13)).toBe(1);
    expect(dealtSlotCount(first + 4 * tl.step, tl, 4, 0, 3, 13)).toBe(2);
  });

  it('does not deal the human first when someone else is on the dealer\'s left', () => {
    const mine = seatDealDelay(tl, 4, 0, 0, 0);
    const left = seatDealDelay(tl, 4, 0, 1, 0);
    expect(left).toBeCloseTo(tl.shuffle);
    expect(mine).toBeGreaterThan(left);
    expect(dealtSlotCount(left, tl, 4, 0, 0, 13)).toBe(0);
  });
});

describe('deal hold release', () => {
  it('releases a still-held card once the deal is over and its tween never started', () => {
    // Demetrius 2026-10-19: 4 cards visible at game start, refresh needed for the full hand.
    // The card mounted during the deal (held), the deal window expired (liveHold gone),
    // but the frame-clock tween never got it off the deck.
    expect(dealHoldReleased({ held: true, liveHold: false, started: false })).toBe(true);
  });

  it('keeps the hold while the deal is still running', () => {
    expect(dealHoldReleased({ held: true, liveHold: true, started: false })).toBe(false);
  });

  it('never re-holds a card whose tween already started', () => {
    expect(dealHoldReleased({ held: true, liveHold: false, started: true })).toBe(false);
  });

  it('is a no-op for a card that was never held', () => {
    expect(dealHoldReleased({ held: false, liveHold: false, started: false })).toBe(false);
  });
});
