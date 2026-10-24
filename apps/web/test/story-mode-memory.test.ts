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
 * lifetime as the heal's own reload flag — so a heal reload mid-visit
 * lands back on the map.
 *
 * The refinement (owner, 2026-10-24): the remembered answer may not
 * swallow the gate for the whole session. "If I've already started a
 * solo story mode, I have no way to then start a co-op mode. It only
 * gives me the option to resume my solo mode." Reading the answer
 * back on every mount meant a deliberate re-entry — Home → Story
 * Mode, same session — rode the remembered 'solo' straight to the
 * solo map with no gate at all. So the answer is restored ONLY when
 * this document is a reload of the story screen itself (the heal's
 * landing, modeled here by a stubbed navigation entry: type
 * 'reload', name …/story). Every deliberate entry is asked. These
 * pins render StoryHome both ways: as an entry (navigation entry
 * 'navigate') and as the heal leaves it (entry 'reload' of /story).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import StoryHome, { STORY_MODE_KEY, initialStoryMode, loadStoryMode, saveStoryMode, storedStoryMode, storyReloadEntry } from '../src/story/StoryHome';
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
  perfSlot.getEntriesByType = realGetEntries;
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  act(() => themeStore.set('classic'));
});

async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
}

/* The mount's document story, told by the navigation entry the way a
 * browser tells it: a deliberate entry arrives on a fresh document
 * ('navigate'); the chunk heal lands on a document RELOADED at the
 * story screen itself ('reload', name …/story). StoryHome reads the
 * pair to decide whether the remembered gate answer may be restored
 * (storyDocumentReload) — so each render below declares which
 * document it models, deterministically, whatever the test DOM's own
 * entry happens to say. */
const perfSlot = performance as { getEntriesByType?: (t: string) => unknown };
const realGetEntries = perfSlot.getEntriesByType;
function stubNavigationEntry(entry: { type: string; name: string } | null) {
  perfSlot.getEntriesByType = (t: string) => (t === 'navigation'
    ? (entry ? [entry] : [])
    : (realGetEntries ? realGetEntries.call(performance, t) as unknown[] : []));
}
const ENTRY_NAVIGATE = { type: 'navigate', name: 'https://bid-wit-me.pages.dev/' };
const ENTRY_STORY_RELOAD = { type: 'reload', name: 'https://bid-wit-me.pages.dev/story' };

/** A fresh StoryHome mount. With no argument it models a deliberate
 *  entry (a fresh document); pass ENTRY_STORY_RELOAD to model what a
 *  document reload — the chunk heal — leaves behind. */
