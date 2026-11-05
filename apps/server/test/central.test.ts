/**
 * BWM Central Phase 1 (server): migration 0036 (game_hands / favorite_partners /
 * crews), saveRecord → game_hands, friends leaderboard scope, match detail,
 * favorites endpoints, and the honors Big-Joker mislabel fix.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type GameState, makeRules, scoreHand } from '@spades/rules';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { buildRecord, saveRecord, type GameRecord } from '../src/stats/record';
import { leaderboard } from '../src/stats/boards';
import { matchDetail } from '../src/stats/match';
import { leagueHonors } from '../src/stats/honors';
import { handleSocialHttp } from '../src/social/routes';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://bid-wit-me.pages.dev';

async function user(id: string, name = id.toUpperCase()) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(id, name, id.toLowerCase()).run();
}
async function session(uid: string, tok: string) {
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), uid, 1, NOW + 10_000_000).run();
  return { cookie: `__Host-bwm_sid=${tok}` };
}
const call = (path: string, parts: string[], headers?: Record<string, string>, method = 'GET') => {
  const url = new URL(path, ORIGIN);
  return handleSocialHttp(new Request(url, { method, headers }), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, parts, NOW);
};

beforeEach(async () => {
  db = await makeD1();
  for (const u of ['a', 'b', 'c', 'd']) await user(u);
});

/* ---------------------------------------------------------- migration */

describe('migration 0036', () => {
  it('creates game_hands, favorite_partners, crews and crew_members', async () => {
    const rows = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('game_hands', 'favorite_partners', 'crews', 'crew_members') ORDER BY name").all<{ name: string }>()).results;
    expect(rows.map((r) => r.name)).toEqual(['crew_members', 'crews', 'favorite_partners', 'game_hands']);
    await db.prepare("INSERT INTO crews (id, name, owner_id, created_at) VALUES ('k1', 'Kings', 'a', 1)").run();
    await db.prepare("INSERT INTO crew_members (crew_id, user_id, role, joined_at) VALUES ('k1', 'a', 'owner', 1)").run();
    expect(await db.prepare("SELECT role FROM crew_members WHERE crew_id = 'k1' AND user_id = 'a'").first()).toEqual({ role: 'owner' });
  });
});

/* ---------------------------------------------------------- game_hands */

/** Minimal finished team game built exactly like bags.test.ts: history from scoreHand. */
function finishedGame(hands: { bids: readonly (number | 'nil')[]; tricks: number[] }[]): GameState {
  const rules = makeRules('joker');
  let scores = [0, 0];
  let bags = [0, 0];
  const history: GameState['history'] = [];
  for (const [i, h] of hands.entries()) {
    const sides = scoreHand(rules, h.bids as never, h.tricks, scores, bags);
    history.push({ handNo: i + 1, dealer: 0, bids: [...h.bids] as never, tricksWon: [...h.tricks], sides });
    scores = sides.map((s) => s.totalScore);
    bags = sides.map((s) => s.totalBags);
  }
  return {
    rules, seed: 'central', phase: 'gameOver', handNo: hands.length, dealer: 0, turn: null,
    hands: Array.from({ length: 4 }, () => []), bids: Array(4).fill(null), revealed: Array(4).fill(true),
    exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: Array(4).fill(0),
    spadesBroken: true, scores, bags, history,
    result: { endReason: 'target' as const, finalScores: scores, placements: [1, 2], winners: [0] },
  } as GameState;
}
const SEATS: GameRecord['seats'] = [
  { name: 'A', side: 0, kind: 'user', uid: 'a' },
  { name: 'B', side: 1, kind: 'bot' },
  { name: 'C', side: 0, kind: 'bot' },
  { name: 'D', side: 1, kind: 'bot' },
];
const HANDS = [
  { bids: [4, 3, 2, 3] as const, tricks: [5, 3, 3, 2] },
  { bids: [3, 4, 3, 2] as const, tricks: [4, 4, 2, 3] },
];

