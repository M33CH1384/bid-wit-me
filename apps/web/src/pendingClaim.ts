/**
 * Retroactive rewards claim (owner, 2026-10-22): "If I get here and I'm not
 * signed in it should be possible for me to sign in and still get my points."
 *
 * A game that finishes while the player is signed OUT queues nothing (there
 * is no account to credit), so useGame holds its result HERE instead: one
 * slot, the exact LocalGamePost record shape, a newer completed game
 * replacing an older unclaimed one. On sign-in the held record posts to
 * /api/stats/local — the same crediting path as a live signed-in game —
 * with claim: true so the server holds the one-account-ever line
 * (game_claims). Abandoned games never reach the completion point, so they
 * never create a claim (abandoned = zero, as everywhere else).
 */
import { account } from './account/api';
import type { LocalGamePost } from './localStats';
import { fetchRewardsProfile, type RewardsProfile } from './GameOverRewards';

const KEY = 'bwm.pendingClaim.v1';
const RESULT_KEY = 'bwm.claimResult.v1';
/** Held for 7 days — the story-session expiry precedent (migration 0023) —
 *  and well inside the server's 30-day plausibility window for offline
 *  games, so a held claim can never rot into a server rejection. */
export const CLAIM_TTL_MS = 7 * 86400_000;

export interface PendingClaim { item: LocalGamePost; savedAt: number }

interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** A known guest (account resolved, nobody signed in) holds a claim; a
 *  still-loading account queues through the normal offline path instead. */
export function shouldHoldClaim(ready: boolean, userId: string | null | undefined): boolean {
  return ready && !userId;
}

export function savePendingClaim(item: LocalGamePost, now: number, storage: Store = localStorage): void {
  try { storage.setItem(KEY, JSON.stringify({ item, savedAt: now } satisfies PendingClaim)); } catch { /* full/blocked: the claim is best-effort */ }
}

function readClaim(storage: Store): PendingClaim | null {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null') as PendingClaim | null;
    return v && v.item && typeof v.item.clientGameId === 'string' && typeof v.savedAt === 'number' ? v : null;
  } catch { return null; }
}

export type PendingClaimPeek =
  | { state: 'none' }
  | { state: 'held'; claim: PendingClaim }
  | { state: 'expired'; claim: PendingClaim };

export function peekPendingClaim(now: number, storage: Store = localStorage): PendingClaimPeek {
  const claim = readClaim(storage);
  if (!claim) return { state: 'none' };
  return now - claim.savedAt > CLAIM_TTL_MS ? { state: 'expired', claim } : { state: 'held', claim };
}

export function clearPendingClaim(storage: Store = localStorage): void {
  try { storage.removeItem(KEY); } catch { /* ignore */ }
}

/** The held item, or null — an expired claim is cleared and reports null. */
export function loadPendingClaim(now: number, storage: Store = localStorage): LocalGamePost | null {
  const peek = peekPendingClaim(now, storage);
  if (peek.state === 'expired') { clearPendingClaim(storage); return null; }
  return peek.state === 'held' ? peek.claim.item : null;
}

/** useGame's completion hook: hold the result iff the player is a known guest. */
export function holdIfGuest(item: LocalGamePost, now: number = Date.now(), storage: Store = localStorage): boolean {
  const a = account.get();
  if (!shouldHoldClaim(a.ready, a.user?.id)) return false;
  savePendingClaim(item, now, storage);
  return true;
}

/* ------------------------------------------------------------ claim result */

/** The before/after profiles of the most recent successful claim, so the
 *  /rewards screen can still render the credited breakdown when the claim
 *  was submitted somewhere else (sign-in landing, relaunch) first. */
export interface ClaimResult { clientGameId: string; at: number; before: RewardsProfile | null; after: RewardsProfile | null }

export function saveClaimResult(r: ClaimResult, storage: Store = localStorage): void {
  try { storage.setItem(RESULT_KEY, JSON.stringify(r)); } catch { /* best-effort */ }
}

export function loadClaimResult(clientGameId: string, storage: Store = localStorage): ClaimResult | null {
  try {
    const v = JSON.parse(storage.getItem(RESULT_KEY) ?? 'null') as ClaimResult | null;
    return v && v.clientGameId === clientGameId ? v : null;
  } catch { return null; }
}

