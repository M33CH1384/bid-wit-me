import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { handleSocialHttp } from '../src/social/routes';
import { UNRATED_NOTE, leaderboard, myStats, opponentBucket, personalStats, serverStats } from '../src/stats/boards';

let db: D1Database;
const NOW = 1_800_000_000_000;
const st = (o: Record<string, number>) => JSON.stringify({ bids: 4, made: 3, bags: 2, books: 12, hands: 4, bidMs: 8000, bidN: 4, playMs: 20000, playN: 40, ...o });
const FOUR = JSON.stringify([
  { name: 'A', side: 0, kind: 'user', uid: 'a' },
  { name: 'B', side: 0, kind: 'user', uid: 'b' },
  { name: 'C', side: 1, kind: 'user', uid: 'c' },
  { name: 'D', side: 1, kind: 'user', uid: 'd' },
]);
async function game(id: string, at: number, rows: [string, number, number, string | null, number, number][], opts?: { seats?: string; kind?: 'team' | 'cutthroat'; stats?: Record<string, number>; rated?: number }) {
  const kind = opts?.kind ?? 'team';
  await db.prepare('INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated) VALUES (?, ?, ?, ?, ?, 8, ?, ?, ?, ?, ?)').bind(id, 'R', kind === 'cutthroat' ? 'cutthroat' : 'joker', kind, at, '[]', '[]', '[]', opts?.seats ?? FOUR, opts?.rated ?? 1).run();
  for (const [u, side, won, partner, before, after] of rows)
    await db.prepare('INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, ended_at, stats, elo_before, elo_after) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)').bind(id, u, kind, side, won, partner, at, st(opts?.stats ?? { made: won ? 4 : 2 }), before, after).run();
}
const bots = JSON.stringify([
  { name: 'A', side: 0, kind: 'user', uid: 'a' }, { name: 'B', side: 0, kind: 'user', uid: 'b' },
  { name: 'Bot', side: 1, kind: 'bot' }, { name: 'Bot', side: 1, kind: 'bot' },
]);
const guests = JSON.stringify([
  { name: 'A', side: 0, kind: 'user', uid: 'a' }, { name: 'B', side: 0, kind: 'user', uid: 'b' },
  { name: 'G', side: 1, kind: 'guest' }, { name: 'Bot', side: 1, kind: 'bot' },
]);
beforeEach(async () => {
  db = await makeD1();
  for (const [u, region, hide] of [['a', 'US-GA', 0], ['b', 'US-GA', 0], ['c', 'US-GA', 1], ['d', 'GB', 0]] as const) {
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(u, u.toUpperCase(), u).run();
    await db.prepare('INSERT INTO social_settings (user_id, region, hide_location) VALUES (?, ?, ?)').bind(u, region, hide).run();
  }
  await db.prepare("INSERT INTO ratings (user_id, kind, elo, games, peak, updated_at) VALUES ('a','team',1260,3,1260,1),('b','team',1230,3,1240,1),('c','team',1180,3,1200,1),('d','team',1150,3,1200,1)").run();
  await game('g1', NOW - 40 * 86400_000, [['a', 0, 1, 'b', 1200, 1216], ['b', 0, 1, 'a', 1200, 1216], ['c', 1, 0, 'd', 1200, 1184], ['d', 1, 0, 'c', 1200, 1184]]);
  await game('g2', NOW - 2 * 86400_000, [['a', 0, 1, 'b', 1216, 1230], ['b', 0, 1, 'a', 1216, 1230], ['c', 1, 0, 'd', 1184, 1170], ['d', 1, 0, 'c', 1184, 1170]]);
  await game('g3', NOW - 86400_000, [['a', 0, 0, 'c', 1230, 1260], ['c', 0, 0, 'a', 1170, 1180], ['b', 1, 1, 'd', 1230, 1230], ['d', 1, 1, 'b', 1170, 1150]]);
});

