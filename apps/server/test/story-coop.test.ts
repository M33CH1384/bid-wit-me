/**
 * Story co-op Phase 1 (spec §3): pair tracks live on the story HTTP surface —
 * witnessed equal credit (both post orders), idempotency, membership gates,
 * sequential unlock on the pair track, the King double on pair tracks, the
 * two-copies rule, the tracks list, room creation/join, and pair-context
 * privacy. Witness rows are inserted directly, exactly as the Room's
 * storyResult hook writes them (the room half is pinned in story-room.test.ts).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { handleStoryHttp, personalHistoryFor } from '../src/story/routes';
import { STORY_STOPS, storyPairTrackKey } from '@spades/bots';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';
const TRACK_AC = storyPairTrackKey('a', 'c'); // 'pair:a:c'
const TRACK_AD = storyPairTrackKey('a', 'd'); // 'pair:a:d'

async function user(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id.toLowerCase(), 1).run();
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(`${id}-tok`), id, 1, NOW + 10_000_000).run();
}

/** A TABLES namespace stub: story-setup always allocates; members/bind read a fixture room. */
function tablesStub(fixture: { hostUid: string; partnerUid: string | null; stopId: string }) {
  return {
    idFromName: (name: string) => name,
    get: (_id: unknown) => ({
      fetch: async (url: string, init?: RequestInit) => {
        if (url.includes('/story-setup')) return new Response('created', { status: 201 });
        if (url.includes('/story-members')) {
          return Response.json({ hostUid: fixture.hostUid, partnerUid: fixture.partnerUid, stopId: fixture.stopId, track: fixture.partnerUid ? storyPairTrackKey(fixture.hostUid, fixture.partnerUid) : null });
        }
        if (url.includes('/story-bind')) {
          const b = JSON.parse(String(init?.body ?? '{}')) as { uid: string };
          if (fixture.partnerUid && fixture.partnerUid !== b.uid) return Response.json({ error: 'spoken for' }, { status: 409 });
          fixture.partnerUid = b.uid;
          return Response.json({ ok: true, track: storyPairTrackKey(fixture.hostUid, b.uid), stopId: fixture.stopId });
        }
        return new Response('not found', { status: 404 });
      },
    }),
  };
}

const call = (uid: string | null, path: string, init?: RequestInit, tables?: unknown) => {
  const headers = new Headers(init?.headers);
  if (uid) headers.set('cookie', `__Host-bwm_sid=${uid}-tok`);
  return handleStoryHttp(
    new Request(new URL(path, ORIGIN), { ...init, headers }),
    // 'a', 'c', 'd' hold story access (admin-class here); 'b' does not.
    { DB: db, PUBLIC_ORIGIN: ORIGIN, ADMIN_USERNAMES: 'A,C,D', ...(tables ? { TABLES: tables } : {}) } as never,
    new URL(path, ORIGIN), path.split('?')[0]!.split('/').filter(Boolean), NOW,
  );
};
const post = (uid: string, path: string, body: unknown, tables?: unknown) =>
  call(uid, path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, tables);

const pairResult = (uid: string, track: string, stopId: string, won: boolean, gameId: string) =>
  post(uid, '/api/story/result', { track, stopId, won, gameId });