/* ------------------------------------------------------------- submission */

export type ClaimSubmitStatus =
  | 'claimed'           // credited by this post
  | 'duplicate'         // already credited to this account (server idempotency)
  | 'claimed-elsewhere' // another account claimed this game first — gone for good
  | 'none'              // nothing held
  | 'expired'           // held past the TTL; cleared without posting
  | 'rejected'          // server refused the game itself (400/413); cleared
  | 'signed-out'        // no signed-in user (or no username yet); still held
  | 'busy'              // a submission is already in flight
  | 'error';            // network / rate limit / 5xx; still held, retry later

export interface ClaimSubmitResult { status: ClaimSubmitStatus; before: RewardsProfile | null; after: RewardsProfile | null }

let inFlight = false;

/**
 * Submit the held claim through the live crediting path. Exactly-once rests
 * on three layers: this in-flight guard (same session), the server's
 * per-user game idempotency, and the game_claims registry (any account).
 * The profile is fetched BEFORE the post so a caller can diff the credit.
 */
export async function submitPendingClaim(opts: {
  before?: RewardsProfile | null;
  storage?: Store;
  fetchImpl?: typeof fetch;
  now?: number;
} = {}): Promise<ClaimSubmitResult> {
  const storage = opts.storage ?? localStorage;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now();
  const none: ClaimSubmitResult = { status: 'none', before: null, after: null };
  if (inFlight) return { status: 'busy', before: null, after: null };
  const peek = peekPendingClaim(now, storage);
  if (peek.state === 'none') return none;
  if (peek.state === 'expired') { clearPendingClaim(storage); return { status: 'expired', before: null, after: null }; }
  const a = account.get();
  if (!a.user?.id) return { status: 'signed-out', before: null, after: null };
  inFlight = true;
  try {
    const before = opts.before !== undefined ? opts.before : await fetchRewardsProfile().catch(() => null);
    let r: Response;
    try {
      r = await fetchImpl('/api/stats/local', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...peek.claim.item, claim: true }),
      });
    } catch { return { status: 'error', before, after: null }; }
    if (r.status >= 200 && r.status < 300) {
      const body = await r.json().catch(() => null) as { duplicate?: boolean; claimed?: boolean } | null;
      clearPendingClaim(storage);
      if (body?.claimed) return { status: 'claimed-elsewhere', before, after: null };
      const after = await fetchRewardsProfile().catch(() => null);
      saveClaimResult({ clientGameId: peek.claim.item.clientGameId, at: now, before, after }, storage);
      return { status: body?.duplicate ? 'duplicate' : 'claimed', before, after };
    }
    if (r.status === 400 || r.status === 413) { clearPendingClaim(storage); return { status: 'rejected', before, after: null }; }
    if (r.status === 401) return { status: 'signed-out', before, after: null };
    return { status: 'error', before, after: null };
  } finally {
    inFlight = false;
  }
}

/* --------------------------------------------------------- auto-claim watch */

/**
 * When /rewards is on screen showing THIS game's unsigned breakdown, the
 * rewards screen owns the claim (it needs the pre-claim profile snapshot to
 * render the delta). Anywhere else, the watcher claims on sign-in / load.
 */
export function claimDeferredToRewards(storage: Store = localStorage): boolean {
  try {
    if (typeof location === 'undefined' || location.pathname !== '/rewards') return false;
    const raw = sessionStorage.getItem('bwm.rewards.v1'); // RewardsPage's stash key
    if (!raw) return false;
    const p = JSON.parse(raw) as { gameId?: string; data?: { signedIn?: boolean } } | null;
    if (!p?.gameId || p.data?.signedIn) return false;
    const peek = peekPendingClaim(Date.now(), storage);
    return peek.state === 'held' && peek.claim.item.clientGameId === p.gameId;
  } catch { return false; }
}

let watching = false;
export function watchPendingClaim(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  const kick = () => {
    const a = account.get();
    if (!a.user?.id || claimDeferredToRewards()) return;
    void submitPendingClaim();
  };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') kick(); });
  // a claim can only land once the account is known — same trigger the
  // offline queue flush rides (localStats.watchLocalGames)
  account.subscribe(kick);
  kick();
}
