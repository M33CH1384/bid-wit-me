import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('face-down notice', () => {
  it('does not announce that cards are face down, and still offers Blind Nil or seeing the cards on your turn', () => {
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(table).not.toContain('Cards face down');
    expect(table).not.toContain('bid-panel glass slant compact');
    expect(css).not.toContain('.bid-panel.compact');
    expect(table).toContain("bid: 'blindNil'");
    expect(table).toContain('See my cards');
  });
});
