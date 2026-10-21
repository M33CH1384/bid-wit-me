/**
 * @vitest-environment happy-dom
 *
 * Story Mode owner tool (web): the "Reset stop" control on the map stop
 * card. Dev accounts only, only on stops with recorded facts; a two-tap
 * confirm is required before anything is posted; a successful reset
 * re-renders the stop fresh and drops the shared cleared-stop cache the
 * deck / set-animation pickers read. Runs as the dev (owner) account —
 * the non-dev case lives in story-reset-hidden.test.ts (the venue-unlock
 * dev flag is module-cached, one dev state per file, like story-lock).
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import StoryHome from '../src/story/StoryHome';
import { invalidateStoryProgress, useClearedStoryStops } from '../src/storyDecks';
import type { StoryProgress } from '../src/story/storyApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type StopRow = StoryProgress['stops'][number];
const row = (stopId: string, over: Partial<StopRow> = {}): StopRow => {
  const s = STORY_STOPS.find((x) => x.id === stopId)!;
  return { stopId, n: s.n, state: 'locked', attempts: 0, clears: 0, firstClearedAt: null, ...over };
};
const progressOf = (rows: Record<string, Partial<StopRow>>, finds: { eggs: string[]; feats: string[] }, currentStop: number): StoryProgress => ({
  track: 'solo',
  stops: STORY_STOPS.map((s) => row(s.id, rows[s.id])),
  currentStop,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds,
});

/** The owner's actual state after his Porch win: cleared in 2 attempts,
 *  the radio egg found, the bottle-cap feat earned, Barbershop current. */
const progressBefore = progressOf(
  { porch: { state: 'cleared', attempts: 2, clears: 1, firstClearedAt: 1 }, barbershop: { state: 'current' } },
  { eggs: ['porch-radio'], feats: ['story-porch-cap'] },
  2,
);
const progressAfter = progressOf({ porch: { state: 'current' } }, { eggs: [], feats: [] }, 1);

let resetDone = false;
let progressFetches = 0;
const resetCalls: { method?: string; body: { track?: string; stopId?: string } }[] = [];

beforeAll(() => {
  vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: true, storyAccess: true, unlocks: [] }) };
    if (url.includes('/api/story/reset-stop')) {
      resetCalls.push({ method: init?.method, body: JSON.parse(String(init?.body ?? '{}')) as never });
      resetDone = true;
      return { ok: true, status: 200, json: async () => ({ ok: true, stopId: 'porch', wiped: { progress: 1, claims: 2, finds: 2, sessions: 0 }, completionCleared: false, ...progressAfter }) };
    }
    if (url.includes('/api/story/progress')) {
      progressFetches++;
      return { ok: true, status: 200, json: async () => (resetDone ? progressAfter : progressBefore) };
    }
    if (url.includes('/api/story/session')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    throw new Error(`no network in tests: ${url}`);
  });
});

let root: Root | null = null;
let el: HTMLDivElement | null = null;
let probeRoot: Root | null = null;
let probeEl: HTMLDivElement | null = null;
function unmountAll() {
  if (root) act(() => root!.unmount());
  if (probeRoot) act(() => probeRoot!.unmount());
  root = null; probeRoot = null;
  el?.remove(); probeEl?.remove();
  el = null; probeEl = null;
}
afterEach(unmountAll);
beforeEach(() => {
  unmountAll();
  localStorage.clear();
  invalidateStoryProgress(); // the decks/set-anims cleared-set cache is module state
  resetDone = false;
  progressFetches = 0;
  resetCalls.length = 0;
});

const settle = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); };
async function render(node: ReactNode) {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  await settle();
  return el;
}
function ClearedProbe() {
  const { cleared, loaded } = useClearedStoryStops();
  return createElement('output', { 'data-testid': 'cleared-probe' }, !loaded ? 'loading' : [...(cleared ?? [])].sort().join(','));
}
async function renderProbe() {
  if (probeRoot) { act(() => probeRoot!.unmount()); probeRoot = null; probeEl?.remove(); }
  probeEl = document.createElement('div');
  document.body.appendChild(probeEl);
  probeRoot = createRoot(probeEl);
  await act(async () => { probeRoot!.render(createElement(ClearedProbe)); });
  await settle();
  return probeEl;
}
const click = async (node: Element | null) => {
  expect(node, 'element to click').toBeTruthy();
  await act(async () => { (node as HTMLElement).click(); });
  await settle();
};

describe('story reset-stop control (dev account)', () => {
  it('shows only on stops with facts, requires the confirm tap, then lands the stop fresh and drops the cleared cache', async () => {
    const c = await render(createElement(StoryHome));

    // Present on the Porch (attempts + clear + finds on record); absent on
    // the Barbershop — current, but nothing recorded there to wipe.
    expect(c.querySelector('[data-testid="story-reset-arm-porch"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-reset-arm-barbershop"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-stop-porch"]')?.textContent).toContain('CLEARED');

    // The shared cleared-set cache (decks / set animations) serves the
    // cleared Porch — and a remount is a cache hit, no refetch.
    let probe = await renderProbe();
    expect(probe.querySelector('[data-testid="cleared-probe"]')?.textContent).toBe('porch');
    const fetchesAfterFirstProbe = progressFetches;
    probe = await renderProbe();
    expect(probe.querySelector('[data-testid="cleared-probe"]')?.textContent).toBe('porch');
    expect(progressFetches).toBe(fetchesAfterFirstProbe);

    // Arming shows the confirm copy — what wipes, what stays — and posts NOTHING.
    await click(c.querySelector('[data-testid="story-reset-arm-porch"]'));
    const confirm = c.querySelector('[data-testid="story-reset-confirm-porch"]');
    expect(confirm).toBeTruthy();
    const copy = c.querySelector('[data-testid="story-reset-porch"]')?.textContent ?? '';
    expect(copy).toContain('attempts and clear');
    expect(copy).toContain('egg and feat finds');
    expect(copy).toContain('XP and coins already earned stay');
    expect(resetCalls).toEqual([]);

    // "Keep it" disarms without a call.
    await click(c.querySelector('[data-testid="story-reset-cancel-porch"]'));
    expect(c.querySelector('[data-testid="story-reset-confirm-porch"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-reset-arm-porch"]')).toBeTruthy();
    expect(resetCalls).toEqual([]);

    // Arm + confirm: exactly one POST for the solo track's Porch…
    await click(c.querySelector('[data-testid="story-reset-arm-porch"]'));
    await click(c.querySelector('[data-testid="story-reset-confirm-porch"]'));
    expect(resetCalls).toEqual([{ method: 'POST', body: { track: 'solo', stopId: 'porch' } }]);

    // …and the map lands with the stop fresh: no CLEARED stamp, you-are-here
    // again, the found egg's line gone, and nothing left to reset.
    const porchCard = c.querySelector('[data-testid="story-stop-porch"]');
    expect(porchCard?.textContent).not.toContain('CLEARED');
    expect(porchCard?.textContent).toContain('YOU ARE HERE');
    expect(c.querySelector('[data-testid="story-egg-porch"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-reset-arm-porch"]')).toBeNull();
    expect(c.textContent).toContain('0 of 11 stops cleared');

    // The cleared-set cache was invalidated: a fresh probe refetches and
    // the Porch no longer reads as cleared to the deck/set-anim pickers.
    probe = await renderProbe();
    expect(progressFetches).toBeGreaterThan(fetchesAfterFirstProbe);
    expect(probe.querySelector('[data-testid="cleared-probe"]')?.textContent).toBe('');
  });
});
