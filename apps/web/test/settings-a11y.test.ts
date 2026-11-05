/**
 * @vitest-environment happy-dom
 *
 * SETTINGS A11Y + ROTATION (responsive audit 2026-11-05, Findings C + D):
 * in landscape the rail CSS force-shows the selected section while
 * SectionGroup set aria-hidden from the persisted accordion map alone —
 * Play / Sound / Look / Feedback were VISIBLE on a fresh device yet
 * aria-hidden="true", and focusable inside the hidden subtree. And the
 * sheet kept two unsynchronised "where am I" stores: the persisted
 * accordion map (portrait) and a session tab (landscape), so rotation
 * changed the section under the user.
 *
 * Pins (Phase 2 fix): ONE session activeSection drives both layouts —
 * landscape rail reads it; portrait presents openMap[id] || id===active.
 * aria-hidden / inert / tabpanel wiring all derive from the same
 * effective-open value. Rail clicks and rotations NEVER write
 * bwm.settingsSections.v1. The rail is a complete tab pattern (ids,
 * aria-controls, tabpanel + aria-labelledby, roving tabindex, arrow
 * keys) in rail layout, and plain accordion semantics in portrait.
 * The dialog is aria-modal, takes initial focus, and restores focus to
 * its invoker on close. Orientation is simulated by stubbing matchMedia
 * for the sheet's exact rail query (house idiom, cf. deck-gallery).
 */
import { createElement } from 'react';
import MoreOptions from '../src/MoreOptions';
import { DEFAULT_SETTINGS } from '../src/settings';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Timeout budget: the sheet module graph is heavy and parallel-lane load
// inflates first-render cost — measured cost, not a hang (same flake class
// as sound-consolidation.test.ts, 2026-10-23).
vi.setConfig({ testTimeout: 20000 });

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');
const KEY = 'bwm.settingsSections.v1';

/* --- controllable rail-layout matchMedia stub --------------------------- */
let railMatches = false;
let mqListener: (() => void) | null = null;
function stubMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({
      // the sheet's rail query is the only one this suite drives
      matches: q.includes('540px') && q.includes('1000px') ? railMatches : false,
      media: q,
      addEventListener: (_: string, cb: () => void) => { mqListener = cb; },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }),
  });
}
async function setRail(v: boolean) {
  railMatches = v;
  await act(async () => { mqListener?.(); });
}

/* --- render helpers ------------------------------------------------------ */
let root: Root | null = null;
let el: HTMLDivElement | null = null;

function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}

afterEach(() => {
  unmount();
  localStorage.clear();
  sessionStorage.clear();
  railMatches = false;
  mqListener = null;
  vi.restoreAllMocks();
});

async function renderSheet(extra: Record<string, unknown> = {}, rail = false) {
  railMatches = rail;
  stubMatchMedia();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  const props = {
    settings: DEFAULT_SETTINGS,
    onChange: () => {},
    tips: { on: false, asked: true },
    onTips: () => {},
    onClose: () => {},
    ...extra,
  };
  await act(async () => { root!.render(createElement(MoreOptions, props)); });
  return el;
}

const group = (c: HTMLElement, label: string) => c.querySelector(`.set-group[aria-label="${label}"]`)!;
const bodyOf = (g: Element) => g.querySelector('.set-group-body') as HTMLElement;
const tab = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="settings-tab-${id}"]`) as HTMLButtonElement;
const exposed = (g: Element) => bodyOf(g).getAttribute('aria-hidden') !== 'true' && !bodyOf(g).hasAttribute('inert');
const hiddenHard = (g: Element) => bodyOf(g).getAttribute('aria-hidden') === 'true' && bodyOf(g).hasAttribute('inert');

async function click(btn: HTMLElement) { await act(async () => { btn.click(); }); }

describe('Finding C — effective-open drives aria, in rail layout', () => {
  it('fresh profile: the rail-selected section is exposed; the others are aria-hidden AND inert', async () => {
    const c = await renderSheet({}, true);
    // default landing: House selected and exposed
    expect(tab(c, 'house').getAttribute('aria-selected')).toBe('true');
    expect(exposed(group(c, 'House rules'))).toBe(true);
    expect(hiddenHard(group(c, 'Play'))).toBe(true);
    // select Play (stored closed): it RENDERS in landscape, so it must be exposed + focusable
    await click(tab(c, 'play'));
    expect(exposed(group(c, 'Play'))).toBe(true);
    expect(group(c, 'Play').querySelector('[data-testid="bot-skill"]')).not.toBeNull();
    expect(hiddenHard(group(c, 'House rules'))).toBe(true);
    // and the same for Sound / Look / Feedback
    await click(tab(c, 'sound'));
    expect(exposed(group(c, 'Sound & music'))).toBe(true);
    await click(tab(c, 'look'));
    expect(exposed(group(c, 'Look & effects'))).toBe(true);
    await click(tab(c, 'beta'));
    expect(exposed(group(c, 'Beta feedback & support'))).toBe(true);
  });

  it('tab pattern is complete in rail layout: ids, aria-controls, tabpanel, roving tabindex', async () => {
    const c = await renderSheet({}, true);
    for (const id of ['house', 'play', 'sound', 'look', 'beta']) {
      const t = tab(c, id);
      expect(t.id, id).toBe(`settings-tab-${id}`);
      expect(t.getAttribute('aria-controls'), id).toBe(`settings-panel-${id}`);
      const panel = c.querySelector(`#settings-panel-${id}`)!;
      expect(panel, id).not.toBeNull();
      expect(panel.getAttribute('role'), id).toBe('tabpanel');
      expect(panel.getAttribute('aria-labelledby'), id).toBe(`settings-tab-${id}`);
    }
    expect(tab(c, 'house').tabIndex).toBe(0);
    for (const id of ['play', 'sound', 'look', 'beta']) expect(tab(c, id).tabIndex, id).toBe(-1);
    await click(tab(c, 'sound'));
    expect(tab(c, 'sound').tabIndex).toBe(0);
    expect(tab(c, 'house').tabIndex).toBe(-1);
  });

  it('arrow / Home / End keys move rail selection AND focus', async () => {
    const c = await renderSheet({}, true);
    const house = tab(c, 'house');
    await act(async () => { house.focus(); });
    const key = async (k: string) => {
      await act(async () => {
        (document.activeElement as HTMLElement).dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true }));
      });
    };
    await key('ArrowRight');
    expect(tab(c, 'play').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab(c, 'play'));
    await key('End');
    expect(document.activeElement).toBe(tab(c, 'beta'));
    await key('ArrowRight'); // wraps
    expect(document.activeElement).toBe(tab(c, 'house'));
    await key('ArrowLeft'); // wraps back
    expect(document.activeElement).toBe(tab(c, 'beta'));
    await key('Home');
    expect(document.activeElement).toBe(tab(c, 'house'));
  });
});

