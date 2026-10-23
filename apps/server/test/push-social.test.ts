/**
 * DM + mention push helpers (notifyDm / notifyMention): cooldown keys,
 * mute suppression (migration 0030), per-type pref opt-out, and the new
 * NotifTypes. Sends are observed through a stubbed global fetch (the
 * payload itself is encrypted end-to-end, so delivery + the cooldown rows
 * are what can be asserted).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyDm, notifyMention } from '../src/push/notify';
import { allPrefs, NOTIF_LABELS, NOTIF_TYPES } from '../src/push/send';
import type { VapidKeys } from '../src/push/crypto';
import { makeD1 } from './d1';

const NOW = 1_800_000_000_000;
let db: D1Database;

const b64uEncode = (b: Uint8Array) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64uDecode = (s: string) => new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

async function vapidKeys(): Promise<VapidKeys> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const pub = new Uint8Array(65);
  pub[0] = 4;
  pub.set(b64uDecode(jwk.x!), 1);
  pub.set(b64uDecode(jwk.y!), 33);
  return { publicKey: b64uEncode(pub), privateKey: jwk.d!, subject: 'mailto:test@example.com' };
}

async function subscribe(uid: string) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = new Uint8Array(16);
  crypto.getRandomValues(auth);
  await db.prepare('INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, ua, created_at) VALUES (?, ?, ?, ?, NULL, ?)')
    .bind(`https://push.example.com/${uid}`, uid, b64uEncode(raw), b64uEncode(auth), NOW).run();
}

let fetches: string[];
let vapid: VapidKeys;

beforeEach(async () => {
  db = await makeD1();
  fetches = [];
  vapid = await vapidKeys();
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
    fetches.push(String(input));
    return new Response(null, { status: 201 });
  }) as typeof fetch);
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind('ua', 'Alice', 'alice', NOW).run();
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind('ub', 'Bobby', 'bobby', NOW).run();
  await subscribe('ub');
});
afterEach(() => vi.unstubAllGlobals());

const cooldownRow = (kind: string) => db.prepare('SELECT key, last_sent FROM push_cooldowns WHERE user_id = ? AND kind = ?').bind('ub', kind).first<{ key: string; last_sent: number }>();

describe('notification types', () => {
  it('dm = "Messages" and mention = "Mentions", both default ON', async () => {
    expect(NOTIF_TYPES).toContain('dm');
    expect(NOTIF_TYPES).toContain('mention');
    expect(NOTIF_LABELS.dm).toBe('Messages');
    expect(NOTIF_LABELS.mention).toBe('Mentions');
    const prefs = await allPrefs(db, 'ub');
    expect(prefs.dm).toBe(true);
    expect(prefs.mention).toBe(true);
  });
});

describe('notifyDm', () => {
  it('delivers, then the 10-minute per-sender cooldown swallows repeats (key = sender uid)', async () => {
    expect(await notifyDm(db, vapid, 'ub', 'ua', 'Alice', 'hey Bobby', NOW)).toBe(1);
    expect(fetches).toEqual(['https://push.example.com/ub']);
    expect(await cooldownRow('dm')).toEqual({ key: 'ua', last_sent: NOW });
    expect(await notifyDm(db, vapid, 'ub', 'ua', 'Alice', 'again', NOW + 60_000)).toBe(0);
    expect(fetches).toHaveLength(1);
    // a different sender has her own cooldown bucket
    expect(await notifyDm(db, vapid, 'ub', 'uc', 'Cee', 'yo', NOW + 60_000)).toBe(1);
    // after the window it sends again
    expect(await notifyDm(db, vapid, 'ub', 'ua', 'Alice', 'later', NOW + 10 * 60_000 + 1)).toBe(1);
    expect(fetches).toHaveLength(3);
  });

  it('a muted sender never pushes (the DM itself still lands in the thread — hub-side)', async () => {
    await db.prepare('INSERT INTO mutes (muter, muted, created_at) VALUES (?, ?, ?)').bind('ub', 'ua', NOW).run();
    expect(await notifyDm(db, vapid, 'ub', 'ua', 'Alice', 'psst', NOW)).toBe(0);
    expect(fetches).toEqual([]);
    expect(await cooldownRow('dm')).toBeNull(); // suppression happens before the cooldown is even spent
  });

  it('the per-type opt-out (Messages off) silences it', async () => {
    await db.prepare('INSERT INTO push_prefs (user_id, type, enabled) VALUES (?, ?, 0)').bind('ub', 'dm').run();
    expect(await notifyDm(db, vapid, 'ub', 'ua', 'Alice', 'hey', NOW)).toBe(0);
    expect(fetches).toEqual([]);
  });
});

describe('notifyMention', () => {
  it('delivers with a 5-minute per-author cooldown (key = author pid)', async () => {
    expect(await notifyMention(db, vapid, 'ub', 'ua', 'Alice', '@Bobby gg', '/social', NOW)).toBe(1);
    expect(await cooldownRow('mention')).toEqual({ key: 'u:ua', last_sent: NOW });
    expect(await notifyMention(db, vapid, 'ub', 'ua', 'Alice', '@Bobby again', '/t/ABCD', NOW + 60_000)).toBe(0);
    expect(fetches).toHaveLength(1);
    expect(await notifyMention(db, vapid, 'ub', 'ua', 'Alice', '@Bobby later', '/social', NOW + 5 * 60_000 + 1)).toBe(1);
    expect(fetches).toHaveLength(2);
  });

  it('a muted author never pushes; the Mentions opt-out silences it too', async () => {
    await db.prepare('INSERT INTO mutes (muter, muted, created_at) VALUES (?, ?, ?)').bind('ub', 'ua', NOW).run();
    expect(await notifyMention(db, vapid, 'ub', 'ua', 'Alice', '@Bobby gg', '/social', NOW)).toBe(0);
    await db.prepare('DELETE FROM mutes WHERE muter = ? AND muted = ?').bind('ub', 'ua').run();
    await db.prepare('INSERT INTO push_prefs (user_id, type, enabled) VALUES (?, ?, 0)').bind('ub', 'mention').run();
    expect(await notifyMention(db, vapid, 'ub', 'ua', 'Alice', '@Bobby gg', '/social', NOW)).toBe(0);
    expect(fetches).toEqual([]);
  });
});