describe('leaderboards', () => {
  it('rating all-time, global vs local (hidden users excluded)', async () => {
    const g = await leaderboard(db, { board: 'rating', kind: 'team', period: 'all', region: null, now: NOW });
    expect(g.map((r) => r.name)).toEqual(['A', 'B', 'C', 'D']);
    const l = await leaderboard(db, { board: 'rating', kind: 'team', period: 'all', region: 'US-GA', now: NOW });
    expect(l.map((r) => r.name)).toEqual(['A', 'B']);
  });
  it('period rating = Elo gained; wins; duos', async () => {
    const w = await leaderboard(db, { board: 'rating', kind: 'team', period: 'week', region: null, now: NOW });
    expect(w[0]).toMatchObject({ name: 'A', value: 44 });
    const wins = await leaderboard(db, { board: 'wins', kind: 'team', period: 'all', region: null, now: NOW });
    expect(wins.slice(0, 2).map((r) => [r.name, r.value])).toEqual([['B', 3], ['A', 2]]);
    const duos = await leaderboard(db, { board: 'duos', kind: 'team', period: 'all', region: null, now: NOW });
    expect(duos[0]).toMatchObject({ name: 'A + B', value: 2, games: 2 });
  });
  it('accuracy needs enough bids', async () => {
    expect(await leaderboard(db, { board: 'accuracy', kind: 'team', period: 'all', region: null, now: NOW })).toEqual([]);
    const w = await leaderboard(db, { board: 'accuracy', kind: 'team', period: 'all', region: null, now: NOW + 0 }).catch(() => []);
    expect(Array.isArray(w)).toBe(true);
    const m = await leaderboard(db, { board: 'accuracy', kind: 'team', period: 'month', region: null, now: NOW });
    expect(m.map((r) => r.name)).toContain('B');
  });
  it('personal + server stats', async () => {
    const p = await personalStats(db, 'b');
    expect(p).toMatchObject({ games: 3, wins: 3, streak: 3, bestStreak: 3, accuracy: 100, bags: 6, bids: 12, booksPerHand: 3, bidSec: 2, playSec: 0.5, winsVsPlayers: 3, winsVsBots: 0, gamesVsPlayers: 3 });
    expect((await personalStats(db, 'a')).streak).toBe(0);
    expect(await serverStats(db, NOW)).toMatchObject({ accounts: 4, games: 3, gamesToday: 1 });
  });
  it('wins split into vs players and vs bots; a win against guests is neither', async () => {
    await db.prepare("INSERT INTO users (id, username, username_key, created_at) VALUES ('e', 'E', 'e', 1)").run();
    const soloBots = JSON.stringify([{ name: 'E', side: 0, kind: 'user', uid: 'e' }, { name: 'Bot', side: 1, kind: 'bot' }, { name: 'Bot', side: 1, kind: 'bot' }]);
    const soloUser = JSON.stringify([{ name: 'E', side: 0, kind: 'user', uid: 'e' }, { name: 'A', side: 1, kind: 'user', uid: 'a' }]);
    const soloGuest = JSON.stringify([{ name: 'E', side: 0, kind: 'user', uid: 'e' }, { name: 'G', side: 1, kind: 'guest' }, { name: 'Bot', side: 1, kind: 'bot' }]);
    await game('wb', NOW, [['e', 0, 1, null, 0, 0]], { seats: soloBots, rated: 0 });
    await game('wp', NOW, [['e', 0, 1, null, 1200, 1210], ['a', 1, 0, null, 1200, 1190]], { seats: soloUser });
    await game('wg', NOW, [['e', 0, 1, null, 0, 0]], { seats: soloGuest, rated: 0 });
    await game('wl', NOW, [['e', 0, 0, null, 0, 0]], { seats: soloBots, rated: 0 });
    const row = (await leaderboard(db, { board: 'wins', kind: 'team', period: 'all', region: null, now: NOW })).find((r) => r.name === 'E');
    expect(row).toMatchObject({ vsPlayers: 1, vsBots: 1, value: 1 });
    const p = await personalStats(db, 'e', 'team');
    expect(p).toMatchObject({ games: 4, wins: 3, winsVsPlayers: 1, winsVsBots: 1, gamesVsPlayers: 1, gamesVsBots: 2 });
  });
  it('bid accuracy counts bots-only games', async () => {
    await db.prepare("INSERT INTO users (id, username, username_key, created_at) VALUES ('e', 'E', 'e', 1)").run();
    const soloBots = JSON.stringify([{ name: 'E', side: 0, kind: 'user', uid: 'e' }, { name: 'Bot', side: 1, kind: 'bot' }]);
    await game('acc', NOW, [['e', 0, 1, null, 0, 0]], { seats: soloBots, rated: 0, stats: { bids: 20, made: 10, bags: 4 } });
    const row = (await leaderboard(db, { board: 'accuracy', kind: 'team', period: 'all', region: null, now: NOW })).find((r) => r.name === 'E');
    expect(row).toMatchObject({ value: 50, extra: '20 bids' });
    expect((await personalStats(db, 'e')).accuracy).toBe(50);
  });
  it('best duos ignore games that had no signed-in opponent', async () => {
    await game('g4', NOW - 1000, [['a', 0, 1, 'b', 1200, 1210], ['b', 0, 1, 'a', 1200, 1210]], { seats: bots, rated: 0 });
    await game('g5', NOW - 500, [['a', 0, 1, 'b', 1210, 1220], ['b', 0, 1, 'a', 1210, 1220]], { seats: guests, rated: 0 });
    const duos = await leaderboard(db, { board: 'duos', kind: 'team', period: 'all', region: null, now: NOW });
    expect(duos[0]).toMatchObject({ name: 'A + B', value: 2, games: 2 });
  });
});

