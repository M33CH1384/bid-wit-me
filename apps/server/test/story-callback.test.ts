/** Story call-backs: session lifecycle (POST /api/story/session), the copy
 *  table, and the hourly sweep that lets an open table summon its player. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { handleStoryHttp } from '../src/story/routes';
import { handlePushHttp } from '../src/push/routes';
import {
  STORY_CALLBACK_LINES, openStorySession, runStoryCallbacks, storyCallbackCoverage, storyCallbackPayload,
} from '../src/story/callback';
import { b64uDecode, b64uEncode, type VapidKeys } from '../src/push/crypto';
import { STORY_CHARACTERS, STORY_STOPS } from '@spades/bots';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function user(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id.toLowerCase(), 1).run();
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(`${id}-tok`), id, 1, NOW + 100_000_000).run();
}
const call = (uid: string | null, path: string, now: number, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  if (uid) headers.set('cookie', `__Host-bwm_sid=${uid}-tok`);
  return handleStoryHttp(
    new Request(new URL(path, ORIGIN), { ...init, headers }),
    { DB: db, PUBLIC_ORIGIN: ORIGIN, ADMIN_USERNAMES: 'A,C' } as never,
    new URL(path, ORIGIN), path.split('?')[0]!.split('/').filter(Boolean), now,
  );
};
const session = (uid: string | null, body: unknown, now = NOW) =>
  call(uid, '/api/story/session', now, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const result = (uid: string, stopId: string, won: boolean, gameId: string, now = NOW) =>
  call(uid, '/api/story/result', now, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stopId, won, gameId }) });

interface SessionRow { stopId: string; openedAt: number; updatedAt: number; nudgesSent: number; lastNudgeAt: number | null; closedAt: number | null }
const sessionRow = (uid: string) =>
  db.prepare('SELECT stop_id AS stopId, opened_at AS openedAt, updated_at AS updatedAt, nudges_sent AS nudgesSent, last_nudge_at AS lastNudgeAt, closed_at AS closedAt FROM story_sessions WHERE user_id = ?')
    .bind(uid).first<SessionRow>();

/** A real (test) VAPID keypair + a deliverable subscription for the user. */
async function vapidKeys(): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(65);
  pub[0] = 4;
  pub.set(b64uDecode(jwk.x!), 1);
  pub.set(b64uDecode(jwk.y!), 33);
  return { publicKey: b64uEncode(pub), privateKey: jwk.d!, subject: 'mailto:test@example.com' };
}
async function subscribe(uid: string, endpoint = 'https://push.example.com/sub/1') {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = new Uint8Array(16);
  crypto.getRandomValues(auth);
  await db.prepare('INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, ua, created_at) VALUES (?, ?, ?, ?, NULL, ?)')
    .bind(endpoint, uid, b64uEncode(raw), b64uEncode(auth), NOW).run();
}
const okFetch = (capture: string[]) => (async (input: RequestInfo | URL) => {
  capture.push(String(input));
  return new Response(null, { status: 201 });
}) as typeof fetch;

beforeEach(async () => {
  db = await makeD1();
  await user('a');
  await user('b');
  await user('c');
});

