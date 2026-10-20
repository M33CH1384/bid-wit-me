import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearTableChatOpen, loadTableChatOpen, saveTableChatOpen } from '../src/chatView';

const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

describe('table chat open persistence (session-scoped)', () => {
  beforeEach(() => store.clear());
  it('falls back to the default when nothing is saved', () => {
    expect(loadTableChatOpen(true, fakeStorage)).toBe(true);
    expect(loadTableChatOpen(false, fakeStorage)).toBe(false);
  });
  it('round-trips the flag', () => {
    saveTableChatOpen(true, fakeStorage);
    expect(loadTableChatOpen(false, fakeStorage)).toBe(true);
    saveTableChatOpen(false, fakeStorage);
    expect(loadTableChatOpen(true, fakeStorage)).toBe(false);
  });
  it('clear() restores the fallback', () => {
    saveTableChatOpen(true, fakeStorage);
    clearTableChatOpen(fakeStorage);
    expect(loadTableChatOpen(false, fakeStorage)).toBe(false);
  });
  it('anything but "1" reads closed', () => {
    fakeStorage.setItem('bwm.tablechat.open', 'maybe');
    expect(loadTableChatOpen(true, fakeStorage)).toBe(false);
  });
});

describe('social chat view persistence (session-scoped)', () => {
  beforeEach(() => {
    store.clear();
    vi.resetModules();
    vi.stubGlobal('localStorage', fakeStorage);
    vi.stubGlobal('sessionStorage', fakeStorage);
  });

  it('serializes and parses the view, rejecting junk', async () => {
    const { parseSocialView, serializeSocialView } = await import('../src/social/store');
    const v = { open: true, tab: 'messages' as const, dmWith: 'u:abc', names: { 'u:abc': 'LovleyT714' } };
    expect(parseSocialView(serializeSocialView(v))).toEqual(v);
    expect(parseSocialView(null)).toEqual({});
    expect(parseSocialView('not-json')).toEqual({});
    expect(parseSocialView('{"open":"yes","tab":"nope","dmWith":7}')).toEqual({});
    expect(parseSocialView('{"open":true,"tab":"chat","names":{"u:1":"A","u:2":5}}')).toEqual({
      open: true, tab: 'chat', names: { 'u:1': 'A' },
    });
  });

  it('starts with the default view when nothing was saved', async () => {
    const { social } = await import('../src/social/store');
    const s = social.get();
    expect(s.open).toBe(false);
    expect(s.tab).toBe('players');
    expect(s.dmWith).toBeNull();
  });

  it('hydrates the open panel, tab and DM thread from the saved view', async () => {
    fakeStorage.setItem('bwm.social.view', JSON.stringify({
      open: true, tab: 'messages', dmWith: 'u:abc', names: { 'u:abc': 'LovleyT714' },
    }));
    const { social } = await import('../src/social/store');
    const s = social.get();
    expect(s.open).toBe(true);
    expect(s.tab).toBe('messages');
    expect(s.dmWith).toBe('u:abc');
    expect(s.names['u:abc']).toBe('LovleyT714');
  });

  it('persists chat-view changes through the real store mutations', async () => {
    const { social } = await import('../src/social/store');
    const saved = () => JSON.parse(fakeStorage.getItem('bwm.social.view') ?? '{}') as Record<string, unknown>;
    social.tab('chat');
    expect(saved().tab).toBe('chat');
    social.openDm('u:abc');
    expect(saved().dmWith).toBe('u:abc');
    expect(saved().tab).toBe('messages');
    social.close();
    expect(saved().open).toBe(false);
  });
});
