/**
 * 1st Round TKO as a major stat (owner, 2026-11-05).
 *
 * The counters ride the per-game stats JSON buildRecord already writes
 * (the shotsGiven/shotsTaken/wheels pattern — no migration), computed
 * from the engine's own hand-1 out fact (rules `tkoOutSides`, pinned
 * against the ending logic in packages/rules/test/tko.test.ts):
 *  - dealt    = opposing sides put out on hand 1 (both partners credited)
 *  - suffered = your side put out on hand 1
 * personalStats sums them like every other derived counter, and the
 * 'tkos' board ranks by dealt. Story games never reach buildRecord
 * (story rooms write no records; story offline games never upload), so
 * the exclusion is structural. Games recorded before this ship carry no
 * tko keys in their stats JSON: they count 0 — the stat starts at ship,
 * because the ending fact was never stored for them (games.end_reason
 * holds only 'finished'/'abandoned').
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type Bid, type GameResult, type GameState, type HandRecord, type TableRules,
  checkGameEnd, hostMinimum, isShot, makeRules, scoreHand, shotCounts,
  shotOutOn, shotOutResult, shotOutSides, thirdSetResult,
} from '@spades/rules';
import { abandonedRecord, buildRecord, saveRecord, type GameRecord, type PlayerGameStats, type SeatRef } from '../src/stats/record';
import { leaderboard, personalStats } from '../src/stats/boards';
import { makeD1 } from './d1';

/* ------------------------------------------------------------ fixtures */

function shell(rules: TableRules, history: HandRecord[], scores: number[], result: GameResult | null): GameState {
  const n = rules.playerCount;
  return {
    rules, seed: 'tko', phase: 'gameOver', handNo: history.length, dealer: 0, turn: null,
    hands: Array.from({ length: n }, () => []),
    bids: Array.from({ length: n }, () => null), revealed: Array.from({ length: n }, () => true),
    exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: Array.from({ length: n }, () => 0),
    spadesBroken: true, scores, bags: Array.from({ length: rules.partnerships ? 2 : n }, () => 0), history, result,
  } as GameState;
}

/** Team game built exactly the way finishHand builds it. */
function teamGame(hands: { bids: Bid[]; tricks: number[] }[], rules: TableRules = makeRules('joker')): GameState {
  let scores = [0, 0];
  let bags = [0, 0];
  const history: HandRecord[] = [];
  let result: GameResult | null = null;
  for (const [i, h] of hands.entries()) {
    const sides = scoreHand(rules, h.bids, h.tricks, scores, bags);
    const shot = sides.map((s) => isShot(rules, h.bids, s));
    if (shotOutOn(rules)) sides.forEach((s, j) => { s.shot = shot[j]; });
    const prev = history[history.length - 1];
    const prevShot = sides.map((_, j) => !!prev?.sides[j]?.shot);
    const record: HandRecord = { handNo: i + 1, dealer: 0, bids: [...h.bids], tricksWon: [...h.tricks], sides };
    const countsBefore = shotCounts(rules, history);
    const newScores = sides.map((s) => s.totalScore);
    result = thirdSetResult(newScores, shotCounts(rules, [...history, record]), countsBefore)
      ?? shotOutResult(newScores, shotOutSides(rules, i + 1, shot, prevShot, countsBefore.map((c) => c >= 2)))
      ?? checkGameEnd(rules, newScores);
    history.push(record);
    scores = newScores;
    bags = sides.map((s) => s.totalBags);
    if (result) break;
  }
  return shell(rules, history, scores, result);
}

/** Cutthroat game built the way finishCutthroat stamps it. */
function cutGame(hands: { bids: Bid[]; tricks: number[] }[], result: GameResult, rules: TableRules = makeRules('cutthroat')): GameState {
  const n = rules.playerCount;
  let scores = Array.from({ length: n }, () => 0);
  let bags = Array.from({ length: n }, () => 0);
  const history: HandRecord[] = [];
  const eliminated = Array.from({ length: n }, () => false);
  const streak = Array.from({ length: n }, () => 0);
  for (const [i, h] of hands.entries()) {
    const handNo = i + 1;
    const wasOut = [...eliminated];
    const sides = scoreHand(rules, h.bids, h.tricks, scores, bags);
    const books = h.bids.every((b) => b === 'books');
    const cumFails = Array.from({ length: n }, () => 0);
    for (const rec of history) for (const s of rec.sides) if (s.shot) cumFails[s.side] = (cumFails[s.side] ?? 0) + 1;
    for (let seat = 0; seat < n; seat++) {
      if (wasOut[seat]) {
        sides[seat] = { ...sides[seat]!, points: 0, bookPoints: 0, contractPoints: 0, contractMade: null, bagsAdded: 0, totalScore: scores[seat]!, totalBags: bags[seat]!, shot: false, out: true };
        continue;
      }
      const b = h.bids[seat];
      const failed = books
        ? hostMinimum(rules) > 0 && sides[seat]!.tricks < hostMinimum(rules)
        : b === null || b === 'books' ? false
          : (b === 'nil' || b === 'blindNil') ? sides[seat]!.tricks > 0
            : sides[seat]!.contractMade === false;
      streak[seat] = failed ? (streak[seat] ?? 0) + 1 : 0;
      const cum = (cumFails[seat] ?? 0) + (failed ? 1 : 0);
      const out = failed && (handNo === 1 || (streak[seat] ?? 0) >= 2 || cum >= 3);
      if (out) eliminated[seat] = true;
      sides[seat] = { ...sides[seat]!, shot: failed, out };
    }
    history.push({ handNo, dealer: 0, bids: [...h.bids], tricksWon: [...h.tricks], sides });
    scores = sides.map((s) => s.totalScore);
    bags = sides.map((s) => s.totalBags);
  }
  return shell(rules, history, scores, result);
}