describe('story session endpoint', () => {
  it('is owner-gated exactly like the other story endpoints (401 / 403, nothing written)', async () => {
    expect((await session(null, { state: 'open', stopId: 'porch' })).status).toBe(401);
    expect((await session('b', { state: 'open', stopId: 'porch' })).status).toBe(403);
    expect(await sessionRow('b')).toBeNull();
    expect((await session('a', { state: 'open', stopId: 'porch' })).status).toBe(200);
  });

  it('open creates a server-stamped session; a client savedAt is never trusted for aging', async () => {
    const r = await session('a', { state: 'open', stopId: 'porch', savedAt: NOW - 90 * DAY });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, state: 'open', stopId: 'porch' });
    const row = await sessionRow('a');
    expect(row).toMatchObject({ stopId: 'porch', openedAt: NOW, updatedAt: NOW, nudgesSent: 0, lastNudgeAt: null, closedAt: null });
  });

  it('a checkpoint ping for the same stop refreshes activity but keeps the sitting (and its nudge history)', async () => {
    await session('a', { state: 'open', stopId: 'porch' }, NOW);
    await db.prepare('UPDATE story_sessions SET nudges_sent = 1, last_nudge_at = ? WHERE user_id = ?').bind(NOW + HOUR, 'a').run();
    await session('a', { state: 'open', stopId: 'porch' }, NOW + 2 * HOUR);
    const row = await sessionRow('a');
    expect(row).toMatchObject({ openedAt: NOW, updatedAt: NOW + 2 * HOUR, nudgesSent: 1, lastNudgeAt: NOW + HOUR, closedAt: null });
  });

  it('opening a different stop starts a fresh session (new stamp, nudge budget reset)', async () => {
    await session('a', { state: 'open', stopId: 'porch' }, NOW);
    await db.prepare('UPDATE story_sessions SET nudges_sent = 2 WHERE user_id = ?').bind('a').run();
    // porch must be cleared before barbershop is reachable in real play; the
    // endpoint itself is not a progress write, so the ping is accepted as-is.
    await session('a', { state: 'open', stopId: 'barbershop' }, NOW + 3 * HOUR);
    const row = await sessionRow('a');
    expect(row).toMatchObject({ stopId: 'barbershop', openedAt: NOW + 3 * HOUR, updatedAt: NOW + 3 * HOUR, nudgesSent: 0, closedAt: null });
  });

  it('close stamps closed_at, is idempotent, and a later open starts fresh', async () => {
    await session('a', { state: 'open', stopId: 'porch' }, NOW);
    expect((await session('a', { state: 'closed' }, NOW + HOUR)).status).toBe(200);
    expect((await sessionRow('a'))?.closedAt).toBe(NOW + HOUR);
    expect((await session('a', { state: 'closed' }, NOW + 2 * HOUR)).status).toBe(200);
    expect((await sessionRow('a'))?.closedAt).toBe(NOW + HOUR); // unchanged
    await session('a', { state: 'open', stopId: 'porch' }, NOW + 3 * HOUR);
    expect(await sessionRow('a')).toMatchObject({ openedAt: NOW + 3 * HOUR, closedAt: null, nudgesSent: 0 });
  });

  it('rejects malformed pings', async () => {
    expect((await session('a', { state: 'banana' })).status).toBe(400);
    expect((await session('a', { state: 'open' })).status).toBe(400);
    expect((await session('a', { state: 'open', stopId: 'nowhere' })).status).toBe(400);
    expect((await session('a', { state: 'open', stopId: 'porch', track: 'pair:x:y' })).status).toBe(400);
    expect(await sessionRow('a')).toBeNull();
  });

  it('a recorded result closes the session — and so does a replayed one', async () => {
    await session('a', { state: 'open', stopId: 'porch' }, NOW);
    expect((await result('a', 'porch', true, 'cb-g1')).status).toBe(200);
    expect((await sessionRow('a'))?.closedAt).toBe(NOW);
    await session('a', { state: 'open', stopId: 'porch' }, NOW + HOUR);
    expect((await sessionRow('a'))?.closedAt).toBeNull();
    expect((await result('a', 'porch', true, 'cb-g1', NOW + 2 * HOUR)).status).toBe(200); // idempotent replay
    expect((await sessionRow('a'))?.closedAt).toBe(NOW + 2 * HOUR);
  });
});

