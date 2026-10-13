import { PRESENCE_TTL_MS, type OpenTable, type PresenceEntry, stalePresence } from '@spades/protocol';
import { describe, expect, it } from 'vitest';
import { shownPlayers } from '../src/social/presence';

const now = 1_800_000_000_000;

function row(name: string, status: PresenceEntry['status'], at = now): PresenceEntry {
  return { id: `g:${name}`, name, guest: true, status, at };
}

function table(code: string, status: OpenTable['status']): OpenTable {
  return {
    code, host: 'SWE', mode: 'joker', playerCount: 4, target: 250, venue: 'classic',
    humans: 1, bots: 3, open: 3, status, spectators: 0, at: now,
  };
}

describe('players list presence', () => {
  it('hides an ended table and an old session, and keeps the live guest and vs-bots', () => {
    const users = [
      row('Guest', { kind: 'table', mode: 'joker', offline: true }),
      row('SWE', { kind: 'table', mode: 'joker', open: 4, code: '6SAQ2' }),
      row('SWE 2', { kind: 'table', mode: 'joker', open: 3, code: '5SNJ3', seat: 1 }),
      row('Old', { kind: 'online' }, now - PRESENCE_TTL_MS - 1),
    ];
    const tables = { '5SNJ3': table('5SNJ3', 'playing') };
    const shown = shownPlayers(users, tables, ['6SAQ2'], now).map((u) => u.name);
    expect(shown).toEqual(['Guest', 'SWE 2']);
  });

  it('hides a listed table once it is over, and shows it again after a rematch', () => {
    const swe = row('SWE', { kind: 'table', mode: 'joker', open: 4, code: '6SAQ2' });
    expect(stalePresence(swe, [table('6SAQ2', 'over')], [], now)).toBe(true);
    expect(stalePresence(swe, [table('6SAQ2', 'playing')], [], now)).toBe(false);
  });

  it('does not treat a private table as ended just because it is unlisted', () => {
    const nia = row('Nia', { kind: 'lobby', mode: 'joker', open: 3, code: 'PRIV8' });
    expect(stalePresence(nia, [], [], now)).toBe(false);
    expect(shownPlayers([nia], {}, [], now).map((u) => u.name)).toEqual(['Nia']);
  });
});
