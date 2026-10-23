/**
 * @vitest-environment happy-dom
 *
 * SETUP REWORK — DECK GALLERY + BROWSER + BOTTOM BAR (owner, 2026-10-23):
 * the create action is anchored in a fixed bottom bar carrying a live
 * summary (mode · deck · venue · target); decks are chosen from a gallery
 * slider whose covers open a full deck browser; the choice is made inside
 * the browser and the slider, browser, and bar summary always agree.
 * Locked story decks can be BROWSED (looking is free) but their Use action
 * honors the lock exactly like the old picker did.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from '../src/Setup';
import { DeckGallery } from '../src/DeckGallery';
import { DECKS } from '../src/decks';
import { invalidateStoryProgress } from '../src/storyDecks';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let el: HTMLDivElement;
const qs = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
}

/** Progress payloads per test: default = no clears (story decks locked). */
let progressJson: unknown = {};
function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).startsWith('/api/story/progress') ? progressJson : String(url).startsWith('/api/tables') ? { tables: [] } : {}),
  })));
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
  FakeWebSocket.instances = [];
  progressJson = {};
  invalidateStoryProgress();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  stubFetch();
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); vi.unstubAllGlobals(); });

/* ---------------- gallery alone ---------------- */

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

describe('deck gallery slider', () => {
  it('renders one large cover per deck, the current deck unmistakable', async () => {
    await renderGallery('harlem');
    expect(el.querySelectorAll('.dg-cover')).toHaveLength(DECKS.length);
    const harlem = qs('[data-testid=deck-harlem]');
    expect(harlem?.classList.contains('on')).toBe(true);
    expect(harlem?.textContent).toContain('Harlem');
    expect(harlem?.textContent).toContain('Your deck');
    expect(harlem?.textContent).toContain('Uptown royalty');
    // a locked story cover shows its unlock line instead of a tagline
    const pjs = qs('[data-testid=deck-pjs]');
    expect(pjs?.classList.contains('locked')).toBe(true);
    expect(pjs?.textContent).toContain("Clear The Pj's in Story Mode");
    expect((pjs as HTMLButtonElement).disabled).toBe(false);
  });

  it('a saved deck that is locked for this player falls back to Classic once progress loads', async () => {
    await renderGallery('pjs');
    expect(changes).toContain('classic');
  });
});

describe('deck browser', () => {
  it('opens from a cover with the deck explanation and every card browsable', async () => {
    await renderGallery();
    await click(qs('[data-testid=deck-harlem]'));
    const browser = qs('[data-testid=deck-browser]');
    expect(browser).not.toBeNull();
    expect(browser?.textContent).toContain('Harlem');
    expect(browser?.textContent).toContain("love letter to Harlem's golden age");
    // the full 54-card set is on the sheet (art tiles + index-face tiles)
    const tiles = el.querySelectorAll('.db-tile');
    expect(tiles).toHaveLength(54);
    expect(qs('[data-testid=deck-card-KS]')).not.toBeNull();
    expect(qs('[data-testid=deck-card-7H]')).not.toBeNull();
    expect(qs('[data-testid=deck-card-BJ]')).not.toBeNull();
    await click(qs('[data-testid=deck-browser-close]'));
    expect(qs('[data-testid=deck-browser]')).toBeNull();
  });

  it('Revolutionaries close-up shows the figure fact from the game tribute table', async () => {
    await renderGallery();
    await click(qs('[data-testid=deck-revolutionaries]'));
    await click(qs('[data-testid=deck-card-KS]'));
    const focus = qs('[data-testid=deck-card-focus]');
    expect(focus?.textContent).toContain('King of Spades');
    const fact = qs('[data-testid=deck-card-fact]');
    expect(fact?.textContent).toContain('Frederick Douglass');
    expect(fact?.textContent).toContain('escaped slavery at twenty');
    // prev steps to the Queen of Spades — Harriet Tubman (Truth holds the QH)
    await click(qs('[data-testid=deck-card-prev]'));
    expect(qs('[data-testid=deck-card-focus]')?.textContent).toContain('Queen of Spades');
    expect(qs('[data-testid=deck-card-fact]')?.textContent).toContain('Harriet Tubman');
    // the Little Joker carries no figure — no fact block, no fabrication
    await click(qs('[data-testid=deck-all-cards]'));
    await click(qs('[data-testid=deck-card-LJ]'));
    expect(qs('[data-testid=deck-card-focus]')?.textContent).toContain('Little Joker');
    expect(qs('[data-testid=deck-card-fact]')).toBeNull();
  });

  it('a standard deck close-up shows the card and NO fact', async () => {
    await renderGallery();
    await click(qs('[data-testid=deck-classic]'));
    await click(qs('[data-testid=deck-card-QS]'));
    expect(qs('[data-testid=deck-card-focus]')?.textContent).toContain('Queen of Spades');
    expect(qs('[data-testid=deck-card-fact]')).toBeNull();
    await click(qs('[data-testid=deck-all-cards]'));
    await click(qs('[data-testid=deck-card-7H]'));
    expect(qs('[data-testid=deck-card-focus]')?.textContent).toContain('Seven of Hearts');
    expect(qs('[data-testid=deck-card-fact]')).toBeNull();
  });

  it('choosing inside the browser selects the deck and closes back to the slider', async () => {
    await renderGallery();
    await click(qs('[data-testid=deck-harlem]'));
    await click(qs('[data-testid=deck-use-harlem]'));
    expect(changes).toEqual(['harlem']);
    expect(qs('[data-testid=deck-browser]')).toBeNull();
    expect(qs('[data-testid=deck-harlem]')?.classList.contains('on')).toBe(true);
    // reopening the now-current deck: Use is replaced by the current-deck state
    await click(qs('[data-testid=deck-harlem]'));
    const use = qs<HTMLButtonElement>('[data-testid=deck-use-harlem]');
    expect(use?.disabled).toBe(true);
    expect(use?.textContent).toContain('This is your deck');
  });

  it('a locked deck browses freely but cannot be used; the unlock line shows', async () => {
    await renderGallery();
    await click(qs('[data-testid=deck-pjs]'));
    const browser = qs('[data-testid=deck-browser]');
    expect(browser).not.toBeNull();
    expect(browser?.textContent).toContain("Clear The Pj's in Story Mode");
    // its cards still open up close — looking is free
    await click(qs('[data-testid=deck-card-KS]'));
    expect(qs('[data-testid=deck-card-focus]')).not.toBeNull();
    const use = qs<HTMLButtonElement>('[data-testid=deck-use-pjs]');
    expect(use?.disabled).toBe(true);
    expect(changes).toEqual([]);
  });

  it('a cleared stop unlocks its deck in the browser', async () => {
    progressJson = { track: 'solo', stops: [{ stopId: 'the-pjs', n: 9, state: 'cleared', attempts: 2, clears: 1, firstClearedAt: 1 }], currentStop: null, completed: false, completedAt: null, completionMark: null };
    invalidateStoryProgress();
    await renderGallery();
    expect(qs('[data-testid=deck-pjs]')?.classList.contains('locked')).toBe(false);
    await click(qs('[data-testid=deck-pjs]'));
    const use = qs<HTMLButtonElement>('[data-testid=deck-use-pjs]');
    expect(use?.disabled).toBe(false);
    await click(use);
    expect(changes).toEqual(['pjs']);
  });
});

