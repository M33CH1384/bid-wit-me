/**
 * Release 9b: one tournament (what the Tournament Durable Object does minus Cloudflare plumbing).
 * Registration → check-in (10 min before the start) → start (DO alarm, or the host) → tables auto-seated per round →
 * results from the tables advance the bracket → champion + awards. D1 keeps a listing row in sync.
 */
import type { TableRules } from '@spades/rules';
import { type Entry, type Format, type TState, newState, pendingMatches, report, standings, start } from './engine';

export const CHECKIN_MS = 10 * 60_000;
export const SEAT_GRACE_MS = 3 * 60_000;

export interface TMeta {
  id: string; name: string; hostId: string; hostName: string;
  mode: 'joker' | 'aceDown' | 'cutthroat'; rules: TableRules; format: Format; rounds: number; team: boolean;
  max: number; startAt: number; regOpenAt: number; regCloseAt: number; bots: boolean;
  status: 'upcoming' | 'live' | 'finished' | 'cancelled'; createdAt: number; fast?: boolean;
}
export interface TData { meta: TMeta; entries: Entry[]; state: TState | null; tables: Record<string, string>; seq: number; remindedCheckin?: boolean }

export interface TIO {
  now(): number;
  db: D1Database;
  /** create a table DO set up for this match; returns its code */
  createMatchTable(setup: { tid: string; name: string; match: string; rules: TableRules; reserved: ({ uid: string; name: string } | null)[]; autostartAt: number; bots: boolean; fast?: boolean }): Promise<string>;
  /** in-app notice to these accounts (Social hub) */
  notify(uids: string[], n: { text: string; code?: string; seat?: number; tid?: string }): Promise<void>;
  setAlarm(at: number): Promise<void>;
  save(d: TData): Promise<void>;
}

export class TError extends Error { constructor(public status: number, msg: string) { super(msg); } }

const k = (m: TMeta) => (m.team ? 2 : m.rules.playerCount);

export async function syncRow(io: TIO, d: TData): Promise<void> {
  const m = d.meta;
  const champ = d.state?.champion ? d.entries.find((e) => e.id === d.state!.champion)?.name ?? null : null;
  await io.db.prepare(`INSERT INTO tournaments (id, name, host_id, host_name, mode, format, rounds, team, max_entrants, start_at, reg_open_at, reg_close_at, bots, status, entrants, champion, created_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET status = excluded.status, entrants = excluded.entrants, champion = excluded.champion, finished_at = excluded.finished_at, start_at = excluded.start_at`)
    .bind(m.id, m.name, m.hostId, m.hostName, m.mode, m.format, m.format === 'swiss' ? m.rounds : null, m.team ? 1 : 0, m.max, m.startAt, m.regOpenAt, m.regCloseAt, m.bots ? 1 : 0, m.status, d.entries.length, champ, m.createdAt, m.status === 'finished' ? io.now() : null).run();
}

export async function create(io: TIO, meta: TMeta): Promise<TData> {
  const d: TData = { meta, entries: [], state: null, tables: {}, seq: 0 };
  await io.save(d);
  await syncRow(io, d);
  await io.setAlarm(Math.max(io.now() + 1000, meta.startAt - CHECKIN_MS));
  return d;
}

const uidsOf = (d: TData) => d.entries.flatMap((e) => e.members.map((m) => m.uid));

export async function register(io: TIO, d: TData, me: { uid: string; name: string }, partner: { uid: string; name: string } | null, teamName: string | null): Promise<TData> {
  const m = d.meta, now = io.now();
  if (m.status !== 'upcoming') throw new TError(409, 'Registration is closed.');
  if (now < m.regOpenAt) throw new TError(409, 'Registration has not opened yet.');
  if (now > m.regCloseAt) throw new TError(409, 'Registration is closed.');
  if (d.entries.length >= m.max) throw new TError(409, 'The tournament is full.');
  if (m.team && !partner) throw new TError(400, 'Team tournaments need a partner: enter their username.');
  if (partner && partner.uid === me.uid) throw new TError(400, "You can't partner yourself.");
  const taken = new Set(uidsOf(d));
  if (taken.has(me.uid)) throw new TError(409, "You're already registered.");
  if (partner && taken.has(partner.uid)) throw new TError(409, `${partner.name} is already registered.`);
  const members = m.team ? [me, partner!] : [me];
  const id = `e${++d.seq}`;
  const name = m.team ? (teamName?.trim() || `${me.name} + ${partner!.name}`) : me.name;
  d.entries.push({ id, name, members, seed: d.entries.length + 1, checkedIn: false });
  await io.db.batch(members.map((x) => io.db.prepare('INSERT OR IGNORE INTO tournament_players (tid, user_id, entry_id) VALUES (?, ?, ?)').bind(m.id, x.uid, id)));
  await io.save(d);
  await syncRow(io, d);
  return d;
}

