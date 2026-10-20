/** Profile pictures (Demetrius 2026-10-19): validation + upload/remove flow on the cred routes. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { parseAvatarDataUrl, AVATAR_MAX_BYTES } from '../src/cred/avatar';
import { handleCredHttp } from '../src/cred/routes';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';

const dataUrl = (mime: string, bytes: number[]): string =>
  `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const png = (n = 100) => dataUrl('image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(n - 8).fill(0)]);
const jpeg = (n = 100) => dataUrl('image/jpeg', [0xff, 0xd8, 0xff, 0xe0, ...Array(n - 4).fill(0)]);
const webp = (n = 100) => dataUrl('image/webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP'), ...Array(n - 12).fill(0)]);

describe('parseAvatarDataUrl', () => {
  it('accepts png, jpeg and webp data URLs with matching signatures', () => {
    expect(parseAvatarDataUrl(png()).ok).toBe(true);
    expect(parseAvatarDataUrl(jpeg()).ok).toBe(true);
    expect(parseAvatarDataUrl(webp()).ok).toBe(true);
  });
  it('rejects non-images, wrong signatures and bad shapes', () => {
    expect(parseAvatarDataUrl('https://x/y.png').ok).toBe(false);
    expect(parseAvatarDataUrl('data:image/gif;base64,AAAA').ok).toBe(false);
    expect(parseAvatarDataUrl('data:text/plain;base64,AAAA').ok).toBe(false);
    expect(parseAvatarDataUrl(dataUrl('image/png', [0xff, 0xd8, 0xff, 0xe0, ...Array(96).fill(0)])).ok).toBe(false); // jpeg bytes, png label
    expect(parseAvatarDataUrl('').ok).toBe(false);
    expect(parseAvatarDataUrl(null).ok).toBe(false);
    expect(parseAvatarDataUrl(42).ok).toBe(false);
  });
  it('rejects tiny and oversized pictures', () => {
    expect(parseAvatarDataUrl(png(20)).ok).toBe(false);
    const big = `data:image/png;base64,${Buffer.alloc(AVATAR_MAX_BYTES + 1000).toString('base64')}`;
    const r = parseAvatarDataUrl(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too big/i);
  });
});

async function user(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id, 1).run();
}
async function session(uid: string, tok = `${uid}-tok`) {
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), uid, 1, NOW + 10_000_000).run();
  return tok;
}
const call = (tok: string | null, path: string, init?: RequestInit) =>
  handleCredHttp(
    new Request(new URL(path, ORIGIN), { headers: { ...(tok ? { cookie: `__Host-bwm_sid=${tok}` } : {}), 'content-type': 'application/json' }, ...init }),
    { DB: db, PUBLIC_ORIGIN: ORIGIN }, new URL(path, ORIGIN), path.split('/').filter(Boolean), NOW);

beforeEach(async () => {
  db = await makeD1();
  await user('a');
  await user('b');
});

describe('avatar routes', () => {
  it('upload → own + public profile show it; remove → gone', async () => {
    const tok = await session('a');
    const pic = png();
    const up = await call(tok, '/api/profile/me/avatar', { method: 'POST', body: JSON.stringify({ dataUrl: pic }) });
    expect(up.status).toBe(200);

    const me = await (await call(tok, '/api/profile/me')).json() as { user: { avatar: string | null; avatarUpdatedAt: number | null } };
    expect(me.user.avatar).toBe(pic);
    expect(me.user.avatarUpdatedAt).toBe(NOW);

    const pub = await (await call(null, '/api/profile/a')).json() as { user: { avatar: string | null } };
    expect(pub.user.avatar).toBe(pic);

    const del = await call(tok, '/api/profile/me/avatar', { method: 'DELETE' });
    expect(del.status).toBe(200);
    const me2 = await (await call(tok, '/api/profile/me')).json() as { user: { avatar: string | null } };
    expect(me2.user.avatar).toBeNull();
  });

  it('rejects a bad upload and requires sign-in', async () => {
    const tok = await session('a');
    const bad = await call(tok, '/api/profile/me/avatar', { method: 'POST', body: JSON.stringify({ dataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }) });
    expect(bad.status).toBe(400);
    const anon = await call(null, '/api/profile/me/avatar', { method: 'POST', body: JSON.stringify({ dataUrl: png() }) });
    expect(anon.status).toBe(401);
  });

  it('a user without a picture shows null (initial-letter fallback)', async () => {
    const pub = await (await call(null, '/api/profile/b')).json() as { user: { avatar: string | null } };
    expect(pub.user.avatar).toBeNull();
  });
});
