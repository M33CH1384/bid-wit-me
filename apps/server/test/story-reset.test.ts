/** Story Mode owner tool: POST /api/story/reset-stop — wipe ONE stop on the
 *  caller's own solo track so its next win presents as a first clear again.
 *  Admin-only; no XP/coin clawback; other stops/tracks/users untouched. */
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
const post = (uid: string | null, path: string, body: unknown) =>
  call(uid, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const result = (uid: string, stopId: string, won: boolean, gameId: string, facts?: unknown) =>
  post(uid, '/api/story/result', { stopId, won, gameId, facts });
const found = (uid: string, eggId: string) => post(uid, '/api/story/found', { eggId });
const session = (uid: string, stopId: string) => post(uid, '/api/story/session', { state: 'open', stopId });
const reset = (uid: string | null, stopId: string, track?: string) =>
  post(uid, '/api/story/reset-stop', track ? { track, stopId } : { stopId });
const progress = async (uid = 'a') => (await (await call(uid, '/api/story/progress')).json()) as {
  stops: { stopId: string; state: string; attempts: number; clears: number }[];
  currentStop: number | null; completed: boolean; completionMark: string | null;
  finds: { eggs: string[]; feats: string[] };
};
const xpOf = async (uid: string) => (await db.prepare('SELECT xp FROM xp_state WHERE user_id = ?').bind(uid).first<{ xp: number }>())?.xp ?? 0;
const coinsOf = async (uid: string) => (await db.prepare('SELECT balance FROM coin_balances WHERE user_id = ?').bind(uid).first<{ balance: number }>())?.balance ?? 0;
const sessionRow = async (uid: string) => db.prepare('SELECT stop_id AS stopId, closed_at AS closedAt FROM story_sessions WHERE user_id = ?').bind(uid).first<{ stopId: string; closedAt: number | null }>();
const CLEAN = { margin: 40, handsPlayed: 5, setsAgainstUs: 0, setsAgainstThem: 1, ourNilsMade: 0, ourBlindNilsMade: 0, deeNilsMade: 0, deeSteady: false, setOnFirstHand: false, oppSetTwice: false };

beforeEach(async () => {
  db = await makeD1();
  await user('a');
  await user('b');
  await user('c');
});

describe('story reset-stop (owner tool)', () => {
  it('auth matrix: 401 signed out, 403 non-admin, 400 unknown stop', async () => {
    expect((await reset(null, 'porch')).status).toBe(401);
    expect((await reset('b', 'porch')).status).toBe(403); // a regular player can never reset
    expect((await reset('a', 'nope-not-a-stop')).status).toBe(400);
    expect((await reset('a', 'porch')).status).toBe(200); // admin, nothing recorded: a clean no-op
  });

  it('a pair-track reset wipes BOTH members\u2019 copies of the stop (co-op)', async () => {
    for (const uid of ['a', 'c']) {
      await db.prepare('INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, first_cleared_at, last_played_at) VALUES (?, ?, ?, 1, 1, ?, ?)')
        .bind(uid, 'pair:a:c', 'porch', 1, 1).run();
      await db.prepare('INSERT INTO story_claims (user_id, game_id, track_key, stop_id, won, first_clear, xp, coins, created_at) VALUES (?, ?, ?, ?, 1, 1, 25, 20, ?)')
        .bind(uid, `g-${uid}`, 'pair:a:c', 'porch', 1).run();
    }
    const r = await reset('a', 'porch', 'pair:a:c');
    expect(r.status).toBe(200);
    const left = await db.prepare("SELECT COUNT(*) AS n FROM story_progress WHERE track_key = 'pair:a:c' AND stop_id = 'porch'").first<{ n: number }>();
    expect(left!.n).toBe(0);
    const claims = await db.prepare("SELECT COUNT(*) AS n FROM story_claims WHERE track_key = 'pair:a:c'").first<{ n: number }>();
    expect(claims!.n).toBe(0);
  });

  it('wipes only the named stop: progress, claims, finds — rewards already paid stay paid', async () => {
    // Build a Porch history worth wiping: two wins (the second earns the
    // clean-clear feat), the scene egg found, then a Barbershop clear.
    await result('a', 'porch', true, 'g1');
    await found('a', 'porch-radio');
    const feat = await (await result('a', 'porch', true, 'g2', CLEAN)).json() as { newFinds: { id: string }[] };
    expect(feat.newFinds.map((f) => f.id)).toEqual(['story-porch-cap']);
    await result('a', 'barbershop', true, 'g3');
    const xpBefore = await xpOf('a');
    const coinsBefore = await coinsOf('a');
    expect(xpBefore).toBe(25 + 10 + 50); // porch first clear + replay upkeep + barbershop first clear
    expect(coinsBefore).toBe(20 + 5 + 40);

    const r = await (await reset('a', 'porch')).json() as { ok: boolean; stopId: string; wiped: Record<string, number> };
    expect(r.ok).toBe(true);
    expect(r.stopId).toBe('porch');
    expect(r.wiped.progress).toBe(1);
    expect(r.wiped.claims).toBe(2); // g1 + g2 — the barbershop claim (g3) is not this stop's
    expect(r.wiped.finds).toBe(2); // the egg + the feat

    const p = await progress('a');
    expect(p.stops[0]).toMatchObject({ stopId: 'porch', state: 'current', attempts: 0, clears: 0 });
    expect(p.stops[1]).toMatchObject({ stopId: 'barbershop', state: 'cleared', attempts: 1, clears: 1 });
    expect(p.finds.eggs).toEqual([]);
    expect(p.finds.feats).toEqual([]);
    expect(p.currentStop).toBe(1);
    // NO clawback: what the wiped games paid stays in the ledger…
    expect(await xpOf('a')).toBe(xpBefore);
    expect(await coinsOf('a')).toBe(coinsBefore);
    // …and the feat's Rep unlocks row (profile Unlocks tab) stays too —
    // but the story-side find is gone, so the feat can be earned (and
    // presented in newFinds) again on the re-run.
    const unlocks = await db.prepare('SELECT item_id AS itemId FROM unlocks WHERE user_id = ?').bind('a').all<{ itemId: string }>();
    expect(unlocks.results.map((u) => u.itemId)).toContain('story-porch-cap');
    const claims = await db.prepare('SELECT game_id AS gameId FROM story_claims WHERE user_id = ?').bind('a').all<{ gameId: string }>();
    expect(claims.results.map((c) => c.gameId)).toEqual(['g3']);
  });

  it('after a reset, the re-win is a first clear again — full ceremony facts', async () => {
    await result('a', 'porch', true, 'g1', CLEAN);
    await reset('a', 'porch');
    const r = await (await result('a', 'porch', true, 'g2', CLEAN)).json() as {
      firstClear: boolean; rewards: { xp: number; coins: number }; newFinds: { kind: string; id: string }[];
    };
    expect(r.firstClear).toBe(true);
    expect(r.rewards).toEqual({ xp: 25, coins: 20 }); // first-clear pay again (intended: no clawback)
    expect(r.newFinds).toEqual([{ kind: 'feat', id: 'story-porch-cap', name: "Ray's Lucky Bottle Cap" }]);
    // the scene egg can be found — and reported new — again too
    const egg = await (await found('a', 'porch-radio')).json() as { new: boolean };
    expect(egg.new).toBe(true);
    const p = await progress('a');
    expect(p.stops[0]).toMatchObject({ attempts: 1, clears: 1, state: 'cleared' });
  });

  it('clears the open session only when it belongs to the reset stop', async () => {
    await result('a', 'porch', true, 'g1');
    await result('a', 'barbershop', true, 'g2');
    await session('a', 'barbershop'); // a replay sitting open at the Barbershop
    expect(await sessionRow('a')).toMatchObject({ stopId: 'barbershop', closedAt: null });
    const r1 = await (await reset('a', 'porch')).json() as { wiped: Record<string, number> };
    expect(r1.wiped.sessions).toBe(0); // not this stop's session — untouched
    expect(await sessionRow('a')).toMatchObject({ stopId: 'barbershop', closedAt: null });
    const r2 = await (await reset('a', 'barbershop')).json() as { wiped: Record<string, number> };
    expect(r2.wiped.sessions).toBe(1);
    expect(await sessionRow('a')).toBeNull();
  });

  it("never touches another user's rows", async () => {
    await result('a', 'porch', true, 'ga');
    await result('c', 'porch', true, 'gc');
    await found('c', 'porch-radio');
    await reset('a', 'porch');
    const pc = await progress('c');
    expect(pc.stops[0]).toMatchObject({ stopId: 'porch', state: 'cleared', attempts: 1, clears: 1 });
    expect(pc.finds.eggs).toEqual(['porch-radio']);
    expect(await xpOf('c')).toBe(25);
  });

  it('resetting the King un-completes the track; resetting any other stop does not', async () => {
    for (const s of STORY_STOPS) await result('c', s.id, true, `route-${s.id}`);
    // The King is a double or nothing — the loop's single King win only
    // opened the double; the second consecutive win completes the route.
    await result('c', 'king', true, 'route-king-2');
    let p = await progress('c');
    expect(p.completed).toBe(true);
    expect(p.completionMark).toBe('story-solo-complete');
    // A mid-route reset leaves the King's earned mark standing…
    await reset('c', 'porch');
    p = await progress('c');
    expect(p.completed).toBe(true);
    // …but resetting the King itself takes the mark back with the clear.
    const r = await (await reset('c', 'king')).json() as { completionCleared: boolean };
    expect(r.completionCleared).toBe(true);
    p = await progress('c');
    expect(p.completed).toBe(false);
    expect(p.completionMark).toBeNull();
    expect(p.stops[STORY_STOPS.length - 1]).toMatchObject({ stopId: 'king', attempts: 0, clears: 0 });
  });
});
