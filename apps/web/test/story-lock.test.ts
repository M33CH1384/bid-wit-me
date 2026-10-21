/**
 * @vitest-environment happy-dom
 *
 * Story-mode owner lock (owner, 2026-10-21): while STORY_OWNER_ONLY is on,
 * non-dev players see the locked screen instead of the map, and the lock
 * helper treats unknown dev state as locked. The server half (403s) is
 * pinned in apps/server/test/story.test.ts.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { STORY_OWNER_ONLY, storyLockedFor } from '../src/story/storyApi';
import StoryHome from '../src/story/StoryHome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  // a regular player: signed in, but NOT a dev account; story API says 403.
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: false, unlocks: [] }) };
    if (url.includes('/api/story/progress')) return { ok: false, status: 403, json: async () => ({ error: 'locked' }) };
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

async function render(node: ReactNode) {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(node); });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return el;
}

describe('story owner lock (client)', () => {
  it('the switch is on and the helper locks anyone who is not dev', () => {
    expect(STORY_OWNER_ONLY).toBe(true);
    expect(storyLockedFor(true)).toBe(false);
    expect(storyLockedFor(false)).toBe(true);
    expect(storyLockedFor(null)).toBe(true);
    expect(storyLockedFor(undefined)).toBe(true);
  });

  it('a non-dev player gets the locked screen, never the map', async () => {
    const c = await render(createElement(StoryHome));
    expect(c.querySelector('[data-testid="story-locked"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="story-map"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-stop-porch"]')).toBeNull();
    expect(c.textContent).toContain('being finished');
  });
});
