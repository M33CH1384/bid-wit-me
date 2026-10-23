/**
 * @vitest-environment happy-dom
 *
 * Story screen scroll discipline (owner, 2026-10-21): "When navigating
 * thru story mode if I hit meet them the screen opens but it's already
 * scrolled down… when it loads it loads at the top on each screen —
 * unless it's the map, I want to load near the next stop."
 *
 * The mechanism: StoryHome swaps its screens inside ONE document — the
 * window is the scroll container and a state swap moves nothing, so a
 * sub-screen opened from a scrolled map inherited the map's offset. The
 * fix lives in StoryHome layout effects: every sub-screen (tape, intro
 * incl. its tape → scene step, game, outro) opens at the top, and the
 * map opens positioned at the player's current stop — on first load and
 * on every return. Positioning is armed once per map arrival and spent
 * by the positioning itself, so a progress update landing while the
 * player reads the map never yanks the scroll (pinned below).
 *
 * happy-dom paints nothing and its scroll primitives are stubs, so the
 * pins record the CALLS (window.scrollTo / element.scrollIntoView with
 * their targets and options). The owner's iPhone is the pixel verdict.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import StoryHome, { STORY_SCROLL_SETTLE_MS } from '../src/story/StoryHome';
import { themeStore } from '../src/theme';
import { clearStoryGame } from '../src/story/storySave';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The table is a 3D surface; scroll discipline is StoryHome's, so the
 * game screen is a probe. */
vi.mock('../src/Table', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div', { 'data-testid': 'mock-table' }) };
});

/* ---- scroll call recording ---- */

const scrollToCalls: unknown[][] = [];
const intoViewCalls: { testid: string | null; opts: unknown }[] = [];
const origScrollTo = window.scrollTo;
const origIntoView = (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;

beforeEach(() => {
  scrollToCalls.length = 0;
  intoViewCalls.length = 0;
  Object.defineProperty(window, 'scrollTo', {
    configurable: true, writable: true,
    value: (...args: unknown[]) => { scrollToCalls.push(args); },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true, writable: true,
    value: function (this: HTMLElement, opts?: unknown) {
      intoViewCalls.push({ testid: this.getAttribute('data-testid'), opts });
    },
  });
});
afterEach(() => {
  Object.defineProperty(window, 'scrollTo', { configurable: true, writable: true, value: origScrollTo });
  if (origIntoView) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: origIntoView });
  else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

/* ---- fixtures ---- */

/** Porch cleared, Barbershop current (stop 2 of 11) — or, with
 *  `completed`, the whole route done. */
const progressPayload = (completed = false) => ({
  track: 'solo',
  stops: STORY_STOPS.map((s) => ({
    stopId: s.id,
    n: s.n,
    state: completed ? 'cleared' : s.id === 'porch' ? 'cleared' : s.id === 'barbershop' ? 'current' : 'locked',
    attempts: s.id === 'porch' ? 2 : s.id === 'barbershop' ? 1 : 0,
    clears: completed || s.id === 'porch' ? 1 : 0,
    firstClearedAt: completed || s.id === 'porch' ? 1 : null,
  })),
  currentStop: completed ? null : 2,
  completed,
  completedAt: completed ? 1 : null,
  completionMark: completed ? 'story-solo-complete' : null,
  finds: { eggs: [], feats: [] },
});

function stubFetch(completed = false) {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: true, storyAccess: true, unlocks: [] }) };
    if (url.includes('/api/story/progress')) return { ok: true, status: 200, json: async () => progressPayload(completed) };
    if (url.includes('/api/story/reset-stop')) return { ok: true, status: 200, json: async () => progressPayload(completed) };
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
  clearStoryGame();
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

async function renderStoryHome() {
  unmount();
  history.replaceState(null, '', '/story');
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(StoryHome) as ReactNode); });
  await settle();
  /* co-op mode gate: these suites walk the solo run — pass the gate as a solo player would */
  const gate = el!.querySelector('[data-testid="story-gate-solo"]');
  if (gate) await click(gate);
  return el!;
}

