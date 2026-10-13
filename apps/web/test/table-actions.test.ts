import { describe, expect, it } from 'vitest';
import type { OpenTable, PresenceStatus } from '@spades/protocol';
import { LOCAL_TABLE_REASON, WATCH_FULL_REASON, playerTableAction } from '../src/social/tableActions';

const local: PresenceStatus = { kind: 'table', mode: 'joker', offline: true };
const atTable: PresenceStatus = { kind: 'table', mode: 'joker', open: 1, code: 'ABCD', seat: 2 };
const lobby: PresenceStatus = { kind: 'lobby', mode: 'joker', open: 2, code: 'WXYZ', seat: 1 };

function listed(over: Partial<OpenTable> = {}): OpenTable {
  return {
    code: 'ABCD', host: 'Ace', mode: 'joker', playerCount: 4, target: 500, venue: 'classic',
    humans: 1, bots: 3, open: 1, status: 'playing', spectators: 0, seat: 2, at: 1,
    ...over,
  };
}

describe('player table actions', () => {
  it('keeps a local vs-bots game from being joined or watched', () => {
    const act = playerTableAction(local, {}, null);
    expect(act).toMatchObject({ local: true, join: false, spectate: true, spectateReason: LOCAL_TABLE_REASON, joinReason: LOCAL_TABLE_REASON });
    expect(playerTableAction({ kind: 'table', mode: 'joker' }, {}, null)?.local).toBe(true);
  });

  it('offers spectate, and take-seat only for an open or bot seat', () => {
    expect(playerTableAction(atTable, {}, null)).toMatchObject({ local: false, code: 'ABCD', join: true, seat: 2, joinLabel: 'Take seat', spectate: true });
    expect(playerTableAction({ ...atTable, open: 0, seat: undefined }, {}, null)).toMatchObject({ join: false, spectate: true });
    expect(playerTableAction(lobby, {}, null)).toMatchObject({ join: true, seat: 1, joinLabel: 'Join' });
  });

  it('trusts the public listing over a stale presence count', () => {
    const full = listed({ open: 0, seat: undefined, humans: 4, bots: 0 });
    expect(playerTableAction(atTable, { ABCD: full }, null)).toMatchObject({ join: false, spectate: true });
    const locked = listed({ open: 0, seat: undefined, bots: 3 });
    expect(playerTableAction({ ...atTable, open: 3, seat: 1 }, { ABCD: locked }, null)?.join).toBe(false);
  });

  it('disables spectate when the watcher list is full, and skips your own table', () => {
    expect(playerTableAction(atTable, { ABCD: listed({ watchFull: true }) }, null)?.spectateReason).toBe(WATCH_FULL_REASON);
    expect(playerTableAction({ ...atTable, watchFull: true }, {}, null)?.spectateReason).toBe(WATCH_FULL_REASON);
    expect(playerTableAction(atTable, {}, 'ABCD')).toBeNull();
  });

  it('does not offer a seat at a tournament table', () => {
    expect(playerTableAction(atTable, { ABCD: listed({ open: 0, tournament: 'Friday', seat: undefined }) }, null)?.join).toBe(false);
  });

  it('ignores players who are not at a table', () => {
    expect(playerTableAction({ kind: 'online' }, {}, null)).toBeNull();
  });
});
