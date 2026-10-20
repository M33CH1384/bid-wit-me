/**
 * Profile taglines (Demetrius 2026-10-20): a short line on your profile, editable by
 * the owner, shown on the profile page and the Social profile view. Any http(s) URL
 * in it renders as a working link on the client — links WORKING is the feature, so
 * unlike chat the text passes through the shared hygiene helpers WITHOUT blockLinks:
 * control chars stripped, whitespace (incl. newlines) collapsed, profanity masked —
 * the same treatment chat text gets in room.ts, minus the link block.
 */
import { cleanText, maskProfanity } from '../filter';

export const TAGLINE_MAX = 140;

/** Clean a candidate tagline. Pure: shared by the route and the tests.
 *  An empty result means "no tagline" — saving blank clears it (stored NULL). */
export function cleanTagline(v: unknown): { ok: true; tagline: string | null } | { ok: false; error: string } {
  if (typeof v !== 'string') return { ok: false, error: 'Send your tagline as text.' };
  const t = maskProfanity(cleanText(v, TAGLINE_MAX));
  return { ok: true, tagline: t === '' ? null : t };
}

/** The tagline stored for a user (null when none). */
export async function taglineOf(db: D1Database, userId: string): Promise<string | null> {
  const row = await db.prepare('SELECT tagline FROM users WHERE id = ?')
    .bind(userId).first<{ tagline: string | null }>();
  return row?.tagline ?? null;
}
