/**
 * @mention token extraction, shared by the Social hub (global chat) and the
 * table room (via the TableDO's RoomIO resolver). Runs on text that has
 * ALREADY been through the surface's clean pipeline (masking can rewrite a
 * token — what resolves is what readers actually see).
 *
 * A mention token is an '@' at a word boundary (start of text, or preceded
 * by a non-word, non-'@' character — so "a@b.com" never tags anyone)
 * followed by a username-shaped token (auth/username rules: a letter, then
 * letters/digits/underscore, USERNAME_MIN..USERNAME_MAX long). Resolution
 * to accounts happens at each call site (users.username_key); guests have
 * no username_key and can never be mentioned.
 */
import { USERNAME_MAX, USERNAME_MIN, usernameKey } from '../auth/username';

const MENTION_RE = /(?:^|[^\w@])@([A-Za-z][A-Za-z0-9_]*)/g;

/** The distinct username_keys a line tags, in first-appearance order. */
export function extractMentionKeys(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(MENTION_RE)) {
    const tok = m[1]!;
    if (tok.length < USERNAME_MIN || tok.length > USERNAME_MAX) continue;
    const k = usernameKey(tok);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * Resolve username_keys to account ids with one query (the profileFor
 * pattern: users.username_key is the unique case-insensitive key).
 * Returns a map of username_key → uid for the keys that name an account.
 */
export async function usersByKeys(db: D1Database, keys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!keys.length) return out;
  const rows = await db.prepare(`SELECT id, username_key FROM users WHERE username_key IN (${keys.map(() => '?').join(', ')})`)
    .bind(...keys).all<{ id: string; username_key: string }>();
  for (const r of rows.results) out.set(r.username_key, r.id);
  return out;
}

/** True when a block row exists between the two accounts in either direction. */
export async function blockedBetween(db: D1Database, x: string, y: string): Promise<boolean> {
  return !!(await db.prepare('SELECT 1 AS ok FROM blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?)')
    .bind(x, y, y, x).first());
}
