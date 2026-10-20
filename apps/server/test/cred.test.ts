/** Street Cred Phase 3a: divisions, seasons, XP, challenges, achievements, hooks, claims. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { divisionOf, divisionRank } from '../src/cred/divisions';
import { ensureSeason, softReset, seasonName } from '../src/cred/seasons';
import { xpForLevel, levelForXp, titleForLevel, awardXp, xpAtLevel } from '../src/cred/xp';
import { dailyChallenges, weeklyChallenges, dailyPeriodId, progressFor } from '../src/cred/challenges';
import { checkOne, checkAchievements, ACHIEVEMENTS, type CheckCtx } from '../src/cred/achievements';
import { handleCredHttp } from '../src/cred/routes';
import { saveRecord, type GameRecord, type PlayerGameStats, type SeatRef } from '../src/stats/record';

let db: D1Database;
const NOW = 1_800_000_000_000; // 2027-01-15 UTC → season 2027-01
const ORIGIN = 'https://example.com';

const stats = (o: Partial<PlayerGameStats> = {}): PlayerGameStats => ({
  won: false, hands: 4, bids: 4, bidSum: 12, made: 3, set: 1, bags: 2, nilBids: 0, nilMade: 0, blindNilMade: 0,
  books: 12, maxBooksHand: 5, maxDeficit: 0, foeEliminated: false, runItClaims: 0,
  shotsTaken: 1, shotsGiven: 2, wheels: 0, bjWins: 0, bidMs: 8000, bidN: 4, playMs: 20000, playN: 40, ...o,
});
const SEATS: SeatRef[] = [
  { name: 'A', side: 0, kind: 'user', uid: 'a' },
  { name: 'B', side: 0, kind: 'user', uid: 'b' },
  { name: 'C', side: 1, kind: 'user', uid: 'c' },
  { name: 'D', side: 1, kind: 'user', uid: 'd' },
];
function rec(id: string, wonSide: number, at = NOW, st: Partial<PlayerGameStats> = {}): GameRecord {
  return {
    id, room: 'R', mode: 'joker', kind: 'team', endedAt: at, hands: 4,
    final: wonSide === 0 ? [100, 50] : [50, 100], winners: [wonSide],
    names: ['A', 'B', 'C', 'D'], seats: SEATS,
    players: SEATS.map((s, seat) => ({
      seat, uid: s.uid!, side: s.side, won: s.side === wonSide, partner: s.side === 0 ? (s.uid === 'a' ? 'b' : 'a') : (s.uid === 'c' ? 'd' : 'c'),
      teamName: null, stats: { ...stats(st), won: s.side === wonSide },
    })),
  };
}
async function user(id: string, name?: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, name ?? id.toUpperCase(), (name ?? id).toLowerCase(), 1).run();
}
async function session(uid: string, tok = `${uid}-tok`) {
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), uid, 1, NOW + 10_000_000).run();
  return tok;
}
const authed = (tok: string, path: string, init?: RequestInit) =>
  handleCredHttp(new Request(new URL(path, ORIGIN), { headers: { cookie: `__Host-bwm_sid=${tok}` }, ...init }), { DB: db, PUBLIC_ORIGIN: ORIGIN }, new URL(path, ORIGIN), path.split('/').filter(Boolean), NOW);

beforeEach(async () => {
  db = await makeD1();
  for (const u of ['a', 'b', 'c', 'd']) await user(u);
});

describe('divisions', () => {
  it('maps Elo bands to street divisions', () => {
    expect(divisionOf(0)).toBe('stoop');
    expect(divisionOf(799)).toBe('stoop');
    expect(divisionOf(800)).toBe('corner');
    expect(divisionOf(999)).toBe('corner');
    expect(divisionOf(1000)).toBe('block');
    expect(divisionOf(1199)).toBe('block');
    expect(divisionOf(1200)).toBe('avenue');
    expect(divisionOf(1399)).toBe('avenue');
    expect(divisionOf(1400)).toBe('boulevard');
    expect(divisionOf(1599)).toBe('boulevard');
    expect(divisionOf(1600)).toBe('legend');
    expect(divisionOf(2400)).toBe('legend');
  });
  it('ranks divisions for comparisons', () => {
    expect(divisionRank('stoop')).toBeLessThan(divisionRank('block'));
    expect(divisionRank('legend')).toBeGreaterThan(divisionRank('boulevard'));
  });
});

describe('seasons', () => {
  it('soft-resets toward 1000', () => {
    expect(softReset(1200)).toBe(1100);
    expect(softReset(800)).toBe(900);
    expect(softReset(1000)).toBe(1000);
    expect(softReset(1600)).toBe(1300);
  });
  it('names seasons from 2026-10 = Season 1', () => {
    expect(seasonName('2026-10')).toBe('Season 1');
    expect(seasonName('2026-11')).toBe('Season 2');
    expect(seasonName('2027-01')).toBe('Season 4');
  });
  it('creates the current season and carries ratings forward soft-reset', async () => {
    await db.prepare("INSERT INTO ratings (user_id, kind, elo, games, peak, updated_at) VALUES ('a','team',1400,10,1450,1),('b','team',900,5,950,1)").run();
    const s = await ensureSeason(db, NOW);
    expect(s.id).toBe('2027-01');
    expect(s.name).toBe('Season 4');
    const rows = (await db.prepare('SELECT user_id, rating, division FROM season_ratings ORDER BY user_id').all<{ user_id: string; rating: number; division: string }>()).results;
    expect(rows).toEqual([
      { user_id: 'a', rating: 1200, division: 'avenue' },
      { user_id: 'b', rating: 950, division: 'corner' },
    ]);
  });
  it('is idempotent across calls', async () => {
    await ensureSeason(db, NOW);
    await ensureSeason(db, NOW);
    const n = await db.prepare('SELECT COUNT(*) AS n FROM seasons').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});

describe('xp and levels', () => {
  it('xpForLevel grows linearly', () => {
    expect(xpForLevel(1)).toBe(125);
    expect(xpForLevel(49)).toBe(1325);
  });
  it('levelForXp inverts the curve', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(124)).toBe(1);
    expect(levelForXp(125)).toBe(2);
    expect(levelForXp(xpAtLevel(50))).toBe(50);
    expect(levelForXp(1e9)).toBe(50);
  });
  it('titles follow milestones', () => {
    expect(titleForLevel(1)).toBe('New Jack');
    expect(titleForLevel(5)).toBe('Prospect');
    expect(titleForLevel(7)).toBe('Prospect');
    expect(titleForLevel(10)).toBe('Certified');
    expect(titleForLevel(20)).toBe('Block Captain');
    expect(titleForLevel(30)).toBe('Shot Caller');
    expect(titleForLevel(40)).toBe('OG');
    expect(titleForLevel(50)).toBe('King of the Block');
  });
  it('awardXp accumulates and reports level-ups', async () => {
    let r = await awardXp(db, 'a', 100, NOW);
    expect(r).toMatchObject({ xp: 100, level: 1, leveledUp: false });
    r = await awardXp(db, 'a', 50, NOW);
    expect(r).toMatchObject({ xp: 150, level: 2, leveledUp: true, title: 'New Jack' });
  });
});

describe('challenge rotation', () => {
  it('is deterministic per day and rotates the pool', () => {
    const day0 = dailyChallenges(0).map((c) => c.id);
    expect(dailyChallenges(0).map((c) => c.id)).toEqual(day0);
    expect(dailyChallenges(86400_000).map((c) => c.id)).not.toEqual(day0);
    // over two days every daily def appears
    const seen = new Set([...dailyChallenges(0), ...dailyChallenges(86400_000)].map((c) => c.id));
    expect(seen.size).toBe(6);
    expect(dailyChallenges(NOW)).toHaveLength(3);
    expect(weeklyChallenges(NOW)).toHaveLength(2);
  });
  it('uses UTC day boundaries for period ids', () => {
    expect(dailyPeriodId(Date.UTC(2027, 0, 15, 12))).toBe('2027-01-15');
  });
});

const baseCtx = (game: Partial<CheckCtx['game']> = {}, life: Partial<CheckCtx['life']> = {}): CheckCtx => ({
  vsBots: false,
  game: { kind: 'team', won: false, nilMade: 0, blindNilMade: 0, bags: 0, wheels: 0, maxBooksHand: 0, runItClaims: 0, maxDeficit: 0, foeEliminated: false, ...game },
  life: { wins: 0, teamWins: 0, cutthroatWins: 0, games: 0, shotsGiven: 0, bestStreak: 0, venuesPlayed: 0, nightVenueWins: 0, bestDivision: 'stoop', ...life },
});
const def = (id: string) => ACHIEVEMENTS.find((a) => a.id === id)!;

describe('achievement checks', () => {
  it('evaluates lifetime counters', () => {
    expect(checkOne(def('first-dub'), baseCtx({}, { wins: 1 }))).toBe(true);
    expect(checkOne(def('first-dub'), baseCtx({}, { wins: 0 }))).toBe(false);
    expect(checkOne(def('dealmaker'), baseCtx({}, { teamWins: 25 }))).toBe(true);
    expect(checkOne(def('lone-wolf'), baseCtx({}, { cutthroatWins: 9 }))).toBe(false);
    expect(checkOne(def('untouchable'), baseCtx({}, { bestStreak: 10 }))).toBe(true);
    expect(checkOne(def('iron-man'), baseCtx({}, { games: 500 }))).toBe(true);
    expect(checkOne(def('world-traveler'), baseCtx({}, { venuesPlayed: 5 }))).toBe(true);
  });
  it('evaluates per-game feats', () => {
    expect(checkOne(def('clean-nil'), baseCtx({ nilMade: 1 }))).toBe(true);
    expect(checkOne(def('blind-faith'), baseCtx({ blindNilMade: 1 }))).toBe(true);
    expect(checkOne(def('blind-faith'), baseCtx({ nilMade: 1 }))).toBe(false);
    expect(checkOne(def('no-baggage'), baseCtx({ won: true, bags: 0 }))).toBe(true);
    expect(checkOne(def('no-baggage'), baseCtx({ won: true, bags: 1 }))).toBe(false);
    expect(checkOne(def('boston'), baseCtx({ maxBooksHand: 13 }))).toBe(true);
    expect(checkOne(def('run-it-up'), baseCtx({ runItClaims: 1 }))).toBe(true);
    expect(checkOne(def('comeback-kid'), baseCtx({ won: true, maxDeficit: 120 }))).toBe(true);
    expect(checkOne(def('comeback-kid'), baseCtx({ won: false, maxDeficit: 200 }))).toBe(false);
    expect(checkOne(def('undertaker'), baseCtx({ kind: 'cutthroat', foeEliminated: true }))).toBe(true);
    expect(checkOne(def('undertaker'), baseCtx({ kind: 'team', foeEliminated: true }))).toBe(false);
  });
  it('gates per-game feats from bot tables but allows lifetime counters', () => {
    const bot = baseCtx({ nilMade: 1 }, { wins: 1 });
    bot.vsBots = true;
    expect(checkOne(def('clean-nil'), bot)).toBe(false);
    expect(checkOne(def('first-dub'), bot)).toBe(true);
  });
  it('after-dark needs night wins and Block division, and grants the venue unlock', async () => {
    const ctx = baseCtx({}, { nightVenueWins: 25, bestDivision: 'block' });
    expect(checkOne(def('after-dark'), ctx)).toBe(true);
    expect(checkOne(def('after-dark'), baseCtx({}, { nightVenueWins: 25, bestDivision: 'corner' }))).toBe(false);
    const unlocked = await checkAchievements(db, 'a', ctx, NOW);
    expect(unlocked.map((u) => u.id)).toContain('after-dark');
    const unlock = await db.prepare("SELECT item_id FROM unlocks WHERE user_id = 'a'").first<{ item_id: string }>();
    expect(unlock?.item_id).toBe('after-dark');
  });
});

describe('hooks', () => {
  it('awards XP, updates season ratings, and is idempotent per game', async () => {
    await saveRecord(db, rec('g1', 0), true);
    await saveRecord(db, rec('g1', 0), true); // duplicate delivery
    const xp = await db.prepare("SELECT xp FROM xp_state WHERE user_id = 'a'").first<{ xp: number }>();
    expect(xp?.xp).toBe(150); // 25 finish + 25 win, rated vs humans, + 100 first-dub achievement
    const sr = await db.prepare("SELECT games, wins FROM season_ratings WHERE user_id = 'a' AND season_id = '2027-01'").first<{ games: number; wins: number }>();
    expect(sr).toMatchObject({ games: 1, wins: 1 });
    const n = await db.prepare("SELECT COUNT(*) AS n FROM cred_processed").first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
  it('halves XP for bot tables', async () => {
    const botSeats = [
      { name: 'A', side: 0, kind: 'user', uid: 'a' },
      { name: 'B', side: 0, kind: 'bot' },
      { name: 'C', side: 1, kind: 'bot' },
      { name: 'D', side: 1, kind: 'bot' },
    ];
    const r = rec('g2', 0);
    (r as { seats: unknown }).seats = botSeats;
    await saveRecord(db, r, false);
    const xp = await db.prepare("SELECT xp FROM xp_state WHERE user_id = 'a'").first<{ xp: number }>();
    expect(xp?.xp).toBe(124); // 12 finish + 12 win (half), + 100 first-dub achievement
  });
  it('bumps challenge progress from game stats', async () => {
    await saveRecord(db, rec('g3', 0, NOW, { books: 16, shotsGiven: 3 }), true);
    const p = await progressFor(db, 'a', NOW);
    const all = [...p.daily, ...p.weekly];
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) {
      // kind-filtered challenges only move for their kind (cut-2 is cutthroat-only)
      if (c.kind && c.kind !== 'team') { expect(c.progress).toBe(0); continue; }
      if (c.metric === 'books') expect(c.progress).toBeGreaterThanOrEqual(16);
      if (c.metric === 'games') expect(c.progress).toBeGreaterThanOrEqual(1);
      if (c.metric === 'wins') expect(c.progress).toBeGreaterThanOrEqual(1);
      if (c.metric === 'shots_given') expect(c.progress).toBeGreaterThanOrEqual(3);
    }
    // at least one challenge saw the game
    expect(all.some((c) => c.progress > 0)).toBe(true);
  });
  it('unlocks first-dub from a real game end', async () => {
    await saveRecord(db, rec('g4', 0), true);
    const ua = await db.prepare("SELECT achievement_id FROM user_achievements WHERE user_id = 'a'").all<{ achievement_id: string }>();
    expect(ua.results.map((r) => r.achievement_id)).toContain('first-dub');
  });
});

describe('claim validation', () => {
  it('rejects incomplete and double claims, accepts complete ones', async () => {
    const tok = await session('a');
    // incomplete: no games played yet
    const daily = (await (await authed(tok, '/api/challenges')).json() as { daily: { id: string }[] }).daily;
    const target = daily[0]!;
    let res = await authed(tok, `/api/challenges/${target.id}/claim`, { method: 'POST' });
    expect(res.status).toBe(400);
    // complete it by hand (server-authoritative: progress rows are the truth)
    const pid = dailyPeriodId(NOW);
    const need = (await db.prepare('SELECT target, xp FROM challenge_defs WHERE id = ?').bind(target.id).first<{ target: number; xp: number }>())!;
    await db.prepare('INSERT INTO challenge_progress (user_id, challenge_id, period_id, progress) VALUES (?, ?, ?, ?)').bind('a', target.id, pid, need.target).run();
    res = await authed(tok, `/api/challenges/${target.id}/claim`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; xp: number; coins: number };
    expect(body.ok).toBe(true);
    expect(body.xp).toBe(need.xp);
    const xp = await db.prepare("SELECT xp FROM xp_state WHERE user_id = 'a'").first<{ xp: number }>();
    expect(xp?.xp).toBe(need.xp);
    // double claim rejected
    res = await authed(tok, `/api/challenges/${target.id}/claim`, { method: 'POST' });
    expect(res.status).toBe(400);
  });
  it('rejects challenges outside the current rotation', async () => {
    const tok = await session('a');
    const active = new Set([...dailyChallenges(NOW), ...weeklyChallenges(NOW)].map((c) => c.id));
    const inactive = ['win-2', 'books-15', 'games-4', 'nil-1', 'shots-3', 'streak-3', 'win-5', 'cut-2', 'books-60', 'games-20'].find((id) => !active.has(id))!;
    const res = await authed(tok, `/api/challenges/${inactive}/claim`, { method: 'POST' });
    expect(res.status).toBe(400);
  });
  it('requires sign-in', async () => {
    const url = new URL('/api/challenges', ORIGIN);
    const res = await handleCredHttp(new Request(url), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, ['api', 'challenges'], NOW);
    expect(res.status).toBe(401);
    const me = await handleCredHttp(new Request(new URL('/api/profile/me', ORIGIN)), { DB: db, PUBLIC_ORIGIN: ORIGIN }, new URL('/api/profile/me', ORIGIN), ['api', 'profile', 'me'], NOW);
    expect(me.status).toBe(401);
  });
});

describe('profile routes', () => {
  it('serves the full private profile and the public subset', async () => {
    await saveRecord(db, rec('g9', 0), true);
    const tok = await session('a');
    const res = await authed(tok, '/api/profile/me');
    expect(res.status).toBe(200);
    const me = await res.json() as any;
    expect(me.user).toMatchObject({ id: 'a', name: 'A' });
    expect(me.level.level).toBeGreaterThanOrEqual(1);
    expect(me.season.id).toBe('2027-01');
    expect(me.rank.team.division).toBeDefined();
    expect(me.stats.team).toBeDefined();
    expect(me.challenges.daily).toHaveLength(3);
    expect(me.achievements.length).toBeGreaterThan(0);
    // public view has no challenges/unlocks
    const pub = await handleCredHttp(new Request(new URL('/api/profile/a', ORIGIN)), { DB: db, PUBLIC_ORIGIN: ORIGIN }, new URL('/api/profile/a', ORIGIN), ['api', 'profile', 'a'], NOW);
    expect(pub.status).toBe(200);
    const body = await pub.json() as any;
    expect(body.user.id).toBe('a');
    expect(body.challenges).toBeUndefined();
    expect(body.unlocks).toBeUndefined();
    expect(body.rank.team).toBeDefined();
  });
  it('public profile carries the coin balance (owner: balances show on profiles)', async () => {
    const tok = await session('a');
    const me = await (await authed(tok, '/api/profile/me')).json() as any;
    expect(me.coins.balance).toBeGreaterThan(0); // welcome grant (1000) + first daily login
    const pub = await handleCredHttp(new Request(new URL('/api/profile/a', ORIGIN)), { DB: db, PUBLIC_ORIGIN: ORIGIN }, new URL('/api/profile/a', ORIGIN), ['api', 'profile', 'a'], NOW);
    expect(pub.status).toBe(200);
    const body = await pub.json() as any;
    expect(body.coins).toEqual({ balance: me.coins.balance });
    // a user who never loaded their own profile has no coin row yet: genuine 0, not an error
    const pubB = await handleCredHttp(new Request(new URL('/api/profile/b', ORIGIN)), { DB: db, PUBLIC_ORIGIN: ORIGIN }, new URL('/api/profile/b', ORIGIN), ['api', 'profile', 'b'], NOW);
    expect(pubB.status).toBe(200);
    expect((await pubB.json() as any).coins).toEqual({ balance: 0 });
  });
  it('public profile exposes XP progress for the shared header bar (owner: XP bar on every profile)', async () => {
    // 130 XP: level 2 starts at xpForLevel(1) = 125, so 5 into the level, xpForLevel(2) to go
    await awardXp(db, 'a', 130, NOW);
    const pub = await handleCredHttp(new Request(new URL('/api/profile/a', ORIGIN)), { DB: db, PUBLIC_ORIGIN: ORIGIN }, new URL('/api/profile/a', ORIGIN), ['api', 'profile', 'a'], NOW);
    expect(pub.status).toBe(200);
    const body = await pub.json() as any;
    expect(body.level.level).toBe(2);
    expect(body.level.xp).toBe(130);
    expect(body.level.xpIntoLevel).toBe(5);
    expect(body.level.xpForNext).toBe(xpForLevel(2));
    // the pair the web RepBlock renders must always agree with the raw totals
    expect(body.level.xpIntoLevel).toBe(body.level.xp - xpAtLevel(body.level.level));
    // and /api/profile/me shapes the same fields the same way
    const tok = await session('a');
    const me = await (await authed(tok, '/api/profile/me')).json() as any;
    expect(me.level.xpIntoLevel).toBe(body.level.xpIntoLevel);
    expect(me.level.xpForNext).toBe(body.level.xpForNext);
  });
  it('404s unknown users', async () => {
    const res = await handleCredHttp(new Request(new URL('/api/profile/zzz', ORIGIN)), { DB: db, PUBLIC_ORIGIN: ORIGIN }, new URL('/api/profile/zzz', ORIGIN), ['api', 'profile', 'zzz'], NOW);
    expect(res.status).toBe(404);
  });
});
