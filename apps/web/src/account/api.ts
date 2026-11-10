/**
 * Accounts client. Every call is same-origin (/api/auth/*): Pages Functions proxy it to the Worker in production
 * and vite proxies it locally, so the HttpOnly session cookie is first-party. Guest play never calls any of this
 * except one cheap GET /api/auth/config + /me when the menu opens.
 */
import { noteSession, noteSessionLoading } from './sessionHint';
import { handoffCodeFromSearch, inAppShell, mintPageUrl, noteHandoffPending, stripHandoffCode } from './handoff';
import { useSyncExternalStore } from 'react';
import { clearIdleNotice } from '../inactivity';
import { invalidateVenueUnlocks } from '../venues';
import { badges, mergeBadges } from '../badges';
import { loadSeries } from '../Series';
import { myTeamName, pairTeamNames } from '../TeamName';
import { saveName } from '../online/identity';

export type ProviderId = 'google' | 'discord' | 'x' | 'facebook' | 'mock';
export interface AccountUser {
  id: string; username: string | null; needsUsername: boolean; suggestion: string | null; createdAt: number; progressImported: boolean;
  /** profile picture data URL (Demetrius 2026-10-19), null when none */
  avatar: string | null;
  identities: { provider: string; name: string | null; linkedAt: number }[];
  passkeys: { id: string; synced: boolean; createdAt: number; lastUsedAt: number | null }[];
}
export interface AccountState { ready: boolean; accounts: boolean; providers: ProviderId[]; passkeys: boolean; user: AccountUser | null; notice: string | null; noticeKind: 'ok' | 'error' | null;
  /** The user an INTERACTIVE sign-in just landed for (OAuth return, passkey
   *  sign-in, passkey account creation) — the entry flow's first-sign-in
   *  preferences offer keys off this. A silent session restore NEVER sets it. */
  firstSignIn: AccountUser | null }

export const PROVIDER_LABEL: Record<ProviderId, string> = { google: 'Google', discord: 'Discord', x: 'X', facebook: 'Facebook', mock: 'Test login' };
export const PROVIDER_ORDER: ProviderId[] = ['google', 'discord', 'x', 'facebook', 'mock'];

let state: AccountState = { ready: false, accounts: false, providers: [], passkeys: false, user: null, notice: null, noticeKind: null, firstSignIn: null };
const subs = new Set<() => void>();
function set(p: Partial<AccountState>) {
  // EVERY identity transition passes through this one set() — session
  // restore, OAuth return, passkey sign-in/register, sign-out. The
  // venue-unlock cache (/api/profile/me: unlocks, dev, storyAccess) is
  // keyed to whoever was signed in when it was fetched, so when the
  // signed-in identity changes, drop it: entitlement readers re-fetch and
  // converge to the new identity's truth instead of serving the profile
  // (or the signed-out 401) the page happened to read first.
  if ('user' in p && (state.user?.id ?? null) !== (p.user?.id ?? null)) invalidateVenueUnlocks();
  state = { ...state, ...p };
  if ('user' in p && p.user) noteSession('user');
  // EVERY transition to signed-in passes through this one set() — session restore,
  // an OAuth return, a passkey, any surface's sign-in. A signed-in player is not
  // idle-signed-out, so retire the owed inactivity notice at the transition itself.
  if (p.user) { try { clearIdleNotice(localStorage); } catch { /* no storage */ } }
  subs.forEach((f) => f());
}
export const account = {
  get: () => state,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  clearNotice: () => set({ notice: null, noticeKind: null }),
};
export function useAccount(): AccountState { return useSyncExternalStore(account.subscribe, account.get, account.get); }

