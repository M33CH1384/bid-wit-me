/**
 * @vitest-environment happy-dom
 *
 * DECK CARD VIEWER — SWIPE NAVIGATION (owner, 2026-10-28: "I want to be
 * able to swipe thru the cards on these screens in addition to tapping
 * the arrows"). The close-up (CardFocus) is ONE component behind both
 * doors — the setup deck picker (DeckBrowser) and the story/unlock deck
 * viewer (DeckViewer) — so the gesture is pinned on both. The arrows are
 * untouched and keep their instant swap; the swipe calls the same
 * prev/next targets, so the ends wrap exactly like the arrows. A
 * vertical-dominant drag must never be captured (the sheet's own
 * scrolling owns it), a short drag settles back, and under reduced
 * motion the swap is instant with no slide.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeckGallery, DeckViewer } from '../src/DeckGallery';
import { deckById } from '../src/decks';
import { invalidateStoryProgress } from '../src/storyDecks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let el: HTMLDivElement;
const qs = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const wait = async (ms: number) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

let reducedMotion = false;
function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({
      matches: reducedMotion && q.includes('prefers-reduced-motion'),
      media: q, addEventListener() {}, removeEventListener() {},
    }),
  });
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
  reducedMotion = false;
  invalidateStoryProgress();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).startsWith('/api/story/progress') ? {} : {}),
  })));
  stubMatchMedia();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await act(async () => { root.unmount(); });
  el.remove(); vi.unstubAllGlobals();
});

/* ---------------- helpers ---------------- */

function GalleryHarness() {
  const [v, setV] = useState('classic');
  return createElement(DeckGallery, { value: v, onChange: setV });
}
async function renderGallery() {
  await act(async () => { root.render(createElement(GalleryHarness)); });
  await flush();
}
async function renderViewer() {
  const deck = deckById('classic');
  if (!deck) throw new Error('no classic deck');
  await act(async () => { root.render(createElement(DeckViewer, { deck, onClose: () => {} })); });
  await flush();
}
/** Open the browser/viewer and focus one card's close-up. */
async function focusCard(card: string) {
  await click(qs(`[data-testid="deck-card-${card}"]`));
  if (!qs('[data-testid="deck-card-focus"]')) throw new Error(`focus did not open for ${card}`);
}

const stage = () => qs('[data-testid="deck-card-focus"] .db-stage');
const swipeEl = () => qs('[data-testid="deck-card-swipe"]');
const focusName = () => qs('.db-focus-name')?.textContent;

const ptr = (type: string, x: number, y: number, init: PointerEventInit = {}) =>
  new PointerEvent(type, { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y, ...init });
async function pointer(type: string, x: number, y: number, init: PointerEventInit = {}) {
  const s = stage();
  if (!s) throw new Error('no stage');
  await act(async () => { s.dispatchEvent(ptr(type, x, y, init)); });
}
/** A full drag: down at the first point, moves through the rest, up at the last. */
async function drag(points: [number, number][], init: PointerEventInit = {}) {
  await pointer('pointerdown', points[0]![0], points[0]![1], init);
  for (const [x, y] of points.slice(1)) await pointer('pointermove', x, y, init);
  const [lx, ly] = points[points.length - 1]!;
  await pointer('pointerup', lx, ly, init);
}
/** Swipe left far past the commit distance, then let the swap land. */
async function swipeLeft() {
  await drag([[220, 200], [180, 202], [140, 203], [100, 204]]);
  await wait(320); // slide-out (230ms) fires the nav; the settle-in follows
}
async function swipeRight() {
  await drag([[100, 200], [140, 202], [180, 203], [220, 204]]);
  await wait(320);
}

/* ---------------- the picker (DeckBrowser) ---------------- */

