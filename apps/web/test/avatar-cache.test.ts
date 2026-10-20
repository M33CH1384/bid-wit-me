/** Avatar cache expiry (owner report 2026-10-20): his OWN row in the Players
 *  list showed the gold initial instead of his uploaded photo, while his
 *  profile showed the photo. Every list face resolves through loadAvatar with
 *  no avatarUpdatedAt, and a cached "no picture" answer used to be final
 *  forever: his device cached null for his uid before he ever uploaded, the
 *  upload didn't invalidate it, and the row never refetched. The profile
 *  header was unaffected because it is handed the picture directly.
 *  Fix: a null entry is only trusted for AVATAR_NULL_TTL_MS; a real picture
 *  (versioned by avatarUpdatedAt) never expires this way. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_NULL_TTL_MS, loadAvatar } from '../src/avatar';

const PIC = 'data:image/png;base64,' + btoa('\x89PNG' + 'x'.repeat(100));

let now = 1_700_000_000_000;
let fetchCount = 0;
let responder: (uid: string) => { avatar: string | null; avatarUpdatedAt: number | null } = () => ({ avatar: null, avatarUpdatedAt: null });

function stubFetch() {
  fetchCount = 0;
  responder = () => ({ avatar: null, avatarUpdatedAt: null });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    fetchCount++;
    const uid = decodeURIComponent(url.split('/api/profile/')[1]!);
    return { ok: true, json: async () => ({ user: responder(uid) }) };
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadAvatar null expiry — the self-row photo', () => {
  it('a null cached before the upload is refetched once it goes stale, and the photo wins', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    stubFetch();
    const uid = 'self-stale-null';
    // Before the upload: the profile has no picture, the answer is cached.
    expect((await loadAvatar(uid)).src).toBeNull();
    expect(fetchCount).toBe(1);
    // He uploads a photo; the server now returns it.
    responder = () => ({ avatar: PIC, avatarUpdatedAt: now });
    // Within the TTL the cached null is still served (no fetch storm on list mounts)…
    expect((await loadAvatar(uid)).src).toBeNull();
    expect(fetchCount).toBe(1);
    // …but once it goes stale the next resolution refetches and the photo shows.
    now += AVATAR_NULL_TTL_MS + 1;
    expect((await loadAvatar(uid)).src).toBe(PIC);
    expect(fetchCount).toBe(2);
    // And the picture itself is cached for good measure.
    expect((await loadAvatar(uid)).src).toBe(PIC);
    expect(fetchCount).toBe(2);
  });

  it('a cached picture never expires on the null TTL (it is versioned)', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    stubFetch();
    const uid = 'other-with-pic';
    responder = () => ({ avatar: PIC, avatarUpdatedAt: 42 });
    expect((await loadAvatar(uid)).src).toBe(PIC);
    now += AVATAR_NULL_TTL_MS * 100;
    expect((await loadAvatar(uid)).src).toBe(PIC);
    expect(fetchCount).toBe(1);
  });

  it('a versioned caller still refetches past a fresh null when the version says newer', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    stubFetch();
    const uid = 'versioned-null';
    expect((await loadAvatar(uid)).src).toBeNull();
    responder = () => ({ avatar: PIC, avatarUpdatedAt: now + 1000 });
    expect((await loadAvatar(uid, now + 1000)).src).toBe(PIC);
  });
});
