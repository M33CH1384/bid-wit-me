/**
 * @vitest-environment happy-dom
 *
 * ENTRY FLOW (owner, 2026-10-23): a new or logged-out visitor gets a prompt —
 * sign in or play as a guest (session-scoped dismissal, deep-link destination
 * preserved, inactivity notice takes precedence, never shown to a signed-in
 * user or while a session restore is pending) — and a first INTERACTIVE
 * sign-in (never a silent restore) gets exactly one preferences-step offer
 * per account on this device, across both the completion and skip paths.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { account, clearFirstSignIn, loadAccount, passkeyRegister, passkeySignIn, setUsername, signOut, type AccountUser } from '../src/account/api';
import {
  ENTRY_GUEST_KEY, PREFS_DONE_PREFIX, dismissGuest, entryModalVisible, entrySuppressed, guestDismissed,
  markPrefsDone, prefsDone, prefsOfferVisible,
} from '../src/entryFlow';
import { IDLE_NOTICE_KEY, markIdleNoticeOwed } from '../src/inactivity';
import { DEFAULT_SETTINGS, saveSettings } from '../src/settings';
import EntryFlow from '../src/EntryFlow';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(async () => ({ id: 'cred-1' })),
  startRegistration: vi.fn(async () => ({ id: 'cred-1' })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const USER: AccountUser = { id: 'u-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1, progressImported: false, avatar: null, identities: [], passkeys: [] };
const USER2: AccountUser = { ...USER, id: 'u-2', username: 'Second' };
const USER_NEEDS: AccountUser = { ...USER, id: 'u-3', username: null, needsUsername: true, suggestion: 'Fresh' };
const NAMED: AccountUser = { ...USER_NEEDS, username: 'FreshName', needsUsername: false, suggestion: null };

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  } as unknown as Response;
}

let meUser: AccountUser | null = null;
let registerResult: { user: AccountUser; outcome?: string } = { user: USER, outcome: 'new' };

function stubAuth() {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/api/auth/config')) return jsonRes({ providers: ['google'], passkeys: true, accounts: true });
    if (url.includes('/api/auth/me')) return jsonRes({ user: meUser });
    if (url.includes('/api/auth/logout')) return jsonRes({ ok: true });
    if (url.includes('/api/auth/progress')) return jsonRes({ progress: {} });
    if (url.includes('/passkey/login/options')) return jsonRes({ flow: 'f-1', options: {} });
    if (url.includes('/passkey/login/verify')) return jsonRes({ user: USER });
    if (url.includes('/passkey/register/options')) return jsonRes({ flow: 'f-2', options: {} });
    if (url.includes('/passkey/register/verify')) return jsonRes(registerResult);
    if (url.includes('/username/check')) return jsonRes({ ok: true });
    if (url.includes('/api/auth/username')) return jsonRes({ user: NAMED });
    return jsonRes({});
  });
}

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

const byTestId = (id: string) => document.querySelector(`[data-testid="${id}"]`);
async function flush() { await act(async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); }); }
function click(el: Element | null) { expect(el).not.toBeNull(); act(() => { (el as HTMLElement).click(); }); }

const cleanups: Array<() => void> = [];
function mountEntry(props: { onPrefsDone?: () => void } = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => { root.render(createElement(EntryFlow, props)); });
  const un = () => { act(() => root.unmount()); host.remove(); };
  cleanups.push(un);
  return un;
}

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, '', '/');
  meUser = null;
  registerResult = { user: USER, outcome: 'new' };
  stubAuth();
  await loadAccount(true); // baseline: resolved, signed out
  clearFirstSignIn();
  expect(account.get().user).toBeNull();
  expect(account.get().firstSignIn).toBeNull();
});

afterEach(async () => {
  while (cleanups.length) cleanups.pop()!();
  await signOut().catch(() => undefined);
  clearFirstSignIn();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* ------------------------------------------------------------ pure rules */
