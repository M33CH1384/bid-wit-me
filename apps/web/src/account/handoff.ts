/**
 * Sign-in handoff for the iPhone app (owner decision 2026-11-10: stay on the free
 * Personal Team). The app shell's WKWebView cannot run passkey ceremonies — iOS only
 * allows them for formally associated domains, and the Associated Domains entitlement
 * is a paid-team capability — so signing in inside the app goes around: the game
 * opens its own /auth/handoff page in the system browser (where the passkey works),
 * that page mints a one-time code for the signed-in account, and the code rides a
 * custom URL scheme back into the app, which redeems it for the ordinary session.
 * Codes are single-use with a 10-minute life; the printable form below is the
 * type-it-in fallback when the scheme return doesn't land.
 *
 * This module is the pure half (detection, shapes, the pending marker): no account
 * store, no fetches of its own, so it stays cycle-free next to sessionHint.ts.
 * The endpoint calls live in api.ts; the mint page's logic in handoffPage.ts.
 */

/** Appended to the shell's WebView user agent by the native config (ios.appendUserAgent).
 *  The same literal lives server-side in apps/server/src/auth/routes.ts (the redeem gate)
 *  — handoff-wiring.test.ts pins all three carriers (here, routes.ts, the native patch). */
export const SHELL_UA_MARKER = 'BidWitMeApp';

/** Are we running inside the native app shell (vs any real browser)? */
export function inAppShell(ua: string = navigator.userAgent): boolean {
  return ua.includes(SHELL_UA_MARKER);
}

/** Where the browser half of the handoff lives — the public origin, where passkeys work. */
export function mintPageUrl(origin: string = location.origin): string {
  return `${origin}/auth/handoff`;
}

/** The way back into the app: a custom scheme (universal links would need the same
 *  blocked entitlement). The shell turns this into a load of `/?handoff=<code>`. */
export function appReturnLink(code: string): string {
  return `bidwitme://auth?code=${encodeURIComponent(code)}`;
}

/** Codes print in groups of four so a human can type one across devices/screens. */
export function formatHandoffCode(code: string): string {
  const flat = code.replace(/\s+/g, '');
  return flat.replace(/(.{4})(?=.)/g, '$1 ');
}

/** The code the deep link carried in (?handoff=…), or null. */
export function handoffCodeFromSearch(search: string = location.search): string | null {
  const c = new URLSearchParams(search).get('handoff')?.trim();
  return c ? c : null;
}

/** The query string with the code removed — the param must never survive into a
 *  reload or a share: codes are single-use, and a stale one only confuses. */
export function stripHandoffCode(search: string): string {
  const q = new URLSearchParams(search);
  if (!q.has('handoff')) return search;
  q.delete('handoff');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/* ------------------------------------------------ pending marker
 * The sign-in sheet remembers (for the code's own 10-minute life) that a handoff
 * was started, so when the player comes back to the app it offers the typed-code
 * box without being asked. Device-local by design (localStorage), like the
 * entry-flow markers; cleared the moment any sign-in lands. */
const PENDING_KEY = 'bwm.handoffPending';
const PENDING_TTL_MS = 10 * 60_000; // matches the server code TTL
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
function defaultStore(): Store | null { try { return localStorage; } catch { return null; } }

export function noteHandoffPending(now: number = Date.now(), store: Store | null = defaultStore()): void {
  try { store?.setItem(PENDING_KEY, String(now)); } catch { /* private mode: the deep link still works */ }
}
export function handoffPending(now: number = Date.now(), store: Store | null = defaultStore()): boolean {
  try {
    const t = Number(store?.getItem(PENDING_KEY));
    return Number.isFinite(t) && t > 0 && now - t < PENDING_TTL_MS;
  } catch { return false; }
}
export function clearHandoffPending(store: Store | null = defaultStore()): void {
  try { store?.removeItem(PENDING_KEY); } catch { /* nothing to clear */ }
}
