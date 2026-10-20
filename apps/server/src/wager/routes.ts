/** Big Bank Take Lil Bank (Phase 1): /api/wager-challenges — create, list mine, detail + actions (the challenge's Durable Object).
 * (Not /api/challenges — that path already belongs to the daily/weekly cred challenges.)
 * Ships dark: while the wager_challenges_enabled flag is off, creates 404 and lists read empty. */
import { makeRules, type TableRules } from '@spades/rules';
import { type AuthEnv, currentUser } from '../auth/routes';
import { type SocialEnv, isAdmin } from '../social/routes';
import { isWagerAmount, wagerEnabled, wagerHorizonMs } from '../cred/wager';
import { CHECKIN_MS, type WCreate, type WPerson } from './service';
import type { WOp } from './do';

export interface WagerEnv extends AuthEnv, SocialEnv { TEST_HOOKS?: string }
type Call = (id: string, op: WOp) => Promise<Response>;

const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { 'cache-control': 'no-store' } });

export const TIMER_PRESETS = {
  chill: { bid: 45, play: 45 },
  normal: { bid: 30, play: 30 },
  fast: { bid: 20, play: 20 },
} as const;
export type TimerPreset = keyof typeof TIMER_PRESETS;

const name = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, 40) : '');

export function parseCreate(b: Record<string, unknown>, now: number, horizonMs: number):
  | { ok: true; v: { format: 'partnership' | 'cutthroat'; rules: TableRules; wager: number; startAt: number; opponentName: string; partnerName: string | null; inviteeNames: string[] } }
  | { ok: false; error: string } {
  const format = b.format;
  if (format !== 'partnership' && format !== 'cutthroat') return { ok: false, error: 'Format: partnership or cutthroat.' };
  const wager = Number(b.wager);
  if (!isWagerAmount(wager)) return { ok: false, error: 'Wager: 100, 250, 1000 or 5000 coins.' };
  const timers = TIMER_PRESETS[(typeof b.timers === 'string' ? b.timers : 'normal') as TimerPreset] ?? null;
  if (!timers) return { ok: false, error: 'Timers: chill, normal or fast.' };
  const startAt = Number(b.startAt);
  if (!Number.isFinite(startAt) || startAt < now + CHECKIN_MS + 5 * 60_000) return { ok: false, error: 'Start at least 15 minutes from now (players need time to accept before check-in opens).' };
  if (startAt > now + horizonMs) return { ok: false, error: 'Start within the scheduling window (7 days).' };
  const opponentName = format === 'partnership' ? name(b.opponent) : '';
  if (format === 'partnership' && !opponentName) return { ok: false, error: 'Name your opponent.' };
  let rules: TableRules;
  let partnerName: string | null = null;
  let inviteeNames: string[] = [];
  try {
    if (format === 'partnership') {
      const deck = b.deck === 'aceDown' ? 'aceDown' : b.deck === undefined || b.deck === 'joker' ? 'joker' : null;
      if (!deck) return { ok: false, error: 'Deck: joker or aceDown.' };
      const target = b.target === undefined ? 500 : Number(b.target);
      if (![300, 500, 750].includes(target)) return { ok: false, error: 'Target score: 300, 500 or 750.' };
      partnerName = name(b.partner);
      if (!partnerName) return { ok: false, error: 'Name your partner.' };
      rules = makeRules(deck, { targetScore: target, turnTimerSec: { ...timers } });
    } else {
      if (b.deck !== undefined && b.deck !== 'joker') return { ok: false, error: 'Cutthroat plays the Joker deck.' };
      const target = b.target === undefined ? 300 : Number(b.target);
      if (![250, 300, 500].includes(target)) return { ok: false, error: 'Target score: 250, 300 or 500.' };
      if (!Array.isArray(b.invitees) || b.invitees.length !== 3) return { ok: false, error: 'Cutthroat invites exactly three players.' };
      inviteeNames = b.invitees.map(name);
      if (inviteeNames.some((n) => !n)) return { ok: false, error: 'Name all three players.' };
      rules = makeRules('cutthroat', { playerCount: 4, targetScore: target, turnTimerSec: { ...timers } });
    }
  } catch { return { ok: false, error: 'Bad rules.' }; }
  return { ok: true, v: { format, rules, wager, startAt, opponentName, partnerName, inviteeNames } };
}

async function resolveUser(db: D1Database, env: WagerEnv, username: string): Promise<WPerson | null> {
  const r = await db.prepare('SELECT id, username FROM users WHERE username_key = ?').bind(username.toLowerCase()).first<{ id: string; username: string }>();
  if (!r) return null;
  return { uid: r.id, name: r.username, admin: isAdmin(env, r.id, r.username) };
}