describe('saveRecord → game_hands', () => {
  it('buildRecord carries the per-hand per-side timeline and saveRecord persists it, idempotently', async () => {
    const game = finishedGame(HANDS.map((h) => ({ bids: [...h.bids], tricks: h.tricks })));
    const rec = buildRecord({ id: 'gh1', room: 'R', game, seats: SEATS, names: ['Us', 'Them'], endedAt: NOW });
    const expected = game.history.flatMap((h) => h.sides.map((s) => ({ hand: h.handNo, side: s.side, scoreAfter: s.totalScore, books: s.tricks })));
    expect(rec.timeline).toEqual(expected);
    await saveRecord(db, rec, false);
    await saveRecord(db, rec, false); // duplicate delivery writes nothing twice
    const rows = (await db.prepare('SELECT hand_no AS hand, side, score_after AS scoreAfter, books FROM game_hands WHERE game_id = ? ORDER BY hand_no, side').bind('gh1').all()).results;
    expect(rows).toEqual(expected);
  });

  it('an abandoned save writes no game_hands, even with a timeline attached', async () => {
    const game = finishedGame(HANDS.map((h) => ({ bids: [...h.bids], tricks: h.tricks })));
    const rec = buildRecord({ id: 'gh-ab', room: 'R', game, seats: SEATS, names: ['Us', 'Them'], endedAt: NOW });
    await saveRecord(db, rec, false, { endReason: 'abandoned', leaverId: 'a' });
    expect((await db.prepare("SELECT COUNT(*) AS n FROM game_hands WHERE game_id = 'gh-ab'").first<{ n: number }>())!.n).toBe(0);
  });

  it('a zero-hand record writes no game_hands', async () => {
    const rec = buildRecord({ id: 'gh-zero', room: 'R', game: finishedGame([]), seats: SEATS, names: ['Us', 'Them'], endedAt: NOW });
    expect(rec.hands).toBe(0);
    await saveRecord(db, rec, false);
    expect((await db.prepare("SELECT COUNT(*) AS n FROM game_hands WHERE game_id = 'gh-zero'").first<{ n: number }>())!.n).toBe(0);
  });
});

/* ---------------------------------------------------------- friends board */

describe('friends leaderboard scope', () => {
  beforeEach(async () => {
    await db.prepare("INSERT INTO ratings (user_id, kind, elo, games, peak, updated_at) VALUES ('a','team',1260,3,1260,1),('b','team',1230,3,1240,1),('c','team',1180,3,1200,1),('d','team',1150,3,1200,1)").run();
    // a–b accepted friends; a–c only pending; d a stranger
    await db.prepare("INSERT INTO friends (a, b, status, requested_by, created_at) VALUES ('a','b','friends','a',1), ('a','c','pending','a',1)").run();
  });

  it('leaderboard(friendIds) keeps only the id set', async () => {
    const rows = await leaderboard(db, { board: 'rating', kind: 'team', period: 'all', region: null, friendIds: ['a', 'b'], now: NOW });
    expect(rows.map((r) => r.name)).toEqual(['A', 'B']);
    const global = await leaderboard(db, { board: 'rating', kind: 'team', period: 'all', region: null, now: NOW });
    expect(global.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D']); // no friendIds → unchanged
  });

  it('route scope=friends derives the set server-side (pending excluded); signed-out gets the empty-board note', async () => {
    const headers = await session('a', 'tok-a');
    const res = await call('/api/social/leaderboard?board=rating&kind=team&period=all&scope=friends', ['api', 'social', 'leaderboard'], headers);
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: { name: string }[] };
    expect(body.rows.map((r) => r.name)).toEqual(['A', 'B']);
    const anon = await call('/api/social/leaderboard?board=rating&scope=friends', ['api', 'social', 'leaderboard']);
    const ab = await anon.json() as { rows: unknown[]; note?: string };
    expect(ab.rows).toEqual([]);
    expect(ab.note).toBeTruthy();
  });
});

/* ---------------------------------------------------------- match detail */

