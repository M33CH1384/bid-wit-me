import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canEnterTable, tableEntryName } from '../src/online/entryGate';

describe('spectate entry', () => {
  it('opens the watch view with no saved name, and still asks before a join', () => {
    expect(canEnterTable('5SNJ3', '', '?watch=1')).toBe(true);
    expect(canEnterTable('5SNJ3', '', '?watch=1&seat=2')).toBe(true);
    expect(canEnterTable('5SNJ3', '', '')).toBe(false);
    expect(canEnterTable('5SNJ3', '', '?seat=2')).toBe(false);
    expect(canEnterTable('5SNJ3', 'Meech', '')).toBe(true);
    expect(canEnterTable(null, '', '?watch=1')).toBe(false);
    expect(tableEntryName('', '?watch=1')).toBe('Guest');
    expect(tableEntryName('  Meech  ', '?watch=1')).toBe('Meech');
    expect(tableEntryName('', '?seat=1')).toBe('Player');
  });

  it('wires the gate in front of the name form', () => {
    const src = readFileSync(new URL('../src/online/OnlineApp.tsx', import.meta.url), 'utf8');
    expect(src).toContain('canEnterTable(code, loadName(), location.search)');
    expect(src).toContain('tableEntryName(name, location.search)');
    expect(src).not.toContain('!!code && !!loadName()');
  });
});
