/**
 * HOUSE RULES SUMMARY STACK — CSS pins (owner, 2026-11-05; the DOM pins
 * live in rules-stat-stack.test.ts). The setup Rules card's stat line
 * squeezed Mode / Play to / Players / Timers into one 4-column row and
 * ellipsized the values at phone widths. The layout contract that fixes
 * it: a single-column stack of full-width rows, label + value on one
 * line, and a value style with no nowrap/ellipsis truncation anywhere.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const ruleBlock = (selector: string) => {
  const m = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? '';
};

describe('the stacked layout contract (styles.css)', () => {
  it('the container is a single-column stack, not a 4-across grid', () => {
    const block = ruleBlock('.rules-stats');
    expect(block).not.toBe('');
    expect(block).not.toContain('repeat(4, 1fr)');
    expect(block).toContain('grid-template-columns: 1fr');
  });

  it('each fact is a full-width row (label and value on one line)', () => {
    expect(ruleBlock('.rules-stat')).toContain('flex-direction: row');
  });

  it('the value can never be ellipsized', () => {
    const b = ruleBlock('.rules-stat b');
    expect(b).not.toBe('');
    expect(b).not.toContain('text-overflow: ellipsis');
    expect(b).not.toContain('white-space: nowrap');
  });
});
