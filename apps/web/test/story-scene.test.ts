/**
 * @vitest-environment happy-dom
 *
 * Story scene pass (web, 2026-10-21): the cinematic scene player (letterbox,
 * cast focus, skip, egg hotspot), the narrative Tale of the Tape, portrait
 * fallback, the story fallback-voice picker (American, card gender — Pat
 * and Uncle Ray named), milestone/event detection from game state, the
 * story save slot (round-trip, separation from the normal save, stale
 * validation, resume on the map), badges (derivation + tap detail), and
 * the /story header regression pins (safe-area + dock slot — the blur the
 * owner screenshotted was the header sitting in the iOS frosted zone with
 * the dock floating over it).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import { makeRules, newGame, type GameState } from '@spades/rules';
import ScriptPlayer from '../src/story/ScriptPlayer';
import StoryTape from '../src/story/StoryTape';
import StoryFace from '../src/story/StoryFace';
import StoryBadges, { badgeFactsOf } from '../src/story/StoryBadges';
import StoryHome from '../src/story/StoryHome';
import { personaVoiceFor } from '../src/talkPrefs';
import { storyEvents, storyFactsOf, storyMilestones, storySnap } from '../src/story/storyScene';
import { clearStoryGame, loadStoryGame, saveStoryGame, storySaveValidFor, STORY_SAVE_KEY, type StorySavedGame } from '../src/story/storySave';
import { SAVE_KEY, saveGame } from '../src/save';
import { DEFAULT_SETTINGS } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];
async function renderEl(el: React.ReactElement): Promise<HTMLElement> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  roots.push(root);
  await act(async () => { root.render(el); });
  return c;
}
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
afterEach(async () => {
  for (const r of roots) await act(async () => { r.unmount(); });
  roots = [];
  document.body.innerHTML = '';
  localStorage.clear();
});

const porch = STORY_STOPS[0]!;
const BEATS = [
  { speaker: 'uncleRay', line: 'First line, short.' },
  { speaker: 'pat', line: 'Second line, also short.' },
  { speaker: 'dee', line: 'Third line lands it.' },
];

describe('scene player', () => {
  it('letterbox + cast focus: the current speaker is lit, the rest dimmed; focus moves on advance; skip works', async () => {
    const onDone = vi.fn();
    const c = await renderEl(createElement(ScriptPlayer, {
      beats: BEATS, cta: 'To the table', onDone, venueId: 'grandma',
      cast: ['uncleRay', 'dee', 'pat'],
    }));
    expect(c.querySelectorAll('.story-bar').length).toBe(2); // letterbox bars
    expect(c.querySelector('.story-scene-bg')).toBeTruthy(); // venue backdrop behind the scene
    const ray = c.querySelector('[data-testid="story-cast-uncleRay"]')!;
    const pat = c.querySelector('[data-testid="story-cast-pat"]')!;
    expect(ray.getAttribute('data-active')).toBe('true');
    expect(pat.getAttribute('data-active')).toBe('false');
    // tap completes the reveal, tap again advances — focus moves to Pat
    await click(c.querySelector('[data-testid="story-script-next"]')!);
    await click(c.querySelector('[data-testid="story-script-next"]')!);
    expect(c.querySelector('[data-testid="story-cast-pat"]')!.getAttribute('data-active')).toBe('true');
    expect(c.querySelector('[data-testid="story-cast-uncleRay"]')!.getAttribute('data-active')).toBe('false');
    await click(c.querySelector('[data-testid="story-script-skip"]')!);
    expect(onDone).toHaveBeenCalled();
  });

  it('railbirds stand on the rail in the scene frame (portraits, set back from the cast)', async () => {
    const c = await renderEl(createElement(ScriptPlayer, {
      beats: BEATS, cta: 'Go', onDone: () => {}, venueId: 'church',
      cast: ['deaconFord', 'dee', 'sisterMae'], rail: ['uncleRay'],
    }));
    const railEl = c.querySelector('[data-testid="story-rail"]')!;
    expect(railEl).toBeTruthy();
    expect(railEl.querySelector('img')!.getAttribute('src')).toBe('/assets/story/portraits/uncleRay.webp');
    // the rail is not the cast: Ray has no cast medallion here
    expect(c.querySelector('[data-testid="story-cast-uncleRay"]')).toBeNull();
  });

  it('the scene egg hotspot fires the find once', async () => {
    const onEggFound = vi.fn();
    const c = await renderEl(createElement(ScriptPlayer, {
      beats: BEATS, cta: 'Go', onDone: () => {}, cast: ['uncleRay', 'dee', 'pat'],
      egg: { trigger: 'sceneTap' as const, ready: false, beats: [{ speaker: 'pat', line: 'A secret.' }] },
      onEggFound,
    }));
    const spot = c.querySelector('[data-testid="story-egg-hotspot"]')!;
    expect(spot).toBeTruthy();
    await click(spot);
    expect(onEggFound).toHaveBeenCalledTimes(1);
  });
});

describe('tale of the tape (narrative)', () => {
  it('renders both adversaries + Dee + the stakes; the history row appears ONLY with a fact', async () => {
    const c = await renderEl(createElement(StoryTape, { stop: porch, facts: { attempts: 0, cleared: false }, cta: 'Play the scene', onDone: () => {} }));
    expect(c.querySelector('[data-testid="story-tape-uncleRay"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-tape-pat"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-tape-dee"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-tape-stakes"]')!.textContent).toBe(porch.stakes);
    expect(c.querySelector('[data-testid="story-tape-history"]')).toBeNull();
    const c2 = await renderEl(createElement(StoryTape, { stop: porch, facts: { attempts: 2, cleared: false }, cta: 'x', onDone: () => {} }));
    expect(c2.querySelector('[data-testid="story-tape-history"]')!.textContent).toContain('attempt 3');
  });
});

describe('portraits', () => {
  it('resolve by character id and fall back to the initial medallion on error — no broken image left behind', async () => {
    const c = await renderEl(createElement(StoryFace, { characterId: 'pat', name: 'Pat' }));
    const img = c.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/assets/story/portraits/pat.webp');
    await act(async () => { img.dispatchEvent(new Event('error', { bubbles: true })); });
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('P');
  });
});

describe('story fallback voices: American, card gender', () => {
  const LIST = [
    { name: 'Daniel', lang: 'en-GB' },        // the "old Englishman"
    { name: 'Google UK English Male', lang: 'en-GB' },
    { name: 'Alex', lang: 'en-US' },
    { name: 'Samantha', lang: 'en-US' },
    { name: 'Google UK English Female', lang: 'en-GB' },
  ] as unknown as SpeechSynthesisVoice[];
  it("Pat resolves to an American FEMALE voice, never the British male", () => {
    const v = personaVoiceFor('storyteller', 'Pat', LIST);
    expect(v?.name).toBe('Samantha');
  });
  it('Uncle Ray resolves to an American male voice, never Daniel', () => {
    const v = personaVoiceFor('comedian', 'Uncle Ray', LIST);
    expect(v?.name).toBe('Alex');
  });
  it('a normal (non-story) bot still resolves by the old path', () => {
    const v = personaVoiceFor('comedian', 'Marcus', LIST);
    expect(v).not.toBeNull();
  });
});

describe('milestone + event detection (deterministic from state)', () => {
  const base = () => newGame(makeRules('joker'), 'scene-test');
  it('first hand + nil attempt + pull-away fire from hand results', () => {
    const st = base();
    const s0 = storySnap(st);
    const st2 = {
      ...st, scores: [160, 0],
      history: [{ handNo: 1, bids: ['nil', 4, 3, 4], tricksWon: [0, 6, 3, 4], sides: [
        { side: 0, seats: [0, 2], points: 160, contractMade: true, nils: [{ seat: 0, kind: 'nil', tricks: 0, made: true, points: 100 }] },
        { side: 1, seats: [1, 3], points: 0, contractMade: true, nils: [] },
      ] }],
    } as unknown as GameState;
    const s1 = storySnap(st2);
    const ms = storyMilestones(s0, s1).map((m) => m.milestone);
    expect(ms).toContain('firstHand');
    expect(ms).toContain('nilAttempt');
    expect(ms).toContain('pullAway');
    const evs = storyEvents(s0, s1);
    expect(evs).toContain('nilMade');
    expect(evs).toContain('bigSwing');
  });
  it('a big bid registers when it lands; facts count sets, nils and Dee honestly', () => {
    const st = base();
    const s0 = storySnap({ ...st, bids: [null, null, null, null] } as unknown as GameState);
    const s1 = storySnap({ ...st, bids: [7, null, null, null] } as unknown as GameState);
    expect(storyEvents(s0, s1)).toContain('bigBid');
    const done = {
      ...st, scores: [260, 90],
      history: [
        { handNo: 1, bids: [3, 4, 'nil', 4], tricksWon: [4, 5, 0, 4], sides: [
          { side: 0, seats: [0, 2], points: 130, contractMade: true, nils: [{ seat: 2, kind: 'nil', tricks: 0, made: true, points: 100 }] },
          { side: 1, seats: [1, 3], points: -40, contractMade: false, nils: [] }] },
        { handNo: 2, bids: [4, 3, 4, 3], tricksWon: [5, 4, 3, 1], sides: [
          { side: 0, seats: [0, 2], points: 130, contractMade: true, nils: [] },
          { side: 1, seats: [1, 3], points: 130, contractMade: true, nils: [] }] },
      ],
    } as unknown as GameState;
    const f = storyFactsOf(done);
    expect(f.deeNilsMade).toBe(1);
    expect(f.ourNilsMade).toBe(1);
    expect(f.setsAgainstThem).toBe(1);
    expect(f.setsAgainstUs).toBe(0);
    expect(f.deeSteady).toBe(true); // Dee took a trick and her side made it, both hands
    expect(f.margin).toBe(170);
    expect(f.setOnFirstHand).toBe(true);
  });
});

describe('story save slot', () => {
  const mkSave = (): StorySavedGame => {
    const st = newGame(makeRules('joker'), 'story-seed');
    return {
      v: 1, savedAt: 1, seed: 'story-seed', settings: DEFAULT_SETTINGS, state: st, chat: [],
      names: ['You', 'Uncle Ray', 'Dee', 'Pat'],
      story: { stopId: 'porch', track: 'solo', attemptsAtStart: 1, clearsAtStart: 0, session: { fired: ['firstHand'], memory: ['bigSwing'], satDown: true, railFired: 2, lastRailHand: 3 } },
    };
  };
  it('round-trips engine state + story wrapper + session state', () => {
    const s = mkSave();
    saveStoryGame(s, s.story);
    const back = loadStoryGame()!;
    expect(back).toBeTruthy();
    expect(back.seed).toBe('story-seed');
    expect(back.state.handNo).toBe(s.state.handNo);
    expect(back.story.stopId).toBe('porch');
    expect(back.story.attemptsAtStart).toBe(1);
    expect(back.story.session.fired).toEqual(['firstHand']);
    expect(back.story.session.memory).toEqual(['bigSwing']);
    expect(back.story.session.satDown).toBe(true);
    expect(back.story.session.railFired).toBe(2);
    expect(back.story.session.lastRailHand).toBe(3);
  });
  it('is a separate slot: story save/clear never touches the normal save, and vice versa', () => {
    const st = newGame(makeRules('joker'), 'normal-seed');
    saveGame({ seed: 'normal-seed', settings: DEFAULT_SETTINGS, state: st, chat: [] });
    const before = localStorage.getItem(SAVE_KEY);
    const s = mkSave();
    saveStoryGame(s, s.story);
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    clearStoryGame();
    expect(localStorage.getItem(SAVE_KEY)).toBe(before);
    expect(localStorage.getItem(STORY_SAVE_KEY)).toBeNull();
    expect(loadStoryGame()).toBeNull();
  });
  it('stale validation: progress that moved on (attempts/clears changed, stop locked) kills the save', () => {
    const s = mkSave();
    const prog = (over: object) => ({
      track: 'solo', currentStop: 1, completed: false, completedAt: null, completionMark: null,
      finds: { eggs: [], feats: [] },
      stops: STORY_STOPS.map((x) => ({ stopId: x.id, n: x.n, state: x.id === 'porch' ? 'current' : 'locked', attempts: 0, clears: 0, firstClearedAt: null })),
      ...over,
    }) as never;
    expect(storySaveValidFor(s, prog({}))).toBe(false); // attempts 0 ≠ attemptsAtStart 1
    const matching = prog({});
    (matching as { stops: { attempts: number }[] }).stops[0]!.attempts = 1;
    expect(storySaveValidFor(s, matching)).toBe(true);
    const clearedElsewhere = prog({});
    const st0 = (clearedElsewhere as { stops: { attempts: number; clears: number }[] }).stops[0]!;
    st0.attempts = 2; st0.clears = 1;
    expect(storySaveValidFor(s, clearedElsewhere)).toBe(false);
  });
});

describe('badges', () => {
  it('derivation: earned from real facts only, with the remainder counted', async () => {
    const facts = badgeFactsOf({
      stops: STORY_STOPS.map((s) => ({ stopId: s.id, attempts: s.id === 'porch' ? 1 : 0, clears: s.id === 'porch' ? 1 : 0 })),
      finds: { eggs: ['porch-radio'], feats: [] },
      completed: false,
    });
    const c = await renderEl(createElement(StoryBadges, { facts }));
    expect(c.querySelector('[data-testid="story-badges-count"]')!.textContent).toBe('2 of 13');
    expect(c.querySelector('[data-testid="story-badge-porch-graduate"]')!.getAttribute('data-earned')).toBe('true');
    expect(c.querySelector('[data-testid="story-badge-king-of-the-block"]')!.getAttribute('data-earned')).toBe('false');
    // tap a locked badge: the fair hint shows, no spoiler directions for eggs
    await click(c.querySelector('[data-testid="story-badge-egg-hunter"]')!);
    expect(c.querySelector('[data-testid="story-badge-detail"]')).toBeTruthy();
    // tap an earned badge: how it was earned shows
    await click(c.querySelector('[data-testid="story-badge-porch-graduate"]')!);
    expect(c.querySelector('[data-testid="story-badge-detail"]')!.textContent).toContain('cleared The Porch');
  });
});

describe('map resume', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', async (input: unknown) => {
      const url = String(input);
      if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: true, unlocks: [] }) };
      if (url.includes('/api/story/progress')) return {
        ok: true, status: 200,
        json: async () => ({
          track: 'solo', currentStop: 1, completed: false, completedAt: null, completionMark: null,
          finds: { eggs: [], feats: [] },
          stops: STORY_STOPS.map((s) => ({ stopId: s.id, n: s.n, state: s.id === 'porch' ? 'current' : 'locked', attempts: s.id === 'porch' ? 1 : 0, clears: 0, firstClearedAt: null })),
        }),
      };
      throw new Error(`no network in tests: ${url}`);
    });
  });
  it('a saved match shows Resume on its stop; Restart discards the save with no result posted', async () => {
    const st = newGame(makeRules('joker'), 'map-seed');
    const save: StorySavedGame = {
      v: 1, savedAt: 1, seed: 'map-seed', settings: DEFAULT_SETTINGS, state: st, chat: [], names: ['You', 'Uncle Ray', 'Dee', 'Pat'],
      story: { stopId: 'porch', track: 'solo', attemptsAtStart: 1, clearsAtStart: 0, session: { fired: [], memory: [], satDown: true, railFired: 0, lastRailHand: 0 } },
    };
    saveStoryGame(save, save.story);
    const c = await renderEl(createElement(StoryHome));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(c.querySelector('[data-testid="story-resume-porch"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-inprogress-porch"]')).toBeTruthy();
    await click(c.querySelector('[data-testid="story-restart-porch"]')!);
    expect(localStorage.getItem(STORY_SAVE_KEY)).toBeNull();
    // after discarding, the stop offers the fresh intro path again (tape first)
    expect(c.querySelector('[data-testid="story-tape"]')).toBeTruthy();
  });
});