describe('deck picker close-up — swipe', () => {
  it('swipe left advances, tracks the finger mid-drag, swipe right goes back', async () => {
    await renderGallery();
    await click(qs('[data-testid="deck-classic"]'));
    await focusCard('AS');
    expect(focusName()).toBe('Ace of Spades');

    // Mid-drag: the card follows the pointer exactly.
    await pointer('pointerdown', 220, 200);
    await pointer('pointermove', 180, 202);
    await pointer('pointermove', 140, 203);
    expect(swipeEl()?.style.transform).toBe('translateX(-80px)');
    await pointer('pointerup', 140, 203);
    await wait(320);
    expect(focusName()).toBe('Two of Spades');
    expect(swipeEl()?.className).toContain('enter-next');

    await swipeRight();
    expect(focusName()).toBe('Ace of Spades');
    expect(swipeEl()?.className).toContain('enter-prev');
  });

  it('wraps at both ends exactly like the arrows', async () => {
    await renderGallery();
    await click(qs('[data-testid="deck-classic"]'));
    await focusCard('AS'); // first card: prev wraps to the last
    await swipeRight();
    expect(focusName()).toBe('Little Joker');
    await swipeLeft(); // last card: next wraps to the first
    expect(focusName()).toBe('Ace of Spades');
  });

  it('a short drag settles back without navigating', async () => {
    await renderGallery();
    await click(qs('[data-testid="deck-classic"]'));
    await focusCard('AS');
    // A genuinely slow short drag: small steps with real time between
    // them, so the release velocity stays far under the flick line.
    await pointer('pointerdown', 200, 200);
    await wait(40);
    await pointer('pointermove', 190, 201);
    await wait(40);
    await pointer('pointermove', 180, 201);
    await wait(40);
    await pointer('pointermove', 170, 201);
    expect(swipeEl()?.style.transform).toBe('translateX(-30px)');
    await pointer('pointerup', 170, 201);
    await wait(420); // settle-back (300ms) + style cleanup
    expect(focusName()).toBe('Ace of Spades');
    expect(swipeEl()?.style.transform ?? '').toBe('');
  });

  it('a fast flick commits from a short travel', async () => {
    await renderGallery();
    await click(qs('[data-testid="deck-classic"]'));
    await focusCard('AS');
    // Script the clock: three quick segments, total travel only -35px.
    let now = 1000;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    await pointer('pointerdown', 200, 200);
    now = 1010; await pointer('pointermove', 185, 201);
    now = 1020; await pointer('pointermove', 165, 201);
    now = 1025; await pointer('pointerup', 165, 201);
    spy.mockRestore();
    await wait(320);
    expect(focusName()).toBe('Two of Spades');
  });

  it('a vertical-dominant drag is never captured: no nav, no tracking', async () => {
    await renderGallery();
    await click(qs('[data-testid="deck-classic"]'));
    await focusCard('AS');
    await pointer('pointerdown', 200, 200);
    await pointer('pointermove', 205, 260);
    await pointer('pointermove', 207, 330);
    expect(swipeEl()?.style.transform ?? '').toBe('');
    await pointer('pointerup', 207, 330);
    await wait(120);
    expect(focusName()).toBe('Ace of Spades');
    expect(swipeEl()?.style.transform ?? '').toBe('');
  });

  it('the arrows still swap instantly, and All cards / backdrop close are intact', async () => {
    await renderGallery();
    await click(qs('[data-testid="deck-classic"]'));
    await focusCard('AS');
    await click(qs('[data-testid="deck-card-next"]'));
    expect(focusName()).toBe('Two of Spades'); // no slide wait — instant, as before
    await click(qs('[data-testid="deck-card-prev"]'));
    expect(focusName()).toBe('Ace of Spades');
    await click(qs('[data-testid="deck-all-cards"]'));
    expect(qs('[data-testid="deck-card-focus"]')).toBeNull();
    expect(qs('[data-testid="deck-card-AS"]')).not.toBeNull(); // grid is back
    // Tap-outside-to-close still closes the sheet.
    const backdrop = qs('.db-backdrop');
    await act(async () => { backdrop!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    await flush();
    expect(qs('[data-testid="deck-browser"]')).toBeNull();
  });

  it('mouse drags work too (desktop)', async () => {
    await renderGallery();
    await click(qs('[data-testid="deck-classic"]'));
    await focusCard('AS');
    await drag([[220, 200], [170, 201], [110, 202]], { pointerType: 'mouse', buttons: 1 });
    await wait(320);
    expect(focusName()).toBe('Two of Spades');
  });
});

/* ---------------- the story/unlock viewer (DeckViewer) ---------------- */

describe('deck viewer close-up — swipe', () => {
  it('swipes through cards on the shared component', async () => {
    await renderViewer();
    await focusCard('AS');
    await swipeLeft();
    expect(focusName()).toBe('Two of Spades');
    await swipeRight();
    expect(focusName()).toBe('Ace of Spades');
  });
});

/* ---------------- reduced motion ---------------- */

describe('reduced motion', () => {
  it('swaps instantly on release — no tracking, no slide classes', async () => {
    reducedMotion = true;
    stubMatchMedia();
    await renderGallery();
    await click(qs('[data-testid="deck-classic"]'));
    await focusCard('AS');
    await pointer('pointerdown', 220, 200);
    await pointer('pointermove', 140, 202);
    expect(swipeEl()?.style.transform ?? '').toBe(''); // never tracked
    await pointer('pointerup', 140, 202);
    await flush(); // no 230ms slide-out wait — already swapped
    expect(focusName()).toBe('Two of Spades');
    expect(swipeEl()?.className).not.toContain('enter-');
  });
});

/* ---------------- the CSS contract ---------------- */

describe('swipe surface contract', () => {
  it('styles.css gives the stage pan-y so vertical scroll is never hijacked', () => {
    const css = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');
    expect(css).toContain('.db-stage, .db-swipe { touch-action: pan-y; }');
    expect(css).toContain('.db-swipe.enter-next');
    expect(css).toContain('@keyframes db-swipe-in-next');
  });
});
