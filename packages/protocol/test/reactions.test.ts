import { describe, expect, it } from 'vitest';
import { isReactionEmoji, parseClientMsg, parseSocialMsg, REACT_EMOJIS, REACT_PALETTE_EXTRA, REACTION_PALETTE, toggleReaction } from '../src/index';

describe('reactions on the wire', () => {
  it('table react messages validate (palette emoji only)', () => {
    expect(parseClientMsg({ t: 'react', id: 7, emoji: '🔥' })).toEqual({ t: 'react', id: 7, emoji: '🔥' });
    expect(parseClientMsg({ t: 'react', id: 7, emoji: '💩' })).toEqual({ t: 'react', id: 7, emoji: '💩' }); // palette extra: accepted
    expect(parseClientMsg({ t: 'react', id: 7, emoji: '🖕' })).toBeNull();   // not in the palette
    expect(parseClientMsg({ t: 'react', id: 7, emoji: 'x' })).toBeNull();
    expect(parseClientMsg({ t: 'react', id: 7, emoji: '👍👍' })).toBeNull();  // multi-emoji strings are not a single reaction
    expect(parseClientMsg({ t: 'react', id: 7, emoji: '👍🏽' })).toBeNull();  // skin-tone sequence is not a palette entry
    expect(parseClientMsg({ t: 'react', id: 0, emoji: '👍' })).toBeNull();   // bad line id
    expect(parseClientMsg({ t: 'react', id: 1.5, emoji: '👍' })).toBeNull();
    expect(parseClientMsg({ t: 'react', id: '7', emoji: '👍' })).toBeNull();
    expect(parseClientMsg({ t: 'react', emoji: '👍' })).toBeNull();
  });

  it('social react messages validate the same way', () => {
    expect(parseSocialMsg({ t: 'react', id: 3, emoji: '❤️' })).toEqual({ t: 'react', id: 3, emoji: '❤️' });
    expect(parseSocialMsg({ t: 'react', id: 3, emoji: '💯' })).toEqual({ t: 'react', id: 3, emoji: '💯' }); // palette extra
    expect(parseSocialMsg({ t: 'react', id: 3, emoji: '🖕' })).toBeNull();
    expect(parseSocialMsg({ t: 'react', id: 3, emoji: '🦄' })).toBeNull();   // a real emoji, but not in the palette
    expect(parseSocialMsg({ t: 'react', id: -1, emoji: '👍' })).toBeNull();
  });

  it('social dmReact messages validate the same way (own message type, D1 id namespace)', () => {
    expect(parseSocialMsg({ t: 'dmReact', id: 3, emoji: '❤️' })).toEqual({ t: 'dmReact', id: 3, emoji: '❤️' });
    expect(parseSocialMsg({ t: 'dmReact', id: 3, emoji: '🫡' })).toEqual({ t: 'dmReact', id: 3, emoji: '🫡' }); // palette extra
    expect(parseSocialMsg({ t: 'dmReact', id: 3, emoji: '🖕' })).toBeNull();
    expect(parseSocialMsg({ t: 'dmReact', id: 3, emoji: '😂🔥' })).toBeNull();
    expect(parseSocialMsg({ t: 'dmReact', id: -1, emoji: '👍' })).toBeNull();
    expect(parseSocialMsg({ t: 'dmReact', id: 0, emoji: '👍' })).toBeNull();
    expect(parseSocialMsg({ t: 'dmReact', id: 1.5, emoji: '👍' })).toBeNull();
    expect(parseSocialMsg({ t: 'dmReact', emoji: '👍' })).toBeNull();
  });

  it('the curated set is the six quick reactions', () => {
    expect([...REACT_EMOJIS]).toEqual(['👍', '❤️', '😂', '🔥', '👏', '😮']);
  });

  it('the palette is the six plus the extras, with no duplicates', () => {
    expect(REACTION_PALETTE.slice(0, REACT_EMOJIS.length)).toEqual([...REACT_EMOJIS]);
    expect([...REACTION_PALETTE.slice(REACT_EMOJIS.length)]).toEqual([...REACT_PALETTE_EXTRA]);
    expect(new Set(REACTION_PALETTE).size).toBe(REACTION_PALETTE.length);
    expect(REACT_PALETTE_EXTRA.length).toBe(30);
    expect(isReactionEmoji('👍')).toBe(true);
    expect(isReactionEmoji('💩')).toBe(true);
    expect(isReactionEmoji('🦄')).toBe(false);
    expect(isReactionEmoji('')).toBe(false);
    expect(isReactionEmoji('👍👍')).toBe(false);
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

  it('palette extras toggle exactly like the quick six', () => {
    let r = toggleReaction(undefined, '💯', 'u:1');
    expect(r).toEqual({ '💯': ['u:1'] });
    r = toggleReaction(r, '💯', 'u:2');
    expect(r).toEqual({ '💯': ['u:1', 'u:2'] });
    r = toggleReaction(r, '💯', 'u:1');                       // toggle off
    expect(r).toEqual({ '💯': ['u:2'] });
    r = toggleReaction(r, '💩', 'u:2');                       // …and mix with other palette emoji
    expect(r).toEqual({ '💯': ['u:2'], '💩': ['u:2'] });
  });

  it('drops empty slots and never mutates the input', () => {
    const before = { '👍': ['u:1'], '😂': [] };
    const after = toggleReaction(before, '👍', 'u:1');
    expect(after).toEqual({});
    expect(before).toEqual({ '👍': ['u:1'], '😂': [] });      // pre-existing empty slot untouched in the input
    expect(after).not.toBe(before);
  });

  it('non-palette emoji are ignored on add (and never crash a remove)', () => {
    expect(toggleReaction(undefined, '🖕', 'u:1')).toEqual({});
    expect(toggleReaction(undefined, '🦄', 'u:1')).toEqual({});
    expect(toggleReaction(undefined, '👍👍', 'u:1')).toEqual({});
    expect(toggleReaction({ '👍': ['u:1'] }, '🖕', 'u:1')).toEqual({ '👍': ['u:1'] });
  });
});