describe('entry flow storage + visibility rules', () => {
  it('guest dismissal round-trips in session storage only', () => {
    const s = fakeStorage();
    expect(guestDismissed(s)).toBe(false);
    dismissGuest(s);
    expect(guestDismissed(s)).toBe(true);
    s.setItem(ENTRY_GUEST_KEY, 'later');
    expect(guestDismissed(s)).toBe(false); // anything but "1" is not a dismissal
  });

  it('preferences-done is keyed per account', () => {
    const s = fakeStorage();
    markPrefsDone(s, 'u-1');
    expect(prefsDone(s, 'u-1')).toBe(true);
    expect(prefsDone(s, 'u-2')).toBe(false);
    expect(s.getItem(PREFS_DONE_PREFIX + 'u-1')).toBe('1');
  });

  it('the modal needs every gate open at once', () => {
    const base = { ready: true, accounts: true, signedIn: false, guestDismissed: false, idleNoticeShowing: false, suppressed: false };
    expect(entryModalVisible(base)).toBe(true);
    expect(entryModalVisible({ ...base, ready: false })).toBe(false); // restore pending — no flash
    expect(entryModalVisible({ ...base, accounts: false })).toBe(false);
    expect(entryModalVisible({ ...base, signedIn: true })).toBe(false); // never for a signed-in user
    expect(entryModalVisible({ ...base, guestDismissed: true })).toBe(false);
    expect(entryModalVisible({ ...base, idleNoticeShowing: true })).toBe(false); // the idle notice goes first
    expect(entryModalVisible({ ...base, suppressed: true })).toBe(false);
  });

  it('the preferences offer needs an interactive sign-in for THIS account, name settled, not done', () => {
    const base = { firstSignInId: 'u-1', userId: 'u-1', needsUsername: false, done: false };
    expect(prefsOfferVisible(base)).toBe(true);
    expect(prefsOfferVisible({ ...base, firstSignInId: null })).toBe(false); // a restore never offers
    expect(prefsOfferVisible({ ...base, userId: 'u-2' })).toBe(false);
    expect(prefsOfferVisible({ ...base, userId: null })).toBe(false);
    expect(prefsOfferVisible({ ...base, needsUsername: true })).toBe(false); // username pick goes first
    expect(prefsOfferVisible({ ...base, done: true })).toBe(false);
  });

  it('deliberate game links and previews are suppressed', () => {
    expect(entrySuppressed('?autostart=1&seed=x')).toBe(true);
    expect(entrySuppressed('?preview=turn-ring')).toBe(true);
    expect(entrySuppressed('?signin=ok')).toBe(false);
    expect(entrySuppressed('')).toBe(false);
  });
});

/* ------------------------------------------- the first-sign-in signal */
describe('first-sign-in signal (account store)', () => {
  it('a silent session restore NEVER raises it', async () => {
    meUser = USER;
    await loadAccount(true);
    expect(account.get().user?.id).toBe('u-1');
    expect(account.get().firstSignIn).toBeNull();
  });

  it('an OAuth return (?signin=new) raises it; a later param-less reload does not', async () => {
    meUser = USER;
    history.replaceState(null, '', '/?signin=new&via=google');
    await loadAccount(true);
    expect(account.get().firstSignIn?.id).toBe('u-1');
    clearFirstSignIn();
    await loadAccount(true); // plain reload — the restore path
    expect(account.get().user?.id).toBe('u-1');
    expect(account.get().firstSignIn).toBeNull();
  });

  it('an OAuth return for an existing account (?signin=ok) raises it too', async () => {
    meUser = USER;
    history.replaceState(null, '', '/?signin=ok&via=google');
    await loadAccount(true);
    expect(account.get().firstSignIn?.id).toBe('u-1');
  });

  it('an OAuth LINK return (?signin=linked) is not a sign-in and does not raise it', async () => {
    meUser = USER;
    history.replaceState(null, '', '/?signin=linked&via=google');
    await loadAccount(true);
    expect(account.get().firstSignIn).toBeNull();
  });

  it('a passkey sign-in raises it', async () => {
    const err = await passkeySignIn();
    expect(err).toBeNull();
    expect(account.get().firstSignIn?.id).toBe('u-1');
  });

  it('creating an account with a passkey raises it; adding one while signed in does not', async () => {
    registerResult = { user: USER2, outcome: 'new' };
    const err = await passkeyRegister('Second');
    expect(err).toBeNull();
    expect(account.get().firstSignIn?.id).toBe('u-2');
    // now signed in as u-2: registering another passkey is not a sign-in
    clearFirstSignIn();
    registerResult = { user: USER2 };
    const err2 = await passkeyRegister();
    expect(err2).toBeNull();
    expect(account.get().firstSignIn).toBeNull();
  });
});

