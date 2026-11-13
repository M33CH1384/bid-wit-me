/**
 * @vitest-environment happy-dom
 *
 * SETTINGS DECLUTTER (owner, 2026-11-08): the sheet was "an eye sore… all
 * the controls looking to be jumbled together". Presentation only, on top
 * of the 2026-10-20 overhaul's grouped cards: ONE row anatomy for every
 * row kind in the sheet (same padding, same hairline, same right edge),
 * the inline run-on notes (.sf-note) become quiet blocks under their
 * label instead of wrapping inside it, section cards get real air, and
 * the bot-talk block inside Sound & music gets a "Table talk" sub-header
 * so the Deacon switch has a named home. No setting, testid, default,
 * label, or persistence changes; the control inventory is pinned by the
 * overhaul + parity suites next door.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');
const block = css.slice(css.indexOf('Settings sheet declutter'));

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

describe('settings declutter CSS (owner, 2026-11-08)', () => {
  it('the additive block exists, scoped to the one sheet', () => {
    expect(block).toContain('[data-testid="more-options"] .set-group');
    // scoped overrides only: the block never re-states a bare base selector
    expect(block).not.toMatch(/(^|\n)\.(row|sf-row|vol-row|set-group|switch|toggle|seg) \{/);
  });

  it('one row anatomy: every row kind shares padding + hairline inside the sheet', () => {
    expect(block).toContain('[data-testid="more-options"] .set-group .row');
    expect(block).toContain('[data-testid="more-options"] .set-group .sf-row');
    expect(block).toContain('[data-testid="more-options"] .set-group .vol-row');
    expect(block).toMatch(/\.sf-row \{[^}]*border-bottom: 1px solid/);
    // the last row of a group drops its hairline, whatever kind it is
    expect(block).toContain(':last-child');
  });

  it('inline notes become quiet blocks under their label', () => {
    expect(block).toMatch(/\[data-testid="more-options"\] \.sf-note \{[^}]*display: block/);
  });

  it('section cards and headers breathe', () => {
    expect(block).toMatch(/\[data-testid="more-options"\] \.set-group \{[^}]*margin-top: 22px/);
    expect(block).toContain('.set-group:has(.set-group-body.open) > .sheet-h');
  });

  it('the block keeps the overhaul tails clean of retired selectors', () => {
    expect(block).not.toContain('.sheet-sec');
    expect(block).not.toContain('.sound-pop');
  });
});

describe('table talk sub-header', () => {
  it('BotTalkFields opens with the Table talk sub-header', () => {
    const sc = read('../src/SoundControls.tsx');
    const start = sc.indexOf('export function BotTalkFields()');
    const head = sc.slice(start, start + 700);
    expect(head).toContain('<h4 className="set-subh">Table talk</h4>');
  });

  it('renders inside Sound & music, ahead of the Deacon switch', async () => {
    const c = await renderSheet();
    const subh = c.querySelector('.set-subh');
    expect(subh?.textContent).toBe('Table talk');
    expect(subh?.closest('.set-group')?.getAttribute('aria-label')).toBe('Sound & music');
    const deacon = c.querySelector('[data-testid="gen-dialogue"]');
    expect(deacon).not.toBeNull();
    // document order: the sub-header precedes the Deacon switch
    expect(subh!.compareDocumentPosition(deacon!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the sub-header is styled in the declutter block', () => {
    expect(block).toMatch(/\.set-subh \{[^}]*text-transform: uppercase/);
  });
});
