/**
 * @vitest-environment happy-dom
 *
 * Story call-backs (web, 2026-10-21): the story save slot reports the open
 * story session to the server — 'open' when a match is saved (throttled:
 * the save fires on every state change), 'closed' when the slot clears
 * (finish / discard / stale drop) — so the seated characters can call the
 * player back to an unfinished game. Normal games never ping.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRules, newGame } from '@spades/rules';
import { clearStoryGame, loadStoryGame, saveStoryGame, type StorySavedGame } from '../src/story/storySave';
import { resetStorySessionPings } from '../src/story/storyApi';
import { saveGame } from '../src/save';
import { DEFAULT_SETTINGS } from '../src/settings';

interface SessionCall { state: string; stopId: string; track: string }
let sessionCalls: SessionCall[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

const mkSave = (stopId = 'porch'): StorySavedGame => {
  const st = newGame(makeRules('joker'), 'story-seed');
  return {
    v: 1, savedAt: 1, seed: 'story-seed', settings: DEFAULT_SETTINGS, state: st, chat: [],
    names: ['You', 'Uncle Ray', 'Dee', 'Pat'],
    story: {
      stopId, track: 'solo', attemptsAtStart: 1, clearsAtStart: 0,
      session: { fired: [], memory: [], satDown: true, railFired: 0, lastRailHand: 0 },
    },
  };
};

beforeEach(() => {
  sessionCalls = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === '/api/story/session') {
      sessionCalls.push(JSON.parse(String(init?.body)) as SessionCall);
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  resetStorySessionPings();
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('story session pings', () => {
  it('saving a story match reports the session open once, with stop + track', () => {
    const s = mkSave();
    saveStoryGame(s, s.story);
    expect(sessionCalls).toEqual([{ state: 'open', stopId: 'porch', track: 'solo', savedAt: expect.any(Number) }]);
  });

  it('throttles checkpoint saves: repeated saves of the same match do not re-ping', () => {
    const s = mkSave();
    saveStoryGame(s, s.story);
    saveStoryGame(s, s.story);
    saveStoryGame(s, s.story);
    expect(sessionCalls.length).toBe(1);
  });

  it('a save at a different stop pings immediately (the sitting changed)', () => {
    const a = mkSave('porch');
    saveStoryGame(a, a.story);
    const b = mkSave('barbershop');
    saveStoryGame(b, b.story);
    expect(sessionCalls.map((c) => `${c.state}:${c.stopId}`)).toEqual(['open:porch', 'open:barbershop']);
  });

  it('clearing the slot reports the session closed for the save that was in it', () => {
    const s = mkSave();
    saveStoryGame(s, s.story);
    clearStoryGame();
    expect(sessionCalls.map((c) => c.state)).toEqual(['open', 'closed']);
    expect(sessionCalls[1]).toMatchObject({ stopId: 'porch', track: 'solo' });
    expect(loadStoryGame()).toBeNull();
  });

  it('closing resets the throttle: the next sitting at the same stop pings open right away', () => {
    const s = mkSave();
    saveStoryGame(s, s.story);
    clearStoryGame();
    saveStoryGame(s, s.story);
    expect(sessionCalls.map((c) => c.state)).toEqual(['open', 'closed', 'open']);
  });

  it('clearing an empty slot pings nothing', () => {
    clearStoryGame();
    expect(sessionCalls).toEqual([]);
  });

  it('normal games never ping: the offline save slot is not a story session', () => {
    const st = newGame(makeRules('joker'), 'normal-seed');
    saveGame({ seed: 'normal-seed', settings: DEFAULT_SETTINGS, state: st, chat: [] });
    expect(sessionCalls).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failing network never breaks saving or clearing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const s = mkSave();
    expect(() => saveStoryGame(s, s.story)).not.toThrow();
    expect(loadStoryGame()?.story.stopId).toBe('porch');
    expect(() => clearStoryGame()).not.toThrow();
    // let the rejected ping settle so nothing leaks as an unhandled rejection
    await new Promise((r) => setTimeout(r, 0));
  });
});
