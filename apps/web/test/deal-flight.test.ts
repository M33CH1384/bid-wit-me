import { describe, expect, it } from 'vitest';
import type { Xform } from '../src/three/layout';
import { FIRST_FRAME_FALLBACK_MS, dealGateOpen, dealHoldStale, handNeedsDeal, handOnFan, handSlotKey, openingFlight } from '../src/three/dealFlight';
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

describe('deal hold staleness', () => {
  // Supersedes the 2026-10-19 'deal hold release' block. Same intent — a card the deal
  // held must be shown once the deal is over — with a stronger contract: the predicate
  // takes no tween state at all. The old `started` gate is precisely what the
  // 2026-10-24 recurrence poisoned (see the lift-settle case below), so the case the
  // old suite pinned as "never release" is now the case that MUST release.
  it('releases a still-held card once the live prop stops holding it', () => {
    // Demetrius 2026-10-19: 4 cards visible at game start, refresh needed for the full hand.
    // The card mounted during the deal (held), the deal window expired (liveHold gone),
    // but the frame-clock tween never got it off the deck.
    expect(dealHoldStale({ held: true, liveHold: false })).toBe(true);
  });

  it('releases even when the tween was marked started while the card was still hidden', () => {
    // Demetrius 2026-10-24: online game start, cards invisible until the app was
    // reopened. The render that closed the deal window re-rendered the still-waiting
    // card with its settled 'lift' motion; the lift settle marked the tween started
    // while snapping the hidden card into its fan slot, and the old predicate read
    // that flag and refused to release for the rest of the hand. There is no way to
    // pass a tween state into the predicate now — that refusal cannot be rebuilt.
    expect(dealHoldStale({ held: true, liveHold: false })).toBe(true);
  });

  it('keeps the hold while the deal is still running', () => {
    expect(dealHoldStale({ held: true, liveHold: true })).toBe(false);
  });

  it('is a no-op for a card that was never held', () => {
    expect(dealHoldStale({ held: false, liveHold: false })).toBe(false);
    expect(dealHoldStale({ held: false, liveHold: true })).toBe(false);
  });
});

describe('deal gate waits for the scene first rendered frame', () => {
  // Demetrius 2026-10-19 (polish): on a heavy first load the deal window expired behind
  // WebGL/shader compile, so cards appeared instead of flying. The gate holds the intro
  // until the canvas has presented a frame — and never holds it forever.
  const at = { mountedAt: 10_000 };

  it('stays shut while the loader is up or the table is not ready, even with a frame', () => {
    expect(dealGateOpen({ tableReady: false, loading: false, firstFrame: true, ...at, now: 10_000 })).toBe(false);
    expect(dealGateOpen({ tableReady: true, loading: true, firstFrame: true, ...at, now: 10_000 })).toBe(false);
  });

  it('opens once the table is up and the scene has presented a frame', () => {
    expect(dealGateOpen({ tableReady: true, loading: false, firstFrame: true, ...at, now: 10_001 })).toBe(true);
  });

  it('stays shut before the fallback when no frame has rendered', () => {
    expect(dealGateOpen({ tableReady: true, loading: false, firstFrame: false, ...at, now: 10_000 + FIRST_FRAME_FALLBACK_MS - 1 })).toBe(false);
  });

  it('lifts at the fallback even if the canvas never renders, so the deal is never held forever', () => {
    expect(dealGateOpen({ tableReady: true, loading: false, firstFrame: false, ...at, now: 10_000 + FIRST_FRAME_FALLBACK_MS })).toBe(true);
    expect(dealGateOpen({ tableReady: true, loading: false, firstFrame: false, ...at, now: 10_000 + FIRST_FRAME_FALLBACK_MS + 5_000 })).toBe(true);
  });
});
