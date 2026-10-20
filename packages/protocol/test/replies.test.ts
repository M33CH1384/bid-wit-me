import { describe, expect, it } from 'vitest';
import { dmReplySnapshot, parseSocialMsg, replySnapshot, SOCIAL_LIMITS, type SocialChatLine } from '../src/index';

describe('chat replies on the wire', () => {
  it('a chat message may carry a replyTo line id', () => {
    expect(parseSocialMsg({ t: 'chat', text: 'agreed' })).toEqual({ t: 'chat', text: 'agreed' });
    expect(parseSocialMsg({ t: 'chat', text: 'agreed', replyTo: 7 })).toEqual({ t: 'chat', text: 'agreed', replyTo: 7 });
  });

  it('a malformed replyTo drops the reference, never the message', () => {
    for (const bad of [0, -3, 1.5, '7', null, true, {}]) {
      expect(parseSocialMsg({ t: 'chat', text: 'hi', replyTo: bad })).toEqual({ t: 'chat', text: 'hi' });
    }
    // the message itself is still validated as before
    expect(parseSocialMsg({ t: 'chat', text: '', replyTo: 7 })).toBeNull();
    expect(parseSocialMsg({ t: 'chat', replyTo: 7 })).toBeNull();
  });

  it('replySnapshot captures the author and a snippet, truncated at the limit', () => {
    const line: SocialChatLine = { id: 42, from: 'u:ua', name: 'Alice', text: 'short', at: 1 };
    expect(replySnapshot(line)).toEqual({ id: 42, from: 'Alice', fromId: 'u:ua', text: 'short' });
    const long: SocialChatLine = { ...line, text: 'x'.repeat(300) };
    const snap = replySnapshot(long);
    expect(snap.text).toHaveLength(SOCIAL_LIMITS.replySnippet);
    expect(snap.text).toBe('x'.repeat(SOCIAL_LIMITS.replySnippet));
  });
});

describe('DM replies on the wire', () => {
  it('a DM may carry a replyTo line id', () => {
    expect(parseSocialMsg({ t: 'dm', to: 'u:ub', text: 'agreed' })).toEqual({ t: 'dm', to: 'u:ub', text: 'agreed' });
    expect(parseSocialMsg({ t: 'dm', to: 'u:ub', text: 'agreed', replyTo: 7 })).toEqual({ t: 'dm', to: 'u:ub', text: 'agreed', replyTo: 7 });
  });

  it('a malformed replyTo drops the reference, never the message', () => {
    for (const bad of [0, -3, 1.5, '7', null, true, {}]) {
      expect(parseSocialMsg({ t: 'dm', to: 'u:ub', text: 'hi', replyTo: bad })).toEqual({ t: 'dm', to: 'u:ub', text: 'hi' });
    }
    // the message itself is still validated as before
    expect(parseSocialMsg({ t: 'dm', to: 'u:ub', text: '', replyTo: 7 })).toBeNull();
    expect(parseSocialMsg({ t: 'dm', to: 'guest', text: 'hi', replyTo: 7 })).toBeNull();
  });

  it('dmReplySnapshot matches replySnapshot semantics (hub supplies the author name)', () => {
    expect(dmReplySnapshot({ id: 9, from: 'u:ua', text: 'short' }, 'Alice')).toEqual({ id: 9, from: 'Alice', fromId: 'u:ua', text: 'short' });
    const snap = dmReplySnapshot({ id: 9, from: 'u:ua', text: 'y'.repeat(300) }, 'Alice');
    expect(snap.text).toHaveLength(SOCIAL_LIMITS.replySnippet);
    expect(snap.text).toBe('y'.repeat(SOCIAL_LIMITS.replySnippet));
  });
});
