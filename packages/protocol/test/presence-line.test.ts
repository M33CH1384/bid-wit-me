import { describe, expect, it } from 'vitest';
import { PRESENCE_STALE_MS, activityLabel, activityOf, isFriendActivity, joinPresence, parseSocialMsg, presenceLine, statusLabel } from '../src/index';

/**
 * Presence line dedupe (owner screenshot 2026-10-20): his own profile header
 * read "● Online — Online" because the headers joined a hardcoded "Online"
 * base with statusLabel(), which itself returns "Online" for a plain online
 * status. joinPresence drops a detail that just repeats the base.
 */
describe('joinPresence', () => {
  it('renders the base once when the detail repeats it', () => {
    expect(joinPresence('Online', 'Online')).toBe('Online');
  });

  it('dedupes case-insensitively and ignores surrounding whitespace', () => {
    expect(joinPresence('Online', 'online')).toBe('Online');
    expect(joinPresence('Online', '  Online  ')).toBe('Online');
    expect(joinPresence(' Away ', 'away')).toBe('Away');
  });

  it('joins differing parts with an em dash', () => {
    expect(joinPresence('Online', 'In a game')).toBe('Online — In a game');
    expect(joinPresence('Online', 'At a table · Joker')).toBe('Online — At a table · Joker');
  });

  it('renders the base alone when the detail is empty', () => {
    expect(joinPresence('Online', '')).toBe('Online');
    expect(joinPresence('Online', '   ')).toBe('Online');
  });
});

describe('presenceLine', () => {
  it('a plain online status reads just "Online" — never "Online — Online"', () => {
    expect(presenceLine({ kind: 'online' })).toBe('Online');
  });

  it('other statuses keep the joined form', () => {
    expect(presenceLine({ kind: 'lobby' })).toBe('Online — In lobby');
    expect(presenceLine({ kind: 'lobby', open: 2 })).toBe('Online — In lobby · 2 seats open');
    expect(presenceLine({ kind: 'tournament', name: 'Friday Cup' })).toBe('Online — In tournament · Friday Cup');
  });

  it('table status carries the mode name through the supplied mapper', () => {
    const modeName = (m: string) => (m === 'joker' ? 'Joker' : m);
    expect(presenceLine({ kind: 'table', mode: 'joker' }, modeName)).toBe('Online — At a table · Joker');
    expect(presenceLine({ kind: 'table', offline: true })).toBe('Online — At a table · vs bots');
  });
});

describe('friend activity (owner, 2026-10-22)', () => {
  it('activityOf maps every live status; story reads before kind', () => {
    expect(activityOf({ kind: 'online' })).toBe('online');
    expect(activityOf({ kind: 'lobby' })).toBe('online');
    expect(activityOf({ kind: 'table', offline: true })).toBe('bot-game');
    expect(activityOf({ kind: 'table', mode: 'joker', open: 1 })).toBe('online-match');
    expect(activityOf({ kind: 'tournament', name: 'Friday Night' })).toBe('online-match');
    // a story table is story mode, never a bot game — whatever the kind says
    expect(activityOf({ kind: 'table', offline: true, story: 'solo' })).toBe('story-solo');
    expect(activityOf({ kind: 'online', story: 'solo' })).toBe('story-solo');
    expect(activityOf({ kind: 'table', story: 'coop' })).toBe('story-coop');
    expect(activityOf({ kind: 'lobby', story: 'coop' })).toBe('story-coop');
  });

  it('activityLabel speaks the game’s language', () => {
    expect(activityLabel('online')).toBe('Online');
    expect(activityLabel('bot-game')).toBe('In a bot game');
    expect(activityLabel('online-match')).toBe('In a match');
    expect(activityLabel('story-solo')).toBe('Story mode · Solo');
    expect(activityLabel('story-coop')).toBe('Story mode · Co-op');
  });

  it('statusLabel names story surfaces instead of "At a table"', () => {
    expect(statusLabel({ kind: 'table', offline: true, story: 'solo' })).toBe('Story mode · Solo');
    expect(statusLabel({ kind: 'table', story: 'coop' })).toBe('Story mode · Co-op');
    expect(presenceLine({ kind: 'table', offline: true, story: 'solo' })).toBe('Online — Story mode · Solo');
    expect(presenceLine({ kind: 'lobby', story: 'coop' })).toBe('Online — Story mode · Co-op');
  });

  it('parseSocialMsg keeps only the two story values on a status', () => {
    const solo = parseSocialMsg({ t: 'status', status: { kind: 'table', offline: true, story: 'solo' } });
    expect(solo).toMatchObject({ t: 'status', status: { story: 'solo' } });
    const coop = parseSocialMsg({ t: 'status', status: { kind: 'lobby', story: 'coop' } });
    expect(coop).toMatchObject({ t: 'status', status: { story: 'coop' } });
    const bogus = parseSocialMsg({ t: 'status', status: { kind: 'online', story: 'everywhere' } });
    expect(bogus).toMatchObject({ t: 'status', status: { kind: 'online' } });
    expect(bogus && 'status' in bogus ? bogus.status.story : 'x').toBeUndefined();
  });

  it('isFriendActivity accepts exactly the owner’s five states; the stale window covers missed heartbeats', () => {
    for (const a of ['online', 'bot-game', 'online-match', 'story-solo', 'story-coop']) expect(isFriendActivity(a)).toBe(true);
    for (const a of ['offline', 'in-a-game', '', null, undefined, 42]) expect(isFriendActivity(a)).toBe(false);
    // reports land on change + a ~30 s heartbeat (+ the hub's ~60 s cadence):
    // the window must outlast two whole heartbeats with margin
    expect(PRESENCE_STALE_MS).toBeGreaterThan(2 * 30_000);
  });
});
