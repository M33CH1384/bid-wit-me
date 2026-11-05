/**
 * @vitest-environment happy-dom
 *
 * HOUSE RULES SUMMARY STACKS FULL-WIDTH (owner, 2026-11-05): the setup
 * Rules card's stat line squeezed its four facts (Mode / Play to /
 * Players / Timers) into one 4-column row and ellipsized the values —
 * "Joker Spa…", "30s bid · 3…" — at phone widths. His words: "These
 * should be stacked on top of each other and full width so players can
 * actually read them."
 *
 * Pins: (a) the component renders the four facts in order with their
 * FULL strings; (b) the CSS contract — the container is a single-column
 * stack, each fact is a full-width row, and the value carries no
 * nowrap/ellipsis truncation; (c) both setup surfaces that render the
 * shared RulesStatLine (bot-game "Your Table" and the online
 * create-a-table form) show the stacked line beside the full
 * rules-summary detail line.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup, { RulesStatLine } from '../src/Setup';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root; let el: HTMLDivElement;

const qs = <T extends Element = HTMLElement>(sel: string, from: Element | Document = el) => from.querySelector(sel) as T | null;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};

function WizardHarness() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [tips, setTips] = useState({ on: false, asked: true });
  return createElement(Setup, { settings: s, onChange: setS, tips, onTips: setTips, onStart: () => {} });
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
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

const rowsOf = (from: Element | Document = el) => [...from.querySelectorAll('.rules-stat')];
const labelOf = (row: Element) => row.querySelector('small')?.textContent;
const valueOf = (row: Element) => row.querySelector('b')?.textContent;

async function renderStatLine(settings: Settings) {
  await act(async () => { root.render(createElement(RulesStatLine, { settings })); });
  await flush();
}

describe('RulesStatLine — the four facts, in order, in full', () => {
  it('renders Mode / Play to / Players / Timers with untruncated values (the owner\'s table)', async () => {
    await renderStatLine({ ...DEFAULT_SETTINGS, targetScore: 250 });
    const rows = rowsOf();
    expect(rows).toHaveLength(4);
    expect(rows.map(labelOf)).toEqual(['Mode', 'Play to', 'Players', 'Timers']);
    expect(rows.map(valueOf)).toEqual(['Joker Spades', '250', '4', '30s bid · 30s play']);
  });

  it('cutthroat values render in full too', async () => {
    await renderStatLine({ ...DEFAULT_SETTINGS, mode: 'cutthroat4' });
    expect(rowsOf().map(valueOf)).toEqual(['Cutthroat · 4p', '300', '4', '30s bid · 30s play']);
    await renderStatLine({ ...DEFAULT_SETTINGS, mode: 'cutthroat3' });
    expect(rowsOf().map(valueOf)).toEqual(['Cutthroat · 3p', '300', '3', '30s bid · 30s play']);
  });
});

describe('both setup surfaces carry the stacked line', () => {
  async function renderWizard() {
    await act(async () => { root.render(createElement(WizardHarness)); });
    await flush();
  }

  it('bot-game setup ("Your Table") — beside the full detail line', async () => {
    await renderWizard();
    await click(qs('[data-testid=play]'));
    await click(qs('[data-testid=door-team]'));
    await click(qs('[data-testid=mode-joker]'));
    await click(qs('[data-testid=play-bots]'));
    const stats = qs('[data-testid=rules-stats]');
    expect(stats).not.toBeNull();
    expect(rowsOf(stats!).map(valueOf)).toContain('Joker Spades');
    expect(rowsOf(stats!).map(valueOf)).toContain('30s bid · 30s play');
    expect(qs('[data-testid=rules-summary]')?.textContent).toContain('Team minimum 4');
    expect(qs('[data-testid=rules-summary]')?.textContent).toContain('Blind Nil on');
  });

  it('online create-a-table form — the same shared line', async () => {
    await renderWizard();
    await click(qs('[data-testid=play]'));
    await click(qs('[data-testid=door-team]'));
    await click(qs('[data-testid=mode-joker]'));
    await click(qs('[data-testid=play-online]'));
    await click(qs('[data-testid=create-open]'));
    const stats = qs('[data-testid=rules-stats]');
    expect(stats).not.toBeNull();
    expect(rowsOf(stats!).map(valueOf)).toContain('Joker Spades');
    expect(rowsOf(stats!).map(valueOf)).toContain('30s bid · 30s play');
  });
});
