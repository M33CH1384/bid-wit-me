/**
 * Friend activity presence (owner, 2026-10-22): "Friends should be able to
 * see if a person is online playing a solo game, partner game, or story
 * mode (solo or co-op) when they look at the Friends tab."
 *
 * Pins the row composer (friendPresenceView): a live hub status speaks
 * first (in the game's language), then the persisted activity while it is
 * fresh (PRESENCE_STALE_MS), then the existing last-online line — whose
 * stamp is the max of the ref stamp, this session's remembered activity,
 * and the stale presence row's own time — and finally plain Offline. Plus
 * the wiring: StoryHome reports story-solo, the social store reports over
 * REST on a 30 s heartbeat, and an online room whose snapshot carries a
 * story descriptor reports story-coop.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PRESENCE_STALE_MS, type PresenceEntry } from '@spades/protocol';
import { friendPresenceView, friendStatusLabel, roomHasStory } from '../src/social/presence';

const now = 1_800_000_000_000;
const modeName = (m: string) => (m === 'joker' ? 'Joker Spades' : m);
const live = (status: PresenceEntry['status']): PresenceEntry => ({ id: 'u:x', name: 'X', status, at: now });

describe('friendPresenceView — live status speaks first', () => {
  it('story surfaces by name', () => {
    expect(friendPresenceView({}, live({ kind: 'table', offline: true, story: 'solo' }), 0, modeName, now))
      .toEqual({ label: 'Story mode · Solo', online: true });
    expect(friendPresenceView({}, live({ kind: 'table', story: 'coop' }), 0, modeName, now))
      .toEqual({ label: 'Story mode · Co-op', online: true });
  });
  it('a bot game is a bot game (not "at a table · vs bots")', () => {
    expect(friendPresenceView({}, live({ kind: 'table', mode: 'joker', offline: true }), 0, modeName, now))
      .toEqual({ label: 'In a bot game', online: true });
  });
  it('a live match keeps its mode; a tournament keeps its name', () => {
    expect(friendPresenceView({}, live({ kind: 'table', mode: 'joker', open: 1 }), 0, modeName, now))
      .toEqual({ label: 'In a match · Joker Spades', online: true });
    expect(friendPresenceView({}, live({ kind: 'table' }), 0, modeName, now))
      .toEqual({ label: 'In a match', online: true });
    expect(friendPresenceView({}, live({ kind: 'tournament', name: 'Friday Cup' }), 0, modeName, now))
      .toEqual({ label: 'In tournament · Friday Cup', online: true });
  });
  it('lobby keeps its detail; plain online is Online', () => {
    expect(friendPresenceView({}, live({ kind: 'lobby', open: 2 }), 0, modeName, now))
      .toEqual({ label: 'In lobby · 2 seats open', online: true });
    expect(friendPresenceView({}, live({ kind: 'online' }), 0, modeName, now))
      .toEqual({ label: 'Online', online: true });
  });
  it('live beats a fresh persisted activity', () => {
    const ref = { presence: { activity: 'story-coop' as const, at: now } };
    expect(friendPresenceView(ref, live({ kind: 'online' }), 0, modeName, now))
      .toEqual({ label: 'Online', online: true });
  });
});

describe('friendPresenceView — persisted activity, then last online', () => {
  it('a fresh persisted report renders its activity as online', () => {
    const ref = { presence: { activity: 'story-coop' as const, at: now - 60_000 } };
    expect(friendPresenceView(ref, undefined, 0, modeName, now)).toEqual({ label: 'Story mode · Co-op', online: true });
    const bot = { presence: { activity: 'bot-game' as const, at: now } };
    expect(friendPresenceView(bot, undefined, 0, modeName, now)).toEqual({ label: 'In a bot game', online: true });
  });
  it('the boundary is inclusive: exactly PRESENCE_STALE_MS old still counts', () => {
    const ref = { presence: { activity: 'online' as const, at: now - PRESENCE_STALE_MS } };
    expect(friendPresenceView(ref, undefined, 0, modeName, now)).toEqual({ label: 'Online', online: true });
  });
  it('a stale report falls back to last online, stamped by the report itself', () => {
    const at = now - (PRESENCE_STALE_MS + 50_000); // 200 s ago → "3m ago"
    const ref = { presence: { activity: 'story-solo' as const, at } };
    expect(friendPresenceView(ref, undefined, 0, modeName, now)).toEqual({ label: 'Last online 3m ago', online: false });
  });
  it('the freshest stamp wins among ref, session memory, and the stale report', () => {
    const stale = now - (PRESENCE_STALE_MS + 660_000); // 13.5 min ago
    const ref = { lastSeen: now - 12 * 60_000, presence: { activity: 'online' as const, at: stale } };
    expect(friendPresenceView(ref, undefined, now - 30_000, modeName, now).label).toBe('Last online just now');
    expect(friendPresenceView(ref, undefined, 0, modeName, now).label).toBe('Last online 12m ago');
    expect(friendPresenceView({ presence: { activity: 'online' as const, at: stale } }, undefined, 0, modeName, now).label).toBe('Last online 13m ago');
  });
  it('no stamps at all → plain Offline, no placeholder', () => {
    expect(friendPresenceView({}, undefined, 0, modeName, now)).toEqual({ label: 'Offline', online: false });
  });
});

describe('friendStatusLabel', () => {
  it('story wins over kind detail', () => {
    expect(friendStatusLabel({ kind: 'table', offline: true, story: 'solo' }, modeName)).toBe('Story mode · Solo');
    expect(friendStatusLabel({ kind: 'online', story: 'coop' }, modeName)).toBe('Story mode · Co-op');
  });
});

describe('roomHasStory (co-op spec §2.3)', () => {
  it('true only when the snapshot carries a story descriptor', () => {
    expect(roomHasStory(null)).toBe(false);
    expect(roomHasStory(undefined)).toBe(false);
    expect(roomHasStory({})).toBe(false);
    expect(roomHasStory({ story: undefined })).toBe(false);
    expect(roomHasStory({ story: { track: 'pair:ua:ub', stopId: 'porch', phase: 'game' } })).toBe(true);
  });
});

const social = readFileSync(new URL('../src/social/Social.tsx', import.meta.url), 'utf8');
const store = readFileSync(new URL('../src/social/store.ts', import.meta.url), 'utf8');
const storyHome = readFileSync(new URL('../src/story/StoryHome.tsx', import.meta.url), 'utf8');
const onlineApp = readFileSync(new URL('../src/online/OnlineApp.tsx', import.meta.url), 'utf8');

describe('wiring', () => {
  it('the Friends row renders the composed view', () => {
    expect(social).toContain('friendPresenceView(r, s.users[r.id], s.lastAt[r.id] ?? 0, modeName)');
    expect(social).toContain('{pv.online && <i className="soc-online" title="Online" />}{r.name}{muted && <i className="soc-tag muted" title="You muted this player (they don\'t know)">Muted</i>}<small>{pv.label}</small>');
  });
  it('the store reports presence over REST on change + a 30 s visibility-gated heartbeat', () => {
    expect(store).toContain("fetch('/api/social/presence'");
    expect(store).toContain('}, 30_000);');
    expect(store).toContain('state.settings.appearOffline');
  });
  it('StoryHome reports story-solo across its surfaces', () => {
    expect(storyHome).toContain("usePresence(screen.k === 'game' ? { kind: 'table', offline: true, story: 'solo' } : { kind: 'online', story: 'solo' });");
  });
  it('an online story room reports story-coop', () => {
    expect(onlineApp).toContain('roomHasStory(room0)');
    expect(onlineApp).toContain("story: 'coop'");
  });
});
