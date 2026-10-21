/**
 * @vitest-environment happy-dom
 *
 * Story Mode owner tool (web), the other side: a NON-dev player never
 * sees the "Reset stop" control. Under STORY_OWNER_ONLY they get the
 * locked screen (the server 403s their progress fetch), so no map — and
 * therefore no reset control — ever renders for them. Kept in its own
 * file because the venue-unlock dev flag is module-cached: one dev state
 * per file, the same split as story-lock.test.ts.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import StoryHome from '../src/story/StoryHome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const resetCalls: string[] = [];
beforeAll(() => {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: false, unlocks: [] }) };
    if (url.includes('/api/story/reset-stop')) { resetCalls.push(url); return { ok: false, status: 403, json: async () => ({}) }; }
    if (url.includes('/api/story/progress')) return { ok: false, status: 403, json: async () => ({}) };
    throw new Error(`no network in tests: ${url}`);
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

describe('story reset-stop control (non-dev player)', () => {
  it('never renders: the locked screen stands, no reset control, no reset call', async () => {
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(createElement(StoryHome)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(el.querySelector('[data-testid="story-locked"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="story-map"]')).toBeNull();
    expect(el.querySelector('[data-testid^="story-reset"]')).toBeNull();
    expect(resetCalls).toEqual([]);
  });
});
