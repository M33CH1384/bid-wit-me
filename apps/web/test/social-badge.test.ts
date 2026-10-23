import { describe, expect, it } from 'vitest';
import type { SocialChatLine } from '@spades/protocol';
import { badgeCount, isMuted, unseenMentions, type SocialState } from '../src/social/store';

const line = (id: number, from: string, mentions?: string[]): SocialChatLine => ({
  id, from, name: from, text: `line ${id}`, at: id, ...(mentions ? { mentions } : {}),
});

function state(p: Partial<SocialState>): SocialState {
  return {
    status: 'open', you: { id: 'u:me', name: 'Me', guest: false, status: { kind: 'online' } }, admin: false,
    users: {}, global: [], friends: null, settings: null, unread: {}, dms: {}, names: {}, invites: [], sent: {},
    toasts: [], open: false, tab: 'players', dmWith: null, profile: null, profileId: null, globalSeen: 0,
    mentionSeen: 0, myTable: null, notices: [], tour: null, wager: null, wagerCreate: null, tables: {}, ended: {}, lastAt: {},
    ...p,
  } as SocialState;
}

describe('unseenMentions', () => {
  const global = [line(1, 'u:a', ['u:me']), line(2, 'u:a'), line(3, 'u:b', ['u:me']), line(4, 'u:me', ['u:me']), line(5, 'u:b', ['u:other'])];
  it('counts only lines past the tracker that tag me and are not mine', () => {
    expect(unseenMentions(state({ global, mentionSeen: 0 }))).toBe(2); // lines 1 and 3
    expect(unseenMentions(state({ global, mentionSeen: 1 }))).toBe(1); // line 3
    expect(unseenMentions(state({ global, mentionSeen: 5 }))).toBe(0);
  });
  it('is zero when signed out (no you)', () => {
    expect(unseenMentions(state({ global, you: null }))).toBe(0);
  });
});

describe('badgeCount', () => {
  it('sums DM unread + friend requests + invites + unseen mentions', () => {
    const s = state({
      global: [line(7, 'u:a', ['u:me'])],
      mentionSeen: 0,
      unread: { 'u:a': 2, 'u:b': 1 },
      friends: { friends: [], incoming: [{ id: 'u:c', name: 'Cee' }], outgoing: [], blocked: [], muted: [] },
      invites: [{ id: 'i1', from: 'u:a', fromName: 'A', code: 'ABCD', expiresAt: 1 }],
    });
    expect(badgeCount(s)).toBe(3 + 1 + 1 + 1);
  });
  it('a muted sender contributes nothing: their unread is already zero server-side, and isMuted reads the owner state', () => {
    const s = state({ friends: { friends: [], incoming: [], outgoing: [], blocked: [], muted: [{ id: 'u:a', name: 'A' }] } });
    expect(isMuted(s, 'u:a')).toBe(true);
    expect(isMuted(s, 'u:b')).toBe(false);
    expect(isMuted(state({ friends: null }), 'u:a')).toBe(false);
  });
});
