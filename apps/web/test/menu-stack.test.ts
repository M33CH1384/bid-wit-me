import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('game menu stacking', () => {
  it('lifts the open menu above the seat-open panel', () => {
    const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
    const online = readFileSync(new URL('../src/online/online.css', import.meta.url), 'utf8');
    const seat = online.match(/\.spec-dock \{[^}]*z-index:\s*(\d+)/);
    const lift = css.match(/\.table-screen:has\(\.game-menu\) > \.scorebug \{ z-index:\s*(\d+)/);
    expect(seat?.[1]).toBeTruthy();
    expect(lift?.[1]).toBeTruthy();
    expect(Number(lift![1])).toBeGreaterThan(Number(seat![1]));
  });
});
