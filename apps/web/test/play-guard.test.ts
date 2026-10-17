import { describe, expect, it } from 'vitest';
import { flyPlay, ignorePlayTap, playSendBlocked, playTrickOf } from '../src/online/playGuard';

const trick = { handNo: 1, tricks: [] as unknown[], trick: { plays: [] as unknown[] }, turn: 0 as number | null };

describe('play tap guard', () => {
  it('ignores another play tap until the trick the play was sent from moves', () => {
    const held = playTrickOf(trick);
    expect(ignorePlayTap(held, held)).toBe(true);
    expect(ignorePlayTap(null, held)).toBe(false);
    expect(ignorePlayTap(held, playTrickOf({ ...trick, trick: { plays: ['AS'] } }))).toBe(false);
    expect(ignorePlayTap(held, playTrickOf({ ...trick, turn: 1 }))).toBe(false);
    expect(ignorePlayTap(held, playTrickOf({ ...trick, tricks: [{}], handNo: 1 }))).toBe(false);
    expect(ignorePlayTap(held, playTrickOf({ ...trick, handNo: 2 }))).toBe(false);
  });

  it('lifts the chosen card out of the hand before the server answers', () => {
    expect(flyPlay(['AS', 'KS'], [], 'KS')).toEqual({ hand: ['AS'], card: 'KS' });
    expect(flyPlay(['AS'], [{ card: 'KS' }], 'KS')).toEqual({ hand: ['AS'], card: null });
    expect(flyPlay(['AS', 'KS'], [], null)).toEqual({ hand: ['AS', 'KS'], card: null });
    expect(flyPlay(null, [], 'KS')).toEqual({ hand: null, card: null });
  });

  it('blocks a second play send until the server seq advances', () => {
    expect(playSendBlocked(null, 4)).toBe(false);
    expect(playSendBlocked(4, 4)).toBe(true);
    expect(playSendBlocked(4, 3)).toBe(true);
    expect(playSendBlocked(4, 5)).toBe(false);
  });
});
