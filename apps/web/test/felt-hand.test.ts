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
});
