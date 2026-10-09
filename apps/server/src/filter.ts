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
