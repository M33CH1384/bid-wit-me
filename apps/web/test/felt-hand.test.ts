import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeltHand, FELT_LEGAL_Z, FELT_SELECT_LIFT_PX, FELT_SELECT_Z, feltCardBox, feltCardTransform, feltCardZ } from '../src/FeltHand';

describe('quick-load hand', () => {
  it('keeps the fan, and lifts a selected card straight up outside that rotation', () => {
    const rest = feltCardTransform(0, 5, false);
    const sel = feltCardTransform(0, 5, true);
    expect(rest).toBe('rotate(-6.4deg) translateY(6px)');
    expect(sel).toBe(`translateY(-${FELT_SELECT_LIFT_PX}px) ${rest}`);
    expect(sel.indexOf('translateY(-10px)')).toBeLessThan(sel.indexOf('rotate('));
    expect(feltCardTransform(2, 5, false)).toBe('rotate(0deg) translateY(0px)');
    expect(feltCardTransform(2, 5, true)).toBe('translateY(-10px) rotate(0deg) translateY(0px)');
  });

  it('stays out of the accessibility tree so each card is only the labeled hand control', () => {
    const html = renderToStaticMarkup(createElement(FeltHand, {
      cards: ['AS', 'KH'],
      trick: [],
      legal: ['AS'],
      selected: null,
      onCard: () => {},
      promoted: () => false,
    }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).not.toContain('aria-label="Your hand"');
  });

  it('draws only the cards dealt so far, still sitting in the full fan', () => {
    const html = renderToStaticMarkup(createElement(FeltHand, {
      cards: ['AS', 'KH', '2C'],
      trick: [],
      legal: [],
      selected: null,
      onCard: () => {},
      promoted: () => false,
      visibleCount: 1,
    }));
    const buttons = html.match(/<button/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(html).toContain('A♠');
    expect(html).not.toContain('K♥');
    expect(html).toContain(feltCardTransform(0, 3, false));
  });

  it('dims only an illegal card, and a legal one has no outline and no filter on the fan', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const fan = css.split('\n').find((line) => line.startsWith('.felt-hand {')) ?? '';
    expect(fan).toContain('filter: none');
    expect(fan).toContain('opacity: 1');
    expect(fan).not.toMatch(/opacity:\s*0?\.\d/);
    expect(css).toContain('.felt-hand button:disabled:not(.legal) { filter: saturate(.45) brightness(.4); }');
    expect(css).not.toContain('.felt-hand button:disabled { filter:');
    expect(css).toContain('.felt-hand button.legal { filter: none; }');
    expect(css).not.toContain('outline: 2px solid #f5c542');
  });

  it('stacks a raised card and its outline above later neighbours', () => {
    const cards = ['AS', 'KH', '2C', 'QD', '7S'] as const;
    const html = renderToStaticMarkup(createElement(FeltHand, {
      cards: [...cards],
      trick: [],
      legal: ['KH', '2C', 'QD'],
      selected: '2C',
      onCard: () => {},
      promoted: () => false,
    }));
    const z = [...html.matchAll(/z-index:(\d+)/g)].map((m) => Number(m[1]));
    expect(z).toEqual(cards.map((c, i) => feltCardZ(i, ['KH', '2C', 'QD'].includes(c), c === '2C')));
    const selected = feltCardZ(2, true, true);
    for (let i = 0; i < cards.length; i++) {
      if (i === 2) continue;
      expect(selected).toBeGreaterThan(feltCardZ(i, i > 0 && i < 4, false));
    }
    expect(feltCardZ(1, true, false)).toBeGreaterThan(feltCardZ(4, false, false));
    expect(feltCardZ(0, false, false)).toBe(0);
    expect(FELT_LEGAL_Z).toBeGreaterThan(16);
    expect(FELT_SELECT_Z).toBeGreaterThan(FELT_LEGAL_Z + 16);
  });

  it('grows the quick-load cards and keeps a full hand inside 390px and 336px', () => {
    for (const w of [390, 336]) {
      for (const n of [13, 17]) {
        const box = feltCardBox(n, w);
        const row = box.width + (n - 1) * box.exposed;
        expect(row).toBeLessThanOrEqual(w - 12 + 0.6);
        expect(box.width).toBeGreaterThan(52);
        expect(box.exposed).toBeGreaterThan(14);
        expect(box.height / box.width).toBeCloseTo(1.4, 5);
      }
    }
    expect(feltCardBox(5, 390).exposed).toBeGreaterThanOrEqual(44);
    expect(feltCardBox(8, 390).exposed).toBeGreaterThanOrEqual(44);
    expect(feltCardBox(6, 336).exposed).toBeGreaterThanOrEqual(44);
    for (const n of [13, 17]) {
      const picked = feltCardZ(3, true, true);
      for (let i = 0; i < n; i++) {
        if (i === 3) continue;
        expect(picked).toBeGreaterThan(feltCardZ(i, true, false));
        expect(feltCardZ(i, true, false)).toBeGreaterThan(feltCardZ(i, false, false));
      }
    }
  });
});
