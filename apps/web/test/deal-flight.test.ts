import { describe, expect, it } from 'vitest';
import type { Xform } from '../src/three/layout';
import { handNeedsDeal, handSlotKey, openingFlight } from '../src/three/dealFlight';

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

  it('does not deal on a resume or on a Blind Nil flip', () => {
    const seen = new Set<string>();
    expect(handNeedsDeal({ intro: false, flip: false, seen, slotKey: 'AS' })).toBe(false);
    expect(handNeedsDeal({ intro: true, flip: true, seen, slotKey: 'AS' })).toBe(false);
  });
});
