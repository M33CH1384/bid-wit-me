/**
 * Made Wheels — the per-make Play-Well bonus (owner, 2026-11-09: "Add a
 * per-make Wheels bonus").
 *
 * The feat is the recorded game's own wheels count: the exact predicate
 * stats/record.ts folds from the hand records (partnership: a side
 * contract of 10+ that was MADE, or a books-bid-themselves hand where the
 * side took 10+ books; cutthroat: a player took 10+ books). One
 * definition across the stats, the 'Wheels Up' achievement, the car, and
 * now this bonus — a set Wheels pays nothing, and 10 books without the
 * made 10+ contract pays nothing either.
 *
 * The bonus pays 25 XP per made-Wheels hand to each player on the making
 * side, OUTSIDE the family's 40 XP/game cap (the Forced-the-Toss
 * exemption's reasoning: the feat cannot be forced at will — it needs a
 * 10+ contract AND the books), at the family's half rate in bot/unrated
 * games, and inside the 200 XP/day ledger like every other line. No
 * coins per make — the one-time 'Wheels Up' achievement's 100 coins stay
 * the feat's only coin payout. Story games never reach Play-Well.
 *
 * Achievement XP is silenced in the DB fixtures (every achievement
 * pre-unlocked) so game-end XP totals are exactly base + bonus.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type Bid, type GameState, type HandRecord, type TableRules,
  makeRules, scoreHand,
} from '@spades/rules';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { ACHIEVEMENTS } from '../src/cred/achievements';
import { balance } from '../src/cred/coins';
import { xpSnapshot } from '../src/cred/xp';
import {
  FORCED_TOSS_XP, MADE_WHEELS_LINE_ID, MADE_WHEELS_XP, PLAY_WELL_DAILY_CAP_XP,
  PLAY_WELL_GAME_CAP_XP, creditPlayWell, latestPlayWell, playWellLines,
  settlePlayWell, type PlayWellLine,
} from '../src/cred/playwell';
import { buildRecord, saveRecord, type GameRecord, type PlayerGameStats, type SeatRef } from '../src/stats/record';
import { handleStoryHttp } from '../src/story/routes';

const NOW = 1_800_000_000_000; // 2027-01-15 08:00 UTC
const ORIGIN = 'https://example.com';
const rules: TableRules = { ...makeRules('joker'), firstHandBidsItself: false };
const cutRules: TableRules = makeRules('cutthroat');

/* ------------------------------------------------------------------ */
/* buildRecord fixtures (real hand records via scoreHand)              */
/* ------------------------------------------------------------------ */

const SEATS: SeatRef[] = [
  { name: 'A', side: 0, kind: 'user', uid: 'a' },
  { name: 'B', side: 1, kind: 'user', uid: 'b' },
  { name: 'C', side: 0, kind: 'user', uid: 'c' },
  { name: 'D', side: 1, kind: 'user', uid: 'd' },
];
const CUT_SEATS: SeatRef[] = [
  { name: 'A', side: 0, kind: 'user', uid: 'a' },
  { name: 'B', side: 1, kind: 'user', uid: 'b' },
  { name: 'C', side: 2, kind: 'user', uid: 'c' },
  { name: 'D', side: 3, kind: 'user', uid: 'd' },
];

function shell(r: TableRules, history: HandRecord[], result: GameState['result'] = null): GameState {
  return {
    rules: r, seed: 'wheels', phase: 'gameOver', handNo: history.length, dealer: 0, turn: null,
    hands: [[], [], [], []], bids: [null, null, null, null], revealed: [true, true, true, true],
    exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: [0, 0, 0, 0],
    spadesBroken: true, scores: r.partnerships ? [0, 0] : [0, 0, 0, 0], bags: r.partnerships ? [0, 0] : [0, 0, 0, 0], history, result,
  } as GameState;
}

/** A played-out hand record (normal scoring), built the way the engine builds it. */
function played(r: TableRules, handNo: number, bids: Bid[], tricks: number[]): HandRecord {
  const zeros = r.partnerships ? [0, 0] : [0, 0, 0, 0];
  return { handNo, dealer: 0, bids: [...bids], tricksWon: [...tricks], sides: scoreHand(r, bids, tricks, zeros, zeros) };
}

