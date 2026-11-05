/**
 * @vitest-environment happy-dom
 *
 * DECK TAP MODEL (owner, 2026-11-05: "The card viewer should work on a
 * second tap or an eye icon. My first tap should just choose the deck"):
 * selection is the primary tap action in the deck picker. First tap on an
 * owned, unselected cover CHOOSES the deck and opens nothing; a tap on
 * the cover already chosen opens the deck browser; every cover carries
 * an eye button that opens the browser WITHOUT moving the choice.
 * Locked covers keep today's behaviour in full: tap or eye opens the
 * browser (looking is free, the unlock line lives there), Use disabled.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckGallery } from '../src/DeckGallery';
import { DECKS } from '../src/decks';
import { invalidateStoryProgress } from '../src/storyDecks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let el: HTMLDivElement;
const qs = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

/** Progress payloads per test: default = no clears (story decks locked). */
let progressJson: unknown = {};
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).startsWith('/api/story/progress') ? progressJson : {}),
  })));
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
  progressJson = {};
  invalidateStoryProgress();
  stubFetch();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); vi.unstubAllGlobals(); });

let changes: string[] = [];
function GalleryHarness({ initial = 'classic' }: { initial?: string }) {
  const [v, setV] = useState(initial);
  return createElement(DeckGallery, { value: v, onChange: (nv: string) => { changes.push(nv); setV(nv); } });
}
async function renderGallery(initial?: string) {
  changes = [];
  await act(async () => { root.render(createElement(GalleryHarness, { initial })); });
  await flush(); await flush();
}

describe('deck tap model — first tap chooses', () => {
  it('first tap on an owned, unselected deck selects it and opens NO viewer', async () => {
    await renderGallery('classic');
    await click(qs('[data-testid=deck-harlem]'));
    expect(changes).toEqual(['harlem']);
    expect(qs('[data-testid=deck-browser]')).toBeNull();
    expect(qs('[data-testid=deck-harlem]')?.classList.contains('on')).toBe(true);
    expect(qs('[data-testid=deck-harlem]')?.getAttribute('aria-selected')).toBe('true');
    expect(qs('[data-testid=deck-harlem]')?.textContent).toContain('Your deck');
  });

  it('a tap on the already-chosen deck opens the browser (the second tap)', async () => {
    await renderGallery('classic');
    await click(qs('[data-testid=deck-harlem]'));
    expect(qs('[data-testid=deck-browser]')).toBeNull();
    await click(qs('[data-testid=deck-harlem]'));
    const browser = qs('[data-testid=deck-browser]');
    expect(browser).not.toBeNull();
    expect(browser?.textContent).toContain('Harlem');
    // opening the viewer never re-selects or double-fires the choice
    expect(changes).toEqual(['harlem']);
    const use = qs<HTMLButtonElement>('[data-testid=deck-use-harlem]');
    expect(use?.disabled).toBe(true);
    expect(use?.textContent).toContain('This is your deck');
  });

  it('the deck chosen at mount opens its browser on the FIRST tap (it is already the second tap)', async () => {
    await renderGallery('harlem');
    await click(qs('[data-testid=deck-harlem]'));
    expect(qs('[data-testid=deck-browser]')).not.toBeNull();
    expect(changes).toEqual([]);
  });
});

describe('deck tap model — the eye views without choosing', () => {
  it('every cover carries an eye button', async () => {
    await renderGallery();
    for (const d of DECKS) {
      const eye = qs(`[data-testid=deck-eye-${d.id}]`);
      expect(eye, `eye for ${d.id}`).not.toBeNull();
      expect(eye?.tagName).toBe('BUTTON');
    }
    expect(el.querySelectorAll('.dg-eye')).toHaveLength(DECKS.length);
  });

  it('eye on an unselected deck opens the browser and leaves the choice unmoved', async () => {
    await renderGallery('classic');
    await click(qs('[data-testid=deck-eye-harlem]'));
    const browser = qs('[data-testid=deck-browser]');
    expect(browser).not.toBeNull();
    expect(browser?.textContent).toContain('Harlem');
    expect(changes).toEqual([]);
    expect(qs('[data-testid=deck-classic]')?.classList.contains('on')).toBe(true);
    // choosing from inside the eye-opened browser still works, and closes back
    await click(qs('[data-testid=deck-use-harlem]'));
    expect(changes).toEqual(['harlem']);
    expect(qs('[data-testid=deck-browser]')).toBeNull();
  });

  it('eye on the chosen deck opens the browser too; closing changes nothing', async () => {
    await renderGallery('harlem');
    await click(qs('[data-testid=deck-eye-harlem]'));
    expect(qs('[data-testid=deck-browser]')).not.toBeNull();
    await click(qs('[data-testid=deck-browser-close]'));
    expect(qs('[data-testid=deck-browser]')).toBeNull();
    expect(changes).toEqual([]);
    expect(qs('[data-testid=deck-harlem]')?.classList.contains('on')).toBe(true);
  });
});

describe('deck tap model — locked decks keep the info behaviour', () => {
  it('a locked cover tap opens its info/browser and selects nothing', async () => {
    await renderGallery('classic');
    await click(qs('[data-testid=deck-pjs]'));
    const browser = qs('[data-testid=deck-browser]');
    expect(browser).not.toBeNull();
    expect(browser?.textContent).toContain("Clear The Pj's in Story Mode");
    expect(changes).toEqual([]);
    expect(qs<HTMLButtonElement>('[data-testid=deck-use-pjs]')?.disabled).toBe(true);
  });

  it('the eye on a locked deck opens the same info view', async () => {
    await renderGallery('classic');
    await click(qs('[data-testid=deck-eye-pjs]'));
    const browser = qs('[data-testid=deck-browser]');
    expect(browser).not.toBeNull();
    expect(browser?.textContent).toContain("Clear The Pj's in Story Mode");
    expect(changes).toEqual([]);
  });

  it('an unlocked story deck: first tap chooses it (no browser), eye still views it', async () => {
    progressJson = { track: 'solo', stops: [{ stopId: 'the-pjs', n: 9, state: 'cleared', attempts: 2, clears: 1, firstClearedAt: 1 }], currentStop: null, completed: false, completedAt: null, completionMark: null };
    invalidateStoryProgress();
    await renderGallery('classic');
    expect(qs('[data-testid=deck-pjs]')?.classList.contains('locked')).toBe(false);
    await click(qs('[data-testid=deck-pjs]'));
    expect(changes).toEqual(['pjs']);
    expect(qs('[data-testid=deck-browser]')).toBeNull();
    await click(qs('[data-testid=deck-eye-pjs]'));
    expect(qs('[data-testid=deck-browser]')).not.toBeNull();
    expect(changes).toEqual(['pjs']);
  });
});
