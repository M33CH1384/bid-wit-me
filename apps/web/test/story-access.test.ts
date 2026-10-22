/**
 * @vitest-environment happy-dom
 *
 * Story-mode player allowlist (owner order, 2026-10-21): an allowlisted
 * player (LovleyT714) holds storyAccess WITHOUT dev — the Home story row
 * and /story render the full player experience for her, while the owner
 * reset tool never renders (it keys off dev, which she does not hold).
 * Kept in its own file because the venue-unlock profile fetch is
 * module-cached: one profile state per file, the same split as
 * story-lock.test.ts. The server half is pinned in
 * apps/server/test/story-access.test.ts.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import Setup from '../src/Setup';
import { DEFAULT_SETTINGS } from '../src/settings';
import StoryHome from '../src/story/StoryHome';
import type { StoryProgress } from '../src/story/storyApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type StopRow = StoryProgress['stops'][number];
const row = (stopId: string, over: Partial<StopRow> = {}): StopRow => {
  const s = STORY_STOPS.find((x) => x.id === stopId)!;
  return { stopId, n: s.n, state: 'locked', attempts: 0, clears: 0, firstClearedAt: null, ...over };
};
/** Her route after a Porch clear: facts on the stop — exactly the state
 *  where a dev account would see the reset control under the stop card. */
const progressPayload: StoryProgress = {
  track: 'solo',
  stops: STORY_STOPS.map((s) => row(s.id, s.id === 'porch'
    ? { state: 'cleared', attempts: 2, clears: 1, firstClearedAt: 1 }
    : s.id === 'barbershop' ? { state: 'current' } : {})),
  currentStop: 2,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds: { eggs: ['porch-radio'], feats: ['story-porch-cap'] },
};

const resetCalls: string[] = [];
beforeAll(() => {
  // the allowlisted player: signed in, storyAccess true, dev FALSE.
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: false, storyAccess: true, unlocks: [] }) };
    if (url.includes('/api/story/reset-stop')) { resetCalls.push(url); return { ok: false, status: 403, json: async () => ({}) }; }
    if (url.includes('/api/story/progress')) return { ok: true, status: 200, json: async () => progressPayload };
    if (url.includes('/api/story/session')) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: false, status: 404, json: async () => ({}) };
  });
});

let root: Root | null = null;
let el: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
});

async function render(node: ReactNode) {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  /* co-op mode gate: pass it as a solo player would */
  const gate = el.querySelector('[data-testid="story-gate-solo"]');
  if (gate) {
    await act(async () => { (gate as HTMLElement).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }
  return el;
}

describe('story allowlist (client): storyAccess without dev', () => {
  it('StoryHome renders the map with her progress — never the locked screen', async () => {
    const c = await render(createElement(StoryHome));
    expect(c.querySelector('[data-testid="story-locked"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-stop-porch"]')?.textContent).toContain('CLEARED');
    expect(c.querySelector('[data-testid="story-stop-barbershop"]')).toBeTruthy();
  });

  it('the owner reset tool never renders for her, even on a stop with facts', async () => {
    const c = await render(createElement(StoryHome));
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
    expect(c.querySelector('[data-testid^="story-reset"]')).toBeNull();
    expect(resetCalls).toEqual([]);
  });

  it('Home: the story row is the plain player row, not the locked row', async () => {
    const c = await render(createElement(Setup, {
      settings: DEFAULT_SETTINGS,
      onChange: () => {},
      tips: { on: false, asked: true },
      onTips: () => {},
      onStart: () => {},
    }));
    expect(c.querySelector('[data-testid="story-mode-locked"]')).toBeNull();
    const rowEl = c.querySelector('[data-testid="story-mode"]');
    expect(rowEl).toBeTruthy();
    expect(rowEl!.textContent).toContain('Story mode');
    expect(rowEl!.textContent).toContain('Run the block');
  });
});
