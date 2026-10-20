/**
 * Social links (Demetrius 2026-10-20): a player's linked social-media profiles,
 * shown as tappable chips on profile views. The platform set and validation live
 * server-side (apps/server/src/cred/socialLinks.ts) — every href rendered here
 * comes from the server's normalized map, never from raw user input. This module
 * only carries the display metadata (order/labels/glyphs) and the chip row.
 */

export interface SocialPlatformMeta { id: string; label: string; glyph: string; hint: string }

export const SOCIAL_PLATFORMS: SocialPlatformMeta[] = [
  { id: 'instagram', label: 'Instagram', glyph: '📸', hint: '@handle or profile link' },
  { id: 'x', label: 'X', glyph: '𝕏', hint: '@handle or profile link' },
  { id: 'tiktok', label: 'TikTok', glyph: '🎵', hint: '@handle or profile link' },
  { id: 'youtube', label: 'YouTube', glyph: '▶️', hint: '@handle, channel link or channel id' },
  { id: 'facebook', label: 'Facebook', glyph: 'f', hint: 'username or profile link' },
  { id: 'twitch', label: 'Twitch', glyph: '🎮', hint: 'channel name or link' },
];

export type SocialLinks = Partial<Record<string, string>>;

export interface SocialLinkEntry { id: string; label: string; glyph: string; url: string }

/** The set links, in platform order; unknown platforms and blanks drop out. Pure — unit-tested. */
export function socialLinkEntries(links: SocialLinks | null | undefined): SocialLinkEntry[] {
  if (!links) return [];
  return SOCIAL_PLATFORMS
    .filter((p) => typeof links[p.id] === 'string' && links[p.id]!.length > 0)
    .map((p) => ({ id: p.id, label: p.label, glyph: p.glyph, url: links[p.id]! }));
}

/** Row of tappable social chips. Renders nothing when the player has no links. */
export function SocialLinksChips({ links, testid }: { links: SocialLinks | null | undefined; testid?: string }) {
  const entries = socialLinkEntries(links);
  if (!entries.length) return null;
  return (
    <div className="social-links" data-testid={testid}>
      {entries.map((e) => (
        <a key={e.id} className="social-link-chip" href={e.url} target="_blank" rel="noopener noreferrer"
          data-testid={`social-link-${e.id}`} aria-label={`${e.label} profile`}>
          <span className="social-link-glyph" aria-hidden>{e.glyph}</span> {e.label} <span aria-hidden>↗</span>
        </a>
      ))}
    </div>
  );
}
