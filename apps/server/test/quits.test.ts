import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { personalQuitStats, quitHandBucket, quitReport, quitScoreContext } from '../src/stats/quits';

const NOW = 1_800_000_000_000;
const DAY = 86400_000;

let db: D1Database;

const TEAM_SEATS = JSON.stringify([
  { name: 'Dee', side: 0, kind: 'user', uid: 'ua' },
  { name: 'Ray', side: 1, kind: 'user', uid: 'ub' },
  { name: 'Bot', side: 0, kind: 'bot' },
  { name: 'Bot', side: 1, kind: 'bot' },
]);
const CUT_SEATS = JSON.stringify([
  { name: 'Dee', side: 0, kind: 'user', uid: 'ua' },
  { name: 'Ray', side: 1, kind: 'user', uid: 'ub' },
  { name: 'Kim', side: 2, kind: 'user', uid: 'uc' },
  { name: 'Bot', side: 3, kind: 'bot' },
]);
const BOT_OPP_SEATS = JSON.stringify([
  { name: 'Dee', side: 0, kind: 'user', uid: 'ua' },
  { name: 'Bot', side: 1, kind: 'bot' },
  { name: 'Bot', side: 0, kind: 'bot' },
  { name: 'Bot', side: 1, kind: 'bot' },
]);

async function user(id: string, name: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)').bind(id, name, name.toLowerCase()).run();
}

