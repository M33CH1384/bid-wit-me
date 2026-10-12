/**
 * Usernames: 3–16 characters, letters / digits / underscore, starting with a letter. Unique case-insensitively.
 * Blocks reserved names (staff / system / impersonation) and profanity, including l33t spellings and words hidden
 * inside longer names (with whole-word checks for short words that also occur inside innocent words).
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;

export const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'sysadmin', 'support', 'help', 'helpdesk', 'staff', 'mod', 'mods', 'moderator',
  'official', 'team', 'teambwm', 'bidwitme', 'bid_wit_me', 'bwm', 'bwmofficial', 'spades', 'dealer', 'host', 'guest', 'player',
  'bot', 'bots', 'you', 'me', 'null', 'undefined', 'nan', 'anonymous', 'anon', 'everyone', 'here', 'server', 'api', 'auth',
  'login', 'logout', 'signin', 'signup', 'account', 'settings', 'privacy', 'terms', 'security', 'billing', 'owner', 'dev',
  'developer', 'test', 'tester', 'deleted', 'unknown', 'google', 'discord', 'twitter', 'facebook', 'meta', 'apple', 'passkey',
]);

// substrings that are never innocent
const ALWAYS = ['fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'nigg', 'niga', 'faggot', 'retard', 'whore', 'slut', 'pussy',
  'asshole', 'bastard', 'motherf', 'penis', 'vagina', 'porn', 'hitler', 'nazi', 'kike', 'chink', 'tranny', 'dildo', 'jizz',
  'cum5hot', 'cumshot', 'blowjob', 'handjob', 'rapist', 'molest', 'pedo', 'wetback', 'beaner', 'gook', 'raghead', 'towelhead'];
// short words that hide inside innocent names (grape, raccoon, sussex, dickens, cockpit…): only as a whole piece
const WHOLE = new Set(['ass', 'fag', 'fags', 'dick', 'dicks', 'cock', 'cocks', 'rape', 'coon', 'coons', 'sex', 'spic', 'kkk', 'cum', 'tit', 'tits', 'hoe', 'hoes', 'nig', 'jap', 'homo', 'twat', 'wank', 'piss', 'damn']);

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '!': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g' };
const deleet = (s: string) => s.replace(/[0-9!@$]/g, (c) => LEET[c] ?? c);

export function usernameKey(u: string): string { return u.trim().toLowerCase(); }

export type UsernameCheck = { ok: true; username: string } | { ok: false; reason: string };

export function checkUsername(raw: unknown): UsernameCheck {
  const u = String(raw ?? '').trim();
  if (u.length < USERNAME_MIN) return { ok: false, reason: `At least ${USERNAME_MIN} characters.` };
  if (u.length > USERNAME_MAX) return { ok: false, reason: `At most ${USERNAME_MAX} characters.` };
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(u)) return { ok: false, reason: 'Letters, numbers and _ only, starting with a letter.' };
  if (/__/.test(u) || u.endsWith('_')) return { ok: false, reason: 'No double or trailing underscores.' };
  const k = usernameKey(u);
  if (RESERVED.has(k) || RESERVED.has(k.replace(/_/g, '')) || /^(bwm|bidwitme)/.test(k.replace(/_/g, '')) || /(admin|moderator|official)/.test(k)) {
    return { ok: false, reason: 'That name is reserved.' };
  }
  if (isProfane(u)) return { ok: false, reason: "That name isn't allowed." };
  return { ok: true, username: u };
}

export function isProfane(u: string): boolean {
  const flat = u.toLowerCase();
  const variants = new Set([flat.replace(/_/g, ''), deleet(flat).replace(/_/g, ''), flat.replace(/[^a-z]/g, '')]);
  for (const v of variants) if (ALWAYS.some((w) => v.includes(w))) return true;
  // whole pieces: split on _ , digits, and camelCase humps (BigDick99 → big, dick)
  const pieces = u.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_0-9]+/).filter(Boolean).map((p) => p.toLowerCase());
  const leetPieces = u.split(/_+/).map((p) => deleet(p.toLowerCase()));
  return [...pieces, ...leetPieces].some((p) => WHOLE.has(p) || WHOLE.has(p.replace(/(.)\1+$/, '$1')));
}

/** A starting suggestion from a provider display name ("Demetrius R." → "DemetriusR"). */
export function suggestUsername(name: string | null | undefined): string {
  const words = String(name ?? '').normalize('NFKD').replace(/[^A-Za-z0-9_ ]/g, '').trim().split(/\s+/).filter(Boolean);
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  const tries = [words.map((w, i) => (i ? cap(w) : w)).join(''), words.length > 1 ? words[0] + cap(words[words.length - 1]!.charAt(0)) : '', words[0] ?? ''];
  for (const t of tries) {
    const s = t.replace(/^[^A-Za-z]+/, '');
    if (s.length >= USERNAME_MIN && s.length <= USERNAME_MAX && checkUsername(s).ok) return s;
  }
  return '';
}
