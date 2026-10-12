import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('got shot popup', () => {
  it('fits a phone: capped width, 16px side padding, wrapping text', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const block = css.slice(css.indexOf('.hype-pop.shot {'), css.indexOf('.hype-pop.gotShot'));
    expect(block).toContain('max-width: calc(100vw - 32px)');
    expect(block).toContain('padding: 0 16px');
    expect(block).toContain('white-space: normal');
    expect(block).toContain('overflow-wrap: anywhere');
    expect(block).toContain('text-align: center');
    expect(block).toContain('overflow-x: hidden');
  });
});