describe('call-back copy', () => {
  it('covers every stop on the route, twice each, all attributed to real cast members', () => {
    expect(storyCallbackCoverage()).toEqual([]);
    expect(Object.keys(STORY_CALLBACK_LINES).sort()).toEqual(STORY_STOPS.map((s) => s.id).sort());
    for (const stop of Object.values(STORY_CALLBACK_LINES)) {
      for (const line of [stop.first, stop.last]) {
        expect(STORY_CHARACTERS[line.fromId], `speaker ${line.fromId}`).toBeTruthy();
        expect(line.body.length).toBeGreaterThan(20);
      }
    }
  });

  it('never reuses a line across stops, and Dee carries exactly the Porch and Pj\u2019s last calls', () => {
    const bodies = Object.values(STORY_CALLBACK_LINES).flatMap((s) => [s.first.body, s.last.body]);
    expect(bodies.length).toBe(22);
    expect(new Set(bodies).size).toBe(22);
    const deeLasts = Object.entries(STORY_CALLBACK_LINES).filter(([, s]) => s.last.fromId === 'dee').map(([id]) => id).sort();
    expect(deeLasts).toEqual(['porch', 'the-pjs']);
  });

  it('builds lock-screen payloads: "Name · Place" title, the line, and the /story deep link', () => {
    expect(storyCallbackPayload('porch', 1)).toMatchObject({
      title: 'Uncle Ray \u00B7 The Porch', url: '/story', tag: 'story-callback-porch', type: 'story_callback',
    });
    expect(storyCallbackPayload('porch', 2)?.title).toBe('Dee \u00B7 The Porch');
    expect(storyCallbackPayload('king', 1)?.title).toBe("The King \u00B7 The King's Table");
    expect(storyCallbackPayload('nowhere', 1)).toBeNull();
  });

  it('keeps the profanity budget: the owner\u2019s phrase appears once, cleaned, at the Porch \u2014 never at Church', () => {
    const all = Object.values(STORY_CALLBACK_LINES).flatMap((s) => [s.first.body, s.last.body]).join('\n');
    expect(all.match(/ass-whooping/g)?.length).toBe(1);
    const church = STORY_CALLBACK_LINES['church-basement']!;
    expect(church.first.body + church.last.body).not.toMatch(/ass|damn|hell/i);
  });
});

describe('push prefs: the new type', () => {
  const pushCall = (uid: string, path: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('cookie', `__Host-bwm_sid=${uid}-tok`);
    return handlePushHttp(
      new Request(new URL(path, ORIGIN), { ...init, headers }),
      { DB: db, PUBLIC_ORIGIN: ORIGIN } as never,
      new URL(path, ORIGIN), path.split('/').filter(Boolean), NOW,
    );
  };

  it('defaults on and toggles like every other type', async () => {
    const before = (await (await pushCall('a', '/api/push/prefs')).json()) as { prefs: Record<string, boolean> };
    expect(before.prefs.story_callback).toBe(true);
    const put = await pushCall('a', '/api/push/prefs', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'story_callback', enabled: false }),
    });
    expect(put.status).toBe(200);
    const after = (await (await pushCall('a', '/api/push/prefs')).json()) as { prefs: Record<string, boolean> };
    expect(after.prefs.story_callback).toBe(false);
  });
});

