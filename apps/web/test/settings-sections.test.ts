/**
 * @vitest-environment happy-dom
 *
 * COLLAPSIBLE SETTINGS SECTIONS + HOUSE RULES FIRST (owner, 2026-10-23):
 * "The game setting sections should be collapsible given some people only
 * want to change the house rules. (Should be at top)"
 *
 * Pins: House rules is the first group and the only one open on a fresh
 * device; every group header toggles its group (bodies stay MOUNTED —
 * folding is presentation, so a folded group's controls remain in the DOM
 * and keep their state); a player's arrangement persists per device under
 * bwm.settingsSections.v1 and is honored on the next open; a targeted entry
 * (the speaker's initialSection="sound") forces its group open for that
 * open WITHOUT rewriting the stored arrangement, until the player toggles
 * it themselves; reduced motion makes the fold instant (CSS pin).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');

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
});

async function renderSheet(extra: Record<string, unknown> = {}) {
  const { default: MoreOptions } = await import('../src/MoreOptions');
  const { DEFAULT_SETTINGS } = await import('../src/settings');
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
  await act(async () => {
    root!.render(createElement(MoreOptions, props));
  });
  return { c: el, props };
}

const group = (c: HTMLElement, label: string) => c.querySelector(`.set-group[aria-label="${label}"]`)!;
const toggleOf = (g: Element) => g.querySelector('button.set-group-toggle') as HTMLButtonElement;
const bodyOf = (g: Element) => g.querySelector('.set-group-body')!;
const isOpen = (g: Element) => toggleOf(g).getAttribute('aria-expanded') === 'true' && bodyOf(g).classList.contains('open');

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.click();
  });
}

const storedMap = () => JSON.parse(localStorage.getItem('bwm.settingsSections.v1') ?? 'null');

describe('section order + fresh-device defaults', () => {
  it('House rules leads, and only House rules is open on a fresh device', async () => {
    const { c } = await renderSheet();
    const labels = [...c.querySelectorAll('.set-group')].map((g) => g.getAttribute('aria-label'));
    expect(labels).toEqual(['House rules', 'Play', 'Sound & music', 'Look & effects', 'Beta feedback & support']);
    expect(isOpen(group(c, 'House rules'))).toBe(true);
    for (const label of ['Play', 'Sound & music', 'Look & effects', 'Beta feedback & support']) {
      expect(isOpen(group(c, label)), label).toBe(false);
    }
    // nothing is written to storage by merely opening the sheet
    expect(localStorage.getItem('bwm.settingsSections.v1')).toBeNull();
  });

  it('house-rules controls are reachable immediately; folded groups stay mounted', async () => {
    const { c } = await renderSheet();
    const house = group(c, 'House rules');
    // DEFAULT_SETTINGS plays partnerships: the partnership house rows render
    expect(house.querySelector('[data-testid="first-hand-min"]')).not.toBeNull();
    expect(house.querySelector('button[aria-label="Shot = out"]')).not.toBeNull();
    // folded, but present in its group (fold = presentation, never unmount)
    expect(group(c, 'Play').querySelector('[data-testid="bot-skill"]')).not.toBeNull();
    expect(group(c, 'Sound & music').getAttribute('data-testid')).toBe('settings-sound-group');
    expect(group(c, 'Sound & music').querySelector('[data-testid="chat-sounds-switch"]')).not.toBeNull();
    expect(group(c, 'Look & effects').querySelector('[data-testid="venue-select"]')).not.toBeNull();
  });
});

describe('toggling + per-device persistence', () => {
  it('a header click folds/unfolds its group and persists the arrangement', async () => {
    const { c } = await renderSheet();
    await click(toggleOf(group(c, 'Play')));
    expect(isOpen(group(c, 'Play'))).toBe(true);
    expect(storedMap()).toEqual({ house: true, play: true, sound: false, look: false, beta: false });

    await click(toggleOf(group(c, 'House rules')));
    expect(isOpen(group(c, 'House rules'))).toBe(false);
    expect(storedMap()).toEqual({ house: false, play: true, sound: false, look: false, beta: false });
  });

  it('the stored arrangement is honored on the next open', async () => {
    const { c } = await renderSheet();
    await click(toggleOf(group(c, 'Play')));
    await click(toggleOf(group(c, 'House rules')));
    unmount();
    const again = await renderSheet();
    expect(isOpen(group(again.c, 'House rules'))).toBe(false);
    expect(isOpen(group(again.c, 'Play'))).toBe(true);
    expect(isOpen(group(again.c, 'Sound & music'))).toBe(false);
  });

  it('a pre-seeded arrangement is honored (and a malformed one falls back to defaults)', async () => {
    localStorage.setItem('bwm.settingsSections.v1', JSON.stringify({ house: false, play: false, sound: false, look: true, beta: true }));
    const { c } = await renderSheet();
    expect(isOpen(group(c, 'House rules'))).toBe(false);
    expect(isOpen(group(c, 'Look & effects'))).toBe(true);
    expect(isOpen(group(c, 'Beta feedback & support'))).toBe(true);
    unmount();
    localStorage.setItem('bwm.settingsSections.v1', '{not json');
    const again = await renderSheet();
    expect(isOpen(group(again.c, 'House rules'))).toBe(true);
    expect(isOpen(group(again.c, 'Play'))).toBe(false);
  });
});

describe('targeted entry (the speaker lands on Sound & music)', () => {
  it('forces Sound open for that open without rewriting the stored arrangement', async () => {
    localStorage.setItem('bwm.settingsSections.v1', JSON.stringify({ house: true, play: false, sound: false, look: false, beta: false }));
    const spy = vi.fn();
    (window.HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = spy;
    const { c } = await renderSheet({ initialSection: 'sound', anchorSeq: 1 });
    expect(isOpen(group(c, 'Sound & music'))).toBe(true);
    expect(spy).toHaveBeenCalled();
    // the stored map still says sound is folded — the landing rewrote nothing
    expect(storedMap()).toEqual({ house: true, play: false, sound: false, look: false, beta: false });
  });

  it('a manual toggle of the forced group takes over and persists', async () => {
    const { c } = await renderSheet({ initialSection: 'sound', anchorSeq: 1 });
    expect(isOpen(group(c, 'Sound & music'))).toBe(true);
    await click(toggleOf(group(c, 'Sound & music')));
    expect(isOpen(group(c, 'Sound & music'))).toBe(false);
    expect(storedMap()?.sound).toBe(false);
  });
});

describe('fold mechanics', () => {
  it('the fold animates on the grid-rows track and reduced motion makes it instant', () => {
    const tail = css.slice(css.indexOf('Collapsible Settings sections'));
    expect(tail).toContain('.set-group-body { display: grid; grid-template-rows: 0fr;');
    expect(tail).toContain('.set-group-body.open { grid-template-rows: 1fr;');
    const reduced = tail.slice(tail.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.set-group-body, .set-group-body.open { transition: none; }');
    expect(reduced).toContain('.set-chev { transition: none; }');
  });
});
