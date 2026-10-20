import { describe, expect, it } from 'vitest';
import { parseClientMsg, parseSocialMsg, REACT_EMOJIS, toggleReaction } from '../src/index';

describe('reactions on the wire', () => {
  it('table react messages validate (fixed emoji set only)', () => {
    expect(parseClientMsg({ t: 'react', id: 7, emoji: '🔥' })).toEqual({ t: 'react', id: 7, emoji: '🔥' });
    expect(parseClientMsg({ t: 'react', id: 7, emoji: '💩' })).toBeNull();   // not in the set
    expect(parseClientMsg({ t: 'react', id: 7, emoji: 'x' })).toBeNull();
    expect(parseClientMsg({ t: 'react', id: 0, emoji: '👍' })).toBeNull();   // bad line id
    expect(parseClientMsg({ t: 'react', id: 1.5, emoji: '👍' })).toBeNull();
    expect(parseClientMsg({ t: 'react', id: '7', emoji: '👍' })).toBeNull();
    expect(parseClientMsg({ t: 'react', emoji: '👍' })).toBeNull();
  });

  it('social react messages validate the same way', () => {
    expect(parseSocialMsg({ t: 'react', id: 3, emoji: '❤️' })).toEqual({ t: 'react', id: 3, emoji: '❤️' });
    expect(parseSocialMsg({ t: 'react', id: 3, emoji: '🖕' })).toBeNull();
    expect(parseSocialMsg({ t: 'react', id: -1, emoji: '👍' })).toBeNull();
  });

  it('the curated set is the six quick reactions', () => {
    expect([...REACT_EMOJIS]).toEqual(['👍', '❤️', '😂', '🔥', '👏', '😮']);
  });
});

describe('toggleReaction', () => {
  it('adds, dedupes, and removes on toggle', () => {
    let r = toggleReaction(undefined, '👍', 'u:1');
    expect(r).toEqual({ '👍': ['u:1'] });
    r = toggleReaction(r, '👍', 'u:1');                       // same user again: no duplicate
    expect(r).toEqual({});
    r = toggleReaction(r, '👍', 'u:1');
    r = toggleReaction(r, '👍', 'u:2');                       // another user joins the chip
    expect(r).toEqual({ '👍': ['u:1', 'u:2'] });
    r = toggleReaction(r, '🔥', 'u:2');                       // a user can hold several emojis
    expect(r).toEqual({ '👍': ['u:1', 'u:2'], '🔥': ['u:2'] });
    r = toggleReaction(r, '👍', 'u:1');                       // one leaves the 👍 chip
    expect(r).toEqual({ '👍': ['u:2'], '🔥': ['u:2'] });
  });

  it('drops empty slots and never mutates the input', () => {
    const before = { '👍': ['u:1'], '😂': [] };
    const after = toggleReaction(before, '👍', 'u:1');
    expect(after).toEqual({});
    expect(before).toEqual({ '👍': ['u:1'], '😂': [] });      // pre-existing empty slot untouched in the input
    expect(after).not.toBe(before);
  });

  it('unknown emoji are ignored on add (and never crash a remove)', () => {
    expect(toggleReaction(undefined, '💩', 'u:1')).toEqual({});
    expect(toggleReaction({ '👍': ['u:1'] }, '💩', 'u:1')).toEqual({ '👍': ['u:1'] });
  });
});
