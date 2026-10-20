/** Tiny chat/name hygiene: strip control chars, block links, mask a short profanity list. */
const WORDS = ['fuck', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'whore', 'slut', 'dick', 'pussy', 'asshole', 'bastard', 'motherfucker'];
const RE = new RegExp(`\\b(${WORDS.join('|')})(s|es|ed|ing|er|ers)?\\b`, 'gi');
const LINK = /\b((https?:\/\/|www\.)\S+|\S+\.(com|net|org|io|gg|ly|co|xyz|app|dev|me|tv)\b\S*)/gi;

export function cleanText(s: string, max: number): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function maskProfanity(s: string): string {
  return s.replace(RE, (w) => w[0] + '*'.repeat(w.length - 1));
}

export function blockLinks(s: string): string {
  return s.replace(LINK, '[link]');
}

export function cleanName(s: string, max: number): string {
  const n = maskProfanity(cleanText(s, max));
  return n.includes('*') || n.length === 0 ? '' : n;
}

/** Team names: up to 20 characters (emoji count as one), trimmed, no links, no profanity/slurs. '' = reset to default. */
export const TEAM_NAME_MAX = 20;
export function cleanTeamName(s: string): string | null {
  const t = cleanText(String(s ?? ''), 200);
  const chars = Array.from(t);
  const cut = chars.slice(0, TEAM_NAME_MAX).join('').trim();
  if (!cut) return '';
  if (maskProfanity(cut) !== cut || blockLinks(cut) !== cut) return null; // rejected
  return cut;
}

/** Fun names for all-bot teams (and a nudge for players who haven't picked one). */
export const TEAM_NAME_POOL = [
  'Book Bandits', 'Spade Kings', 'Cut Throats', 'Big Joker Energy', 'No Bags Gang', 'Set Squad', 'Card Sharks', 'Nil & Void',
  'Run It Back', 'Trump Tight', 'Ace Holders', 'The Closers', 'Bag Busters', 'Table Bosses', 'Heart Breakers', 'Club Kids',
  'Diamond Hands', 'Slam Dunkers', 'Book Worms', 'Spadeheads', 'Wheels Up', 'The Cutters', 'Sit Down Crew', 'Say Less',
  'Lil Joker Club', 'Kitchen Table', 'Cookout Champs', 'Reneg Patrol', 'Over The Top', 'Late Night Spades', 'Boss Moves', 'Shot Callers',
  'Bid Whisperers', 'House Rules', 'No Mercy', 'Smooth Operators', 'Deuce Squad', 'Takeover', 'The Bookies', 'Uncle Ray\'s Table',
] as const;

export function pickTeamName(seed: number, taken: readonly string[] = []): string {
  const pool = TEAM_NAME_POOL.filter((n) => !taken.includes(n));
  const list = pool.length ? pool : TEAM_NAME_POOL;
  return list[Math.abs(Math.floor(seed)) % list.length]!;
}

/* ------------------------------------------------- emoji reactions (chat) */
/**
 * Emoji reactions on chat lines. The set is FIXED (no free emoji): nothing to moderate,
 * nothing to validate beyond membership, and the picker stays one small strip on iPhone.
 * emoji -> reactor ids (table: connection pid; global chat: `u:<uid>` / `g:<gid>`).
 */
export const REACT_EMOJIS = ['👍', '❤️', '😂', '🔥', '👏', '😮'] as const;
export type ReactEmoji = (typeof REACT_EMOJIS)[number];
export type ChatReactions = Record<string, string[]>;

/** Pure toggle: pid reacts with `emoji` (idempotent), or removes it if already reacted. Unknown emoji are ignored. */
export function toggleReaction(reactions: ChatReactions | undefined, emoji: string, pid: string): ChatReactions {
  const next: ChatReactions = {};
  for (const [e, by] of Object.entries(reactions ?? {})) if (by.length) next[e] = [...by];
  if ((REACT_EMOJIS as readonly string[]).includes(emoji)) {
    const arr = next[emoji] ?? [];
    const i = arr.indexOf(pid);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(pid);
    if (arr.length) next[emoji] = arr;
    else delete next[emoji];
  }
  return next;
}
