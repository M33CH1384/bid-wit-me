/**
 * @vitest-environment happy-dom
 *
 * The mode gate must not re-ask after the chunk self-heal reload
 * (owner, 2026-10-22 22:29 EDT): "If I hit play on a story mode game
 * the entire game flashes and takes me back to the menu asking if I
 * want to play solo or co-op. If I try a second time it works."
 *
 * The mechanism, traced: a deploy deletes the previous build's hashed
 * chunks (chunkLoad.ts's own header). His page predated the 22:16
 * deploy (f07f2131 — Table.tsx + story/beatPacing.ts, both inside the
 * story route's chunk graph), so the next dynamic import on the Play
 * path — the StoryHome route chunk, or the table warm's Tornado3D —
 * named a chunk that no longer existed. importChunk did exactly what
 * it is built to do: cache-bust retries, then ONE location.reload()
 * onto the new build. The reload is the flash. It also restarts
 * StoryHome, whose mode gate was in-memory state (mode starts null and
 * NOTHING in the component ever sets it back to null — the gate can
 * only reappear through a fresh mount), so the far side of the heal
 * asked Solo-or-Co-op again. The retry worked because the new boot's
 * chunk names match the live deployment.
 *
 * The fix keeps the heal and repairs what it destroys: the gate's
 * answer is remembered in sessionStorage — the same tab-scoped
 * lifetime as the heal's own reload flag — so the gate is asked once
 * per visit and a heal reload mid-visit lands back on the map. These
 * pins render StoryHome the way the heal leaves it: a fresh mount in
 * the same tab session.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import StoryHome, { STORY_MODE_KEY, loadStoryMode, saveStoryMode, storedStoryMode } from '../src/story/StoryHome';
import { themeStore } from '../src/theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The real Table is a 3D/WebGL surface; the gate/map state machine is
 * what's under test, so Table is replaced by a probe div. */
vi.mock('../src/Table', async () => {
  const React = await import('react');
  return {
    default: function MockTable() {
      return React.createElement('div', { 'data-testid': 'mock-table' });
    },
  };
});

/* ---- fixtures ---- */

const progressPayload = () => ({
  track: 'solo',
  stops: STORY_STOPS.map((s) => ({
    stopId: s.id,
    n: s.n,
    state: s.id === 'porch' ? 'current' : 'locked',
    attempts: 0,
    clears: 0,
    firstClearedAt: null,
  })),
  currentStop: 1,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds: { eggs: [], feats: [] },
});

function stubFetch() {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: true, storyAccess: true, unlocks: [] }) };
    if (url.includes('/api/story/progress')) return { ok: true, status: 200, json: async () => progressPayload() };
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

/* ---- render harness (same shape as story-home-resume.test.ts) ---- */

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
  sessionStorage.clear();
});
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

/** A fresh StoryHome mount — what a document reload (the chunk heal) leaves behind. */
async function renderStoryHome() {
  unmount();
  history.replaceState(null, '', '/story');
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(StoryHome)); });
  await settle();
  return el;
}

/* ---- the stored answer ---- */

describe('the mode gate answer, remembered per tab session', () => {
  it('only the two real answers read back; anything else is no answer', () => {
    const box = new Map<string, string>();
    const storage = {
      getItem: (k: string) => box.get(k) ?? null,
      setItem: (k: string, v: string) => { box.set(k, v); },
      removeItem: (k: string) => { box.delete(k); },
    };
    expect(storedStoryMode(storage)).toBeNull();
    storage.setItem(STORY_MODE_KEY, 'solo');
    expect(storedStoryMode(storage)).toBe('solo');
    storage.setItem(STORY_MODE_KEY, 'coop');
    expect(storedStoryMode(storage)).toBe('coop');
    storage.setItem(STORY_MODE_KEY, 'banana');
    expect(storedStoryMode(storage)).toBeNull();
    expect(storedStoryMode(null)).toBeNull();
    expect(storedStoryMode({ getItem: () => { throw new Error('denied'); } })).toBeNull();
  });

  it('save/load round-trips through the tab session storage', () => {
    expect(loadStoryMode()).toBeNull();
    saveStoryMode('solo');
    expect(sessionStorage.getItem(STORY_MODE_KEY)).toBe('solo');
    expect(loadStoryMode()).toBe('solo');
    saveStoryMode('coop');
    expect(loadStoryMode()).toBe('coop');
  });
});

/* ---- the gate across a heal reload ---- */

describe('StoryHome mode gate — the heal reload must not re-ask', () => {
  it('a first visit is asked: the gate renders, the map waits', async () => {
    stubFetch();
    const c = await renderStoryHome();
    expect(c.querySelector('[data-testid="story-mode-gate"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-map"]')).toBeNull();
  });

  it('choosing Solo writes the answer down and opens the map', async () => {
    stubFetch();
    const c = await renderStoryHome();
    const solo = c.querySelector('[data-testid="story-gate-solo"]');
    expect(solo).toBeTruthy();
    await act(async () => { (solo as HTMLElement).click(); });
    await settle();
    expect(sessionStorage.getItem(STORY_MODE_KEY)).toBe('solo');
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-mode-gate"]')).toBeNull();
  });

  it('the reported bug: mount, choose Solo, REMOUNT (the heal reload) — the map, not the gate', async () => {
    stubFetch();
    const first = await renderStoryHome();
    const solo = first.querySelector('[data-testid="story-gate-solo"]');
    expect(solo).toBeTruthy();
    await act(async () => { (solo as HTMLElement).click(); });
    await settle();
    expect(first.querySelector('[data-testid="story-map"]')).toBeTruthy();

    // The chunk heal reloads the document: a brand-new StoryHome mount
    // in the same tab session. Before the fix this render was the gate
    // again — the owner's "takes me back to the menu asking if I want
    // to play solo or co-op".
    const second = await renderStoryHome();
    expect(second.querySelector('[data-testid="story-mode-gate"]')).toBeNull();
    expect(second.querySelector('[data-testid="story-map"]')).toBeTruthy();
  });

  it('a remembered Co-op answer remounts onto the co-op home, not the gate', async () => {
    stubFetch();
    saveStoryMode('coop');
    const c = await renderStoryHome();
    expect(c.querySelector('[data-testid="story-mode-gate"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-coop-home"]')).toBeTruthy();
  });

  it('a corrupt remembered answer is ignored — the gate asks, as a first visit', async () => {
    stubFetch();
    sessionStorage.setItem(STORY_MODE_KEY, 'banana');
    const c = await renderStoryHome();
    expect(c.querySelector('[data-testid="story-mode-gate"]')).toBeTruthy();
  });
});
