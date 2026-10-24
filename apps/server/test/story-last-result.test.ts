/**
 * WORD TRAVELS FAST (owner, 2026-10-24; migration 0033): each story
 * progress row keeps the LATEST finished game's manner facts —
 * { won, margin, endReason } — so the route can know HOW a game went,
 * not just that it went. Recorded from the same clamped facts the
 * result post already validates; never backfilled, never invented:
 * a game posted without facts records the win alone, and history from
 * before the column existed reads null (no manner fact, no lines).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { handleStoryHttp } from '../src/story/routes';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';

async function user(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id.toLowerCase(), 1).run();
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(`${id}-tok`), id, 1, NOW + 10_000_000).run();
}
const call = (uid: string, path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  headers.set('cookie', `__Host-bwm_sid=${uid}-tok`);
  return handleStoryHttp(
    new Request(new URL(path, ORIGIN), { ...init, headers }),
    { DB: db, PUBLIC_ORIGIN: ORIGIN, ADMIN_USERNAMES: 'A' } as never,
    new URL(path, ORIGIN), path.split('?')[0]!.split('/').filter(Boolean), NOW,
  );
};
type StopRow = { stopId: string; state: string; attempts: number; clears: number; lastResult: { won: boolean; margin?: number; endReason?: string } | null };
const progress = async () => (await (await call('a', '/api/story/progress')).json()) as { stops: StopRow[]; currentStop: number | null };
const row = async (stopId: string) => (await progress()).stops.find((s) => s.stopId === stopId)!;

const FACTS = { margin: 190, handsPlayed: 7, setsAgainstUs: 0, setsAgainstThem: 1, ourNilsMade: 0, ourBlindNilsMade: 0, deeNilsMade: 0, deeSteady: true, setOnFirstHand: false, oppSetTwice: false, endReason: 'shotOut' };
const post = (stopId: string, won: boolean, gameId: string, facts?: unknown) =>
  call('a', '/api/story/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stopId, won, gameId, ...(facts !== undefined ? { facts } : {}) }) });

beforeEach(async () => {
  db = await makeD1();
  await user('a');
});

describe('story last result (migration 0033)', () => {
  it('no games yet: every stop’s lastResult is null — no manner fact exists', async () => {
    const p = await progress();
    for (const s of p.stops) expect(s.lastResult, s.stopId).toBeNull();
  });

  it('a win posted with facts records won + margin + endReason on the progress row', async () => {
    const r = await (await post('porch', true, 'g1', FACTS)).json() as { stops: StopRow[] };
    expect(r.stops.find((s) => s.stopId === 'porch')!.lastResult).toEqual({ won: true, margin: 190, endReason: 'shotOut' });
    expect((await row('porch')).lastResult).toEqual({ won: true, margin: 190, endReason: 'shotOut' });
    expect((await row('barbershop')).lastResult).toBeNull(); // only the played stop records
  });

  it('a win posted WITHOUT facts records the win alone — no margin, no manner', async () => {
    await post('porch', true, 'g1');
    expect((await row('porch')).lastResult).toEqual({ won: true });
  });

  it('the LATEST game wins the row: a replay loss overwrites a clear’s manner (the grind is the story now)', async () => {
    await post('porch', true, 'g1', FACTS);
    await post('porch', false, 'g2', { ...FACTS, margin: -120, endReason: 'target' });
    expect((await row('porch')).lastResult).toEqual({ won: false, margin: -120, endReason: 'target' });
    await post('porch', true, 'g3', { ...FACTS, margin: 40, endReason: 'target' });
    expect((await row('porch')).lastResult).toEqual({ won: true, margin: 40, endReason: 'target' });
  });

  it('posted facts are clamped to their honest ranges, and a bogus endReason is dropped', async () => {
    await post('porch', true, 'g1', { ...FACTS, margin: 99999, endReason: 'banana' });
    const lr = (await row('porch')).lastResult!;
    expect(lr.won).toBe(true);
    expect(lr.margin).toBe(2000);
    expect(lr.endReason).toBeUndefined();
  });

  it('a replayed (duplicate) post does not move the recorded result', async () => {
    await post('porch', true, 'g1', FACTS);
    await post('porch', true, 'g1', { ...FACTS, margin: 5, endReason: 'target' }); // same gameId — idempotent replay path
    expect((await row('porch')).lastResult).toEqual({ won: true, margin: 190, endReason: 'shotOut' });
  });
});
