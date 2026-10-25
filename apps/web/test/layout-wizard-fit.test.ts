/**
 * @vitest-environment happy-dom
 *
 * WIZARD HEADER FIT ON THE STEPS (2026-10-25, owner walk: "buttons don't
 * fit on the screen"): the home fit suite closed the header on the HOME
 * step by taking the invisible dots out of the flow there — but on the
 * steps the dots are VISIBLE progress and the row never closed. Measured
 * on the shipped build (Chromium, every step, both themes): the bar's
 * children are nav 98.6 + dots 150 + right cluster 155.4 = 404px against
 * a 366px content box at 390 wide, so the gear and the dock slot rode
 * off the right edge — slot at 393–439 at 390×844, 378–424 at 375×667,
 * 433–479 at 430×932 (the dock seats exactly in its slot since a9518a15,
 * so the sound button went off-screen with it; the owner's door-step
 * screenshot shows Social clipped at the edge, gear + speaker gone).
 *
 * THE FIX IS A WRAP, NOT A SQUEEZE. No element may shrink: both clusters
 * are 44–46px tap targets and the dots are the step progress. At
 * portrait phone widths the bar wraps — nav + right cluster share the
 * first line, the dots take a centered line of their own beneath it at
 * their full shipped size. Wider portrait and landscape keep the single
 * row, where the budget closes with the labelled Social button.
 * These pins re-derive both budgets from the shipped constants (with
 * generous measured caps where text width is font-dependent) so the row
 * can never silently outgrow the bar again on any step.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { themeStore } from '../src/theme';
import Setup from '../src/Setup';
import { DEFAULT_SETTINGS } from '../src/settings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');
const socialCss = read('../src/social/social.css');
const setupSrc = read('../src/Setup.tsx');

const px = (re: RegExp, label: string, src = css) => {
  const m = src.match(re);
  expect(m, label).toBeTruthy();
  return parseFloat(m![1]);
};

/* ---------- the shipped constants the budgets stand on ---------- */

