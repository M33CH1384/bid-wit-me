/**
 * Social links (Demetrius 2026-10-20): a player can link their public social-media
 * profiles on their Rep profile. SEPARATE from the free-text tagline: this is a
 * fixed platform set, and every stored value is a server-normalized https URL on
 * the platform's own host — never an arbitrary URL. Stored as JSON on the user row
 * (users.social_links, migration 0014): { "instagram": "https://…", … }.
 * One link per platform; NULL / {} = none.
 */

export type SocialLinks = Partial<Record<string, string>>;

interface Platform {
  id: string;
  label: string;
  /** exact hostnames allowed for pasted URLs (lowercase, no subdomains beyond these) */
  hosts: string[];
  /** canonical profile URL from a bare handle (already validated, no leading @) */
  handleUrl: (handle: string) => string;
}

export const SOCIAL_PLATFORMS: Platform[] = [
  {
    id: 'instagram', label: 'Instagram',
    hosts: ['instagram.com', 'www.instagram.com'],
    handleUrl: (h) => `https://www.instagram.com/${h}`,
  },
  {
    id: 'x', label: 'X',
    hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
    handleUrl: (h) => `https://x.com/${h}`,
  },
  {
    id: 'tiktok', label: 'TikTok',
    hosts: ['tiktok.com', 'www.tiktok.com'],
    handleUrl: (h) => `https://www.tiktok.com/@${h}`,
  },
  {
    id: 'youtube', label: 'YouTube',
    hosts: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
    handleUrl: (h) => (h.startsWith('channel/')
      ? `https://www.youtube.com/${h}`
      : /^UC[A-Za-z0-9_-]{10,}$/.test(h)
        ? `https://www.youtube.com/channel/${h}`
        : `https://www.youtube.com/@${h}`),
  },
  {
    id: 'facebook', label: 'Facebook',
    hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com'],
    handleUrl: (h) => `https://www.facebook.com/${h}`,
  },
  {
    id: 'twitch', label: 'Twitch',
    hosts: ['twitch.tv', 'www.twitch.tv'],
    handleUrl: (h) => `https://www.twitch.tv/${h.toLowerCase()}`,
  },
];

const PLATFORM_BY_ID = new Map(SOCIAL_PLATFORMS.map((p) => [p.id, p]));
export const platformOf = (id: string): Platform | undefined => PLATFORM_BY_ID.get(id);

/** Bare handles: letters, digits, dot, underscore, hyphen (YouTube also allows a channel/ prefix). */
const HANDLE_RE = /^[A-Za-z0-9._-]{1,64}$/;

type Norm = { ok: true; url: string | null } | { ok: false; error: string };

/** Validate a parsed URL as a profile link for the platform; returns the normalized URL. */
function checkProfileUrl(p: Platform, u: URL): Norm {
  if (u.protocol !== 'https:') return { ok: false, error: `Your ${p.label} link must start with https://` };
  if (u.username || u.password || u.port) return { ok: false, error: `That doesn't look like a ${p.label} profile link.` };
  if (!p.hosts.includes(u.hostname.toLowerCase())) return { ok: false, error: `That link isn't on ${p.label} — paste your ${p.label} profile link.` };
  if (!u.pathname || u.pathname === '/') return { ok: false, error: `Link to your ${p.label} profile page, not the ${p.label} homepage.` };
  // Canonical form: https + lowercase host + path only (tracking params/fragments dropped).
  return { ok: true, url: `https://${u.hostname.toLowerCase()}${u.pathname}` };
}

/**
 * Normalize one user-supplied value for a platform. Accepts a full profile URL
 * (https, allowlisted host) or a bare handle (normalized to the canonical URL).
 * Empty string → url null (the caller clears that platform). Pure: shared by the
 * route, stored-value revalidation and the tests.
 */
export function normalizeSocialLink(platformId: string, raw: unknown): Norm {
  const p = PLATFORM_BY_ID.get(platformId);
  if (!p) return { ok: false, error: `Unknown platform "${platformId}".` };
  if (typeof raw !== 'string') return { ok: false, error: `Your ${p.label} link must be text.` };
  const v = raw.trim();
  if (v === '') return { ok: true, url: null };
  if (v.length > 300) return { ok: false, error: `That ${p.label} link is too long.` };
  if (/\s/.test(v)) return { ok: false, error: `That doesn't look like a ${p.label} link or handle.` };

  // URL form: explicit scheme, or a pasted host/path with no scheme.
  let url: URL | null = null;
  try { url = new URL(v); } catch { url = null; }
  if (!url && !/^@/.test(v)) {
    try {
      const cand = new URL(`https://${v}`);
      if (p.hosts.includes(cand.hostname.toLowerCase())) url = cand;
    } catch { /* not URL-shaped → handle form below */ }
  }
  if (url) {
    if (!/^https?:$/.test(url.protocol)) return { ok: false, error: `Your ${p.label} link must start with https://` };
    return checkProfileUrl(p, url);
  }

  // Handle form: optional leading @ (YouTube also takes a channel/… prefix or a UC… channel id).
  let h = v.replace(/^@+/, '');
  if (p.id === 'youtube' && /^channel\//i.test(h)) h = `channel/${h.slice(8)}`;
  const handlePart = h.startsWith('channel/') ? h.slice(8) : h;
  if (!HANDLE_RE.test(handlePart)) return { ok: false, error: `That doesn't look like a ${p.label} handle — use letters, numbers, dots, underscores or hyphens.` };
  return { ok: true, url: p.handleUrl(h) };
}

/**
 * Validate a client patch { platform: urlOrHandleOr"" }. Unknown platform keys are
 * ignored (forward-compatible); an invalid value for a KNOWN platform rejects the
 * whole patch with a clear error, so a bad paste never half-saves.
 */
export function validateSocialLinksPatch(v: unknown): { ok: true; patch: Map<string, string | null> } | { ok: false; error: string } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Send your links as an object keyed by platform.' };
  const patch = new Map<string, string | null>();
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    if (!PLATFORM_BY_ID.has(key)) continue;
    const r = normalizeSocialLink(key, val);
    if (!r.ok) return r;
    patch.set(key, r.url);
  }
  return { ok: true, patch };
}

/** Parse the stored JSON column back into a links map, revalidating every entry (bad rows drop out). */
export function parseSocialLinks(raw: string | null | undefined): SocialLinks {
  if (!raw) return {};
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return {}; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
  const out: SocialLinks = {};
  for (const p of SOCIAL_PLATFORMS) {
    const val = (obj as Record<string, unknown>)[p.id];
    if (typeof val !== 'string' || !val) continue;
    const r = normalizeSocialLink(p.id, val);
    if (r.ok && r.url) out[p.id] = r.url;
  }
  return out;
}

/** Apply a validated patch onto the current map (null value = remove that platform). */
export function applySocialLinksPatch(current: SocialLinks, patch: Map<string, string | null>): SocialLinks {
  const out: SocialLinks = { ...current };
  for (const [id, url] of patch) {
    if (url) out[id] = url; else delete out[id];
  }
  // Keep stored key order stable (platform order) for tidy rows.
  const ordered: SocialLinks = {};
  for (const p of SOCIAL_PLATFORMS) if (out[p.id]) ordered[p.id] = out[p.id];
  return ordered;
}

/** The links stored for a user ({} when none). */
export async function socialLinksOf(db: D1Database, userId: string): Promise<SocialLinks> {
  const row = await db.prepare('SELECT social_links AS socialLinks FROM users WHERE id = ?')
    .bind(userId).first<{ socialLinks: string | null }>();
  return parseSocialLinks(row?.socialLinks);
}
