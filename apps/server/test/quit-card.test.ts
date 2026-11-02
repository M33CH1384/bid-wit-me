/** Quit metrics on player cards (owner placement call, 2026-11-02: "Show it
 *  on player cards"). The derivation lives in stats/quits.ts (its own suite
 *  pins the math); THIS suite pins the wiring: cardFor carries the block in
 *  card.stats.quits, and both profile payloads — self (/api/profile/me) and
 *  public (/api/profile/:id) — serve the same block for the same player,
 *  because the card is a public stat by the owner's decision. The zero
 *  state is the honest block (0 starts, null rate), never an absence the
 *  client could mistake for a perfect record. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { cardFor } from '../src/cred/card';
import { handleCredHttp } from '../src/cred/routes';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://example.com';

const call = (tok: string | null, path: string, init?: RequestInit) =>
  handleCredHttp(
    new Request(new URL(path, ORIGIN), { headers: { ...(tok ? { cookie: `__Host-bwm_sid=${tok}` } : {}), 'content-type': 'application/json' }, ...init }),
    { DB: db, PUBLIC_ORIGIN: ORIGIN } as never, new URL(path, ORIGIN), path.split('/').filter(Boolean), NOW);

async function user(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(id, id.toUpperCase(), id).run();
}
async function session(uid: string) {
  const tok = `${uid}-tok`;
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), uid, 1, NOW + 10_000_000).run();
  return tok;
}

const TEAM_SEATS = JSON.stringify([
  { name: 'Que', side: 0, kind: 'user', uid: 'q' },
  { name: 'Al', side: 1, kind: 'user', uid: 'a' },
  { name: 'Bot', side: 0, kind: 'bot' },
  { name: 'Bot', side: 1, kind: 'bot' },
]);
const BOT_OPP_SEATS = JSON.stringify([
  { name: 'Que', side: 0, kind: 'user', uid: 'q' },
  { name: 'Bot', side: 1, kind: 'bot' },
  { name: 'Bot', side: 0, kind: 'bot' },
  { name: 'Bot', side: 1, kind: 'bot' },
]);

interface GameOpts { hands?: number; final?: number[]; seats?: string; rated?: number; endReason?: string; leaverId?: string | null }
async function game(id: string, o: GameOpts = {}) {
  await db.prepare('INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, end_reason, leaver_id, family) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, 'R', 'joker', 'team', NOW, o.hands ?? 4, JSON.stringify(o.final ?? [120, 80]), '[]', '[]', o.seats ?? TEAM_SEATS, o.rated ?? 1, o.endReason ?? 'finished', o.leaverId ?? null, null).run();
}
async function gp(gameId: string, uid: string, side: number) {
  await db.prepare('INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, team_name, ended_at, stats, elo_before, elo_after) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL)')
    .bind(gameId, uid, 'team', side, side, 0, NOW, '{}').run();
}
async function finished(id: string) { await game(id); await gp(id, 'q', 0); await gp(id, 'a', 1); }
async function abandoned(id: string, o: GameOpts = {}) {
  await game(id, { ...o, endReason: 'abandoned' });
  await gp(id, 'q', 0);
  if ((o.seats ?? TEAM_SEATS) === TEAM_SEATS) await gp(id, 'a', 1);
}

/** q's rated world: 2 finished + 3 own quits (one per hand bucket, one per
 *  score context) + 1 opponent quit (a start, not a quit) = 6 starts, 3
 *  quits. An unrated own quit and an all-bot-opposition own quit are both
 *  out of scope entirely. */
const Q_QUITS = {
  started: 6, quits: 3, rate: 50,
  byHand: { early: 1, mid: 1, late: 1 },
  score: { behind: 1, ahead: 1, level: 1, unknown: 0 },
};

beforeEach(async () => {
  db = await makeD1();
  await user('a'); await user('q'); await user('z');
  await finished('f1');
  await finished('f2');
  await abandoned('q-early', { leaverId: 'q', hands: 0, final: [0, 0] }); // hand 1, level
  await abandoned('q-mid', { leaverId: 'q', hands: 3, final: [40, 130] }); // hand 4, behind
  await abandoned('q-late', { leaverId: 'q', hands: 6, final: [200, 100] }); // hand 7, ahead
  await abandoned('a-left', { leaverId: 'a', hands: 2 }); // q started it; a quit it
  await abandoned('q-unrated', { leaverId: 'q', rated: 0 }); // unrated: invisible
  await abandoned('q-bots', { leaverId: 'q', seats: BOT_OPP_SEATS }); // no human opposition: invisible
});

describe('the quit block on the card payload', () => {
  it('cardFor carries started / quits / rate / when-split / score context', async () => {
    const c = await cardFor(db, 'q', 'q', NOW);
    expect(c?.stats.quits).toEqual(Q_QUITS);
  });

  it('attribution is per-leaver: the opponent owns only their own quit', async () => {
    const c = await cardFor(db, 'a', 'a', NOW);
    expect(c?.stats.quits).toEqual({
      started: 6, quits: 1, rate: 16.7,
      byHand: { early: 0, mid: 1, late: 0 },
      score: { behind: 1, ahead: 0, level: 0, unknown: 0 },
    });
  });

  it('a zero-record player gets the honest zero block, not an absence', async () => {
    const c = await cardFor(db, 'z', 'z', NOW);
    expect(c?.stats.quits).toEqual({
      started: 0, quits: 0, rate: null,
      byHand: { early: 0, mid: 0, late: 0 },
      score: { behind: 0, ahead: 0, level: 0, unknown: 0 },
    });
  });
});

describe('both profile payloads serve the same block', () => {
  it('public /api/profile/:id carries card.stats.quits', async () => {
    const res = await call(null, '/api/profile/q');
    expect(res.status).toBe(200);
    const pub = (await res.json()) as { card: { stats: { quits: unknown } } };
    expect(pub.card.stats.quits).toEqual(Q_QUITS);
  });

  it('self /api/profile/me carries the identical block', async () => {
    const res = await call(await session('q'), '/api/profile/me');
    expect(res.status).toBe(200);
    const me = (await res.json()) as { card: { stats: { quits: unknown } } };
    expect(me.card.stats.quits).toEqual(Q_QUITS);
  });
});
