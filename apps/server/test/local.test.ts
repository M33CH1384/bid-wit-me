import { describe, expect, it } from 'vitest';
import { type GameState, makeRules, scoreHand } from '@spades/rules';
import { sha256b64 } from '../src/auth/providers';
import { makeD1 } from './d1';
import { OFFLINE_PER_HOUR, durationOk, handleLocalStats, recordOfflineGame, scoresMatchHistory } from '../src/stats/local';
import { personalStats } from '../src/stats/boards';

const ORIGIN = 'https://bid-wit-me.pages.dev';
const NOW = 1_800_000_000_000;
const UID = 'ed41194162a842d61600fdf573d9a9d5';

function played(): GameState {
  const rules = makeRules('joker', { targetScore: 50 });
  const bids = [6, 3, 4, 2] as const;
  const tricks = [7, 2, 4, 0];
  const sides = scoreHand(rules, bids, tricks, [0, 0], [0, 0]);
  const scores = sides.map((s) => s.totalScore);
  return {
    rules, seed: 'off', phase: 'gameOver', handNo: 1, dealer: 0, turn: null,
    hands: [[], [], [], []], bids: [null, null, null, null], revealed: [true, true, true, true],
    exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: [0, 0, 0, 0],
    spadesBroken: true, scores, bags: sides.map((s) => s.totalBags),
    history: [{ handNo: 1, dealer: 0, bids: [...bids], tricksWon: [...tricks], sides }],
    result: { endReason: 'target', finalScores: scores, placements: [1, 2], winners: scores[0]! >= scores[1]! ? [0] : [1] },
  } as GameState;
}

function body(game: GameState, id = 'local-game-1', endedAt = NOW) {
  return {
    clientGameId: id,
    startedAt: endedAt - game.history.length * 20_000,
    endedAt,
    names: ['M33CH', 'Ace', 'Bot', 'Card'],
    teamNames: ['Homies', 'Visitors'],
    game,
  };
}

async function signedIn() {
  const db = await makeD1();
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(UID, 'M33CH', 'm33ch').run();
  const tok = 'offline-session-token';
  await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), UID, 1, NOW + 10_000_000).run();
  const env = { DB: db, PUBLIC_ORIGIN: ORIGIN };
  const post = (payload: unknown, origin: string | null = ORIGIN) => {
    const headers = new Headers({ 'content-type': 'application/json', cookie: `__Host-bwm_sid=${tok}` });
    if (origin) headers.set('origin', origin);
    const url = new URL('/api/stats/local', ORIGIN);
    return handleLocalStats(new Request(url, { method: 'POST', headers, body: JSON.stringify(payload) }), env, url, NOW);
  };
  return { db, post };
}

describe('offline game checks', () => {
  it('accepts a history whose totals add up, and rejects a duration or a score that does not', () => {
    const game = played();
    expect(scoresMatchHistory(game)).toBe(true);
    expect(durationOk(1, NOW - 20_000, NOW, NOW)).toBe(true);
    expect(durationOk(4, NOW - 1000, NOW, NOW)).toBe(false);
    expect(durationOk(1, NOW - 9 * 3600_000, NOW, NOW)).toBe(false);
    const lied = structuredClone(game);
    lied.result!.finalScores = [999, 0];
    expect(scoresMatchHistory(lied)).toBe(false);
  });

  it('stores an unrated offline win against bots, once', async () => {
    const { db, post } = await signedIn();
    const game = played();
    const first = await post(body(game));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, duplicate: false });
    const again = await post(body(game));
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
    const row = await db.prepare('SELECT source, partial, rated, client_game_id, seats FROM games').first<{ source: string; partial: number; rated: number; client_game_id: string; seats: string }>();
    expect(row).toMatchObject({ source: 'offline', partial: 0, rated: 0, client_game_id: `${UID}:local-game-1` });
    const seats = JSON.parse(row!.seats) as { kind: string; uid?: string }[];
    expect(seats.map((s) => s.kind)).toEqual(['user', 'bot', 'bot', 'bot']);
    expect(seats[0]!.uid).toBe(UID);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM games').first<{ n: number }>())!.n).toBe(1);
    expect(await db.prepare('SELECT elo FROM ratings WHERE user_id = ?').bind(UID).first()).toBeNull();
    const stats = await personalStats(db, UID, 'team');
    expect(stats.gamesVsBots).toBe(1);
    expect(stats.winsVsBots).toBe(stats.wins);
    expect(stats.winsVsPlayers).toBe(0);
  });

  it('refuses a tampered score, a missing session, and a foreign origin', async () => {
    const { post } = await signedIn();
    const game = played();
    const lied = structuredClone(game);
    lied.result!.finalScores = [1, 2];
    expect((await post(body(lied, 'local-game-2'))).status).toBe(400);
    const url = new URL('/api/stats/local', ORIGIN);
    const anon = await handleLocalStats(new Request(url, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' }), { DB: (await makeD1()), PUBLIC_ORIGIN: ORIGIN }, url, NOW);
    expect(anon.status).toBe(401);
    expect((await post(body(game, 'local-game-3'), null)).status).toBe(403);
  });

  it('rate limits a user after a burst of offline games', async () => {
    const { db, post } = await signedIn();
    for (let i = 0; i < OFFLINE_PER_HOUR; i++) {
      const id = `offline:${UID}:seed-${i}`;
      await db.prepare(`INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, source, client_game_id, partial) VALUES (?, 'offline', 'joker', 'team', ?, 1, '[]', '[]', '[]', '[]', 0, 'offline', ?, 0)`).bind(id, NOW - 1000, `${UID}:seed-${i}`).run();
      await db.prepare(`INSERT INTO game_players (game_id, user_id, kind, seat, side, won, ended_at, stats) VALUES (?, ?, 'team', 0, 0, 1, ?, '{}')`).bind(id, UID, NOW - 1000).run();
    }
    expect((await post(body(played(), 'local-game-9'))).status).toBe(429);
  });
});

describe('recordOfflineGame direct', () => {
  it('rejects a short client id', async () => {
    const db = await makeD1();
    const out = await recordOfflineGame(db, { id: UID, username: 'M33CH' }, { clientGameId: 'short' }, NOW);
    expect(out.status).toBe(400);
  });
});
