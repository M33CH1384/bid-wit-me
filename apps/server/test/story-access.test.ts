/** Story-mode player allowlist (owner order, 2026-10-21): while
 *  STORY_OWNER_ONLY stays on, the named player LovleyT714 is admitted to
 *  the PLAYER story endpoints (progress / result / session / found)
 *  with her own fresh progress — and to nothing else: reset-stop stays
 *  an owner tool (403), her profile reports dev=false with
 *  storyAccess=true, and every other signed-in player stays locked out.
 *  The general lock itself is pinned in story.test.ts; the reset tool's
 *  own matrix in story-reset.test.ts. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { handleStoryHttp } from '../src/story/routes';
import { handleCredHttp } from '../src/cred/routes';
import { STORY_ACCESS_USERNAMES, STORY_OWNER_ONLY, hasStoryAccess } from '../src/story/access';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';
// 'Boss' is the admin (owner-class) account in this suite.
const ENV = () => ({ DB: db, PUBLIC_ORIGIN: ORIGIN, ADMIN_USERNAMES: 'Boss' });

async function user(id: string, username: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, username, username.toLowerCase(), 1).run();
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(`${id}-tok`), id, 1, NOW + 10_000_000).run();
}
const call = (uid: string | null, path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (uid) headers.set('cookie', `__Host-bwm_sid=${uid}-tok`);
  return handleStoryHttp(
    new Request(new URL(path, ORIGIN), { ...init, headers }),
    ENV() as never,
    new URL(path, ORIGIN), path.split('?')[0]!.split('/').filter(Boolean), NOW,
  );
};
const post = (uid: string | null, path: string, body: unknown) =>
  call(uid, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const progress = async (uid: string) => (await (await call(uid, '/api/story/progress')).json()) as {
  stops: { stopId: string; state: string; attempts: number; clears: number }[];
  currentStop: number | null;
  finds: { eggs: string[]; feats: string[] };
};
const profile = async (uid: string) => (await (await handleCredHttp(
  new Request(new URL('/api/profile/me', ORIGIN), { headers: { cookie: `__Host-bwm_sid=${uid}-tok` } }),
  ENV() as never, new URL('/api/profile/me', ORIGIN), ['api', 'profile', 'me'], NOW,
)).json()) as { dev: boolean; storyAccess: boolean };
const xpOf = async (uid: string) => (await db.prepare('SELECT xp FROM xp_state WHERE user_id = ?').bind(uid).first<{ xp: number }>())?.xp ?? 0;
const coinsOf = async (uid: string) => (await db.prepare('SELECT balance FROM coin_balances WHERE user_id = ?').bind(uid).first<{ balance: number }>())?.balance ?? 0;

beforeEach(async () => {
  db = await makeD1();
  await user('boss', 'Boss');
  await user('lov', 'LovleyT714'); // the allowlisted player, stored username exactly as ordered
  await user('b', 'B'); // a regular player — stays locked
});

describe('story access gate', () => {
  it('the switch is on and the allowlist names exactly LovleyT714 and mommaniese', () => {
    expect(STORY_OWNER_ONLY).toBe(true);
    expect(STORY_ACCESS_USERNAMES).toEqual(['LovleyT714', 'mommaniese']);
  });

  it('hasStoryAccess: admin always, allowlist case-insensitive, everyone else no', () => {
    const env = ENV() as never;
    expect(hasStoryAccess(env, 'x', 'Boss')).toBe(true); // admin via ADMIN_USERNAMES
    expect(hasStoryAccess(env, 'x', 'boss')).toBe(true); // admin match is case-insensitive too
    expect(hasStoryAccess(env, 'x', 'LovleyT714')).toBe(true); // the stored spelling
    expect(hasStoryAccess(env, 'x', 'lovleyt714')).toBe(true); // mirrors isAdmin's case handling
    expect(hasStoryAccess(env, 'x', 'LOVLEYT714')).toBe(true);
    expect(hasStoryAccess(env, 'x', 'mommaniese')).toBe(true); // admitted 2026-10-22, stored spelling
    expect(hasStoryAccess(env, 'x', 'Mommaniese')).toBe(true); // case-insensitive like the rest
    expect(hasStoryAccess(env, 'x', 'Lovley')).toBe(false); // a prefix is not the name
    expect(hasStoryAccess(env, 'x', 'LovleyT715')).toBe(false);
    expect(hasStoryAccess(env, 'x', 'B')).toBe(false);
    expect(hasStoryAccess(env, 'x', null)).toBe(false);
  });

  it('the allowlisted player gets the full player surface with her own fresh progress', async () => {
    // progress: a fresh route of her own — Porch current, nothing recorded
    expect((await call('lov', '/api/story/progress')).status).toBe(200);
    const p0 = await progress('lov');
    expect(p0.stops[0]).toMatchObject({ stopId: 'porch', state: 'current', attempts: 0, clears: 0 });
    expect(p0.currentStop).toBe(1);

    // found (scene egg on an unlocked stop)
    const f = await (await post('lov', '/api/story/found', { eggId: 'porch-radio' })).json() as { ok: boolean; new: boolean };
    expect(f.ok).toBe(true);
    expect(f.new).toBe(true);

    // session (call-back ping)
    expect((await post('lov', '/api/story/session', { state: 'open', stopId: 'porch' })).status).toBe(200);

    // result: a Porch win clears HER stop and pays the first-clear reward
    const r = await (await post('lov', '/api/story/result', { stopId: 'porch', won: true, gameId: 'lov-g1' })).json() as { firstClear: boolean; rewards: { xp: number; coins: number } };
    expect(r.firstClear).toBe(true);
    expect(r.rewards).toEqual({ xp: 25, coins: 20 });
    expect(await xpOf('lov')).toBe(25);
    expect(await coinsOf('lov')).toBe(20);
    const p1 = await progress('lov');
    expect(p1.stops[0]).toMatchObject({ state: 'cleared', attempts: 1, clears: 1 });
    expect(p1.stops[1]!.state).toBe('current');
    expect(p1.finds.eggs).toContain('porch-radio');

    // her progress is hers alone: the admin's route is untouched
    const pa = await progress('boss');
    expect(pa.stops[0]).toMatchObject({ attempts: 0, clears: 0 });
  });

  it('the allowlist is NOT an owner admit: reset-stop 403s for her and wipes nothing', async () => {
    await post('lov', '/api/story/result', { stopId: 'porch', won: true, gameId: 'lov-g1' });
    const res = await post('lov', '/api/story/reset-stop', { stopId: 'porch' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain('owner tool');
    const p = await progress('lov');
    expect(p.stops[0]).toMatchObject({ state: 'cleared', attempts: 1, clears: 1 });
  });

  it('everyone else stays locked: a regular player 403s on every story endpoint', async () => {
    expect((await call('b', '/api/story/progress')).status).toBe(403);
    expect((await post('b', '/api/story/result', { stopId: 'porch', won: true, gameId: 'b-g1' })).status).toBe(403);
    expect((await post('b', '/api/story/session', { state: 'open', stopId: 'porch' })).status).toBe(403);
    expect((await post('b', '/api/story/found', { eggId: 'porch-radio' })).status).toBe(403);
    expect((await post('b', '/api/story/reset-stop', { stopId: 'porch' })).status).toBe(403);
    expect(await xpOf('b')).toBe(0);
    expect(await coinsOf('b')).toBe(0);
  });

  it('signed out is still 401, and the admin experience is unchanged', async () => {
    expect((await call(null, '/api/story/progress')).status).toBe(401);
    expect((await post(null, '/api/story/reset-stop', { stopId: 'porch' })).status).toBe(401);
    expect((await call('boss', '/api/story/progress')).status).toBe(200);
    expect((await post('boss', '/api/story/reset-stop', { stopId: 'porch' })).status).toBe(200);
  });

  it('profile flags: storyAccess without dev for the allowlisted player', async () => {
    const lov = await profile('lov');
    expect(lov.dev).toBe(false);
    expect(lov.storyAccess).toBe(true);
    const b = await profile('b');
    expect(b.dev).toBe(false);
    expect(b.storyAccess).toBe(false);
    const boss = await profile('boss');
    expect(boss.dev).toBe(true);
    expect(boss.storyAccess).toBe(true);
  });
});
