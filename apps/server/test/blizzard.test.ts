/**
 * BLIZZARD, server side (owner, 2026-11-04 — "when a person keeps losing
 * there should be snow - blizzard on their Home Screen, same thought as
 * the fire but backwards"): the home screen's loss streak rides the SAME
 * self-payload field as the fire (`streakFire` on /api/profile/me), as
 * additive members `lossCurrent` / `lossKind` from `streakFireFor`.
 *
 * Pins:
 *  - the loss streak is the leading run of losses over the player's
 *    recorded FINISHED games, most recent first — the same finished-game
 *    history the cred_totals backfill replays for the win streak;
 *  - a win as the latest game reads loss 0 (the weather clears with the
 *    result that ends the skid);
 *  - the pick across kinds mirrors the fire: max wins, tie keeps 'team';
 *  - abandoned rows are invisible to the run (neither extend nor break
 *    it), matching the win replay's population;
 *  - no recorded games reads as an honest zero, never an error.
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

async function played(id: string, at: number, uid: string, won: number, kind: 'team' | 'cutthroat' = 'team', endReason = 'finished', leaverId: string | null = null) {
  await db.prepare(`INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, end_reason, leaver_id)
    VALUES (?, 'R', 'joker', ?, ?, 8, '[]', '[]', '[]', ?, 1, ?, ?)`).bind(id, kind, at, SEATS, endReason, leaverId).run();
  await db.prepare(`INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, ended_at, stats, elo_before, elo_after)
    VALUES (?, ?, ?, 0, 0, ?, NULL, ?, '{}', NULL, NULL)`).bind(id, uid, kind, won, at).run();
}

/** chronological sequence helper: seq[i] is played i-th (1 = win, 0 = loss) */
async function seq(uid: string, results: number[], kind: 'team' | 'cutthroat' = 'team') {
  for (let i = 0; i < results.length; i++) {
    await played(`${uid}-${kind}-${i}`, NOW - (results.length - i) * 1000, uid, results[i]!, kind);
  }
}

beforeEach(async () => {
  db = await makeD1();
  for (const u of ['a', 'b']) {
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(u, u.toUpperCase(), u).run();
  }
});

describe('streakFireFor — blizzard (current loss streak)', () => {
  it('counts the leading run of losses, most recent first (W L L L → 3)', async () => {
    await seq('a', [1, 0, 0, 0]);
    const f = await streakFireFor(db, 'a');
    expect(f.lossCurrent).toBe(3);
    expect(f.lossKind).toBe('team');
    expect(f.current).toBe(0); // and no win streak alongside it
  });

  it('a win as the latest game clears it (L L L L W → 0)', async () => {
    await seq('a', [0, 0, 0, 0, 1]);
    const f = await streakFireFor(db, 'a');
    expect(f.lossCurrent).toBe(0);
    expect(f.lossKind).toBeNull();
    expect(f.current).toBe(1); // the win starts the fire's count instead
  });

  it('a bare pair of losses is not weather yet (L L → 2, kind still named)', async () => {
    await seq('a', [0, 0]);
    const f = await streakFireFor(db, 'a');
    expect(f.lossCurrent).toBe(2);
    expect(f.lossKind).toBe('team');
  });

  it('takes the max across kinds and names the kind (team L3, cutthroat L5 → cutthroat 5)', async () => {
    await seq('a', [0, 0, 0], 'team');
    await seq('a', [0, 0, 0, 0, 0], 'cutthroat');
    const f = await streakFireFor(db, 'a');
    expect(f.lossCurrent).toBe(5);
    expect(f.lossKind).toBe('cutthroat');
  });

  it('a tie across kinds keeps team (deterministic, the fire pick mirrored)', async () => {
    await seq('a', [0, 0, 0, 0], 'team');
    await seq('a', [0, 0, 0, 0], 'cutthroat');
    const f = await streakFireFor(db, 'a');
    expect(f.lossCurrent).toBe(4);
    expect(f.lossKind).toBe('team');
  });

  it('kinds are independent: a cutthroat win does not clear a team skid', async () => {
    await seq('a', [0, 0, 0], 'team');
    await seq('a', [1], 'cutthroat');
    const f = await streakFireFor(db, 'a');
    expect(f.lossCurrent).toBe(3);
    expect(f.lossKind).toBe('team');
  });

  it('abandoned rows neither extend nor break the run', async () => {
    await played('a-ab-0', NOW - 3000, 'a', 0);
    await played('a-ab-1', NOW - 2000, 'a', 0, 'team', 'abandoned', 'a'); // self-abandon mid-skid
    await played('a-ab-2', NOW - 1000, 'a', 0);
    const f = await streakFireFor(db, 'a');
    expect(f.lossCurrent).toBe(2);
  });

  it('a player with no recorded games reads an honest zero', async () => {
    const f = await streakFireFor(db, 'a');
    expect(f.lossCurrent).toBe(0);
    expect(f.lossKind).toBeNull();
  });
});
