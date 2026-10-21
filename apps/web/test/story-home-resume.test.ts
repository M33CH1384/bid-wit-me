/**
 * @vitest-environment happy-dom
 *
 * Story resume on the Home screen (owner, 2026-10-21): "If I have a story
 * mode game to resume I should see that on the Home Screen."
 *
 * Before this pass the resume lived only on the /story map. Now Home's
 * story row is the signpost: with a story save on the device it swaps its
 * plain treatment for the in-progress facts — stop, seated pair, hand N —
 * and a Resume action that deep-links to /story?resume=<stopId>. The
 * resume itself is NOT reimplemented: StoryHome consumes the directive
 * through its own machinery (the same resumeStop the map card's Resume
 * button calls), validating the save against freshly fetched server
 * progress first. A stale or mismatched directive just lands on the map.
 *
 * Both surfaces render the facts from ONE derivation — storySaveSummary
 * over the story save slot — pinned here against the map's own card so
 * Home and the map can never disagree about the game that's waiting.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_CHARACTERS, STORY_STOPS } from '@spades/bots';
import { makeRules, newGame } from '@spades/rules';
import Setup from '../src/Setup';
import { DEFAULT_SETTINGS } from '../src/settings';
import { themeStore } from '../src/theme';
import StoryHome, { storyResumeStopId } from '../src/story/StoryHome';
import { storyPairLabel } from '../src/story/storySettings';
import {
  STORY_SAVE_KEY, clearStoryGame, loadStoryGame, saveStoryGame, storySaveSummary, type StorySavedGame,
} from '../src/story/storySave';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The real Table is a 3D/WebGL surface; StoryHome's directive consumption
 * is what's under test, so Table is replaced by a probe that reports the
 * props StoryHome hands it. */
interface ProbeProps {
  settings: { venue: string; deck: string };
  resume?: { seed: string };
  story?: {
    scene?: { stop: { id: string } };
    saveCtx?: { resumed?: boolean; attemptsAtStart: number };
  };
}
const probe = vi.hoisted(() => ({ props: null as ProbeProps | null }));
vi.mock('../src/Table', async () => {
  const React = await import('react');
  return {
    default: function MockTable(props: ProbeProps) {
      probe.props = props;
      return React.createElement('div', {
        'data-testid': 'mock-table',
        'data-stop': props.story?.scene?.stop.id ?? '',
        'data-resumed': String(props.story?.saveCtx?.resumed ?? ''),
        'data-resume-seed': props.resume?.seed ?? '',
      });
    },
  };
});

/* ---- fixtures ---- */

const mkSave = (stopId = 'barbershop', handNo = 4, attemptsAtStart = 1): StorySavedGame => {
  const st = newGame(makeRules('joker'), 'story-seed');
  return {
    v: 1, savedAt: 1, seed: 'story-seed', settings: DEFAULT_SETTINGS,
    state: { ...st, handNo }, chat: [],
    names: ['You', 'Mr. Coleman', 'Dee', 'June'],
    story: {
      stopId, track: 'solo', attemptsAtStart, clearsAtStart: 0,
      session: { fired: [], memory: [], satDown: true, railFired: 0, lastRailHand: 0 },
    },
  };
};

/** Progress where the Porch is cleared and the Barbershop is the live stop
 *  with `barberAttempts` recorded attempts (a save made under
 *  attemptsAtStart = barberAttempts is live; anything else is stale). */
const progressPayload = (barberAttempts: number) => ({
  track: 'solo',
  stops: STORY_STOPS.map((s) => ({
    stopId: s.id,
    n: s.n,
    state: s.id === 'porch' ? 'cleared' : s.id === 'barbershop' ? 'current' : 'locked',
    attempts: s.id === 'porch' ? 2 : s.id === 'barbershop' ? barberAttempts : 0,
    clears: s.id === 'porch' ? 1 : 0,
    firstClearedAt: s.id === 'porch' ? 1 : null,
  })),
  currentStop: 2,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds: { eggs: [], feats: [] },
});

function stubFetch(dev: boolean, barberAttempts = 1) {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev, unlocks: [] }) };
    if (url.includes('/api/story/progress')) return { ok: true, status: 200, json: async () => progressPayload(barberAttempts) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

/* ---- render harness ---- */

let root: Root | null = null;
let el: HTMLDivElement | null = null;
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}
beforeEach(() => {
  localStorage.clear();
  probe.props = null;
});
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  localStorage.clear();
  history.replaceState(null, '', '/');
  act(() => themeStore.set('classic'));
});

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
}

async function renderHome(theme: 'classic' | 'neon' = 'classic') {
  unmount();
  history.replaceState(null, '', '/');
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  const node: ReactNode = createElement(Setup, {
    settings: DEFAULT_SETTINGS,
    onChange: () => {},
    tips: { on: false, asked: true },
    onTips: () => {},
    onStart: () => {},
  });
  await act(async () => { themeStore.set(theme); root!.render(node); });
  await settle();
  return el;
}