export async function handleWagerChallenges(req: Request, env: WagerEnv, url: URL, parts: string[], now: number, call: Call): Promise<Response> {
  if (!env.DB) return json({ error: 'accounts are not configured' }, 503);
  const db = env.DB;
  const me = await currentUser(req, env, url, now);
  const id = parts[2];

  if (!id && req.method === 'GET') {
    if (!me) return json({ error: 'Sign in to see your challenges.' }, 401);
    if (!(await wagerEnabled(db))) return json({ challenges: [], now, enabled: false }); // ships dark; `enabled` lets the client hide the UI entirely
    const rows = (await db.prepare(`SELECT c.id, c.format, c.mode, c.wager, c.start_at AS startAt, c.checkin_opens_at AS checkinOpensAt,
        c.status, c.table_code AS tableCode, c.end_reason AS endReason, c.created_at AS createdAt
      FROM wager_challenges c JOIN wager_challenge_players p ON p.challenge_id = c.id
      WHERE p.user_id = ? ORDER BY c.start_at ASC LIMIT 100`).bind(me.id).all<{
      id: string; format: string; mode: string; wager: number; startAt: number; checkinOpensAt: number; status: string; tableCode: string | null; endReason: string | null; createdAt: number;
    }>()).results;
    const players = rows.length ? (await db.prepare(`SELECT p.challenge_id AS cid, p.user_id AS uid, u.username AS name, p.side, p.seat, p.role, p.status, p.escrowed, p.checked_in AS checkedIn, p.net
      FROM wager_challenge_players p JOIN users u ON u.id = p.user_id
      WHERE p.challenge_id IN (${rows.map(() => '?').join(',')}) ORDER BY p.seat`).bind(...rows.map((r) => r.id)).all<{
      cid: string; uid: string; name: string; side: number | null; seat: number | null; role: string; status: string; escrowed: number; checkedIn: number; net: number | null;
    }>()).results : [];
    const byChallenge = new Map<string, unknown[]>();
    for (const p of players) {
      const list = byChallenge.get(p.cid) ?? [];
      list.push({ uid: p.uid, name: p.name, role: p.role, side: p.side, seat: p.seat, status: p.status, escrowed: !!p.escrowed, checkedIn: !!p.checkedIn, net: p.net ?? null });
      byChallenge.set(p.cid, list);
    }
    return json({
      challenges: rows.map((r) => ({ ...r, pot: r.wager * 4, players: byChallenge.get(r.id) ?? [] })),
      now,
      enabled: true,
    });
  }

  if (!id && req.method === 'POST') {
    if (!(await wagerEnabled(db))) return json({ error: 'not found' }, 404); // ships dark
    if (!me?.username) return json({ error: 'Sign in to send a challenge.' }, 401);
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const p = parseCreate(body, now, await wagerHorizonMs(db));
    if (!p.ok) return json({ error: p.error }, 400);
    let opponent: WPerson | null = null;
    if (p.v.opponentName) {
      opponent = await resolveUser(db, env, p.v.opponentName);
      if (!opponent) return json({ error: `No player named ${p.v.opponentName}.` }, 404);
    }
    let partner: WPerson | null = null;
    if (p.v.partnerName) {
      partner = await resolveUser(db, env, p.v.partnerName);
      if (!partner) return json({ error: `No player named ${p.v.partnerName}.` }, 404);
    }
    const invitees: WPerson[] = [];
    for (const n of p.v.inviteeNames) {
      const u = await resolveUser(db, env, n);
      if (!u) return json({ error: `No player named ${n}.` }, 404);
      invitees.push(u);
    }
    const cid = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const c: WCreate = {
      id: cid, format: p.v.format, rules: p.v.rules, wager: p.v.wager, startAt: p.v.startAt,
      challenger: { uid: me.id, name: me.username, admin: isAdmin(env, me.id, me.username) },
      opponent, partner, invitees,
    };
    return call(cid, { op: 'create', c });
  }

  if (!id || !/^[a-f0-9]{12}$/.test(id)) return json({ error: 'not found' }, 404);

  if (!parts[3] && req.method === 'GET') {
    if (!(await wagerEnabled(db))) return json({ error: 'not found' }, 404); // ships dark
    if (!me) return json({ error: 'Sign in first.' }, 401);
    const mine = await db.prepare('SELECT 1 AS ok FROM wager_challenge_players WHERE challenge_id = ? AND user_id = ?').bind(id, me.id).first<{ ok: number }>();
    if (!mine && !isAdmin(env, me.id, me.username ?? null)) return json({ error: 'not found' }, 404);
    return call(id, { op: 'view', viewer: me.id });
  }

  if (req.method !== 'POST') return json({ error: 'not found' }, 404);
  if (!me?.username) return json({ error: 'Sign in first.' }, 401);
  const admin = isAdmin(env, me.id, me.username);
  const meRef: WPerson = { uid: me.id, name: me.username, admin };
  switch (parts[3]) {
    case 'accept': {
      const b = await req.json().catch(() => ({})) as { partner?: string };
      let partner: WPerson | null = null;
      if (b.partner) {
        partner = await resolveUser(db, env, String(b.partner));
        if (!partner) return json({ error: `No player named ${String(b.partner).slice(0, 40)}.` }, 404);
      }
      return call(id, { op: 'accept', me: meRef, partner });
    }
    case 'decline': return call(id, { op: 'decline', uid: me.id });
    case 'cancel': return call(id, { op: 'cancel', uid: me.id, admin });
    case 'checkin': return call(id, { op: 'checkin', uid: me.id });
  }
  return json({ error: 'not found' }, 404);
}
