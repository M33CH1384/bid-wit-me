/**
 * @vitest-environment happy-dom
 *
 * Owner decision 2026-11-05 (responsive audit Finding H / gap G5): the
 * ONLINE create form gets the venue preview the bots setup already has.
 * One component (SetupPreview), two hosts — the online host renders the
 * SAME element inside its Deck & venue card, driven by the form's own
 * venue/deck picks. Locked venues keep the picker's locked presentation:
 * VenueSelect disables them, so a locked venue can never become the
 * previewed selection on either path (no preview backdoor).
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from '../src/Setup';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { deckName } from '../src/decks';
import { VENUE_DEFS, invalidateVenueUnlocks } from '../src/venues';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let el: HTMLDivElement; let current: Settings;
function Harness({ initial }: { initial?: Partial<Settings> }) {
  const [s, setS] = useState<Settings>({ ...DEFAULT_SETTINGS, ...initial });
  const [tips, setTips] = useState({ on: false, asked: true });
  current = s;
  return createElement(Setup, { settings: s, onChange: setS, tips, onTips: setTips, onStart: () => {} });
}
const click = async (testid: string) => { await act(async () => { document.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!.click(); }); };
async function toTable(path: 'play-bots' | 'play-online') {
  await click('play'); await click('door-team'); await click('mode-joker'); await click(path);
}
async function toOnlineCreate(initial?: Partial<Settings>) {
  await act(async () => { root.render(createElement(Harness, { initial })); });
  await toTable('play-online');
  await click('create-open');
}
function pickVenue(value: string) {
  const sel = document.querySelector<HTMLSelectElement>('[data-testid="venue-select-setup"]')!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  act(() => { setter.call(sel, value); sel.dispatchEvent(new window.Event('change', { bubbles: true })); });
  return sel;
}
const preview = () => document.querySelector<HTMLElement>('[data-testid="setup-preview"]');

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true }));
  history.replaceState(null, '', '/');
  invalidateVenueUnlocks();
  el = document.createElement('div'); document.body.appendChild(el); root = createRoot(el);
});
afterEach(() => { act(() => { root.unmount(); }); el.remove(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals(); invalidateVenueUnlocks(); });

describe('venue preview in online table creation (owner 2026-11-05, audit G5)', () => {
  it('online create renders the shared preview inside the Deck & venue card, after the venue picker', async () => {
    await toOnlineCreate();
    const p = preview();
    expect(p).not.toBeNull();
    expect(document.querySelectorAll('[data-testid="setup-preview"]')).toHaveLength(1);
    // same element, same data contract as the bots host
    expect(p!.dataset.venue).toBe('classic');
    expect(p!.dataset.deck).toBe(current.deck);
    expect(p!.getAttribute('aria-label')).toBe(`Preview: ${VENUE_DEFS.classic.name}, ${deckName(current.deck)} deck`);
    // hosted inside the Deck & venue card (never a direct child of .ess, so the
    // bots land-tab :has(> .setup-preview) grid can never claim this form)
    const card = p!.closest('.setup-card');
    expect(card?.getAttribute('aria-label')).toBe('Deck & venue');
    expect(p!.parentElement!.classList.contains('ess')).toBe(false);
    // after the venue picker in reading order
    const row = document.querySelector('[data-testid="venue-row"]')!;
    expect(row.compareDocumentPosition(p!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('switching the venue selection switches the preview (backdrop, caption, deck)', async () => {
    await toOnlineCreate();
    pickVenue('yacht');
    const p = preview()!;
    expect(p.dataset.venue).toBe('yacht');
    expect(p.getAttribute('aria-label')).toContain(VENUE_DEFS.yacht.name);
    expect(p.textContent).toContain(VENUE_DEFS.yacht.name);
    expect(p.style.getPropertyValue('--sp-bg')).toContain('/assets/venues/yacht/bg.jpg');
    // deck pick drives it too: first tap on a gallery tile chooses the deck
    await click('deck-harlem');
    expect(current.deck).toBe('harlem');
    expect(preview()!.dataset.deck).toBe('harlem');
    expect(preview()!.textContent).toContain(deckName('harlem'));
    pickVenue('random');
    expect(preview()!.dataset.venue).toBe('random');
    expect(preview()!.textContent).toContain('Random venue');
  });

  it('locked venue (The Pj\'s) keeps its locked presentation — the preview can never present it as chosen', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/profile/me')) {
        return { ok: true, json: async () => ({ unlocks: [], dev: false, storyAccess: false }) };
      }
      return { ok: false, json: async () => ({}) };
    }));
    // even with a stale/forged saved pick of the locked venue…
    await toOnlineCreate({ venue: 'blockAfterDark' });
    // …the picker converges to classic once the unlock state lands, and the
    // locked option itself stays disabled with its 🔒 label
    const sel = document.querySelector<HTMLSelectElement>('[data-testid="venue-select-setup"]')!;
    const pjs = [...sel.options].find((o) => o.value === 'blockAfterDark')!;
    expect(pjs.disabled).toBe(true);
    expect(pjs.textContent).toContain('🔒');
    expect(current.venue).toBe('classic');
    expect(preview()!.dataset.venue).toBe('classic');
  });

  it('bots setup keeps its own preview exactly as before (direct child of the essentials column)', async () => {
    await act(async () => { root.render(createElement(Harness, {})); });
    await toTable('play-bots');
    const p = preview();
    expect(p).not.toBeNull();
    expect(document.querySelectorAll('[data-testid="setup-preview"]')).toHaveLength(1);
    expect(p!.parentElement!.classList.contains('ess-barred')).toBe(true);
    expect(p!.closest('.setup-card')).toBeNull();
    pickVenue('yacht');
    expect(preview()!.dataset.venue).toBe('yacht');
  });
});