async function call<T>(path: string, body?: unknown): Promise<T & { error?: string; reason?: string; ok?: boolean }> {
  const r = await fetch(`/api/auth/${path}`, body === undefined ? { credentials: 'same-origin' } : {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const ct = r.headers.get('content-type') ?? '';
  if (!ct.includes('json')) return { ok: false, error: r.status === 404 ? 'Accounts are not available here.' : `Server error (${r.status}).` } as never;
  const j = await r.json();
  return { ...(r.ok ? {} : { ok: false }), ...j };
}

const REASONS: Record<string, string> = {
  state: 'That sign-in took too long or was opened in another browser. Try again.',
  cancelled: 'Sign-in was cancelled.',
  exchange: "Couldn't finish signing in with that provider. Try again.",
  no_code: "Couldn't finish signing in with that provider. Try again.",
  linked_elsewhere: 'That login is already linked to a different Bid Wit Me account.',
  signed_out: 'You were signed out. Sign in and try again.',
  provider_off: "That sign-in option isn't available yet.",
};

let loading: Promise<void> | null = null;
/** Load config + current user once (and read the ?signin= result the provider redirect left on the URL). */
export function loadAccount(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = (async () => {
    const q = new URLSearchParams(location.search);
    const result = q.get('signin');
    if (result) {
      const reason = q.get('reason') ?? ''; const via = q.get('via');
      q.delete('signin'); q.delete('reason'); q.delete('via');
      history.replaceState(history.state, '', location.pathname + (q.toString() ? `?${q}` : '') + location.hash);
      if (result === 'error') set({ notice: REASONS[reason] ?? 'Sign-in failed. Try again.', noticeKind: 'error' });
      else if (result === 'linked') set({ notice: `${PROVIDER_LABEL[via as ProviderId] ?? 'Login'} linked.`, noticeKind: 'ok' });
      else if (result === 'ok') set({ notice: 'Signed in.', noticeKind: 'ok' });
      pendingOpen = result === 'linked' ? 'account' : null;
    }
    noteSessionLoading();
    try {
      const [cfg, me] = await Promise.all([call<{ providers: ProviderId[]; passkeys: boolean; accounts: boolean }>('config'), call<{ user: AccountUser | null }>('me')]);
      let user = me.user ?? null;
      let handedOff = false;
      const handoffCode = handoffCodeFromSearch(location.search); // deep-link return from the browser handoff
      if (handoffCode) {
        // The code never stays in the URL — single-use, and a reload must not re-offer it.
        history.replaceState(history.state, '', location.pathname + stripHandoffCode(location.search) + location.hash);
        if (!user && inAppShell()) {
          // No session in this jar yet and we're inside the app: spend the code for a
          // real one. Outside the shell a stray ?handoff= is only stripped — and the
          // server also refuses to spend codes for non-shell clients, so no account
          // can move either way.
          const rr = await call<{ user: AccountUser | null }>('handoff/redeem', { code: handoffCode });
          if (rr.user) { user = rr.user; handedOff = true; }
          else set({ notice: rr.error ?? 'That sign-in code did not work.', noticeKind: 'error' });
        }
      }
      set({ ready: true, accounts: !!cfg.accounts, providers: (cfg.providers ?? []).filter((p) => p in PROVIDER_LABEL), passkeys: !!cfg.passkeys && typeof PublicKeyCredential !== 'undefined', user });
      // definitive only when auth/me itself answered (a failed/non-JSON call stays 'unknown')
      noteSession(user ? 'user' : (me.ok === false || me.error ? null : 'guest'));
      if (user) await afterSignIn(user, result === 'ok' || result === 'new' || handedOff);
      // An OAuth RETURN (?signin=ok/new) is an interactive sign-in completing —
      // unlike the silent restore this same function performs on every other
      // load, which must never raise the first-sign-in preferences offer.
      if (me.user && (result === 'ok' || result === 'new')) set({ firstSignIn: user });
      // A completed handoff is the same kind of completion — the passkey ceremony
      // just happened, in the browser — so it earns the first-sign-in treatment too.
      if (user && handedOff) set({ firstSignIn: user });
    } catch {
      set({ ready: true, accounts: false, providers: [], passkeys: false });
      noteSession(null);
    }
  })();
  return loading;
}
let pendingOpen: 'account' | null = null;
/** Which sheet the redirect asked to reopen (once). */
export function takePendingOpen(): 'account' | null { const p = pendingOpen; pendingOpen = null; return p; }

/** The entry flow retires the first-sign-in marker once the preferences step is done/skipped. */
export function clearFirstSignIn(): void { if (state.firstSignIn) set({ firstSignIn: null }); }

/** After any sign-in: the username IS the online display name — the stored seat name syncs to it unconditionally (owner, 2026-11-06: the 'Your name' field is gone for signed-in players, so a typed override must die here, at the one place every sign-in path funnels through); pull account badges onto this device. */
async function afterSignIn(u: AccountUser, fresh: boolean) {
  if (u.username) saveName(u.username);
  if (fresh && u.progressImported) {
    const r = await call<{ progress?: { badges?: { id: string; earnedAt: number }[]; teamName?: string | null; teamNames?: Record<string, string> } }>('progress', {});
    mergeDownBadges(r.progress?.badges ?? []);
    if (r.progress?.teamName && !myTeamName.get()) myTeamName.set(r.progress.teamName);
    // per-pairing team names follow the account (account wins per pairing)
    if (r.progress?.teamNames) pairTeamNames.merge(r.progress.teamNames);
  }
}
function mergeDownBadges(list: { id: string; earnedAt: number; context?: Record<string, unknown> }[]) { mergeBadges(list); }

/** Full-page redirect to the provider; it comes back to `ret` (the start screen by default) with ?signin=… */
export function startOAuth(p: ProviderId, mode: 'login' | 'link' = 'login', ret = '/') {
  // the test-only mock provider signs in whoever localStorage 'bwm.mockAs' names
  let as = '';
  if (p === 'mock') { try { as = `&as=${encodeURIComponent(localStorage.getItem('bwm.mockAs') ?? 'tester')}`; } catch { /* ignore */ } }
  location.assign(`/api/auth/${p}/start?mode=${mode}&return=${encodeURIComponent(ret)}${as}`);
}

export async function checkUsername(u: string): Promise<{ ok: boolean; reason?: string }> {
  const r = await call<{ ok: boolean; reason?: string }>(`username/check?u=${encodeURIComponent(u)}`);
  return { ok: !!r.ok, reason: r.reason ?? r.error };
}
export async function setUsername(u: string): Promise<string | null> {
  const r = await call<{ user?: AccountUser }>('username', { username: u });
  if (r.user) { set({ user: r.user }); saveName(r.user.username ?? ''); return null; }
  return r.reason ?? r.error ?? 'Could not save that name.';
}
export async function signOut() { await call('logout', {}); noteSession('guest'); set({ user: null, notice: 'Signed out. You can keep playing as a guest.', noticeKind: 'ok' }); }
export async function deleteAccount(): Promise<string | null> {
  const r = await call('delete', {});
  if (r.ok === false) return r.error ?? 'Could not delete the account.';
  noteSession('guest');
  set({ user: null, notice: 'Your account and everything tied to it were deleted.', noticeKind: 'ok' });
  return null;
}
export async function unlink(what: { provider: string } | { passkey: string }): Promise<string | null> {
  const r = await call<{ user?: AccountUser }>('unlink', what);
  if (r.user) { set({ user: r.user }); return null; }
  return r.error ?? 'Could not unlink.';
}

/* ---- passkeys */
export async function passkeySignIn(): Promise<string | null> {
  const { startAuthentication } = await import('@simplewebauthn/browser');
  const o = await call<{ flow: string; options: never }>('passkey/login/options', {});
  if (!o.flow) return o.error ?? 'Passkeys are unavailable right now.';
  let response;
  try { response = await startAuthentication({ optionsJSON: o.options }); } catch (e) { return passkeyError(e); }
  const v = await call<{ user?: AccountUser }>('passkey/login/verify', { flow: o.flow, response });
  if (!v.user) return v.error ?? 'Passkey sign-in failed.';
  set({ user: v.user, notice: 'Signed in with your passkey.', noticeKind: 'ok' });
  set({ firstSignIn: v.user }); // interactive sign-in (never a restore)
  await afterSignIn(v.user, true);
  return null;
}
/** Signed in: add a passkey to this account. Signed out: create a new account with `username` + a passkey. */
export async function passkeyRegister(username?: string): Promise<string | null> {
  const wasSignedIn = !!state.user; // adding a passkey to a live account is NOT a sign-in
  const { startRegistration } = await import('@simplewebauthn/browser');
  const o = await call<{ flow: string; options: never }>('passkey/register/options', username ? { username } : {});
  if (!o.flow) return o.reason ?? o.error ?? 'Passkeys are unavailable right now.';
  let response;
  try { response = await startRegistration({ optionsJSON: o.options }); } catch (e) { return passkeyError(e); }
  const v = await call<{ user?: AccountUser; outcome?: string }>('passkey/register/verify', { flow: o.flow, response });
  if (!v.user) return v.reason ?? v.error ?? 'Could not save the passkey.';
  set({ user: v.user, notice: v.outcome === 'new' ? `Welcome, ${v.user.username}!` : 'Passkey added.', noticeKind: 'ok' });
  if (!wasSignedIn) set({ firstSignIn: v.user }); // account creation IS the first sign-in
  if (v.user.username) saveName(v.user.username);
  return null;
}
function passkeyError(e: unknown): string {
  const n = (e as { name?: string })?.name;
  if (n === 'NotAllowedError' || n === 'AbortError') return 'Passkey request was cancelled.';
  if (n === 'InvalidStateError') return 'This device already has a passkey for this account.';
  return (e as Error)?.message || 'Passkey request failed.';
}

/* ---- sign-in handoff (app shell; see handoff.ts for the why) */
/** Browser side: mint a one-time code for THIS signed-in session. */
export async function mintHandoffCode(): Promise<{ code?: string; expiresAt?: number; error?: string }> {
  const r = await call<{ code?: string; expiresAt?: number }>('handoff/mint', {});
  return { code: r.code, expiresAt: r.expiresAt, error: r.error };
}
/** App side: leave for the browser half. Marks the handoff pending first, so the
 *  sign-in sheet offers the typed-code box when the player comes back. */
export function openHandoffBrowser(): void {
  noteHandoffPending();
  window.open(mintPageUrl(), '_system');
}
/** App side: spend a typed-in code. Adopts the session through the same set()
 *  choke point as every other sign-in; a completed handoff IS an interactive
 *  sign-in (the ceremony just ran in the browser), so it sets firstSignIn. */
export async function redeemHandoffCode(code: string): Promise<string | null> {
  const r = await call<{ user?: AccountUser }>('handoff/redeem', { code });
  if (!r.user) return r.error ?? 'That sign-in code did not work.';
  set({ user: r.user, notice: 'Signed in.', noticeKind: 'ok' });
  set({ firstSignIn: r.user });
  await afterSignIn(r.user, true);
  return null;
}

/* ---- "Save my progress" */
export function localProgress() {
  return { badges: badges(), series: loadSeries(), teamName: myTeamName.get() || null, teamNames: pairTeamNames.all() };
}
export function hasLocalProgress(): boolean { const p = localProgress(); return p.badges.length > 0 || !!p.series || !!p.teamName || Object.keys(p.teamNames).length > 0; }
export async function saveProgress(): Promise<string | null> {
  const r = await call<{ progress?: { badges: { id: string; earnedAt: number }[] } }>('progress', { import: localProgress() });
  if (r.ok === false && !r.progress) return r.reason ?? r.error ?? 'Could not save progress.';
  if (state.user) set({ user: { ...state.user, progressImported: true }, notice: 'Progress saved to your account.', noticeKind: 'ok' });
  return null;
}
