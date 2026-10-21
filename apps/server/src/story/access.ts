/**
 * Story-mode access (owner, 2026-10-21): who may play story mode.
 *
 * STORY_OWNER_ONLY is the one switch for the story-mode lock: while it
 * is on, story mode stays closed while it is being finished — open only
 * to admin (owner) accounts plus the named players in
 * STORY_ACCESS_USERNAMES. The story routes answer 403 to everyone else
 * and the client shows them the locked state (the client half of the
 * switch lives in apps/web/src/story/storyApi.ts). TO OPEN STORY MODE
 * TO EVERYONE: set this to false here AND STORY_OWNER_ONLY to false in
 * apps/web/src/story/storyApi.ts — nothing else changes.
 */
import { type SocialEnv, isAdmin } from '../social/routes';

export const STORY_OWNER_ONLY = true;

/**
 * Named players admitted to story mode while the owner-only lock is on
 * (owner order, 2026-10-21: LovleyT714 — the owner's regular online
 * partnership partner — gets the full player experience early). This is
 * a PLAYER allowlist only: it opens the player story endpoints
 * (progress / result / session / found) and nothing else — reset-stop
 * and every other dev surface stay isAdmin-only, and /api/profile/me
 * keeps reporting dev=false for these accounts.
 *
 * Matching mirrors isAdmin's ADMIN_USERNAMES comparison: entries are
 * trimmed and matched case-insensitively against the account's stored
 * username. To admit another player later, add their username here —
 * one line.
 */
export const STORY_ACCESS_USERNAMES: readonly string[] = ['LovleyT714'];

/** May this account use the player story endpoints right now? Admins
 *  always; everyone once the lock is off; the named allowlist while
 *  the lock is on. */
export function hasStoryAccess(env: SocialEnv, uid: string, username: string | null): boolean {
  if (isAdmin(env, uid, username)) return true;
  if (!STORY_OWNER_ONLY) return true;
  if (!username) return false;
  const name = username.toLowerCase();
  return STORY_ACCESS_USERNAMES.some((n) => n.trim().toLowerCase() === name);
}