describe('my stats', () => {
  const ORIGIN = 'https://bid-wit-me.pages.dev';
  it('a bots-only game is in the totals with a null Elo, and the split wins add up', async () => {
    await db.prepare("INSERT INTO users (id, username, username_key, created_at) VALUES ('m33', 'M33CH', 'm33ch', 1)").run();
    const cutBots = JSON.stringify([
      { name: 'M33CH', side: 0, kind: 'user', uid: 'm33' },
      { name: 'Bot', side: 1, kind: 'bot' }, { name: 'Bot', side: 2, kind: 'bot' }, { name: 'Bot', side: 3, kind: 'bot' },
    ]);
    const vsUser = JSON.stringify([
      { name: 'M33CH', side: 0, kind: 'user', uid: 'm33' }, { name: 'A', side: 1, kind: 'user', uid: 'a' },
    ]);
    await game('c1', NOW, [['m33', 0, 1, null, 0, 0]], { kind: 'cutthroat', seats: cutBots, rated: 0, stats: { bids: 6, made: 4, bags: 5, books: 18, hands: 6, nilBids: 2, nilMade: 1, shotsGiven: 2, shotsTaken: 1, bjWins: 3 } });
    await game('t1', NOW, [['m33', 0, 1, 'a', 1200, 1210], ['a', 1, 0, 'm33', 1200, 1190]], { seats: vsUser, stats: { bids: 4, made: 3, bags: 1, books: 10, hands: 4 } });
    await game('t2', NOW - 1000, [['m33', 0, 0, 'a', 1210, 1190], ['a', 1, 1, 'm33', 1190, 1210]], { seats: vsUser, stats: { bids: 4, made: 1, bags: 2, books: 6, hands: 4, nilBids: 1, nilMade: 1, shotsTaken: 1, bjWins: 1 } });
    await db.prepare("INSERT INTO ratings (user_id, kind, elo, games, peak, updated_at) VALUES ('m33','team',1190,2,1210,1)").run();
    const tok = 'm33-session';
    await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), 'm33', 1, NOW + 10_000_000).run();
    const url = new URL('/api/social/me/stats', ORIGIN);
    const res = await handleSocialHttp(new Request(url, { headers: { cookie: `__Host-bwm_sid=${tok}` } }), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, ['api', 'social', 'me', 'stats'], NOW);
    expect(res.status).toBe(200);
    const body = await res.json() as Awaited<ReturnType<typeof myStats>>;
    expect(body.cutthroat).toMatchObject({
      games: 1, wins: 1, winsVsPlayers: 0, winsVsBots: 1, gamesVsBots: 1, winPctBots: 100, winPctPlayers: null,
      accuracy: 66.7, bags: 5, booksPerHand: 3, nil: '1/2', shotsGiven: 2, shotsTaken: 1, bids: 6,
      elo: null, unrated: UNRATED_NOTE,
    });
    expect(body.team).toMatchObject({
      games: 2, wins: 1, winsVsPlayers: 1, winsVsBots: 0, gamesVsPlayers: 2, winPctPlayers: 50,
      accuracy: 50, bags: 3, booksPerHand: 2, nil: '1/1', shotsTaken: 1, bids: 8, elo: 1190, unrated: null,
    });
    // Owner ruling 2026-11-06: Big-Joker trick wins is not a stat (the card
    // wins its trick by construction — the count measures the deal, not the
    // player). The stored stats JSON seeded above still carries bjWins, as
    // real history does; the payload must not surface it at all.
    expect(body.cutthroat).not.toHaveProperty('bjWins');
    expect(body.team).not.toHaveProperty('bjWins');
    const anon = await handleSocialHttp(new Request(url), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, ['api', 'social', 'me', 'stats'], NOW);
    expect(anon.status).toBe(401);
  });
});

