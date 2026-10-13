import { describe, expect, it } from 'vitest';
import { DEAL_LIFT_HAND, DEAL_LIFT_SEAT, dealArcPoint } from '../src/three/dealArc';
import { dealOrder } from '../src/three/dealTimeline';
import { texturesForRepaint } from '../src/three/cardTextures';

describe('deal ribbon', () => {
  const deck = { x: 0.4, y: 0.02, z: 1.1 };

  it('starts on the deck and lands in the fan', () => {
    const start = dealArcPoint(deck.x, deck.y, deck.z, -1.1, 0.45, 0.1, 0, DEAL_LIFT_SEAT, [0, 0, 0]);
    expect(start[0]).toBeCloseTo(deck.x);
    expect(start[1]).toBeCloseTo(deck.y);
    expect(start[2]).toBeCloseTo(deck.z);
    const end = dealArcPoint(deck.x, deck.y, deck.z, -1.1, 0.45, 0.1, 1, DEAL_LIFT_SEAT, [0, 0, 0]);
    expect(end[0]).toBeCloseTo(-1.1);
    expect(end[1]).toBeCloseTo(0.45);
    expect(end[2]).toBeCloseTo(0.1);
  });

  it('rises above the table and bows toward that seat', () => {
    const left = dealArcPoint(deck.x, deck.y, deck.z, -1.2, 0.4, 0.05, 0.5, DEAL_LIFT_SEAT, [0, 0, 0]);
    const right = dealArcPoint(deck.x, deck.y, deck.z, 1.2, 0.4, -0.05, 0.5, DEAL_LIFT_SEAT, [0, 0, 0]);
    const chordL = deck.x + (-1.2 - deck.x) * 0.5;
    const chordR = deck.x + (1.2 - deck.x) * 0.5;
    expect(left[1]).toBeGreaterThan(0.4);
    expect(right[1]).toBeGreaterThan(0.4);
    expect(left[0]).toBeLessThan(chordL);
    expect(right[0]).toBeGreaterThan(chordR);
    expect(left[0]).toBeLessThan(0);
    expect(right[0]).toBeGreaterThan(0);
  });

  it('gives your own cards a lower ribbon than the far seats', () => {
    expect(DEAL_LIFT_HAND).toBeGreaterThan(0.1);
    expect(DEAL_LIFT_HAND).toBeLessThan(DEAL_LIFT_SEAT);
  });
});

describe('deal order', () => {
  it('starts on the dealer\'s left and walks clockwise', () => {
    expect(dealOrder(4, 0, 1, 0)).toBe(0);
    expect(dealOrder(4, 0, 0, 0)).toBe(3);
    expect(dealOrder(4, 1, 1, 0)).toBe(4);
  });
});

describe('face repaints', () => {
  it('uploads only the canvas that changed', () => {
    const a = { image: {} };
    const b = { image: {} };
    const c = { image: a.image };
    expect(texturesForRepaint([a, b, c], a.image)).toEqual([a, c]);
    expect(texturesForRepaint([a, b], {})).toEqual([]);
  });
});
