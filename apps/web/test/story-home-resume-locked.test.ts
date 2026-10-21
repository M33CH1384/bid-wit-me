/**
 * @vitest-environment happy-dom
 *
 * Story resume on Home — the locked half (owner lock, 2026-10-21): while
 * STORY_OWNER_ONLY is on, a player who is not entitled to story mode sees
 * the locked row/screen exactly as before. A story save on their device
 * must never surface a resume treatment to someone the row is locked for,
 * and a ?resume= deep link must never start a table behind the lock.
 * (The entitled half lives in story-home-resume.test.ts — one dev state
 * per file, the pattern the other story suites use.)
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRules, newGame } from '@spades/rules';
import Setup from '../src/Setup';
import { DEFAULT_SETTINGS } from '../src/settings';
import StoryHome from '../src/story/StoryHome';
import { saveStoryGame, type StorySavedGame } from '../src/story/storySave';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* Table is mocked so a wrongly-fired resume would show up as a probe
 * render instead of a WebGL crash. */
vi.mock('../src/Table', async () => {
  const React = await import('react');
  return {
    default: function MockTable() {
      return React.createElement('div', { 'data-testid': 'mock-table' });
    },
  };
});

const mkSave = (stopId = 'porch'): StorySavedGame => {
  const st = newGame(makeRules('joker'), 'story-seed');
  return {
    v: 1, savedAt: 1, seed: 'story-seed', settings: DEFAULT_SETTINGS, state: st, chat: [],
    names: ['You', 'Uncle Ray', 'Dee', 'Pat'],
    story: {
      stopId, track: 'solo', attemptsAtStart: 0, clearsAtStart: 0,
      session: { fired: [], memory: [], satDown: true, railFired: 0, lastRailHand: 0 },
    },
  };
};

beforeEach(() => {
  localStorage.clear();
  // a regular player: signed in, NOT a dev account; the story API 403s.
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: false, unlocks: [] }) };
    if (url.includes('/api/story/progress')) return { ok: false, status: 403, json: async () => ({ error: 'locked' }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
});

let root: Root | null = null;
let el: HTMLDivElement | null = null;
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

async function render(node: ReactNode) {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  return el;
}

describe('locked players never see a resume state', () => {
  it('Home: a save on the device does not change the locked row', async () => {
    saveStoryGame(mkSave('porch'), mkSave('porch').story);
    history.replaceState(null, '', '/');
    const c = await render(createElement(Setup, {
      settings: DEFAULT_SETTINGS,
      onChange: () => {},
      tips: { on: false, asked: true },
      onTips: () => {},
      onStart: () => {},
    }));
    const locked = c.querySelector('[data-testid="story-mode-locked"]');
    expect(locked).toBeTruthy();
    expect(locked!.textContent).toContain('Story mode');
    expect(c.querySelector('[data-resume-stop]')).toBeNull();
    expect(c.querySelector('[data-testid="story-mode"]')).toBeNull();
  });

  it('StoryHome: a ?resume= link behind the lock shows the locked screen, never a table', async () => {
    saveStoryGame(mkSave('porch'), mkSave('porch').story);
    history.replaceState(null, '', '/story?resume=porch');
    const c = await render(createElement(StoryHome));
    expect(c.querySelector('[data-testid="story-locked"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="mock-table"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-map"]')).toBeNull();
  });
});