describe('opponent buckets', () => {
  it('classifies signed-in, all-bot, and guest tables', () => {
    const seats = [{ side: 0, kind: 'user' }, { side: 1, kind: 'user' }, { side: 1, kind: 'bot' }];
    expect(opponentBucket(seats, 0)).toBe('players');
    expect(opponentBucket([{ side: 0, kind: 'user' }, { side: 1, kind: 'bot' }, { side: 2, kind: 'bot' }], 0)).toBe('bots');
    expect(opponentBucket([{ side: 0, kind: 'user' }, { side: 1, kind: 'guest' }, { side: 1, kind: 'bot' }], 0)).toBe('other');
    expect(opponentBucket([{ side: 0, kind: 'user' }, { side: 0, kind: 'user' }, { side: 1, kind: 'bot' }], 0)).toBe('bots');
  });
});

describe('extra metric boards (league data wave, item 2)', () => {
  beforeEach(async () => {
    for (const [u, name] of [['e', 'E'], ['f', 'F'], ['g', 'G']] as const) {
      await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(u, name, u).run();
    }
    // e: 12 games, 9–3 (75%), 3.0 books/hand, 5 nils made of 5 bid
    for (let i = 0; i < 12; i++) {
      await game(`we${i}`, NOW - i * 1000, [['e', 0, i < 9 ? 1 : 0, 'f', 0, 0]],
        { stats: { books: 27, hands: 9, nilMade: i < 5 ? 1 : 0, nilBids: i < 5 ? 1 : 0 } });
    }
    // f: 12 games, 6–6 (50%), 2.0 books/hand, 3 nils made of 4 bid
    for (let i = 0; i < 12; i++) {
      await game(`wf${i}`, NOW - i * 1000, [['f', 0, i < 6 ? 1 : 0, 'e', 0, 0]],
        { stats: { books: 18, hands: 9, nilMade: i < 3 ? 1 : 0, nilBids: i < 4 ? 1 : 0 } });
    }
    // g: 4 games, all wins — under every minimum, must appear nowhere
    for (let i = 0; i < 4; i++) {
      await game(`wg${i}`, NOW - i * 1000, [['g', 0, 1, null, 0, 0]], { stats: { books: 36, hands: 9, nilMade: 2, nilBids: 2 } });
    }
  });

  const names = (rows: { name: string }[]) => rows.map((r) => r.name);

  it('winpct: 10-game minimum (honors precedent), value in %, extra is the W–L', async () => {
    const rows = await leaderboard(db, { board: 'winpct', kind: 'team', period: 'all', region: null, now: NOW });
    expect(rows.slice(0, 2).map((r) => [r.name, r.value, r.games, r.extra])).toEqual([
      ['E', 75, 12, '9–3'],
      ['F', 50, 12, '6–6'],
    ]);
    expect(names(rows)).not.toContain('G');
    expect(names(rows)).not.toContain('A'); // 3 games < 10
  });

  it('books: books per hand, 5-game minimum, extra names the counters', async () => {
    const rows = await leaderboard(db, { board: 'books', kind: 'team', period: 'all', region: null, now: NOW });
    expect(rows.slice(0, 2).map((r) => [r.name, r.value, r.games, r.extra])).toEqual([
      ['E', 3, 12, '324 books · 108 hands'],
      ['F', 2, 12, '216 books · 108 hands'],
    ]);
    expect(names(rows)).not.toContain('G');
  });

  it('nils: nils made totals, 5-game minimum, no nils no board', async () => {
    const rows = await leaderboard(db, { board: 'nils', kind: 'team', period: 'all', region: null, now: NOW });
    expect(rows.map((r) => [r.name, r.value, r.extra])).toEqual([
      ['E', 5, 'made 5 of 5 bid'],
      ['F', 3, 'made 3 of 4 bid'],
    ]);
  });

  it('the new boards respect kind and route through /api/social/leaderboard', async () => {
    expect(await leaderboard(db, { board: 'books', kind: 'cutthroat', period: 'all', region: null, now: NOW })).toEqual([]);
    const tok = 'm33-session-2';
    const ORIGIN = 'https://bid-wit-me.pages.dev';
    await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), 'e', 1, NOW + 10_000_000).run();
    const url = new URL('/api/social/leaderboard?board=winpct&kind=team&scope=global&period=all', ORIGIN);
    const res = await handleSocialHttp(new Request(url, { headers: { cookie: `__Host-bwm_sid=${tok}` } }), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, ['api', 'social', 'leaderboard'], NOW);
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: { name: string; value: number }[] };
    expect(body.rows[0]).toMatchObject({ name: 'E', value: 75 });
  });
});