async function renderStoryHome(navEntry: { type: string; name: string } = ENTRY_NAVIGATE) {
  stubNavigationEntry(navEntry);
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

  it('the reported bug: mount, choose Solo, REMOUNT as the heal leaves it (a reload of /story) — the map, not the gate', async () => {
    stubFetch();
    const first = await renderStoryHome();
    const solo = first.querySelector('[data-testid="story-gate-solo"]');
    expect(solo).toBeTruthy();
    await act(async () => { (solo as HTMLElement).click(); });
    await settle();
    expect(first.querySelector('[data-testid="story-map"]')).toBeTruthy();

    // The chunk heal reloads the DOCUMENT at the story screen: a
    // brand-new StoryHome mount whose navigation entry is a reload
    // of /story itself. Before the session-memory fix this render was
    // the gate again — the owner's "takes me back to the menu asking
    // if I want to play solo or co-op".
    const second = await renderStoryHome(ENTRY_STORY_RELOAD);
    expect(second.querySelector('[data-testid="story-mode-gate"]')).toBeNull();
    expect(second.querySelector('[data-testid="story-map"]')).toBeTruthy();
  });

  it('a remembered Co-op answer restores onto the co-op home on a reload of /story, not the gate', async () => {
    stubFetch();
    saveStoryMode('coop');
    const c = await renderStoryHome(ENTRY_STORY_RELOAD);
    expect(c.querySelector('[data-testid="story-mode-gate"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-coop-home"]')).toBeTruthy();
  });

  /* The 2026-10-24 trap: the remembered answer swallowed the gate on
   * DELIBERATE entries too, so a solo run in progress left co-op with
   * no door at all. An entry is not a reload of the story document —
   * it is asked, whatever the session remembers. */
  it('a deliberate re-entry is asked again — a remembered Solo answer does not ride past the gate', async () => {
    stubFetch();
    const first = await renderStoryHome();
    const solo = first.querySelector('[data-testid="story-gate-solo"]');
    expect(solo).toBeTruthy();
    await act(async () => { (solo as HTMLElement).click(); });
    await settle();
    expect(first.querySelector('[data-testid="story-map"]')).toBeTruthy();
    expect(sessionStorage.getItem(STORY_MODE_KEY)).toBe('solo');

    // Home → Story Mode again, same tab session, same document life:
    // a fresh mount, not a reload of /story. The gate stands.
    const second = await renderStoryHome();
    expect(second.querySelector('[data-testid="story-mode-gate"]')).toBeTruthy();
    expect(second.querySelector('[data-testid="story-gate-coop"]')).toBeTruthy();
    expect(second.querySelector('[data-testid="story-map"]')).toBeNull();
  });

  it('a remembered Co-op answer does not swallow a deliberate entry either — and Solo from the gate opens the solo map', async () => {
    stubFetch();
    saveStoryMode('coop');
    const c = await renderStoryHome();
    expect(c.querySelector('[data-testid="story-mode-gate"]')).toBeTruthy();
    const solo = c.querySelector('[data-testid="story-gate-solo"]');
    expect(solo).toBeTruthy();
    await act(async () => { (solo as HTMLElement).click(); });
    await settle();
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
  });

  it('a reload of some OTHER screen is not a story reload — the gate still asks', async () => {
    stubFetch();
    saveStoryMode('solo');
    const c = await renderStoryHome({ type: 'reload', name: 'https://bid-wit-me.pages.dev/' });
    expect(c.querySelector('[data-testid="story-mode-gate"]')).toBeTruthy();
  });

  it('a corrupt remembered answer is ignored — the gate asks, as a first visit', async () => {
    stubFetch();
    sessionStorage.setItem(STORY_MODE_KEY, 'banana');
    const c = await renderStoryHome();
    expect(c.querySelector('[data-testid="story-mode-gate"]')).toBeTruthy();
  });
});

/* ---- the reload discriminator itself ---- */

describe('storyReloadEntry / initialStoryMode — only a reload of /story restores', () => {
  it('reads the navigation entry pair, and nothing else, as a story reload', () => {
    expect(storyReloadEntry([{ type: 'reload', name: 'https://bid-wit-me.pages.dev/story' }])).toBe(true);
    expect(storyReloadEntry([{ type: 'reload', name: 'https://bid-wit-me.pages.dev/story?resume=porch' }])).toBe(true);
    expect(storyReloadEntry([{ type: 'reload', name: 'https://bid-wit-me.pages.dev/' }])).toBe(false);
    expect(storyReloadEntry([{ type: 'reload', name: 'https://bid-wit-me.pages.dev/profile' }])).toBe(false);
    expect(storyReloadEntry([{ type: 'navigate', name: 'https://bid-wit-me.pages.dev/story' }])).toBe(false);
    expect(storyReloadEntry([{ type: 'back_forward', name: 'https://bid-wit-me.pages.dev/story' }])).toBe(false);
    expect(storyReloadEntry([{ type: 'reload' }])).toBe(false);
    expect(storyReloadEntry([])).toBe(false);
    expect(storyReloadEntry(undefined)).toBe(false);
  });

  it('initialStoryMode restores the remembered answer only under a story reload', () => {
    saveStoryMode('coop');
    stubNavigationEntry(ENTRY_NAVIGATE);
    expect(initialStoryMode()).toBeNull();
    stubNavigationEntry(ENTRY_STORY_RELOAD);
    expect(initialStoryMode()).toBe('coop');
    stubNavigationEntry({ type: 'reload', name: 'https://bid-wit-me.pages.dev/' });
    expect(initialStoryMode()).toBeNull();
    perfSlot.getEntriesByType = realGetEntries;
  });
});
