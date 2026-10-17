import { describe, expect, it } from 'vitest';
import { flyPlay, flyingCard } from '../src/online/playGuard';

describe('the just-played card belongs to its hand and trick', () => {
  const f = { card: '4C', handNo: 3, trickNo: 12 };
  it('shows while that trick is being played', () => {
    expect(flyingCard(f, 3, 'playing', 12)).toBe('4C');
  });
  it('a new deal resets it: the same card dealt again is in your hand, not on the table', () => {
    for (const phase of ['bidding', 'playing', 'handOver', 'dealing']) expect(flyingCard(f, 4, phase, 0)).toBeNull();
    const hand = ['4C', 'KS', '2H'];
    const shown = flyPlay(hand, [], flyingCard(f, 4, 'bidding', 0));
    expect(shown.card).toBeNull();
    expect(shown.hand).toEqual(hand);
  });
  it('clears once the trick moved on or the hand ended', () => {
    expect(flyingCard(f, 3, 'playing', 13)).toBeNull();
    expect(flyingCard(f, 3, 'handOver', 12)).toBeNull();
    expect(flyingCard(null, 3, 'playing', 12)).toBeNull();
  });
});
