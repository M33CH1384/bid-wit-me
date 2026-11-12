/**
 * Player of the game on the record and the stat sheet (owner, 2026-11-12:
 * "mvp's should go to the stat sheet in total and percentage").
 *
 * buildRecord names the MVP with the rules package's pickMvpTally (the same
 * pick the game-over screen shows) and stamps it twice: on the game
 * (games.mvp_seat / mvp_user_id — a bot or guest can be the MVP, so the seat
 * is always kept and the user id only for an account) and on each signed-in
 * player's stats JSON (mvp: 1 | 0). personalStats counts awards and divides
 * by the finished games that carry the stamp, so games recorded before it
 * shipped move neither number.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { type Bid, type GameState, type HandRecord, makeRules, pickMvpTally, scoreHand } from '@spades/rules';
import { abandonedRecord, buildRecord, saveRecord, type SeatRef } from '../src/stats/record';
import { personalStats, myStats } from '../src/stats/boards';
import { cardFor } from '../src/cred/card';
import { recordOfflineGame } from '../src/stats/local';
import { makeD1 } from './d1';

const rules = makeRules('joker');

/** A finished team game: side 0 (seats 0 and 2) wins; `star` takes the most books and makes every bid. */
function game(star: 0 | 2, hands = 5): GameState {
  let scores = [0, 0];
  let bags = [0, 0];
  const history: HandRecord[] = [];
  for (let i = 0; i < hands; i++) {
    const bids: Bid[] = [0, 1, 2, 3].map((s) => (s === star ? 6 : s === (star + 2) % 4 ? 2 : 2)) as Bid[];
    const tricks = [0, 1, 2, 3].map((s) => (s === star ? 6 : s === (star + 2) % 4 ? 3 : 2));
    const sides = scoreHand(rules, bids, tricks, scores, bags);
    history.push({ handNo: i + 1, dealer: 0, bids, tricksWon: tricks, sides });
    scores = sides.map((s) => s.totalScore);
    bags = sides.map((s) => s.bags);
  }
  return {
    rules, seed: 'mvp', phase: 'gameOver', handNo: hands, dealer: 0, turn: null,
    hands: [[], [], [], []], bids: [null, null, null, null], revealed: [true, true, true, true],
    exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: [0, 0, 0, 0],
    spadesBroken: true, scores, bags, history, result: { winners: [0], finalScores: scores, reason: 'target' },
  } as unknown as GameState;
}

const user = (uid: string, side: number): SeatRef => ({ name: uid, side, kind: 'user', uid });
const bot = (side: number): SeatRef => ({ name: 'Bot', side, kind: 'bot' });

let db: D1Database;
let n = 0;
async function addUser(id: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(id, id, id.toLowerCase()).run();
}
async function play(star: 0 | 2, seats: SeatRef[]) {
  const id = `g${++n}`;
  const rec = buildRecord({ id, room: 'r', game: game(star), seats, names: ['A', 'B'], endedAt: 1000 + n });
  await saveRecord(db, rec, false);
  return { id, rec };
}

beforeEach(async () => {
  db = await makeD1();
  n = 0;
  await addUser('ann');
  await addUser('bo');
});

describe('the MVP stamp on a finished game', () => {
  it('names the same seat as the rules pick and credits the account sitting there', async () => {
    const g = game(0);
    expect(pickMvpTally(g.rules, g.history, [0])?.seat).toBe(0);
    const { id, rec } = await play(0, [user('ann', 0), bot(1), user('bo', 0), bot(1)]);
    expect(rec.mvpSeat).toBe(0);
    expect(rec.mvpUid).toBe('ann');
    expect(rec.players.find((p) => p.uid === 'ann')!.stats.mvp).toBe(1);
    expect(rec.players.find((p) => p.uid === 'bo')!.stats.mvp).toBe(0);
    const row = await db.prepare('SELECT mvp_seat, mvp_user_id FROM games WHERE id = ?').bind(id).first<{ mvp_seat: number; mvp_user_id: string | null }>();
    expect(row).toEqual({ mvp_seat: 0, mvp_user_id: 'ann' });
  });

  it('keeps the seat and no user id when a bot is the MVP', async () => {
    const { id, rec } = await play(2, [user('ann', 0), bot(1), bot(0), bot(1)]);
    expect(rec.mvpSeat).toBe(2);
    expect(rec.mvpUid).toBeNull();
    expect(rec.players[0]!.stats.mvp).toBe(0);
    const row = await db.prepare('SELECT mvp_seat, mvp_user_id FROM games WHERE id = ?').bind(id).first();
    expect(row).toEqual({ mvp_seat: 2, mvp_user_id: null });
  });

  it('keeps the seat and no user id when a guest is the MVP', async () => {
    const { rec } = await play(2, [user('ann', 0), bot(1), { name: 'Guest', side: 0, kind: 'guest' }, bot(1)]);
    expect(rec.mvpSeat).toBe(2);
    expect(rec.mvpUid).toBeNull();
  });

  it('names no MVP on an abandoned game', async () => {
    const seats = [user('ann', 0), bot(1), bot(0), bot(1)];
    const rec = abandonedRecord({ id: 'ab', room: 'r', game: { ...game(0), result: null } as GameState, seats, names: ['A', 'B'], endedAt: 5 });
    await saveRecord(db, rec, false, { endReason: 'abandoned' });
    expect(rec.players[0]!.stats.mvp).toBeUndefined();
    const row = await db.prepare('SELECT mvp_seat, mvp_user_id FROM games WHERE id = ?').bind('ab').first();
    expect(row).toEqual({ mvp_seat: null, mvp_user_id: null });
  });
});

