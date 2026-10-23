/**
 * Entry flow (owner, 2026-10-23): a new or logged-out visitor gets a prompt —
 * sign in or play as a guest — and a first-time signer-inner gets one offer to
 * set their game preferences. Pure helpers + storage keys live here (the
 * inactivity.ts pattern); EntryFlow.tsx renders from them.
 *
 * Why the preferences-done marker is device-side, keyed by account id: the
 * game Settings themselves are device-local (settings.ts — localStorage
 * `spades.settings.v2`, never synced; the account progress sync carries
 * badges/series/team names only). The step configures THIS device's settings,
 * so its completion marker belongs on this device too. Keying by account id
 * means two accounts sharing a device each get their own first-sign-in offer,
 * and one account's completion never suppresses another's.
 */
/** sessionStorage: this session's guest choice — a new session re-prompts. */
export const ENTRY_GUEST_KEY = 'bwm.entryGuest';
/** localStorage prefix: preferences step completed/skipped for this account on this device. */
export const PREFS_DONE_PREFIX = 'bwm.prefsDone.';

type Get = Pick<Storage, 'getItem'> | null;
type Set = Pick<Storage, 'setItem'> | null;

export function guestDismissed(storage: Get): boolean {
  try { return storage?.getItem(ENTRY_GUEST_KEY) === '1'; } catch { return false; }
}
export function dismissGuest(storage: Set): void {
  try { storage?.setItem(ENTRY_GUEST_KEY, '1'); } catch { /* private mode */ }
}

export function prefsDone(storage: Get, userId: string): boolean {
  try { return storage?.getItem(PREFS_DONE_PREFIX + userId) === '1'; } catch { return false; }
}
export function markPrefsDone(storage: Set, userId: string): void {
  try { storage?.setItem(PREFS_DONE_PREFIX + userId, '1'); } catch { /* private mode */ }
}

export interface EntryModalInput {
  /** account store resolved (a restore may still be in flight before this). */
  ready: boolean;
  /** accounts are available on this deployment at all. */
  accounts: boolean;
  signedIn: boolean;
  guestDismissed: boolean;
  /** the inactivity notice is actually on screen (its own derivation + menu scope). */
  idleNoticeShowing: boolean;
  /** deliberate deep links that must not be gated (autostart / preview). */
  suppressed: boolean;
}
/**
 * The prompt shows only for a resolved, logged-out visitor who hasn't chosen
 * guest this session, while no idle notice is up (the notice goes first; the
 * prompt may follow once it's dismissed), and never on a suppressed link.
 */
export function entryModalVisible(i: EntryModalInput): boolean {
  return i.ready && i.accounts && !i.signedIn && !i.guestDismissed && !i.idleNoticeShowing && !i.suppressed;
}

export interface PrefsOfferInput {
  /** the account store's interactive-sign-in marker (null = no interactive sign-in). */
  firstSignInId: string | null;
  userId: string | null;
  /** the account still owes a username pick — that step of first sign-in goes first. */
  needsUsername: boolean;
  /** this account already completed/skipped the step on this device. */
  done: boolean;
}
/**
 * The preferences step is offered exactly when an interactive sign-in (never a
 * silent session restore) landed for THIS account, the account isn't still
 * mid-username-pick, and the step hasn't been completed or skipped here.
 */
export function prefsOfferVisible(i: PrefsOfferInput): boolean {
  return !!i.userId && i.firstSignInId === i.userId && !i.needsUsername && !i.done;
}

/**
 * Deliberate game links (?autostart — the link itself IS the destination) and
 * dev previews never get the entry prompt. Read from the ORIGINAL entry URL:
 * later in-session strips (autostart's own replaceState) must not un-suppress.
 */
export function entrySuppressed(search: string): boolean {
  try {
    const q = new URLSearchParams(search);
    return q.has('autostart') || q.get('preview') !== null;
  } catch { return false; }
}