async function renderStoryHome(search: string) {
  unmount();
  history.replaceState(null, '', `/story${search}`);
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(StoryHome)); });
  await settle();
  return el;
}

/* ---- the shared derivation ---- */

describe('storySaveSummary — the one derivation both surfaces render', () => {
  it('no save, or a save naming an unknown stop, summarizes to nothing', () => {
    expect(storySaveSummary(null)).toBeNull();
    expect(storySaveSummary(loadStoryGame())).toBeNull();
    saveStoryGame(mkSave('not-a-stop'), mkSave('not-a-stop').story);
    expect(loadStoryGame()?.story.stopId).toBe('not-a-stop');
    expect(storySaveSummary(loadStoryGame())).toBeNull();
  });

  it('derives stop, seated pair and hand from the save alone', () => {
    saveStoryGame(mkSave('barbershop', 4), mkSave('barbershop', 4).story);
    const s = storySaveSummary(loadStoryGame());
    expect(s).not.toBeNull();
    expect(s!.stop.id).toBe('barbershop');
    expect(s!.stop.name).toBe('The Barbershop');
    const stop = STORY_STOPS.find((x) => x.id === 'barbershop')!;
    expect(s!.pairNames).toEqual(stop.pair.map((id) => STORY_CHARACTERS[id]!.name));
    expect(s!.pairNames).toEqual(['Mr. Coleman', 'June']);
    expect(s!.handNo).toBe(4);
  });
});

/* ---- the directive parser ---- */

describe('story resume directive parsing', () => {
  it('accepts a real stop id and rejects everything else', () => {
    expect(storyResumeStopId('?resume=porch')).toBe('porch');
    expect(storyResumeStopId('?resume=king')).toBe('king');
    expect(storyResumeStopId('?resume=not-a-stop')).toBeNull();
    expect(storyResumeStopId('?resume=')).toBeNull();
    expect(storyResumeStopId('')).toBeNull();
    expect(storyResumeStopId('?rematch=porch')).toBeNull();
  });
});

/* ---- Home's story row ---- */

describe('Home story row', () => {
  it('no save: the plain row, exactly as before', async () => {
    stubFetch(true);
    const c = await renderHome();
    const row = c.querySelector('[data-testid="story-mode"]');
    expect(row).toBeTruthy();
    expect(row!.textContent).toContain('Story mode');
    expect(row!.textContent).toContain('Run the block');
    expect(row!.getAttribute('data-resume-stop')).toBeNull();
    expect(c.querySelector('[data-testid="story-mode-locked"]')).toBeNull();
  });

  it('a save swaps the row to the resume treatment — stop, pair, hand, action', async () => {
    stubFetch(true);
    saveStoryGame(mkSave('barbershop', 4), mkSave('barbershop', 4).story);
    const c = await renderHome();
    const row = c.querySelector('[data-testid="story-mode"]');
    expect(row).toBeTruthy();
    expect(row!.getAttribute('data-resume-stop')).toBe('barbershop');
    expect(row!.textContent).toContain('Resume');
    expect(row!.textContent).toContain('The Barbershop');
    expect(row!.textContent).toContain(storyPairLabel(STORY_STOPS.find((s) => s.id === 'barbershop')!));
    expect(row!.textContent).toContain('Hand 4');
    // the plain treatment is replaced, not stacked on top of it
    expect(row!.textContent).not.toContain('Run the block');
  });

  it('the resume treatment is identical under Classic and Neon (parity)', async () => {
    stubFetch(true);
    saveStoryGame(mkSave('barbershop', 4), mkSave('barbershop', 4).story);
    const classic = await renderHome('classic');
    const classicText = classic.querySelector('[data-testid="story-mode"]')!.textContent;
    const neon = await renderHome('neon');
    const neonRow = neon.querySelector('[data-testid="story-mode"]');
    expect(neonRow).toBeTruthy();
    expect(neonRow!.textContent).toBe(classicText);
    expect(neonRow!.getAttribute('data-resume-stop')).toBe('barbershop');
  });

  it('tapping Resume deep-links to the story screen with the resume directive', async () => {
    stubFetch(true);
    saveStoryGame(mkSave('barbershop', 4), mkSave('barbershop', 4).story);
    const c = await renderHome();
    const row = c.querySelector<HTMLButtonElement>('[data-testid="story-mode"]')!;
    await act(async () => { row.click(); });
    expect(location.pathname).toBe('/story');
    expect(location.search).toBe('?resume=barbershop');
  });

  it('tapping the plain row still goes to the plain story screen', async () => {
    stubFetch(true);
    const c = await renderHome();
    const row = c.querySelector<HTMLButtonElement>('[data-testid="story-mode"]')!;
    await act(async () => { row.click(); });
    expect(location.pathname).toBe('/story');
    expect(location.search).toBe('');
  });

  it('freshness: a save appearing while Home sits open swaps the row on focus', async () => {
    stubFetch(true);
    const c = await renderHome();
    expect(c.querySelector('[data-testid="story-mode"]')!.textContent).toContain('Run the block');
    saveStoryGame(mkSave('barbershop', 4), mkSave('barbershop', 4).story);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    const row = c.querySelector('[data-testid="story-mode"]');
    expect(row!.getAttribute('data-resume-stop')).toBe('barbershop');
    expect(row!.textContent).toContain('Hand 4');
  });

  it('freshness: clearing the save (finish / discard / the reset tool’s local mirror) removes the ghost resume', async () => {
    stubFetch(true);
    saveStoryGame(mkSave('barbershop', 4), mkSave('barbershop', 4).story);
    const c = await renderHome();
    expect(c.querySelector('[data-testid="story-mode"]')!.getAttribute('data-resume-stop')).toBe('barbershop');
    clearStoryGame();
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    const row = c.querySelector('[data-testid="story-mode"]');
    expect(row!.getAttribute('data-resume-stop')).toBeNull();
    expect(row!.textContent).toContain('Run the block');
    expect(localStorage.getItem(STORY_SAVE_KEY)).toBeNull();
  });
});

