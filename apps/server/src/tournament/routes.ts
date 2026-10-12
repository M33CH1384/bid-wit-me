/** Release 9b: /api/tournaments — list (D1), create, detail + actions (the tournament's Durable Object). */
import { makeRules } from '@spades/rules';
import { type AuthEnv, currentUser } from '../auth/routes';
import { isProfane } from '../auth/username';
import { type SocialEnv, isAdmin } from '../social/routes';
import { CHECKIN_MS, type TMeta } from './service';
import type { TOp } from './do';

export interface TourEnv extends AuthEnv, SocialEnv { TEST_HOOKS?: string }
type Call = (id: string, op: TOp) => Promise<Response>;

const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { 'cache-control': 'no-store' } });
const MAX_UPCOMING_PER_HOST = 3;

export function parseCreate(b: Record<string, unknown>, now: number, test: boolean): { ok: true; v: Omit<TMeta, 'id' | 'hostId' | 'hostName' | 'createdAt' | 'status'> } | { ok: false; error: string } {
  const name = typeof b.name === 'string' ? b.name.trim().replace(/\s+/g, ' ') : '';
  if (name.length < 3 || name.length > 40) return { ok: false, error: 'Name: 3 to 40 characters.' };
  if (name.split(/[^A-Za-z0-9]+/).some((w) => w && isProfane(w))) return { ok: false, error: 'Pick a cleaner name.' };
  const mode = b.mode;
  if (mode !== 'joker' && mode !== 'aceDown' && mode !== 'cutthroat') return { ok: false, error: 'Unknown mode.' };
  const format = b.format === 'swiss' ? 'swiss' : b.format === 'single' ? 'single' : null;
  if (!format) return { ok: false, error: 'Format: single elimination or Swiss.' };
  const team = mode !== 'cutthroat';
  const pc = mode === 'cutthroat' ? (b.players === 3 ? 3 : 4) : 4;
  const max = Number(b.max);
  if (!Number.isInteger(max) || max < 2 || max > 64) return { ok: false, error: 'Max entrants: 2 to 64.' };
  const rounds = format === 'swiss' ? Number(b.rounds ?? 3) : 0;
  if (format === 'swiss' && (!Number.isInteger(rounds) || rounds < 1 || rounds > 7)) return { ok: false, error: 'Swiss rounds: 1 to 7.' };
  const startAt = Number(b.startAt);
  const minLead = test && b.fast ? 3000 : 5 * 60_000;
  if (!Number.isFinite(startAt) || startAt < now + minLead) return { ok: false, error: 'Start at least 5 minutes from now.' };
  if (startAt > now + 30 * 86400_000) return { ok: false, error: 'Start within 30 days.' };
  const regOpenAt = b.regOpenAt == null ? now : Number(b.regOpenAt);
  const regCloseAt = b.regCloseAt == null ? startAt - (test && b.fast ? 0 : CHECKIN_MS) : Number(b.regCloseAt);
  if (!Number.isFinite(regOpenAt) || !Number.isFinite(regCloseAt) || regOpenAt > regCloseAt || regCloseAt > startAt) return { ok: false, error: 'Registration must close by the start.' };
  const target = [150, 250, 300, 500].includes(Number(b.target)) ? Number(b.target) : undefined;
  let rules;
  try { rules = makeRules(mode, { playerCount: pc as 3 | 4, ...(test && b.target === 50 ? { targetScore: 50 } : target ? { targetScore: target } : {}) }); } catch { return { ok: false, error: 'Bad rules.' }; }
  return { ok: true, v: { name, mode, rules, format, rounds, team, max, startAt, regOpenAt, regCloseAt, bots: b.bots !== false, ...(test && b.fast ? { fast: true } : {}) } };
}

export async function handleTournaments(req: Request, env: TourEnv, url: URL, parts: string[], now: number, call: Call): Promise<Response> {
  if (!env.DB) return json({ error: 'accounts are not configured' }, 503);
  const db = env.DB;
  const me = await currentUser(req, env, url, now);
  const id = parts[2];
  if (!id && req.method === 'GET') {
    const status = ['upcoming', 'live', 'finished'].includes(url.searchParams.get('status') ?? '') ? url.searchParams.get('status')! : 'upcoming';
    const order = status === 'finished' ? 'finished_at DESC' : 'start_at ASC';
    const rows = (await db.prepare(`SELECT t.id, t.name, t.host_name, t.mode, t.format, t.rounds, t.team, t.max_entrants, t.start_at, t.reg_open_at, t.reg_close_at, t.bots, t.status, t.entrants, t.champion, t.finished_at,
      ${me ? 'EXISTS (SELECT 1 FROM tournament_players p WHERE p.tid = t.id AND p.user_id = ?)' : '0'} AS mine
      FROM tournaments t WHERE t.status = ? ORDER BY ${order} LIMIT 50`).bind(...(me ? [me.id, status] : [status])).all()).results;
    return json({ tournaments: rows, now });
  }
  if (!id && req.method === 'POST') {
    if (!me?.username) return json({ error: 'Sign in to host a tournament.' }, 401);
    const p = parseCreate(await req.json().catch(() => ({})) as Record<string, unknown>, now, env.TEST_HOOKS === '1');
    if (!p.ok) return json({ error: p.error }, 400);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM tournaments WHERE host_id = ? AND status IN ('upcoming','live')").bind(me.id).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_UPCOMING_PER_HOST) return json({ error: `You can host ${MAX_UPCOMING_PER_HOST} upcoming tournaments at a time.` }, 409);
    const tid = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    return call(tid, { op: 'create', meta: { ...p.v, id: tid, hostId: me.id, hostName: me.username, createdAt: now, status: 'upcoming' } });
  }
  if (!id || !/^[a-f0-9]{12}$/.test(id)) return json({ error: 'not found' }, 404);
  if (!parts[3] && req.method === 'GET') return call(id, { op: 'view', viewer: me?.id ?? null });
  if (req.method !== 'POST') return json({ error: 'not found' }, 404);
  if (!me?.username) return json({ error: 'Sign in first.' }, 401);
  const admin = isAdmin(env, me.id, me.username);
  const meRef = { uid: me.id, name: me.username };
  switch (parts[3]) {
    case 'register': {
      const b = await req.json().catch(() => ({})) as { partner?: string; teamName?: string };
      let partner: { uid: string; name: string } | null = null;
      if (b.partner) {
        const r = await db.prepare('SELECT id, username FROM users WHERE username_key = ?').bind(String(b.partner).trim().toLowerCase().slice(0, 40)).first<{ id: string; username: string }>();
        if (!r) return json({ error: `No player named ${String(b.partner).slice(0, 40)}.` }, 404);
        partner = { uid: r.id, name: r.username };
      }
      let teamName = typeof b.teamName === 'string' ? b.teamName.trim().replace(/\s+/g, ' ').slice(0, 24) : null;
      if (teamName && teamName.split(/[^A-Za-z0-9]+/).some((w) => w && isProfane(w))) teamName = null;
      return call(id, { op: 'register', me: meRef, partner, teamName });
    }
    case 'unregister': return call(id, { op: 'unregister', uid: me.id });
    case 'checkin': return call(id, { op: 'checkin', uid: me.id });
    case 'start': return call(id, { op: 'start', uid: me.id, admin });
    case 'cancel': return call(id, { op: 'cancel', uid: me.id, admin });
  }
  return json({ error: 'not found' }, 404);
}