const BOOKS: Bid[] = ['books', 'books', 'books', 'books'];
const TEAM_SEATS: SeatRef[] = [
  { name: 'A', side: 0, kind: 'user', uid: 'a' },
  { name: 'B', side: 1, kind: 'user', uid: 'b' },
  { name: 'C', side: 0, kind: 'user', uid: 'c' },
  { name: 'D', side: 1, kind: 'user', uid: 'd' },
];
const CUT_SEATS: SeatRef[] = [0, 1, 2, 3].map((i) => ({ name: 'ABCD'[i]!, side: i, kind: 'user' as const, uid: 'abcd'[i]! }));

const teamTKO = () => teamGame([{ bids: BOOKS, tricks: [6, 2, 4, 1] }]);
const tkos = (rec: GameRecord) => rec.players.map((p) => [p.stats.tkoDealt, p.stats.tkoSuffered]);

describe('buildRecord — TKO counters', () => {
  it('team hand-1 shot-out: winners dealt 1, the out side suffered 1, partners share it', () => {
    const rec = buildRecord({ id: 't1', room: 'R', game: teamTKO(), seats: TEAM_SEATS, names: ['A', 'B'], endedAt: 1 });
    expect(tkos(rec)).toEqual([[1, 0], [0, 1], [1, 0], [0, 1]]);
  });

  it('back-to-back shot-out (hand 3) counts nothing', () => {
    const g = teamGame([
      { bids: BOOKS, tricks: [4, 4, 3, 2] },
      { bids: [3, 6, 2, 3], tricks: [4, 3, 3, 3] },
      { bids: [3, 6, 2, 3], tricks: [4, 3, 3, 3] },
    ]);
    const rec = buildRecord({ id: 't2', room: 'R', game: g, seats: TEAM_SEATS, names: ['A', 'B'], endedAt: 1 });
    expect(tkos(rec)).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
  });

  it('both sides out on hand 1: every player dealt 1 AND suffered 1', () => {
    const g = teamGame([{ bids: [5, 5, 4, 3], tricks: [3, 3, 5, 2] }]);
    const rec = buildRecord({ id: 't3', room: 'R', game: g, seats: TEAM_SEATS, names: ['A', 'B'], endedAt: 1 });
    expect(tkos(rec)).toEqual([[1, 1], [1, 1], [1, 1], [1, 1]]);
  });

  it('the hand-1 double-shot that TIES plays on — nothing counts', () => {
    const rules = makeRules('joker', { targetScore: 100 });
    const g = teamGame([
      { bids: [5, 5, 4, 4], tricks: [3, 3, 5, 2] },
      { bids: [6, 3, 4, 3], tricks: [6, 2, 4, 1] },
      { bids: [7, 2, 4, 2], tricks: [6, 4, 5, 0] },
    ], rules);
    const rec = buildRecord({ id: 't4', room: 'R', game: g, seats: TEAM_SEATS, names: ['A', 'B'], endedAt: 1 });
    expect(tkos(rec)).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
  });

  it('cutthroat: zero books on hand 1 — the eliminated player suffered, every survivor dealt', () => {
    const g = cutGame([
      { bids: BOOKS, tricks: [5, 4, 0, 4] },
      { bids: [4, 4, 'books', 4], tricks: [5, 4, 0, 4] },
      { bids: [5, 3, 'books', 5], tricks: [6, 3, 0, 4] },
    ], { endReason: 'target', finalScores: [0, 0, 0, 0], placements: [1, 2, 3, 4], winners: [0] });
    const rec = buildRecord({ id: 't5', room: 'R', game: g, seats: CUT_SEATS, names: ['A', 'B', 'C', 'D'], endedAt: 1 });
    expect(tkos(rec)).toEqual([[1, 0], [1, 0], [0, 1], [1, 0]]);
  });

  it('cutthroat: two out on hand 1 — survivors dealt 2, each out player dealt the other', () => {
    const g = cutGame([
      { bids: BOOKS, tricks: [5, 4, 0, 0] },
      { bids: [4, 4, 'books', 'books'], tricks: [7, 6, 0, 0] },
    ], { endReason: 'target', finalScores: [0, 0, 0, 0], placements: [1, 2, 3, 4], winners: [0] });
    const rec = buildRecord({ id: 't6', room: 'R', game: g, seats: CUT_SEATS, names: ['A', 'B', 'C', 'D'], endedAt: 1 });
    expect(tkos(rec)).toEqual([[2, 0], [2, 0], [1, 1], [1, 1]]);
  });

  it('cutthroat: an elimination on hand 3 counts nothing', () => {
    const g = cutGame([
      { bids: BOOKS, tricks: [4, 3, 3, 3] },
      { bids: [4, 4, 5, 3], tricks: [4, 4, 2, 4] },
      { bids: [4, 4, 5, 3], tricks: [4, 4, 2, 4] },
    ], { endReason: 'target', finalScores: [0, 0, 0, 0], placements: [1, 2, 3, 4], winners: [0] });
    const rec = buildRecord({ id: 't7', room: 'R', game: g, seats: CUT_SEATS, names: ['A', 'B', 'C', 'D'], endedAt: 1 });
    expect(tkos(rec)).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
  });

  it('abandoned records carry zeroed TKO counters', () => {
    const rec = abandonedRecord({ id: 't8', room: 'R', game: teamTKO(), seats: TEAM_SEATS, names: ['A', 'B'], endedAt: 1 });
    expect(tkos(rec)).toEqual([[0, 0], [0, 0], [0, 0], [0, 0]]);
  });
});

