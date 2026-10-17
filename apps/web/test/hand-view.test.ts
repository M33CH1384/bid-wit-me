import { describe, expect, it } from 'vitest';
import { effectiveView, handStarted, initialHandView, userToggledView } from '../src/handView';

describe('seated at the start of every hand', () => {
  it('first hand seen: the saved preference decides (a saved Standing is not fought)', () => {
    const s = handStarted(initialHandView, 1);
    expect(effectiveView('standing', s)).toBe('standing');
    expect(effectiveView('sitting', s)).toBe('sitting');
  });
  it('a resumed table mid-match: the first hand seen still uses the saved preference', () => {
    const s = handStarted(initialHandView, 7);
    expect(effectiveView('standing', s)).toBe('standing');
  });
  it('every new hand seats the player again, even with Standing saved', () => {
    let s = handStarted(initialHandView, 1);
    s = handStarted(s, 2);
    expect(effectiveView('standing', s)).toBe('sitting');
    s = handStarted(s, 3);
    expect(effectiveView('standing', s)).toBe('sitting');
  });
  it('re-observing the same hand changes nothing', () => {
    let s = handStarted(initialHandView, 1);
    s = handStarted(s, 2);
    expect(handStarted(s, 2)).toBe(s);
  });
  it('a manual toggle to Standing rules until the hand ends, then the next hand seats again', () => {
    let s = handStarted(initialHandView, 1);
    s = handStarted(s, 2); // auto-seated
    expect(effectiveView('standing', s)).toBe('sitting');
    s = userToggledView(s); // player stands up mid-hand; App also saves 'standing'
    expect(effectiveView('standing', s)).toBe('standing');
    s = handStarted(s, 2); // same hand: still standing
    expect(effectiveView('standing', s)).toBe('standing');
    s = handStarted(s, 3); // new hand: seated again
    expect(effectiveView('standing', s)).toBe('sitting');
  });
  it('toggling when not auto-seated is a no-op (normal saved-preference behaviour)', () => {
    const s = handStarted(initialHandView, 1);
    expect(userToggledView(s)).toBe(s);
    expect(effectiveView('sitting', userToggledView(s))).toBe('sitting');
  });
});
