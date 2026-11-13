/**
 * @vitest-environment happy-dom
 *
 * SEAT/NAME-SWAP FIX PINS — lobby half (owner bundle, 2026-11-08):
 *  - M1: when exactly two humans sit on OPPOSITE sides of a partnership
 *    lobby, the lobby says so in plain words before anyone starts a game
 *    crossed (the 2026-11-06 incident: his partner was auto-seated beside
 *    him = the other team, and nothing warned either of them).
 *  - M2: the create-form pending team name binds to the CREATOR's side —
 *    the side of the seat they first hold in the lobby — not to whatever
 *    side they happen to sit on when the roster fetch resolves. If they
 *    have crossed sides by then, the name waits; it is only ever sent
 *    while they sit on their own side.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Lobby from '../src/online/Lobby';
import { DEFAULT_SETTINGS, settingsToRules } from '../src/settings';
import { loadAccount } from '../src/account/api';
import { savePendingTeamName, takePendingTeamName } from '../src/TeamName';
import type { ConnState, TableConnection } from '../src/online/connection';
import type { RoomInfo } from '@spades/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let signedIn = false;
let gateTeams = false;
let releaseTeams: (() => void) | null = null;

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body });
    if (u.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (u.includes('/api/auth/me')) return signedIn
      ? json({ user: { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] } })
      : json({ user: null });
    if (u.endsWith('/api/social/teams')) {
      if (gateTeams) return new Promise((res) => { releaseTeams = () => res(json({ teams: [] })); });
      return json({ teams: [] });
    }
    return json({});
  }));
}

let root: Root; let el: HTMLDivElement;
const qs = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
  signedIn = false; gateTeams = false; releaseTeams = null;
  mockFetch();
  await act(async () => { await loadAccount(true); });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); document.body.querySelectorAll('.lobby-dock, .lobby-chat-portal').forEach((n) => n.remove()); vi.unstubAllGlobals(); });

const humanSeat = (playerId: string, name: string, uid?: string) => ({ kind: 'human' as const, playerId, uid, name, connected: true, media: { cam: false, mic: false } });
const EMPTY = { kind: 'empty' as const };

function fixtureRoom(over: Partial<RoomInfo> = {}): RoomInfo {
  return {
    code: 'KYWCH', hostId: 'me', phase: 'lobby',
    rules: settingsToRules(DEFAULT_SETTINGS), botLevel: 'mixed',
    seats: [humanSeat('me', 'You'), EMPTY, EMPTY, EMPTY],
    members: [{ playerId: 'me', name: 'You', connected: true, seat: 0 }],
    deadline: null, turnClockStart: null, ready: [], rev: 1, seq: 0, game: 0,
    teamNames: ['', ''], venue: 'classic',
    ...over,
  } as unknown as RoomInfo;
}

async function renderLobby(room: RoomInfo, seat: number | null, send: (m: unknown) => void, you = 'me') {
  const cs = {
    status: 'open', you, room, seat, view: null, run: null,
    chat: [], error: null, pending: false, socketGen: 1, statsOff: false,
  } as unknown as ConnState;
  const conn = { send } as unknown as TableConnection;
  await act(async () => {
    root.render(createElement(Lobby, {
      conn, cs, mesh: null, settings: DEFAULT_SETTINGS,
      onSettings: () => {}, onBackToGame: null, onLeave: () => {},
    }));
  });
  await flush(); await flush();
}

describe('crossed-partners lobby warning (M1)', () => {
  it('warns in plain words when the only two humans sit on opposite sides', async () => {
    const room = fixtureRoom({
      seats: [humanSeat('me', 'You'), humanSeat('p2', 'LovleyT714'), EMPTY, EMPTY],
      members: [
        { playerId: 'me', name: 'You', connected: true, seat: 0 },
        { playerId: 'p2', name: 'LovleyT714', connected: true, seat: 1 },
      ],
    } as Partial<RoomInfo>);
    await renderLobby(room, 0, vi.fn());
    const note = qs('[data-testid=lobby-crossed]');
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/You and LovleyT714 are on opposite teams/);
    expect(note!.textContent).toMatch(/across/);
  });

  it('no warning when the two humans sit across from each other (partners)', async () => {
    const room = fixtureRoom({
      seats: [humanSeat('me', 'You'), EMPTY, humanSeat('p2', 'LovleyT714'), EMPTY],
    } as Partial<RoomInfo>);
    await renderLobby(room, 0, vi.fn());
    expect(qs('[data-testid=lobby-crossed]')).toBeNull();
  });

  it('no warning with three humans seated — a mixed table is by design', async () => {
    const room = fixtureRoom({
      seats: [humanSeat('me', 'You'), humanSeat('p2', 'LovleyT714'), humanSeat('p3', 'Rafa'), EMPTY],
    } as Partial<RoomInfo>);
    await renderLobby(room, 0, vi.fn());
    expect(qs('[data-testid=lobby-crossed]')).toBeNull();
  });

  it('no warning in cutthroat (no teams to cross) or once the game is playing', async () => {
    const crossed = [humanSeat('me', 'You'), humanSeat('p2', 'LovleyT714'), EMPTY, EMPTY];
    const cut = fixtureRoom({
      seats: crossed,
      rules: { ...settingsToRules(DEFAULT_SETTINGS), partnerships: false },
    } as Partial<RoomInfo>);
    await renderLobby(cut, 0, vi.fn());
    expect(qs('[data-testid=lobby-crossed]')).toBeNull();
    const live = fixtureRoom({ seats: crossed, phase: 'playing' } as Partial<RoomInfo>);
    await renderLobby(live, 0, vi.fn());
    expect(qs('[data-testid=lobby-crossed]')).toBeNull();
  });
});

describe('pending create name binds to the creator’s side (M2)', () => {
  it('waits out a side-crossing: never sent from the other side, sent once the creator is back on their side', async () => {
    signedIn = true;
    gateTeams = true;
    mockFetch();
    await act(async () => { await loadAccount(true); });
    savePendingTeamName('KYWCH', 'Homies');
    const send = vi.fn();
    const room = fixtureRoom({
      hostId: 'u-self-1',
      seats: [humanSeat('u-self-1', 'M33CH', 'u-self-1'), EMPTY, EMPTY, EMPTY],
      members: [{ playerId: 'u-self-1', name: 'M33CH', connected: true, seat: 0 }],
    } as Partial<RoomInfo>);
    // creator arrives on seat 0 (side 0); the roster fetch is still out
    await renderLobby(room, 0, send, 'u-self-1');
    expect(send.mock.calls.filter((c) => (c[0] as { t: string }).t === 'teamName')).toHaveLength(0);
    // the creator crosses to the other side before the fetch resolves
    await renderLobby(room, 3, send, 'u-self-1');
    await act(async () => { releaseTeams?.(); });
    await flush(); await flush();
    // rosters are in, but the creator sits on side 1: the name must NOT land there
    expect(send.mock.calls.filter((c) => (c[0] as { t: string }).t === 'teamName')).toHaveLength(0);
    expect(takePendingTeamName('KYWCH')).toBe(''); // taken into the lobby's hands (one-shot store)
    // back on their own side (seat 2): the name goes out for side 0, once
    await renderLobby(room, 2, send, 'u-self-1');
    await flush();
    const calls = send.mock.calls.filter((c) => (c[0] as { t: string }).t === 'teamName');
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toEqual({ t: 'teamName', name: 'Homies' });
  });
});