/* ------------------------------------------------------------ reads */

let db: D1Database;
const NOW = 1_800_000_000_000;
const DAY = 86400_000;

async function user(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, id.toUpperCase(), id.toLowerCase(), 1).run();
}

/** A game written the way a pre-TKO-ship build wrote it: no tko keys in the stats JSON. */
function legacyRecord(id: string, endedAt: number): GameRecord {
  const stats = {
    won: true, hands: 4, bids: 4, bidSum: 12, made: 3, set: 1, bags: 2, nilBids: 0, nilMade: 0, blindNilMade: 0,
    books: 12, maxBooksHand: 5, bestRun: 0, tableRuns: 0, maxDeficit: 0, foeEliminated: false, runItClaims: 0,
    shotsTaken: 1, shotsGiven: 0, wheels: 0, bjWins: 0, bidMs: 8000, bidN: 4, playMs: 20000, playN: 40,
  } as PlayerGameStats;
  return {
    id, room: 'R', mode: 'joker', kind: 'team', endedAt, hands: 4, final: [260, 200], winners: [0],
    names: ['A', 'B'], seats: TEAM_SEATS,
    players: TEAM_SEATS.map((s, seat) => ({ seat, uid: s.uid!, side: s.side, won: s.side === 0, partner: null, teamName: null, stats })),
  };
}

beforeEach(async () => {
  db = await makeD1();
  for (const u of ['a', 'b', 'c', 'd']) await user(u);
}, 120_000);

describe('personalStats + the tkos board', () => {
  it('sums dealt/suffered over recorded games; pre-ship rows count 0', async () => {
    await saveRecord(db, buildRecord({ id: 'g1', room: 'R', game: teamTKO(), seats: TEAM_SEATS, names: ['A', 'B'], endedAt: NOW }), false);
    await saveRecord(db, legacyRecord('g0', NOW), false);
    const a = await personalStats(db, 'a');
    expect(a.tkoDealt).toBe(1);
    expect(a.tkoSuffered).toBe(0);
    expect(a.games).toBe(2);
    const b = await personalStats(db, 'b');
    expect(b.tkoDealt).toBe(0);
    expect(b.tkoSuffered).toBe(1);
    const teamA = await personalStats(db, 'a', 'team');
    expect(teamA.tkoDealt).toBe(1);
    const cutA = await personalStats(db, 'a', 'cutthroat');
    expect(cutA.tkoDealt).toBe(0);
  });

  it('the board ranks by dealt, carries taken in extra, and windows by ended_at', async () => {
    await saveRecord(db, buildRecord({ id: 'g1', room: 'R', game: teamTKO(), seats: TEAM_SEATS, names: ['A', 'B'], endedAt: NOW }), false);
    await saveRecord(db, buildRecord({ id: 'g2', room: 'R', game: teamTKO(), seats: TEAM_SEATS, names: ['A', 'B'], endedAt: NOW - 40 * DAY }), false);
    const all = await leaderboard(db, { board: 'tkos', kind: 'team', period: 'all', region: null, now: NOW + 1000 });
    const aRow = all.find((r) => r.id === 'u:a');
    expect(aRow?.value).toBe(2);
    expect(aRow?.extra).toBe('taken 0');
    // the suffered-only player never appears on a dealt board
    expect(all.some((r) => r.id === 'u:b')).toBe(false);
    const week = await leaderboard(db, { board: 'tkos', kind: 'team', period: 'week', region: null, now: NOW + 1000 });
    expect(week.find((r) => r.id === 'u:a')?.value).toBe(1);
    const month = await leaderboard(db, { board: 'tkos', kind: 'team', period: 'month', region: null, now: NOW + 1000 });
    expect(month.find((r) => r.id === 'u:a')?.value).toBe(1);
  });
});
