import { describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { HOMIES_GAME_ID, HOMIES_USER, backfillHomiesWin, findHomiesWin } from '../src/stats/backfill';
import { personalStats } from '../src/stats/boards';

const UID = HOMIES_USER;

function series(game: Record<string, unknown>, members: string[] = ['bot:2', 'you']) {
  return {
    v: 1,
    badges: [],
    teamName: 'Homies',
    series: {
      v: 1,
      key: 'joker|bot:2+you|bot:1+bot:3',
      mode: 'joker',
      sides: [
        { key: 'bot:2+you', members, name: 'Homies' },
        { key: 'bot:1+bot:3', members: ['bot:1', 'bot:3'], name: 'Visitors' },
      ],
      wins: [1, 0],
      games: [game],
    },
  };
}

const win = {
  no: 1, at: 1_700_000_000_000, hands: 11, final: [296, 192], winners: [0], names: ['Homies', 'Visitors'],
  totals: [[40, 20], [296, 192]], sets: [2, 3], wheels: [1, 0], nukes: [0, 0], nilsMade: [1, 0], nilsBusted: [1, 0], shots: [0, 0],
  endReason: 'target',
};

async function seed(data: unknown | null) {
  const db = await makeD1();
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(UID, 'M33CH', 'm33ch').run();
  if (data) await db.prepare('INSERT INTO progress (user_id, data, updated_at) VALUES (?, ?, 1)').bind(UID, JSON.stringify(data)).run();
  return db;
}

describe('Homies offline backfill', () => {
  it('finds the 296–192 Joker win and ignores a lookalike', () => {
    expect(findHomiesWin(series(win))?.side).toBe(0);
    expect(findHomiesWin(series({ ...win, final: [295, 192] }))).toBeNull();
    expect(findHomiesWin(series({ ...win, winners: [1] }))).toBeNull();
    expect(findHomiesWin(series(win, ['bot:1', 'bot:3']))).toBeNull();
    expect(findHomiesWin({ v: 1, series: { ...series(win).series, mode: 'cutthroat' } })).toBeNull();
  });

  it('stores one unrated offline partial win against bots, and a second run does nothing', async () => {
    const db = await seed(series(win));
    const first = await backfillHomiesWin(db);
    expect(first).toEqual({ inserted: true, reason: 'saved' });
    const again = await backfillHomiesWin(db);
    expect(again).toEqual({ inserted: false, reason: 'exists' });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM games').first<{ n: number }>())!.n).toBe(1);
    const row = await db.prepare('SELECT source, partial, rated, mode, kind, hands, final, winners, client_game_id FROM games WHERE id = ?')
      .bind(HOMIES_GAME_ID).first<{ source: string; partial: number; rated: number; mode: string; kind: string; hands: number; final: string; winners: string; client_game_id: string }>();
    expect(row).toMatchObject({ source: 'offline', partial: 1, rated: 0, mode: 'joker', kind: 'team', hands: 11, client_game_id: HOMIES_GAME_ID });
    expect(JSON.parse(row!.final)).toEqual([296, 192]);
    expect(JSON.parse(row!.winners)).toEqual([0]);
    const seats = JSON.parse((await db.prepare('SELECT seats FROM games WHERE id = ?').bind(HOMIES_GAME_ID).first<{ seats: string }>())!.seats) as { kind: string; uid?: string }[];
    expect(seats.map((s) => s.kind)).toEqual(['user', 'bot', 'bot', 'bot']);
    expect(seats[0]!.uid).toBe(UID);
    const player = await db.prepare('SELECT won, team_name, stats, elo_after FROM game_players WHERE game_id = ?').bind(HOMIES_GAME_ID).first<{ won: number; team_name: string; stats: string; elo_after: number | null }>();
    expect(player).toMatchObject({ won: 1, team_name: 'Homies', elo_after: null });
    expect(JSON.parse(player!.stats)).toMatchObject({ set: 2, nilMade: 1, nilBids: 2, wheels: 1, hands: 0, bids: 0, bags: 0 });
    expect(await db.prepare('SELECT elo FROM ratings WHERE user_id = ?').bind(UID).first()).toBeNull();
    const stats = await personalStats(db, UID, 'team');
    expect(stats.games).toBe(1);
    expect(stats.wins).toBe(1);
    expect(stats.winsVsBots).toBe(1);
    expect(stats.winsVsPlayers).toBe(0);
    expect(stats.gamesVsBots).toBe(1);
    expect(stats.accuracy).toBeNull();
    expect(stats.booksPerHand).toBeNull();
  });

  it('does nothing when the imported series has no such game', async () => {
    const db = await seed(series({ ...win, names: ['Us', 'Them'] }));
    expect(await backfillHomiesWin(db)).toEqual({ inserted: false, reason: 'no-match' });
    expect((await db.prepare('SELECT COUNT(*) AS n FROM games').first<{ n: number }>())!.n).toBe(0);
  });
});
