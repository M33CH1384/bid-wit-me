/**
 * @vitest-environment happy-dom
 *
 * INACTIVITY NOTICE vs SIGN-IN (owner, 2026-10-23): the "Signed out for
 * inactivity" popup must go away whenever someone signs in. The owed-notice
 * flag now has one home (inactivity.ts helpers); the account store clears it
 * inside set() — the one choke point EVERY transition to signed-in passes
 * through (session restore, an OAuth return, a passkey, any surface) — and
 * IdleGuard derives visibility from (owed && !signedIn). These tests pin the
 * transition at the state level through two different sign-in surfaces, the
 * no-resurrection rule, and the legitimate still-signed-out flow.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { account, loadAccount, passkeySignIn, signOut } from '../src/account/api';
import { IDLE_NOTICE_KEY, idleNoticeOwed, idleNoticeVisible, markIdleNoticeOwed } from '../src/inactivity';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(async () => ({ id: 'cred-1' })),
  startRegistration: vi.fn(async () => ({ id: 'cred-1' })),
}));

const USER = { id: 'u-1', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1, progressImported: false, avatar: null, identities: [], passkeys: [] };

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  } as unknown as Response;
}

/** Stub the auth API; `me` decides who (if anyone) the session resolves to. */
function stubAuth(me: () => typeof USER | null) {
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/api/auth/config')) return jsonRes({ providers: [], passkeys: true, accounts: true });
    if (url.includes('/api/auth/me')) return jsonRes({ user: me() });
    if (url.includes('/api/auth/logout')) return jsonRes({ ok: true });
    if (url.includes('/api/auth/passkey/login/options')) return jsonRes({ flow: 'f-1', options: {} });
    if (url.includes('/api/auth/passkey/login/verify')) return jsonRes({ user: USER });
    return jsonRes({});
  });
}

const owed = () => idleNoticeOwed(localStorage);
const visible = () => idleNoticeVisible(owed(), !!account.get().user);

beforeEach(async () => {
  localStorage.clear();
  stubAuth(() => null);
  await loadAccount(true); // baseline: account resolved, nobody signed in
  expect(account.get().user).toBeNull();
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('sign-in retires the inactivity notice', () => {
  it('session restore: an owed notice dies the moment the session lands', async () => {
    markIdleNoticeOwed(localStorage);
    expect(visible()).toBe(true); // signed out, notice owed → it shows
    stubAuth(() => USER);
    await loadAccount(true); // a restored session is a sign-in transition
    expect(account.get().user?.id).toBe('u-1');
    expect(localStorage.getItem(IDLE_NOTICE_KEY)).toBeNull();
    expect(visible()).toBe(false);
  });

  it('a passkey sign-in from another surface retires it too (same choke point)', async () => {
    markIdleNoticeOwed(localStorage);
    expect(visible()).toBe(true);
    const err = await passkeySignIn();
    expect(err).toBeNull();
    expect(account.get().user?.id).toBe('u-1');
    expect(owed()).toBe(false);
    expect(visible()).toBe(false);
  });

  it('does not resurrect: later account churn and even a manual sign-out leave it gone', async () => {
    markIdleNoticeOwed(localStorage);
    stubAuth(() => USER);
    await loadAccount(true);
    expect(owed()).toBe(false);
    await loadAccount(true); // reload with the session still live
    expect(owed()).toBe(false);
    await signOut(); // a manual sign-out is NOT an idle sign-out — no new notice is owed
    expect(account.get().user).toBeNull();
    expect(owed()).toBe(false);
    expect(visible()).toBe(false);
    // …and a genuinely NEW idle sign-out owes it again (the legitimate flow).
    markIdleNoticeOwed(localStorage);
    expect(visible()).toBe(true);
  });

  it('a signed-out user who has NOT signed in still sees it — even across a reload', async () => {
    markIdleNoticeOwed(localStorage);
    stubAuth(() => null);
    await loadAccount(true); // reload, still nobody signed in
    expect(owed()).toBe(true);
    expect(visible()).toBe(true);
  });
});

describe('popup rendering pins', () => {
  const guard = readFileSync(join(process.cwd(), 'apps/web/src/IdleGuard.tsx'), 'utf8');
  const styles = readFileSync(join(process.cwd(), 'apps/web/src/styles.css'), 'utf8');
  const api = readFileSync(join(process.cwd(), 'apps/web/src/account/api.ts'), 'utf8');

  it('the OK button carries the standard readable treatment (.btn primary)', () => {
    expect(guard).toContain('<button type="button" className="btn primary" onClick={dismiss}>OK</button>');
    expect(guard).not.toContain('className="btn"');
    // …and .primary is the gold block with dark text in BOTH themes (the neon
    // block deliberately never overrides the gold tokens).
    expect(styles).toMatch(/\.primary \{ background: linear-gradient\(180deg, var\(--gold-hi\), var\(--gold-deep\)\); color: #1d1204;/);
  });

  it('visibility derives from (owed && !signedIn), driven by the live account store', () => {
    expect(guard).toContain('idleNoticeVisible(notice, !!acct.user)');
    expect(guard).toContain('useAccount()');
  });

  it('the account store clears the flag inside set() when a user lands', () => {
    expect(api).toContain('if (p.user) { try { clearIdleNotice(localStorage); } catch { /* no storage */ } }');
  });
});