interface GameOpts { kind?: string; at?: number; hands?: number; final?: number[]; seats?: string; rated?: number; endReason?: string; leaverId?: string | null; family?: string | null }
async function game(id: string, o: GameOpts = {}) {
  await db.prepare('INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated, end_reason, leaver_id, family) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, 'R', o.kind === 'cutthroat' ? 'cutthroat' : 'joker', o.kind ?? 'team', o.at ?? NOW, o.hands ?? 4, JSON.stringify(o.final ?? [120, 80]), '[]', '[]', o.seats ?? TEAM_SEATS, o.rated ?? 1, o.endReason ?? 'finished', o.leaverId ?? null, o.family ?? null).run();
}
async function gp(gameId: string, uid: string, o: { kind?: string; seat?: number; side?: number; won?: number; at?: number } = {}) {
  await db.prepare('INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, team_name, ended_at, stats, elo_before, elo_after) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, NULL, NULL)')
    .bind(gameId, uid, o.kind ?? 'team', o.seat ?? 0, o.side ?? 0, o.won ?? 0, o.at ?? NOW, '{}').run();
}
/** a rated finished game both ua (side 0) and ub (side 1) started */
async function finished(id: string, o: GameOpts = {}) {
  await game(id, o);
  const kind = o.kind ?? 'team';
  await gp(id, 'ua', { kind, seat: 0, side: 0, at: o.at });
  await gp(id, 'ub', { kind, seat: 1, side: 1, at: o.at });
}
/** a rated abandoned game: every seated user gets a game_players row, as saveRecord writes */
async function abandoned(id: string, o: GameOpts = {}) {
  await game(id, { ...o, endReason: 'abandoned' });
  const kind = o.kind ?? 'team';
  await gp(id, 'ua', { kind, seat: 0, side: 0, at: o.at });
  await gp(id, 'ub', { kind, seat: 1, side: 1, at: o.at });
  if (kind === 'cutthroat') await gp(id, 'uc', { kind, seat: 2, side: 2, at: o.at });
}

beforeEach(async () => {
  db = await makeD1();
  await user('ua', 'Dee');
  await user('ub', 'Ray');
  await user('uc', 'Kim');
});

describe('quit helpers', () => {
  it('hand buckets: the hand in progress is hands+1', () => {
    expect(quitHandBucket(0)).toBe('early');
    expect(quitHandBucket(1)).toBe('early');
    expect(quitHandBucket(2)).toBe('mid');
    expect(quitHandBucket(4)).toBe('mid');
    expect(quitHandBucket(5)).toBe('late');
    expect(quitHandBucket(11)).toBe('late');
  });
  it('score context reads the leaver side against the best opponent', () => {
    expect(quitScoreContext([120, 80], 0)).toBe('ahead');
    expect(quitScoreContext([120, 80], 1)).toBe('behind');
    expect(quitScoreContext([0, 0], 0)).toBe('level');
    expect(quitScoreContext([50, 90, 90, 10], 3)).toBe('behind');
    expect(quitScoreContext([50, 90, 90, 10], 1)).toBe('level'); // tied with the best other side
    expect(quitScoreContext([], 0)).toBe('unknown');
    expect(quitScoreContext([100], 0)).toBe('unknown');
    expect(quitScoreContext([100, 50], 4)).toBe('unknown');
  });
});

describe('quit report — rated scope only', () => {
  it('counts an attributed rated quit with its hand bucket and score context', async () => {
    await finished('f1');
    await abandoned('q1', { leaverId: 'ua', hands: 3, final: [40, 130] });
    const rep = await quitReport(db, { kind: 'team', period: 'all', now: NOW, floor: 1 });
    expect(rep.population.ratedGames).toBe(2);
    expect(rep.population.quits).toBe(1);
    expect(rep.population.unattributed).toBe(0);
    expect(rep.population.quitRate).toBe(50);
    expect(rep.population.byHand).toEqual({ early: 0, mid: 1, late: 0 });
    expect(rep.population.score).toEqual({ behind: 1, ahead: 0, level: 0, unknown: 0 });
    expect(rep.leaders).toEqual([
      { rank: 1, id: 'u:ua', name: 'Dee', quits: 1, started: 2, rate: 50, byHand: { early: 0, mid: 1, late: 0 } },
    ]);
    // the opponent started both games and quit none — not on the table
    expect(rep.leaders.find((r) => r.id === 'u:ub')).toBeUndefined();
  });

  it('an unrated abandon is neither a quit nor a rated start', async () => {
    await abandoned('q1', { leaverId: 'ua', rated: 0 });
    const rep = await quitReport(db, { kind: 'team', period: 'all', now: NOW, floor: 1 });
    expect(rep.population).toMatchObject({ ratedGames: 0, quits: 0, quitRate: null });
    expect(rep.leaders).toEqual([]);
    expect(await personalQuitStats(db, 'ua')).toMatchObject({ started: 0, quits: 0, rate: null });
  });

  it('a finished game never counts as a quit, even with a leaver_id on the row', async () => {
    await finished('f1', { leaverId: 'ua' });
    const rep = await quitReport(db, { kind: 'team', period: 'all', now: NOW, floor: 1 });
    expect(rep.population.quits).toBe(0);
    expect(rep.population.ratedGames).toBe(1);
  });

  it('room-expiry abandons are unattributed, never a player quit', async () => {
    await abandoned('q1', { leaverId: null });
    const rep = await quitReport(db, { kind: 'team', period: 'all', now: NOW, floor: 1 });
    expect(rep.population).toMatchObject({ ratedGames: 1, quits: 0, unattributed: 1, quitRate: 0 });
    expect(rep.leaders).toEqual([]);
  });

  it('all-bot opposition is out of scope for starts and for the leaver check', async () => {
    // rated flag set but ua faced only bots — the pace board's VS_BOTS exclusion
    await game('f1', { seats: BOT_OPP_SEATS });
    await gp('f1', 'ua', { seat: 0, side: 0 });
    await abandoned('q1', { leaverId: 'ua', seats: BOT_OPP_SEATS });
    const rep = await quitReport(db, { kind: 'team', period: 'all', now: NOW, floor: 1 });
    expect(rep.population.quits).toBe(0);
    expect(await personalQuitStats(db, 'ua')).toMatchObject({ started: 0, quits: 0 });
  });

  it('kind slices stay separate, and cutthroat reads the leaver side among four', async () => {
    await abandoned('cq1', { kind: 'cutthroat', seats: CUT_SEATS, leaverId: 'uc', hands: 6, final: [200, 90, 40, 150] });
    const team = await quitReport(db, { kind: 'team', period: 'all', now: NOW, floor: 1 });
    expect(team.population.quits).toBe(0);
    const cut = await quitReport(db, { kind: 'cutthroat', period: 'all', now: NOW, floor: 1 });
    expect(cut.population.quits).toBe(1);
    expect(cut.population.byHand).toEqual({ early: 0, mid: 0, late: 1 });
    expect(cut.population.score).toEqual({ behind: 1, ahead: 0, level: 0, unknown: 0 });
    expect(cut.leaders[0]).toMatchObject({ id: 'u:uc', name: 'Kim', quits: 1, started: 1 });
  });

  it('windows: a quit 8 days old is out of the week, in the month', async () => {
    await abandoned('q1', { leaverId: 'ua', at: NOW - 8 * DAY });
    await abandoned('q2', { leaverId: 'ua', at: NOW - 1 * DAY });
    const week = await quitReport(db, { kind: 'team', period: 'week', now: NOW, floor: 1 });
    expect(week.population).toMatchObject({ ratedGames: 1, quits: 1 });
    const month = await quitReport(db, { kind: 'team', period: 'month', now: NOW, floor: 1 });
    expect(month.population).toMatchObject({ ratedGames: 2, quits: 2 });
    const mine = await personalQuitStats(db, 'ua', 'team', 'week', NOW);
    expect(mine).toMatchObject({ started: 1, quits: 1 });
  });

  it('a deal abandoned then finished is ONE start for everyone, one quit for the leaver', async () => {
    await abandoned('fam-abandoned', { leaverId: 'ua', family: 'fam' });
    // the deal played out with a bot in ua's seat: ub has a finished row too, ua does not
    await game('fam', { family: 'fam' });
    await gp('fam', 'ub', { seat: 1, side: 1 });
    const rep = await quitReport(db, { kind: 'team', period: 'all', now: NOW, floor: 1 });
    expect(rep.population.ratedGames).toBe(1);
    expect(rep.population.quits).toBe(1);
    expect(await personalQuitStats(db, 'ub')).toMatchObject({ started: 1, quits: 0 });
    expect(await personalQuitStats(db, 'ua')).toMatchObject({ started: 1, quits: 1, rate: 100 });
  });

  it('the leaders floor keeps small samples off the rate table', async () => {
    for (let i = 0; i < 3; i++) await finished(`f${i}`);
    await abandoned('q1', { leaverId: 'ua' });
    await abandoned('q2', { leaverId: 'ua' });
    const floored = await quitReport(db, { kind: 'team', period: 'all', now: NOW });
    expect(floored.leaders).toEqual([]); // 5 starts < the default floor of 10
    const open = await quitReport(db, { kind: 'team', period: 'all', now: NOW, floor: 5 });
    expect(open.leaders).toEqual([
      { rank: 1, id: 'u:ua', name: 'Dee', quits: 2, started: 5, rate: 40, byHand: { early: 0, mid: 2, late: 0 } },
    ]);
  });

  it('personalQuitStats agrees with the report on the same history', async () => {
    await finished('f1');
    await abandoned('q1', { leaverId: 'ua', hands: 0, final: [0, 0] });
    await abandoned('q2', { leaverId: 'ua', hands: 7, final: [300, 90] });
    await abandoned('q3', { leaverId: 'ub', hands: 2, final: [10, 200] });
    const mine = await personalQuitStats(db, 'ua');
    expect(mine).toEqual({
      started: 4, quits: 2, rate: 50,
      byHand: { early: 1, mid: 0, late: 1 },
      score: { behind: 0, ahead: 1, level: 1, unknown: 0 },
    });
    const rep = await quitReport(db, { kind: 'team', period: 'all', now: NOW, floor: 1 });
    expect(rep.population.quits).toBe(3);
    expect(rep.population.score).toEqual({ behind: 0, ahead: 2, level: 1, unknown: 0 });
  });
});
