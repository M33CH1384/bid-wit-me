/**
 * Profile pictures (Demetrius 2026-10-19): a signed-in user can upload a picture that
 * stands in for their camera — shown at the table, in the lobby and on profile views
 * whenever their camera is off, instead of the bare initial letter.
 *
 * The picture itself lives on the server's user row (D1) as a small data URL and comes
 * back inside the public profile: GET /api/profile/:id → { user: { avatar, avatarUpdatedAt } }.
 * This module is the client side of that contract:
 *   - compressAvatarFile(): shrink any picked image to a 256x256 square data URL (<= ~120 KB)
 *   - validateAvatarDataUrl(): the same checks the server applies (shared rules, pure logic)
 *   - avatarSrcFor(): pure pick — uploaded picture first, else the initial-letter fallback
 *   - useAvatar(): resolve (and cache) a player's picture by account id
 */
import { useEffect, useState, type CSSProperties } from 'react';

/** Longest edge of the stored picture, px. Displayed circles are <= ~120px, so 256 is retina-crisp. */
export const AVATAR_SIZE = 256;
/** Hard server cap on the DECODED image bytes; the client targets well under it. */
export const AVATAR_MAX_BYTES = 200_000;
/** MIME types the server accepts. */
export const AVATAR_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

/** Validate a candidate data URL exactly as the server will. Returns the decoded byte count. */
export function validateAvatarDataUrl(dataUrl: unknown): { ok: true; mime: string; bytes: number } | { ok: false; error: string } {
  if (typeof dataUrl !== 'string') return { ok: false, error: 'That file is not an image we can use.' };
  const m = DATA_URL_RE.exec(dataUrl);
  if (!m) return { ok: false, error: 'Use a JPG, PNG or WebP image.' };
  const [, mime, b64] = m as unknown as [string, string, string];
  const bytes = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
  if (bytes < 64) return { ok: false, error: 'That image is too small to use.' };
  if (bytes > AVATAR_MAX_BYTES) return { ok: false, error: 'That picture is too big — try a smaller image.' };
  // magic bytes: the declared type must match the actual file signature
  const head = atob(b64.slice(0, 24));
  const isJpeg = head.charCodeAt(0) === 0xff && head.charCodeAt(1) === 0xd8 && head.charCodeAt(2) === 0xff;
  const isPng = head.charCodeAt(0) === 0x89 && head.slice(1, 4) === 'PNG';
  const isWebp = head.slice(0, 4) === 'RIFF' && head.slice(8, 12) === 'WEBP';
  if ((mime === 'image/jpeg' && !isJpeg) || (mime === 'image/png' && !isPng) || (mime === 'image/webp' && !isWebp)) {
    return { ok: false, error: 'That file does not look like the image it claims to be.' };
  }
  return { ok: true, mime, bytes };
}

/** The source to show for a player: their uploaded picture when there is one, else null (→ initial letter). */
export function avatarSrcFor(avatar: string | null | undefined): string | null {
  return typeof avatar === 'string' && avatar.startsWith('data:image/') ? avatar : null;
}

/**
 * What an avatar circle shows, pure logic (Demetrius 2026-10-19): the uploaded picture
 * whenever the player has one — in particular when their camera is off — else the initial.
 */
export function faceOf(pic: string | null | undefined, name: string): { kind: 'pic'; src: string } | { kind: 'initial'; letter: string } {
  const src = avatarSrcFor(pic);
  if (src) return { kind: 'pic', src };
  return { kind: 'initial', letter: name.trim().charAt(0).toUpperCase() || '?' };
}

/**
 * Shrink a picked image file to a square data URL: center-crop, 256x256, JPEG
 * (or WebP where the browser encodes it). Steps the quality down until the result
 * is comfortably under the server cap.
 */
export async function compressAvatarFile(file: File): Promise<string> {
  if (!/^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.type) && !/\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name)) {
    throw new Error('Use a JPG, PNG or WebP image.');
  }
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('Could not read that image.');
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side) / 2, sy = (bmp.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = AVATAR_SIZE; canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image tools are not available in this browser.');
  ctx.drawImage(bmp, sx, sy, side, side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
  bmp.close();
  const mime = canvas.toDataURL('image/webp', 0.85).startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg';
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL(mime, q);
    const v = validateAvatarDataUrl(url);
    if (v.ok && v.bytes <= 120_000) return url;
  }
  // last resort: a smaller square always fits
  const small = document.createElement('canvas');
  small.width = 160; small.height = 160;
  small.getContext('2d')!.drawImage(await createImageBitmap(file), sx, sy, side, side, 0, 0, 160, 160);
  return small.toDataURL(mime, 0.7);
}

/* ------------------------------------------------------------------ cache */

/** In-memory + localStorage cache keyed by account id. A picture changes rarely; the
 *  public profile's avatarUpdatedAt lets us notice a change and refetch once. */
