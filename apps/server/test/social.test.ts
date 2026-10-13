import { beforeEach, describe, expect, it } from 'vitest';
import { parseSocialMsg, PRESENCE_TTL_MS, type SocialChatLine, type SocialServerMsg } from '@spades/protocol';
import { type ConnAtt, type GlobalLog, Hub, maskChat, uniqueGuestName } from '../src/social/hub';
import { resetTicketKey, signTicket, verifyTicket } from '../src/social/ticket';
import { coarseRegion, isAdmin, profileFor, recentPlayers } from '../src/social/routes';
import { makeD1 } from './d1';

class Harness {
  t = 1_800_000_000_000;
  out = new Map<string, SocialServerMsg[]>();
  atts = new Map<string, ConnAtt>();
  timers: { at: number; f: () => void }[] = [];
  lines: SocialChatLine[] = [];
  seq = 1;
  ids = 0;
  hub: Hub;
  tables = new Map<string, import('@spades/protocol').OpenTable>();
  /** when set, prune treats a socket outside this predicate as disconnected */
  live: ((cid: string) => boolean) | null = null;
  /** when set, prune asks this instead of a table DO */
  phases: ((code: string) => 'live' | 'over' | 'gone' | null) | null = null;
  dropped: string[] = [];
  constructor(public db: D1Database) {
    const global: GlobalLog = {
      add: (l) => { const line = { id: this.seq++, ...l }; this.lines.push(line); if (this.lines.length > 200) this.lines.shift(); return line; },
      list: (n) => this.lines.slice(-n),
      get: (id) => this.lines.find((l) => l.id === id) ?? null,
      del: (id) => { const i = this.lines.findIndex((l) => l.id === id); if (i < 0) return false; this.lines.splice(i, 1); return true; },
    };
    this.hub = new Hub({
      now: () => this.t,
      send: (cid, m) => { this.out.set(cid, [...(this.out.get(cid) ?? []), m]); },
      save: (cid, a) => this.atts.set(cid, { ...a }),
      global,
      tables: {
        put: (t) => { this.tables.set(t.code, t); },
        del: (c) => { this.tables.delete(c); },
        list: () => [...this.tables.values()],
      },
      later: (ms, f) => this.timers.push({ at: this.t + ms, f }),
      randomId: () => `id${++this.ids}xxxxxxxxxxxxxxxx`,
      connected: (cid) => (this.live ? this.live(cid) : true),
      drop: (cid) => { this.dropped.push(cid); },
      tablePhase: async (code) => (this.phases ? this.phases(code) : null),
    }, db);
  }
  advance(ms: number) { this.t += ms; const due = this.timers.filter((x) => x.at <= this.t); this.timers = this.timers.filter((x) => x.at > this.t); due.forEach((x) => x.f()); }
  msgs(cid: string) { return this.out.get(cid) ?? []; }
  last<T extends SocialServerMsg['t']>(cid: string, t: T) { return [...this.msgs(cid)].reverse().find((m) => m.t === t) as Extract<SocialServerMsg, { t: T }> | undefined; }
  all<T extends SocialServerMsg['t']>(cid: string, t: T) { return this.msgs(cid).filter((m) => m.t === t) as Extract<SocialServerMsg, { t: T }>[]; }
  send(cid: string, m: unknown) { return this.hub.message(cid, JSON.stringify(m)); }
  /** visible players for cid, tracked from hello + pres diffs */
  seen(cid: string): string[] {
    const set = new Map<string, true>();
    for (const m of this.msgs(cid)) {
      if (m.t === 'hello') { set.clear(); m.users.forEach((u) => set.set(u.id, true)); }
      if (m.t === 'pres') { m.up?.forEach((u) => set.set(u.id, true)); m.gone?.forEach((g) => set.delete(g)); }
    }
    return [...set.keys()].sort();
  }
}

async function addUser(db: D1Database, id: string, username: string) {
  await db.prepare('INSERT INTO users (id, username, username_key, created_at) VALUES (?, ?, ?, ?)').bind(id, username, username.toLowerCase(), 1_700_000_000_000).run();
}

let db: D1Database;
let h: Harness;
beforeEach(async () => {
  db = await makeD1();
  resetTicketKey();
  for (const [id, n] of [['ua', 'Alice'], ['ub', 'Bobby'], ['uc', 'Cee'], ['ud', 'Demetrius']]) await addUser(db, id!, n!);
  h = new Harness(db);
});