const click = async (node: Element) => {
  await act(async () => { node.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await settle();
};
const byTestid = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);

/* ---- the pins ---- */

describe('story map load positioning', () => {
  it('first load positions at the current stop, not the top of the route', async () => {
    stubFetch();
    const c = await renderStoryHome();
    expect(byTestid(c, 'story-map')).toBeTruthy();
    // Exactly one positioning: the Barbershop card, centered, instant.
    expect(intoViewCalls).toEqual([
      { testid: 'story-stop-barbershop', opts: { block: 'center', behavior: 'auto' } },
    ]);
    expect(scrollToCalls).toEqual([]);
  });

  it('route complete: the map loads at the top', async () => {
    stubFetch(true);
    const c = await renderStoryHome();
    expect(byTestid(c, 'story-map')).toBeTruthy();
    expect(intoViewCalls).toEqual([]);
    expect(scrollToCalls).toEqual([[0, 0]]);
  });

  it('a progress update landing on the open map never re-scrolls (the player may be reading)', async () => {
    stubFetch();
    const c = await renderStoryHome();
    expect(intoViewCalls).toHaveLength(1);
    scrollToCalls.length = 0;
    intoViewCalls.length = 0;
    // The owner reset round-trips a fresh progress object onto the open
    // map — the spent positioning must not fire again.
    await click(byTestid(c, 'story-reset-arm-barbershop')!);
    await click(byTestid(c, 'story-reset-confirm-barbershop')!);
    expect(scrollToCalls).toEqual([]);
    expect(intoViewCalls).toEqual([]);
  });
});

describe('story sub-screens open at the top', () => {
  it('Meet them: the Tale of the Tape opens at the top', async () => {
    stubFetch();
    const c = await renderStoryHome();
    scrollToCalls.length = 0;
    intoViewCalls.length = 0;
    await click(byTestid(c, 'story-meet-barbershop')!);
    expect(byTestid(c, 'story-tape-done')).toBeTruthy(); // the tape screen is up
    expect(scrollToCalls).toEqual([[0, 0]]);
    expect(intoViewCalls).toEqual([]);
  });

  it('Back to the map from the tape re-positions at the current stop', async () => {
    stubFetch();
    const c = await renderStoryHome();
    await click(byTestid(c, 'story-meet-barbershop')!);
    scrollToCalls.length = 0;
    intoViewCalls.length = 0;
    await click(byTestid(c, 'story-tape-done')!); // the tape's "Back to the map"
    expect(byTestid(c, 'story-map')).toBeTruthy();
    expect(intoViewCalls).toEqual([
      { testid: 'story-stop-barbershop', opts: { block: 'center', behavior: 'auto' } },
    ]);
    expect(scrollToCalls).toEqual([]);
  });

  it('the intro opens at the top, and its scene step opens at the top too', async () => {
    stubFetch();
    const c = await renderStoryHome();
    scrollToCalls.length = 0;
    intoViewCalls.length = 0;
    await click(byTestid(c, 'story-play-barbershop')!);
    // Intro step 1 is the tape ("Play the scene" is its way forward).
    expect(byTestid(c, 'story-tape-done')!.textContent).toContain('Play the scene');
    expect(scrollToCalls).toEqual([[0, 0]]);
    await click(byTestid(c, 'story-tape-done')!);
    expect(c.querySelector('.story-scene')).toBeTruthy(); // the scene player is up
    expect(scrollToCalls).toEqual([[0, 0], [0, 0]]);
    expect(intoViewCalls).toEqual([]);
  });
});

/**
 * The 2026-10-22 regression: the meet-them tape "opened already
 * scrolled down" AGAIN, the day the Rundown panel joined the surface —
 * the layout-effect scrollTo fired before paint as pinned above, but
 * the page kept settling after mount (image decode, the panel's
 * reveal growing the document — its text wrap followed the typed
 * text until the constant-height fix) and a real phone's viewport
 * ended displaced, with nothing left to re-assert the top. The
 * discipline now re-asserts ONCE after a settle window — and never
 * against a player who has taken the scroll themselves. The map is
 * exempt: its parked position is deliberate (pinned above).
 */
describe('the settle re-assertion', () => {
  const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

  it('the tape re-asserts the top once its content has settled', async () => {
    stubFetch();
    const c = await renderStoryHome();
    await click(byTestid(c, 'story-meet-barbershop')!);
    expect(byTestid(c, 'story-tape-done')).toBeTruthy();
    scrollToCalls.length = 0;
    await wait(STORY_SCROLL_SETTLE_MS + 300);
    expect(scrollToCalls).toEqual([[0, 0]]);
  });

  it('a player who takes the scroll is never fought', async () => {
    stubFetch();
    const c = await renderStoryHome();
    await click(byTestid(c, 'story-meet-barbershop')!);
    scrollToCalls.length = 0;
    window.dispatchEvent(new Event('touchstart'));
    await wait(STORY_SCROLL_SETTLE_MS + 300);
    expect(scrollToCalls).toEqual([]);
  });

  it('the map gets no settle re-assertion', async () => {
    stubFetch();
    const c = await renderStoryHome();
    expect(byTestid(c, 'story-map')).toBeTruthy();
    scrollToCalls.length = 0;
    await wait(STORY_SCROLL_SETTLE_MS + 300);
    expect(scrollToCalls).toEqual([]);
  });
});