const statsOf = (rec: ReturnType<typeof buildRecord>, uid: string) => rec.players.find((p) => p.uid === uid)!.stats;
const teamRec = (id: string, history: HandRecord[]) =>
  buildRecord({ id, room: 'R', game: shell(rules, history), seats: SEATS, names: ['A', 'B', 'C', 'D'], endedAt: NOW });

/* ------------------------------------------------------------------ */
/* (8) predicate parity: the bonus counts exactly the hands record.ts  */
/* counts as wheels — partnership made / books hand / cutthroat        */
/* ------------------------------------------------------------------ */

describe('buildRecord — the wheels predicate the bonus rides', () => {
  it('a made 10+ contract counts once, for both partners of the making side', () => {
    // side 0 bids 6+4 = 10 and takes 6+4 = 10; side 1 bids 6, takes 3
    const rec = teamRec('w1', [played(rules, 1, [6, 3, 4, 3], [6, 2, 4, 1])]);
    for (const uid of ['a', 'c']) expect(statsOf(rec, uid).wheels).toBe(1);
    for (const uid of ['b', 'd']) expect(statsOf(rec, uid).wheels).toBe(0);
  });

  it('a SET Wheels pays nothing — even when the side still took 10 books on a bigger call', () => {
    // side 0 bids 6+4 = 10, takes 9 → set
    const set10 = teamRec('w2', [played(rules, 1, [6, 3, 4, 3], [5, 4, 4, 0])]);
    for (const uid of ['a', 'b', 'c', 'd']) expect(statsOf(set10, uid).wheels).toBe(0);
    // side 0 bids 7+5 = 12, takes 10 → still a set (the contract is the bar, not a flat 10)
    const set12 = teamRec('w3', [played(rules, 1, [7, 3, 5, 3], [6, 2, 4, 1])]);
    for (const uid of ['a', 'b', 'c', 'd']) expect(statsOf(set12, uid).wheels).toBe(0);
  });

  it('a made contract above 10 counts too (the predicate is contract ≥ 10, made)', () => {
    const rec = teamRec('w4', [played(rules, 1, [7, 3, 5, 3], [7, 2, 5, 1])]); // 12 bid, 12 taken
    for (const uid of ['a', 'c']) expect(statsOf(rec, uid).wheels).toBe(1);
  });

  it('a books-bid-themselves hand counts when the side takes 10+, and not at 9', () => {
    const ten = teamRec('w5', [played(rules, 1, ['books', 'books', 'books', 'books'], [6, 3, 4, 0])]);
    for (const uid of ['a', 'c']) expect(statsOf(ten, uid).wheels).toBe(1);
    for (const uid of ['b', 'd']) expect(statsOf(ten, uid).wheels).toBe(0);
    const nine = teamRec('w6', [played(rules, 1, ['books', 'books', 'books', 'books'], [5, 4, 4, 0])]);
    for (const uid of ['a', 'b', 'c', 'd']) expect(statsOf(nine, uid).wheels).toBe(0);
  });

  it('an ordinary hand counts nothing, and made Wheels accumulate per hand', () => {
    const rec = teamRec('w7', [
      played(rules, 1, [3, 3, 2, 3], [3, 3, 2, 5]),
      played(rules, 2, [6, 3, 4, 3], [6, 2, 4, 1]),
      played(rules, 3, [6, 3, 4, 3], [6, 2, 4, 1]),
    ]);
    for (const uid of ['a', 'c']) expect(statsOf(rec, uid).wheels).toBe(2);
  });

  it('cutthroat: a player who took 10+ books counts; 9 does not', () => {
    const rec = buildRecord({
      id: 'w8', room: 'R', seats: CUT_SEATS, names: ['A', 'B', 'C', 'D'], endedAt: NOW,
      game: shell(cutRules, [played(cutRules, 1, [4, 4, 4, 4], [10, 1, 1, 1])]),
    });
    expect(statsOf(rec, 'a').wheels).toBe(1);
    for (const uid of ['b', 'c', 'd']) expect(statsOf(rec, uid).wheels).toBe(0);
  });

  it('parity: the bonus line for every recorded player is exactly 25 × that player’s wheels count', () => {
    const games = [
      teamRec('p1', [played(rules, 1, [6, 3, 4, 3], [6, 2, 4, 1])]),
      teamRec('p2', [played(rules, 1, [6, 3, 4, 3], [5, 4, 4, 0])]),
      teamRec('p3', [played(rules, 1, ['books', 'books', 'books', 'books'], [6, 3, 4, 0])]),
      teamRec('p4', [played(rules, 1, [7, 3, 5, 3], [6, 2, 4, 1])]),
      buildRecord({
        id: 'p5', room: 'R', seats: CUT_SEATS, names: ['A', 'B', 'C', 'D'], endedAt: NOW,
        game: shell(cutRules, [played(cutRules, 1, [4, 4, 4, 4], [10, 1, 1, 1])]),
      }),
    ];
    for (const g of games) for (const p of g.players) {
      const line = playWellLines(p.stats, { won: p.won, finalMargin: 0 }).find((l) => l.id === MADE_WHEELS_LINE_ID);
      expect(line?.xp ?? 0).toBe(MADE_WHEELS_XP * p.stats.wheels);
      expect(line?.coins ?? 0).toBe(0);
    }
  });
});

