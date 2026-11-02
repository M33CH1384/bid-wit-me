/**
 * Is this visitor a KNOWN guest? True only once /api/auth/me has answered
 * definitively with "no user" for the current identity. Self-only account reads
 * (/api/profile/me, /api/social/me/stats) skip the request in that case instead of
 * firing a guaranteed 401 (a console error on every guest load). Anything not
 * definitive (auth/me still loading past the wait, failed, non-JSON) answers false,
 * so the caller fetches exactly as before; a signed-in session is never skipped.
 * No imports: account/api.ts writes it, readers anywhere can import it cycle-free.
 */
let known: 'guest' | 'user' | null = null;
let resolveFirst: (() => void) | null = null;
let first = new Promise<void>((r) => { resolveFirst = r; });

/** account/api.ts: the definitive /api/auth/me result (null = unknown, e.g. the call failed). */
export function noteSession(s: 'guest' | 'user' | null): void {
  known = s; inFlight = false;
  resolveFirst?.(); resolveFirst = null;
}

/** Sync read (no waiting). */
export function isKnownGuest(): boolean { return known === 'guest'; }

/** Wait for the first auth/me answer only while one is actually in flight (account/api.ts marked it), bounded;
 *  then say whether to skip a self-only read. With no auth/me in flight it answers at once (no added delay). */
export async function skipSelfRead(waitMs = 1500): Promise<boolean> {
  if (known === null && inFlight && resolveFirst) await Promise.race([first, new Promise((r) => setTimeout(r, waitMs))]);
  return known === 'guest';
}
let inFlight = false;
/** account/api.ts: an /api/auth/me request has started. */
export function noteSessionLoading(): void { inFlight = true; }

/** tests only */
export function __resetSessionHint(): void { known = null; inFlight = false; first = new Promise<void>((r) => { resolveFirst = r; }); }