/* ------------------------------------------------------- the entry modal */
describe('entry modal (component)', () => {
  it('shows for a logged-out visitor; Play as guest dismisses it for the session', async () => {
    mountEntry();
    await flush();
    expect(byTestId('entry-modal')).not.toBeNull();
    click(byTestId('entry-guest'));
    expect(byTestId('entry-modal')).toBeNull();
    expect(sessionStorage.getItem(ENTRY_GUEST_KEY)).toBe('1');
    // a fresh mount in the SAME session stays dismissed…
    mountEntry();
    await flush();
    expect(byTestId('entry-modal')).toBeNull();
    // …but dismissal lives in sessionStorage, so a new session (flag gone) prompts again
    sessionStorage.clear();
    mountEntry();
    await flush();
    expect(byTestId('entry-modal')).not.toBeNull();
  });

  it('never shows while the account is still resolving (no restore flash)', async () => {
    // A FRESH account module whose first load stays pending: ready is false
    // and the modal's gate (fed by the store's own state) stays shut; once
    // the load resolves signed-out, the gate opens.
    vi.resetModules();
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', (url: string) => {
      if (url.includes('/api/auth/me')) return new Promise<Response>((res) => { release = res; });
      return Promise.resolve(jsonRes({ providers: [], passkeys: true, accounts: true }));
    });
    const fresh = await import('../src/account/api');
    const gate = () => entryModalVisible({
      ready: fresh.account.get().ready, accounts: fresh.account.get().accounts,
      signedIn: !!fresh.account.get().user, guestDismissed: false, idleNoticeShowing: false, suppressed: false,
    });
    const p = fresh.loadAccount();
    expect(fresh.account.get().ready).toBe(false);
    expect(gate()).toBe(false);
    release(jsonRes({ user: null }));
    await p;
    expect(fresh.account.get().ready).toBe(true);
    expect(gate()).toBe(true);
    vi.resetModules();
  });

  it('never shows to a signed-in user', async () => {
    meUser = USER;
    await loadAccount(true);
    mountEntry();
    await flush();
    expect(byTestId('entry-modal')).toBeNull();
    expect(byTestId('first-prefs')).toBeNull(); // a restore is not a first sign-in either
  });

  it('the inactivity notice takes precedence; the prompt follows once it is dismissed', async () => {
    vi.useFakeTimers();
    markIdleNoticeOwed(localStorage);
    mountEntry();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(byTestId('entry-modal')).toBeNull(); // suppressed while the notice is owed/showing
    localStorage.removeItem(IDLE_NOTICE_KEY); // the notice's OK button retires the flag
    act(() => { vi.advanceTimersByTime(1_000); }); // the flow re-reads the flag on its tick
    expect(byTestId('entry-modal')).not.toBeNull();
    vi.useRealTimers();
  });

  it('a deep link survives: the prompt overlays /t/CODE and guest leaves the path untouched', async () => {
    history.replaceState(null, '', '/t/ABCD');
    mountEntry();
    await flush();
    expect(byTestId('entry-modal')).not.toBeNull();
    click(byTestId('entry-guest'));
    expect(byTestId('entry-modal')).toBeNull();
    expect(location.pathname).toBe('/t/ABCD');
  });

  it('Sign in opens the existing sign-in sheet (which returns to this path)', async () => {
    history.replaceState(null, '', '/t/ABCD');
    mountEntry();
    await flush();
    click(byTestId('entry-signin'));
    expect(byTestId('signin-sheet')).not.toBeNull();
    expect(byTestId('signin-google')).not.toBeNull(); // the app's real providers, not a new auth
    expect(byTestId('entry-modal')).toBeNull();
  });
});

