/**
 * @vitest-environment happy-dom
 *
 * The Story Mode gate's composition (owner, 2026-10-24: "This screen is
 * pretty dry."). The gate used to be two plain text cards on a flat dark
 * void. It is now story mode's front door, composed from the story's own
 * shipped surfaces: the map's hero (a stop backdrop graded behind the
 * title), Dee's portrait on the Solo card, Dee + an open partner seat on
 * the Co-op card, and the route itself as a thread of nodes along the
 * bottom so the screen composes its full height.
 *
 * Data honesty is pinned with the composition: every fact on the gate is
 * a real payload fact (solo progress, pair tracks, the validated device
 * save) — a fresh player gets the run's promise, a mid-run player gets
 * their actual place, a finished player gets the made-it-out read, and
 * a failed tracks fetch leaves the Co-op card with NO state line rather
 * than an invented one. Function is frozen: same choices, same routing.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import { makeRules, newGame } from '@spades/rules';
import { DEFAULT_SETTINGS } from '../src/settings';
import { themeStore } from '../src/theme';
import StoryHome from '../src/story/StoryHome';
import {
  clearStoryGame, saveStoryGame, type StorySavedGame,
} from '../src/story/storySave';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The real Table is a 3D/WebGL surface; the gate never reaches it, but
 * StoryHome imports it — replace it with a silent stand-in. */
vi.mock('../src/Table', async () => {
  const React = await import('react');
  return { default: function MockTable() { return React.createElement('div', { 'data-testid': 'mock-table' }); } };
});

/* ---- fixtures ---- */

type StopRow = { stopId: string; n: number; state: string; attempts: number; clears: number; firstClearedAt: number | null };
const stopRow = (over: Partial<StopRow> & { stopId: string; n: number }): StopRow => ({
  state: 'locked', attempts: 0, clears: 0, firstClearedAt: null, ...over,
});

/** No solo play recorded anywhere; the Porch is simply current. */
const freshProgress = () => ({
  track: 'solo',
  stops: STORY_STOPS.map((s) => stopRow({ stopId: s.id, n: s.n, state: s.id === 'porch' ? 'current' : 'locked' })),
  currentStop: 1,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds: { eggs: [], feats: [] },
});

/** Porch cleared, Barbershop current with one attempt recorded. */
const midRunProgress = () => ({
  track: 'solo',
  stops: STORY_STOPS.map((s) => stopRow({
    stopId: s.id, n: s.n,
    state: s.id === 'porch' ? 'cleared' : s.id === 'barbershop' ? 'current' : 'locked',
    attempts: s.id === 'porch' ? 2 : s.id === 'barbershop' ? 1 : 0,
    clears: s.id === 'porch' ? 1 : 0,
    firstClearedAt: s.id === 'porch' ? 1 : null,
  })),
  currentStop: 2,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds: { eggs: [], feats: [] },
});

/** The whole route cleared. */
const completeProgress = () => ({
  track: 'solo',
  stops: STORY_STOPS.map((s) => stopRow({ stopId: s.id, n: s.n, state: 'cleared', attempts: 1, clears: 1, firstClearedAt: 1 })),
  currentStop: null,
  completed: true,
  completedAt: 1,
  completionMark: 'mark',
  finds: { eggs: [], feats: [] },
});

const tracksPayload = (pairs: unknown[]) => ({
  solo: { track: 'solo', currentStop: 1, completed: false },
  pairs,
});

const mkSave = (stopId = 'barbershop', handNo = 4): StorySavedGame => {
  const st = newGame(makeRules('joker'), 'story-seed');
  return {
    v: 1, savedAt: 1, seed: 'story-seed', settings: DEFAULT_SETTINGS,
    state: { ...st, handNo }, chat: [],
    names: ['You', 'Mr. Coleman', 'Dee', 'June'],
    story: {
      stopId, track: 'solo', attemptsAtStart: 1, clearsAtStart: 0,
      session: { fired: [], memory: [], satDown: true, railFired: 0, lastRailHand: 0 },
    },
  };
};

function stubFetch(progress: unknown, tracks: unknown | 'fail') {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: false, storyAccess: true, unlocks: [] }) };
    if (url.includes('/api/story/progress')) return { ok: true, status: 200, json: async () => progress };
    if (url.includes('/api/story/tracks')) {
      if (tracks === 'fail') return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => tracks };
    }
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
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  act(() => themeStore.set('classic'));
});

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
}

async function renderGate() {
  unmount();
  history.replaceState(null, '', '/story');
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  const node: ReactNode = createElement(StoryHome);
  await act(async () => { root!.render(node); });
  await settle();
  return el;
}

const q = (sel: string) => el!.querySelector(sel);
const text = (sel: string) => q(sel)?.textContent ?? null;

/* ---- the composition, state by state ---- */