const MATCH_SEATS_PUB = JSON.stringify([
  { name: 'A', side: 0, kind: 'user', uid: 'a' }, { name: 'C', side: 0, kind: 'user', uid: 'c' },
  { name: 'B', side: 1, kind: 'user', uid: 'b' }, { name: 'D', side: 1, kind: 'user', uid: 'd' },
]);
const MATCH_SEATS_PRIV = JSON.stringify([
  { name: 'A', side: 0, kind: 'user', uid: 'a' }, { name: 'Bot', side: 0, kind: 'bot' },
  { name: 'Bot', side: 1, kind: 'bot' }, { name: 'Bot', side: 1, kind: 'bot' },
]);
async function matchGame(id: string, seats: string) {
  await db.prepare(`INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, source, partial, end_reason)
    VALUES (?, 'RM1', 'joker', 'team', ?, 2, '[510, 300]', '[0]', '["Us","Them"]', ?, 1, 'online', 0, 'finished')`).bind(id, NOW, seats).run();
  await db.prepare(`INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, team_name, ended_at, stats, elo_before, elo_after)
    VALUES (?, 'a', 'team', 0, 0, 1, 'c', 'Us', ?, '{"books":20,"hands":2}', 1200, 1216),
           (?, 'b', 'team', 1, 1, 0, 'd', 'Them', ?, '{"books":15,"hands":2}', 1200, 1184)`).bind(id, NOW, id, NOW).run();
  await db.prepare(`INSERT INTO game_hands (game_id, hand_no, side, score_after, books) VALUES (?, 1, 0, 200, 8), (?, 1, 1, 150, 5), (?, 2, 0, 510, 7), (?, 2, 1, 300, 6)`).bind(id, id, id, id).run();
}

describe('match detail', () => {
  it('shapes game, players and timeline for a participant of a private game', async () => {
    await matchGame('mp', MATCH_SEATS_PRIV);
    const d = await matchDetail(db, 'mp', 'a');
    expect(d!.game).toEqual({ id: 'mp', mode: 'joker', kind: 'team', endedAt: NOW, hands: 2, rated: true, winners: [0], final: [510, 300], seats: JSON.parse(MATCH_SEATS_PRIV) });
    expect(d!.players).toEqual([
      { userId: 'a', name: 'A', seat: 0, side: 0, won: true, partnerId: 'c', teamName: 'Us', stats: { books: 20, hands: 2 }, eloBefore: 1200, eloAfter: 1216 },
      { userId: 'b', name: 'B', seat: 1, side: 1, won: false, partnerId: 'd', teamName: 'Them', stats: { books: 15, hands: 2 }, eloBefore: 1200, eloAfter: 1184 },
    ]);
    expect(d!.timeline).toEqual([
      { hand: 1, side: 0, scoreAfter: 200, books: 8 },
      { hand: 1, side: 1, scoreAfter: 150, books: 5 },
      { hand: 2, side: 0, scoreAfter: 510, books: 7 },
      { hand: 2, side: 1, scoreAfter: 300, books: 6 },
    ]);
  });

  it('player name: username wins, seat name is the fallback, null when neither exists', async () => {
    await db.prepare("INSERT INTO users (id, username, username_key, created_at) VALUES ('e', NULL, NULL, 1)").run();
    const seats = JSON.stringify([
      { name: 'Echo', side: 0, kind: 'user', uid: 'e' }, { name: 'Bee', side: 1, kind: 'user', uid: 'b' },
    ]);
    await db.prepare(`INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, source, partial, end_reason)
      VALUES ('mname', 'RM1', 'joker', 'team', ?, 1, '[10, 0]', '[0]', '[]', ?, 0, 'online', 0, 'finished')`).bind(NOW, seats).run();
    await db.prepare(`INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, team_name, ended_at, stats, elo_before, elo_after)
      VALUES ('mname', 'e', 'team', 0, 0, 1, NULL, NULL, ?, '{}', NULL, NULL),
             ('mname', 'b', 'team', 1, 1, 0, NULL, NULL, ?, '{}', NULL, NULL)`).bind(NOW, NOW).run();
    const d = await matchDetail(db, 'mname', null);
    expect(d!.players.map((p) => [p.userId, p.name])).toEqual([['e', 'Echo'], ['b', 'B']]);
    // no username and no seat name anywhere → null (client falls back)
    await db.prepare(`INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, source, partial, end_reason)
      VALUES ('mnoname', 'RM1', 'joker', 'team', ?, 1, '[10, 0]', '[0]', '[]', '[]', 0, 'online', 0, 'finished')`).bind(NOW).run();
    await db.prepare(`INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, team_name, ended_at, stats, elo_before, elo_after)
      VALUES ('mnoname', 'e', 'team', 0, 0, 1, NULL, NULL, ?, '{}', NULL, NULL)`).bind(NOW).run();
    expect((await matchDetail(db, 'mnoname', 'e'))!.players[0]!.name).toBeNull();
  });

  it('strangers and anonymous callers can read a public game; a private game 404s for them', async () => {
    await matchGame('mpub', MATCH_SEATS_PUB);
    await matchGame('mpriv', MATCH_SEATS_PRIV);
    // 'z' is not a participant anywhere. (The fixture writes a game_players
    // row for 'b' even in the private game — remove it so b is a stranger too.)
    await db.prepare("DELETE FROM game_players WHERE game_id = 'mpriv' AND user_id = 'b'").run();
    expect(await matchDetail(db, 'mpriv', 'b')).toBeNull();
    expect(await matchDetail(db, 'mpriv', 'z')).toBeNull();
    expect(await matchDetail(db, 'mpriv', null)).toBeNull();
    expect((await matchDetail(db, 'mpub', 'z'))!.game.id).toBe('mpub');
    expect((await matchDetail(db, 'mpub', null))!.game.id).toBe('mpub');
    expect(await matchDetail(db, 'nope', 'a')).toBeNull();
    const ok = await call('/api/social/match/mpub', ['api', 'social', 'match', 'mpub']);
    expect(ok.status).toBe(200);
    const no = await call('/api/social/match/mpriv', ['api', 'social', 'match', 'mpriv']);
    expect(no.status).toBe(404);
  });
});

