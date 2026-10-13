import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('minimum books / bid in the UI', () => {
  it('labels the host setting and shows why a bid is blocked', () => {
    const lobby = readFileSync(new URL('../src/online/Lobby.tsx', import.meta.url), 'utf8');
    const house = readFileSync(new URL('../src/MoreOptions.tsx', import.meta.url), 'utf8');
    const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    expect(lobby).toContain('Minimum books / bid');
    expect(lobby).toContain('data-testid="lobby-first-hand-min"');
    expect(lobby).toContain('data-testid="lobby-min-bid"');
    expect(house).toContain('Minimum books / bid');
    expect(table).toContain('data-testid="bid-block"');
    expect(table).toContain('view.bidOptions.min');
    expect(table).toContain('view.bidOptions.nil');
    expect(css).toContain('.bid-block');
    expect(css).toContain('text-wrap: wrap');
  });
});