describe('the call-back sweep', () => {
  let vapid: VapidKeys;
  beforeEach(async () => { vapid = await vapidKeys(); });

  const seed = (uid: string, over: Partial<{ stopId: string; openedAt: number; updatedAt: number; nudgesSent: number; closedAt: number | null }>) =>
    openStorySession(db, uid, 'solo', over.stopId ?? 'porch', over.openedAt ?? NOW).then(async () => {
      await db.prepare('UPDATE story_sessions SET opened_at = ?, updated_at = ?, nudges_sent = ?, closed_at = ? WHERE user_id = ?')
        .bind(over.openedAt ?? NOW, over.updatedAt ?? NOW, over.nudgesSent ?? 0, over.closedAt ?? null, uid).run();
    });

  it('stays silent while the player is only recently away', async () => {
    await subscribe('a');
    await seed('a', { updatedAt: NOW - 4 * HOUR });
    const sent: string[] = [];
    expect(await runStoryCallbacks(db, vapid, NOW, okFetch(sent))).toEqual({ first: 0, last: 0 });
    expect(sent).toEqual([]);
    expect((await sessionRow('a'))?.nudgesSent).toBe(0);
  });

  it('first call at ~5h away: one push to the subscribed device, budget spent to 1', async () => {
    await subscribe('a');
    await seed('a', { updatedAt: NOW - 5 * HOUR });
    const sent: string[] = [];
    expect(await runStoryCallbacks(db, vapid, NOW, okFetch(sent))).toEqual({ first: 1, last: 0 });
    expect(sent).toEqual(['https://push.example.com/sub/1']);
    expect(await sessionRow('a')).toMatchObject({ nudgesSent: 1, lastNudgeAt: NOW });
    // an hour later the table does NOT call again — the last call waits for 24h away
    expect(await runStoryCallbacks(db, vapid, NOW + HOUR, okFetch(sent))).toEqual({ first: 0, last: 0 });
    expect(sent.length).toBe(1);
  });

  it('last call at ~24h away, then silence forever', async () => {
    await subscribe('a');
    await seed('a', { updatedAt: NOW - 24 * HOUR, nudgesSent: 1 });
    const sent: string[] = [];
    expect(await runStoryCallbacks(db, vapid, NOW, okFetch(sent))).toEqual({ first: 0, last: 1 });
    expect((await sessionRow('a'))?.nudgesSent).toBe(2);
    expect(await runStoryCallbacks(db, vapid, NOW + 7 * DAY, okFetch(sent))).toEqual({ first: 0, last: 0 });
    expect(sent.length).toBe(1);
  });

  it('never calls for a closed session', async () => {
    await subscribe('a');
    await seed('a', { updatedAt: NOW - 30 * HOUR, closedAt: NOW - HOUR });
    const sent: string[] = [];
    expect(await runStoryCallbacks(db, vapid, NOW, okFetch(sent))).toEqual({ first: 0, last: 0 });
    expect(sent).toEqual([]);
  });

  it('sessions expire after 7 days: no first call for a week-old table', async () => {
    await subscribe('a');
    await seed('a', { openedAt: NOW - 8 * DAY, updatedAt: NOW - 6 * HOUR });
    const sent: string[] = [];
    expect(await runStoryCallbacks(db, vapid, NOW, okFetch(sent))).toEqual({ first: 0, last: 0 });
    expect((await sessionRow('a'))?.nudgesSent).toBe(0);
  });

  it('toggle off: nothing is sent and the nudge budget is NOT spent — the call stays pending', async () => {
    await subscribe('a');
    await db.prepare('INSERT INTO push_prefs (user_id, type, enabled) VALUES (?, ?, 0)').bind('a', 'story_callback').run();
    await seed('a', { updatedAt: NOW - 6 * HOUR });
    const sent: string[] = [];
    expect(await runStoryCallbacks(db, vapid, NOW, okFetch(sent))).toEqual({ first: 0, last: 0 });
    expect(sent).toEqual([]);
    expect((await sessionRow('a'))?.nudgesSent).toBe(0);
    // toggled back on → the pending call goes out on the next sweep
    await db.prepare('DELETE FROM push_prefs WHERE user_id = ? AND type = ?').bind('a', 'story_callback').run();
    expect(await runStoryCallbacks(db, vapid, NOW, okFetch(sent))).toEqual({ first: 1, last: 0 });
  });

  it('no subscription: nothing sent, budget unspent', async () => {
    await seed('c', { updatedAt: NOW - 6 * HOUR });
    const sent: string[] = [];
    expect(await runStoryCallbacks(db, vapid, NOW, okFetch(sent))).toEqual({ first: 0, last: 0 });
    expect((await sessionRow('c'))?.nudgesSent).toBe(0);
  });

  it('a dead subscription is pruned by the push layer and the nudge stays unspent', async () => {
    await subscribe('a');
    await seed('a', { updatedAt: NOW - 6 * HOUR });
    const goneFetch = (async () => new Response(null, { status: 410 })) as typeof fetch;
    expect(await runStoryCallbacks(db, vapid, NOW, goneFetch)).toEqual({ first: 0, last: 0 });
    const subs = await db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').bind('a').first<{ n: number }>();
    expect(subs?.n).toBe(0);
    expect((await sessionRow('a'))?.nudgesSent).toBe(0);
  });
});
