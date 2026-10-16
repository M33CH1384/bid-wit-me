import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('seat open panel', () => {
  it('pins the phone card to the bottom so it does not cover a name plate', () => {
    const css = readFileSync(new URL('../src/online/online.css', import.meta.url), 'utf8');
    const block = css.slice(css.indexOf('@media (max-width: 700px)'));
    const rule = block.slice(block.indexOf('.spec-dock .spec-take'), block.indexOf('}', block.indexOf('.spec-dock .spec-take')) + 1);
    expect(block).toContain('.spec-dock { left: 0; right: 0; width: 100%; transform: none; }');
    expect(rule).toContain('position: fixed');
    expect(rule).toContain('bottom: calc(6px + env(safe-area-inset-bottom))');
    expect(rule).not.toContain('top: calc(58px');
  });
});
