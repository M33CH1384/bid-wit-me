import { beforeEach, describe, expect, it } from 'vitest';
import { makeRules } from '@spades/rules';
import { makeD1 } from './d1';
import { CHECKIN_MS, type TData, type TIO, type TMeta, alarm, begin, checkin, create, register, result, unregister, view } from '../src/tournament/service';
import { parseCreate } from '../src/tournament/routes';

let db: D1Database;
let now = 1_800_000_000_000;
const tables: { code: string; match: string; reserved: unknown[] }[] = [];
const notices: { uids: string[]; text: string; code?: string }[] = [];
let saved: TData | null = null;
let alarmAt: number | null = null;
const io = (): TIO => ({
  now: () => now, db,
  createMatchTable: async (s) => { const code = `T${tables.length}`; tables.push({ code, match: s.match, reserved: s.reserved }); return code; },
  notify: async (uids, n) => { notices.push({ uids, ...n }); },
  setAlarm: async (at) => { alarmAt = at; },
  save: async (d) => { saved = JSON.parse(JSON.stringify(d)); },
});
const users = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];
const meta = (o: Partial<TMeta> = {}): TMeta => ({ id: 'tid000000001', name: 'Friday Night', hostId: 'a', hostName: 'A', mode: 'joker', rules: makeRules('joker'), format: 'single', rounds: 0, team: true, max: 8, startAt: now + 3600_000, regOpenAt: now, regCloseAt: now + 3000_000, bots: true, status: 'upcoming', createdAt: now, ...o });
const U = (u: string) => ({ uid: u, name: u.toUpperCase() });

beforeEach(async () => {
  db = await makeD1();
  for (const u of users) await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(u, u.toUpperCase(), u, 1).run();
  tables.length = 0; notices.length = 0; saved = null; alarmAt = null;
});

async function teams(d: TData, n: number) {
  for (let i = 0; i < n; i++) d = await register(io(), d, U(users[2 * i]!), U(users[2 * i + 1]!), `Team ${i + 1}`);
  return d;
}

describe('tournament service', () => {
  it('validates the create form', () => {
    expect(parseCreate({ name: 'x', mode: 'joker', format: 'single', max: 8, startAt: now + 3600_000 }, now, false).ok).toBe(false);
    expect(parseCreate({ name: 'Weekly', mode: 'joker', format: 'single', max: 8, startAt: now + 60_000 }, now, false).ok).toBe(false);
    const ok = parseCreate({ name: 'Weekly', mode: 'cutthroat', format: 'swiss', rounds: 3, max: 12, startAt: now + 3600_000 }, now, false);
    expect(ok.ok && ok.v.team).toBe(false);
  });

  it('registration rules, check-in window, reminder alarm, a 4-team bracket to a champion', async () => {
    let d = await create(io(), meta());
    expect(alarmAt).toBe(now + 3600_000 - CHECKIN_MS);
    d = await teams(d, 4);
    await expect(register(io(), d, U('a'), U('i'), null)).rejects.toThrow(/already/);
    await expect(register(io(), d, U('i'), null, null)).rejects.toThrow(/partner/);
    d = await unregister(io(), d, 'h');
    expect(d.entries).toHaveLength(3);
    d = await register(io(), d, U('g'), U('h'), 'Team 4');
    await expect(checkin(io(), d, 'a')).rejects.toThrow(/10 minutes/);
    now += 3600_000 - CHECKIN_MS;
    d = await alarm(io(), d);
    expect(notices.at(-1)?.text).toMatch(/Check-in is open/);
    expect(alarmAt).toBe(d.meta.startAt);
    for (const u of ['a', 'c', 'e', 'g']) d = await checkin(io(), d, u);
    now = d.meta.startAt;
    d = await alarm(io(), d);
    expect(d.meta.status).toBe('live');
    expect(tables).toHaveLength(2);
    // team seats: entry 0 at seats 0/2, entry 1 at 1/3
    expect((tables[0]!.reserved as { uid: string }[]).map((r) => r?.uid)).toHaveLength(4);
    expect(notices.filter((n) => n.code).length).toBe(8);
    const r1 = d.state!.matches.filter((m) => m.round === 1);
    for (const m of r1) d = await result(io(), d, m.id, [500, 200], [1, 2]);
    expect(tables).toHaveLength(3);
    const final = d.state!.matches.find((m) => m.round === 2)!;
    d = await result(io(), d, final.id, [100, 520], [2, 1]);
    expect(d.meta.status).toBe('finished');
    const v = view(d, 'a', now);
    expect(v.champion).toBeTruthy();
    const champ = d.entries.find((e) => e.name === v.champion)!;
    const aw = (await db.prepare("SELECT user_id FROM awards WHERE kind = 'champion'").all<{ user_id: string }>()).results.map((r) => r.user_id).sort();
    expect(aw).toEqual(champ.members.map((m) => m.uid).sort());
    const row = await db.prepare('SELECT status, champion, entrants FROM tournaments WHERE id = ?').bind(d.meta.id).first();
    expect(row).toMatchObject({ status: 'finished', champion: champ.name, entrants: 4 });
    expect(saved).not.toBeNull();
  });

  it('Swiss, solo Cutthroat: 6 players × 2 rounds, then standings decide', async () => {
    let d = await create(io(), meta({ mode: 'cutthroat', team: false, format: 'swiss', rounds: 2, rules: makeRules('cutthroat', { playerCount: 3 }) }));
    for (const u of users.slice(0, 6)) d = await register(io(), d, U(u), null, null);
    now = d.meta.startAt - CHECKIN_MS;
    for (const u of users.slice(0, 6)) d = await checkin(io(), d, u);
    d = await begin(io(), d);
    expect(tables).toHaveLength(2);
    for (let r = 1; r <= 2; r++) for (const m of d.state!.matches.filter((x) => x.round === r)) d = await result(io(), d, m.id, [300, 200, 100], [1, 2, 3]);
    expect(d.meta.status).toBe('finished');
    expect(view(d, null, now).standings.length).toBe(6);
  });

  it('calls it off when nobody checks in and bots are off', async () => {
    let d = await create(io(), meta({ bots: false }));
    d = await teams(d, 2);
    now = d.meta.startAt;
    d = await begin(io(), d);
    expect(d.meta.status).toBe('cancelled');
  });
});
