/**
 * Tosses Forced / Conceded (owner, 2026-11-05) + the "Forced the Toss"
 * Play-Well bonus.
 *
 * The counters ride the per-game stats JSON buildRecord already writes
 * (the TKO pattern — no migration), folded from the engine's
 * HandRecord.tossed stamp: the forcing side is the side that was NOT set
 * when the table voted to toss; the set side(s) conceded. A
 * both-sides-short toss concedes for everyone and forces for no one.
 * Games recorded before the stamp existed carry no tossed hands — the
 * stat starts at ship, no backfill.
 *
 * The bonus pays 25 XP to each player on the forcing side, OUTSIDE the
 * family's 40 XP/game cap (owner exemption, flagged for his veto in the
 * lane report: un-farmable — a locked set plus the opponents' unanimous
 * consent), at the family's half rate in bot/unrated games, and inside
 * the 200 XP/day ledger like every other line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type Bid, type GameState, type HandRecord, type TableRules,
  makeRules, scoreHand, scoreTossedHand,
} from '@spades/rules';
import { buildRecord, saveRecord, type PlayerGameStats, type SeatRef } from '../src/stats/record';
import { personalStats } from '../src/stats/boards';
import {
  FORCED_TOSS_XP, PLAY_WELL_GAME_CAP_XP, creditPlayWell, latestPlayWell,
  playWellLines, settlePlayWell, type PlayWellLine,
} from '../src/cred/playwell';
import { makeD1 } from './d1';

const NOW = 1_800_000_000_000;
const rules: TableRules = { ...makeRules('joker'), firstHandBidsItself: false };

const SEATS: SeatRef[] = [
  { name: 'A', side: 0, kind: 'user', uid: 'a' },
  { name: 'B', side: 1, kind: 'user', uid: 'b' },
  { name: 'C', side: 0, kind: 'user', uid: 'c' },
  { name: 'D', side: 1, kind: 'user', uid: 'd' },
];

function shell(history: HandRecord[], result: GameState['result'] = null): GameState {
  return {
    rules, seed: 'toss', phase: 'gameOver', handNo: history.length, dealer: 0, turn: null,
    hands: [[], [], [], []], bids: [null, null, null, null], revealed: [true, true, true, true],
    exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: [0, 0, 0, 0],
    spadesBroken: true, scores: [0, 0], bags: [0, 0], history, result,
  } as GameState;
}

/** A played-out hand record (normal scoring). */
function played(handNo: number, bids: Bid[], tricks: number[]): HandRecord {
  return { handNo, dealer: 0, bids: [...bids], tricksWon: [...tricks], sides: scoreHand(rules, bids, tricks, [0, 0], [0, 0]) };
}

/** A tossed hand record (flat scoring + the stamp), built the way the engine builds it. */
function tossed(handNo: number, bids: Bid[], tricks: number[], setSides: number[]): HandRecord {
  const rec: HandRecord = { handNo, dealer: 0, bids: [...bids], tricksWon: [...tricks], sides: scoreTossedHand(rules, bids, tricks, [0, 0], [0, 0], setSides) };
  rec.tossed = { setSides: [...setSides] };
  return rec;
}

const statsOf = (rec: ReturnType<typeof buildRecord>, uid: string) => rec.players.find((p) => p.uid === uid)!.stats;

describe('buildRecord — the toss counters', () => {
  it('credits the forcing side and debits the set side, both partners alike', () => {
    const g = shell([
      played(1, [3, 3, 2, 3], [3, 3, 2, 5]),
      tossed(2, [5, 4, 3, 3], [2, 5, 0, 4], [0]), // side 0 set & tossed; side 1 forced it
    ]);
    const rec = buildRecord({ id: 'g1', room: 'R', game: g, seats: SEATS, names: ['A', 'B', 'C', 'D'], endedAt: NOW });
    for (const uid of ['b', 'd']) expect(statsOf(rec, uid)).toMatchObject({ tossesForced: 1, tossesConceded: 0 });
    for (const uid of ['a', 'c']) expect(statsOf(rec, uid)).toMatchObject({ tossesForced: 0, tossesConceded: 1 });
  });

  it('a both-sides-short toss concedes for everyone and forces for no one', () => {
    const g = shell([tossed(1, [5, 5, 3, 5], [3, 3, 2, 3], [0, 1])]);
    const rec = buildRecord({ id: 'g2', room: 'R', game: g, seats: SEATS, names: ['A', 'B', 'C', 'D'], endedAt: NOW });
    for (const uid of ['a', 'b', 'c', 'd']) expect(statsOf(rec, uid)).toMatchObject({ tossesForced: 0, tossesConceded: 1 });
  });

  it('accumulates across hands, and untossed games count zero', () => {
    const g = shell([
      tossed(1, [5, 4, 3, 3], [2, 5, 0, 4], [0]),
      tossed(2, [4, 5, 3, 3], [5, 2, 4, 0], [1]),
      tossed(3, [5, 4, 3, 3], [2, 5, 0, 4], [0]),
    ]);
    const rec = buildRecord({ id: 'g3', room: 'R', game: g, seats: SEATS, names: ['A', 'B', 'C', 'D'], endedAt: NOW });
    expect(statsOf(rec, 'a')).toMatchObject({ tossesForced: 1, tossesConceded: 2 });
    expect(statsOf(rec, 'b')).toMatchObject({ tossesForced: 2, tossesConceded: 1 });
    const plain = buildRecord({ id: 'g4', room: 'R', game: shell([played(1, [3, 3, 2, 3], [3, 3, 2, 5])]), seats: SEATS, names: ['A', 'B', 'C', 'D'], endedAt: NOW });
    expect(statsOf(plain, 'a')).toMatchObject({ tossesForced: 0, tossesConceded: 0 });
  });
});