/* ---------------------------------------------------------- favorites */

describe('favorites endpoints', () => {
  it('requires sign-in', async () => {
    const res = await call('/api/social/favorites', ['api', 'social', 'favorites']);
    expect(res.status).toBe(401);
  });

  it('add (idempotent), list with names, self/missing rejected, delete idempotent, vanished users dropped', async () => {
    const headers = await session('a', 'tok-fav');
    const post = (id: string) => call(`/api/social/favorites/${id}`, ['api', 'social', 'favorites', id], headers, 'POST');
    expect((await post('b')).status).toBe(200);
    expect((await post('b')).status).toBe(200); // idempotent
    expect((await post('u:c')).status).toBe(200); // u:-prefixed ids accepted
    expect((await post('a')).status).toBe(400); // cannot favorite self
    expect((await post('ghost')).status).toBe(404); // target must exist
    // a favorite row pointing at a since-deleted account is dropped, not shown
    await db.prepare("INSERT INTO favorite_partners (user_id, partner_id, created_at) VALUES ('a', 'gone', 1)").run();
    const list = await call('/api/social/favorites', ['api', 'social', 'favorites'], headers);
    const body = await list.json() as { favorites: { userId: string; name: string }[] };
    expect(body.favorites).toEqual([{ userId: 'b', name: 'B' }, { userId: 'c', name: 'C' }]);
    const del = (id: string) => call(`/api/social/favorites/${id}`, ['api', 'social', 'favorites', id], headers, 'DELETE');
    expect((await del('b')).status).toBe(200);
    expect((await del('b')).status).toBe(200); // idempotent
    const after = await (await call('/api/social/favorites', ['api', 'social', 'favorites'], headers)).json() as { favorites: unknown[] };
    expect(after.favorites).toEqual([{ userId: 'c', name: 'C' }]);
  });
});

/* ---------------------------------------------------------- honors label */

describe('honors Big-Joker mislabel fix', () => {
  it("the records summing bjWins are labelled Big-Joker trick wins; ids stable; no 'Boston' label remains", async () => {
    await db.prepare(`INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated)
      VALUES ('hb1', 'R', 'joker', 'team', ?, 2, '[]', '[]', '[]', '[]', 1)`).bind(NOW - 1000).run();
    await db.prepare(`INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, ended_at, stats, elo_before, elo_after)
      VALUES ('hb1', 'a', 'team', 0, 0, 1, NULL, ?, '{"bjWins": 7, "wheels": 0}', NULL, NULL)`).bind(NOW - 1000).run();
    const { awards, records } = await leagueHonors(db, NOW);
    const seasonRec = awards.find((h) => h.id === 'most-bostons');
    expect(seasonRec).toMatchObject({ userId: 'a', label: 'Most Big-Joker trick wins this season', value: '7 Big-Joker trick wins' });
    const allTime = records.find((h) => h.id === 'most-bostons-ever');
    expect(allTime).toMatchObject({ userId: 'a', label: 'Most Big-Joker trick wins all-time', value: '7 Big-Joker trick wins' });
    for (const h of [...awards, ...records]) {
      expect(h.label).not.toMatch(/boston/i);
      expect(h.value).not.toMatch(/boston/i);
    }
  });
});