/* ------------------------------------------------------------------ */
/* the Made Wheels line (pure): amount, cap exemption, half, ledger    */
/* ------------------------------------------------------------------ */

const base = (o: Partial<PlayerGameStats> = {}): PlayerGameStats => ({
  won: false, hands: 4, bids: 4, bidSum: 12, made: 3, set: 1, bags: 2, nilBids: 0, nilMade: 0, blindNilMade: 0,
  books: 12, maxBooksHand: 5, bestRun: 0, tableRuns: 0, maxDeficit: 0, foeEliminated: false, runItClaims: 0,
  shotsTaken: 1, shotsGiven: 0, tkoDealt: 0, tkoSuffered: 0, tossesForced: 0, tossesConceded: 0, wheels: 0, bjWins: 0,
  bidMs: 8000, bidN: 4, playMs: 20000, playN: 40, ...o,
});

describe('the Made Wheels line', () => {
  it('(1) pays 25 XP per make, named like the feat; nothing at zero', () => {
    const one = playWellLines(base({ wheels: 1 }), { won: true, finalMargin: 60 });
    expect(one).toContainEqual({ id: 'made-wheels', label: 'Made Wheels', xp: MADE_WHEELS_XP, coins: 0 });
    expect(playWellLines(base(), { won: true, finalMargin: 60 }).some((l) => l.id === 'made-wheels')).toBe(false);
  });

  it('(3) two makes in one game pay twice, itemised ×2', () => {
    const two = playWellLines(base({ wheels: 2 }), { won: true, finalMargin: 60 });
    expect(two).toContainEqual({ id: 'made-wheels', label: 'Made Wheels ×2', xp: 2 * MADE_WHEELS_XP, coins: 0 });
  });

  it('(4) settles OUTSIDE the 40 XP game cap, in full alongside a maxed family', () => {
    // family feats alone saturate the cap (best run 22 + set them 12 + comeback 10 = 44 → 40)
    const lines = playWellLines(base({ bestRun: 10, shotsGiven: 3, maxDeficit: 120, wheels: 1 }), { won: true, finalMargin: 60 });
    const settled = settlePlayWell(lines, { half: false, dailyAllowance: 200 });
    expect(settled.xp).toBe(PLAY_WELL_GAME_CAP_XP + MADE_WHEELS_XP);
    expect(settled.lines.find((l) => l.id === 'made-wheels')).toMatchObject({ xp: 25 });
  });

  it('(6) settles at the family half rate in bot/unrated games (25 → 12, the toss rounding)', () => {
    const lines = playWellLines(base({ wheels: 1 }), { won: true, finalMargin: 60 });
    const settled = settlePlayWell(lines, { half: true, dailyAllowance: 200 });
    expect(settled.lines).toEqual([{ id: 'made-wheels', label: 'Made Wheels', xp: 12, coins: 0 }]);
    expect(settled.xp).toBe(12);
  });

  it('(5) trims against the day’s remaining allowance exactly like the toss line', () => {
    const lines: PlayWellLine[] = [
      { id: 'best-run', label: 'Best run — 10 books in a row', xp: 22, coins: 0 },
      { id: 'made-wheels', label: 'Made Wheels', xp: 25, coins: 0 },
    ];
    // 30 left today: the family takes 22, Made Wheels gets the 8 that remain
    const settled = settlePlayWell(lines, { half: false, dailyAllowance: 30 });
    expect(settled.xp).toBe(30);
    expect(settled.lines.find((l) => l.id === 'made-wheels')).toMatchObject({ xp: 8 });
    // nothing left today: no line at all
    expect(settlePlayWell(lines, { half: false, dailyAllowance: 0 }).lines.some((l) => l.id === 'made-wheels')).toBe(false);
  });

  it('shares the one daily ledger with the toss line, in display order', () => {
    // 50 left today: family 22, then the two exempt lines draw what remains
    const lines = playWellLines(base({ bestRun: 10, tossesForced: 1, wheels: 1 }), { won: true, finalMargin: 60 });
    const settled = settlePlayWell(lines, { half: false, dailyAllowance: 50 });
    expect(settled.xp).toBe(50);
    expect(settled.lines.find((l) => l.id === 'forced-toss')).toMatchObject({ xp: FORCED_TOSS_XP });
    expect(settled.lines.find((l) => l.id === 'made-wheels')).toMatchObject({ xp: 3 });
  });
});

