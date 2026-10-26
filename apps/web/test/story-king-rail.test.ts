/**
 * @vitest-environment happy-dom
 *
 * The King's rail at the table (owner report, 2026-10-26: "I didnt see
 * anyone at the table at all"). The diagnosis: the rail cast was never a
 * data bug — railCastForAttempt deals the full 20 at the King, the story
 * session checkpoints it, resume restores it — but the cast's faces only
 * ever rendered in the ScriptPlayer intro/outro strip, story resume skips
 * the intro by design, and the King's moment rules (cap 3, quiet after
 * hand 3) leave a resumed Hand 4+ table with at most one witness line.
 * A design-realization gap: presence itself is the statement at the
 * finale, so the faces now stand at the table for the whole match.
 *
 * Pins: the full cast on first entry AND on resume (round-trip through
 * the session save), the faces render in the in-match table view, the
 * gate's derivation matches the scene channel's precedence exactly, and
 * no other stop gains an in-match rail.
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_CHARACTERS, STORY_RAIL, STORY_STOPS, railCastForAttempt, type StoryStop } from '@spades/bots';
import { makeRules, newGame } from '@spades/rules';
import Table, { kingRailCastFor } from '../src/Table';
import { loadStoryGame, saveStoryGame, type StorySavedGame } from '../src/story/storySave';
import { DEFAULT_SETTINGS } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const king = STORY_STOPS.find((s) => s.id === 'king')!;
const porch = STORY_STOPS.find((s) => s.id === 'porch')!;
const legends = STORY_STOPS.find((s) => s.id === 'legends')!;
const FULL = [...STORY_RAIL['king']!];

/* The story prop StoryHome hands the table, in its three King shapes. */
const factsFor = (stop: StoryStop) => ({ attempts: 10, clears: 1, cleared: false, clearedStopIds: STORY_STOPS.slice(0, 10).map((s) => s.id) });
const storyProp = (stop: StoryStop, saveCtx?: object) => ({
  names: ['You', stop.pair[0]!.name, 'Dee', stop.pair[1]!.name],
  levelFor: () => 'pro' as const,
  onGameOver: () => {},
  scene: { stop, facts: factsFor(stop) },
  ...(saveCtx ? { saveCtx } : {}),
});

describe('the King contract: the full cast, first entry and resume', () => {
  it('the draw itself: the King deals the full 20 every attempt; Porch and High-Rise stay empty by design', () => {
    expect(FULL).toHaveLength(20);
    for (const n of [1, 2, 7]) expect(railCastForAttempt('king', n)).toEqual(FULL);
    expect(railCastForAttempt('porch', 1)).toEqual([]);
    expect(railCastForAttempt('high-rise', 3)).toEqual([]);
  });

  it('first entry: the attempt cast StoryHome drew is the cast at the table', () => {
    const story = storyProp(king, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: railCastForAttempt('king', 1) });
    expect(kingRailCastFor(story as never)).toEqual(FULL);
  });

  it('legacy first entry (no drawn cast anywhere): the local draw still deals the full 20', () => {
    const story = storyProp(king, { attemptsAtStart: 3, clearsAtStart: 0, resumed: false });
    expect(kingRailCastFor(story as never)).toEqual(FULL);
  });

  it('resume: the saved session cast wins — the exact faces the match started with', () => {
    const story = storyProp(king, {
      attemptsAtStart: 0, clearsAtStart: 0, resumed: true,
      initialSession: { fired: [], memory: [], satDown: true, railCast: [...FULL] },
    });
    expect(kingRailCastFor(story as never)).toEqual(FULL);
  });

  it('the derivation precedence matches the scene channel: saved cast > drawn cast > local draw', () => {
    // A marker cast proves precedence (production King casts are always the
    // full pool; the ORDER is what this pins — the faces shown must be the
    // faces the chime-in channel speaks from).
    const marker = ['queenie', 'ace'];
    const both = storyProp(king, {
      attemptsAtStart: 0, clearsAtStart: 0, resumed: true, railCast: ['pat'],
      initialSession: { fired: [], memory: [], satDown: true, railCast: marker },
    });
    expect(kingRailCastFor(both as never)).toEqual(marker);
    const drawnOnly = storyProp(king, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: ['pat'] });
    expect(kingRailCastFor(drawnOnly as never)).toEqual(['pat']);
  });

  it('unknown ids never reach the felt (a corrupt cast renders only real faces)', () => {
    const story = storyProp(king, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: ['pat', 'nobody', 'ace'] });
    expect(kingRailCastFor(story as never)).toEqual(['pat', 'ace']);
  });

  it('no other stop gains an in-match rail — not even with a cast in hand', () => {
    for (const stop of [porch, legends]) {
      const story = storyProp(stop, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: railCastForAttempt(stop.id, 1) });
      expect(kingRailCastFor(story as never), stop.id).toEqual([]);
    }
    expect(kingRailCastFor(undefined)).toEqual([]);
    expect(kingRailCastFor({} as never)).toEqual([]);
  });

  it('round-trip: a resumed King save carries the full cast through the session slot', () => {
    const st = newGame(makeRules('joker'), 'king-rail-seed');
    const save: StorySavedGame = {
      v: 1, savedAt: 1, seed: 'king-rail-seed', settings: DEFAULT_SETTINGS, state: st, chat: [],
      names: ['You', 'The King', 'Dee', 'Ringer'],
      story: {
        stopId: 'king', track: 'solo', attemptsAtStart: 0, clearsAtStart: 0,
        session: { fired: [], memory: [], satDown: true, railCast: railCastForAttempt('king', 1) },
      },
    };
    saveStoryGame(save, save.story);
    const back = loadStoryGame();
    expect(back?.story.session.railCast).toEqual(FULL);
    // …and the gate over the restored session deals those same faces.
    const story = storyProp(king, {
      attemptsAtStart: back!.story.attemptsAtStart, clearsAtStart: 0, resumed: true,
      initialSession: back!.story.session,
    });
    expect(kingRailCastFor(story as never)).toEqual(FULL);
  });
});