/* --------------------------------------------- first-sign-in preferences */
describe('first-sign-in preferences step (component)', () => {
  async function mountAfterOAuthNew(user: AccountUser) {
    meUser = user;
    history.replaceState(null, '', '/?signin=new&via=google');
    mountEntry();
    await act(async () => { await loadAccount(true); });
    await flush();
  }

  it('offers the step after a first sign-in; Skip marks it done for that account only', async () => {
    await mountAfterOAuthNew(USER);
    expect(byTestId('entry-modal')).toBeNull(); // signed in — no guest prompt
    expect(byTestId('first-prefs')).not.toBeNull();
    click(byTestId('first-prefs-skip'));
    expect(localStorage.getItem(PREFS_DONE_PREFIX + 'u-1')).toBe('1');
    expect(byTestId('first-prefs')).toBeNull();
    expect(account.get().firstSignIn).toBeNull();
    // a DIFFERENT account's first sign-in on this device is offered fresh
    await act(async () => { await signOut(); });
    meUser = USER2;
    history.replaceState(null, '', '/?signin=ok&via=google');
    await act(async () => { await loadAccount(true); });
    await flush();
    expect(prefsDone(localStorage, 'u-2')).toBe(false);
    expect(byTestId('first-prefs')).not.toBeNull();
    click(byTestId('first-prefs-skip'));
    expect(localStorage.getItem(PREFS_DONE_PREFIX + 'u-2')).toBe('1');
  });

  it('the same account is never re-offered after skipping (later interactive sign-in)', async () => {
    await mountAfterOAuthNew(USER);
    click(byTestId('first-prefs-skip'));
    await act(async () => { await signOut(); });
    history.replaceState(null, '', '/?signin=ok&via=google');
    await act(async () => { await loadAccount(true); });
    await flush();
    expect(account.get().firstSignIn?.id).toBe('u-1'); // the signal fires…
    expect(byTestId('first-prefs')).toBeNull(); // …but the done marker retires the offer
  });

  it('completing through the real Settings sheet marks it done; guest-era settings are the starting point', async () => {
    saveSettings({ ...DEFAULT_SETTINGS, quality: 'low' }); // changed as a guest, before signing in
    const done = vi.fn();
    meUser = USER;
    history.replaceState(null, '', '/?signin=new&via=google');
    mountEntry({ onPrefsDone: done });
    await act(async () => { await loadAccount(true); });
    await flush();
    click(byTestId('first-prefs-open'));
    const sheet = byTestId('more-options');
    expect(sheet).not.toBeNull();
    const low = sheet!.querySelector('button[aria-label="Low"]');
    expect(low?.getAttribute('aria-checked')).toBe('true'); // the guest's choice, not a reset to defaults
    click(sheet!.querySelector('.sheet-close'));
    expect(localStorage.getItem(PREFS_DONE_PREFIX + 'u-1')).toBe('1');
    expect(byTestId('more-options')).toBeNull();
    expect(done).toHaveBeenCalledTimes(1); // Root remounts the screens onto the saved settings
  });

  it('waits for the username pick, then offers (name first, preferences second)', async () => {
    await mountAfterOAuthNew(USER_NEEDS);
    expect(byTestId('first-prefs')).toBeNull(); // needsUsername defers the offer
    await act(async () => { await setUsername('FreshName'); });
    await flush();
    expect(account.get().user?.needsUsername).toBe(false);
    expect(byTestId('first-prefs')).not.toBeNull();
    click(byTestId('first-prefs-skip'));
    expect(localStorage.getItem(PREFS_DONE_PREFIX + 'u-3')).toBe('1');
  });
});

/* ------------------------------------------------------------ source pins */
describe('entry flow wiring pins', () => {
  const main = readFileSync(join(process.cwd(), 'apps/web/src/main.tsx'), 'utf8');
  const api = readFileSync(join(process.cwd(), 'apps/web/src/account/api.ts'), 'utf8');

  it('the flow is mounted once at the root, beside the idle guard', () => {
    expect(main).toContain("import EntryFlow from './EntryFlow';");
    expect(main).toContain('<EntryFlow onPrefsDone=');
    expect(main.indexOf('<IdleGuard />')).toBeLessThan(main.indexOf('<EntryFlow onPrefsDone='));
  });

  it('only interactive completions raise the first-sign-in marker', () => {
    expect(api).toContain("if (me.user && (result === 'ok' || result === 'new')) set({ firstSignIn: me.user });");
    expect(api).toContain('set({ firstSignIn: v.user }); // interactive sign-in (never a restore)');
    expect(api).toContain('if (!wasSignedIn) set({ firstSignIn: v.user }); // account creation IS the first sign-in');
  });
});