describe('the gate as front door', () => {
  it('fresh player: Porch hero, the run\u2019s promise, and the route ahead', async () => {
    stubFetch(freshProgress(), tracksPayload([]));
    await renderGate();
    expect(q('[data-testid="story-mode-gate"]')).toBeTruthy();
    // the hero carries the world: the Porch backdrop behind the title
    const bg = q('.story-gate-hero .story-hero-bg') as HTMLElement | null;
    expect(bg?.style.backgroundImage).toContain('/assets/story/venues/porch.jpg');
    expect(text('[data-testid="story-gate-hero-line"]')).toBe('0 of 11 stops cleared — it starts at the Porch');
    // both cards carry Dee's face; the Co-op card leaves the partner seat open
    expect(el!.querySelectorAll('[data-testid="story-face-dee"]')).toHaveLength(2);
    expect(q('.story-gate-seat-open')).toBeTruthy();
    expect(text('[data-testid="story-gate-solo-state"]')).toBe('It starts at the Porch — Dee\u2019s first real table.');
    expect(text('[data-testid="story-gate-coop-state"]')).toBe('No pair runs yet — a new pair starts together at the Porch.');
    // the route thread: eleven nodes, the Porch current, the rest ahead
    const nodes = el!.querySelectorAll('.story-gate-node');
    expect(nodes).toHaveLength(11);
    expect(nodes[0]!.className).toContain('state-current');
    expect(nodes[1]!.className).toContain('state-locked');
    expect(nodes[10]!.className).toContain('is-king');
    expect(text('.story-gate-route-line')).toBe('Eleven stops, porch to the King. It starts on Ray\u2019s porch.');
  });

  it('solo in progress: the hero stands at the player\u2019s stop and the cards carry the run', async () => {
    stubFetch(midRunProgress(), tracksPayload([]));
    await renderGate();
    const bg = q('.story-gate-hero .story-hero-bg') as HTMLElement | null;
    expect(bg?.style.backgroundImage).toContain('/assets/story/venues/barbershop.jpg');
    expect(text('[data-testid="story-gate-hero-line"]')).toBe('1 of 11 stops cleared — you\u2019re at The Barbershop');
    expect(text('[data-testid="story-gate-solo-state"]')).toBe('You\u2019re at The Barbershop — stop 2 of 11.');
    const nodes = el!.querySelectorAll('.story-gate-node');
    expect(nodes[0]!.className).toContain('state-cleared');
    expect(nodes[0]!.textContent).toBe('\u2713');
    expect(nodes[1]!.className).toContain('state-current');
    expect(text('.story-gate-route-line')).toBe('You\u2019re on the route — stop 2 of 11: The Barbershop.');
  });

  it('a match waiting in the save slot is the Solo card\u2019s headline fact', async () => {
    stubFetch(midRunProgress(), tracksPayload([]));
    saveStoryGame(mkSave('barbershop', 4), mkSave('barbershop', 4).story);
    await renderGate();
    expect(text('[data-testid="story-gate-solo-state"]')).toBe('A match is waiting at The Barbershop — hand 4, against Mr. Coleman & June.');
    clearStoryGame();
  });

  it('pair runs: the Co-op card names the run and where it stands', async () => {
    stubFetch(freshProgress(), tracksPayload([
      { track: 'pair:u2', partnerUid: 'u2', partnerHandle: 'LovleyT714', currentStop: 7, completed: false, lastPlayedAt: 10 },
      { track: 'pair:u3', partnerUid: 'u3', partnerHandle: 'mommaniese', currentStop: 2, completed: false, lastPlayedAt: 5 },
    ]));
    await renderGate();
    expect(text('[data-testid="story-gate-coop-state"]')).toBe('With LovleyT714 — at stop 7, The Rooftop. 1 more run on the books.');
  });

  it('a finished pair run reads as making it out together', async () => {
    stubFetch(freshProgress(), tracksPayload([
      { track: 'pair:u2', partnerUid: 'u2', partnerHandle: 'LovleyT714', currentStop: null, completed: true, lastPlayedAt: 10 },
    ]));
    await renderGate();
    expect(text('[data-testid="story-gate-coop-state"]')).toBe('You and LovleyT714 made it out together.');
  });

  it('a failed tracks fetch leaves the Co-op card silent — no invented state', async () => {
    stubFetch(freshProgress(), 'fail');
    await renderGate();
    expect(q('[data-testid="story-mode-gate"]')).toBeTruthy();
    expect(q('[data-testid="story-gate-coop-state"]')).toBeNull();
    // the choice itself is untouched by the missing facts
    expect(q('[data-testid="story-gate-solo"]')).toBeTruthy();
    expect(q('[data-testid="story-gate-coop"]')).toBeTruthy();
  });

  it('route complete: the King\u2019s backdrop, the made-it-out read, a green thread', async () => {
    stubFetch(completeProgress(), tracksPayload([]));
    await renderGate();
    const bg = q('.story-gate-hero .story-hero-bg') as HTMLElement | null;
    expect(bg?.style.backgroundImage).toContain('/assets/venues/blockAfterDark/bg.jpg');
    expect(text('[data-testid="story-gate-hero-line"]')).toBe('Route complete — you made it out.');
    expect(text('[data-testid="story-gate-solo-state"]')).toBe('Route complete — you made it out. Replays stay open for upkeep.');
    const nodes = el!.querySelectorAll('.story-gate-node');
    expect(nodes).toHaveLength(11);
    Array.from(nodes).forEach((n) => expect(n.className).toContain('state-cleared'));
    expect(text('.story-gate-route-line')).toBe('You made it out — porch to King, the whole route.');
  });

  it('the choices still route exactly as before', async () => {
    stubFetch(freshProgress(), tracksPayload([]));
    await renderGate();
    const coop = q('[data-testid="story-gate-coop"]') as HTMLElement;
    await act(async () => { coop.click(); });
    await settle();
    expect(q('[data-testid="story-coop-home"]')).toBeTruthy();
    expect(sessionStorage.getItem('bwm.storyMode.v1')).toBe('coop');
  });
});