/* ---- StoryHome consuming the directive ---- */

describe('StoryHome resume consumption', () => {
  it('a live save + directive resumes straight to the table, save in hand', async () => {
    stubFetch(true, 1);
    saveStoryGame(mkSave('barbershop', 4, 1), mkSave('barbershop', 4, 1).story);
    const c = await renderStoryHome('?resume=barbershop');
    const table = c.querySelector('[data-testid="mock-table"]');
    expect(table).toBeTruthy();
    expect(table!.getAttribute('data-stop')).toBe('barbershop');
    // the resumeSave StoryHome loaded is the one handed to the table
    expect(table!.getAttribute('data-resume-seed')).toBe('story-seed');
    expect(table!.getAttribute('data-resumed')).toBe('true');
    // consumed once: the param is stripped so a refresh can't re-fire it
    expect(location.search).toBe('');
    expect(c.querySelector('[data-testid="story-map"]')).toBeNull();
  });

  it('a stale save (the stop recorded another attempt since) lands on the map and the save is dropped', async () => {
    stubFetch(true, 2); // progress says 2 attempts; the save began under 1
    saveStoryGame(mkSave('barbershop', 4, 1), mkSave('barbershop', 4, 1).story);
    const c = await renderStoryHome('?resume=barbershop');
    expect(c.querySelector('[data-testid="mock-table"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
    expect(localStorage.getItem(STORY_SAVE_KEY)).toBeNull();
  });

  it('a directive naming a different stop than the save resumes nothing — the map, with the save’s own card live', async () => {
    stubFetch(true, 1);
    saveStoryGame(mkSave('barbershop', 4, 1), mkSave('barbershop', 4, 1).story);
    const c = await renderStoryHome('?resume=porch');
    expect(c.querySelector('[data-testid="mock-table"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
    const facts = c.querySelector('[data-testid="story-inprogress-barbershop"]');
    expect(facts).toBeTruthy();
    expect(facts!.textContent).toContain('hand 4');
  });

  it('no save behind the directive: just the map, never an error wall', async () => {
    stubFetch(true, 1);
    const c = await renderStoryHome('?resume=barbershop');
    expect(c.querySelector('[data-testid="mock-table"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
  });

  it('an unknown stop id is not a directive — the map renders', async () => {
    stubFetch(true, 1);
    const c = await renderStoryHome('?resume=not-a-stop');
    expect(c.querySelector('[data-testid="mock-table"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
  });

  it('map and Home agree: the same save shows the same facts on both surfaces', async () => {
    stubFetch(true, 1);
    saveStoryGame(mkSave('barbershop', 4, 1), mkSave('barbershop', 4, 1).story);
    const home = await renderHome();
    const homeRow = home.querySelector('[data-testid="story-mode"]')!;
    expect(homeRow.textContent).toContain('The Barbershop');
    expect(homeRow.textContent).toContain('Hand 4');
    const map = await renderStoryHome('');
    const card = map.querySelector('[data-testid="story-stop-barbershop"]')!;
    expect(card.textContent).toContain('Mr. Coleman & June');
    expect(map.querySelector('[data-testid="story-inprogress-barbershop"]')!.textContent).toContain('hand 4');
    expect(map.querySelector('[data-testid="story-resume-barbershop"]')).toBeTruthy();
  });
});