describe('account tickets', () => {
  it('sign/verify, expiry, tamper', async () => {
    const t = await signTicket(db, { uid: 'ua', name: 'Alice', exp: 2000 });
    expect(await verifyTicket(db, t, 1000)).toEqual({ uid: 'ua', name: 'Alice', exp: 2000 });
    expect(await verifyTicket(db, t, 3000)).toBeNull();
    expect(await verifyTicket(db, t.slice(0, -2) + 'AA', 1000)).toBeNull();
    const [body, sig] = t.split('.');
    const forged = btoa(JSON.stringify({ u: 'ud', n: 'Demetrius', e: 2000 })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    expect(await verifyTicket(db, `${forged}.${sig}`, 1000)).toBeNull();
    expect(body).toBeTruthy();
  });
  it('admin config + coarse region', () => {
    expect(isAdmin({ ADMIN_USERNAMES: 'demetrius, other' }, 'x', 'Demetrius')).toBe(true);
    expect(isAdmin({ ADMIN_USER_IDS: 'ud' }, 'ud', null)).toBe(true);
    expect(isAdmin({}, 'ud', 'Demetrius')).toBe(false);
    expect(coarseRegion({ country: 'US', regionCode: 'GA', city: 'Atlanta' })).toBe('US-GA');
    expect(coarseRegion({ country: 'GB', regionCode: 'ENG' })).toBe('GB');
    expect(coarseRegion({})).toBeNull();
  });
});

describe('presence', () => {
  it('users + guests, statuses, multi-tab, appear offline, leave', async () => {
    await h.hub.open('a1', { uid: 'ua', name: 'Alice' });
    await h.hub.open('g1', { name: 'Kev' });
    await h.hub.open('b1', { uid: 'ub', name: 'Bobby' });
    const gid = h.last('g1', 'hello')!.you.id;
    expect(gid).toMatch(/^g:/);
    expect(h.last('g1', 'hello')!.you.guest).toBe(true);
    expect(h.seen('a1')).toEqual([gid, 'u:ua', 'u:ub'].sort());
    await h.send('b1', { t: 'status', status: { kind: 'table', mode: 'cutthroat', open: 1, code: 'ABCD' } });
    const up = h.last('a1', 'pres')!.up![0]!;
    expect(up).toMatchObject({ id: 'u:ub', status: { kind: 'table', mode: 'cutthroat', open: 1, code: 'ABCD' } });
    // second tab keeps the status; closing one tab keeps them online
    await h.hub.open('b2', { uid: 'ub', name: 'Bobby' });
    expect(h.last('b2', 'hello')!.you.status.kind).toBe('table');
    h.hub.close('b2');
    expect(h.seen('a1')).toContain('u:ub');
    // appear offline: others stop seeing Bobby, Bobby still sees himself
    await h.send('b1', { t: 'settings', settings: { appearOffline: true } });
    expect(h.seen('a1')).not.toContain('u:ub');
    expect(h.seen('g1')).not.toContain('u:ub');
    expect(h.last('b1', 'settings')!.settings.appearOffline).toBe(true);
    await h.hub.open('a2', { uid: 'ua', name: 'Alice' });
    expect(h.seen('a2')).not.toContain('u:ub');
    await h.send('b1', { t: 'settings', settings: { appearOffline: false } });
    expect(h.seen('a1')).toContain('u:ub');
    h.hub.close('b1');
    expect(h.seen('a1')).not.toContain('u:ub');
  });

  it('one guest session is one player; the same display name gets a distinct label', async () => {
    await h.hub.open('a1', { uid: 'ua', name: 'Alice' });
    await h.hub.open('g1', { name: 'SWE GUEST', gid: 'swe-guest-session' });
    await h.hub.open('g2', { name: 'SWE GUEST', gid: 'swe-guest-session' });
    const id = h.last('g1', 'hello')!.you.id;
    expect(id).toBe('g:swe-guest-session');
    expect(h.last('g2', 'hello')!.you.id).toBe(id);
    expect(h.seen('a1').filter((x) => x.startsWith('g:'))).toEqual([id]);
    expect(h.last('g2', 'hello')!.you.name).toBe('SWE GUEST');
    // closing one tab keeps the session online
    h.hub.close('g1');
    expect(h.seen('a1')).toContain(id);
    // a different browser with the same name is a second player, labeled apart
    await h.hub.open('g3', { name: 'SWE GUEST', gid: 'other-guest-session' });
    expect(h.last('g3', 'hello')!.you.name).toBe('SWE GUEST 2');
    expect(h.seen('a1').filter((x) => x.startsWith('g:')).sort()).toEqual([id, 'g:other-guest-session'].sort());
    // a guest may share an account's name; the Guest tag tells them apart
    await h.hub.open('g4', { name: 'Alice', gid: 'alice-the-guest' });
    expect(h.last('g4', 'hello')!.you.name).toBe('Alice');
    // a bad session id cannot impersonate an account, and still won't stack the same name
    await h.hub.open('g5', { name: 'SWE GUEST', gid: 'u:ua' });
    await h.hub.open('g6', { name: 'SWE GUEST', gid: 'nope' });
    expect(h.last('g5', 'hello')!.you.id).toMatch(/^g:/);
    expect(h.last('g5', 'hello')!.you.id).not.toBe('u:ua');
    expect(h.last('g6', 'hello')!.you.id).not.toBe(h.last('g5', 'hello')!.you.id);
    const names = [h.last('g5', 'hello')!.you.name, h.last('g6', 'hello')!.you.name];
    expect(new Set(names).size).toBe(2);
    expect(names.every((n) => n.startsWith('SWE GUEST'))).toBe(true);
    h.hub.close('g2');
    expect(h.seen('a1')).not.toContain(id);
  });

  it('parses the seat and watch-full fields, and drops a seat that cannot exist', () => {
    expect(parseSocialMsg({ t: 'status', status: { kind: 'table', mode: 'joker', open: 1, code: 'ABCD', seat: 2, watchFull: true } }))
      .toEqual({ t: 'status', status: { kind: 'table', mode: 'joker', open: 1, code: 'ABCD', seat: 2, watchFull: true } });
    expect(parseSocialMsg({ t: 'status', status: { kind: 'table', mode: 'joker', offline: true, seat: 9, watchFull: false } }))
      .toEqual({ t: 'status', status: { kind: 'table', mode: 'joker', offline: true } });
    expect(uniqueGuestName('SWE GUEST', ['swe guest'])).toBe('SWE GUEST 2');
    expect(uniqueGuestName('Guest', [])).toBe('Guest');
  });
});

describe('friends + block', () => {
  it('request → accept, decline, remove; block hides presence, chat, DMs, invites', async () => {
    await h.hub.open('a', { uid: 'ua', name: 'Alice' });
    await h.hub.open('b', { uid: 'ub', name: 'Bobby' });
    await h.send('a', { t: 'friend', op: 'request', to: 'u:ub' });
    expect(h.last('b', 'friends')!.friends.incoming.map((f) => f.name)).toEqual(['Alice']);
    expect(h.last('a', 'friends')!.friends.outgoing.map((f) => f.name)).toEqual(['Bobby']);
    await h.send('b', { t: 'friend', op: 'accept', to: 'u:ua' });
    expect(h.last('a', 'friends')!.friends.friends.map((f) => f.name)).toEqual(['Bobby']);
    await h.send('a', { t: 'friend', op: 'remove', to: 'u:ub' });
    expect(h.last('b', 'friends')!.friends.friends).toEqual([]);
    // mutual request auto-accepts
    await h.send('a', { t: 'friend', op: 'request', to: 'u:ub' });
    await h.send('b', { t: 'friend', op: 'request', to: 'u:ua' });
    expect(h.last('b', 'friends')!.friends.friends.map((f) => f.name)).toEqual(['Alice']);
    // guests can't be friended
    await h.hub.open('g', { name: 'Guesty' });
    await h.send('a', { t: 'friend', op: 'request', to: h.last('g', 'hello')!.you.id });
    expect(h.last('a', 'error')!.code).toBe('BAD_TARGET');

    // block
    await h.send('b', { t: 'friend', op: 'block', to: 'u:ua' });
    expect(h.last('b', 'friends')!.friends.blocked.map((f) => f.name)).toEqual(['Alice']);
    expect(h.last('b', 'friends')!.friends.friends).toEqual([]);
    expect(h.seen('a')).not.toContain('u:ub');
    expect(h.seen('b')).not.toContain('u:ua');
    await h.send('a', { t: 'dm', to: 'u:ub', text: 'hey' });
    expect(h.last('a', 'error')!.code).toBe('BLOCKED');
    expect(h.last('b', 'dm')).toBeUndefined();
    await h.send('a', { t: 'invite', to: 'u:ub', code: 'ABCD' });
    expect(h.last('a', 'error')!.code).toBe('OFFLINE');
    await h.send('a', { t: 'chat', text: 'can you see me' });
    expect(h.last('b', 'chat')).toBeUndefined();
    expect(h.last('g', 'chat')!.line.text).toBe('can you see me');
    // a blocked user's past global lines are hidden on (re)connect
    await h.hub.open('b2', { uid: 'ub', name: 'Bobby' });
    expect(h.last('b2', 'hello')!.global).toEqual([]);
    await h.send('b', { t: 'friend', op: 'unblock', to: 'u:ua' });
    expect(h.seen('a')).toContain('u:ub');
  });
});

describe('invites', () => {
  it('toast payload, accept/decline, 60 s expiry, friends-only, guests cannot send, rate limit', async () => {
    await h.hub.open('a', { uid: 'ua', name: 'Alice' });
    await h.hub.open('b', { uid: 'ub', name: 'Bobby' });
    await h.hub.open('g', { name: 'Kev' });
    await h.send('a', { t: 'invite', to: 'u:ub', code: 'XY7K', mode: 'joker', seat: 2 });
    const inv = h.last('b', 'invite')!.invite;
    expect(inv).toMatchObject({ from: 'u:ua', fromName: 'Alice', code: 'XY7K', seat: 2 });
    expect(inv.expiresAt - h.t).toBe(60_000);
    expect(h.last('a', 'inviteSent')!.to).toBe('u:ub');
    await h.send('b', { t: 'inviteReply', id: inv.id, accept: true });
    expect(h.last('a', 'inviteReply')).toMatchObject({ by: 'u:ub', accept: true });
    // decline
    await h.send('a', { t: 'invite', to: 'u:ub', code: 'XY7K' });
    await h.send('b', { t: 'inviteReply', id: h.last('b', 'invite')!.invite.id, accept: false });
    expect(h.last('a', 'inviteReply')!.accept).toBe(false);
    // expiry
    await h.send('a', { t: 'invite', to: 'u:ub', code: 'XY7K' });
    const id3 = h.last('b', 'invite')!.invite.id;
    h.advance(61_000);
    expect(h.last('b', 'inviteGone')).toMatchObject({ id: id3, reason: 'expired' });
    await h.send('b', { t: 'inviteReply', id: id3, accept: true });
    expect(h.last('b', 'error')!.code).toBe('INVITE_GONE');
    // guests can receive but not send
    await h.send('a', { t: 'invite', to: h.last('g', 'hello')!.you.id, code: 'XY7K' });
    expect(h.last('g', 'invite')!.invite.fromName).toBe('Alice');
    await h.send('g', { t: 'invite', to: 'u:ua', code: 'XY7K' });
    expect(h.last('g', 'error')!.code).toBe('SIGN_IN');
    // friends only
    await h.send('b', { t: 'settings', settings: { friendsOnlyInvites: true } });
    await h.send('a', { t: 'invite', to: 'u:ub', code: 'XY7K' });
    expect(h.last('a', 'error')!.code).toBe('FRIENDS_ONLY');
    await h.send('a', { t: 'friend', op: 'request', to: 'u:ub' });
    await h.send('b', { t: 'friend', op: 'accept', to: 'u:ua' });
    const before = h.all('b', 'invite').length;
    await h.send('a', { t: 'invite', to: 'u:ub', code: 'XY7K' });
    expect(h.all('b', 'invite').length).toBe(before + 1);
    // rate limit: 6 per minute
    h.advance(61_000);
    for (let i = 0; i < 8; i++) await h.send('a', { t: 'invite', to: 'u:ub', code: 'XY7K' });
    expect(h.last('a', 'error')!.code).toBe('SLOW_DOWN');
  });
});

describe('global chat + DMs', () => {
  it('guests read but cannot post; masking; length cap; rate limit; report; admin delete; 200 kept', async () => {
    await h.hub.open('a', { uid: 'ua', name: 'Alice' });
    await h.hub.open('g', { name: 'Kev' });
    await h.hub.open('d', { uid: 'ud', name: 'Demetrius', admin: true });
    expect(h.last('d', 'hello')!.admin).toBe(true);
    await h.send('g', { t: 'chat', text: 'hi' });
    expect(h.last('g', 'error')!.code).toBe('SIGN_IN');
    await h.send('a', { t: 'chat', text: 'what the fuck, n1gga www.spam.com ' + 'x'.repeat(400) });
    const l = h.last('g', 'chat')!.line;
    expect(l.text).not.toMatch(/fuck|n1gga|spam\.com/);
    expect(l.text).toContain('[link]');
    expect(l.text.length).toBeLessThanOrEqual(300);
    expect(maskChat('Classic grape scunthorpe pass')).toMatch(/^Classic grape s\*+ pass$/);
    for (let i = 0; i < 6; i++) await h.send('a', { t: 'chat', text: `msg ${i}` });
    expect(h.last('a', 'error')!.code).toBe('SLOW_DOWN');
    // report + admin delete
    await h.send('d', { t: 'report', kind: 'global', id: l.id, reason: 'slurs' });
    expect(h.last('d', 'ok')!.what).toBe('report');
    const rep = await db.prepare('SELECT * FROM reports').first<{ target_user: string; text: string; reason: string }>();
    expect(rep).toMatchObject({ target_user: 'ua', reason: 'slurs' });
    await h.send('a', { t: 'del', id: l.id });
    expect(h.last('a', 'error')!.code).toBe('FORBIDDEN');
    await h.send('d', { t: 'del', id: l.id });
    expect(h.last('g', 'deleted')!.id).toBe(l.id);
    expect(h.lines.some((x) => x.id === l.id)).toBe(false);
    for (let i = 0; i < 250; i++) { h.advance(13_000); await h.send('a', { t: 'chat', text: `line ${i}` }); }
    expect(h.lines.length).toBe(200);
    await h.hub.open('g2', { name: 'Late' });
    expect(h.last('g2', 'hello')!.global.length).toBe(50);
  });

  it('DMs: delivered live + stored, unread counts, history, read, guests cannot DM, report a DM', async () => {
    await h.hub.open('a', { uid: 'ua', name: 'Alice' });
    await h.send('a', { t: 'dm', to: 'u:ub', text: 'you around?' });
    expect(h.last('a', 'dm')!.line).toMatchObject({ from: 'u:ua', to: 'u:ub', text: 'you around?' });
    await h.hub.open('b', { uid: 'ub', name: 'Bobby' });
    expect(h.last('b', 'hello')!.unread).toEqual({ 'u:ua': 1 });
    h.advance(3000);
    await h.send('a', { t: 'dm', to: 'u:ub', text: 'spades tonight' });
    expect(h.last('b', 'dm')).toMatchObject({ name: 'Alice', line: { text: 'spades tonight' } });
    await h.send('b', { t: 'dmHistory', with: 'u:ua' });
    expect(h.last('b', 'dmHistory')!.lines.map((x) => x.text)).toEqual(['you around?', 'spades tonight']);
    await h.send('b', { t: 'read', with: 'u:ua' });
    await h.hub.open('b2', { uid: 'ub', name: 'Bobby' });
    expect(h.last('b2', 'hello')!.unread).toEqual({});
    await h.hub.open('g', { name: 'Kev' });
    await h.send('g', { t: 'dm', to: 'u:ua', text: 'yo' });
    expect(h.last('g', 'error')!.code).toBe('SIGN_IN');
    await h.send('b', { t: 'report', kind: 'dm', id: h.last('b', 'dm')!.line.id });
    expect(await db.prepare("SELECT text FROM reports WHERE kind = 'dm'").first<{ text: string }>()).toEqual({ text: 'spades tonight' });
  });
});

describe('profiles + recent players (from game records)', () => {
  it('h2h, totals, team names, recent', async () => {
    const { saveRecord } = await import('../src/stats/record');
    const st = { won: true, hands: 5, bids: 0, bidSum: 0, made: 0, set: 0, bags: 0, nilBids: 0, nilMade: 0, books: 0, shotsTaken: 0, shotsGiven: 0, wheels: 0, bjWins: 0, bidMs: 0, bidN: 0, playMs: 0, playN: 0 };
    for (let i = 0; i < 3; i++) {
      const aliceWins = i < 2;
      await saveRecord(db, {
        id: `g${i}`, room: 'ROOM', mode: 'joker', kind: 'team', endedAt: 1_800_000_000_000 + i, hands: 5, final: [500, 300], winners: [aliceWins ? 0 : 1], names: ['Book Bandits', 'B'],
        seats: [{ name: 'Alice', side: 0, kind: 'user', uid: 'ua' }, { name: 'Bobby', side: 1, kind: 'user', uid: 'ub' }, { name: 'Cee', side: 0, kind: 'user', uid: 'uc' }, { name: 'Bot', side: 1, kind: 'bot' }],
        players: [
          { seat: 0, uid: 'ua', side: 0, won: aliceWins, partner: 'uc', teamName: 'Book Bandits', stats: { ...st, won: aliceWins } },
          { seat: 1, uid: 'ub', side: 1, won: !aliceWins, partner: null, teamName: null, stats: { ...st, won: !aliceWins } },
          { seat: 2, uid: 'uc', side: 0, won: aliceWins, partner: 'ua', teamName: 'Book Bandits', stats: { ...st, won: aliceWins } },
        ],
      }, true);
    }
    const p = (await profileFor(db, 'alice', 'ub'))!;
    expect(p.username).toBe('Alice');
    expect(p.totals).toEqual({ games: 3, wins: 2 });
    expect(p.teamNames).toEqual(['Book Bandits']);
    expect(p.h2h).toEqual([{ id: 'u:ub', name: 'Bobby', games: 3, wins: 2, losses: 1 }]);
    expect(p.vsYou).toEqual({ games: 3, wins: 1, losses: 2 });
    expect(p.ratings.team).toBeGreaterThan(1200);
    expect((await profileFor(db, 'bobby', null))!.ratings.team).toBeLessThan(1200);
    expect(await profileFor(db, 'nobody', null)).toBeNull();
    const recent = await recentPlayers(db, 'ua');
    expect(recent.map((r) => [r.name, r.games, r.partner])).toEqual(expect.arrayContaining([['Bobby', 3, false], ['Cee', 3, true]]));
  });
});

describe('open tables (Release 10)', () => {
  const T = (code: string, over: Partial<import('@spades/protocol').OpenTable> = {}) => ({ code, host: 'Dee', mode: 'joker', playerCount: 4, target: 500, venue: 'classic', humans: 1, bots: 0, open: 3, status: 'waiting' as const, spectators: 0, at: h.t, ...over });
  it('hello carries the list; updates and removals reach everyone; stale entries expire', async () => {
    h.hub.tableUpdate('AAAAA', T('AAAAA'));
    await h.hub.open('c1', { name: 'Guest' });
    expect(h.last('c1', 'hello')!.tables!.map((t) => t.code)).toEqual(['AAAAA']);
    h.hub.tableUpdate('BBBBB', T('BBBBB', { status: 'playing', hand: 3, open: 1 }));
    expect(h.last('c1', 'tables')!.up![0]).toMatchObject({ code: 'BBBBB', hand: 3 });
    h.hub.tableUpdate('AAAAA', null);
    expect(h.last('c1', 'tables')!.gone).toEqual(['AAAAA']);
    expect(h.hub.openTables().map((t) => t.code)).toEqual(['BBBBB']);
    h.t += 4 * 3600_000;
    expect(h.hub.openTables()).toEqual([]);
  });
  it('waiting tables sort first', () => {
    h.hub.tableUpdate('PPPPP', T('PPPPP', { status: 'playing', open: 2 }));
    h.hub.tableUpdate('WWWWW', T('WWWWW', { status: 'waiting', open: 1 }));
    expect(h.hub.openTables().map((t) => t.code)).toEqual(['WWWWW', 'PPPPP']);
  });
});

describe('stale presence rows', () => {
  const T = (code: string, over: Partial<import('@spades/protocol').OpenTable> = {}) => ({
    code, host: 'SWE', mode: 'joker', playerCount: 4, target: 250, venue: 'classic', humans: 0, bots: 4, open: 4, status: 'playing' as const, spectators: 0, at: h.t, ...over,
  });

  it('hides the guest who is still announcing an ended table, next to the live session', async () => {
    await h.hub.open('live', { name: 'SWE 2', gid: 'swe-live-session' });
    await h.hub.open('ghost', { name: 'SWE', gid: 'swe-old-session1' });
    h.hub.tableUpdate('6SAQ2', T('6SAQ2'));
    await h.send('ghost', { t: 'status', status: { kind: 'table', mode: 'joker', open: 4, code: '6SAQ2' } });
    expect(h.seen('live')).toContain('g:swe-old-session1');
    h.hub.tableUpdate('6SAQ2', T('6SAQ2', { status: 'over', open: 4 }));
    expect(h.seen('live')).not.toContain('g:swe-old-session1');
    // the frozen page keeps saying it is at that table; the row stays gone
    await h.send('ghost', { t: 'status', status: { kind: 'table', mode: 'joker', open: 4, code: '6SAQ2' } });
    expect(h.seen('live')).not.toContain('g:swe-old-session1');
    await h.send('ghost', { t: 'status', status: { kind: 'online' } });
    expect(h.seen('live')).toContain('g:swe-old-session1');
    expect(h.last('live', 'pres')!.up![0]).toMatchObject({ id: 'g:swe-old-session1', status: { kind: 'online' } });
  });

  it('drops presence when a listed table disappears, and leaves a private table alone', async () => {
    await h.hub.open('watch', { name: 'Watch', gid: 'watcher-session1' });
    await h.hub.open('pub', { name: 'SWE', gid: 'swe-old-session1' });
    await h.hub.open('priv', { name: 'Nia', gid: 'private-guest-ses' });
    h.hub.tableUpdate('6SAQ2', T('6SAQ2'));
    await h.send('pub', { t: 'status', status: { kind: 'table', mode: 'joker', open: 4, code: '6SAQ2' } });
    await h.send('priv', { t: 'status', status: { kind: 'table', mode: 'joker', open: 2, code: 'PRIV8' } });
    h.hub.tableUpdate('PRIV8', null);
    h.hub.tableUpdate('6SAQ2', null);
    expect(h.seen('watch')).not.toContain('g:swe-old-session1');
    expect(h.seen('watch')).toContain('g:private-guest-ses');
  });

  it('asks the room about a code that is already unlisted and drops a gone table', async () => {
    await h.hub.open('watch', { name: 'SWE 2', gid: 'swe-live-session' });
    await h.hub.open('ghost', { name: 'SWE', gid: 'swe-old-session1' });
    await h.send('ghost', { t: 'status', status: { kind: 'table', mode: 'joker', open: 4, code: '6SAQ2' } });
    h.phases = (code) => (code === '6SAQ2' ? 'gone' : 'live');
    await h.hub.prune(true);
    expect(h.seen('watch')).not.toContain('g:swe-old-session1');
    expect(h.seen('watch')).toContain('g:swe-live-session');
  });

  it('keeps a private table the room still calls live', async () => {
    await h.hub.open('watch', { name: 'Watch', gid: 'watcher-session1' });
    await h.hub.open('priv', { name: 'Nia', gid: 'private-guest-ses' });
    await h.send('priv', { t: 'status', status: { kind: 'lobby', mode: 'joker', open: 3, code: 'PRIV8' } });
    h.phases = () => 'live';
    await h.hub.prune(true);
    expect(h.seen('watch')).toContain('g:private-guest-ses');
  });

  it('drops a disconnected socket and a session that has gone quiet', async () => {
    await h.hub.open('ghost', { name: 'SWE', gid: 'swe-old-session1' });
    await h.hub.open('live', { name: 'SWE 2', gid: 'swe-live-session' });
    h.live = (cid) => cid !== 'ghost';
    await h.hub.prune(false);
    expect(h.dropped).toContain('ghost');
    expect(h.seen('live')).not.toContain('g:swe-old-session1');
    expect(h.seen('live')).toContain('g:swe-live-session');

    h.live = null;
    await h.hub.open('old', { name: 'Old', gid: 'old-guest-session1' });
    h.t += PRESENCE_TTL_MS + 1;
    await h.hub.open('fresh', { name: 'Fresh', gid: 'fresh-guest-session' });
    expect(h.last('fresh', 'hello')!.users.map((u) => u.id)).not.toContain('g:old-guest-session1');
    expect(h.last('fresh', 'hello')!.users.map((u) => u.id)).toContain('g:fresh-guest-session');
    expect(h.dropped).toContain('old');
  });

  it('keeps an offline vs-bots row when some other table ends', async () => {
    await h.hub.open('watch', { name: 'Watch', gid: 'watcher-session1' });
    await h.hub.open('bot', { name: 'Guest', gid: 'offline-guest-sess' });
    await h.send('bot', { t: 'status', status: { kind: 'table', mode: 'joker', offline: true } });
    h.hub.tableUpdate('6SAQ2', T('6SAQ2', { status: 'over' }));
    expect(h.seen('watch')).toContain('g:offline-guest-sess');
  });
});
