import { describe, expect, it } from 'vitest';
import { type GameState, makeRules, scoreHand } from '@spades/rules';
import { sha256b64 } from '../src/auth/providers';
import { makeD1 } from './d1';
import { OFFLINE_PER_HOUR, handleLocalStats } from '../src/stats/local';

/**
 * Retroactive rewards claim (owner, 2026-10-22): a guest game held on the
 * device posts to /api/stats/local with claim: true after sign-in. Crediting
 * must be the live path's — same validation, same bot-game rates — plus the
 * game_claims registry: one guest game, one account, ever.
 */
const ORIGIN = 'https://bid-wit-me.pages.dev';
const NOW = 1_800_000_000_000;
const UID = 'ed41194162a842d61600fdf573d9a9d5';
const UID2 = 'aa41194162a842d61600fdf573d9a9d5';

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

function body(game: GameState, id = 'local-game-1', claim = false) {
  return {
    clientGameId: id,
    startedAt: NOW - game.history.length * 20_000,
    endedAt: NOW,
    names: ['Guest', 'Ace', 'Bot', 'Card'],
    teamNames: ['Homies', 'Visitors'],
    game,
    ...(claim ? { claim: true } : {}),
  };
}

async function setup() {
  const db = await makeD1();
  const mk = async (uid: string, username: string, tok: string) => {
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(uid, username, username.toLowerCase()).run();
    await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256b64(tok), uid, 1, NOW + 10_000_000).run();
    return (payload: unknown) => {
      const headers = new Headers({ 'content-type': 'application/json', cookie: `__Host-bwm_sid=${tok}`, origin: ORIGIN });
      const url = new URL('/api/stats/local', ORIGIN);
      return handleLocalStats(new Request(url, { method: 'POST', headers, body: JSON.stringify(payload) }), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, NOW);
    };
  };
  const postA = await mk(UID, 'M33CH', 'claim-session-a');
  const postB = await mk(UID2, 'LovleyT714', 'claim-session-b');
  const gamesOf = async (uid: string) => (await db.prepare('SELECT COUNT(*) AS n FROM game_players WHERE user_id = ?').bind(uid).first<{ n: number }>())!.n;
  const xpOf = async (uid: string) => (await db.prepare('SELECT xp FROM xp_state WHERE user_id = ?').bind(uid).first<{ xp: number }>())?.xp ?? 0;
  const claimRow = async (id: string) => db.prepare('SELECT user_id FROM game_claims WHERE client_game_id = ?').bind(id).first<{ user_id: string }>();
  return { db, postA, postB, gamesOf, xpOf, claimRow };
}

describe('retroactive rewards claim', () => {
  it('credits a held guest game on claim at live bot-game rates, exactly once', async () => {
    const { postA, postB, gamesOf, xpOf, claimRow } = await setup();
    const first = await postA(body(played(), 'local-game-1', true));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, duplicate: false });
    expect(await gamesOf(UID)).toBe(1);
    // Rates parity: the identical game through the live flush (another fresh
    // account) earns exactly the same XP — game credit + first-game
    // achievements/challenges stacked by processGameCred either way.
    await postB(body(played(), 'local-game-1'));
    expect(await xpOf(UID)).toBeGreaterThan(0);
    expect(await xpOf(UID)).toBe(await xpOf(UID2));
    expect((await claimRow('local-game-1'))?.user_id).toBe(UID);

    const xpBefore = await xpOf(UID);
    const again = await postA(body(played(), 'local-game-1', true));
    expect(await again.json()).toMatchObject({ ok: true, duplicate: true });
    expect(await gamesOf(UID)).toBe(1);
    expect(await xpOf(UID)).toBe(xpBefore);
  });

  it('a second account can never claim the same guest game', async () => {
    const { postA, postB, gamesOf, xpOf, claimRow } = await setup();
    await postA(body(played(), 'local-game-1', true));
    const stolen = await postB(body(played(), 'local-game-1', true));
    expect(stolen.status).toBe(200);
    expect(await stolen.json()).toMatchObject({ ok: true, duplicate: true, claimed: true });
    expect(await gamesOf(UID2)).toBe(0);
    expect(await xpOf(UID2)).toBe(0);
    expect((await claimRow('local-game-1'))?.user_id).toBe(UID);
  });

  it('a game already banked by the live flush is claim-locked to that account too', async () => {
    const { postA, postB, gamesOf, claimRow } = await setup();
    await postA(body(played(), 'local-game-1')); // plain offline flush, no claim flag
    expect(await claimRow('local-game-1')).toBeNull(); // the live path never touches the registry
    const dupClaim = await postA(body(played(), 'local-game-1', true));
    expect(await dupClaim.json()).toMatchObject({ ok: true, duplicate: true });
    expect((await claimRow('local-game-1'))?.user_id).toBe(UID);
    const stolen = await postB(body(played(), 'local-game-1', true));
    expect(await stolen.json()).toMatchObject({ ok: true, duplicate: true, claimed: true });
    expect(await gamesOf(UID2)).toBe(0);
  });

  it('a rejected game does not burn its claim', async () => {
    const { postA, claimRow } = await setup();
    const lied = played();
    lied.result!.finalScores = [1, 2];
    expect((await postA(body(lied, 'local-game-1', true))).status).toBe(400);
    expect(await claimRow('local-game-1')).toBeNull();
    // the same id with an honest payload still claims fine afterwards
    const ok = await postA(body(played(), 'local-game-1', true));
    expect(ok.status).toBe(200);
    expect((await claimRow('local-game-1'))?.user_id).toBe(UID);
  });

  it('a rate-limited claim is not burned either', async () => {
    const { db, postA, claimRow } = await setup();
    for (let i = 0; i < OFFLINE_PER_HOUR; i++) {
      const id = `offline:${UID}:seed-${i}`;
      await db.prepare(`INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, source, client_game_id, partial) VALUES (?, 'offline', 'joker', 'team', ?, 1, '[]', '[]', '[]', '[]', 0, 'offline', ?, 0)`).bind(id, NOW - 1000, `${UID}:seed-${i}`).run();
      await db.prepare(`INSERT INTO game_players (game_id, user_id, kind, seat, side, won, ended_at, stats) VALUES (?, ?, 'team', 0, 0, 1, ?, '{}')`).bind(id, UID, NOW - 1000).run();
    }
    expect((await postA(body(played(), 'local-game-1', true))).status).toBe(429);
    expect(await claimRow('local-game-1')).toBeNull();
  });

  it('plain posts leave the registry untouched', async () => {
    const { db, postA } = await setup();
    await postA(body(played(), 'local-game-1'));
    expect((await db.prepare('SELECT COUNT(*) AS n FROM game_claims').first<{ n: number }>())!.n).toBe(0);
  });
});
