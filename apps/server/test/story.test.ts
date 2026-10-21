/** Story Mode Phase 1: progress storage, sequential unlock, idempotent results, Rep rewards, unrated. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { handleStoryHttp } from '../src/story/routes';
import { STORY_STOPS } from '@spades/bots';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';

async function user(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id.toLowerCase(), 1).run();
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(`${id}-tok`), id, 1, NOW + 10_000_000).run();
}
const call = (uid: string | null, path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (uid) headers.set('cookie', `__Host-bwm_sid=${uid}-tok`);
  return handleStoryHttp(
    new Request(new URL(path, ORIGIN), { ...init, headers }),
    // 'a' and 'c' are admin (owner-class) accounts here; 'b' is a regular player.
    { DB: db, PUBLIC_ORIGIN: ORIGIN, ADMIN_USERNAMES: 'A,C' } as never,
    new URL(path, ORIGIN), path.split('?')[0]!.split('/').filter(Boolean), NOW,
  );
};
const progress = async (uid = 'a') => (await (await call(uid, '/api/story/progress')).json()) as {
  stops: { stopId: string; state: string; attempts: number; clears: number }[];
  currentStop: number | null; completed: boolean; completionMark: string | null;
};
const result = (uid: string, stopId: string, won: boolean, gameId: string) =>
  call(uid, '/api/story/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stopId, won, gameId }) });
const xpOf = async (uid: string) => (await db.prepare('SELECT xp FROM xp_state WHERE user_id = ?').bind(uid).first<{ xp: number }>())?.xp ?? 0;
const coinsOf = async (uid: string) => (await db.prepare('SELECT balance FROM coin_balances WHERE user_id = ?').bind(uid).first<{ balance: number }>())?.balance ?? 0;

beforeEach(async () => {
  db = await makeD1();
  await user('a');
  await user('b');
  await user('c');
});

describe('story progress + results', () => {
  it('starts fresh: stop 1 current, the rest locked, nothing completed', async () => {
    const p = await progress();
    expect(p.stops.length).toBe(STORY_STOPS.length);
    expect(p.stops[0]).toMatchObject({ stopId: 'porch', state: 'current', attempts: 0, clears: 0 });
    expect(p.stops[1]!.state).toBe('locked');
    expect(p.currentStop).toBe(1);
    expect(p.completed).toBe(false);
    expect(p.completionMark).toBeNull();
  });

  it('requires sign-in', async () => {
    expect((await call(null, '/api/story/progress')).status).toBe(401);
    expect((await result('a', 'porch', true, 'g0')).status).toBe(200); // sanity: signed-in admin works
  });

  it('owner-only lock: non-admin players get 403 on both endpoints, and record nothing', async () => {
    expect((await call('b', '/api/story/progress')).status).toBe(403);
    expect((await result('b', 'porch', true, 'gb1')).status).toBe(403);
    expect(await xpOf('b')).toBe(0);
    expect(await coinsOf('b')).toBe(0);
    // the admin's own progress is untouched by the lock
    const p = await progress('a');
    expect(p.stops[0]).toMatchObject({ stopId: 'porch', state: 'current', attempts: 0, clears: 0 });
  });

  it('a win clears the stop, pays the scaled first-clear reward, and unlocks the next stop', async () => {
    const r = await (await result('a', 'porch', true, 'g1')).json() as { firstClear: boolean; rewards: { xp: number; coins: number } };
    expect(r.firstClear).toBe(true);
    expect(r.rewards).toEqual({ xp: 25, coins: 20 });
    expect(await xpOf('a')).toBe(25);
    expect(await coinsOf('a')).toBe(20);
    const p = await progress();
    expect(p.stops[0]).toMatchObject({ state: 'cleared', attempts: 1, clears: 1 });
    expect(p.stops[1]!.state).toBe('current');
    expect(p.currentStop).toBe(2);
  });

  it('is idempotent per game: re-posting the same game never re-credits or re-counts', async () => {
    await result('a', 'porch', true, 'g1');
    const again = await (await result('a', 'porch', true, 'g1')).json() as { replayed: boolean; rewards: { xp: number; coins: number } };
    expect(again.replayed).toBe(true);
    expect(again.rewards).toEqual({ xp: 25, coins: 20 });
    expect(await xpOf('a')).toBe(25);
    expect(await coinsOf('a')).toBe(20);
    expect((await progress()).stops[0]!.attempts).toBe(1);
    // the same game id can never be laundered into another stop
    expect((await result('a', 'barbershop', true, 'g1')).status).toBe(409);
  });

  it('rejects recording a locked stop', async () => {
    expect((await result('a', 'rec-center', true, 'g9')).status).toBe(409);
    expect((await progress()).stops[2]!.attempts).toBe(0);
  });

  it('a loss records the attempt only — no rewards, no progress lost, free retry', async () => {
    const r = await (await result('a', 'porch', false, 'g2')).json() as { won: boolean; rewards: { xp: number; coins: number } };
    expect(r.won).toBe(false);
    expect(r.rewards).toEqual({ xp: 0, coins: 0 });
    const p = await progress();
    expect(p.stops[0]).toMatchObject({ state: 'current', attempts: 1, clears: 0 });
    expect(p.currentStop).toBe(1);
  });

  it('a replay win pays upkeep only, never the clear reward twice', async () => {
    await result('a', 'porch', true, 'g1');
    const r = await (await result('a', 'porch', true, 'g2')).json() as { firstClear: boolean; rewards: { xp: number; coins: number } };
    expect(r.firstClear).toBe(false);
    expect(r.rewards).toEqual({ xp: 10, coins: 5 });
    expect(await xpOf('a')).toBe(35);
    expect(await coinsOf('a')).toBe(25);
    expect((await progress()).stops[0]).toMatchObject({ attempts: 2, clears: 2 });
  });

  it('tracks are per-player; pair-track writes wait for Phase 2', async () => {
    await result('a', 'porch', true, 'g1');
    expect((await progress('c')).currentStop).toBe(1);
    const pairWrite = await call('a', '/api/story/result', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ track: 'pair:a:b', stopId: 'porch', won: true, gameId: 'gp1' }),
    });
    expect(pairWrite.status).toBe(400);
    // …but the pair track key is already valid for reads, so Phase 2 needs no storage change
    expect((await call('a', '/api/story/progress?track=pair:a:b')).status).toBe(200);
    expect((await call('a', '/api/story/progress?track=nope')).status).toBe(400);
  });

  it('story rewards never touch ratings (unrated by construction)', async () => {
    await result('a', 'porch', true, 'g1');
    const sr = await db.prepare('SELECT COUNT(*) AS n FROM season_ratings WHERE user_id = ?').bind('a').first<{ n: number }>();
    expect(sr!.n).toBe(0);
    const ledger = await db.prepare("SELECT reason FROM coin_ledger WHERE user_id = ?").bind('a').all<{ reason: string }>();
    expect(ledger.results.map((r) => r.reason)).toEqual(['story_clear']);
  });

  it('clearing the whole route in order completes the track and stores the solo mark', async () => {
    let last: { rewards: { xp: number; coins: number }; completed: boolean } | null = null;
    for (const [i, s] of STORY_STOPS.entries()) {
      const res = await result('a', s.id, true, `route-${s.id}`);
      expect(res.status, s.id).toBe(200);
      last = (await res.json()) as never;
      if (i < STORY_STOPS.length - 1) expect(last!.completed).toBe(false);
    }
    expect(last!.completed).toBe(true);
    expect(last!.rewards).toEqual({ xp: 275, coins: 220 });
    const p = await progress();
    expect(p.completed).toBe(true);
    expect(p.completionMark).toBe('story-solo-complete');
    expect(p.currentStop).toBeNull();
  });
});
