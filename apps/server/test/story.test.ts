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

  it('a loss records the attempt and pays the small consolation — 5 XP, no coins, no progress lost, free retry', async () => {
    const r = await (await result('a', 'porch', false, 'g2')).json() as { won: boolean; rewards: { xp: number; coins: number } };
    expect(r.won).toBe(false);
    expect(r.rewards).toEqual({ xp: 5, coins: 0 });
    expect(await xpOf('a')).toBe(5);
    expect(await coinsOf('a')).toBe(0);
    const p = await progress();
    expect(p.stops[0]).toMatchObject({ state: 'current', attempts: 1, clears: 0 });
    expect(p.currentStop).toBe(1);
  });

  it('a loss pays once: re-posting the same finished loss returns the stored award without re-crediting', async () => {
    await result('a', 'porch', false, 'g2');
    const again = await (await result('a', 'porch', false, 'g2')).json() as { replayed: boolean; rewards: { xp: number; coins: number } };
    expect(again.replayed).toBe(true);
    expect(again.rewards).toEqual({ xp: 5, coins: 0 });
    expect(await xpOf('a')).toBe(5);
    expect(await coinsOf('a')).toBe(0);
    expect((await progress()).stops[0]!.attempts).toBe(1);
  });

  it('a replay loss pays the same consolation — the clear stays cleared', async () => {
    await result('a', 'porch', true, 'g1');
    const r = await (await result('a', 'porch', false, 'g2')).json() as { firstClear: boolean; rewards: { xp: number; coins: number } };
    expect(r.firstClear).toBe(false);
    expect(r.rewards).toEqual({ xp: 5, coins: 0 });
    expect(await xpOf('a')).toBe(30);
    expect(await coinsOf('a')).toBe(20);
    expect((await progress()).stops[0]).toMatchObject({ attempts: 2, clears: 1 });
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
    let last: { rewards: { xp: number; coins: number }; completed: boolean; doubleOutcome: string | null } | null = null;
    for (const [i, s] of STORY_STOPS.entries()) {
      const res = await result('a', s.id, true, `route-${s.id}`);
      expect(res.status, s.id).toBe(200);
      last = (await res.json()) as never;
      if (i < STORY_STOPS.length - 1) expect(last!.completed).toBe(false);
    }
    // The King is a double or nothing: that single win only STARTED the
    // double — no completion, no rewards yet (covered fully in
    // story-double.test.ts). The second consecutive win takes the crown.
    expect(last!.completed).toBe(false);
    expect(last!.doubleOutcome).toBe('started');
    expect(last!.rewards).toEqual({ xp: 0, coins: 0 });
    const res2 = await result('a', 'king', true, 'route-king-2');
    expect(res2.status).toBe(200);
    last = (await res2.json()) as never;
    expect(last!.completed).toBe(true);
    expect(last!.doubleOutcome).toBe('cleared');
    expect(last!.rewards).toEqual({ xp: 550, coins: 440 });
    const p = await progress();
    expect(p.completed).toBe(true);
    expect(p.completionMark).toBe('story-solo-complete');
    expect(p.currentStop).toBeNull();
  });
});

/* ================= Scene pass: eggs + feats (2026-10-21) ================= */

const found = (uid: string, eggId: string) =>
  call(uid, '/api/story/found', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eggId }) });