/* ---------------- full wizard: bottom bar ---------------- */

function SetupHarness({ onStart }: { onStart: () => void }) {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [tips, setTips] = useState({ on: false, asked: true });
  return createElement(Setup, { settings: s, onChange: setS, tips, onTips: setTips, onStart });
}
async function toBotsTable(onStart: () => void) {
  await act(async () => { root.render(createElement(SetupHarness, { onStart })); });
  await flush();
  await click(qs('[data-testid=play]'));
  await click(qs('[data-testid=door-team]'));
  await click(qs('[data-testid=mode-joker]'));
  await click(qs('[data-testid=play-bots]'));
}

describe('bottom-anchored setup bar (vs bots)', () => {
  it('carries DEAL ME IN + a live summary; browser-chosen deck flows into both and into start', async () => {
    const onStart = vi.fn();
    await toBotsTable(onStart);
    const bar = qs('[data-testid=setup-bar]');
    expect(bar).not.toBeNull();
    // the commit action lives inside the bar, and the summary names the deal
    expect(bar?.querySelector('[data-testid=start-bots]')).not.toBeNull();
    const summary = qs('[data-testid=setup-bar-summary]');
    expect(summary?.textContent).toContain('Joker Spades');
    expect(summary?.textContent).toContain('Classic');
    expect(summary?.textContent).toContain('Play to 500');
    // choose Harlem from inside its browser — slider + summary agree
    await click(qs('[data-testid=deck-harlem]'));
    await click(qs('[data-testid=deck-use-harlem]'));
    expect(qs('[data-testid=deck-harlem]')?.classList.contains('on')).toBe(true);
    expect(qs('[data-testid=setup-bar-summary]')?.textContent).toContain('Harlem');
    // the flow still completes end-to-end
    await click(qs('[data-testid=start-bots]'));
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

describe('collapsible section cards', () => {
  it('each card folds independently from its header; Rules needs nothing unfolded first', async () => {
    await toBotsTable(() => {});
    const card = (label: string) => qs(`.setup-card[aria-label="${label}"]`);
    const toggle = (label: string) => card(label)?.querySelector('.setup-card-toggle') as HTMLButtonElement | null;
    // every card starts open, header text is exactly the card title
    for (const label of ['Your team', 'Bots & score', 'Deck & venue', 'Rules']) {
      expect(card(label)?.classList.contains('is-closed')).toBe(false);
      expect(toggle(label)?.getAttribute('aria-expanded')).toBe('true');
      expect(card(label)?.querySelector('.setup-card-h')?.textContent).toBe(label);
    }
    // fold Deck & venue: Rules stays open, its controls stay live in the DOM
    await click(toggle('Deck & venue'));
    expect(card('Deck & venue')?.classList.contains('is-closed')).toBe(true);
    expect(toggle('Deck & venue')?.getAttribute('aria-expanded')).toBe('false');
    expect(card('Rules')?.classList.contains('is-closed')).toBe(false);
    expect(qs('[data-testid=house-rules]')).not.toBeNull();
    // and it unfolds again
    await click(toggle('Deck & venue'));
    expect(card('Deck & venue')?.classList.contains('is-closed')).toBe(false);
  });
});

describe('bottom-anchored setup bar (online create)', () => {
  it('carries CREATE TABLE + the summary on the create step only', async () => {
    await act(async () => { root.render(createElement(SetupHarness, { onStart: () => {} })); });
    await flush();
    await click(qs('[data-testid=play]'));
    await click(qs('[data-testid=door-team]'));
    await click(qs('[data-testid=mode-joker]'));
    await click(qs('[data-testid=play-online]'));
    // lobby: no bar, no create submit
    expect(qs('[data-testid=setup-bar]')).toBeNull();
    await click(qs('[data-testid=create-open]'));
    const bar = qs('[data-testid=setup-bar]');
    expect(bar).not.toBeNull();
    expect(bar?.querySelector('[data-testid=create-table]')).not.toBeNull();
    expect(qs('[data-testid=setup-bar-summary]')?.textContent).toContain('Classic');
  });
});
