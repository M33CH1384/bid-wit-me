/**
 * Streak Fire, server side (owner, 2026-10-27): the home screen's fire is
 * fed by `streakFireFor` — the SELF profile's streak source, derived from
 * the stored cred_totals rows (cur_streak per kind, migration 0007), the
 * same rows the Record Book's current-streak honor reads.
 * Pins:
 *  - the max current streak across kinds wins, with its kind named;
 *  - a missing totals row backfills from real stored game history
 *    (totalsFor semantics) — never from anything the client sends;
 *  - a player with no games reads as a zero streak, not an error.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { streakFireFor } from '../src/cred/hooks';

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
  for (const u of ['a', 'b']) {
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(u, u.toUpperCase(), u).run();
  }
});

describe('streakFireFor', () => {
  it('reads pre-stored totals: max current streak across kinds, kind named', async () => {
    await db.prepare(`INSERT INTO cred_totals (user_id, kind, games, wins, shots_given, cur_streak, best_streak)
      VALUES ('a', 'team', 20, 12, 0, 2, 8), ('a', 'cutthroat', 30, 20, 0, 6, 6)`).run();
    await expect(streakFireFor(db, 'a')).resolves.toEqual({ current: 6, kind: 'cutthroat', best: 8 });
  });

  it('backfills a missing row from real game history (W W W L W W → current 2, best 3)', async () => {
    const seq = [1, 1, 1, 0, 1, 1];
    for (let i = 0; i < seq.length; i++) await played(`g${i}`, NOW - (seq.length - i) * 1000, 'b', seq[i]!);
    await expect(streakFireFor(db, 'b')).resolves.toEqual({ current: 2, kind: 'team', best: 3 });
  });

  it('a player with no recorded games reads zero', async () => {
    await expect(streakFireFor(db, 'a')).resolves.toEqual({ current: 0, kind: null, best: 0 });
  });
});
