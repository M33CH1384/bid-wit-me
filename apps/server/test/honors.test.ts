/**
 * Streak records in the Record Book (league data wave, item 3). Streaks are
 * stored in cred_totals (bumped at every game credit; totalsFor backfills a
 * missing row by replaying the player's stored history in order). Pins:
 *  - the honors read backfills missing totals rows from real game history,
 *    so the longest-streak record reflects pre-existing games;
 *  - a pre-stored totals row is read as-is;
 *  - the current-streak record needs a live streak of 3+;
 *  - no season streak award is fabricated from the lifetime totals.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { leagueHonors } from '../src/stats/honors';

let db: D1Database;
const NOW = 1_800_000_000_000;
const SEATS = JSON.stringify([
  { name: 'A', side: 0, kind: 'user', uid: 'a' }, { name: 'B', side: 0, kind: 'user', uid: 'b' },
  { name: 'C', side: 1, kind: 'user', uid: 'c' }, { name: 'D', side: 1, kind: 'user', uid: 'd' },
]);

async function played(id: string, at: number, uid: string, won: number) {
  await db.prepare(`INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated)
    VALUES (?, 'R', 'joker', 'team', ?, 8, '[]', '[]', '[]', ?, 1)`).bind(id, at, SEATS).run();
  await db.prepare(`INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, ended_at, stats, elo_before, elo_after)
    VALUES (?, ?, 'team', 0, 0, ?, NULL, ?, '{}', NULL, NULL)`).bind(id, uid, won, at).run();
}

beforeEach(async () => {
  db = await makeD1();
  for (const u of ['a', 'b', 'c', 'd']) {
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(u, u.toUpperCase(), u).run();
  }
});

describe('streak records', () => {
  it('backfills totals from stored history and reports the longest streak', async () => {
    // a: W W L W W W (best 3, current 3) — no cred_totals row exists yet
    const seq = [1, 1, 0, 1, 1, 1];
    for (let i = 0; i < seq.length; i++) await played(`ga${i}`, NOW - (seq.length - i) * 1000, 'a', seq[i]!);
    const { records } = await leagueHonors(db, NOW);
    const longest = records.find((r) => r.id === 'longest-streak');
    expect(longest).toMatchObject({ userId: 'a', name: 'A', value: '3 straight wins · Partnership' });
    const current = records.find((r) => r.id === 'current-streak');
    expect(current).toMatchObject({ userId: 'a', value: '3 straight and counting · Partnership' });
    // the backfill actually stored the row (not a per-read replay)
    const stored = await db.prepare("SELECT cur_streak, best_streak FROM cred_totals WHERE user_id = 'a' AND kind = 'team'").first<{ cur_streak: number; best_streak: number }>();
    expect(stored).toMatchObject({ cur_streak: 3, best_streak: 3 });
  });

  it('reads pre-stored totals as-is and keeps the two records distinct', async () => {
    await db.prepare(`INSERT INTO cred_totals (user_id, kind, games, wins, shots_given, cur_streak, best_streak)
      VALUES ('b', 'cutthroat', 40, 30, 0, 1, 9), ('c', 'team', 20, 15, 0, 5, 5)`).run();
    const { records } = await leagueHonors(db, NOW);
    expect(records.find((r) => r.id === 'longest-streak')).toMatchObject({ userId: 'b', value: '9 straight wins · Cutthroat' });
    expect(records.find((r) => r.id === 'current-streak')).toMatchObject({ userId: 'c', value: '5 straight and counting · Partnership' });
  });

  it('omits the records when nobody qualifies, and never invents a season streak award', async () => {
    await db.prepare(`INSERT INTO cred_totals (user_id, kind, games, wins, shots_given, cur_streak, best_streak)
      VALUES ('b', 'team', 3, 1, 0, 1, 1)`).run();
    const { records, awards } = await leagueHonors(db, NOW);
    expect(records.find((r) => r.id === 'longest-streak')).toBeUndefined();
    expect(records.find((r) => r.id === 'current-streak')).toBeUndefined();
    expect(awards.find((a) => /streak/i.test(a.label))).toBeUndefined();
  });
});
