/** Profile taglines (Demetrius 2026-10-20): cleaning rules + set/get/clear flow on the cred routes, and exposure on the public + social profiles. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { cleanTagline, TAGLINE_MAX } from '../src/cred/tagline';
import { handleCredHttp } from '../src/cred/routes';
import { profileFor } from '../src/social/routes';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';

describe('cleanTagline', () => {
  it('keeps plain text and working URLs as-is', () => {
    expect(cleanTagline('King of the block')).toEqual({ ok: true, tagline: 'King of the block' });
    expect(cleanTagline('beats at https://example.com/me — pull up')).toEqual({ ok: true, tagline: 'beats at https://example.com/me — pull up' });
  });
  it('collapses newlines and runs of whitespace to single spaces, and trims', () => {
    expect(cleanTagline('  line one\n\nline\ttwo  ')).toEqual({ ok: true, tagline: 'line one line two' });
  });
  it('caps at TAGLINE_MAX characters', () => {
    const r = cleanTagline('x'.repeat(300));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tagline).toHaveLength(TAGLINE_MAX);
  });
  it('masks profanity the way chat does, but never blocks links', () => {
    expect(cleanTagline('this shit is mine')).toEqual({ ok: true, tagline: 'this s*** is mine' });
    const r = cleanTagline('shit at https://example.com');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tagline).toContain('https://example.com');
  });
  it('blank means cleared; non-text is rejected', () => {
    expect(cleanTagline('')).toEqual({ ok: true, tagline: null });
    expect(cleanTagline('   \n ')).toEqual({ ok: true, tagline: null });
    expect(cleanTagline(null).ok).toBe(false);
    expect(cleanTagline(42).ok).toBe(false);
    expect(cleanTagline(undefined).ok).toBe(false);
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

describe('tagline routes', () => {
  it('set → own, public and social profiles show it; blank save → cleared everywhere', async () => {
    const tok = await session('a');
    const line = 'Tuesday night champ — https://example.com/me';
    const set = await call(tok, '/api/profile/me/tagline', { method: 'POST', body: JSON.stringify({ tagline: line }) });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ ok: true, tagline: line });

    const me = await (await call(tok, '/api/profile/me')).json() as { user: { tagline: string | null } };
    expect(me.user.tagline).toBe(line);

    const pub = await (await call(null, '/api/profile/a')).json() as { user: { tagline: string | null } };
    expect(pub.user.tagline).toBe(line);

    const soc = await profileFor(db, 'A', null);
    expect(soc?.tagline).toBe(line);

    const cleared = await call(tok, '/api/profile/me/tagline', { method: 'POST', body: JSON.stringify({ tagline: '   ' }) });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ ok: true, tagline: null });
    const me2 = await (await call(tok, '/api/profile/me')).json() as { user: { tagline: string | null } };
    expect(me2.user.tagline).toBeNull();
    const pub2 = await (await call(null, '/api/profile/a')).json() as { user: { tagline: string | null } };
    expect(pub2.user.tagline).toBeNull();
  });

  it('stores the cleaned line: capped, single-line, profanity masked, links intact', async () => {
    const tok = await session('a');
    const set = await call(tok, '/api/profile/me/tagline', { method: 'POST', body: JSON.stringify({ tagline: `shit\n${'y'.repeat(300)} https://example.com` }) });
    expect(set.status).toBe(200);
    const body = await set.json() as { tagline: string };
    expect(body.tagline.length).toBeLessThanOrEqual(TAGLINE_MAX);
    expect(body.tagline).not.toContain('\n');
    expect(body.tagline.startsWith('s***')).toBe(true);
  });

  it('requires sign-in, rejects non-text, and only touches your own row', async () => {
    const tok = await session('a');
    const anon = await call(null, '/api/profile/me/tagline', { method: 'POST', body: JSON.stringify({ tagline: 'hi' }) });
    expect(anon.status).toBe(401);
    const bad = await call(tok, '/api/profile/me/tagline', { method: 'POST', body: JSON.stringify({ tagline: 42 }) });
    expect(bad.status).toBe(400);
    await call(tok, '/api/profile/me/tagline', { method: 'POST', body: JSON.stringify({ tagline: 'mine' }) });
    const other = await (await call(null, '/api/profile/b')).json() as { user: { tagline: string | null } };
    expect(other.user.tagline).toBeNull();
  });

  it('a user who never set one shows null (migration default)', async () => {
    const pub = await (await call(null, '/api/profile/b')).json() as { user: { tagline: string | null } };
    expect(pub.user.tagline).toBeNull();
    const soc = await profileFor(db, 'B', null);
    expect(soc?.tagline).toBeNull();
  });
});
