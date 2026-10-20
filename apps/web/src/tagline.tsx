/**
 * Profile taglines (Demetrius 2026-10-20): a short line on your profile. URLs in it
 * must WORK — they render as tappable links. Only http:// and https:// URLs are
 * linkified (strict shape check + URL parse); everything else — bare domains,
 * javascript:/data: shapes, markup — stays plain text, and all of it renders
 * through React (escaped), never as raw HTML.
 */

export type TaglineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; href: string; label: string };

const URL_RE = /https?:\/\/[^\s<>"']+/gi;
/** Longest rendered link label; longer URLs are middle-truncated (href stays whole). */
export const LINK_LABEL_MAX = 42;

/** Trim sentence punctuation a typist didn't mean as part of the URL. A closer is
 *  only trimmed when its opener never appears (so "…/a(b)" keeps its ")"). */
function trimUrl(raw: string): string {
  let url = raw;
  for (;;) {
    const c = url.charAt(url.length - 1);
    if (!c) break;
    if ('.,;:!?\'"'.includes(c)) { url = url.slice(0, -1); continue; }
    if (c === ')' && !url.includes('(')) { url = url.slice(0, -1); continue; }
    if (c === ']' && !url.includes('[')) { url = url.slice(0, -1); continue; }
    if (c === '}' && !url.includes('{')) { url = url.slice(0, -1); continue; }
    break;
  }
  return url;
}

/** A candidate is a link only if it parses as an http(s) URL with a dotted host. */
function asHttpUrl(raw: string): string | null {
  const url = trimUrl(raw);
  if (!url) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname.includes('.')) return null;
  return url;
}

function labelFor(href: string): string {
  if (href.length <= LINK_LABEL_MAX) return href;
  return `${href.slice(0, 28)}…${href.slice(-11)}`;
}

/** Split a tagline into text/link segments. Pure: shared by the renderer and the tests. */
export function linkifyTagline(text: string): TaglineSegment[] {
  const segs: TaglineSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const href = asHttpUrl(m[0]);
    if (href === null) continue; // not a real link: stays part of the surrounding text
    const start = m.index ?? 0;
    if (start > last) segs.push({ kind: 'text', text: text.slice(last, start) });
    segs.push({ kind: 'link', href, label: labelFor(href) });
    last = start + href.length; // trimmed trailing punctuation falls into the next text slice
  }
  if (last < text.length) segs.push({ kind: 'text', text: text.slice(last) });
  return segs;
}

/** Render a tagline with its links tappable. Returns null for an empty tagline. */
export function TaglineText({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text) return null;
  return (
    <p className={className}>
      {linkifyTagline(text).map((s, i) => (s.kind === 'text'
        ? <span key={i}>{s.text}</span>
        : <a key={i} href={s.href} target="_blank" rel="noopener noreferrer">{s.label}</a>))}
    </p>
  );
}
