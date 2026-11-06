/**
 * @vitest-environment happy-dom
 *
 * REMOVE THE 'YOUR NAME' FIELD (owner, 2026-11-06): the field is removed
 * altogether from the find-a-table screen and the create-a-table screen —
 * superseding the demotion shipped in 404b23f6 the same night. His line:
 * "if it's a guest it can appear, but if the user is signed in it's just
 * in the way." So:
 *  - SIGNED IN (account has a username): no name field on either screen
 *    (the find-a-table "You" card held ONLY that field, so the card goes
 *    too; a signed-in cutthroat creator loses the whole TABLE card, whose
 *    only content was the name row). The seat name is the account
 *    username, full stop: the account layer now SYNCS bwm.online.name to
 *    the username on every account resolution, so a stored per-table
 *    override dies instead of still greeting the table via OnlineApp.
 *  - GUESTS: the field stays exactly as it works today on both screens —
 *    same gate ('Enter your name first'), same saveName on create/join.
 *  - A signed-in account with no username yet keeps the field until it
 *    has one (there is no account name to sit under).
 * The /t/CODE Entry screen is a different surface and is untouched.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Setup from '../src/Setup';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';
import { loadAccount, setUsername } from '../src/account/api';
import { loadName, saveName } from '../src/online/identity';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let signedIn = false;
const ME = { id: 'u-self-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1760000000000, progressImported: false, avatar: null, identities: [], passkeys: [] };

function mockFetch() {
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string }) => {
    const u = String(url);
    const json = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 404, headers: { get: () => 'application/json' }, json: async () => body });
    if (u.includes('/api/auth/config')) return json({ accounts: true, providers: [], passkeys: false });
    if (u.includes('/api/auth/me')) return json({ user: signedIn ? ME : null });
    if (u.endsWith('/api/auth/username')) return json({ user: { ...ME, username: 'NewName' } });
    if (u.endsWith('/api/social/teams')) return json({ teams: [] });
    if (u.includes('/api/tables') && init?.method === 'POST') return json({ code: 'XYZ123' });
    if (u.includes('/api/tables')) return json({ tables: [] });
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

function Harness() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [tips, setTips] = useState({ on: false, asked: true });
  return createElement(Setup, { settings: s, onChange: setS, tips, onTips: setTips, onStart: () => {} });
}

beforeEach(async () => {
  localStorage.clear(); sessionStorage.clear();
  history.replaceState(null, '', '/');
  signedIn = false;
  mockFetch();
  // the account store is module state: force it back to signed-out so a
  // guest test never inherits an earlier test's sign-in
  await act(async () => { await loadAccount(true); });
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => { await act(async () => { root.unmount(); }); el.remove(); vi.unstubAllGlobals(); });

async function toLobby() {
  await act(async () => { root.render(createElement(Harness)); });
  await flush();
  await click(qs('[data-testid=play]'));
  await click(qs('[data-testid=door-team]'));
  await click(qs('[data-testid=mode-joker]'));
  await click(qs('[data-testid=play-online]'));
}
async function toCreateForm() {
  await toLobby();
  await click(qs('[data-testid=create-open]'));
}
async function signIn() {
  signedIn = true;
  await act(async () => { await loadAccount(true); });
}

describe('signed in: the field is gone from both screens', () => {
  it('find-a-table: no name input and no "You" card; join + create entry remain', async () => {
    await signIn();
    await toLobby();
    expect(qs('input[aria-label="Your name"]')).toBeNull();
    expect(qs('section[aria-label="You"]')).toBeNull();
    expect(qs('section[aria-label="Join with a code"]')).not.toBeNull();
    expect(qs('[data-testid=create-open]')).not.toBeNull();
  });

  it('create-a-table (partnership): team name stays, no name input anywhere', async () => {
    await signIn();
    await toCreateForm();
    expect(qs('[data-testid=create-team-name]')).not.toBeNull();
    expect(qs('input[aria-label="Your name"]')).toBeNull();
    expect(qs('section[aria-label="Table"]')).not.toBeNull();
  });

  it('create-a-table (cutthroat): no name input, and no empty TABLE card shell', async () => {
    await signIn();
    await act(async () => { root.render(createElement(Harness)); });
    await flush();
    await click(qs('[data-testid=play]'));
    await click(qs('[data-testid=door-cutthroat]'));
    await click(qs('[data-testid=play-online]'));
    await click(qs('[data-testid=create-open]'));
    expect(qs('input[aria-label="Your name"]')).toBeNull();
    expect(qs('[data-testid=create-team-name]')).toBeNull();
    expect(qs('section[aria-label="Table"]')).toBeNull();
  });

  it('a stored override dies at account resolution, and create seats the account name', async () => {
    saveName('OldOverride');
    await signIn();
    expect(loadName()).toBe('M33CH'); // the sync killed the override
    await toCreateForm();
    await click(qs('[data-testid=create-table]'));
    expect(sessionStorage.getItem('bwm.created.XYZ123')).toBe('1');
    expect(loadName()).toBe('M33CH'); // the hello name will be the account name
  });

  it('a username change moves the seat name with it', async () => {
    saveName('OldOverride');
    await signIn();
    await act(async () => { await setUsername('NewName'); });
    expect(loadName()).toBe('NewName');
  });
});

describe('guests: the field stays exactly as it works today', () => {
  it('find-a-table: the "You" card and its field are present', async () => {
    await toLobby();
    expect(qs('section[aria-label="You"]')).not.toBeNull();
    expect(qs('input[aria-label="Your name"]')).not.toBeNull();
  });

  it('create-a-table: the field is present under the team name', async () => {
    await toCreateForm();
    const team = qs('[data-testid=create-team-name]');
    const mine = qs('input[aria-label="Your name"]');
    expect(team).not.toBeNull();
    expect(mine).not.toBeNull();
    expect(team!.compareDocumentPosition(mine!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the join gate still demands the name first', async () => {
    await toLobby();
    const form = qs<HTMLFormElement>('form.join-row');
    expect(form).not.toBeNull();
    await act(async () => { form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(el.querySelector('.err')?.textContent).toMatch(/Enter your name first/);
  });

  it('a guest create still saves the typed name as the seat name', async () => {
    await toCreateForm();
    await type(qs<HTMLInputElement>('input[aria-label="Your name"]')!, 'GuestGal');
    await click(qs('[data-testid=create-table]'));
    expect(sessionStorage.getItem('bwm.created.XYZ123')).toBe('1');
    expect(loadName()).toBe('GuestGal');
  });
});
