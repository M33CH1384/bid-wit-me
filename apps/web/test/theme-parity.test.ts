/**
 * @vitest-environment happy-dom
 *
 * THEME PARITY GUARDRAIL (owner rule, 2026-10-20): "I don't want the user
 * to have to relearn how to use the app cuz they changed the theme."
 * Classic and Neon are the SAME app — identical buttons, functionality,
 * content, and user story from the homepage onward. Neon changes visuals
 * only (colors, glass, ink, decorative art). Any theme-conditional
 * difference in what a screen DOES or SHOWS is a bug.
 *
 * This file renders the key entry surfaces under BOTH themes and requires
 * the interactive inventory (tag | testid | aria-label | label | href |
 * value) to be identical, and pins the sources so a theme branch that
 * alters the action set can't quietly come back. (Checked state itself —
 * e.g. which ThemeToggle radio is on — is theme state, not story, and is
 * deliberately not part of the inventory.)
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { themeStore } from '../src/theme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

const inventory = (c: HTMLElement) =>
  [...c.querySelectorAll('button, a[href], input, select, textarea')]
    .map((n) => {
      const el = n as HTMLElement & { value?: string };
      return [
        el.tagName,
        el.getAttribute('data-testid') ?? '',
        el.getAttribute('aria-label') ?? '',
        (el.textContent ?? '').trim().replace(/\s+/g, ' '),
        el.getAttribute('href') ?? '',
        el.value ?? '',
      ].join('|');
    })
    .sort();

let root: Root | null = null;
let el: HTMLDivElement | null = null;

function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}

async function renderThemed(theme: 'classic' | 'neon', node: ReactNode) {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    themeStore.set(theme);
    root!.render(node);
  });
  return el;
}

afterEach(() => {
  unmount();
  act(() => themeStore.set('classic'));
  localStorage.clear();
  sessionStorage.clear();
  // the wizard restores its step from history.state (back-gesture support) —
  // reset it so scenarios can't leak steps into each other
  history.replaceState(null, '', '/');
});

describe('Setup home parity', () => {
  async function setupEl(theme: 'classic' | 'neon', extra: Record<string, unknown> = {}) {
    const { default: Setup } = await import('../src/Setup');
    const { DEFAULT_SETTINGS } = await import('../src/settings');
    return renderThemed(theme, createElement(Setup, {
      settings: DEFAULT_SETTINGS,
      onChange: () => {},
      tips: { on: false, asked: true },
      onTips: () => {},
      onStart: () => {},
      ...extra,
    }));
  }

  it('fresh home: identical interactive inventory under Classic and Neon', async () => {
    const classic = await setupEl('classic');
    const classicInv = inventory(classic);
    expect(classicInv.length).toBeGreaterThan(0);
    expect(classicInv.some((x) => x.includes('|play|'))).toBe(true);
    const neon = await setupEl('neon');
    expect(inventory(neon)).toEqual(classicInv);
  });

  it('home with a game to resume: identical inventory (PLAY + RESUME + rejoin)', async () => {
    const extra = { onResume: () => {}, resumeLabel: 'hand 3 · your bid' };
    const classic = await setupEl('classic', extra);
    const classicInv = inventory(classic);
    expect(classicInv.some((x) => x.includes('|resume|'))).toBe(true);
    const neon = await setupEl('neon', extra);
    expect(inventory(neon)).toEqual(classicInv);
  });

  it('game-select (door step after PLAY): identical inventory under both themes', async () => {
    const doorInv = async (theme: 'classic' | 'neon') => {
      history.replaceState(null, '', '/');
      const c = await setupEl(theme);
      const play = c.querySelector<HTMLButtonElement>('[data-testid="play"]')!;
      await act(async () => { play.click(); });
      return inventory(c);
    };
    const classicInv = await doorInv('classic');
    expect(classicInv.some((x) => x.includes('|door-team|'))).toBe(true);
    expect(classicInv.some((x) => x.includes('|door-cutthroat|'))).toBe(true);
    expect(await doorInv('neon')).toEqual(classicInv);
  });
});

describe('settings sheet parity (MoreOptions)', () => {
  it('identical control inventory under Classic and Neon', async () => {
    const { default: MoreOptions } = await import('../src/MoreOptions');
    const { DEFAULT_SETTINGS } = await import('../src/settings');
    const node = () => createElement(MoreOptions, {
      settings: DEFAULT_SETTINGS,
      onChange: () => {},
      tips: { on: false, asked: true },
      onTips: () => {},
      onClose: () => {},
    });
    const classic = await renderThemed('classic', node());
    const classicInv = inventory(classic);
    expect(classicInv.length).toBeGreaterThan(10);
    // the sheet's entry points are all here: theme seg, bot skill, closes…
    expect(classicInv.some((x) => x.includes('|theme-classic|'))).toBe(true);
    expect(classicInv.some((x) => x.includes('|theme-neon|'))).toBe(true);
    expect(classicInv.some((x) => x.includes('|bot-skill|'))).toBe(true);
    // the settings overhaul's placements are part of the shared inventory:
    // chat sounds lives in the sheet (Sound & music group) under both themes
    expect(classicInv.some((x) => x.includes('|chat-sounds-switch|'))).toBe(true);
    const neon = await renderThemed('neon', node());
    expect(inventory(neon)).toEqual(classicInv);
  });
});

describe('source pins — no theme branch may alter an action set', () => {
  it('Setup.tsx consumes no theme state at all', () => {
    const src = read('../src/Setup.tsx');
    expect(src).not.toContain('useTheme');
    expect(src).not.toContain("theme ===");
    expect(src).not.toContain('data-theme');
    expect(src).not.toContain('nh-');
  });

  it('the settings sheet components render the same controls regardless of theme', () => {
    for (const f of ['../src/MoreOptions.tsx', '../src/SoundControls.tsx']) {
      const src = read(f);
      expect(src, f).not.toContain('useTheme');
      expect(src, f).not.toContain("=== 'neon'");
      expect(src, f).not.toContain('=== "neon"');
    }
  });

  it('no .nh-* selectors remain in any stylesheet (the Neon-only DOM family is retired)', () => {
    for (const f of ['../src/styles.css', '../src/social/social.css', '../src/online/online.css', '../src/account/account.css']) {
      expect(read(f), f).not.toMatch(/\.nh-[a-z]/);
    }
    expect(read('../src/neon/pointerGlow.ts')).not.toContain('nh-');
  });
});
