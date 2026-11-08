/**
 * @vitest-environment happy-dom
 *
 * YOUR TEAMS DROPDOWN (owner, 2026-11-08, landscape setup screenshot):
 * the previous-team CHIP STACK ate the team card — his names piled three
 * rows tall and shoved the rest of the form off the screen. Owner: the
 * names "should be in a dropdown to save space." The picker shared by the
 * bots setup and the online create form is now a native <select>: ONE row
 * tall no matter how many teams he has. The behaviour is the chips'
 * behaviour, unchanged — the same offered set (recorded names from
 * GET /api/social/teams merged with this device's saved pairing names,
 * the current value never offered back, the same 8-name cap, nothing
 * rendered when there is nothing to offer) and a pick applies through
 * the exact path a chip tap used (bots: the pairing save; create: the
 * form state that rides the pending handoff).
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from '../src/Setup';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { loadAccount } from '../src/account/api';
import { OFFLINE_PAIR_KEY, pairKeyForUser, pairTeamNames } from '../src/TeamName';

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
/** Drive a native select the way the repo's venue tests do. */
const choose = async (sel: HTMLSelectElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(sel, value);
    sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await flush();
};
const optionsOf = (sel: HTMLSelectElement) => [...sel.querySelectorAll('option')].map((o) => o.textContent);

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
  await act(async () => { await loadAccount(true); });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); vi.unstubAllGlobals(); });

async function toBotsSetup() {
  await act(async () => { root.render(createElement(Harness)); });
  await flush();
  await click(qs('[data-testid=play]'));
  await click(qs('[data-testid=door-team]'));
  await click(qs('[data-testid=mode-joker]'));
  await click(qs('[data-testid=play-bots]'));
}

async function toCreateForm() {
  await act(async () => { root.render(createElement(Harness)); });
  await flush();
  await click(qs('[data-testid=play]'));
  await click(qs('[data-testid=door-team]'));
  await click(qs('[data-testid=mode-joker]'));
  await click(qs('[data-testid=play-online]'));
  await click(qs('[data-testid=create-open]'));
}

describe('online create: previous teams are a dropdown, not a chip stack', () => {
  it('no previous teams anywhere → no picker renders at all', async () => {
    teamsPayload = { teams: [] };
    mockFetch();
    await toCreateForm();
    expect(qs('[data-testid=create-team-prev]')).toBeNull();
    expect(qs('[data-testid=create-team-prev-select]')).toBeNull();
  });

  it('renders a select whose options are the recorded teams; choosing one fills the field', async () => {
    signedIn = true;
    await act(async () => { await loadAccount(true); });
    await toCreateForm();
    expect(qs('[data-testid=create-team-prev-chip]')).toBeNull();
    const sel = qs<HTMLSelectElement>('[data-testid=create-team-prev-select]');
    expect(sel).not.toBeNull();
    expect(optionsOf(sel!)).toEqual(expect.arrayContaining(['Homies', 'Big Dawgs']));
    await choose(sel!, 'Big Dawgs');
    expect(qs<HTMLInputElement>('[data-testid=create-team-name]')!.value).toBe('Big Dawgs');
  });

  it('a name chosen in the dropdown rides the pending handoff on create', async () => {
    signedIn = true;
    await act(async () => { await loadAccount(true); });
    await toCreateForm();
    await choose(qs<HTMLSelectElement>('[data-testid=create-team-prev-select]')!, 'Homies');
    await click(qs('[data-testid=create-table]'));
    expect(sessionStorage.getItem('bwm.pendingTeam.XYZ123')).toBe('Homies');
  });

});
describe('bots setup: previous teams are a dropdown, not a chip stack', () => {
  it('no previous teams anywhere → no picker renders at all', async () => {
    teamsPayload = { teams: [] };
    mockFetch();
    await toBotsSetup();
    expect(qs('[data-testid=setup-team-prev]')).toBeNull();
    expect(qs('[data-testid=setup-team-prev-select]')).toBeNull();
  });

  it('renders ONE select control — no chip buttons — with the offered names as options', async () => {
    pairTeamNames.set(OFFLINE_PAIR_KEY, 'Current Crew');
    pairTeamNames.set(pairKeyForUser('Some Pal'), 'Block Stars');
    await toBotsSetup();
    expect(qs('[data-testid=setup-team-prev-chip]')).toBeNull();
    const sel = qs<HTMLSelectElement>('[data-testid=setup-team-prev-select]');
    expect(sel).not.toBeNull();
    expect(sel!.tagName).toBe('SELECT');
    // exactly one control in the picker wrapper, however many teams exist
    const wrap = qs('[data-testid=setup-team-prev]')!;
    expect(wrap.querySelectorAll('button, select, input')).toHaveLength(1);
    const opts = optionsOf(sel!);
    expect(opts).toContain('Block Stars');
    expect(opts).not.toContain('Current Crew'); // the current name is never offered back
  });

  it('signed in, the recorded teams are options too', async () => {
    signedIn = true;
    await act(async () => { await loadAccount(true); });
    await toBotsSetup();
    const sel = qs<HTMLSelectElement>('[data-testid=setup-team-prev-select]')!;
    expect(optionsOf(sel)).toEqual(expect.arrayContaining(['Homies', 'Big Dawgs']));
  });

  it('choosing a name applies it as the offline pairing name, exactly like a chip tap', async () => {
    pairTeamNames.set(OFFLINE_PAIR_KEY, 'Current Crew');
    pairTeamNames.set(pairKeyForUser('Some Pal'), 'Block Stars');
    await toBotsSetup();
    const sel = qs<HTMLSelectElement>('[data-testid=setup-team-prev-select]')!;
    await choose(sel, 'Block Stars');
    expect(pairTeamNames.get(OFFLINE_PAIR_KEY)).toBe('Block Stars');
    expect(qs<HTMLInputElement>('[id="setup-team-name-in"]')!.value).toBe('Block Stars');
    // the closed control rests back on its placeholder — the applied name
    // lives in the field above, and is no longer offered (it is current now)
    expect(sel.value).toBe('');
    expect(optionsOf(sel)).not.toContain('Block Stars');
  });

  it('the offered set keeps the 8-name cap — the control stays one row with a long history', async () => {
    for (let i = 1; i <= 10; i++) pairTeamNames.set(pairKeyForUser(`Pal ${i}`), `Crew ${i}`);
    await toBotsSetup();
    const sel = qs<HTMLSelectElement>('[data-testid=setup-team-prev-select]')!;
    // recorded names (Homies, Big Dawgs) lead the merged set, then device
    // names fill to the cap: 8 real options + the placeholder, never more
    const real = optionsOf(sel).filter((t) => t && t !== 'Pick a team…');
    expect(real).toHaveLength(8);
    expect(real.slice(0, 2)).toEqual(['Homies', 'Big Dawgs']);
  });

});