describe('career MVPs: total and percentage', () => {
  it('is zero awards and no percentage with no games', async () => {
    const s = await personalStats(db, 'ann');
    expect([s.mvps, s.mvpGames, s.mvpPct]).toEqual([0, 0, null]);
  });

  it('counts awards over the games an MVP was named in', async () => {
    const seats = [user('ann', 0), bot(1), user('bo', 0), bot(1)];
    await play(0, seats);
    await play(2, seats);
    await play(2, seats);
    const ann = await personalStats(db, 'ann');
    expect([ann.mvps, ann.mvpGames, ann.mvpPct]).toEqual([1, 3, 33.3]);
    const bo = await personalStats(db, 'bo');
    expect([bo.mvps, bo.mvpGames, bo.mvpPct]).toEqual([2, 3, 66.7]);
    expect((await myStats(db, 'ann')).team.mvps).toBe(1);
    expect((await myStats(db, 'ann')).cutthroat.mvpPct).toBeNull();
  });

  it('leaves games recorded before the stamp out of both numbers', async () => {
    const seats = [user('ann', 0), bot(1), bot(0), bot(1)];
    const { id } = await play(0, seats);
    await play(0, seats);
    // an old row: the stats JSON has no mvp key
    await db.prepare(`UPDATE game_players SET stats = json_remove(stats, '$.mvp') WHERE game_id = ?`).bind(id).run();
    const s = await personalStats(db, 'ann');
    expect(s.games).toBe(2);
    expect([s.mvps, s.mvpGames, s.mvpPct]).toEqual([1, 1, 100]);
  });

  it('rides the player card', async () => {
    await play(0, [user('ann', 0), bot(1), bot(0), bot(1)]);
    await play(2, [user('ann', 0), bot(1), bot(0), bot(1)]);
    const card = await cardFor(db, 'ann', null, 2000);
    expect(card?.stats.mvps).toEqual({ total: 1, games: 2, pct: 50 });
  });
});

describe('offline games', () => {
  it('computes the MVP on the server and ignores a client claim', async () => {
    const now = 10_000_000;
    const g = game(2); // the bot partner is the MVP
    const body = { clientGameId: 'offline-mvp-1', game: g, startedAt: now - 600_000, endedAt: now - 1000, names: ['ann', 'B1', 'B2', 'B3'], mvpSeat: 0, mvp: 1 };
    const out = await recordOfflineGame(db, { id: 'ann', username: 'ann' }, body, now);
    expect(out.status).toBe(200);
    const row = await db.prepare(`SELECT mvp_seat, mvp_user_id FROM games WHERE source = 'offline'`).first();
    expect(row).toEqual({ mvp_seat: 2, mvp_user_id: null });
    const s = await personalStats(db, 'ann');
    expect([s.mvps, s.mvpGames]).toEqual([0, 1]);

    const mine = { ...body, clientGameId: 'offline-mvp-2', game: game(0) };
    await recordOfflineGame(db, { id: 'ann', username: 'ann' }, mine, now);
    const s2 = await personalStats(db, 'ann');
    expect([s2.mvps, s2.mvpGames, s2.mvpPct]).toEqual([1, 2, 50]);
  });
});