const LS_PREFIX = 'bwm.avatar.';
interface CacheEntry { src: string | null; at: number }
const mem = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function lsGet(uid: string): CacheEntry | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + uid);
    if (!raw) return null;
    const e = JSON.parse(raw) as CacheEntry;
    return typeof e === 'object' && e && 'at' in e ? { src: typeof e.src === 'string' ? e.src : null, at: e.at } : null;
  } catch { return null; }
}
function lsSet(uid: string, e: CacheEntry): void {
  try { localStorage.setItem(LS_PREFIX + uid, JSON.stringify(e)); } catch { /* quota: memory cache still serves this session */ }
}

async function loadAvatar(uid: string, knownUpdatedAt?: number): Promise<CacheEntry> {
  const cached = mem.get(uid) ?? lsGet(uid);
  if (cached && (knownUpdatedAt === undefined || cached.at >= knownUpdatedAt)) return cached;
  if (cached && inflight.has(uid)) return inflight.get(uid)!;
  const p = (async (): Promise<CacheEntry> => {
    try {
      const r = await fetch(`/api/profile/${encodeURIComponent(uid)}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { user?: { avatar?: string | null; avatarUpdatedAt?: number | null } };
      const entry: CacheEntry = { src: avatarSrcFor(j.user?.avatar), at: j.user?.avatarUpdatedAt ?? Date.now() };
      mem.set(uid, entry); lsSet(uid, entry);
      return entry;
    } catch {
      // offline / not an account: keep whatever we had (null the first time). Only pin the
      // fallback in the session cache when there WAS a cached entry — pinning a first-fetch
      // failure would stick the initial-letter fallback for the whole session even after a
      // transient error (e.g. a deploy in flight) clears; without a pin, the next mount retries.
      const fallback: CacheEntry = cached ?? { src: null, at: 0 };
      if (cached) mem.set(uid, fallback);
      return fallback;
    } finally { inflight.delete(uid); }
  })();
  inflight.set(uid, p);
  return p;
}

/** Drop a cached picture (after the owner uploads/removes one, so this device updates at once). */
export function forgetAvatar(uid: string): void {
  mem.delete(uid);
  try { localStorage.removeItem(LS_PREFIX + uid); } catch { /* ignore */ }
}

/**
 * The uploaded picture for an account id, or null (→ initial-letter fallback).
 * Pass `direct` when the caller already has the data URL (e.g. my own profile response)
 * to skip the fetch; pass `updatedAt` if known so a newer picture refetches.
 */
export function useAvatar(uid: string | null | undefined, direct?: string | null, updatedAt?: number): string | null {
  const [src, setSrc] = useState<string | null>(() => avatarSrcFor(direct) ?? (uid ? (mem.get(uid)?.src ?? lsGet(uid)?.src ?? null) : null));
  useEffect(() => {
    const d = avatarSrcFor(direct);
    if (d) { setSrc(d); return; }
    if (!uid) { setSrc(null); return; }
    let alive = true;
    void loadAvatar(uid, updatedAt).then((e) => { if (alive) setSrc(e.src); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, direct, updatedAt]);
  return src;
}

/**
 * A round face circle: the uploaded picture when the player has one, else their initial.
 * The picture replaces the bare initial everywhere it shows — including the table's name
 * plates and the camera-off state of the video bubbles (Demetrius 2026-10-19).
 *
 * With `onTap` the circle becomes a real button that opens the player's profile
 * (Demetrius 2026-10-20: pictures are tappable everywhere). The tap is swallowed
 * (stopPropagation) so a face inside a row/card never double-fires the row's own action.
 */
export function AvatarCircle({ pic, name, className, style, testId, onTap }: { pic: string | null | undefined; name: string; className?: string; style?: CSSProperties; testId?: string; onTap?: () => void }) {
  const face = faceOf(pic, name);
  if (onTap) {
    return (
      <button type="button" className={`avatar-tap ${className ?? ''}${face.kind === 'pic' ? ' has-pic' : ''}`.trim()} style={style} data-testid={testId}
        aria-label={`View ${name}'s profile`}
        onClick={(e) => { e.stopPropagation(); onTap(); }}>
        {face.kind === 'pic' ? <img src={face.src} alt="" /> : face.letter}
      </button>
    );
  }
  return face.kind === 'pic'
    ? <span className={`${className ?? ''} has-pic`.trim()} style={style} aria-hidden={true} data-testid={testId}><img src={face.src} alt="" /></span>
    : <span className={className} style={style} aria-hidden={true} data-testid={testId}>{face.letter}</span>;
}

/** Social/presence ids are 'u:<uid>' for accounts (guests are 'g:<random>'): strip the prefix for avatar lookups. */
export function socialUidOf(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  return id.startsWith('u:') ? id.slice(2) : undefined;
}

/**
 * The raw account id behind an id that may arrive either as a social pid ('u:<uid>')
 * or already raw ('<uid>' — e.g. the global-chat name tap strips the prefix itself).
 * Guests and empty values resolve to undefined. /api/profile/:id looks users up by the
 * RAW id, so anything fetching it must go through this (or socialUidOf) first — passing
 * a 'u:'-prefixed pid 404s and the profile silently loses its picture/Rep (2026-10-20).
 */
export function accountUidOf(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  if (id.startsWith('g:')) return undefined;
  return id.startsWith('u:') ? id.slice(2) : id;
}
