/**
 * Self-declared profile Region (Demetrius 2026-10-20, league P-B): a short
 * free-text place the player reps — shown plainly on the profile and used to
 * build the regional leaderboard (players sharing the viewer's region).
 * Cleaned exactly like the tagline (shared hygiene helpers: control chars
 * stripped, whitespace collapsed, profanity masked) but capped shorter.
 * No fabricated regions: unset stays NULL and the player is Global-only.
 */
import { cleanText, maskProfanity } from '../filter';

export const REGION_MAX = 24;

/** Clean a candidate region. Pure: shared by the route and the tests.
 *  An empty result means "no region" — saving blank clears it (stored NULL). */
export function cleanRegion(v: unknown): { ok: true; region: string | null } | { ok: false; error: string } {
  if (typeof v !== 'string') return { ok: false, error: 'Send your region as text.' };
  const t = maskProfanity(cleanText(v, REGION_MAX));
  return { ok: true, region: t === '' ? null : t };
}

/** The region stored for a user (null when none). */
export async function regionOf(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare('SELECT region FROM users WHERE id = ?')
    .bind(userId).first<{ region: string | null }>();
  return row?.region ?? null;
}