describe('streak board (owner 2026-11-01: highest win streaks for the ticker)', () => {
  /** One player's row in one game, with the full games row under test control. */
  async function rawGame(id: string, at: number, uid: string, won: number, opts?: { family?: string; endReason?: string; rated?: number; leaver?: string; kind?: 'team' | 'cutthroat' }) {
    const kind = opts?.kind ?? 'team';
    await db.prepare('INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, end_reason, leaver_id, family) VALUES (?, ?, ?, ?, ?, 8, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, 'R', kind === 'cutthroat' ? 'cutthroat' : 'joker', kind, at, '[]', '[]', '[]', FOUR, opts?.rated ?? 1, opts?.endReason ?? 'finished', opts?.leaver ?? null, opts?.family ?? null).run();
    await db.prepare('INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, ended_at, stats, elo_before, elo_after) VALUES (?, ?, ?, 0, 0, ?, NULL, ?, ?, 1200, 1200)')
      .bind(id, uid, kind, won, at, st({})).run();
  }
  /** A user's counted sequence, oldest first (1 = win, 0 = loss). */
  async function seq(uid: string, pattern: number[], base: number, opts?: { kind?: 'team' | 'cutthroat' }) {
    for (let i = 0; i < pattern.length; i++) await rawGame(`${uid}-${opts?.kind ?? 'team'}-${i}`, base + i * 1000, uid, pattern[i]!, opts);
  }
  beforeEach(async () => {
    for (const u of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'w1', 'f1']) {
      await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(u, u.toUpperCase(), u).run();
    }
    const T = NOW - 60_000;
    await seq('p1', [0, 1, 1, 1, 1, 0, 1, 1], T);            // best 4, 8 games, current 2
    await seq('p2', [1, 1, 1, 1, 1, 1], T);                  // best 6, 6 games
    await seq('p3', [1, 1, 1, 0, 1], T);                     // best 3, 5 games — both minimums exactly met
    await seq('p4', [1, 1, 1, 1], T);                        // best 4 but only 4 games — under the 5-game minimum
    await seq('p5', [1, 0, 1, 0, 1, 0, 1, 0, 1], T);         // 9 games, best 1 — not a streak
    await seq('p6', [1, 1, 1, 1, 0, 1, 0], T);               // best 4, 7 games (tie with p1/p7 on value)
    await seq('p7', [1, 1, 0, 1, 1, 1, 1, 0], T);            // best 4, 8 games (ties p1 on value AND games — name decides)
    await seq('p2', [1, 1, 0, 1, 1], T, { kind: 'cutthroat' }); // cutthroat best 2 — must not leak into the team walk
    await seq('w1', [1, 1, 1, 1, 1, 1], NOW - 10 * 86400_000);  // best 6, all 10 days old
    // f1: the counting rules — an unrated abandoned save of a deal is invisible,
    // its finished twin (same family) counts once; a rated leaver's abandon
    // counts as a loss and breaks the run.
    await rawGame('f1-g1', T, 'f1', 1);
    await rawGame('f1-g2', T + 1000, 'f1', 1);
    await rawGame('f1-g3a', T + 2000, 'f1', 0, { family: 'FAM1', endReason: 'abandoned', rated: 0 });
    await rawGame('f1-g3b', T + 3000, 'f1', 1, { family: 'FAM1' });
    await rawGame('f1-g4', T + 4000, 'f1', 0, { endReason: 'abandoned', rated: 1, leaver: 'f1' });
    await rawGame('f1-g5', T + 5000, 'f1', 1);
    await rawGame('f1-g6', T + 6000, 'f1', 1);
    // f1 counted walk: W W W(family, once) L(rated abandon) W W → best 3, 6 games, current 2
  });

  const board = (o?: Partial<Parameters<typeof leaderboard>[1]>) => leaderboard(db, { board: 'streak', kind: 'team', period: 'all', region: null, now: NOW, ...o });

  it('longest win streaks, minimums applied, deterministic tie-breaks', async () => {
    const rows = await board();
    expect(rows.map((r) => [r.name, r.value, r.games])).toEqual([
      ['P2', 6, 6],
      ['W1', 6, 6],
      ['P1', 4, 8],
      ['P7', 4, 8],
      ['P6', 4, 7],
      ['F1', 3, 6],
      ['P3', 3, 5],
    ]);
    const names = rows.map((r) => r.name);
    expect(names).not.toContain('P4'); // 4 counted games < 5
    expect(names).not.toContain('P5'); // best run 1 < 3
    expect(names).not.toContain('B');  // base fixture: best 3 but only 3 games
  });

  it('agrees with personalStats bestStreak/games for every boarded player — the walk is the record', async () => {
    for (const r of await board()) {
      const ps = await personalStats(db, r.id.replace(/^u:/, ''), 'team');
      expect([r.value, r.games]).toEqual([ps.bestStreak, ps.games]);
    }
    // and the reference walk sees the same f1 story the board does
    expect(await personalStats(db, 'f1', 'team')).toMatchObject({ games: 6, bestStreak: 3, streak: 2 });
  });

  it('respects kind: cutthroat walks its own history', async () => {
    expect(await board({ kind: 'cutthroat' })).toEqual([]); // p2's cutthroat best is 2 < 3
    await seq('p3', [1, 1, 1, 1, 1], NOW - 50_000, { kind: 'cutthroat' });
    const rows = await board({ kind: 'cutthroat' });
    expect(rows.map((r) => [r.name, r.value, r.games])).toEqual([['P3', 5, 5]]);
  });

  it('period boards count only games inside the window', async () => {
    const week = await board({ period: 'week' });
    expect(week.map((r) => r.name)).toContain('P2');
    expect(week.map((r) => r.name)).not.toContain('W1'); // all six wins are 10 days old
    const month = await board({ period: 'month' });
    expect(month.map((r) => r.name)).toContain('W1');
  });

  it('region paths run (shared filters) and route through /api/social/leaderboard', async () => {
    expect(await board({ region: 'US-GA' })).toEqual([]); // p-users declared no location; a–d never qualify
    expect(await board({ declaredRegion: 'US-GA' })).toEqual([]);
    const ORIGIN = 'https://bid-wit-me.pages.dev';
    const url = new URL('/api/social/leaderboard?board=streak&kind=team&scope=global&period=all', ORIGIN);
    const res = await handleSocialHttp(new Request(url), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, ['api', 'social', 'leaderboard'], NOW);
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: { name: string; value: number; games: number }[] };
    expect(body.rows[0]).toMatchObject({ name: 'P2', value: 6, games: 6 });
  });
});