/* ------------------------------------------------------------ the felt */

let root: Root | null = null;
let el: HTMLDivElement | null = null;

const until = async (pred: () => boolean, ms = 4000): Promise<boolean> => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
  return pred();
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  localStorage.clear();
  sessionStorage.clear();
  try { localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); } catch { /* storage off */ }
  try { sessionStorage.setItem('bwm.versus.king-rail-seed', '1'); } catch { /* storage off */ }
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  root = null;
  el = null;
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const mountTable = (story?: object) => {
  act(() => {
    root!.render(createElement(Table, {
      rules: makeRules('joker'), seed: 'king-rail-seed',
      settings: { ...DEFAULT_SETTINGS, quality: 'low', speed: 'turbo' },
      onExit: () => {}, onRematch: () => {}, onQuality: () => {},
      ...(story ? { story } : {}),
    } as never));
  });
};

describe('the rail stands at the King table during play', () => {
  it('first entry: all 20 faces on the felt, split down the pool order', async () => {
    mountTable(storyProp(king, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: railCastForAttempt('king', 1) }));
    expect(await until(() => !!document.querySelector('[data-testid="king-rail"]')), 'rail mounted').toBe(true);
    const faces = [...document.querySelectorAll('[data-testid^="king-rail-face-"]')];
    expect(faces.map((f) => f.getAttribute('data-testid'))).toEqual(FULL.map((id) => `king-rail-face-${id}`));
    const left = document.querySelectorAll('.king-rail-side.left [data-testid^="king-rail-face-"]');
    const right = document.querySelectorAll('.king-rail-side.right [data-testid^="king-rail-face-"]');
    expect(left).toHaveLength(10);
    expect(right).toHaveLength(10);
    // Every face is the shipped portrait component for that character.
    for (const id of FULL) {
      const face = document.querySelector(`[data-testid="king-rail-face-${id}"] [data-testid="story-face-${id}"]`);
      expect(face, id).not.toBeNull();
      expect(STORY_CHARACTERS[id]).toBeTruthy();
    }
  });

  it('resume: the same 20 faces — no fresh draw, no swaps', async () => {
    mountTable(storyProp(king, {
      attemptsAtStart: 0, clearsAtStart: 0, resumed: true,
      initialSession: { fired: [], memory: [], satDown: true, railCast: [...FULL] },
    }));
    expect(await until(() => !!document.querySelector('[data-testid="king-rail"]')), 'rail mounted on resume').toBe(true);
    const faces = [...document.querySelectorAll('[data-testid^="king-rail-face-"]')];
    expect(faces.map((f) => f.getAttribute('data-testid'))).toEqual(FULL.map((id) => `king-rail-face-${id}`));
  });

  it('other stops and non-story tables render no in-match rail', async () => {
    mountTable(storyProp(porch, { attemptsAtStart: 0, clearsAtStart: 0, resumed: false, railCast: [] }));
    expect(await until(() => !!document.querySelector('[data-testid="bug-hand"]')), 'porch table up').toBe(true);
    expect(document.querySelector('[data-testid="king-rail"]')).toBeNull();
  });
});

describe('placement discipline (source pins)', () => {
  // happy-dom rewrites import.meta.url, so resolve from the repo root the
  // suite runs from (with the apps/web cwd as the fallback).
  const cssPath = ['apps/web/src/styles.css', 'src/styles.css'].find((p) => { try { readFileSync(p, 'utf8'); return true; } catch { return false; } })!;
  const css = readFileSync(cssPath, 'utf8');
  it('the rail is pure presence: pointer-events off, layered under the badge layer and every control', () => {
    const block = css.match(/\.king-rail \{[^}]*\}/)?.[0] ?? '';
    expect(block).toContain('pointer-events: none');
    // z 1: under the badge layer (2) — plates and speech bubbles paint over
    // the crowd — and far under the scorebug (8) / last-trick (9) / ctl (12).
    expect(block).toContain('z-index: 1');
    expect(css).toContain('.table-screen.short .king-rail-side');
    expect(css).toContain('.king-rail .story-face.king-rail-face');
  });
});
