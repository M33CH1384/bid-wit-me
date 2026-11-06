/**
 * Team rosters (owner, 2026-11-05): a team name is an owned team — the
 * owner + up to 3 HUMAN partners. Bot partners never take spots. A human
 * partner joins the owner's roster for a name on their first recorded game
 * under it (spot permitting); the owner can eject a member, which frees the
 * spot but never rewrites the team's recorded history. Rosters grandfather
 * the owner's most-played human partners under the name.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeD1 } from './d1';
import { sha256b64 } from '../src/auth/providers';
import { saveRecord, type GameRecord, type PlayerGameStats, type SeatRef } from '../src/stats/record';
import { teamRecordFor, handleSocialHttp } from '../src/social/routes';

let db: D1Database;
const NOW = 1_800_000_000_000;
const ORIGIN = 'https://bid-wit-me.pages.dev';

const stats = (o: Partial<PlayerGameStats> = {}): PlayerGameStats => ({
  won: false, hands: 5, bids: 0, bidSum: 0, made: 0, set: 0, bags: 0, nilBids: 0, nilMade: 0, blindNilMade: 0,
  books: 0, maxBooksHand: 0, bestRun: 0, tableRuns: 0, maxDeficit: 0, foeEliminated: false, runItClaims: 0,
  shotsTaken: 0, shotsGiven: 0, wheels: 0, bjWins: 0, bidMs: 0, bidN: 0, playMs: 0, playN: 0, ...o,
});

async function user(id: string, username: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, 1)')
    .bind(id, username, username.toLowerCase()).run();
}
const madeSessions = new Set<string>();
async function session(uid: string, tok: string) {
  const key = `${uid}:${tok}`;
  if (!madeSessions.has(key)) {
    madeSessions.add(key);
    await db.prepare('INSERT INTO sessions (id_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256b64(tok), uid, 1, NOW + 10_000_000).run();
  }
  return { cookie: `__Host-bwm_sid=${tok}` };
}
const call = (path: string, headers?: Record<string, string>, method = 'GET') => {
  const url = new URL(path, ORIGIN);
  const parts = url.pathname.split('/').filter(Boolean).map((s) => decodeURIComponent(s));
  return handleSocialHttp(new Request(url, { method, headers }), { DB: db, PUBLIC_ORIGIN: ORIGIN }, url, parts, NOW);
};

/** ua + human partner (side 0) vs two bots, playing as `teamName`. */
function duoGame(id: string, at: number, teamName: string, partnerId: string): GameRecord {
  const seats: SeatRef[] = [
    { name: 'Alice', side: 0, kind: 'user', uid: 'ua' },
    { name: 'Bot A', side: 1, kind: 'bot' },
    { name: 'Partner', side: 0, kind: 'user', uid: partnerId },
    { name: 'Bot B', side: 1, kind: 'bot' },
  ];
  return {
    id, room: 'R', mode: 'joker', kind: 'team', endedAt: at, hands: 5,
    final: [500, 300], winners: [0],
    names: [teamName, 'Bots'], seats,
    players: [
      { seat: 0, uid: 'ua', side: 0, won: true, partner: partnerId, teamName, stats: stats({ won: true }) },
      { seat: 2, uid: partnerId, side: 0, won: true, partner: 'ua', teamName, stats: stats({ won: true }) },
    ],
  };
}

/** ua + a bot partner (Dee), claimed from the device while signed in. */
function botGame(id: string, at: number, teamName: string): GameRecord {
  const seats: SeatRef[] = [
    { name: 'Alice', side: 0, kind: 'user', uid: 'ua' },
    { name: 'Bot A', side: 1, kind: 'bot' },
    { name: 'Dee', side: 0, kind: 'bot' },
    { name: 'Bot B', side: 1, kind: 'bot' },
  ];
  return {
    id, room: 'offline', mode: 'joker', kind: 'team', endedAt: at, hands: 5,
    final: [500, 300], winners: [0],
    names: [teamName, 'Bots'], seats,
    players: [{ seat: 0, uid: 'ua', side: 0, won: true, partner: null, teamName, stats: stats({ won: true }) }],
  };
}

/** Pre-feature history: rows exactly as saveRecord would have written them
 *  before rosters existed — inserted directly so no join hook fires. */
