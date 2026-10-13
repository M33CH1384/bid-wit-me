import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FeltHand, FELT_SELECT_LIFT_PX, feltCardTransform } from '../src/FeltHand';

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
});
