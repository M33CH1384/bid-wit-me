/**
 * @vitest-environment happy-dom
 *
 * SCORE LIVES IN HOUSE RULES ONLY (owner, 2026-11-05): "It shouldn't be
 * bots and score — the score can be changed in the house rules section."
 *
 * On the bot-game setup the Play-to seg sat in the "Bots & score" card
 * while the Rules card (the HOUSE RULES section) showed the target as a
 * static readout. These pins hold the MOVE: the seg's only home on the
 * setup screens is the Rules card — on the bots form exactly as it
 * already was on the create-a-table form (pinned in target-score.test.ts)
 * — writing the one shared Settings.targetScore that settingsToRules
 * carries into the dealt game. No rename of the "Bots & score" card:
 * naming is a separate owner decision; the card keeps its title and
 * simply no longer holds the score.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from '../src/Setup';
import { DEFAULT_SETTINGS, settingsToRules, type Settings } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let el: HTMLDivElement;
let latest: Settings = DEFAULT_SETTINGS;

function WizardHarness() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  latest = s;
  const [tips, setTips] = useState({ on: false, asked: true });
  return createElement(Setup, { settings: s, onChange: setS, tips, onTips: setTips, onStart: () => {} });
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
const qsa = (sel: string, from: Element | Document = el) => [...from.querySelectorAll(sel)];
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};
const targetSegs = (from: Element | Document = el) => qsa('[role="radiogroup"][aria-label="Target score"]', from);
const segButton = (seg: Element, text: string) => [...seg.querySelectorAll('button')].find((b) => b.textContent === text) ?? null;
const card = (label: string) => qs(`.setup-card[aria-label="${label}"]`);

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
async function toBotsForm(cutthroat = false) {
  await renderWizard();
  await click(qs('[data-testid=play]'));
  if (cutthroat) {
    await click(qs('[data-testid=door-cutthroat]'));
  } else {
    await click(qs('[data-testid=door-team]'));
    await click(qs('[data-testid=mode-joker]'));
  }
  await click(qs('[data-testid=play-bots]'));
}
async function toCreateForm() {
  await renderWizard();
  await click(qs('[data-testid=play]'));
  await click(qs('[data-testid=door-team]'));
  await click(qs('[data-testid=mode-joker]'));
  await click(qs('[data-testid=play-online]'));
  await click(qs('[data-testid=create-open]'));
}

describe('bots form — the score lives in the Rules card only', () => {
  it('renders the Target score seg inside the Rules card, preset selected', async () => {
    await toBotsForm();
    const rules = card('Rules');
    expect(rules).not.toBeNull();
    const segs = targetSegs(rules!);
    expect(segs).toHaveLength(1);
    expect([...segs[0].querySelectorAll('button')].map((b) => b.textContent)).toEqual(['250', '300', '500']);
    expect(segButton(segs[0], '500')?.getAttribute('aria-checked')).toBe('true');
  });

  it('has exactly ONE target seg on the whole form — none left in "Bots & score"', async () => {
    await toBotsForm();
    expect(targetSegs()).toHaveLength(1);
    const botsCard = card('Bots & score');
    expect(botsCard).not.toBeNull();
    expect(targetSegs(botsCard!)).toHaveLength(0);
    // the Bots skill seg still lives there — only the score moved
    expect(qs('[data-testid=bots-row]', botsCard!)).not.toBeNull();
  });

  it('picking 250 in the Rules card updates the stat row, the bar, and the dealt game\'s rules', async () => {
    await toBotsForm();
    await click(segButton(targetSegs(card('Rules')!)[0], '250'));
    expect(latest.targetScore).toBe(250);
    expect(settingsToRules(latest).targetScore).toBe(250);
    expect(qs('[data-testid=rules-stats]')?.textContent).toMatch(/250Play to/);
    expect(qs('[data-testid=setup-bar-summary]')?.textContent).toMatch(/Play to 250/);
  });

  it('picking the mode preset number stores Default, which resolves to the preset', async () => {
    await toBotsForm();
    await click(segButton(targetSegs(card('Rules')!)[0], '250'));
    expect(latest.targetScore).toBe(250);
    await click(segButton(targetSegs(card('Rules')!)[0], '500'));
    expect(latest.targetScore).toBe('default');
    expect(settingsToRules(latest).targetScore).toBe(500);
    expect(qs('[data-testid=rules-stats]')?.textContent).toMatch(/500Play to/);
  });

  it('cutthroat bots form: Rules card seg defaults to 300 and can be raised to 500', async () => {
    await toBotsForm(true);
    const segs = targetSegs(card('Rules')!);
    expect(segs).toHaveLength(1);
    expect(segButton(segs[0], '300')?.getAttribute('aria-checked')).toBe('true');
    await click(segButton(segs[0], '500'));
    expect(latest.targetScore).toBe(500);
    expect(settingsToRules(latest).targetScore).toBe(500);
    expect(qs('[data-testid=rules-stats]')?.textContent).toMatch(/500Play to/);
  });
});

describe('create-a-table form — still exactly one, still in Rules', () => {
  it('keeps its single Target score seg inside the Rules card', async () => {
    await toCreateForm();
    expect(targetSegs()).toHaveLength(1);
    expect(targetSegs(card('Rules')!)).toHaveLength(1);
  });
});