export async function unregister(io: TIO, d: TData, uid: string): Promise<TData> {
  if (d.meta.status !== 'upcoming') throw new TError(409, 'The tournament has started.');
  const e = d.entries.find((x) => x.members.some((m) => m.uid === uid));
  if (!e) throw new TError(404, "You're not registered.");
  d.entries = d.entries.filter((x) => x !== e);
  d.entries.forEach((x, i) => { x.seed = i + 1; });
  await io.db.prepare('DELETE FROM tournament_players WHERE tid = ? AND entry_id = ?').bind(d.meta.id, e.id).run();
  await io.save(d);
  await syncRow(io, d);
  return d;
}

export async function checkin(io: TIO, d: TData, uid: string): Promise<TData> {
  const now = io.now();
  if (d.meta.status !== 'upcoming') throw new TError(409, 'Check-in is over.');
  if (now < d.meta.startAt - CHECKIN_MS) throw new TError(409, 'Check-in opens 10 minutes before the start.');
  const e = d.entries.find((x) => x.members.some((m) => m.uid === uid));
  if (!e) throw new TError(404, "You're not registered.");
  e.checkedIn = true;
  await io.save(d);
  return d;
}

export async function cancel(io: TIO, d: TData): Promise<TData> {
  if (d.meta.status === 'finished') throw new TError(409, 'Already finished.');
  d.meta.status = 'cancelled';
  await io.save(d);
  await syncRow(io, d);
  await io.notify(uidsOf(d), { text: `${d.meta.name} was cancelled by the host.`, tid: d.meta.id });
  return d;
}

/** alarm: check-in reminders, then the scheduled start */
export async function alarm(io: TIO, d: TData): Promise<TData> {
  const now = io.now();
  if (d.meta.status !== 'upcoming') return d;
  if (now < d.meta.startAt - 1000) {
    if (!d.remindedCheckin) {
      d.remindedCheckin = true;
      await io.save(d);
      await io.notify(uidsOf(d), { text: `Check-in is open for ${d.meta.name}: starts in ${Math.max(1, Math.round((d.meta.startAt - now) / 60_000))} min.`, tid: d.meta.id });
    }
    await io.setAlarm(d.meta.startAt);
    return d;
  }
  return begin(io, d);
}

