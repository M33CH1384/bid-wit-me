/**
 * Profile-picture uploads (Demetrius 2026-10-19): a signed-in user can upload a picture
 * that stands in for their camera at the table. The client shrinks the image to a
 * 256x256 square (JPEG/WebP, ~15-40 KB) before sending; the server re-verifies the
 * type, the magic bytes and a hard decoded-size cap, then stores the data URL on the
 * user row (users.avatar, set by migration 0011).
 */

export const AVATAR_MAX_BYTES = 200_000;
const AVATAR_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Validate a candidate upload. Pure: shared by the route and the tests. */
export function parseAvatarDataUrl(v: unknown): { ok: true; dataUrl: string; mime: string; bytes: number } | { ok: false; error: string } {
  if (typeof v !== 'string' || v.length === 0) return { ok: false, error: 'Use a JPG, PNG or WebP image.' };
  const m = AVATAR_RE.exec(v);
  if (!m) return { ok: false, error: 'Use a JPG, PNG or WebP image.' };
  const mime = m[1]!;
  const b64 = m[2]!;
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  if (bytes < 64) return { ok: false, error: 'That image is too small to use.' };
  if (bytes > AVATAR_MAX_BYTES) return { ok: false, error: 'That picture is too big — try a smaller image.' };
  // The declared MIME must match the file signature, so a mislabeled blob can't be stored.
  const head = atob(b64.slice(0, 24));
  const isJpeg = head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff;
  const isPng = head.charCodeAt(0) === 0x89 && head.slice(1, 4) === 'PNG';
  const isWebp = head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP';
  if ((mime === 'image/jpeg' && !isJpeg) || (mime === 'image/png' && !isPng) || (mime === 'image/webp' && !isWebp)) {
    return { ok: false, error: 'That file does not look like the image it claims to be.' };
  }
  return { ok: true, dataUrl: v, mime, bytes };
}

/** The picture stored for a user (null when none). */
export async function avatarOf(db: D1Database, userId: string): Promise<{ avatar: string | null; avatarUpdatedAt: number | null }> {
  const row = await db.prepare('SELECT avatar, avatar_updated_at AS avatarUpdatedAt FROM users WHERE id = ?')
    .bind(userId).first<{ avatar: string | null; avatarUpdatedAt: number | null }>();
  return { avatar: row?.avatar ?? null, avatarUpdatedAt: row?.avatarUpdatedAt ?? null };
}
