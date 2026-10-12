import { describe, expect, it } from 'vitest';
import { LIMITS, hit } from '../src/limits';
import { adminCookieOk, makeAdminCookie, readCookie } from '../src/admin';

describe('rate limits', () => {
  it('sliding window allows up to the limit, then 429s until the oldest hit expires', () => {
    const l = { limit: 3, windowMs: 1000 };
    let t: number[] = [];
    for (let i = 0; i < 3; i++) { const r = hit(t, 100 + i, l); expect(r.ok).toBe(true); t = r.times; }
    const no = hit(t, 200, l);
    expect(no.ok).toBe(false);
    expect(no.retryAfterMs).toBe(900);
    expect(hit(no.times, 1101, l).ok).toBe(true);
  });
  it('limits are sane for real play (a 4-player game with reconnects stays well under)', () => {
    expect(LIMITS.join.limit).toBeGreaterThanOrEqual(30);
    expect(LIMITS.create.limit).toBeGreaterThanOrEqual(5);
  });
});

describe('feedback admin cookie', () => {
  it('signed, expiring, bound to the token', async () => {
    const c = await makeAdminCookie('secret-token', 1000);
    expect(await adminCookieOk(c, 'secret-token', 2000)).toBe(true);
    expect(await adminCookieOk(c, 'other', 2000)).toBe(false);
    expect(await adminCookieOk(c, 'secret-token', 1000 + 8 * 3600_000 + 1)).toBe(false);
    expect(await adminCookieOk(c.replace(/^\d+/, '99999999999999'), 'secret-token', 2000)).toBe(false);
    expect(await adminCookieOk(null, 'secret-token', 2000)).toBe(false);
  });
  it('reads cookies', () => {
    const r = new Request('https://x', { headers: { cookie: 'a=1; bwm_admin=xy%3Dz; b=2' } });
    expect(readCookie(r, 'bwm_admin')).toBe('xy=z');
    expect(readCookie(r, 'c')).toBe(null);
  });
});