describe('personalStats — career sums', () => {
  let db: D1Database;
  beforeEach(async () => { db = await makeD1(); }, 120_000);

  it('sums forced/conceded across recorded games; pre-ship stats JSON counts 0', async () => {
    for (const u of ['a', 'b', 'c', 'd']) await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(u, u.toUpperCase(), u, 1).run();
    const g = shell([tossed(1, [5, 4, 3, 3], [2, 5, 0, 4], [0]), tossed(2, [5, 4, 3, 3], [2, 5, 0, 4], [0])]);
    const rec = buildRecord({ id: 'g5', room: 'R', game: g, seats: SEATS, names: ['A', 'B', 'C', 'D'], endedAt: NOW });
    await saveRecord(db, rec);
    expect(await personalStats(db, 'b')).toMatchObject({ tossesForced: 2, tossesConceded: 0 });
    expect(await personalStats(db, 'a')).toMatchObject({ tossesForced: 0, tossesConceded: 2 });
  });
});

describe('the Forced the Toss line', () => {
  const base = (o: Partial<PlayerGameStats> = {}): PlayerGameStats => ({
    won: false, hands: 4, bids: 4, bidSum: 12, made: 3, set: 1, bags: 2, nilBids: 0, nilMade: 0, blindNilMade: 0,
    books: 12, maxBooksHand: 5, bestRun: 0, tableRuns: 0, maxDeficit: 0, foeEliminated: false, runItClaims: 0,
    shotsTaken: 1, shotsGiven: 0, tkoDealt: 0, tkoSuffered: 0, tossesForced: 0, tossesConceded: 0, wheels: 0, bjWins: 0,
    bidMs: 8000, bidN: 4, playMs: 20000, playN: 40, ...o,
  });

  it('pays 25 XP per forced toss, named like the feat', () => {
    const one = playWellLines(base({ tossesForced: 1 }), { won: true, finalMargin: 60 });
    expect(one).toContainEqual({ id: 'forced-toss', label: 'Forced the Toss', xp: FORCED_TOSS_XP, coins: 0 });
    const three = playWellLines(base({ tossesForced: 3 }), { won: true, finalMargin: 60 });
    expect(three).toContainEqual({ id: 'forced-toss', label: 'Forced the Toss ×3', xp: 75, coins: 0 });
    expect(playWellLines(base(), { won: true, finalMargin: 60 }).some((l) => l.id === 'forced-toss')).toBe(false);
  });

  it('settles OUTSIDE the 40 XP game cap', () => {
    // family feats alone saturate the cap (best run 22 + set them 12 + comeback 10 = 44 → 40)
    const lines = playWellLines(base({ bestRun: 10, shotsGiven: 3, tossesForced: 1, maxDeficit: 120 }), { won: true, finalMargin: 60 });
    const settled = settlePlayWell(lines, { half: false, dailyAllowance: 200 });
    expect(settled.xp).toBe(PLAY_WELL_GAME_CAP_XP + FORCED_TOSS_XP);
    expect(settled.lines.find((l) => l.id === 'forced-toss')).toMatchObject({ xp: 25 });
  });

  it('settles at the family half rate in bot/unrated games (25 → 12)', () => {
    const lines = playWellLines(base({ tossesForced: 1 }), { won: true, finalMargin: 60 });
    const settled = settlePlayWell(lines, { half: true, dailyAllowance: 200 });
    expect(settled.lines).toEqual([{ id: 'forced-toss', label: 'Forced the Toss', xp: 12, coins: 0 }]);
    expect(settled.xp).toBe(12);
  });

  it('still trims against the day’s remaining allowance — the ledger is shared', () => {
    const lines: PlayWellLine[] = [
      { id: 'best-run', label: 'Best run — 10 books in a row', xp: 22, coins: 0 },
      { id: 'forced-toss', label: 'Forced the Toss', xp: 25, coins: 0 },
    ];
    // 30 left today: the family takes 22, the toss gets the 8 that remain
    const settled = settlePlayWell(lines, { half: false, dailyAllowance: 30 });
    expect(settled.xp).toBe(30);
    expect(settled.lines.find((l) => l.id === 'forced-toss')).toMatchObject({ xp: 8 });
    // nothing left today: no line at all
    expect(settlePlayWell(lines, { half: false, dailyAllowance: 0 }).lines.some((l) => l.id === 'forced-toss')).toBe(false);
  });

  it('credits through creditPlayWell into the itemisation the results screen reads', async () => {
    const db = await makeD1();
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind('a', 'A', 'a', 1).run();
    const award = await creditPlayWell(db, {
      gameId: 'gt', userId: 'a', stats: base({ tossesForced: 2, bestRun: 10 }), won: true, finalMargin: 60, half: false, endedAt: NOW,
    });
    // best run 22 (inside the cap) + 2 × 25 forced toss (outside it)
    expect(award.xp).toBe(22 + 50);
    const latest = await latestPlayWell(db, 'a');
    expect(latest?.lines).toContainEqual({ id: 'forced-toss', label: 'Forced the Toss ×2', xp: 50, coins: 0 });
  }, 120_000);
});
