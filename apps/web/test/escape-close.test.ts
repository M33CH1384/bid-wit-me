/**
 * @vitest-environment happy-dom
 *
 * Escape dismisses the score pad (and the other click-away sheets). A sheet
 * on top of another one takes the first Escape.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRules, newGame } from '@spades/rules';
import { ScorePad } from '../src/ScorePad';
import { useEscapeClose } from '../src/useEscapeClose';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => { root.render(node); });
  return () => {
    act(() => root.unmount());
    host.remove();
  };
}

function press(key: string) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  act(() => { window.dispatchEvent(ev); });
  return ev;
}

function Sheet({ name, children }: { name: string; children?: ReturnType<typeof createElement> }) {
  const [open, setOpen] = useState(true);
  const esc = useEscapeClose(() => setOpen(false));
  if (!open) return null;
  return createElement('div', { ref: esc, 'data-testid': name }, children);
}

describe('Escape closes dismissible dialogs', () => {
  const cleanups: Array<() => void> = [];
  afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

  it('closes the score pad and does not deal the next hand', () => {
    const st = newGame(makeRules('joker'), 'esc-pad');
    let closed = 0;
    let continued = 0;
    cleanups.push(mount(createElement(ScorePad, {
      st,
      names: ['You', 'A', 'B', 'C'],
      sideName: () => 'Us',
      onClose: () => { closed += 1; },
      onContinue: () => { continued += 1; },
    })));
    expect(document.querySelector('[data-testid="score-pad"]')).toBeTruthy();
    press('Enter');
    expect(closed).toBe(0);
    press('Escape');
    expect(closed).toBe(1);
    expect(continued).toBe(0);
  });

  it('closes only the sheet on top', () => {
    cleanups.push(mount(createElement(Sheet, { name: 'under' }, createElement(Sheet, { name: 'over' }))));
    expect(document.querySelector('[data-testid="over"]')).toBeTruthy();
    press('Escape');
    expect(document.querySelector('[data-testid="over"]')).toBeNull();
    expect(document.querySelector('[data-testid="under"]')).toBeTruthy();
    press('Escape');
    expect(document.querySelector('[data-testid="under"]')).toBeNull();
  });

  it('a later sheet wins when the two are siblings', () => {
    function Pair() {
      const [a, setA] = useState(true);
      const [b, setB] = useState(true);
      const ea = useEscapeClose(() => setA(false));
      const eb = useEscapeClose(() => setB(false));
      return createElement('div', null,
        a ? createElement('div', { ref: ea, 'data-testid': 'first' }) : null,
        b ? createElement('div', { ref: eb, 'data-testid': 'second' }) : null,
      );
    }
    cleanups.push(mount(createElement(Pair)));
    press('Escape');
    expect(document.querySelector('[data-testid="second"]')).toBeNull();
    expect(document.querySelector('[data-testid="first"]')).toBeTruthy();
    press('Escape');
    expect(document.querySelector('[data-testid="first"]')).toBeNull();
  });

  it('the other click-away sheets use the same Escape close', () => {
    // SoundControls.tsx left this list in the 2026-10-20 consolidation: its
    // Escape-closed surfaces (the speaker's Sound sheet / popover) are retired,
    // and the sheet the speaker now opens is MoreOptions — pinned right here.
    const files = [
      'ScorePad.tsx', 'Series.tsx', 'Credits.tsx', 'Feedback.tsx', 'MoreOptions.tsx',
      'account/AccountUI.tsx', 'RunZoom.tsx', 'TrashTalk.tsx', 'Table.tsx',
    ];
    for (const file of files) {
      const src = readFileSync(`apps/web/src/${file}`, 'utf8');
      expect(src, file).toContain('useEscapeClose');
    }
  });
});
