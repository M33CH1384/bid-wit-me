/** Social profile avatar (regression, Demetrius 2026-10-20): the Social other-player profile
 *  header lost the uploaded photo and fell back to the initial letter. Root cause chain: the
 *  client's cred fetch used the SOCIAL pid ('u:<uid>') against /api/profile/:id, which looks
 *  users up by the RAW account id — every open except the chat name tap (which strips the
 *  prefix) 404'd. The client now normalizes AND the social profile payload itself carries
 *  the raw id + avatar, so the header never depends on resolving a pid. These tests pin the
 *  payload half of that fix, plus the raw-id contract of /api/profile/:id. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { handleCredHttp } from '../src/cred/routes';
import { profileFor } from '../src/social/routes';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';
const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

async function user(id: string, avatar: string | null) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id, 1).run();
  if (avatar) await db.prepare('UPDATE users SET avatar = ?, avatar_updated_at = ? WHERE id = ?').bind(avatar, NOW, id).run();
}
const call = (path: string) =>
  handleCredHttp(new Request(new URL(path, ORIGIN)), { DB: db, PUBLIC_ORIGIN: ORIGIN }, new URL(path, ORIGIN), path.split('/').filter(Boolean), NOW);

beforeEach(async () => {
  db = await makeD1();
  await user('a', PIC);
  await user('b', null);
});

describe('social profile payload (profileFor)', () => {
  it('carries the raw account id and the uploaded picture', async () => {
    const soc = await profileFor(db, 'A', null);
    expect(soc?.id).toBe('a');
    expect(soc?.avatar).toBe(PIC);
  });
  it('avatar is null for a player who never uploaded one', async () => {
    const soc = await profileFor(db, 'B', null);
    expect(soc?.id).toBe('b');
    expect(soc?.avatar).toBeNull();
  });
});

describe('/api/profile/:id id contract', () => {
  it('resolves by the RAW account id and returns the picture', async () => {
    const res = await call('/api/profile/a');
    expect(res.status).toBe(200);
    const j = (await res.json()) as { user: { id: string; avatar: string | null } };
    expect(j.user.id).toBe('a');
    expect(j.user.avatar).toBe(PIC);
  });
  it('a u:-prefixed social pid does NOT resolve — callers must normalize first', async () => {
    const res = await call('/api/profile/u%3Aa');
    expect(res.status).toBe(404);
  });
});