const side = px(/\.wiz-bar \{[^}]*padding: 10px ([\d.]+)px 0/, 'bar side padding');
const icon = px(/\.icon-btn \{\s*width: ([\d.]+)px/, 'icon button width');
const slot = px(/\.wiz-right \.dock-slot \{ width: ([\d.]+)px/, 'wizard slot width');
const rightGap = px(/\.wiz-right \{ display: flex; align-items: center; gap: ([\d.]+)px/, 'wiz-right gap');
const navGap = px(/\.wiz-nav \{ display: flex; gap: ([\d.]+)px/, 'wiz-nav gap');
const dotGap = px(/\.wiz-dots \{ display: flex; gap: ([\d.]+)px/, 'dots gap');
const dotW = px(/\.wiz-dots i \{ width: ([\d.]+)px/, 'dot width');
const dotOnW = px(/\.wiz-dots i\.on \{[^}]*?width: ([\d.]+)px/, 'active dot width');
const stepCount = (setupSrc.match(/const ORDER: Step\[\] = \[([^\]]+)\]/)![1].match(/'/g) ?? []).length / 2;
const dotsTotal = (stepCount - 1) * dotW + dotOnW + (stepCount - 1) * dotGap;

// Measured caps (Chromium on the shipped build, 2026-10-25): the nav
// cluster rendered 98.6px and icon-only Social 47.4px in the sandbox's
// fallback font; the caps below are deliberately generous — the back
// chip's "BACK" is capped at 56px of text (12px+/glyph at 16px display
// weight) so the budget also holds in the real Barlow Condensed.
const backChipCap = 12 /* pad-l */ + 18 /* arrow svg (Setup.tsx) */ + 8 /* chip gap */ + 56 /* BACK, capped */ + 16 /* pad-r */;
const navCap = backChipCap + navGap + icon;
const socialIconCap = 48; // measured 47.4, label hidden ≤520px (social.css)
const socialLabelCap = 96; // measured 95.4 with the "Social" label shown
const rightIcon = socialIconCap + rightGap + icon + rightGap + slot;
const rightLabel = socialLabelCap + rightGap + icon + rightGap + slot;

const wrapBlock = css.match(/@media \(orientation: portrait\) and \(max-width: 520px\) \{([\s\S]*?)\n\}/)?.[1] ?? '';

describe('wizard steps: the header row closes at every phone width', () => {
  it('the portrait-phone wrap ships, scoped off the home step', () => {
    expect(wrapBlock).toBeTruthy();
    expect(wrapBlock).toMatch(/\.wizard:not\(\.step-home\) \.wiz-bar \{ flex-wrap: wrap; row-gap: 8px; \}/);
    expect(wrapBlock).toMatch(/\.wizard:not\(\.step-home\) \.wiz-dots \{ order: 3; flex: 1 1 100%; justify-content: center; \}/);
  });

  it('the dots keep their full shipped size on their own line', () => {
    expect(stepCount).toBe(5);
    expect(dotsTotal).toBe(150);
    // the wrap moves the dots; it must not resize them
    expect(wrapBlock).not.toMatch(/\.wiz-dots i/);
    expect(css).toContain('.wiz-dots { display: flex; gap: 7px; }');
  });

  it('wrap band (portrait ≤520): line 1 = nav + right cluster, closing at 375 with room to spare', () => {
    // the two-line budget only exists because the wrap ships — without
    // it this test has nothing to stand on (negative control)
    expect(wrapBlock, 'the portrait wrap block ships').toBeTruthy();
    const line1 = navCap + rightIcon + side * 2;
    expect(line1).toBeLessThanOrEqual(375);
    // and the dots' own line fits the narrowest content box too
    expect(dotsTotal).toBeLessThanOrEqual(375 - side * 2);
  });

  it('the wrap is load-bearing: unwrapped, the step row outgrows even the widest icon-band phone', () => {
    // Social is icon-only ≤520px, and even with every cap the single
    // row sums past 430 — no portrait phone in the band could hold it.
    expect(navCap + dotsTotal + rightIcon + side * 2).toBeGreaterThan(430);
  });

  it.each([601, 667, 768, 844, 932, 1024])('single-row band (%ipx): nav + dots + labelled right cluster closes', (w) => {
    expect(navCap + dotsTotal + rightLabel + side * 2).toBeLessThanOrEqual(w);
  });

  it('tap floors hold across the header', () => {
    expect(icon).toBeGreaterThanOrEqual(44);
    expect(slot).toBeGreaterThanOrEqual(44);
    expect(px(/\.back-chip \{[^}]*min-height:\s*([\d.]+)px/, 'back chip min-height')).toBeGreaterThanOrEqual(44);
    expect(px(/\.social-btn \{[^}]*height:\s*([\d.]+)px/, 'social height', socialCss)).toBeGreaterThanOrEqual(44);
    expect(px(/\.social-btn \{[^}]*min-width:\s*([\d.]+)px/, 'social min-width', socialCss)).toBeGreaterThanOrEqual(44);
  });

  it('the home step header is untouched by the wrap', () => {
    expect(css).toMatch(/\.wizard\.step-home \.wiz-dots \{ display: none; \}/);
    expect(wrapBlock).not.toMatch(/\.wizard \.wiz-bar/);
  });
});

/* ---------- structure: the markup the budgets stand on ---------- */

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
  act(() => themeStore.set('classic'));
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});

async function renderStep(theme: 'classic' | 'neon', wiz: string, path = 'bots') {
  unmount();
  history.replaceState({ wiz, path, kind: 'team', view: 'lobby' }, '', '/');
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    themeStore.set(theme);
    root!.render(createElement(Setup, {
      settings: DEFAULT_SETTINGS,
      onChange: () => {},
      tips: { on: false, asked: true },
      onTips: () => {},
      onStart: () => {},
    }) as ReactNode);
  });
  return el;
}

describe('wizard step structure under both themes', () => {
  it.each(['classic', 'neon'] as const)('%s: door step header is nav / dots / right, active dot on the step', async (theme) => {
    const c = await renderStep(theme, 'door');
    const wiz = c.querySelector('.wizard.step-door');
    expect(wiz).toBeTruthy();
    const bar = c.querySelector('.wiz-bar')!;
    const kids = [...bar.children].map((n) => (n as HTMLElement).className);
    expect(kids).toEqual(['wiz-nav', 'wiz-dots', 'wiz-right']);
    const dots = [...c.querySelectorAll('.wiz-dots i')];
    expect(dots.length).toBe(5);
    expect(dots[1]!.className).toBe('on');
    // the dock's seat is the right cluster's last seat, after the gear
    const right = c.querySelector('.wiz-right')!;
    expect(right.querySelector('.dock-slot')).toBeTruthy();
    expect(right.querySelector('.icon-btn.gear')).toBeTruthy();
    expect([...right.children].at(-1)!.className).toBe('dock-slot');
  });

  it.each(['classic', 'neon'] as const)('%s: table step carries the same header, active dot last', async (theme) => {
    const c = await renderStep(theme, 'table');
    expect(c.querySelector('.wizard.step-table')).toBeTruthy();
    const dots = [...c.querySelectorAll('.wiz-dots i')];
    expect(dots.length).toBe(5);
    expect(dots[4]!.className).toBe('on');
    expect(c.querySelector('.wiz-bar .wiz-right .dock-slot')).toBeTruthy();
  });
});