export async function begin(io: TIO, d: TData): Promise<TData> {
  if (d.meta.status !== 'upcoming') throw new TError(409, 'Already started.');
  const m = d.meta;
  const seed = [...m.id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  d.state = start(newState(m.format, k(m), m.rounds, d.entries), { botsForNoShows: m.bots, seed });
  if (d.state.done && !d.state.champion) {
    m.status = 'cancelled';
    await io.save(d);
    await syncRow(io, d);
    await io.notify(uidsOf(d), { text: `${m.name} was called off: not enough entrants checked in.`, tid: m.id });
    return d;
  }
  m.status = 'live';
  await io.save(d);
  await syncRow(io, d);
  return seat(io, d);
}

/** open a table for every pending match of the round and tell the entrants where to go */
async function seat(io: TIO, d: TData): Promise<TData> {
  const st = d.state!;
  if (st.done) return finish(io, d);
  const m = d.meta;
  for (const match of pendingMatches(st)) {
    if (d.tables[match.id]) continue;
    const n = m.rules.playerCount;
    const reserved: ({ uid: string; name: string } | null)[] = Array(4).fill(null);
    match.entries.forEach((eid, i) => {
      const e = st.entries.find((x) => x.id === eid)!;
      if (m.team) { reserved[i] = e.members[0] ?? null; reserved[i + 2] = e.members[1] ?? null; } else if (i < n) reserved[i] = e.members[0] ?? null;
    });
    // entries that never checked in (bots play for them)
    match.entries.forEach((eid, i) => {
      const e = st.entries.find((x) => x.id === eid)!;
      if (!e.checkedIn) { if (m.team) { reserved[i] = null; reserved[i + 2] = null; } else reserved[i] = null; }
    });
    const code = await io.createMatchTable({ tid: m.id, name: m.name, match: match.id, rules: m.rules, reserved, autostartAt: io.now() + (m.fast ? 8000 : SEAT_GRACE_MS), bots: m.bots, fast: m.fast });
    d.tables[match.id] = code;
    match.table = code;
    match.status = 'live';
    for (let s = 0; s < reserved.length; s++) {
      const r = reserved[s];
      if (r) await io.notify([r.uid], { text: `${m.name}: your round ${match.round} match is ready.`, code, seat: s, tid: m.id });
    }
  }
  await io.save(d);
  return d;
}

/** a table reported (per side, in the match's entry order) */
export async function result(io: TIO, d: TData, matchId: string, scores: number[], places: number[]): Promise<TData> {
  if (!d.state || d.meta.status !== 'live') return d;
  const match = d.state.matches.find((x) => x.id === matchId);
  if (!match || match.status === 'done') return d;
  const n = match.entries.length;
  const before = d.state.round;
  d.state = report(d.state, matchId, scores.slice(0, n), places.slice(0, n));
  // the room's placements are among all seats (a short Cutthroat table's bots included): rank entries among themselves
  await io.save(d);
  if (d.state.done) return finish(io, d);
  if (d.state.round !== before) return seat(io, d);
  return d;
}

async function finish(io: TIO, d: TData): Promise<TData> {
  const st = d.state!;
  d.meta.status = 'finished';
  await io.save(d);
  await syncRow(io, d);
  const champ = st.entries.find((e) => e.id === st.champion);
  if (champ) {
    await io.db.batch(champ.members.map((x) => io.db.prepare('INSERT OR IGNORE INTO awards (user_id, kind, ref, label, at) VALUES (?, ?, ?, ?, ?)').bind(x.uid, 'champion', d.meta.id, d.meta.name, io.now())));
    await io.notify(uidsOf(d), { text: `🏆 ${champ.name} won ${d.meta.name}!`, tid: d.meta.id });
  }
  return d;
}

/** public view (+ what the viewer can do) */
export function view(d: TData, viewer: string | null, now: number) {
  const m = d.meta;
  const mine = viewer ? d.entries.find((e) => e.members.some((x) => x.uid === viewer)) : undefined;
  const st = d.state;
  const nameOf = (id: string) => d.entries.find((e) => e.id === id)?.name ?? '—';
  return {
    meta: { ...m, rules: m.rules, fast: undefined },
    entries: d.entries.map((e) => ({ id: e.id, name: e.name, members: e.members.map((x) => x.name), checkedIn: e.checkedIn, seed: e.seed, dropped: !!st?.entries.find((x) => x.id === e.id)?.dropped })),
    round: st?.round ?? 0,
    rounds: st?.rounds ?? m.rounds,
    matches: (st?.matches ?? []).map((x) => ({ id: x.id, round: x.round, entries: x.entries.map((id) => ({ id, name: nameOf(id) })), status: x.status, table: x.table, bye: !!x.bye, result: x.result })),
    standings: st ? standings(st) : [],
    champion: st?.champion ? nameOf(st.champion) : null,
    you: mine ? { entry: mine.id, checkedIn: mine.checkedIn, host: viewer === m.hostId } : { entry: null, checkedIn: false, host: viewer === m.hostId },
    checkinOpen: m.status === 'upcoming' && now >= m.startAt - CHECKIN_MS,
    regOpen: m.status === 'upcoming' && now >= m.regOpenAt && now <= m.regCloseAt && d.entries.length < m.max,
    now,
  };
}
