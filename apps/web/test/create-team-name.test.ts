/**
 * @vitest-environment happy-dom
 *
 * CREATE A TABLE: TEAM NAME FIRST (owner, 2026-11-05): on the online create
 * form the TABLE card asked "YOUR NAME" (prefilled with his account name)
 * and never asked for a team name at all — the team name only existed later,
 * in the table lobby. Now the create form's TABLE card leads with the TEAM
 * name for partnership modes: type a new one, or pick one of his previous
 * teams from the dropdown (his recorded team names from
 * GET /api/social/teams, plus the names saved on this device — the picker
 * was a chip stack until the owner's 2026-11-08 dropdown swap; the offered
 * set and the pick path are unchanged, see teams-dropdown.test.ts). The
 * chosen name rides the pending handoff
 * (savePendingTeamName, the pendingVenue pattern) into the room, where the
 * lobby applies it through the SAME {t:'teamName'} send + rosterBlock
 * validation as the TeamChip. Your name stays — demoted under the team
 * name, honestly labelled — because it is the seat display name (the hello
 * name) and a guest's only name. (That demotion was superseded the same
 * night, 2026-11-06: the field is now REMOVED for signed-in players and
 * remains for guests only — see remove-name-field.test.ts. The renders
 * below that assert the field are guest renders, where it still appears.)
 * Cutthroat create has no team row.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from '../src/Setup';
import Lobby from '../src/online/Lobby';
import { DEFAULT_SETTINGS, type Settings, settingsToRules } from '../src/settings';
import { loadAccount } from '../src/account/api';
import { OFFLINE_PAIR_KEY, pairKeyForUser, pairTeamNames, savePendingTeamName, takePendingTeamName } from '../src/TeamName';
import { saveName } from '../src/online/identity';
import type { ConnState, TableConnection } from '../src/online/connection';
import type { RoomInfo } from '@spades/protocol';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEAMS = [
  { name: 'Homies', full: false, members: [{ id: 'u-other-1', name: 'LovleyT714' }] },
  { name: 'Big Dawgs', full: false, members: [] },
];
let teamsPayload: unknown = { teams: TEAMS };
let signedIn = false;

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    const u = String(url);
    const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body });
    if (u.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (u.includes('/api/auth/me')) return signedIn
      ? json({ user: { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] } })
      : json({ user: null });
    if (u.endsWith('/api/social/teams')) return json(teamsPayload);
    if (u.includes('/api/tables') && init?.method === 'POST') return json({ code: 'XYZ123' });
    if (u.startsWith('/api/tables') || u.includes('/api/tables')) return json({ tables: [] });
    return json({});
  }));
}

let root: Root; let el: HTMLDivElement;
const qs = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};
const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await flush();
};
/** Drive the previous-teams dropdown (a native select since the owner's
 *  2026-11-08 dropdown swap; the repo's venue-test idiom). */
const choose = async (sel: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(sel, value);
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await flush();
};
const offered = (sel: HTMLSelectElement) => [...sel.querySelectorAll('option')].map((o) => o.textContent);

function Harness() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [tips, setTips] = useState({ on: false, asked: true });
  return createElement(Setup, { settings: s, onChange: setS, tips, onTips: setTips, onStart: () => {} });
}

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
  teamsPayload = { teams: TEAMS };
  signedIn = false;
  mockFetch();
  // the account store is module state: force it back to signed-out so a
  // guest test never inherits an earlier test's sign-in (the wizard's
  // name field depends on it since the 2026-11-06 removal)
  await act(async () => { await loadAccount(true); });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); document.body.querySelectorAll('.lobby-dock, .lobby-chat-portal').forEach((n) => n.remove()); vi.unstubAllGlobals(); });

async function toCreateForm() {
  await act(async () => { root.render(createElement(Harness)); });
  await flush();
  await click(qs('[data-testid=play]'));
  await click(qs('[data-testid=door-team]'));
  await click(qs('[data-testid=mode-joker]'));
  await click(qs('[data-testid=play-online]'));
  await click(qs('[data-testid=create-open]'));
}

describe('pending team name handoff (store)', () => {
  it('round-trips a cleaned name exactly once, keyed by table code', () => {
    savePendingTeamName('XYZ123', '  Homies  ');
    expect(takePendingTeamName('XYZ123')).toBe('Homies');
    expect(takePendingTeamName('XYZ123')).toBe(''); // taken — gone
    expect(takePendingTeamName('OTHER')).toBe('');
  });
  it('an empty or uncleanable name saves nothing', () => {
    savePendingTeamName('XYZ123', '   ');
    expect(takePendingTeamName('XYZ123')).toBe('');
  });
});