/* ------------------------------------------------------------------ */
/* end-to-end crediting through the game-end cred pass                 */
/* ------------------------------------------------------------------ */

let db: D1Database;
const PW_SEATS: SeatRef[] = [
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
    final, winners: [wonSide], names: ['A', 'B', 'C', 'D'], seats: PW_SEATS,
    players: PW_SEATS.map((s, seat) => ({
      seat, uid: s.uid!, side: s.side, won: s.side === wonSide,
      partner: s.side === 0 ? (s.uid === 'a' ? 'b' : 'a') : (s.uid === 'c' ? 'd' : 'c'),
      teamName: null, stats: { ...base(o.byUid?.[s.uid!]), won: s.side === wonSide },
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

beforeEach(async () => {
  db = await makeD1();
  for (const u of ['a', 'b', 'c', 'd']) await user(u);
}, 120_000);

describe('crediting (game end)', () => {
  it('(1) pays 25 to EACH player on the making side, itemised as Made Wheels; no coins', async () => {
    await saveRecord(db, rec('wb1', { byUid: { a: { wheels: 1 }, b: { wheels: 1 } } }), true);
    for (const uid of ['a', 'b']) {
      const row = await pwRow('wb1', uid);
      expect(row?.xp).toBe(25);
      expect(row?.coins).toBe(0);
      expect(await pwLines('wb1', uid)).toEqual([{ id: 'made-wheels', label: 'Made Wheels', xp: 25, coins: 0 }]);
      expect(await xpOf(uid)).toBe(50 + 25); // base 25 finish + 25 win, achievements silenced
      expect(await balance(db, uid)).toBe(0); // a make pays no coins
    }
    for (const uid of ['c', 'd']) {
      expect((await pwRow('wb1', uid))?.xp).toBe(0);
      expect(await pwLines('wb1', uid)).toEqual([]);
    }
    // the rewards screen's source carries the same line
    expect((await latestPlayWell(db, 'a'))?.lines).toEqual([{ id: 'made-wheels', label: 'Made Wheels', xp: 25, coins: 0 }]);
  });

  it('(2) a game whose recorded stats carry no made Wheels pays no Made Wheels', async () => {
    await saveRecord(db, rec('wb2', { byUid: { a: { bestRun: 5 }, b: { bestRun: 5 } } }), true);
    expect((await pwLines('wb2', 'a')).some((l) => l.id === 'made-wheels')).toBe(false);
    expect((await pwRow('wb2', 'a'))?.xp).toBe(8); // the best-run line alone
  });

  it('(3) two made-Wheels hands in one game pay twice', async () => {
    await saveRecord(db, rec('wb3', { byUid: { a: { wheels: 2 }, b: { wheels: 2 } } }), true);
    expect((await pwRow('wb3', 'a'))?.xp).toBe(50);
    expect(await pwLines('wb3', 'a')).toEqual([{ id: 'made-wheels', label: 'Made Wheels ×2', xp: 50, coins: 0 }]);
  });

  it('(4) pays in full on top of a maxed 40-cap game', async () => {
    await saveRecord(db, rec('wb4', { byUid: { a: { bestRun: 13, tableRuns: 1, wheels: 1 } } }), true);
    const row = await pwRow('wb4', 'a');
    expect(row?.xp).toBe(40 + 25);
    expect(row?.coins).toBe(15); // the table-run coins, as ever; the make adds none
    expect((await pwLines('wb4', 'a')).find((l) => l.id === 'made-wheels')).toMatchObject({ xp: 25 });
  });

  it('(5) the 200/day ledger trims and then blocks the line like every other', async () => {
    await db.prepare('INSERT INTO cred_playwell (game_id, user_id, xp, coins, lines, ended_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind('seed-game', 'a', PLAY_WELL_DAILY_CAP_XP - 10, 0, '[]', NOW - 1000).run();
    await saveRecord(db, rec('wb5', { byUid: { a: { wheels: 1 } } }), true);
    const row = await pwRow('wb5', 'a');
    expect(row?.xp).toBe(10); // only 10 of the day's 200 left
    expect((await pwLines('wb5', 'a'))).toEqual([{ id: 'made-wheels', label: 'Made Wheels', xp: 10, coins: 0 }]);
    await saveRecord(db, rec('wb6', { at: NOW + 60_000, byUid: { a: { wheels: 1 } } }), true);
    const capped = await pwRow('wb6', 'a');
    expect(capped?.xp).toBe(0);
    expect(JSON.parse(capped!.lines)).toEqual([]);
  });

  it('(6) a bot game pays the half rate (25 → 12)', async () => {
    const botSeats: SeatRef[] = [
      { name: 'A', side: 0, kind: 'user', uid: 'a' },
      { name: 'B', side: 0, kind: 'bot' },
      { name: 'C', side: 1, kind: 'bot' },
      { name: 'D', side: 1, kind: 'bot' },
    ];
    const r = rec('wb7', { byUid: { a: { wheels: 1 } } });
    (r as { seats: unknown }).seats = botSeats;
    r.players = r.players.filter((p) => p.uid === 'a');
    await saveRecord(db, r, false);
    expect((await pwRow('wb7', 'a'))?.xp).toBe(12);
    expect(await xpOf('a')).toBe(24 + 12); // base halves the same way
  });

  it('cutthroat pays the maker through the same pass', async () => {
    const r: GameRecord = {
      id: 'wb8', room: 'R', mode: 'cutthroat', kind: 'cutthroat', endedAt: NOW, hands: 4,
      final: [260, 200, 150, 100], winners: [0], names: ['A', 'B', 'C', 'D'], seats: CUT_SEATS,
      players: CUT_SEATS.map((s, seat) => ({
        seat, uid: s.uid!, side: s.side, won: s.side === 0, partner: null, teamName: null,
        stats: { ...base(s.uid === 'a' ? { wheels: 1 } : {}), won: s.side === 0 },
      })),
    };
    await saveRecord(db, r, true);
    expect((await pwRow('wb8', 'a'))?.xp).toBe(25);
    expect(await pwLines('wb8', 'a')).toEqual([{ id: 'made-wheels', label: 'Made Wheels', xp: 25, coins: 0 }]);
    expect(await xpOf('a')).toBe(50 + 25);
  });

  it('credits through creditPlayWell into the itemisation the results screen reads', async () => {
    const award = await creditPlayWell(db, {
      gameId: 'wb9', userId: 'a', stats: base({ wheels: 2, bestRun: 10 }), won: true, finalMargin: 60, half: false, endedAt: NOW,
    });
    // best run 22 (inside the cap) + 2 × 25 Made Wheels (outside it)
    expect(award.xp).toBe(22 + 50);
    expect((await latestPlayWell(db, 'a'))?.lines).toContainEqual({ id: 'made-wheels', label: 'Made Wheels ×2', xp: 50, coins: 0 });
  });
});

describe('(7) story games pay no Play-Well bonuses', () => {
  it('a story result credits only the stop reward — no bonus row, no bonus XP', async () => {
    const call = (path: string, init?: RequestInit) => handleStoryHttp(
      new Request(new URL(path, ORIGIN), init),
      { DB: db, PUBLIC_ORIGIN: ORIGIN, ADMIN_USERNAMES: 'A,C' } as never,
      new URL(path, ORIGIN), path.split('/').filter(Boolean), NOW,
    );
    const res = await call('/api/story/result', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: '__Host-bwm_sid=a-tok' },
      body: JSON.stringify({ stopId: 'porch', won: true, gameId: 'wb-story-1' }),
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
