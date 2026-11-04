/**
 * @vitest-environment happy-dom
 *
 * END SCORE AT CREATE-A-TABLE (owner, 2026-11-03): "The house rules section
 * should allow me to set the end score — as it stands now when I create a
 * table I can't edit it."
 *
 * Before this change the end score was settable ONLY vs bots (the "Play to"
 * seg on the bots form) and after the fact in the room lobby. The create-a-
 * table form showed it read-only (the Rules card's stat line) and the
 * Settings sheet's House rules group — the section the create form's HOUSE
 * RULES button opens — had no target row at all.
 *
 * These pins hold the fix: the SAME seg the bots form offers (250 / 300 /
 * 500, the mode's own preset number acting as Default — SPEC's option list)
 * now sits (a) in the create form's Rules card and (b) at the top of the
 * sheet's House rules group, both writing the one shared Settings value
 * that settingsToRules carries into the created room.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from '../src/Setup';
import MoreOptions from '../src/MoreOptions';
import { DEFAULT_SETTINGS, settingsToRules, targetScoreOptions, type Settings } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let el: HTMLDivElement;
let latest: Settings = DEFAULT_SETTINGS;

function WizardHarness() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  latest = s;
  const [tips, setTips] = useState({ on: false, asked: true });
  return createElement(Setup, { settings: s, onChange: setS, tips, onTips: setTips, onStart: () => {} });
}
function SheetHarness() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  latest = s;
  return createElement(MoreOptions, {
    settings: s, onChange: setS,
    tips: { on: false, asked: true }, onTips: () => {}, onClose: () => {},
  });
}

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

const qs = <T extends Element = HTMLElement>(sel: string, from: Element | Document = el) => from.querySelector(sel) as T | null;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};
const targetSeg = (from: Element | Document = el) => qs('[role="radiogroup"][aria-label="Target score"]', from);
const segButton = (seg: Element, text: string) => [...seg.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
  FakeWebSocket.instances = [];
  latest = DEFAULT_SETTINGS;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).startsWith('/api/tables') ? { tables: [] } : {}),
  })));
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); vi.unstubAllGlobals(); });

async function renderWizard() {
  await act(async () => { root.render(createElement(WizardHarness)); });
  await flush();
}
async function toCreateForm(cutthroat = false) {
  await renderWizard();
  await click(qs('[data-testid=play]'));
  if (cutthroat) {
    await click(qs('[data-testid=door-cutthroat]'));
  } else {
    await click(qs('[data-testid=door-team]'));
    await click(qs('[data-testid=mode-joker]'));
  }
  await click(qs('[data-testid=play-online]'));
  await click(qs('[data-testid=create-open]'));
}

describe('settings → rules: the target mapping', () => {
  it('offers exactly the game\'s list, with the mode preset acting as Default', () => {
    expect(targetScoreOptions({ ...DEFAULT_SETTINGS, mode: 'joker' })).toEqual([[250, '250'], [300, '300'], ['default', '500']]);
    expect(targetScoreOptions({ ...DEFAULT_SETTINGS, mode: 'aceDown' })).toEqual([[250, '250'], [300, '300'], ['default', '500']]);
    expect(targetScoreOptions({ ...DEFAULT_SETTINGS, mode: 'cutthroat4' })).toEqual([[250, '250'], ['default', '300'], [500, '500']]);
  });

  it('default follows the mode preset; an explicit pick overrides it', () => {
    expect(settingsToRules({ ...DEFAULT_SETTINGS, mode: 'joker' }).targetScore).toBe(500);
    expect(settingsToRules({ ...DEFAULT_SETTINGS, mode: 'aceDown' }).targetScore).toBe(500);
    expect(settingsToRules({ ...DEFAULT_SETTINGS, mode: 'cutthroat4' }).targetScore).toBe(300);
    expect(settingsToRules({ ...DEFAULT_SETTINGS, mode: 'joker', targetScore: 250 }).targetScore).toBe(250);
    expect(settingsToRules({ ...DEFAULT_SETTINGS, mode: 'cutthroat4', targetScore: 500 }).targetScore).toBe(500);
  });
});

describe('create-a-table form — end score', () => {
  it('renders the Target score seg in the Rules card, preset selected', async () => {
    await toCreateForm();
    const seg = targetSeg();
    expect(seg).not.toBeNull();
    // the seg lives in the Rules card, beside the stat line it edits
    const card = seg!.closest('.setup-card');
    expect(card?.getAttribute('aria-label')).toBe('Rules');
    expect([...seg!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['250', '300', '500']);
    expect(segButton(seg!, '500')?.getAttribute('aria-checked')).toBe('true');
  });

  it('picking 250 flows into the settings the room is created with — stat line and bar agree', async () => {
    await toCreateForm();
    await click(segButton(targetSeg()!, '250'));
    expect(latest.targetScore).toBe(250);
    expect(settingsToRules(latest).targetScore).toBe(250);
    expect(qs('[data-testid=rules-stats]')?.textContent).toMatch(/250Play to/);
    expect(qs('[data-testid=setup-bar-summary]')?.textContent).toMatch(/Play to 250/);
    expect(segButton(targetSeg()!, '250')?.getAttribute('aria-checked')).toBe('true');
  });

  it('cutthroat create form defaults to 300 and can be raised to 500', async () => {
    await toCreateForm(true);
    const seg = targetSeg();
    expect(seg).not.toBeNull();
    expect(segButton(seg!, '300')?.getAttribute('aria-checked')).toBe('true');
    await click(segButton(seg!, '500'));
    expect(latest.targetScore).toBe(500);
    expect(settingsToRules(latest).targetScore).toBe(500);
  });
});

describe('Settings sheet — House rules group', () => {
  it('carries the Target score seg as a house rule, writing the same shared setting', async () => {
    await act(async () => { root.render(createElement(SheetHarness)); });
    await flush();
    const house = [...el.querySelectorAll('.set-group')].find((g) => g.getAttribute('aria-label') === 'House rules');
    expect(house).toBeTruthy();
    const seg = targetSeg(house!);
    expect(seg).not.toBeNull();
    expect(segButton(seg!, '500')?.getAttribute('aria-checked')).toBe('true');
    await click(segButton(seg!, '300'));
    expect(latest.targetScore).toBe(300);
    expect(settingsToRules(latest).targetScore).toBe(300);
  });
});
