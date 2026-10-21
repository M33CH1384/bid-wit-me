import { isAdmin, type SocialEnv } from '../social/routes';
import { xpSnapshot } from './xp';

/**
 * The Pj's (venue `blockAfterDark`) is a premium unlockable venue. The picker
 * gate on the client is only a courtesy — this is the server's own word on who
 * may use it (a direct venue pick or a Random roll at an online table, and the
 * stamp the Table DO puts on a member when their account ticket verifies).
 *
 * Entitled: the 'after-dark' unlock row (the After Dark achievement, or the
 * level-20 grant in cred/hooks.ts), OR Rep level 20+ read straight from
 * xp_state (the same source of truth as wagerLevelOk, so a player whose grant
 * hasn't landed yet still counts), OR an admin/dev account (isAdmin bypass).
 * Fails closed: no DB, a bad row, or a guest never counts as entitled.
 */
export const PJS_UNLOCK_ITEM = 'after-dark';
export const PJS_UNLOCK_LEVEL = 20;

export async function pjsVenueAccess(env: SocialEnv, db: D1Database | undefined, userId: string, username: string | null): Promise<boolean> {
  if (isAdmin(env, userId, username)) return true;
  if (!db) return false;
  try {
    const row = await db.prepare('SELECT item_id FROM unlocks WHERE user_id = ? AND item_id = ? LIMIT 1')
      .bind(userId, PJS_UNLOCK_ITEM).first<{ item_id: string }>();
    if (row) return true;
    return (await xpSnapshot(db, userId)).level >= PJS_UNLOCK_LEVEL;
  } catch {
    return false;
  }
}
