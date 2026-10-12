/**
 * POST /api/stats/local — a finished offline game for a signed-in player.
 * The client sends the game (and a client id). Stats are rebuilt here; the body's own totals are not trusted.
 * Bots are kind:'bot', the row is unrated, source='offline'. The client id is the idempotency key.
 */
import type { GameState } from '@spades/rules';
import { sideCount } from '@spades/rules';
import { cleanTeamName } from '@spades/protocol';
import { type AuthEnv, currentUser, fromSite } from '../auth/routes';
import { cleanName } from '../filter';
import { type SeatRef, buildRecord, saveRecord } from './record';

const MAX_BODY = 400_000;
const MAX_HANDS = 40;
const MIN_MS_PER_HAND = 1000;
const MAX_MS_PER_HAND = 30 * 60_000;
const MAX_DURATION_MS = 8 * 3600_000;
const MAX_AGE_MS = 30 * 86400_000;
const HOUR = 3600_000;
export const OFFLINE_PER_HOUR = 12;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function scoresMatchHistory(game: GameState): boolean {
  const r = game?.rules;
  if (!r || (r.playerCount !== 3 && r.playerCount !== 4) || typeof r.partnerships !== 'boolean') return false;
  const sides = sideCount(r);
  if (game.phase !== 'gameOver' || !game.result) return false;
  if (!Array.isArray(game.history) || game.history.length < 1 || game.history.length > MAX_HANDS) return false;
  const final = game.result.finalScores;
  if (!Array.isArray(final) || final.length !== sides) return false;
  if (!Array.isArray(game.result.winners) || game.result.winners.some((w) => !Number.isInteger(w) || w < 0 || w >= sides)) return false;
  const prev = Array(sides).fill(0);
  for (const h of game.history) {
    if (!h || !Array.isArray(h.sides) || h.sides.length !== sides) return false;
    if (!Array.isArray(h.bids) || h.bids.length !== r.playerCount) return false;
    if (!Array.isArray(h.tricksWon) || h.tricksWon.length !== r.playerCount) return false;
    const seen = new Set<number>();
    for (const s of h.sides) {
      if (!s || !Number.isInteger(s.side) || s.side < 0 || s.side >= sides) return false;
      if (typeof s.points !== 'number' || typeof s.totalScore !== 'number' || !Number.isFinite(s.points) || !Number.isFinite(s.totalScore)) return false;
      if (seen.has(s.side)) return false;
      seen.add(s.side);
      if (s.totalScore !== prev[s.side]! + s.points) return false;
      prev[s.side] = s.totalScore;
    }
    if (seen.size !== sides) return false;
  }
  return final.every((sc, i) => sc === prev[i]);
}

export function durationOk(hands: number, startedAt: number, endedAt: number, now: number): boolean {
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return false;
  if (endedAt < startedAt || endedAt > now + 120_000) return false;
  if (startedAt < now - MAX_AGE_MS) return false;
  const dur = endedAt - startedAt;
  const max = Math.min(MAX_DURATION_MS, Math.max(MAX_MS_PER_HAND, hands * MAX_MS_PER_HAND));
  return dur >= hands * MIN_MS_PER_HAND && dur <= max;
}

function clientIdOk(id: unknown): id is string {
  return typeof id === 'string' && /^[A-Za-z0-9_.:-]{8,80}$/.test(id);
}

export async function recordOfflineGame(db: D1Database, user: { id: string; username: string }, raw: unknown, now: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  if (!clientIdOk(b.clientGameId)) return { status: 400, body: { error: 'bad game id' } };
  const game = b.game as GameState;
  if (!scoresMatchHistory(game)) return { status: 400, body: { error: 'scores do not match the hand history' } };
  const startedAt = Number(b.startedAt);
  const endedAt = Number(b.endedAt);
  if (!durationOk(game.history.length, startedAt, endedAt, now)) return { status: 400, body: { error: 'implausible duration' } };
  const key = `${user.id}:${b.clientGameId}`;
  const dup = await db.prepare('SELECT 1 AS ok FROM games WHERE client_game_id = ?').bind(key).first();
  if (dup) return { status: 200, body: { ok: true, duplicate: true } };
  const recent = await db.prepare(`SELECT COUNT(*) AS n FROM games g JOIN game_players p ON p.game_id = g.id WHERE g.source = 'offline' AND p.user_id = ? AND g.ended_at > ?`).bind(user.id, now - HOUR).first<{ n: number }>();
  if ((recent?.n ?? 0) >= OFFLINE_PER_HOUR) return { status: 429, body: { error: 'Too many offline games. Try again in an hour.' } };

  const n = game.rules.playerCount;
  const namesIn = Array.isArray(b.names) ? b.names : [];
  const seatName = (i: number) => cleanName(typeof namesIn[i] === 'string' ? namesIn[i] : '', 24);
  const seats: SeatRef[] = Array.from({ length: n }, (_, i) => {
    const side = game.rules.partnerships ? i % 2 : i;
    if (i === 0) return { name: seatName(0) || user.username, side, kind: 'user', uid: user.id };
    return { name: seatName(i) || `Bot ${i}`, side, kind: 'bot' };
  });
  let teamNames: (string | null)[] | undefined;
  if (game.rules.partnerships && Array.isArray(b.teamNames)) {
    const raw = b.teamNames as unknown[];
    teamNames = [0, 1].map((i) => {
      const name = raw[i];
      return typeof name === 'string' ? cleanTeamName(name) : null;
    });
  }
  const sideNames = game.rules.partnerships
    ? [0, 1].map((side) => teamNames?.[side] || `${seats[side]!.name} + ${seats[side + 2]?.name ?? 'Bot'}`)
    : seats.map((s) => s.name);
  let rec;
  try {
    rec = buildRecord({ id: `offline:${key}`, room: 'offline', game, seats, names: sideNames, teamNames, endedAt });
  } catch {
    return { status: 400, body: { error: 'could not read that game' } };
  }
  await saveRecord(db, rec, false, { source: 'offline', partial: false, clientGameId: key });
  return { status: 200, body: { ok: true, duplicate: false, id: rec.id } };
}

export async function handleLocalStats(req: Request, env: AuthEnv, url: URL, now: number): Promise<Response> {
  if (!fromSite(req, env, url)) return json({ error: 'forbidden' }, 403);
  if (!env.DB) return json({ error: 'unavailable' }, 500);
  const me = await currentUser(req, env, url, now);
  if (!me?.username) return json({ error: 'Sign in to save stats.' }, 401);
  const len = Number(req.headers.get('content-length') ?? '0');
  if (len > MAX_BODY) return json({ error: 'too big' }, 413);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: 'too big' }, 413);
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return json({ error: 'bad json' }, 400); }
  const out = await recordOfflineGame(env.DB, { id: me.id, username: me.username }, raw, now);
  return json(out.body, out.status);
}
