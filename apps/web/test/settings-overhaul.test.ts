/**
 * @vitest-environment happy-dom
 *
 * SETTINGS OVERHAUL (owner, 2026-10-20): the Settings sheet was "way too
 * jumbled" and its Audio quality buttons "aren't readable". The Audio
 * quality root cause: its bespoke .sf-seg class had NO rule in any
 * stylesheet, so the buttons fell back to the platform's default light
 * pill appearance — pale pills, invisible selected state — and the
 * row's flex-wrap spilled them past the sheet's edge.
 *
 * These pins hold the overhaul's shape: the sheet's sections render as
 * grouped cards with every control in its group (Play / Sound & music /
 * Look & effects / You / Beta feedback & support), Audio quality rides
 * the shared .seg treatment, .toggle and .switch share one switch
 * treatment, chat sounds is one shared row, and the Neon sheet is solid
 * so the home can't bleed through it. Presentation only — no setting,
 * testid, default, or persistence changed (the parity suite next door
 * pins the identical control inventory under both themes).
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

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

async function renderSheet() {
  const { default: MoreOptions } = await import('../src/MoreOptions');
  const { DEFAULT_SETTINGS } = await import('../src/settings');
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(createElement(MoreOptions, {
      settings: DEFAULT_SETTINGS,
      onChange: () => {},
      tips: { on: false, asked: true },
      onTips: () => {},
      onClose: () => {},
    }));
  });
  return el;
}

const groupOf = (c: HTMLElement, testid: string) =>
  c.querySelector(`[data-testid="${testid}"]`)?.closest('.set-group')?.getAttribute('aria-label');

describe('settings sheet — grouped cards', () => {
  it('renders the five groups in order', async () => {
    const c = await renderSheet();
    const labels = [...c.querySelectorAll('.set-group')].map((g) => g.getAttribute('aria-label'));
    expect(labels).toEqual(['Play', 'Sound & music', 'Look & effects', 'You', 'Beta feedback & support']);
  });

  it('every control sits in its group', async () => {
    const c = await renderSheet();
    expect(groupOf(c, 'bot-skill')).toBe('Play');
    expect(groupOf(c, 'quality-seg')).toBe('Sound & music');
    expect(groupOf(c, 'chat-sounds-switch')).toBe('Sound & music');
    expect(groupOf(c, 'bot-trash-talk')).toBe('Sound & music');
    expect(groupOf(c, 'theme-seg')).toBe('Look & effects');
    expect(groupOf(c, 'venue-select')).toBe('Look & effects');
    expect(groupOf(c, 'reduce-fx')).toBe('Look & effects');
    expect(groupOf(c, 'nuke-intensity')).toBe('Look & effects');
    expect(groupOf(c, 'badges-row')).toBe('You');
  });
});

describe('audio quality — the shared segmented control', () => {
  it('renders on .seg markup with radio semantics, not the unstyled .sf-seg', async () => {
    const c = await renderSheet();
    const seg = c.querySelector('[data-testid="quality-seg"]')!;
    expect(seg.classList.contains('seg')).toBe(true);
    expect(seg.classList.contains('sf-seg')).toBe(false);
    expect(seg.getAttribute('role')).toBe('radiogroup');
    const btns = [...seg.querySelectorAll('button')];
    expect(btns.map((b) => b.textContent)).toEqual(['low', 'balanced', 'high']);
    expect(btns.every((b) => b.getAttribute('role') === 'radio')).toBe(true);
    expect(btns.filter((b) => b.classList.contains('on')).length).toBe(1);
  });

  it('no .sf-seg remains in the sound controls markup or as a stylesheet rule', () => {
    expect(read('../src/SoundControls.tsx')).not.toContain('className="sf-seg"');
    expect(css).not.toMatch(/\.sf-seg\s*[,{]/);
  });
});

describe('chat sounds — one shared row', () => {
  it('is exported once and used by the Settings sheet and the sound sheet', () => {
    const sc = read('../src/SoundControls.tsx');
    expect(sc).toContain('export function ChatSoundsRow()');
    expect(read('../src/MoreOptions.tsx')).toContain('<ChatSoundsRow />');
    // in the sound sheet it sits with the sound controls (Volume section),
    // before Spatial, and no longer lives in the Effects section
    const sheet = sc.slice(sc.indexOf('export function SoundSheet'), sc.indexOf('/** Spatial controls'));
    expect(sheet.indexOf('<ChatSoundsRow />')).toBeGreaterThan(-1);
    expect(sheet.indexOf('<ChatSoundsRow />')).toBeLessThan(sheet.indexOf('aria-label="Spatial"'));
    expect(sheet.slice(sheet.indexOf('aria-label="Effects"'))).not.toContain('ChatSoundsRow');
  });
});

describe('settings overhaul CSS', () => {
  const tail = css.slice(css.indexOf('Settings overhaul'));

  it('group cards take the shared card treatment on both settings surfaces', () => {
    expect(tail).toMatch(/\.set-group \{[^}]*border-radius: 14px/);
    expect(tail).toMatch(/\.sheet-sec \{[^}]*border-radius: 14px/);
  });

  it('one switch treatment: the unified .toggle/.switch overrides are present', () => {
    expect(tail).toContain('.switch { height: 28px; border-radius: 14px;');
    expect(tail).toContain('.switch i { width: 22px; height: 22px;');
    expect(tail).toContain('.switch.on i { transform: translateX(18px); }');
    expect(tail).toContain('.toggle.on span { background: var(--gold); }');
  });

  it('the Neon settings sheet is solid — the home cannot bleed through it', () => {
    const rule = tail.slice(tail.indexOf('html[data-theme="neon"] [data-testid="more-options"].sheet'));
    expect(rule).toContain('#171c42');
    expect(rule).toContain('#0a0d24');
    expect(rule).toContain('backdrop-filter: none');
  });
});