describe('create form: team name first (partnership)', () => {
  it('the TABLE card leads with the team name; your name is demoted below it, still editable', async () => {
    saveName('M33CH');
    await toCreateForm();
    const team = qs<HTMLInputElement>('[data-testid=create-team-name]');
    const mine = qs<HTMLInputElement>('input[aria-label="Your name"]');
    expect(team).not.toBeNull();
    expect(mine).not.toBeNull();
    expect(mine!.value).toBe('M33CH');
    // team name comes FIRST in the card (document order)
    expect(team!.compareDocumentPosition(mine!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('signed in: previous teams render from the roster endpoint; picking one fills the field', async () => {
    signedIn = true;
    await act(async () => { await loadAccount(true); });
    await toCreateForm();
    const sel = qs<HTMLSelectElement>('[data-testid=create-team-prev-select]')!;
    expect(sel).not.toBeNull();
    expect(offered(sel)).toEqual(expect.arrayContaining(['Homies', 'Big Dawgs']));
    await choose(sel, 'Big Dawgs');
    expect(qs<HTMLInputElement>('[data-testid=create-team-name]')!.value).toBe('Big Dawgs');
  });

  it('signed out: the device’s own saved pairing names are offered (real data, no fixtures)', async () => {
    pairTeamNames.set(pairKeyForUser('Some Pal'), 'Block Stars');
    await toCreateForm();
    const sel = qs<HTMLSelectElement>('[data-testid=create-team-prev-select]')!;
    expect(offered(sel)).toContain('Block Stars');
  });

  it('create with a picked team name hands it to the room as a pending', async () => {
    signedIn = true;
    await act(async () => { await loadAccount(true); });
    await toCreateForm();
    await choose(qs<HTMLSelectElement>('[data-testid=create-team-prev-select]')!, 'Homies');
    await click(qs('[data-testid=create-table]'));
    expect(sessionStorage.getItem('bwm.pendingTeam.XYZ123')).toBe('Homies');
  });

  it('create with a typed new team name hands it over too', async () => {
    saveName('M33CH');
    await toCreateForm();
    await type(qs<HTMLInputElement>('[data-testid=create-team-name]')!, 'Night Owls');
    await click(qs('[data-testid=create-table]'));
    expect(sessionStorage.getItem('bwm.pendingTeam.XYZ123')).toBe('Night Owls');
  });

  it('create with no team name saves no pending (the lobby chip stays the way in)', async () => {
    saveName('M33CH');
    await toCreateForm();
    await click(qs('[data-testid=create-table]'));
    expect(sessionStorage.getItem('bwm.pendingTeam.XYZ123')).toBeNull();
  });
});

describe('create form: cutthroat + guests', () => {
  it('cutthroat create keeps its shape: no team name row, your name stays', async () => {
    saveName('M33CH');
    await act(async () => { root.render(createElement(Harness)); });
    await flush();
    await click(qs('[data-testid=play]'));
    await click(qs('[data-testid=door-cutthroat]'));
    await click(qs('[data-testid=play-online]'));
    await click(qs('[data-testid=create-open]'));
    expect(qs('[data-testid=create-team-name]')).toBeNull();
    expect(qs('input[aria-label="Your name"]')).not.toBeNull();
  });

  it('a guest still gets the name field and cannot create without it', async () => {
    await toCreateForm();
    const mine = qs<HTMLInputElement>('input[aria-label="Your name"]');
    expect(mine).not.toBeNull();
    expect(mine!.value).toBe('');
    await click(qs('[data-testid=create-table]'));
    expect(el.querySelector('.err')?.textContent).toMatch(/Enter your name first/);
    expect(sessionStorage.getItem('bwm.pendingTeam.XYZ123')).toBeNull();
  });
});

/* ------------------------------------------------ lobby application */

function fixtureRoom(over: Partial<RoomInfo> = {}): RoomInfo {
  return {
    code: 'KYWCH', hostId: 'me', phase: 'lobby',
    rules: settingsToRules(DEFAULT_SETTINGS), botLevel: 'mixed',
    seats: [
      { kind: 'human', playerId: 'me', uid: 'me', name: 'You', connected: true, media: { cam: false, mic: false } },
      { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' },
    ],
    members: [{ playerId: 'me', name: 'You', connected: true, seat: 0 }],
    deadline: null, turnClockStart: null, ready: [], rev: 1, seq: 0, game: 0,
    teamNames: ['', ''], venue: 'classic',
    ...over,
  } as unknown as RoomInfo;
}

async function renderLobby(room: RoomInfo, send: (m: unknown) => void) {
  const cs = {
    status: 'open', you: 'me', room, seat: 0, view: null, run: null,
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

describe('lobby applies the created table’s team name', () => {
  it('sends the pending name for my side through the chip’s own message, once', async () => {
    savePendingTeamName('KYWCH', 'Homies');
    const send = vi.fn();
    await renderLobby(fixtureRoom(), send);
    expect(send).toHaveBeenCalledWith({ t: 'teamName', name: 'Homies' });
    expect(send.mock.calls.filter((c) => (c[0] as { t: string }).t === 'teamName')).toHaveLength(1);
    expect(takePendingTeamName('KYWCH')).toBe(''); // consumed
  });

  it('never stomps a side that already has a name', async () => {
    savePendingTeamName('KYWCH', 'Homies');
    const send = vi.fn();
    await renderLobby(fixtureRoom({ teamNames: ['Already Named', ''] } as Partial<RoomInfo>), send);
    expect(send.mock.calls.filter((c) => (c[0] as { t: string }).t === 'teamName')).toHaveLength(0);
  });

  it('the full-roster refusal still fires: a full roster + a seated non-member partner blocks the send and says so', async () => {
    signedIn = true;
    teamsPayload = { teams: [{ name: 'Homies', full: true, members: [{ id: 'u-a', name: 'A' }, { id: 'u-b', name: 'B' }, { id: 'u-c', name: 'C' }] }] };
    mockFetch();
    await act(async () => { await loadAccount(true); });
    savePendingTeamName('KYWCH', 'Homies');
    const send = vi.fn();
    const room = fixtureRoom({
      seats: [
        { kind: 'human', playerId: 'me', uid: 'u-self-1', name: 'M33CH', connected: true, media: { cam: false, mic: false } },
        { kind: 'empty' },
        { kind: 'human', playerId: 'p2', uid: 'u-other-9', name: 'Rafa', connected: true, media: { cam: false, mic: false } },
        { kind: 'empty' },
      ],
      members: [
        { playerId: 'me', name: 'M33CH', connected: true, seat: 0 },
        { playerId: 'p2', name: 'Rafa', connected: true, seat: 2 },
      ],
    } as Partial<RoomInfo>);
    // the account user id keys the lobby's roster fetch: cs.you must be the account id
    const cs = {
      status: 'open', you: 'u-self-1', room, seat: 0, view: null, run: null,
      chat: [], error: null, pending: false, socketGen: 1, statsOff: false,
    } as unknown as ConnState;
    const conn = { send } as unknown as TableConnection;
    await act(async () => {
      root.render(createElement(Lobby, {
        conn, cs, mesh: null, settings: DEFAULT_SETTINGS,
        onSettings: () => {}, onBackToGame: null, onLeave: () => {},
      }));
    });
    await flush(); await flush(); await flush();
    expect(send.mock.calls.filter((c) => (c[0] as { t: string }).t === 'teamName')).toHaveLength(0);
    expect(document.body.textContent).toMatch(/“Homies” is full/);
  });
});

describe('bots setup: previous-teams convenience', () => {
  it('a previous team is one pick away and saves as the offline pairing name', async () => {
    pairTeamNames.set(OFFLINE_PAIR_KEY, 'Current Crew');
    pairTeamNames.set(pairKeyForUser('Some Pal'), 'Block Stars');
    await act(async () => { root.render(createElement(Harness)); });
    await flush();
    await click(qs('[data-testid=play]'));
    await click(qs('[data-testid=door-team]'));
    await click(qs('[data-testid=mode-joker]'));
    await click(qs('[data-testid=play-bots]'));
    const sel = qs<HTMLSelectElement>('[data-testid=setup-team-prev-select]')!;
    expect(sel).not.toBeNull();
    expect(offered(sel)).toContain('Block Stars');
    expect(offered(sel)).not.toContain('Current Crew'); // the current name is not offered back
    await choose(sel, 'Block Stars');
    expect(pairTeamNames.get(OFFLINE_PAIR_KEY)).toBe('Block Stars');
    expect(qs<HTMLInputElement>('[id="setup-team-name-in"]')!.value).toBe('Block Stars');
  });

  it('signed in, his recorded bot-table teams are offered too', async () => {
    signedIn = true;
    await act(async () => { await loadAccount(true); });
    await act(async () => { root.render(createElement(Harness)); });
    await flush();
    await click(qs('[data-testid=play]'));
    await click(qs('[data-testid=door-team]'));
    await click(qs('[data-testid=mode-joker]'));
    await click(qs('[data-testid=play-bots]'));
    const sel = qs<HTMLSelectElement>('[data-testid=setup-team-prev-select]')!;
    expect(offered(sel)).toEqual(expect.arrayContaining(['Homies', 'Big Dawgs']));
  });
});
