/**
 * Inactivity policy (online presence + sign-out). Pure, injectable clock so the
 * 5 / 15 / 30-minute boundaries are fake-timer testable.
 *  - 5 min: idle badge ("Away")
 *  - 15 min: drop off the Online (presence) list — heartbeats stop, server expires the row
 *  - 30 min: SIGN OUT fully (accounts too), even idling on the main menu;
 *    guests are signed out (guest session rotated) and any seat is released by the leave path.
 * NEVER: offline bot games, and anyone actively playing (input = activity, it resets the clock).
 */
export const IDLE_BADGE_MS = 5 * 60_000;
export const IDLE_PRESENCE_MS = 15 * 60_000;
export const IDLE_LOGOUT_MS = 30 * 60_000;
/** localStorage flag: a "Signed out for inactivity" notice is owed on next open until dismissed. */
export const IDLE_NOTICE_KEY = 'bwm.idleSignedOut';

/* The owed-notice flag has exactly one home: these helpers. The IdleGuard marks it
   at the idle sign-out; it is cleared by the notice's own dismissal OR by any
   sign-in — the account store clears it the moment a user lands (see account/api),
   so a signed-in player never sees the notice, whichever surface signed them in. */
export function markIdleNoticeOwed(storage: Pick<Storage, 'setItem'> | null): void {
  try { storage?.setItem(IDLE_NOTICE_KEY, '1'); } catch { /* private mode */ }
}
export function idleNoticeOwed(storage: Pick<Storage, 'getItem'> | null): boolean {
  try { return storage?.getItem(IDLE_NOTICE_KEY) === '1'; } catch { return false; }
}
export function clearIdleNotice(storage: Pick<Storage, 'removeItem'> | null): void {
  try { storage?.removeItem(IDLE_NOTICE_KEY); } catch { /* private mode */ }
}
/** The notice shows only while it is owed AND nobody is signed in. */
export function idleNoticeVisible(owed: boolean, signedIn: boolean): boolean {
  return owed && !signedIn;
}
/** Test/dev override key (localStorage ms for the 30-min sign-out; the 5/15 stages scale with it). */
export const IDLE_OVERRIDE_KEY = 'bwm.idleMs';

export interface IdlePolicy { badgeMs: number; presenceMs: number; logoutMs: number }
export const DEFAULT_POLICY: IdlePolicy = { badgeMs: IDLE_BADGE_MS, presenceMs: IDLE_PRESENCE_MS, logoutMs: IDLE_LOGOUT_MS };
export type IdleStage = 'active' | 'badge' | 'away' | 'out';

export function idleStage(idleForMs: number, p: IdlePolicy = DEFAULT_POLICY): IdleStage {
  if (idleForMs >= p.logoutMs) return 'out';
  if (idleForMs >= p.presenceMs) return 'away';
  if (idleForMs >= p.badgeMs) return 'badge';
  return 'active';
}

export interface IdleContext {
  /** where the user is idling: main menu, an online room, or an offline bot game */
  scope: 'menu' | 'online' | 'offline-bot';
  /** actively playing right now (input counts as activity and resets the watch, so this is belt-and-braces) */
  activePlay?: boolean;
}
export type IdleAction = 'none' | 'badge' | 'drop-presence' | 'sign-out';
/** What a stage means in a context. Offline bot games and active play NEVER sign out. */
export function idleAction(stage: IdleStage, ctx: IdleContext): IdleAction {
  if (ctx.scope === 'offline-bot' || ctx.activePlay) return stage === 'badge' ? 'badge' : 'none';
  if (stage === 'out') return 'sign-out';
  if (stage === 'away') return 'drop-presence';
  if (stage === 'badge') return 'badge';
  return 'none';
}

export class IdleWatch {
  private last: number;
  constructor(private readonly policy: IdlePolicy = DEFAULT_POLICY, private readonly now: () => number = Date.now) {
    this.last = now();
  }
  touch(): void { this.last = this.now(); }
  idleFor(): number { return this.now() - this.last; }
  stage(): IdleStage { return idleStage(this.idleFor(), this.policy); }
  expired(): boolean { return this.stage() === 'out'; }
}

/** Whole policy from the bounded override (sign-out ms; earlier stages keep their 1/6 and 1/2 ratios). */
export function idlePolicyFrom(storage: Pick<Storage, 'getItem'> | null): IdlePolicy {
  try {
    const raw = storage?.getItem(IDLE_OVERRIDE_KEY);
    const ms = raw ? Number(raw) : NaN;
    if (Number.isFinite(ms) && ms >= 5_000 && ms <= 24 * 3600_000) return { badgeMs: Math.round(ms / 6), presenceMs: Math.round(ms / 2), logoutMs: ms };
  } catch { /* private mode */ }
  return DEFAULT_POLICY;
}
export function idleTimeoutFrom(storage: Pick<Storage, 'getItem'> | null): number {
  return idlePolicyFrom(storage).logoutMs;
}

/* Exemption registry: an offline bot game (App) holds an exemption; the guard never
   progresses past reset while any exemption is held. Module-level so App and the
   root guard do not need prop drilling. */
let exemptions = 0;
export function holdIdleExemption(): () => void {
  exemptions++;
  let held = true;
  return () => { if (held) { held = false; exemptions = Math.max(0, exemptions - 1); } };
}
export function idleExempt(): boolean { return exemptions > 0; }
