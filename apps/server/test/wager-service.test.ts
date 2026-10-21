/** Big Bank Take Lil Bank (Phase 1): challenge lifecycle over a fake WIO — create/accept/decline/cancel/check-in/alarms and EVERY settlement branch, with real D1 coin balances as the assertion surface. */
import { beforeEach, describe, expect, it } from 'vitest';
import { makeRules } from '@spades/rules';
import { makeD1 } from './d1';
import { balance, move } from '../src/cred/coins';
import { awardXp, xpAtLevel } from '../src/cred/xp';
import { accept, alarm, cancel, checkin, create, decline, result, view, type WData, type WIO, type WPerson } from '../src/wager/service';
import { parseCreate } from '../src/wager/routes';

const T0 = 1_800_000_000_000;
let db: D1Database;
let now = T0;
const tablesSeen: { cid: string; reserved: { uid: string; name: string }[]; autostartAt: number }[] = [];
const notices: { uids: string[]; text: string; code?: string; seat?: number; cid?: string }[] = [];
const pushes: { cid: string; uid: string; kind: string }[] = [];
const wires: { id: string; text: string }[] = [];
let alarmAt: number | null = null;
let tableFails = false;

const io = (): WIO => ({
  now: () => now, db,
  save: async () => undefined,
  setAlarm: async (at) => { alarmAt = at; },
  notify: async (uids, n) => { notices.push({ uids, ...n }); },
  wire: async (id, text) => { wires.push({ id, text }); },
  push: async (cid, uid, kind) => { pushes.push({ cid, uid, kind }); },
  createMatchTable: async (s) => { if (tableFails) throw new Error('no table'); tablesSeen.push(s); return `TBL${tablesSeen.length}`; },
});

const USERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const P = (uid: string): WPerson => ({ uid, name: uid.toUpperCase() });
const bal = (u: string) => balance(db, u);
const setFlag = (key: string, on: boolean) =>
  db.prepare('INSERT INTO cred_flags (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, on ? '1' : '0').run();

beforeEach(async () => {
  db = await makeD1();
  now = T0;
  tablesSeen.length = 0; notices.length = 0; pushes.length = 0; wires.length = 0; alarmAt = null; tableFails = false;
  for (const u of USERS) {
    await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(u, u.toUpperCase(), u, 1).run();
    await awardXp(db, u, xpAtLevel(20), now); // everyone starts at Rep Level 20 unless a test demotes them
    await move(db, u, 10_000, 'admin', null, now);
  }
  await setFlag('wager_challenges_enabled', true);
});

let seq = 0;
const cid = () => `c${String(++seq).padStart(11, '0')}`;
const mkPartnership = (wager = 100, startAt = now + 3600_000) =>
  create(io(), { id: cid(), format: 'partnership', rules: makeRules('joker'), wager, startAt, challenger: P('a'), opponent: P('b'), partner: P('c'), invitees: [] });
const mkCutthroat = (wager = 100, startAt = now + 3600_000) =>
  create(io(), { id: cid(), format: 'cutthroat', rules: makeRules('cutthroat', { playerCount: 4 }), wager, startAt, challenger: P('a'), opponent: null, partner: null, invitees: [P('b'), P('c'), P('d')] });

async function fullPartnership(wager = 100): Promise<WData> {
  let d = await mkPartnership(wager);
  d = await accept(io(), d, P('b'), P('d'));
  d = await accept(io(), d, P('c'), null);
  d = await accept(io(), d, P('d'), null);
  return d;
}
async function livePartnership(wager = 100): Promise<WData> {
  let d = await fullPartnership(wager);
  now = d.startAt - 600_000;
  d = await alarm(io(), d);
  now = d.startAt;
  d = await alarm(io(), d);
  return d;
}
async function liveCutthroat(wager = 100): Promise<WData> {
  let d = await mkCutthroat(wager);
  d = await accept(io(), d, P('c'), null);
  d = await accept(io(), d, P('d'), null);
  d = await accept(io(), d, P('b'), null);
  now = d.startAt;
  d = await alarm(io(), d);
  return d;
}

describe('create', () => {
  it('escrows the challenger at send, invites the rest, arms the accept-deadline alarm', async () => {
    const d = await mkPartnership(250);
    expect(d.status).toBe('pending');
    expect(await bal('a')).toBe(9750);
    expect(await bal('b')).toBe(10_000);
    expect(alarmAt).toBe(d.startAt - 600_000);
    expect(pushes.filter((p) => p.kind === 'invite').map((p) => p.uid).sort()).toEqual(['b', 'c']);
    expect(notices[0]!.text).toMatch(/challenged you to Big Bank/);
    // the D1 projection rows exist for list reads
    const row = await db.prepare('SELECT status, wager FROM wager_challenges WHERE id = ?').bind(d.id).first<{ status: string; wager: number }>();
    expect(row).toEqual({ status: 'pending', wager: 250 });
  });

  it('flag off: create 404s and escrows nothing', async () => {
    await setFlag('wager_challenges_enabled', false);
    await expect(mkPartnership()).rejects.toMatchObject({ status: 404 });
    expect(await bal('a')).toBe(10_000);
  });

  it('level gate: a level-19 challenger cannot create', async () => {
    await db.prepare('UPDATE xp_state SET xp = ?, level = 19 WHERE user_id = ?').bind(xpAtLevel(19), 'a').run();
    await expect(mkPartnership()).rejects.toMatchObject({ status: 403 });
    expect(await bal('a')).toBe(10_000);
  });

  it('insufficient balance: create refuses and nothing is escrowed', async () => {
    await move(db, 'a', -9950, 'admin', null, now);
    await expect(mkPartnership(100)).rejects.toMatchObject({ status: 400 });
    expect(await bal('a')).toBe(50);
  });

  it('blocked pairs cannot be challenged', async () => {
    await db.prepare('INSERT INTO blocks (blocker, blocked, created_at) VALUES (?, ?, ?)').bind('b', 'a', now).run();
    await expect(mkPartnership()).rejects.toMatchObject({ status: 403 });
  });

  it('shape validation: partnership needs a partner; cutthroat needs exactly three invitees', async () => {
    await expect(create(io(), { id: cid(), format: 'partnership', rules: makeRules('joker'), wager: 100, startAt: now + 3600_000, challenger: P('a'), opponent: P('b'), partner: null, invitees: [] })).rejects.toMatchObject({ status: 400 });
    await expect(create(io(), { id: cid(), format: 'cutthroat', rules: makeRules('cutthroat', { playerCount: 4 }), wager: 100, startAt: now + 3600_000, challenger: P('a'), opponent: null, partner: null, invitees: [P('c')] })).rejects.toMatchObject({ status: 400 });
    await expect(create(io(), { id: cid(), format: 'partnership', rules: makeRules('joker'), wager: 100, startAt: now + 3600_000, challenger: P('a'), opponent: P('a'), partner: P('c'), invitees: [] })).rejects.toMatchObject({ status: 400 });
  });
});

describe('accept', () => {
  it('partnership: opponent names a partner, everyone escrows, the fourth accept schedules', async () => {
    let d = await mkPartnership(100);
    d = await accept(io(), d, P('c'), null);
    expect(await bal('c')).toBe(9900);
    expect(d.status).toBe('pending'); // opponent hasn't accepted yet
    d = await accept(io(), d, P('b'), P('d'));
    expect(await bal('b')).toBe(9900);
    expect(d.players.find((p) => p.uid === 'd')?.status).toBe('invited');
    expect(pushes.at(-1)).toMatchObject({ uid: 'd', kind: 'invite' });
    d = await accept(io(), d, P('d'), null);
    expect(d.status).toBe('scheduled');
    expect(await bal('d')).toBe(9900);
    expect(notices.at(-1)?.text).toMatch(/match scheduled/);
  });

  it('the opponent must name a partner; a partner pick from anyone else is refused', async () => {
    const d = await mkPartnership();
    await expect(accept(io(), d, P('b'), null)).rejects.toMatchObject({ status: 400 });
    await expect(accept(io(), d, P('c'), P('e'))).rejects.toMatchObject({ status: 400 });
    await expect(accept(io(), d, P('b'), P('b'))).rejects.toMatchObject({ status: 400 });
    await expect(accept(io(), d, P('b'), P('c'))).rejects.toMatchObject({ status: 409 }); // already in it
  });

  it('level gate: a level-19 invitee cannot accept, and a level-19 named partner blocks the accept', async () => {
    await db.prepare('UPDATE xp_state SET xp = ?, level = 19 WHERE user_id = ?').bind(xpAtLevel(19), 'c').run();
    const d = await mkPartnership();
    await expect(accept(io(), d, P('c'), null)).rejects.toMatchObject({ status: 403 });
    await db.prepare('UPDATE xp_state SET xp = ?, level = 19 WHERE user_id = ?').bind(xpAtLevel(19), 'e').run();
    await expect(accept(io(), d, P('b'), P('e'))).rejects.toMatchObject({ status: 403 });
    expect(await bal('b')).toBe(10_000); // the failed accept escrowed nothing
  });

  it('insufficient balance: accept refuses, the invite stays open, a top-up lets it through', async () => {
    await move(db, 'c', -9950, 'admin', null, now);
    const d = await mkPartnership();
    await expect(accept(io(), d, P('c'), null)).rejects.toMatchObject({ status: 400 });
    expect(d.players.find((p) => p.uid === 'c')?.status).toBe('invited');
    await move(db, 'c', 1000, 'admin', null, now);
    const d2 = await accept(io(), d, P('c'), null);
    expect(d2.players.find((p) => p.uid === 'c')?.status).toBe('accepted');
    expect(await bal('c')).toBe(950);
  });

  it('accept after the deadline (check-in open) is refused', async () => {
    const d = await mkPartnership();
    now = d.startAt - 600_000;
    await expect(accept(io(), d, P('c'), null)).rejects.toMatchObject({ status: 409 });
  });

  it('concurrency cap: a fourth escrowed challenge cannot be accepted or created', async () => {
    for (let i = 0; i < 3; i++) {
      const d = await mkPartnership(100);
      await accept(io(), d, P('c'), null); // c now escrowed in 3 pending challenges (projection rows synced)
    }
    // a fresh challenge from someone else (f, with partner g): c is invited as f's partner
    const d4 = await create(io(), { id: cid(), format: 'partnership', rules: makeRules('joker'), wager: 100, startAt: now + 3600_000, challenger: P('f'), opponent: P('g'), partner: P('c'), invitees: [] });
    await expect(accept(io(), d4, P('c'), null)).rejects.toMatchObject({ status: 409 });
    // and c cannot create a fourth escrowed challenge either
    await expect(create(io(), { id: cid(), format: 'partnership', rules: makeRules('joker'), wager: 100, startAt: now + 3600_000, challenger: P('c'), opponent: P('g'), partner: P('f'), invitees: [] })).rejects.toMatchObject({ status: 409 });
  });
});

describe('decline / cancel / expiry', () => {
  it('decline refunds every escrow and closes the challenge', async () => {
    let d = await mkPartnership(250);
    d = await accept(io(), d, P('c'), null);
    d = await decline(io(), d, 'b');
    expect(d.status).toBe('declined');
    expect(await bal('a')).toBe(10_000);
    expect(await bal('c')).toBe(10_000);
  });

  it('expiry at the accept deadline refunds the challenger', async () => {
    let d = await mkPartnership(100);
    now = d.startAt - 600_000;
    d = await alarm(io(), d);
    expect(d.status).toBe('expired');
    expect(await bal('a')).toBe(10_000);
  });

  it('cancel is free before the window and refused inside it', async () => {
    let d = await fullPartnership(100);
    d = await cancel(io(), d, 'c', false);
    expect(d.status).toBe('cancelled');
    for (const u of ['a', 'b', 'c', 'd']) expect(await bal(u)).toBe(10_000);

    const d2 = await fullPartnership(100);
    now = d2.startAt - 600_000;
    await expect(cancel(io(), d2, 'a', false)).rejects.toMatchObject({ status: 409 });
    await expect(decline(io(), d2, 'a')).rejects.toMatchObject({ status: 409 });
  });
});

describe('check-in + begin', () => {
  it('the alarm opens check-in (status + pushes), checkin marks players, the start alarm seats the table in order', async () => {
    let d = await fullPartnership(100);
    now = d.startAt - 600_000;
    d = await alarm(io(), d);
    expect(d.status).toBe('checkin');
    expect(pushes.filter((p) => p.kind === 'checkin')).toHaveLength(4);
    expect(alarmAt).toBe(d.startAt);
    d = await checkin(io(), d, 'a');
    expect(d.players.find((p) => p.uid === 'a')?.checkedIn).toBe(true);
    now = d.startAt;
    d = await alarm(io(), d);
    expect(d.status).toBe('live');
    expect(d.tableCode).toBe('TBL1');
    // partnership seat order: challenger, opponent, partner(side 0), partner(side 1)
    expect(tablesSeen[0]!.reserved.map((r) => r.uid)).toEqual(['a', 'b', 'c', 'd']);
    expect(tablesSeen[0]!.autostartAt).toBe(now + 180_000);
    expect(pushes.filter((p) => p.kind === 'ready')).toHaveLength(4);
    expect(notices.at(-1)?.code).toBe('TBL1');
  });

  it('check-in before the window opens is refused', async () => {
    const d = await fullPartnership(100);
    await expect(checkin(io(), d, 'a')).rejects.toMatchObject({ status: 409 });
  });

  it('a table that cannot be created retries, then refunds everyone after repeated failures', async () => {
    tableFails = true;
    let d = await fullPartnership(100);
    now = d.startAt;
    for (let i = 0; i < 5; i++) { d = await alarm(io(), d); now += 30_000; }
    expect(d.status).toBe('cancelled');
    for (const u of ['a', 'b', 'c', 'd']) expect(await bal(u)).toBe(10_000);
  });
});

describe('settlement: played', () => {
  it('partnership: the winning side splits the pot (net +wager each), losers lose their wager; a duplicate result is a no-op', async () => {
    const d = await livePartnership(100);
    const after = await result(io(), d, { kind: 'played', scores: [500, 320], places: [1, 2], gameId: 'game-1' });
    expect(after.status).toBe('settled');
    expect(after.gameId).toBe('game-1');
    expect(await bal('a')).toBe(10_100);
    expect(await bal('c')).toBe(10_100);
    expect(await bal('b')).toBe(9900);
    expect(await bal('d')).toBe(9900);
    expect(pushes.filter((p) => p.kind === 'outcome')).toHaveLength(4);
    const again = await result(io(), after, { kind: 'played', scores: [500, 320], places: [1, 2], gameId: 'game-1' });
    expect(again.status).toBe('settled');
    expect(await bal('a')).toBe(10_100); // unchanged — settled once
  });

  it('a settled match posts ONE League Wire line (item 7); the duplicate result wires nothing', async () => {
    const d = await livePartnership(100);
    const after = await result(io(), d, { kind: 'played', scores: [500, 320], places: [1, 2], gameId: 'game-1' });
    expect(wires).toHaveLength(1);
    expect(wires[0]!.id).toBe(`wager:${d.id}:played`);
    expect(wires[0]!.text).toContain('🚨 BREAKING —');
    expect(wires[0]!.text).toContain('took the Big Bank pot of 400 coins');
    await result(io(), after, { kind: 'played', scores: [500, 320], places: [1, 2], gameId: 'game-1' });
    expect(wires).toHaveLength(1);
  });

  it('cutthroat seats follow accept order and the winner takes the whole 4x pot (net +3x wager)', async () => {
    let d = await mkCutthroat(250);
    d = await accept(io(), d, P('d'), null);
    now += 1000;
    d = await accept(io(), d, P('c'), null);
    now += 1000;
    d = await accept(io(), d, P('b'), null);
    now = d.startAt;
    d = await alarm(io(), d);
    expect(tablesSeen[0]!.reserved.map((r) => r.uid)).toEqual(['a', 'd', 'c', 'b']); // challenger, then accept order
    const after = await result(io(), d, { kind: 'played', scores: [0, 300, 0, 0], places: [2, 1, 2, 2], gameId: 'game-2' });
    expect(after.status).toBe('settled');
    expect(await bal('d')).toBe(10_000 - 250 + 1000); // seat 1 won: refund 250 + net win 750
    expect(await bal('a')).toBe(9750);
    expect(await bal('b')).toBe(9750);
  });

  it('cutthroat two-way tie for first splits the pot', async () => {
    const d = await liveCutthroat(100);
    const seatOf = (u: string) => d.players.find((p) => p.uid === u)!.seat!;
    const places = [2, 2, 2, 2];
    places[seatOf('a')] = 1;
    places[seatOf('b')] = 1;
    const after = await result(io(), d, { kind: 'played', scores: [300, 300, 0, 0], places, gameId: 'game-3' });
    expect(after.status).toBe('settled');
    expect(await bal('a')).toBe(10_100); // gross 200 each: refund 100 + win 100
    expect(await bal('b')).toBe(10_100);
    expect(await bal('c')).toBe(9900);
  });
});

describe('settlement: no-show', () => {
  it('partnership: a missing partner forfeits to the present pair; the partner who showed is refunded', async () => {
    const d = await livePartnership(100);
    const after = await result(io(), d, { kind: 'noshow', shown: ['a', 'b', 'c'] }); // d (b's partner) missing
    expect(after.status).toBe('forfeited');
    expect(after.endReason).toBe('no_show');
    expect(await bal('a')).toBe(10_050); // refund 100 + half of d's 100
    expect(await bal('c')).toBe(10_050);
    expect(await bal('b')).toBe(10_000); // showed: made whole
    expect(await bal('d')).toBe(9900); // no-show: wager gone
  });

  it('partnership: neither side complete → void, full refunds', async () => {
    const d = await livePartnership(100);
    const after = await result(io(), d, { kind: 'noshow', shown: ['a', 'b'] }); // c and d both missing
    expect(after.status).toBe('void');
    for (const u of ['a', 'b', 'c', 'd']) expect(await bal(u)).toBe(10_000);
  });

  it('cutthroat: one no-show voids the match; the three who showed split the escrow (remainder to the lowest seat)', async () => {
    const d = await liveCutthroat(100);
    const missing = d.players.find((p) => p.seat === 3)!;
    const shown = d.players.filter((p) => p.seat !== 3).map((p) => p.uid);
    const after = await result(io(), d, { kind: 'noshow', shown });
    expect(after.status).toBe('forfeited');
    const seat0 = d.players.find((p) => p.seat === 0)!;
    const seat1 = d.players.find((p) => p.seat === 1)!;
    const seat2 = d.players.find((p) => p.seat === 2)!;
    expect(await bal(seat0.uid)).toBe(10_034); // 100 split 3 ways: 34/33/33
    expect(await bal(seat1.uid)).toBe(10_033);
    expect(await bal(seat2.uid)).toBe(10_033);
    expect(await bal(missing.uid)).toBe(9900);
  });

  it('cutthroat: nobody shows → void, full refunds', async () => {
    const d = await liveCutthroat(100);
    const after = await result(io(), d, { kind: 'noshow', shown: [] });
    expect(after.status).toBe('void');
    for (const u of ['a', 'b', 'c', 'd']) expect(await bal(u)).toBe(10_000);
  });
});

describe('settlement: abandoned', () => {
  it('a mid-match leaver forfeits their wager to the other three', async () => {
    const d = await livePartnership(100);
    const after = await result(io(), d, { kind: 'abandoned', leaverUid: 'b' });
    expect(after.status).toBe('forfeited');
    expect(after.endReason).toBe('abandoned');
    // others by seat: a(0) c(2) d(3) → 34/33/33 of b's 100, plus their refunds
    expect(await bal('a')).toBe(10_034);
    expect(await bal('c')).toBe(10_033);
    expect(await bal('d')).toBe(10_033);
    expect(await bal('b')).toBe(9900);
  });

  it('an abandoned report with no leaver voids the match', async () => {
    const d = await livePartnership(100);
    const after = await result(io(), d, { kind: 'abandoned', leaverUid: null });
    expect(after.status).toBe('void');
    for (const u of ['a', 'b', 'c', 'd']) expect(await bal(u)).toBe(10_000);
  });

  it('a result reported before the match is live settles nothing', async () => {
    const d = await fullPartnership(100);
    const after = await result(io(), d, { kind: 'played', scores: [1, 0], places: [1, 2], gameId: 'early' });
    expect(after.status).toBe('scheduled');
    expect(await bal('a')).toBe(9900); // still escrowed
  });
});

describe('view', () => {
  it('exposes per-viewer affordances', async () => {
    const d = await mkPartnership(100);
    const v = view(d, 'b', now);
    expect(v.you?.canAccept).toBe(true);
    expect(v.pot).toBe(400);
    expect(view(d, 'a', now).you?.canAccept).toBe(false);
    expect(view(d, null, now).you).toBeNull();
  });
});

describe('net outcome (Phase 2 display field)', () => {
  const nets = (d: WData) => Object.fromEntries(view(d, null, now).players.map((p) => [p.uid, p.net]));
  const projNets = async (id: string) => {
    const rows = (await db.prepare('SELECT user_id AS uid, net FROM wager_challenge_players WHERE challenge_id = ?').bind(id).all<{ uid: string; net: number | null }>()).results;
    return Object.fromEntries(rows.map((r) => [r.uid, r.net]));
  };

  it('is null while the challenge is unresolved', async () => {
    const d = await fullPartnership(100);
    expect(Object.values(nets(d)).every((n) => n === null)).toBe(true);
  });

  it('played partnership: winners +wager, losers -wager — in the view and the D1 projection', async () => {
    const d = await livePartnership(100);
    const after = await result(io(), d, { kind: 'played', scores: [500, 320], places: [1, 2], gameId: 'game-net' });
    expect(nets(after)).toEqual({ a: 100, b: -100, c: 100, d: -100 });
    expect(await projNets(after.id)).toEqual({ a: 100, b: -100, c: 100, d: -100 });
  });

  it('no-show partnership: present pair gains the split, the partner who showed breaks even, the no-show loses', async () => {
    const d = await livePartnership(100);
    const after = await result(io(), d, { kind: 'noshow', shown: ['a', 'b', 'c'] });
    expect(nets(after)).toEqual({ a: 50, b: 0, c: 50, d: -100 });
    expect(await projNets(after.id)).toEqual({ a: 50, b: 0, c: 50, d: -100 });
  });

  it('void and early exits leave everyone at 0', async () => {
    const d = await livePartnership(100);
    const voided = await result(io(), d, { kind: 'noshow', shown: [] });
    expect(Object.values(nets(voided)).every((n) => n === 0)).toBe(true);
    const d2 = await mkPartnership(100);
    const declined = await decline(io(), d2, 'b');
    expect(nets(declined)).toEqual({ a: 0, b: 0, c: 0 });
  });
});

describe('parseCreate (routes)', () => {
  const H = 7 * 24 * 3600_000;
  it('accepts the partnership menu and freezes rules', () => {
    const r = parseCreate({ format: 'partnership', wager: 250, deck: 'aceDown', target: 750, timers: 'chill', startAt: now + 3600_000, opponent: 'B', partner: 'C' }, now, H);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.v.rules.mode).toBe('aceDown');
      expect(r.v.rules.targetScore).toBe(750);
      expect(r.v.rules.turnTimerSec).toEqual({ bid: 45, play: 45 });
    }
  });
  it('accepts cutthroat with its own menu (Joker deck, 4P, target 250/300/500)', () => {
    const r = parseCreate({ format: 'cutthroat', wager: 100, target: 250, startAt: now + 3600_000, opponent: 'B', invitees: ['C', 'D', 'E'] }, now, H);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.v.rules.playerCount).toBe(4);
      expect(r.v.rules.partnerships).toBe(false);
      expect(r.v.rules.targetScore).toBe(250);
    }
  });
  it('rejects off-menu values', () => {
    const base = { format: 'partnership', wager: 100, startAt: now + 3600_000, opponent: 'B', partner: 'C' };
    expect(parseCreate({ ...base, wager: 150 }, now, H).ok).toBe(false);
    expect(parseCreate({ ...base, target: 400 }, now, H).ok).toBe(false);
    expect(parseCreate({ ...base, timers: 'turbo' }, now, H).ok).toBe(false);
    expect(parseCreate({ ...base, startAt: now + 5 * 60_000 }, now, H).ok).toBe(false); // inside the accept window already
    expect(parseCreate({ ...base, startAt: now + 8 * 24 * 3600_000 }, now, H).ok).toBe(false); // past the horizon
    expect(parseCreate({ format: 'cutthroat', wager: 100, deck: 'aceDown', startAt: now + 3600_000, opponent: 'B', invitees: ['C', 'D', 'E'] }, now, H).ok).toBe(false);
    expect(parseCreate({ format: 'cutthroat', wager: 100, target: 750, startAt: now + 3600_000, opponent: 'B', invitees: ['C', 'D', 'E'] }, now, H).ok).toBe(false);
    expect(parseCreate({ format: 'cutthroat', wager: 100, startAt: now + 3600_000, opponent: 'B', invitees: ['C', 'D'] }, now, H).ok).toBe(false);
  });
});
