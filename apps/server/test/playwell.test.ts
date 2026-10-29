/**
 * Play-Well bonuses (owner, 2026-10-29): end-of-game bonus XP/coins for
 * in-game feats — Best Run tiers, Ran the Table, nil play, Set Them,
 * Comeback, Domination — computed server-side from the recorded game's
 * stats in the game-end cred pass, capped per game (40 XP) and per UTC
 * day (200 XP, the owner dial), halved per line in bot/unrated games
 * exactly the way base XP halves, idempotent per game, never touching
 * ratings, and never paid by story games (their rewards live elsewhere).
 *
 * Achievement XP is silenced in these fixtures (every achievement
 * pre-unlocked) so game-end XP totals are exactly base + bonus.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { ACHIEVEMENTS } from '../src/cred/achievements';
import { processGameCred } from '../src/cred/hooks';
import { balance } from '../src/cred/coins';
import { xpSnapshot } from '../src/cred/xp';
import {
  PLAY_WELL_DAILY_CAP_XP, PLAY_WELL_GAME_CAP_XP, bestRunXp, creditPlayWell,
  latestPlayWell, playWellLines, playWellPaidToday, settlePlayWell, type PlayWellLine,
} from '../src/cred/playwell';
import { buildRecord, saveRecord, type GameRecord, type PlayerGameStats, type SeatRef } from '../src/stats/record';
import { handleStoryHttp } from '../src/story/routes';
import { makeRules, scoreHand, type GameState } from '@spades/rules';

let db: D1Database;
const NOW = 1_800_000_000_000; // 2027-01-15 08:00 UTC
const ORIGIN = 'https://example.com';

const stats = (o: Partial<PlayerGameStats> = {}): PlayerGameStats => ({
  won: false, hands: 4, bids: 4, bidSum: 12, made: 3, set: 1, bags: 2, nilBids: 0, nilMade: 0, blindNilMade: 0,
  books: 12, maxBooksHand: 5, bestRun: 0, tableRuns: 0, maxDeficit: 0, foeEliminated: false, runItClaims: 0,
  shotsTaken: 1, shotsGiven: 0, wheels: 0, bjWins: 0, bidMs: 8000, bidN: 4, playMs: 20000, playN: 40, ...o,
});
const SEATS: SeatRef[] = [
  { name: 'A', side: 0, kind: 'user', uid: 'a' },
  { name: 'B', side: 0, kind: 'user', uid: 'b' },
  { name: 'C', side: 1, kind: 'user', uid: 'c' },
  { name: 'D', side: 1, kind: 'user', uid: 'd' },
];
function rec(id: string, o: { wonSide?: number; final?: number[]; at?: number; byUid?: Record<string, Partial<PlayerGameStats>> } = {}): GameRecord {
  const wonSide = o.wonSide ?? 0;
  const final = o.final ?? (wonSide === 0 ? [260, 200] : [200, 260]);
  return {
    id, room: 'R', mode: 'joker', kind: 'team', endedAt: o.at ?? NOW, hands: 4,
    final, winners: [wonSide], names: ['A', 'B', 'C', 'D'], seats: SEATS,
    players: SEATS.map((s, seat) => ({
      seat, uid: s.uid!, side: s.side, won: s.side === wonSide,
      partner: s.side === 0 ? (s.uid === 'a' ? 'b' : 'a') : (s.uid === 'c' ? 'd' : 'c'),
      teamName: null, stats: { ...stats(o.byUid?.[s.uid!]), won: s.side === wonSide },
    })),
  };
}
async function user(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id.toLowerCase(), 1).run();
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(`${id}-tok`), id, 1, NOW + 10_000_000).run();
  await db.batch(ACHIEVEMENTS.map((a) => db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').bind(id, a.id, 1)));
}
const pwRow = (gameId: string, uid: string) =>
  db.prepare('SELECT xp, coins, lines FROM cred_playwell WHERE game_id = ? AND user_id = ?').bind(gameId, uid)
    .first<{ xp: number; coins: number; lines: string }>();
const pwLines = async (gameId: string, uid: string): Promise<PlayWellLine[]> => JSON.parse((await pwRow(gameId, uid))!.lines) as PlayWellLine[];
const xpOf = async (uid: string) => (await xpSnapshot(db, uid)).xp;

// generous hook timeout: makeD1 replays every migration through sql.js,
// which runs long on a contended box (the suite is fast on a clean one)
beforeEach(async () => {
  db = await makeD1();
  for (const u of ['a', 'b', 'c', 'd']) await user(u);
}, 120_000);

describe('feat lines (pure)', () => {
  const lines = (o: Partial<PlayerGameStats>, won = false, finalMargin = 0) => playWellLines(stats(o), { won, finalMargin });

  it('best run pays the best tier reached, once — and nothing below 3', () => {
    expect(bestRunXp(2)).toBe(0);
    expect(bestRunXp(3)).toBe(4);
    expect(bestRunXp(4)).toBe(4);
    expect(bestRunXp(5)).toBe(8);
    expect(bestRunXp(6)).toBe(8);
    expect(bestRunXp(7)).toBe(14);
    expect(bestRunXp(9)).toBe(14);
    expect(bestRunXp(10)).toBe(22);
    expect(bestRunXp(13)).toBe(22);
    expect(lines({ bestRun: 2 })).toEqual([]);
    expect(lines({ bestRun: 6 })).toMatchObject([{ id: 'best-run', xp: 8 }]);
  });

  it('ran the table pays 25 XP and 15 coins per occurrence', () => {
    expect(lines({ tableRuns: 1 })).toMatchObject([{ id: 'ran-table', xp: 25, coins: 15 }]);
    expect(lines({ tableRuns: 2 })).toMatchObject([{ id: 'ran-table', xp: 50, coins: 30 }]);
  });

  it('a made blind nil pays 12 in place of the nil 6, never both', () => {
    expect(lines({ nilMade: 1 })).toMatchObject([{ id: 'nil', xp: 6 }]);
    expect(lines({ nilMade: 1, blindNilMade: 1 })).toMatchObject([{ id: 'blind-nil', xp: 12 }]);
    const both = lines({ nilMade: 3, blindNilMade: 1 });
    expect(both).toMatchObject([{ id: 'nil', xp: 12 }, { id: 'blind-nil', xp: 12 }]);
  });

  it('set them pays 4 per set, sub-capped at 12', () => {
    expect(lines({ shotsGiven: 1 })).toMatchObject([{ id: 'set-them', xp: 4 }]);
    expect(lines({ shotsGiven: 3 })).toMatchObject([{ id: 'set-them', xp: 12 }]);
    expect(lines({ shotsGiven: 5 })).toMatchObject([{ id: 'set-them', xp: 12 }]);
  });

  it('comeback needs a win after trailing by 100+ at a hand\'s end', () => {
    expect(lines({ maxDeficit: 99 }, true)).toEqual([]);
    expect(lines({ maxDeficit: 100 }, true)).toMatchObject([{ id: 'comeback', xp: 10 }]);
    expect(lines({ maxDeficit: 140 }, false)).toEqual([]);
  });

  it('domination needs a win by 150+', () => {
    expect(lines({}, true, 149)).toEqual([]);
    expect(lines({}, true, 150)).toMatchObject([{ id: 'domination', xp: 8 }]);
    expect(lines({}, false, 300)).toEqual([]);
    expect(lines({}, true, -30)).toEqual([]); // a shot-out win is not a blowout
  });
});

describe('settlement (pure): half rate, caps', () => {
  const L = (id: string, xp: number, coins = 0): PlayWellLine => ({ id, label: id, xp, coins });

  it('halves per line, floored like base (25 → 12), coins included', () => {
    const s = settlePlayWell([L('best-run', 14), L('ran-table', 25, 15), L('nil', 6)], { half: true, dailyAllowance: 200 });
    expect(s.lines).toMatchObject([{ xp: 7 }, { xp: 12, coins: 7 }, { xp: 3 }]);
    expect(s.xp).toBe(22);
    expect(s.coins).toBe(7);
  });

  it('the per-game cap trims lines in order; coins are never trimmed', () => {
    const s = settlePlayWell([L('best-run', 22), L('ran-table', 25, 15), L('blind-nil', 12)], { half: false, dailyAllowance: 200 });
    expect(s.xp).toBe(PLAY_WELL_GAME_CAP_XP);
    expect(s.lines).toMatchObject([{ id: 'best-run', xp: 22 }, { id: 'ran-table', xp: 18, coins: 15 }]);
    expect(s.coins).toBe(15);
  });

  it('a line whose XP trims to zero survives on its coins alone', () => {
    const s = settlePlayWell([L('best-run', 40), L('ran-table', 10, 15)], { half: false, dailyAllowance: 200 });
    expect(s.lines).toMatchObject([{ id: 'best-run', xp: 40 }, { id: 'ran-table', xp: 0, coins: 15 }]);
    expect(s.xp).toBe(40);
  });

  it('the daily allowance trims what the game cap would have paid', () => {
    expect(settlePlayWell([L('best-run', 22)], { half: false, dailyAllowance: 10 }).xp).toBe(10);
    expect(settlePlayWell([L('nil', 6)], { half: false, dailyAllowance: 0 }).lines).toEqual([]);
  });
});

describe('crediting (game end)', () => {
  it('pays the exact feats at full rate in a rated game, on top of base XP', async () => {
    // a: run of 5 (+8), a made nil (+6), one set (+4), comeback (+10); margin 60 → no domination
    await saveRecord(db, rec('pw1', { byUid: { a: { bestRun: 5, nilMade: 1, shotsGiven: 1, maxDeficit: 130 } } }), true);
    const row = await pwRow('pw1', 'a');
    expect(row?.xp).toBe(28);
    expect(row?.coins).toBe(0);
    expect((await pwLines('pw1', 'a')).map((l) => l.id)).toEqual(['best-run', 'nil', 'set-them', 'comeback']);
    expect(await xpOf('a')).toBe(50 + 28); // base 25 finish + 25 win, achievements silenced
    // a feat-less partner still gets a row — an empty one (it shadows older games on the rewards screen)
    const bRow = await pwRow('pw1', 'b');
    expect(bRow?.xp).toBe(0);
    expect(JSON.parse(bRow!.lines)).toEqual([]);
    expect(await xpOf('b')).toBe(50);
    // the profile payload source carries the same lines
    const latest = await latestPlayWell(db, 'a');
    expect(latest?.gameId).toBe('pw1');
    expect(latest?.xp).toBe(28);
  });

  it('ran the table pays its coins through the ledger', async () => {
    await saveRecord(db, rec('pw2', { byUid: { a: { tableRuns: 1 } } }), true);
    const row = await pwRow('pw2', 'a');
    expect(row).toMatchObject({ xp: 25, coins: 15 });
    expect(await balance(db, 'a')).toBe(15);
    const ledger = await db.prepare("SELECT reason FROM coin_ledger WHERE user_id = 'a'").all<{ reason: string }>();
    expect(ledger.results.map((r) => r.reason)).toEqual(['play_well']);
  });

  it('bot/unrated games pay bonuses at the base half rate', async () => {
    const botSeats: SeatRef[] = [
      { name: 'A', side: 0, kind: 'user', uid: 'a' },
      { name: 'B', side: 0, kind: 'bot' },
      { name: 'C', side: 1, kind: 'bot' },
      { name: 'D', side: 1, kind: 'bot' },
    ];
    const r = rec('pw3', { byUid: { a: { bestRun: 7, nilMade: 1 } } });
    (r as { seats: unknown }).seats = botSeats;
    r.players = r.players.filter((p) => p.uid === 'a');
    await saveRecord(db, r, false);
    // full rate would be 14 + 6 = 20; halved per line: 7 + 3 = 10
    expect((await pwRow('pw3', 'a'))?.xp).toBe(10);
    expect(await xpOf('a')).toBe(24 + 10); // base halves the same way: 12 + 12
  });

  it('the per-game cap binds at 40', async () => {
    await saveRecord(db, rec('pw4', { byUid: { a: { bestRun: 13, tableRuns: 1, blindNilMade: 1, nilMade: 1 } } }), true);
    const row = await pwRow('pw4', 'a');
    expect(row?.xp).toBe(40);
    expect(row?.coins).toBe(15); // table coins ride outside the XP cap
  });

  it('the daily cap binds across games, and a capped-out game still writes its (empty) row', async () => {
    await db.prepare('INSERT INTO cred_playwell (game_id, user_id, xp, coins, lines, ended_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('seed-game', 'a', PLAY_WELL_DAILY_CAP_XP - 10, 0, '[]', NOW - 1000).run();
    await saveRecord(db, rec('pw5', { byUid: { a: { bestRun: 13 } } }), true);
    expect((await pwRow('pw5', 'a'))?.xp).toBe(10); // only 10 of the day's 200 left
    expect(await playWellPaidToday(db, 'a', NOW)).toBe(PLAY_WELL_DAILY_CAP_XP);
    await saveRecord(db, rec('pw6', { at: NOW + 60_000, byUid: { a: { bestRun: 13 } } }), true);
    const capped = await pwRow('pw6', 'a');
    expect(capped?.xp).toBe(0);
    expect(JSON.parse(capped!.lines)).toEqual([]);
    // ...and the NEXT UTC day pays again
    await saveRecord(db, rec('pw7', { at: NOW + 86_400_000, byUid: { a: { bestRun: 13 } } }), true);
    expect((await pwRow('pw7', 'a'))?.xp).toBe(22);
  });

  it('a repost never double-pays — at the record gate or the bonus gate', async () => {
    const r = rec('pw8', { byUid: { a: { bestRun: 5 } } });
    await saveRecord(db, r, true);
    await saveRecord(db, r, true); // duplicate delivery
    expect(await xpOf('a')).toBe(50 + 8);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM cred_playwell WHERE game_id = 'pw8'").first<{ n: number }>();
    expect(n?.n).toBe(4); // one row per user, not eight
    // the bonus gate itself: crediting the same (game, player) twice pays once
    const first = await creditPlayWell(db, { gameId: 'pw8b', userId: 'a', stats: stats({ bestRun: 5 }), won: true, finalMargin: 60, half: false, endedAt: NOW });
    const second = await creditPlayWell(db, { gameId: 'pw8b', userId: 'a', stats: stats({ bestRun: 5 }), won: true, finalMargin: 60, half: false, endedAt: NOW });
    expect(first.xp).toBe(8);
    expect(second.xp).toBe(0);
    expect(await xpOf('a')).toBe(50 + 8 + 8);
  });

  it('bonuses never move ratings: same side, same result, same elo — feats or not', async () => {
    await saveRecord(db, rec('pw9', { byUid: { a: { bestRun: 13, tableRuns: 1, nilMade: 2, shotsGiven: 3, maxDeficit: 200 } }, final: [500, 100] }), true);
    const elo = async (uid: string) => (await db.prepare('SELECT elo_after FROM game_players WHERE game_id = ? AND user_id = ?').bind('pw9', uid).first<{ elo_after: number }>())?.elo_after;
    expect(await elo('a')).toBe(await elo('b'));
    expect(await pwRow('pw9', 'a')).toMatchObject({ xp: 40 }); // the feats DID pay (capped)
  });

  it('cutthroat credits through the same pass, with per-side margins', async () => {
    const cutSeats: SeatRef[] = [
      { name: 'A', side: 0, kind: 'user', uid: 'a' },
      { name: 'B', side: 1, kind: 'user', uid: 'b' },
      { name: 'C', side: 2, kind: 'user', uid: 'c' },
      { name: 'D', side: 3, kind: 'user', uid: 'd' },
    ];
    const r: GameRecord = {
      id: 'pw10', room: 'R', mode: 'joker', kind: 'cutthroat', endedAt: NOW, hands: 4,
      final: [500, 200, 150, 100], winners: [0], names: ['A', 'B', 'C', 'D'], seats: cutSeats,
      players: cutSeats.map((s, seat) => ({
        seat, uid: s.uid!, side: s.side, won: s.side === 0, partner: null, teamName: null,
        stats: { ...stats(s.uid === 'a' ? { shotsGiven: 2 } : {}), won: s.side === 0 },
      })),
    };
    await saveRecord(db, r, true);
    // a: set them ×2 (+8) and a 300-point win margin (+8 domination)
    expect((await pwRow('pw10', 'a'))?.xp).toBe(16);
    expect(await xpOf('a')).toBe(50 + 16);
  });

  it('an abandoned game pays no bonuses to anyone', async () => {
    const r = rec('pw11', { byUid: { a: { bestRun: 13, tableRuns: 1 } } });
    await saveRecord(db, r, false, { endReason: 'abandoned', leaverId: 'a' });
    const n = await db.prepare('SELECT COUNT(*) AS n FROM cred_playwell').first<{ n: number }>();
    expect(n?.n).toBe(0);
    expect(await latestPlayWell(db, 'a')).toBeNull();
  });

  it('a feat-less game writes an empty row that shadows the previous game\'s lines', async () => {
    await saveRecord(db, rec('pw12a', { byUid: { a: { bestRun: 5 } } }), true);
    expect((await latestPlayWell(db, 'a'))?.lines).toHaveLength(1);
    await saveRecord(db, rec('pw12b', { at: NOW + 1000 }), true);
    const latest = await latestPlayWell(db, 'a');
    expect(latest?.gameId).toBe('pw12b');
    expect(latest?.lines).toEqual([]);
  });

  it('processGameCred stays idempotent against a direct second pass', async () => {
    const r = rec('pw13', { byUid: { a: { bestRun: 5 } } });
    await processGameCred(db, r, { rated: true, endReason: 'finished', leaverId: null, venue: null }, {});
    await processGameCred(db, r, { rated: true, endReason: 'finished', leaverId: null, venue: null }, {});
    expect(await xpOf('a')).toBe(50 + 8);
  });
});

describe('history derivation (buildRecord)', () => {
  it('bestRun and tableRuns come from the engine-stamped hand records', () => {
    const rules = makeRules('joker');
    let scores = [0, 0];
    let bags = [0, 0];
    const mk = (handNo: number, bids: number[], tricks: number[], bestRuns?: number[]) => {
      const sides = scoreHand(rules, bids as never, tricks, scores, bags);
      scores = sides.map((s) => s.totalScore);
      bags = sides.map((s) => s.totalBags);
      return { handNo, dealer: 0, bids: [...bids], tricksWon: [...tricks], sides, ...(bestRuns ? { bestRuns } : {}) };
    };
    const history = [
      mk(1, [4, 3, 3, 3], [3, 5, 3, 2], [2, 5, 1, 2]),
      mk(2, [4, 3, 3, 3], [13, 0, 0, 0], [13, 0, 0, 0]), // seat 0 takes every book
      mk(3, [4, 3, 3, 3], [4, 3, 3, 3]), // a legacy hand: no stamp — contributes nothing
    ];
    const game = {
      rules, seed: 'pw', phase: 'gameOver', handNo: 3, dealer: 0, turn: null,
      hands: [[], [], [], []], bids: [null, null, null, null], revealed: [true, true, true, true],
      exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: [0, 0, 0, 0],
      spadesBroken: true, scores, bags, history,
      result: { endReason: 'target', finalScores: scores, placements: [1, 2], winners: [0] },
    } as unknown as GameState;
    const r = buildRecord({ id: 'pw14', room: 'R', game, seats: SEATS, names: ['A', 'B'], endedAt: NOW });
    expect(r.players[0]!.stats.bestRun).toBe(13);
    expect(r.players[0]!.stats.tableRuns).toBe(1);
    expect(r.players[1]!.stats.bestRun).toBe(5);
    expect(r.players[1]!.stats.tableRuns).toBe(0);
  });
});

describe('story games pay no Play-Well bonuses', () => {
  it('a story result credits only the stop reward — no bonus row, no bonus XP', async () => {
    const call = (path: string, init?: RequestInit) => handleStoryHttp(
      new Request(new URL(path, ORIGIN), init),
      { DB: db, PUBLIC_ORIGIN: ORIGIN, ADMIN_USERNAMES: 'A,C' } as never,
      new URL(path, ORIGIN), path.split('/').filter(Boolean), NOW,
    );
    const res = await call('/api/story/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: '__Host-bwm_sid=a-tok' },
      body: JSON.stringify({ stopId: 'porch', won: true, gameId: 'pw-story-1' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rewards: { xp: number; coins: number } };
    expect(body.rewards.xp).toBe(25); // the Porch first-clear reward, exactly
    expect(await xpOf('a')).toBe(25); // no base game XP, no Play-Well bonus on top
    const n = await db.prepare('SELECT COUNT(*) AS n FROM cred_playwell').first<{ n: number }>();
    expect(n?.n).toBe(0);
    expect(await latestPlayWell(db, 'a')).toBeNull();
  });
});
