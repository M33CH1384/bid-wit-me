/**
 * @mention helpers for the chat composers and line rendering (client mirror
 * of the server's rules in apps/server/src/social/mentions.ts): a mention
 * token is an '@' at a word boundary followed by a username-shaped token
 * (a letter, then letters/digits/underscore, 3–16 chars once complete).
 * The SERVER resolves tokens to accounts; the client only completes them
 * while typing and highlights the ones the server actually resolved.
 */

/** An in-progress @token at the caret, if the player is typing one. */
export interface MentionQuery { /** index of the '@' in the text */ start: number; /** the partial username after it */ query: string }

const PARTIAL = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;

/**
 * The mention being typed at `caret`, or null. The '@' must sit at a word
 * boundary (start of text, or after a non-word, non-'@' character — the
 * server rule, so "a@b" never opens the picker) and only username-shaped
 * characters may sit between it and the caret.
 */
export function mentionQueryAt(text: string, caret: number): MentionQuery | null {
  let i = caret - 1;
  while (i >= 0 && /[A-Za-z0-9_]/.test(text[i]!)) i--;
  if (i < 0 || text[i] !== '@') return null;
  if (i > 0 && /[\w@]/.test(text[i - 1]!)) return null;
  const query = text.slice(i + 1, caret);
  if (query !== '' && !PARTIAL.test(query)) return null;
  return { start: i, query };
}

/** Replace the in-progress token with the picked username: `@<name> ` (canonical case, trailing space). */
export function applyMention(text: string, q: MentionQuery, caret: number, name: string): { text: string; caret: number } {
  const insert = `@${name} `;
  return { text: text.slice(0, q.start) + insert + text.slice(caret), caret: q.start + insert.length };
}

/**
 * Completion candidates for a query: prefix matches (case-insensitive),
 * keeping the caller's order — callers pass friends first, then online
 * players, then the table roster, so the ranking IS the source order.
 */
export function rankMentionCandidates<T extends { name: string }>(candidates: readonly T[], query: string, limit = 6): T[] {
  const k = query.toLowerCase();
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of candidates) {
    const key = c.name.toLowerCase();
    if (seen.has(key) || !key.startsWith(k)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

/** One render segment of a chat line: plain text, or a resolved @mention. */
export interface MentionSegment { text: string; mention: boolean }

const TOKEN_RE = /(?:^|[^\w@])@([A-Za-z][A-Za-z0-9_]{2,15})(?![A-Za-z0-9_])/g;

/**
 * Split a line's text into segments, flagging the @tokens `isResolved`
 * accepts (the caller checks the token's key against the line's
 * server-resolved mentions — an unresolvable @name stays plain text).
 */
export function splitMentionText(text: string, isResolved: (key: string) => boolean): MentionSegment[] {
  const out: MentionSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const tok = m[1]!;
    if (!isResolved(tok.toLowerCase())) continue;
    const start = m.index + m[0].length - tok.length - 1; // index of the '@'
    if (start > last) out.push({ text: text.slice(last, start), mention: false });
    out.push({ text: `@${tok}`, mention: true });
    last = start + tok.length + 1;
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false });
  return out.length ? out : [{ text, mention: false }];
}
