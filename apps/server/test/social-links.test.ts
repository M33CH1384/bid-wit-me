/** Social links (Demetrius 2026-10-20): handle→URL normalization, host allowlist, routes. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { normalizeSocialLink, parseSocialLinks, validateSocialLinksPatch } from '../src/cred/socialLinks';
import { handleCredHttp } from '../src/cred/routes';

const url = (r: ReturnType<typeof normalizeSocialLink>) => (r.ok ? r.url : `ERR: ${r.error}`);

describe('normalizeSocialLink — handles', () => {
  it('normalizes bare handles (with or without @) to canonical profile URLs', () => {
    expect(url(normalizeSocialLink('instagram', 'demetrius'))).toBe('https://www.instagram.com/demetrius');
    expect(url(normalizeSocialLink('instagram', '@demetrius'))).toBe('https://www.instagram.com/demetrius');
    expect(url(normalizeSocialLink('x', '@m33ch'))).toBe('https://x.com/m33ch');
    expect(url(normalizeSocialLink('tiktok', 'demo.user'))).toBe('https://www.tiktok.com/@demo.user');
    expect(url(normalizeSocialLink('youtube', '@DemoChannel'))).toBe('https://www.youtube.com/@DemoChannel');
    expect(url(normalizeSocialLink('facebook', 'demo.page'))).toBe('https://www.facebook.com/demo.page');
    expect(url(normalizeSocialLink('twitch', 'DemoStreamer'))).toBe('https://www.twitch.tv/demostreamer');
  });
  it('normalizes YouTube channel ids and channel/ paths', () => {
    expect(url(normalizeSocialLink('youtube', 'UC1234567890abcdefghij'))).toBe('https://www.youtube.com/channel/UC1234567890abcdefghij');
    expect(url(normalizeSocialLink('youtube', 'channel/UC1234567890abcdefghij'))).toBe('https://www.youtube.com/channel/UC1234567890abcdefghij');
  });
  it('empty string clears the link', () => {
    expect(normalizeSocialLink('instagram', '   ')).toEqual({ ok: true, url: null });
  });
});

describe('normalizeSocialLink — URLs', () => {
  it('accepts https URLs on the platform hosts and drops tracking params', () => {
    expect(url(normalizeSocialLink('instagram', 'https://www.instagram.com/demo/?igsh=abc#frag'))).toBe('https://www.instagram.com/demo/');
    expect(url(normalizeSocialLink('instagram', 'instagram.com/demo'))).toBe('https://instagram.com/demo');
    expect(url(normalizeSocialLink('x', 'https://twitter.com/demo'))).toBe('https://twitter.com/demo');
    expect(url(normalizeSocialLink('x', 'https://x.com/demo'))).toBe('https://x.com/demo');
    expect(url(normalizeSocialLink('youtube', 'https://youtu.be/@demo'))).toBe('https://youtu.be/@demo');
    expect(url(normalizeSocialLink('tiktok', 'https://www.tiktok.com/@demo'))).toBe('https://www.tiktok.com/@demo');
  });
  it('rejects http downgrade, lookalike hosts and wrong-platform URLs', () => {
    expect(normalizeSocialLink('instagram', 'http://instagram.com/demo').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'https://instagram.com.evil.com/demo').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'instagram.com.evil.com/demo').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'https://evilinstagram.com/demo').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'https://www.tiktok.com/@demo').ok).toBe(false);
    expect(normalizeSocialLink('x', 'https://x.com.evil.io/demo').ok).toBe(false);
  });
  it('rejects homepages, credentials, ports and non-web schemes', () => {
    expect(normalizeSocialLink('instagram', 'https://instagram.com/').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'https://instagram.com').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'https://user:pass@instagram.com/demo').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'https://instagram.com:8443/demo').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'javascript:alert(1)').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'data:text/html;base64,AAAA').ok).toBe(false);
  });
  it('rejects junk handles', () => {
    expect(normalizeSocialLink('instagram', 'foo/bar').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'foo bar').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 'foo!bar').ok).toBe(false);
    expect(normalizeSocialLink('instagram', 42).ok).toBe(false);
    expect(normalizeSocialLink('myspace', 'demo').ok).toBe(false);
  });
});

describe('validateSocialLinksPatch / parseSocialLinks', () => {
  it('validates a patch, ignores unknown platforms, errors on a bad known value', () => {
    const good = validateSocialLinksPatch({ instagram: 'demo', x: 'https://x.com/demo', myspace: 'demo' });
    expect(good.ok).toBe(true);
    if (good.ok) {
      expect(good.patch.get('instagram')).toBe('https://www.instagram.com/demo');
      expect(good.patch.get('x')).toBe('https://x.com/demo');
      expect(good.patch.has('myspace')).toBe(false);
    }
    const bad = validateSocialLinksPatch({ instagram: 'https://instagram.com.evil.com/demo' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toMatch(/Instagram/);
    expect(validateSocialLinksPatch(null).ok).toBe(false);
    expect(validateSocialLinksPatch(['instagram']).ok).toBe(false);
  });
  it('parseSocialLinks revalidates stored rows (tampered values drop out)', () => {
    expect(parseSocialLinks(null)).toEqual({});
    expect(parseSocialLinks('not json')).toEqual({});
    expect(parseSocialLinks('{"instagram":"https://www.instagram.com/demo","x":"https://evil.com/demo","tiktok":42}'))
      .toEqual({ instagram: 'https://www.instagram.com/demo' });
  });
});

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';

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
const post = (tok: string | null, links: unknown) => call(tok, '/api/profile/me/social-links', { method: 'POST', body: JSON.stringify({ links }) });

beforeEach(async () => {
  db = await makeD1();
  await user('a');
  await user('b');
});

describe('social-links routes', () => {
  it('applies migration 0014: the social_links column exists', async () => {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name = 'social_links'").first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it('set → own + public profile show normalized links; clear one platform keeps the rest', async () => {
    const tok = await session('a');
    const r = await post(tok, { instagram: '@demo', twitch: 'https://www.twitch.tv/DemoStreamer' });
    expect(r.status).toBe(200);
    const saved = (await r.json()) as { socialLinks: Record<string, string> };
    expect(saved.socialLinks).toEqual({ instagram: 'https://www.instagram.com/demo', twitch: 'https://www.twitch.tv/DemoStreamer' });

    const me = await (await call(tok, '/api/profile/me')).json() as { user: { socialLinks: Record<string, string> } };
    expect(me.user.socialLinks).toEqual(saved.socialLinks);
    const pub = await (await call(null, '/api/profile/a')).json() as { user: { socialLinks: Record<string, string> } };
    expect(pub.user.socialLinks).toEqual(saved.socialLinks);

    const cleared = await post(tok, { instagram: '' });
    expect(cleared.status).toBe(200);
    const after = (await cleared.json()) as { socialLinks: Record<string, string> };
    expect(after.socialLinks).toEqual({ twitch: 'https://www.twitch.tv/DemoStreamer' });

    const merged = await post(tok, { youtube: 'DemoTube' });
    const mergedLinks = ((await merged.json()) as { socialLinks: Record<string, string> }).socialLinks;
    expect(mergedLinks).toEqual({ twitch: 'https://www.twitch.tv/DemoStreamer', youtube: 'https://www.youtube.com/@DemoTube' });
    void mergedLinks;
  });

  it('rejects an invalid link with a 400 and stores nothing; requires sign-in', async () => {
    const tok = await session('a');
    const bad = await post(tok, { instagram: 'https://instagram.com.evil.com/demo' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/Instagram/);
    const me = await (await call(tok, '/api/profile/me')).json() as { user: { socialLinks: Record<string, string> } };
    expect(me.user.socialLinks).toEqual({});
    const anon = await post(null, { instagram: 'demo' });
    expect(anon.status).toBe(401);
  });

  it('a user with no links shows an empty map on the public profile', async () => {
    const pub = await (await call(null, '/api/profile/b')).json() as { user: { socialLinks: Record<string, string> } };
    expect(pub.user.socialLinks).toEqual({});
  });
});