async function witness(gameId: string, track: string, stopId: string, uidA: string, uidB: string, won: boolean, facts: unknown = null) {
  const [a, b] = [uidA, uidB].sort();
  await db.prepare(`INSERT INTO story_room_results (game_id, room_code, track_key, stop_id, uid_a, uid_b, won, facts_json, created_at)
    VALUES (?, 'ROOM1', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(gameId, track, stopId, a, b, won ? 1 : 0, facts ? JSON.stringify(facts) : null, NOW).run();
}

const progress = async (uid: string, track: string) =>
  (await (await call(uid, `/api/story/progress?track=${encodeURIComponent(track)}`)).json()) as {
    stops: { stopId: string; state: string; attempts: number; clears: number; doublePending?: boolean }[];
    currentStop: number | null; completed: boolean; completionMark: string | null;
    finds: { eggs: string[]; feats: string[] };
  };
const xpOf = async (uid: string) => (await db.prepare('SELECT xp FROM xp_state WHERE user_id = ?').bind(uid).first<{ xp: number }>())?.xp ?? 0;
const coinsOf = async (uid: string) => (await db.prepare('SELECT balance FROM coin_balances WHERE user_id = ?').bind(uid).first<{ balance: number }>())?.balance ?? 0;

/** Seed a pair track with stops 1..10 cleared under BOTH members' copies (a finished route up to the King). */
async function seedPairToKing(track: string, uidA: string, uidB: string) {
  for (const uid of [uidA, uidB]) {
    for (const s of STORY_STOPS.slice(0, 10)) {
      await db.prepare('INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, first_cleared_at, last_played_at) VALUES (?, ?, ?, 1, 1, ?, ?)')
        .bind(uid, track, s.id, NOW, NOW).run();
    }
    await db.prepare('INSERT INTO story_tracks (user_id, track_key, completed_at, updated_at) VALUES (?, ?, NULL, ?)').bind(uid, track, NOW).run();
  }
}

beforeEach(async () => {
  db = await makeD1();
  await user('a');
  await user('b');
  await user('c');
  await user('d');
});

describe('pair result crediting (witnessed, equal, idempotent)', () => {
  it('credits both posters equally — first poster applies both copies; second post replays', async () => {
    await witness('g1', TRACK_AC, 'porch', 'a', 'c', true);
    // the body lies about the outcome (won: false) — the witness rules
    const r1 = await (await pairResult('a', TRACK_AC, 'porch', false, 'g1')).json() as { won: boolean; firstClear: boolean; rewards: { xp: number; coins: number } };
    expect(r1.won).toBe(true);
    expect(r1.firstClear).toBe(true);
    expect(r1.rewards).toEqual({ xp: 25, coins: 20 }); // stop 1 first clear, solo rates
    // two-copies: c's stored copy already shows the clear before c ever posts
    const pc = await progress('c', TRACK_AC);
    expect(pc.stops[0]).toMatchObject({ stopId: 'porch', clears: 1, attempts: 1 });
    expect(await xpOf('c')).toBe(25);
    expect(await coinsOf('c')).toBe(20);
    // c posts: replayed, same rewards, no double credit
    const r2res = await pairResult('c', TRACK_AC, 'porch', true, 'g1');
    const r2 = await r2res.json() as { replayed: boolean; rewards: { xp: number; coins: number } };
    expect(r2.replayed).toBe(true);
    expect(r2.rewards).toEqual({ xp: 25, coins: 20 });
    expect(await xpOf('a')).toBe(25);
    expect(await xpOf('c')).toBe(25);
    expect(await coinsOf('a')).toBe(20);
    expect(await coinsOf('c')).toBe(20);
    const pa = await progress('a', TRACK_AC);
    expect(pa.stops[0]!.attempts).toBe(1); // the attempt counted once per copy, not per post
    // §3.6: the two copies are identical at every step
    expect(pa.stops).toEqual(pc.stops);
    expect(pa.finds).toEqual(pc.finds);
  });

  it('works in the other post order too', async () => {
    await witness('g1', TRACK_AC, 'porch', 'a', 'c', false);
    const r1 = await (await pairResult('c', TRACK_AC, 'porch', false, 'g1')).json() as { won: boolean; rewards: { xp: number; coins: number } };
    expect(r1.won).toBe(false);
    expect(r1.rewards).toEqual({ xp: 5, coins: 0 }); // the loss consolation, each
    const r2 = await (await pairResult('a', TRACK_AC, 'porch', false, 'g1')).json() as { replayed: boolean; rewards: { xp: number; coins: number } };
    expect(r2.replayed).toBe(true);
    expect(r2.rewards).toEqual({ xp: 5, coins: 0 });
    expect(await xpOf('a')).toBe(5);
    expect(await xpOf('c')).toBe(5);
    const pa = await progress('a', TRACK_AC);
    const pc = await progress('c', TRACK_AC);
    expect(pa.stops).toEqual(pc.stops);
    expect(pa.stops[0]).toMatchObject({ attempts: 1, clears: 0, state: 'current' });
  });

  it('rejects an unwitnessed pair post and credits nothing', async () => {
    const r = await pairResult('a', TRACK_AC, 'porch', true, 'ghost-game');
    expect(r.status).toBe(409);
    expect(await xpOf('a')).toBe(0);
    const p = await progress('a', TRACK_AC);
    expect(p.stops[0]!.attempts).toBe(0);
  });

  it('rejects a witness that names a different pair or stop', async () => {
    await witness('g1', TRACK_AD, 'porch', 'a', 'd', true);
    const r = await pairResult('a', TRACK_AC, 'porch', true, 'g1');
    expect(r.status).toBe(409);
    await witness('g2', TRACK_AC, 'barbershop', 'a', 'c', true);
    const r2 = await pairResult('a', TRACK_AC, 'porch', true, 'g2');
    expect(r2.status).toBe(409);
  });

  it('non-members cannot post to or read a pair track; players without story access cannot post at all', async () => {
    await witness('g1', TRACK_AC, 'porch', 'a', 'c', true);
    expect((await pairResult('d', TRACK_AC, 'porch', true, 'g1')).status).toBe(403);
    expect((await call('d', `/api/story/progress?track=${encodeURIComponent(TRACK_AC)}`)).status).toBe(403);
    expect((await pairResult('b', TRACK_AC, 'porch', true, 'g1')).status).toBe(403); // the story lock itself
  });

  it('a locked stop on the pair track cannot be recorded even with a witness', async () => {
    await witness('g1', TRACK_AC, 'barbershop', 'a', 'c', true);
    const r = await pairResult('a', TRACK_AC, 'barbershop', true, 'g1');
    expect(r.status).toBe(409);
    expect(await xpOf('a')).toBe(0);
    expect(await xpOf('c')).toBe(0);
  });
});

describe('the King double on a pair track (partnership legs, as solo)', () => {
  it('started → cleared pays the double to both and completes the pair track', async () => {
    await seedPairToKing(TRACK_AC, 'a', 'c');
    await witness('k1', TRACK_AC, 'king', 'a', 'c', true);
    const leg1 = await (await pairResult('a', TRACK_AC, 'king', true, 'k1')).json() as { doubleOutcome: string | null; rewards: { xp: number; coins: number } };
    expect(leg1.doubleOutcome).toBe('started');
    expect(leg1.rewards).toEqual({ xp: 0, coins: 0 });
    const mid = await progress('c', TRACK_AC);
    expect(mid.stops.find((s) => s.stopId === 'king')!.doublePending).toBe(true);
    expect(mid.completed).toBe(false);
    await witness('k2', TRACK_AC, 'king', 'a', 'c', true);
    const leg2 = await (await pairResult('c', TRACK_AC, 'king', true, 'k2')).json() as { doubleOutcome: string | null; firstClear: boolean; rewards: { xp: number; coins: number } };
    expect(leg2.doubleOutcome).toBe('cleared');
    expect(leg2.firstClear).toBe(true);
    expect(leg2.rewards).toEqual({ xp: 550, coins: 440 }); // storyClearReward: double the King first clear
    expect(await xpOf('a')).toBe(550);
    expect(await xpOf('c')).toBe(550);
    expect(await coinsOf('a')).toBe(440);
    const done = await progress('a', TRACK_AC);
    expect(done.completed).toBe(true);
    expect(done.completionMark).toBe('story-pair-complete');
    expect((await progress('c', TRACK_AC)).stops).toEqual(done.stops);
  });

  it('a leg-2 loss voids both legs and pays only the consolation', async () => {
    await seedPairToKing(TRACK_AD, 'a', 'd');
    await witness('k1', TRACK_AD, 'king', 'a', 'd', true);
    await pairResult('a', TRACK_AD, 'king', true, 'k1');
    await witness('k2', TRACK_AD, 'king', 'a', 'd', false);
    const lost = await (await pairResult('d', TRACK_AD, 'king', false, 'k2')).json() as { doubleOutcome: string | null; rewards: { xp: number; coins: number } };
    expect(lost.doubleOutcome).toBe('lost');
    expect(lost.rewards).toEqual({ xp: 5, coins: 0 });
    const p = await progress('a', TRACK_AD);
    const king = p.stops.find((s) => s.stopId === 'king')!;
    expect(king.doublePending).toBe(false);
    expect(king.clears).toBe(0);
    expect(p.currentStop).toBe(11);
    expect(await xpOf('d')).toBe(5);
  });
});

describe('pair surfaces', () => {
  it('tracks list: solo summary + pair rows with partner handle and current stop', async () => {
    await witness('g1', TRACK_AC, 'porch', 'a', 'c', true);
    await pairResult('a', TRACK_AC, 'porch', true, 'g1');
    const t = await (await call('c', '/api/story/tracks')).json() as {
      solo: { currentStop: number | null; completed: boolean };
      pairs: { track: string; partnerUid: string; partnerHandle: string | null; currentStop: number | null }[];
    };
    expect(t.solo.currentStop).toBe(1);
    expect(t.pairs.length).toBe(1);
    expect(t.pairs[0]).toMatchObject({ track: TRACK_AC, partnerUid: 'a', partnerHandle: 'A', currentStop: 2 });
    const td = await (await call('d', '/api/story/tracks')).json() as { pairs: unknown[] };
    expect(td.pairs.length).toBe(0); // d has no run with anyone
  });

  it('found and session posts accept pair tracks for members only', async () => {
    const eggId = 'porch-radio'; // the Porch scene-tap egg
    const r = await post('a', '/api/story/found', { track: TRACK_AC, eggId });
    expect(r.status).toBe(200);
    const p = await progress('a', TRACK_AC);
    expect(p.finds.eggs).toContain(eggId);
    // per-poster (§3.5): the partner's copy does NOT have it until they post their own
    const pc = await progress('c', TRACK_AC);
    expect(pc.finds.eggs).not.toContain(eggId);
    // a non-member's find on the pair track is rejected at the track gate
    expect((await post('d', '/api/story/found', { track: TRACK_AC, eggId })).status).toBe(400);
    const s = await post('c', '/api/story/session', { track: TRACK_AC, state: 'open', stopId: 'porch' });
    expect(s.status).toBe(200);
  });

  it('personalHistoryFor reads across all of a player\u2019s own tracks only', async () => {
    await db.prepare('INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, first_cleared_at, last_played_at) VALUES (?, ?, ?, 2, 1, ?, ?)')
      .bind('a', 'solo', 'porch', NOW, NOW).run();
    await db.prepare('INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, first_cleared_at, last_played_at) VALUES (?, ?, ?, 1, 0, NULL, ?)')
      .bind('a', TRACK_AD, 'porch', NOW).run();
    const h = await personalHistoryFor(db, 'a', 'porch');
    expect(h).toEqual({ knowsStop: true, clearedStop: true, clearedStops: 1 });
    const none = await personalHistoryFor(db, 'c', 'porch');
    expect(none).toEqual({ knowsStop: false, clearedStop: false, clearedStops: 0 });
  });
});

describe('room creation + share-code join + pair-context', () => {
  it('creates a room for an access-holding partner at a pair-unlocked stop', async () => {
    const tables = tablesStub({ hostUid: 'a', partnerUid: null, stopId: 'porch' });
    const r = await post('a', '/api/story/room', { stopId: 'porch', partnerUid: 'c' }, tables);
    expect(r.status).toBe(201);
    const body = await r.json() as { code: string; track: string };
    expect(body.track).toBe(TRACK_AC);
    expect(body.code.length).toBeGreaterThan(0);
  });

  it('refuses a partner without story access and a stop the pair has not unlocked', async () => {
    const tables = tablesStub({ hostUid: 'a', partnerUid: null, stopId: 'porch' });
    expect((await post('a', '/api/story/room', { stopId: 'porch', partnerUid: 'b' }, tables)).status).toBe(403);
    expect((await post('a', '/api/story/room', { stopId: 'barbershop', partnerUid: 'c' }, tables)).status).toBe(409);
  });

  it('share-code join binds the second account; a third is spoken for', async () => {
    const fixture = { hostUid: 'a', partnerUid: null as string | null, stopId: 'porch' };
    const tables = tablesStub(fixture);
    const joined = await post('c', '/api/story/room-join', { code: 'ABCDE' }, tables);
    expect(joined.status).toBe(200);
    expect(((await joined.json()) as { track: string }).track).toBe(TRACK_AC);
    expect((await post('d', '/api/story/room-join', { code: 'ABCDE' }, tables)).status).toBe(409);
  });

  it('pair-context returns exactly the sanitized block (handle + booleans + count; pair facts)', async () => {
    const fixture = { hostUid: 'a', partnerUid: 'c' as string | null, stopId: 'porch' };
    const tables = tablesStub(fixture);
    // a has personally cleared the Porch solo; the pair has one attempt together
    await db.prepare('INSERT INTO story_progress (user_id, track_key, stop_id, attempts, clears, first_cleared_at, last_played_at) VALUES (?, ?, ?, 1, 1, ?, ?)')
      .bind('a', 'solo', 'porch', NOW, NOW).run();
    await witness('g1', TRACK_AC, 'porch', 'a', 'c', false);
    await pairResult('a', TRACK_AC, 'porch', false, 'g1');
    const r = await post('c', '/api/story/pair-context', { code: 'ABCDE', stopId: 'porch' }, tables);
    expect(r.status).toBe(200);
    const body = await r.json() as { players: { handle: string; knowsStop: boolean; clearedStop: boolean; clearedStops: number }[]; pair: { attempts: number; clears: number; doublePending: boolean } };
    expect(body.players.length).toBe(2);
    const byHandle = Object.fromEntries(body.players.map((p) => [p.handle, p]));
    expect(byHandle['A']).toMatchObject({ knowsStop: true, clearedStop: true, clearedStops: 1 });
    expect(byHandle['C']).toMatchObject({ knowsStop: true, clearedStop: false, clearedStops: 0 }); // the pair attempt counts as knowing
    expect(body.pair).toEqual({ attempts: 1, clears: 0, doublePending: false });
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('pair:'); // no track keys cross the wire
    expect(raw).not.toContain('solo');
    // a non-member gets nothing
    expect((await post('d', '/api/story/pair-context', { code: 'ABCDE', stopId: 'porch' }, tables)).status).toBe(403);
  });
});