const resultF = (uid: string, stopId: string, won: boolean, gameId: string, facts?: unknown) =>
  call(uid, '/api/story/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stopId, won, gameId, facts }) });
const progressF = async (uid = 'a') => (await (await call(uid, '/api/story/progress')).json()) as {
  stops: { stopId: string; state: string; attempts: number; clears: number }[];
  finds: { eggs: string[]; feats: string[] };
};
const CLEAN = { margin: 40, handsPlayed: 5, setsAgainstUs: 0, setsAgainstThem: 1, ourNilsMade: 0, ourBlindNilsMade: 0, deeNilsMade: 0, deeSteady: false, setOnFirstHand: false, oppSetTwice: false };

describe('story secrets: found endpoint + feat grants', () => {
  it('a scene egg find is recorded once (idempotent) and shows in progress', async () => {
    const r1 = await (await found('a', 'porch-radio')).json() as { ok: boolean; new: boolean; finds: { eggs: string[] } };
    expect(r1.ok).toBe(true);
    expect(r1.new).toBe(true);
    expect(r1.finds.eggs).toContain('porch-radio');
    const r2 = await (await found('a', 'porch-radio')).json() as { new: boolean };
    expect(r2.new).toBe(false);
    expect((await progressF()).finds.eggs.filter((e) => e === 'porch-radio').length).toBe(1);
  });

  it('the lock covers the found endpoint too (non-admin 403)', async () => {
    expect((await found('b', 'porch-radio')).status).toBe(403);
  });

  it('match-event eggs cannot be reported — they are earned in the game', async () => {
    expect((await found('a', 'rec-dee-nil')).status).toBe(400);
    expect((await found('a', 'nope-not-an-egg')).status).toBe(400);
  });

  it('a chain egg requires the carried fact and an unlocked stop', async () => {
    // cookout is locked at the start of the route
    expect((await found('a', 'cookout-chain')).status).toBe(409);
    // unlock through the cookout by clearing 1-3, still without the porch egg
    for (const [i, id] of ['porch', 'barbershop', 'rec-center'].entries()) {
      expect((await result('a', id, true, `chain-pre-${i}`)).status).toBe(200);
    }
    expect((await found('a', 'cookout-chain')).status).toBe(409); // porch egg not in hand
    await found('a', 'porch-radio');
    const ok = await (await found('a', 'cookout-chain')).json() as { ok: boolean; new: boolean };
    expect(ok.ok).toBe(true);
    expect(ok.new).toBe(true);
  });

  it('a clean Porch clear with honest facts grants the feat collectible — once', async () => {
    const r1 = await (await resultF('a', 'porch', true, 'feat-1', CLEAN)).json() as { newFinds: { kind: string; id: string; name: string }[] };
    expect(r1.newFinds).toEqual([{ kind: 'feat', id: 'story-porch-cap', name: "Ray's Lucky Bottle Cap" }]);
    // the collectible is in the Rep unlocks table (profile Unlocks surface)
    const rows = await db.prepare('SELECT item_id AS itemId, source FROM unlocks WHERE user_id = ?').bind('a').all<{ itemId: string; source: string }>();
    expect(rows.results).toContainEqual({ itemId: 'story-porch-cap', source: 'story-feat:porch' });
    // replay the feat in another game: granted once, reported never again
    const r2 = await (await resultF('a', 'porch', true, 'feat-2', CLEAN)).json() as { newFinds: unknown[] };
    expect(r2.newFinds).toEqual([]);
    expect((await progressF()).finds.feats).toEqual(['story-porch-cap']);
  });

  it('no feat without the fact: a set against you, or a missing facts payload, grants nothing', async () => {
    const dirty = await (await resultF('a', 'porch', true, 'feat-dirty', { ...CLEAN, setsAgainstUs: 2 })).json() as { newFinds: unknown[] };
    expect(dirty.newFinds).toEqual([]);
    const bare = await (await resultF('a', 'porch', true, 'feat-bare')).json() as { newFinds: unknown[] };
    expect(bare.newFinds).toEqual([]);
    expect((await progressF()).finds.feats).toEqual([]);
  });

  it('a match-event egg is granted from result facts (Rec Center: Dee makes a nil)', async () => {
    for (const [i, id] of ['porch', 'barbershop'].entries()) await result('a', id, true, `egg-pre-${i}`);
    const r = await (await resultF('a', 'rec-center', false, 'egg-1', { ...CLEAN, deeNilsMade: 1 })).json() as { newFinds: { kind: string; id: string }[] };
    expect(r.newFinds).toContainEqual({ kind: 'egg', id: 'rec-dee-nil', name: "Dee's Rec Center Nil" });
    expect((await progressF()).finds.eggs).toContain('rec-dee-nil');
  });
});