describe('Finding C — portrait keeps plain accordion semantics', () => {
  it('no tabpanel roles in portrait; aria follows the effective (map || active) state', async () => {
    localStorage.setItem(KEY, JSON.stringify({ house: false, play: false, sound: false, look: false, beta: false }));
    const c = await renderSheet({}, false);
    for (const g of c.querySelectorAll('.set-group')) {
      expect(bodyOf(g).getAttribute('role')).toBeNull();
      expect(hiddenHard(g), g.getAttribute('aria-label')!).toBe(true);
    }
  });

  it('dialog is aria-modal, takes initial focus, and restores focus to its invoker on close', async () => {
    const invoker = document.createElement('button');
    invoker.textContent = 'gear';
    document.body.appendChild(invoker);
    await act(async () => { invoker.focus(); });
    expect(document.activeElement).toBe(invoker);
    const c = await renderSheet({}, false);
    const sheet = c.querySelector('[data-testid="more-options"]')!;
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    // focus moved INTO the sheet (the dialog element itself)
    expect(document.activeElement).toBe(sheet);
    unmount();
    expect(document.activeElement).toBe(invoker);
    invoker.remove();
  });

  it('.set-group-toggle has a :focus-visible style consistent with the sheet', () => {
    expect(css).toMatch(/\.set-group-toggle:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold-hi\)/);
  });
});

describe('Finding D — one activeSection across rotation', () => {
  it('init: first stored-open section becomes active (rail lands on it)', async () => {
    localStorage.setItem(KEY, JSON.stringify({ house: false, play: false, sound: false, look: true, beta: true }));
    const c = await renderSheet({}, true);
    expect(tab(c, 'look').getAttribute('aria-selected')).toBe('true');
    expect(exposed(group(c, 'Look & effects'))).toBe(true);
  });

  it('portrait-opened section survives rotation to landscape; landscape-picked section survives rotation back', async () => {
    const c = await renderSheet({}, false);
    // portrait: open Play via its accordion toggle (existing, persisted behaviour)
    const playToggle = group(c, 'Play').querySelector('button.set-group-toggle') as HTMLButtonElement;
    await click(playToggle);
    const storedAfterToggle = localStorage.getItem(KEY);
    expect(JSON.parse(storedAfterToggle!)).toMatchObject({ play: true });
    // rotate to landscape on the SAME mount: Play is the selected, exposed tab
    await setRail(true);
    expect(tab(c, 'play').getAttribute('aria-selected')).toBe('true');
    expect(exposed(group(c, 'Play'))).toBe(true);
    // pick Sound on the rail, rotate back: Sound presents open in portrait
    await click(tab(c, 'sound'));
    await setRail(false);
    const soundBody = bodyOf(group(c, 'Sound & music'));
    expect(soundBody.classList.contains('open')).toBe(true);
    expect(exposed(group(c, 'Sound & music'))).toBe(true);
    // persistence fence: rail clicks + rotations wrote NOTHING
    expect(localStorage.getItem(KEY)).toBe(storedAfterToggle);
  });

  it('speaker landing (initialSection=sound) takes over activeSection in both orientations', async () => {
    (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = vi.fn();
    const c = await renderSheet({ initialSection: 'sound', anchorSeq: 1 }, true);
    expect(tab(c, 'sound').getAttribute('aria-selected')).toBe('true');
    expect(exposed(group(c, 'Sound & music'))).toBe(true);
    expect(localStorage.getItem(KEY)).toBeNull(); // landing wrote nothing
    await setRail(false);
    expect(exposed(group(c, 'Sound & music'))).toBe(true); // survives rotation, as before
  });

  it('closing the active section in portrait folds it (takeover semantics preserved)', async () => {
    const c = await renderSheet({ initialSection: 'sound', anchorSeq: 1 }, false);
    (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = vi.fn();
    expect(exposed(group(c, 'Sound & music'))).toBe(true);
    const soundToggle = group(c, 'Sound & music').querySelector('button.set-group-toggle') as HTMLButtonElement;
    await click(soundToggle);
    expect(hiddenHard(group(c, 'Sound & music'))).toBe(true);
    expect(JSON.parse(localStorage.getItem(KEY)!)).toMatchObject({ sound: false });
  });
});
