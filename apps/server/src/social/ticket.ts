/**
 * Short-lived signed "account tickets": the same-origin site (which has the session cookie) mints one, and the
 * cross-origin websockets (Social hub, tables on workers.dev) accept it as proof of who you are.
 * HMAC-SHA256 with a random server key generated on first use and kept in D1 (kv table), so every Worker
 * isolate and Durable Object verifies the same way without a configured secret.
 */
import { b64url, fromB64url } from '../auth/providers';

export const TICKET_TTL_MS = 5 * 60_000;
export interface Ticket { uid: string; name: string; exp: number }

let cached: { db: D1Database; key: CryptoKey } | null = null;

async function key(db: D1Database): Promise<CryptoKey> {
  if (cached && cached.db === db) return cached.key;
  let row = await db.prepare("SELECT v FROM kv WHERE k = 'ticket_key'").first<{ v: string }>();
  if (!row) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    await db.prepare("INSERT OR IGNORE INTO kv (k, v) VALUES ('ticket_key', ?)").bind(b64url(raw)).run();
    row = await db.prepare("SELECT v FROM kv WHERE k = 'ticket_key'").first<{ v: string }>();
  }
  const k = await crypto.subtle.importKey('raw', fromB64url(row!.v), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  cached = { db, key: k };
  return k;
}

const enc = new TextEncoder();

export async function signTicket(db: D1Database, t: Ticket): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify({ u: t.uid, n: t.name, e: t.exp })));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await key(db), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

export async function verifyTicket(db: D1Database | undefined, s: string | null | undefined, now: number): Promise<Ticket | null> {
  if (!db || !s || s.length > 400) return null;
  const [body, sig] = s.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(db), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const j = JSON.parse(new TextDecoder().decode(fromB64url(body))) as { u: string; n: string; e: number };
    if (typeof j.u !== 'string' || typeof j.n !== 'string' || typeof j.e !== 'number' || j.e < now) return null;
    return { uid: j.u, name: j.n, exp: j.e };
  } catch { return null; }
}

/** test hook: forget the cached key (a fresh in-memory DB per test) */
export function resetTicketKey(): void { cached = null; }