async function rawDuo(id: string, at: number, teamName: string, partnerId: string) {
  const seats = JSON.stringify([
    { name: 'Alice', side: 0, kind: 'user', uid: 'ua' },
    { name: 'Bot A', side: 1, kind: 'bot' },
    { name: 'Partner', side: 0, kind: 'user', uid: partnerId },
    { name: 'Bot B', side: 1, kind: 'bot' },
  ]);
  await db.prepare('INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(id, 'R', 'joker', 'team', at, 5, '[500,300]', '[0]', JSON.stringify([teamName, 'Bots']), seats).run();
  for (const [uid, seat, partner] of [['ua', 0, partnerId], [partnerId, 2, 'ua']] as const) {
    await db.prepare('INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, team_name, ended_at, stats) VALUES (?, ?, ?, ?, 0, 1, ?, ?, ?, ?)')
      .bind(id, uid, 'team', seat, partner, teamName, at, JSON.stringify(stats({ won: true }))).run();
  }
}
async function rawBot(id: string, at: number, teamName: string) {
  const seats = JSON.stringify([
    { name: 'Alice', side: 0, kind: 'user', uid: 'ua' },
    { name: 'Bot A', side: 1, kind: 'bot' },
    { name: 'Dee', side: 0, kind: 'bot' },
    { name: 'Bot B', side: 1, kind: 'bot' },
  ]);
  await db.prepare('INSERT INTO games (id, room, mode, kind, ended_at, hands, final, winners, names, seats, rated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .bind(id, 'offline', 'joker', 'team', at, 5, '[500,300]', '[0]', JSON.stringify([teamName, 'Bots']), seats).run();
  await db.prepare('INSERT INTO game_players (game_id, user_id, kind, seat, side, won, partner_id, team_name, ended_at, stats) VALUES (?, ?, ?, ?, 0, 1, NULL, ?, ?, ?)')
    .bind(id, 'ua', 'team', 0, teamName, at, JSON.stringify(stats({ won: true }))).run();
}

interface RosterOut { name: string; members: { id: string; name: string }[]; full: boolean }
async function myTeams(tok: string): Promise<RosterOut[]> {
  const res = await call('/api/social/teams', await session('ua', tok));
  expect(res.status).toBe(200);
  return ((await res.json()) as { teams: RosterOut[] }).teams;
}
const rosterOf = async (tok: string, name: string) => (await myTeams(tok)).find((t) => t.name === name);

beforeEach(async () => {
  madeSessions.clear();
  db = await makeD1();
  await user('ua', 'Alice');
  await user('ub', 'Bobby');
  await user('uc', 'Cee');
  await user('ud', 'Dee-Real');
  await user('ue', 'Eli');
});

describe('migration 0038', () => {
  it('creates the roster tables', async () => {
    const rows = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('team_rosters', 'team_roster_members') ORDER BY name").all<{ name: string }>()).results;
    expect(rows.map((r) => r.name)).toEqual(['team_roster_members', 'team_rosters']);
  });
});

describe('grandfather seeding', () => {
  it('seeds the top 3 human partners by games together; bot history never seeds', async () => {
    // Homies history: uc x3, ub x2, ud x1 (earlier), ue x1 (later), bots x4
    await rawDuo('h1', NOW + 100, 'Homies', 'ud');
    await rawDuo('h2', NOW + 200, 'Homies', 'ue');
    await rawDuo('h3', NOW + 300, 'Homies', 'ub');
    await rawDuo('h4', NOW + 400, 'Homies', 'ub');
    await rawDuo('h5', NOW + 500, 'Homies', 'uc');
    await rawDuo('h6', NOW + 600, 'Homies', 'uc');
    await rawDuo('h7', NOW + 700, 'Homies', 'uc');
    await rawBot('h8', NOW + 800, 'Homies');
    await rawBot('h9', NOW + 900, 'Homies');
    const r = await rosterOf('tok-seed', 'Homies');
    expect(r).toBeTruthy();
    expect(r!.members.map((m) => m.id)).toEqual(['uc', 'ub', 'ud']); // ud beats ue on the earliest-first-game tiebreak
    expect(r!.members.map((m) => m.name)).toEqual(['Cee', 'Bobby', 'Dee-Real']);
    expect(r!.full).toBe(true);
  });

  it('a name with only bot history seeds an empty roster', async () => {
    await rawBot('b1', NOW + 100, 'Bot Crew');
    await rawBot('b2', NOW + 200, 'Bot Crew');
    const r = await rosterOf('tok-bot', 'Bot Crew');
    expect(r).toBeTruthy();
    expect(r!.members).toEqual([]);
    expect(r!.full).toBe(false);
  });

  it('seeding happens once — ejecting everyone does not re-seed', async () => {
    await rawDuo('s1', NOW + 100, 'Homies', 'uc');
    await rawDuo('s2', NOW + 200, 'Homies', 'ub');
    const before = await rosterOf('tok-once', 'Homies');
    expect(before!.members.map((m) => m.id)).toEqual(['uc', 'ub']);
    const headers = await session('ua', 'tok-once');
    for (const m of ['uc', 'ub']) {
      const res = await call(`/api/social/teams/ua/Homies/members/${m}`, headers, 'DELETE');
      expect(res.status).toBe(200);
    }
    const after = await rosterOf('tok-once', 'Homies');
    expect(after!.members).toEqual([]);
  });
});

describe('join on play', () => {
  it('a human partner joins on the first recorded game under the name — both directions', async () => {
    await saveRecord(db, duoGame('j1', NOW + 100, 'Homies', 'uc'), true);
    const mine = await rosterOf('tok-join', 'Homies');
    expect(mine!.members.map((m) => m.id)).toEqual(['uc']);
    // the partner's own list is theirs: ua sits on uc's Homies roster too
    const res = await call('/api/social/teams', await session('uc', 'tok-join-c'));
    const theirs = ((await res.json()) as { teams: RosterOut[] }).teams.find((t) => t.name === 'Homies');
    expect(theirs!.members.map((m) => m.id)).toEqual(['ua']);
  });

  it('bot-partner games add nobody', async () => {
    await saveRecord(db, botGame('j2', NOW + 100, 'Homies'), false);
    const r = await rosterOf('tok-botjoin', 'Homies');
    expect(r!.members).toEqual([]);
  });

  it('the cap holds: a 4th human partner does not join a full roster', async () => {
    await saveRecord(db, duoGame('c1', NOW + 100, 'Caps', 'uc'), true);
    await saveRecord(db, duoGame('c2', NOW + 200, 'Caps', 'ub'), true);
    await saveRecord(db, duoGame('c3', NOW + 300, 'Caps', 'ud'), true);
    await saveRecord(db, duoGame('c4', NOW + 400, 'Caps', 'ue'), true);
    const r = await rosterOf('tok-cap', 'Caps');
    expect(r!.members.map((m) => m.id)).toEqual(['uc', 'ub', 'ud']);
    expect(r!.full).toBe(true);
  });
});

describe('eject', () => {
  it('frees the spot immediately — the next new partner joins', async () => {
    await saveRecord(db, duoGame('e1', NOW + 100, 'Caps', 'uc'), true);
    await saveRecord(db, duoGame('e2', NOW + 200, 'Caps', 'ub'), true);
    await saveRecord(db, duoGame('e3', NOW + 300, 'Caps', 'ud'), true);
    const headers = await session('ua', 'tok-eject');
    const res = await call('/api/social/teams/ua/Caps/members/ud', headers, 'DELETE');
    expect(res.status).toBe(200);
    const body = (await res.json()) as RosterOut;
    expect(body.members.map((m) => m.id)).toEqual(['uc', 'ub']);
    expect(body.full).toBe(false);
    await saveRecord(db, duoGame('e4', NOW + 400, 'Caps', 'ue'), true);
    const r = await rosterOf('tok-eject', 'Caps');
    expect(r!.members.map((m) => m.id)).toEqual(['uc', 'ub', 'ue']);
  });

  it('is owner-only: another signed-in player gets 403, signed-out gets 401', async () => {
    await saveRecord(db, duoGame('a1', NOW + 100, 'Homies', 'uc'), true);
    const asBobby = await call('/api/social/teams/ua/Homies/members/uc', await session('ub', 'tok-bobby'), 'DELETE');
    expect(asBobby.status).toBe(403);
    const anon = await call('/api/social/teams/ua/Homies/members/uc', undefined, 'DELETE');
    expect(anon.status).toBe(401);
    // and the member is still there
    const r = await rosterOf('tok-still', 'Homies');
    expect(r!.members.map((m) => m.id)).toEqual(['uc']);
  });

  it('ejecting a non-member is a 404; reading another owner\'s roster is a 403', async () => {
    await saveRecord(db, duoGame('a2', NOW + 100, 'Homies', 'uc'), true);
    const headers = await session('ua', 'tok-404');
    const res = await call('/api/social/teams/ua/Homies/members/ue', headers, 'DELETE');
    expect(res.status).toBe(404);
    const read = await call('/api/social/teams/ua/Homies', await session('ub', 'tok-bobby2'));
    expect(read.status).toBe(403);
  });

  it('never rewrites history: the team record is identical before and after an eject', async () => {
    await rawDuo('x1', NOW + 100, 'Homies', 'uc');
    await rawDuo('x2', NOW + 200, 'Homies', 'uc');
    await rawDuo('x3', NOW + 300, 'Homies', 'ub');
    await rawBot('x4', NOW + 400, 'Homies');
    const beforeRec = await teamRecordFor(db, 'ua', 'Homies');
    expect(beforeRec.games).toBe(4);
    await rosterOf('tok-hist', 'Homies'); // materialise the roster
    const res = await call('/api/social/teams/ua/Homies/members/uc', await session('ua', 'tok-hist'), 'DELETE');
    expect(res.status).toBe(200);
    const afterRec = await teamRecordFor(db, 'ua', 'Homies');
    expect(afterRec).toEqual(beforeRec);
  });
});
