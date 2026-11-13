/**
 * The /auth/handoff page's brain (the component is HandoffPage.tsx). Runs in a
 * REAL browser — opened from the app into the system browser — where passkeys
 * work. State machine:
 *   signed out           → 'need-signin' (the component offers the ordinary
 *                          passkey sign-in; this page NEVER creates an account —
 *                          sign-in here is for existing accounts only)
 *   signed in            → mint a fresh code → 'ready' (return link + the code
 *                          in printable form for the type-it-in fallback)
 *   mint refused / error → 'error' (the component offers a retry)
 * A failed /api/auth/me read answers 'need-signin': the safe direction — asking
 * for a sign-in that turns out unnecessary costs one tap; minting for the wrong
 * jar would strand the code.
 */
import { appReturnLink, formatHandoffCode } from './handoff';

export type HandoffPageState =
  | { phase: 'need-signin' }
  | { phase: 'ready'; code: string; link: string; pretty: string; expiresAt: number }
  | { phase: 'error'; message: string };

type Fetcher = (path: string, init?: RequestInit) => Promise<Pick<Response, 'json'>>;

const defaultFetch: Fetcher = (path, init) => fetch(path, { credentials: 'same-origin', ...init });

export async function startHandoffPage(f: Fetcher = defaultFetch): Promise<HandoffPageState> {
  let signedIn = false;
  try {
    const me = (await (await f('/api/auth/me')).json()) as { user?: unknown };
    signedIn = !!me?.user;
  } catch { signedIn = false; }
  if (!signedIn) return { phase: 'need-signin' };
  try {
    const r = await f('/api/auth/handoff/mint', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const j = (await r.json()) as { ok?: boolean; code?: string; expiresAt?: number; error?: string };
    if (!j.code) return { phase: 'error', message: j.error ?? 'Could not make a sign-in code. Try again.' };
    return { phase: 'ready', code: j.code, link: appReturnLink(j.code), pretty: formatHandoffCode(j.code), expiresAt: j.expiresAt ?? 0 };
  } catch {
    return { phase: 'error', message: 'Could not reach the game server. Check your connection and try again.' };
  }
}
