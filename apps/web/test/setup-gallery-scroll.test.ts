/**
 * @vitest-environment happy-dom
 *
 * SETUP GALLERY MOUNT BEHAVIOR — the behavior half of the scroll-safety pins
 * (see setup-scroll-safety.test.ts for the full story). Mounting DeckGallery
 * must park the slider on the current deck by moving ONLY the slider's own
 * scrollLeft. scrollIntoView must never fire: in a real engine it scrolls
 * every scrollable ancestor — .wizard included — and strands the setup
 * screen shifted sideways (owner report, 2026-10-23).
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeckGallery } from '../src/DeckGallery';
import { invalidateStoryProgress } from '../src/storyDecks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let el: HTMLDivElement;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

function GalleryHarness() {
  const [v, setV] = useState('harlem');
  return createElement(DeckGallery, { value: v, onChange: (nv: string) => setV(nv) });
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
  invalidateStoryProgress();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('setup gallery mount behavior', () => {
  it('centers the current deck by moving only the slider scrollLeft; scrollIntoView is never called', async () => {
    const siv = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, writable: true, value: siv });
    // Geometry: slider spans [0..366]; the selected cover sits at [500..632].
    // Centering must move the slider's scrollLeft by (500+66) - (0+183) = 383.
    const origRect = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      const cls = (this as HTMLElement).classList;
      if (cls?.contains('deck-gallery')) return { left: 0, right: 366, width: 366, top: 0, bottom: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
      if (cls?.contains('dg-cover') && cls?.contains('on')) return { left: 500, right: 632, width: 132, top: 0, bottom: 200, height: 200, x: 500, y: 0, toJSON: () => ({}) } as DOMRect;
      return origRect.call(this);
    };
    try {
      await act(async () => { root.render(createElement(GalleryHarness)); });
      await flush(); await flush();
      const list = el.querySelector('.deck-gallery') as HTMLElement;
      expect(list).not.toBeNull();
      expect(siv).not.toHaveBeenCalled();
      expect(list.scrollLeft).toBe(383);
    } finally {
      HTMLElement.prototype.getBoundingClientRect = origRect;
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
