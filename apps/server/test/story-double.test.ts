/** The King of the Block — DOUBLE OR NOTHING (owner, 2026-10-21).
 *
 *  Beating the King once banks nothing: the first win records the attempt,
 *  sets a server-side pending mark on the stop's progress row (migration
 *  0024) and pays zero. Only a win posted while the mark stands clears —
 *  for DOUBLE the first-clear reward (550 XP / 440 coins: the King's real
 *  275 XP / 220 coins first-clear, doubled). A loss while pending voids
 *  both legs. Attempts count finished matches, so each leg counts once.
 *  The Crown Cap feat is judged on the merged facts of BOTH legs and
 *  fails closed when the banked leg facts are missing. */
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
    { DB: db, PUBLIC_ORIGIN: ORIGIN, ADMIN_USERNAMES: 'A,C' } as never,
    new URL(path, ORIGIN), path.split('?')[0]!.split('/').filter(Boolean), NOW,
  );
};
interface StopRow { stopId: string; state: string; attempts: number; clears: number; doublePending: boolean }
interface Prog { stops: StopRow[]; currentStop: number | null; completed: boolean; completionMark: string | null; finds: { eggs: string[]; feats: string[] } }
const progress = async (uid = 'a') => (await (await call(uid, '/api/story/progress')).json()) as Prog;
const kingOf = (p: Prog) => p.stops.find((s) => s.stopId === 'king')!;
interface ResBody {
  ok: boolean; replayed: boolean; won: boolean; firstClear: boolean;
  rewards: { xp: number; coins: number };
  doubleOutcome: 'started' | 'cleared' | 'lost' | null; doublePending: boolean;
  completed: boolean; newFinds: { kind: string; id: string }[];
}
const result = async (uid: string, stopId: string, won: boolean, gameId: string, facts?: unknown): Promise<{ status: number; body: ResBody }> => {
  const res = await call(uid, '/api/story/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stopId, won, gameId, facts }) });
  return { status: res.status, body: (await res.json()) as ResBody };
};
const reset = (uid: string, stopId: string) =>
  call(uid, '/api/story/reset-stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stopId }) });
const xpOf = async (uid: string) => (await db.prepare('SELECT xp FROM xp_state WHERE user_id = ?').bind(uid).first<{ xp: number }>())?.xp ?? 0;
const coinsOf = async (uid: string) => (await db.prepare('SELECT balance FROM coin_balances WHERE user_id = ?').bind(uid).first<{ balance: number }>())?.balance ?? 0;

const CLEAN = { margin: 40, handsPlayed: 5, setsAgainstUs: 0, setsAgainstThem: 1, ourNilsMade: 0, ourBlindNilsMade: 0, deeNilsMade: 0, deeSteady: false, setOnFirstHand: false, oppSetTwice: false };
const SET_TWICE = { ...CLEAN, setsAgainstUs: 2 };

/** Clear stops 1–10 so the King is the current stop. */
async function reachKing(uid = 'a') {
  for (const s of STORY_STOPS.slice(0, -1)) {
    const { status } = await result(uid, s.id, true, `reach-${uid}-${s.id}`);
    expect(status, s.id).toBe(200);
  }
  const p = await progress(uid);
  expect(kingOf(p).state).toBe('current');
}

beforeEach(async () => {
  db = await makeD1();
  await user('a');
  await user('b');
  await user('c');
});

describe("the King's double or nothing", () => {
  it('lose leg 1: an ordinary loss — attempt recorded, no pending, no rewards', async () => {
    await reachKing();
    const xp0 = await xpOf('a'); const coins0 = await coinsOf('a');
    const { status, body } = await result('a', 'king', false, 'k-lose1');
    expect(status).toBe(200);
    expect(body.won).toBe(false);
    expect(body.doubleOutcome).toBeNull();
    expect(body.doublePending).toBe(false);
    expect(body.rewards).toEqual({ xp: 0, coins: 0 });
    expect(await xpOf('a')).toBe(xp0);
    expect(await coinsOf('a')).toBe(coins0);
    const p = await progress();
    expect(kingOf(p)).toMatchObject({ attempts: 1, clears: 0, doublePending: false, state: 'current' });
    expect(p.currentStop).toBe(11);
    expect(p.completed).toBe(false);
  });

  it('win leg 1: pending set, zero rewards, no clear — and the claim records the win honestly', async () => {
    await reachKing();
    const xp0 = await xpOf('a'); const coins0 = await coinsOf('a');
    const { status, body } = await result('a', 'king', true, 'k-win1', CLEAN);
    expect(status).toBe(200);
    expect(body.doubleOutcome).toBe('started');
    expect(body.doublePending).toBe(true);
    expect(body.firstClear).toBe(false);
    expect(body.completed).toBe(false);
    expect(body.rewards).toEqual({ xp: 0, coins: 0 });
    expect(body.newFinds).toEqual([]); // nothing hangs off a clear that has not happened
    expect(await xpOf('a')).toBe(xp0);
    expect(await coinsOf('a')).toBe(coins0);
    const claim = await db.prepare('SELECT won, first_clear AS fc, xp, coins FROM story_claims WHERE user_id = ? AND game_id = ?')
      .bind('a', 'k-win1').first<{ won: number; fc: number; xp: number; coins: number }>();
    expect(claim).toMatchObject({ won: 1, fc: 0, xp: 0, coins: 0 });
    // A fresh progress fetch (any device) carries the pending mark.
    const p = await progress();
    expect(kingOf(p)).toMatchObject({ attempts: 1, clears: 0, doublePending: true, state: 'current' });
    expect(p.completed).toBe(false);
    expect(p.completionMark).toBeNull();
  });

  it('dedupe holds per leg: re-posting the leg-1 game changes nothing', async () => {
    await reachKing();
    await result('a', 'king', true, 'k-win1');
    const again = await result('a', 'king', true, 'k-win1');
    expect(again.body.replayed).toBe(true);
    expect(again.body.doublePending).toBe(true);
    const p = await progress();
    expect(kingOf(p)).toMatchObject({ attempts: 1, clears: 0, doublePending: true });
  });

  it('win leg 2: the clear posts with DOUBLE first-clear rewards and completes the route', async () => {
    await reachKing();
    await result('a', 'king', true, 'k-win1', CLEAN);
    const xp0 = await xpOf('a'); const coins0 = await coinsOf('a');
    const { body } = await result('a', 'king', true, 'k-win2', CLEAN);
    expect(body.doubleOutcome).toBe('cleared');
    expect(body.doublePending).toBe(false);
    expect(body.firstClear).toBe(true);
    expect(body.rewards).toEqual({ xp: 550, coins: 440 });
    expect(await xpOf('a')).toBe(xp0 + 550);
    expect(await coinsOf('a')).toBe(coins0 + 440);
    expect(body.completed).toBe(true);
    const p = await progress();
    expect(kingOf(p)).toMatchObject({ attempts: 2, clears: 1, doublePending: false, state: 'cleared' });
    expect(p.completed).toBe(true);
    expect(p.completionMark).toBe('story-solo-complete');
    expect(p.currentStop).toBeNull();
  });

  it('lose leg 2: NOTHING — both legs void, pending gone, stop stays current, and the double restarts from the top', async () => {
    await reachKing();
    const xp0 = await xpOf('a'); const coins0 = await coinsOf('a');
    await result('a', 'king', true, 'k-win1', CLEAN);
    const { body } = await result('a', 'king', false, 'k-lose2');
    expect(body.doubleOutcome).toBe('lost');
    expect(body.doublePending).toBe(false);
    expect(body.rewards).toEqual({ xp: 0, coins: 0 });
    expect(await xpOf('a')).toBe(xp0);
    expect(await coinsOf('a')).toBe(coins0);
    const p = await progress();
    expect(kingOf(p)).toMatchObject({ attempts: 2, clears: 0, doublePending: false, state: 'current' });
    expect(p.completed).toBe(false);
    // The next win is a NEW leg 1 — it starts a double, it does not clear.
    const again = await result('a', 'king', true, 'k-win1b');
    expect(again.body.doubleOutcome).toBe('started');
    expect(again.body.firstClear).toBe(false);
  });

  it('a King clear is honored only while a pending leg-1 win stands (no single-win path)', async () => {
    await reachKing();
    // One win, however it is dressed up, never clears.
    const one = await result('a', 'king', true, 'k-only', CLEAN);
    expect(one.body.firstClear).toBe(false);
    expect(kingOf(await progress()).clears).toBe(0);
    // Lose the double away, then win once more: still only a fresh leg 1.
    await result('a', 'king', false, 'k-lose2');
    const two = await result('a', 'king', true, 'k-only2', CLEAN);
    expect(two.body.doubleOutcome).toBe('started');
    expect(two.body.firstClear).toBe(false);
    expect(kingOf(await progress()).clears).toBe(0);
  });

  it('reset-stop wipes a live double with the progress row', async () => {
    await reachKing();
    await result('a', 'king', true, 'k-win1');
    expect(kingOf(await progress()).doublePending).toBe(true);
    expect((await reset('a', 'king')).status).toBe(200);
    const p = await progress();
    expect(kingOf(p)).toMatchObject({ attempts: 0, clears: 0, doublePending: false });
    // And the next win is a leg 1 again, not a clear.
    const again = await result('a', 'king', true, 'k-win1-after-reset');
    expect(again.body.doubleOutcome).toBe('started');
  });

  it('after the crown: King replays are single upkeep matches — no double, no pending', async () => {
    await reachKing();
    await result('a', 'king', true, 'k-win1');
    await result('a', 'king', true, 'k-win2');
    const { body } = await result('a', 'king', true, 'k-replay');
    expect(body.doubleOutcome).toBeNull();
    expect(body.doublePending).toBe(false);
    expect(body.firstClear).toBe(false);
    expect(body.rewards).toEqual({ xp: 10, coins: 5 });
    expect(kingOf(await progress())).toMatchObject({ attempts: 3, clears: 2, doublePending: false });
  });

  it("the Crown Cap feat is judged across BOTH legs — a set in either leg denies it", async () => {
    await reachKing();
    // Clean leg 1, set twice in leg 2 → no cap.
    await result('a', 'king', true, 'f1-leg1', CLEAN);
    const dirty2 = await result('a', 'king', true, 'f1-leg2', SET_TWICE);
    expect(dirty2.body.firstClear).toBe(true);
    expect((await progress()).finds.feats).not.toContain('story-king-crown-cap');

    // Reset and run it back: set in leg 1, clean leg 2 → still no cap.
    await reset('a', 'king');
    await result('a', 'king', true, 'f2-leg1', SET_TWICE);
    await result('a', 'king', true, 'f2-leg2', CLEAN);
    expect((await progress()).finds.feats).not.toContain('story-king-crown-cap');

    // Both legs clean → the cap lands on the deciding post.
    await reset('a', 'king');
    await result('a', 'king', true, 'f3-leg1', CLEAN);
    const clean2 = await result('a', 'king', true, 'f3-leg2', CLEAN);
    expect(clean2.body.newFinds.map((f) => f.id)).toContain('story-king-crown-cap');
    expect((await progress()).finds.feats).toContain('story-king-crown-cap');
  });

  it('feat fails closed: a deciding post with no banked leg facts clears and pays, but grants no feat', async () => {
    await reachKing();
    await result('a', 'king', true, 'nf-leg1'); // no facts posted for leg 1
    const { body } = await result('a', 'king', true, 'nf-leg2', CLEAN);
    expect(body.firstClear).toBe(true);
    expect(body.rewards).toEqual({ xp: 550, coins: 440 });
    expect((await progress()).finds.feats).not.toContain('story-king-crown-cap');
  });

  it('other stops are untouched: a normal stop still clears on one win', async () => {
    const { body } = await result('a', 'porch', true, 'p-win', CLEAN);
    expect(body.firstClear).toBe(true);
    expect(body.doubleOutcome).toBeNull();
    expect(body.rewards).toEqual({ xp: 25, coins: 20 });
    const p = await progress();
    expect(p.stops[0]).toMatchObject({ stopId: 'porch', clears: 1, doublePending: false });
  });
});
