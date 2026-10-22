/**
 * POST /api/social/presence (owner, 2026-10-22): the client's direct
 * friend-activity report. Signed-in only; the row written is ALWAYS the
 * caller's own (the session names it — a body naming another user writes
 * nothing for them); unknown activities are refused; an appear-offline
 * user's report succeeds silently and writes nothing (their activity is
 * not their friends' business — the hub stamps under the same rule).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { handleSocialHttp } from '../src/social/routes';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://bid-wit-me.pages.dev';

async function addUserWithSession(id: string, username: string): Promise<string> {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(id, username, username.toLowerCase()).run();
  const tok = `${id}-session`;
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), id, 1, NOW + 10_000_000).run();
  return tok;
}

const post = (body: unknown, tok?: string) => {
  const url = new URL('/api/social/presence', ORIGIN);
  return handleSocialHttp(new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(tok ? { cookie: `__Host-bwm_sid=${tok}` } : {}) },
    body: JSON.stringify(body),
  }), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, ['api', 'social', 'presence'], NOW);
};

const row = async (uid: string) =>
  (await db.prepare('SELECT activity, at FROM presence WHERE user_id = ?').bind(uid).first<{ activity: string; at: number }>()) ?? undefined;

beforeEach(async () => { db = await makeD1(); });

describe('POST /api/social/presence', () => {
  it('anonymous is refused', async () => {
    expect((await post({ activity: 'online' })).status).toBe(401);
  });

  it('unknown or missing activities are refused and write nothing', async () => {
    const tok = await addUserWithSession('ua', 'Alice');
    expect((await post({ activity: 'in-the-zone' }, tok)).status).toBe(400);
    expect((await post({}, tok)).status).toBe(400);
    expect((await post({ activity: 42 }, tok)).status).toBe(400);
    expect(await row('ua')).toBeUndefined();
  });

  it("a valid report writes the caller's own row — a body naming another user is ignored", async () => {
    const tokA = await addUserWithSession('ua', 'Alice');
    await addUserWithSession('ub', 'Bobby');
    const res = await post({ activity: 'story-solo', userId: 'ub', uid: 'ub' }, tokA);
    expect(res.status).toBe(200);
    expect(await row('ua')).toEqual({ activity: 'story-solo', at: NOW });
    expect(await row('ub')).toBeUndefined();
  });

  it('every owner activity value is accepted', async () => {
    const tok = await addUserWithSession('ua', 'Alice');
    for (const activity of ['online', 'bot-game', 'online-match', 'story-solo', 'story-coop']) {
      expect((await post({ activity }, tok)).status).toBe(200);
      expect((await row('ua'))!.activity).toBe(activity);
    }
  });

  it('appear-offline succeeds silently and writes nothing', async () => {
    const tok = await addUserWithSession('ua', 'Alice');
    await db.prepare('INSERT INTO social_settings (user_id, appear_offline) VALUES (?, 1)').bind('ua').run();
    expect((await post({ activity: 'bot-game' }, tok)).status).toBe(200);
    expect(await row('ua')).toBeUndefined();
  });
});