describe('pace board (Fastest Climbers — Rep XP earned in games, trend vs the prior period)', () => {
  const D = 86400_000;
  async function pg(id: string, at: number, uid: string, won: number, opts?: { seats?: string; rated?: number; kind?: 'team' | 'cutthroat'; endReason?: string }) {
    const kind = opts?.kind ?? 'team';
    await db.prepare('INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, end_reason) VALUES (?, ?, ?, ?, ?, 8, ?, ?, ?, ?, ?, ?)')
      .bind(id, 'R', kind === 'cutthroat' ? 'cutthroat' : 'joker', kind, at, '[]', '[]', '[]', opts?.seats ?? FOUR, opts?.rated ?? 1, opts?.endReason ?? 'finished').run();
    await db.prepare('INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, ended_at, stats, elo_before, elo_after) VALUES (?, ?, ?, 0, 0, ?, NULL, ?, ?, 1200, 1200)')
      .bind(id, uid, kind, won, at, st({ made: won ? 4 : 2 })).run();
  }
  async function pw(gameId: string, uid: string, xp: number, at: number) {
    await db.prepare("INSERT INTO cred_playwell (game_id, user_id, xp, coins, lines, ended_at) VALUES (?, ?, ?, 0, '[]', ?)").bind(gameId, uid, xp, at).run();
  }
  const CUT4 = JSON.stringify([
    { name: 'P9', side: 0, kind: 'user', uid: 'p9' }, { name: 'X', side: 1, kind: 'user', uid: 'x' },
    { name: 'Y', side: 2, kind: 'user', uid: 'y' }, { name: 'Z', side: 3, kind: 'user', uid: 'z' },
  ]);
  const pace = (o?: Partial<{ kind: 'team' | 'cutthroat'; period: 'all' | 'month' | 'week'; region: string | null; declaredRegion: string }>) =>
    leaderboard(db, { board: 'pace', kind: o?.kind ?? 'team', period: o?.period ?? 'week', region: o?.region ?? null, declaredRegion: o?.declaredRegion, now: NOW });

  beforeEach(async () => {
    for (const u of ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 'p10'])
      await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(u, u.toUpperCase(), u).run();
    // p1 — climbing: 210 this week (3W 2L at full rate + a +10 Play-Well row), 75 the week before
    await pg('p1a', NOW - 1 * D, 'p1', 1); await pw('p1a', 'p1', 10, NOW - 1 * D);
    await pg('p1b', NOW - 2 * D, 'p1', 1);
    await pg('p1c', NOW - 3 * D, 'p1', 1);
    await pg('p1d', NOW - 4 * D, 'p1', 0);
    await pg('p1e', NOW - 5 * D, 'p1', 0);
    await pg('p1f', NOW - 8 * D, 'p1', 1);
    await pg('p1g', NOW - 9 * D, 'p1', 0);
    await pg('p1x', NOW - 1 * D, 'p1', 1, { endReason: 'abandoned' }); // earns nothing, counts nowhere
    // p2 — regressing: 125 this week (5L), 250 the week before (5W)
    for (let i = 0; i < 5; i++) await pg(`p2c${i}`, NOW - (1 + i) * D, 'p2', 0);
    for (let i = 0; i < 5; i++) await pg(`p2p${i}`, NOW - (8 + i) * D, 'p2', 1);
    // p3 — flat: 175 (2W 3L) in both weeks
    for (let i = 0; i < 5; i++) await pg(`p3c${i}`, NOW - (1 + i) * D, 'p3', i < 2 ? 1 : 0);
    for (let i = 0; i < 5; i++) await pg(`p3p${i}`, NOW - (8 + i) * D, 'p3', i < 2 ? 1 : 0);
    // p4 — only 4 games this week: under the 5-game floor despite 200 XP
    for (let i = 0; i < 4; i++) await pg(`p4c${i}`, NOW - (1 + i) * D, 'p4', 1);
    // p5 — brand new: nothing before this week; 250 base + 17 Play-Well
    for (let i = 0; i < 5; i++) await pg(`p5c${i}`, NOW - (1 + i) * D, 'p5', 1);
    await pw('p5c0', 'p5', 17, NOW - 1 * D);
    // p6 — played only in the previous week
    for (let i = 0; i < 5; i++) await pg(`p6p${i}`, NOW - (8 + i) * D, 'p6', 1);
    // p7 — half rate both ways: unrated vs bots (24/win) and rated vs bot seats (still half)
    for (let i = 0; i < 4; i++) await pg(`p7a${i}`, NOW - (1 + i) * D, 'p7', 1, { seats: bots, rated: 0 });
    await pg('p7b', NOW - 5 * D, 'p7', 1, { seats: bots, rated: 1 });
    // p8 — window edges: exactly at the 7d edge counts as current; 1s older is previous; 14d+1s is neither
    for (let i = 0; i < 5; i++) await pg(`p8e${i}`, NOW - 7 * D, 'p8', 0);
    for (let i = 0; i < 5; i++) await pg(`p8p${i}`, NOW - 7 * D - 1000, 'p8', 1);
    await pg('p8old', NOW - 14 * D - 1000, 'p8', 1);
    // p9 — cutthroat only
    for (let i = 0; i < 5; i++) await pg(`p9c${i}`, NOW - (1 + i) * D, 'p9', 1, { kind: 'cutthroat', seats: CUT4 });
    // p10 — rated vs guests is FULL rate (guests are not bots): 5 wins = 250
    for (let i = 0; i < 5; i++) await pg(`p10c${i}`, NOW - (1 + i) * D, 'p10', 1, { seats: guests });
  });

  it('week board: exact game-XP reconstruction, ranked, with the signed trend + its delta line', async () => {
    const rows = await pace();
    expect(rows.map((r) => r.name)).toEqual(['P5', 'P10', 'P1', 'P3', expect.stringMatching(/^P[28]$/), expect.stringMatching(/^P[28]$/), 'P7']);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.P5).toMatchObject({ value: 267, games: 5, trend: 267, extra: '+267 vs prior 7d' }); // new player: previous window is truly 0
    expect(by.P10).toMatchObject({ value: 250, games: 5, trend: 250 });
    expect(by.P1).toMatchObject({ value: 210, games: 5, trend: 135, extra: '+135 vs prior 7d' }); // abandoned game excluded from value AND games
    expect(by.P3).toMatchObject({ value: 175, games: 5, trend: 0, extra: 'Even vs prior 7d' });
    expect(by.P2).toMatchObject({ value: 125, games: 5, trend: -125, extra: '-125 vs prior 7d' });
    expect(by.P8).toMatchObject({ value: 125, games: 5, trend: -125 }); // edge-inclusive current, edge-exclusive previous
    expect(by.P7).toMatchObject({ value: 120, games: 5, trend: 120 }); // half rate: 5 × 24
    expect(by.P4).toBeUndefined(); // 4 games < floor
    expect(by.P6).toBeUndefined(); // nothing this week
    expect(by.P9).toBeUndefined(); // cutthroat games are not team games
    expect(by.A).toBeUndefined();  // base fixtures: 3 games < floor
  });

  it('month board widens the ranking window; the trend pair widens with it', async () => {
    const rows = await pace({ period: 'month' });
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.P1).toMatchObject({ value: 285, games: 7, trend: 285, extra: '+285 vs prior 30d' });
    expect(by.P2).toMatchObject({ value: 375, games: 10, trend: 375 });
    expect(by.P6).toMatchObject({ value: 250, games: 5, trend: 250 }); // last week's games are inside this month
    expect(by.P4).toBeUndefined();
  });

  it("period 'all': value is all-time; the trend pair is the last 30d vs the 30d before, and the row says so", async () => {
    const rows = await pace({ period: 'all' });
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.P1).toMatchObject({ value: 285, games: 7, trend: 285, extra: '+285 last 30d vs prior 30d' });
    expect(by.P6).toMatchObject({ value: 250, games: 5 });
  });

  it('kind slice, region paths, and the API contract', async () => {
    const cut = await pace({ kind: 'cutthroat' });
    expect(cut.map((r) => [r.name, r.value, r.games, r.trend])).toEqual([['P9', 250, 5, 250]]);
    expect(await pace({ region: 'US-GA' })).toEqual([]); // p-users shared no location; a–d never qualify
    expect(await pace({ declaredRegion: 'US-GA' })).toEqual([]);
    const ORIGIN = 'https://bid-wit-me.pages.dev';
    const url = new URL('/api/social/leaderboard?board=pace&kind=team&scope=global&period=week', ORIGIN);
    const res = await handleSocialHttp(new Request(url), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, ['api', 'social', 'leaderboard'], NOW);
    expect(res.status).toBe(200);
    const body = await res.json() as { rows: { name: string; value: number; games: number; trend: number; extra: string }[] };
    expect(body.rows[0]).toMatchObject({ name: 'P5', value: 267, games: 5, trend: 267, extra: '+267 vs prior 7d' });
  });
});
