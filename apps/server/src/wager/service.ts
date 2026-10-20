/**
 * Big Bank Take Lil Bank (Phase 1): one wager challenge — what the Challenge
 * Durable Object does minus Cloudflare plumbing, cloned from the tournament
 * service's shape. Lifecycle:
 *   pending (collecting accepts; the challenger escrowed at send, each invitee
 *   escrows at their accept) → scheduled (all four in) → checkin (start − 10m)
 *   → live (table created, seats reserved) → settled | forfeited | void,
 * with declined / expired / cancelled as early exits that refund every escrow.
 * All coin movement goes through cred/wager.ts (ledger-ref idempotent), and
 * every terminal transition runs inside the DO's serialized ops, so a result
 * reported twice can never pay twice.
 */
import type { TableRules } from '@spades/rules';
import { balance } from '../cred/coins';
import {
  wagerEnabled, wagerEscrow, wagerEscrowedCount, wagerForfeit, wagerLevelOk,
  wagerMaxConcurrent, wagerPayWin, wagerRefund,
} from '../cred/wager';
import { CHECKIN_MS, SEAT_GRACE_MS } from '../tournament/service';

export { CHECKIN_MS, SEAT_GRACE_MS };

export type WagerFormat = 'partnership' | 'cutthroat';
export type WagerStatus = 'pending' | 'scheduled' | 'checkin' | 'live' | 'settled' | 'forfeited' | 'void' | 'declined' | 'expired' | 'cancelled';
export type WagerEndReason = 'played' | 'no_show' | 'double_no_show' | 'abandoned' | 'declined' | 'expired' | 'cancelled';

export interface WPerson { uid: string; name: string; admin?: boolean }

export interface WPlayer {
  uid: string; name: string;
  role: 'challenger' | 'opponent' | 'partner';
  /** partnership: 0/1; cutthroat: null (each player is their own side) */
  side: number | null;
  status: 'invited' | 'accepted' | 'declined';
  escrowed: boolean;
  checkedIn: boolean;
  /** Net coin outcome at resolution (coins returned − coins escrowed): +won, 0 refunded/made whole, −wager lost.
   *  Null until the challenge reaches a terminal state. Display-only — the ledger is the money truth. */
  net?: number | null;
  acceptedAt: number | null;
  /** seat at the match table, assigned when the table is created */
  seat: number | null;
}

export interface WData {
  id: string;
  challengerId: string;
  format: WagerFormat;
  mode: 'joker' | 'aceDown' | 'cutthroat';
  rules: TableRules;
  wager: number;
  startAt: number;
  status: WagerStatus;
  players: WPlayer[];
  tableCode: string | null;
  gameId: string | null;
  endReason: WagerEndReason | null;
  createdAt: number;
  settledAt: number | null;
  remindedCheckin: boolean;
  beginAttempts: number;
}

export interface WNotice { text: string; code?: string; seat?: number; cid?: string }
export type WPushKind = 'invite' | 'checkin' | 'ready' | 'outcome';

export interface WIO {
  now(): number;
  db: D1Database;
  /** create a table DO set up for this match; returns its code */
  createMatchTable(setup: { cid: string; rules: TableRules; reserved: ({ uid: string; name: string } | null)[]; autostartAt: number }): Promise<string>;
  /** in-app notice to these accounts (Social hub) */
  notify(uids: string[], n: WNotice): Promise<void>;
  /** Web Push to one account (paired with the in-app state, never push-only) */
  push(cid: string, uid: string, kind: WPushKind, title: string, body: string): Promise<void>;
  setAlarm(at: number): Promise<void>;
  save(d: WData): Promise<void>;
}

export class WError extends Error { constructor(public status: number, msg: string) { super(msg); } }

/** How a wager match table ended (mirrors room.ts ChallengeResult). */
export type WResult =
  | { kind: 'played'; scores: number[]; places: number[]; gameId: string }
  | { kind: 'noshow'; shown: string[] }
  | { kind: 'abandoned'; leaverUid: string | null };

export const checkinOpensAt = (d: Pick<WData, 'startAt'>): number => d.startAt - CHECKIN_MS;
const player = (d: WData, uid: string): WPlayer | undefined => d.players.find((p) => p.uid === uid);
const allUids = (d: WData): string[] => d.players.map((p) => p.uid);
const fmtStart = (at: number): string => `${new Date(at).toLocaleString('en-US', { timeZone: 'UTC', weekday: 'short', hour: 'numeric', minute: '2-digit' })} UTC`;
const terms = (d: WData): string => `${d.format === 'partnership' ? 'Partnership 2v2' : 'Cutthroat'} · ${d.wager} 🪙 a player · pot ${d.wager * 4} 🪙 · starts ${fmtStart(d.startAt)}`;

/** Blocks are respected both ways: a blocked pair can never share a challenge. */
export async function blockedPair(db: D1Database, a: string, b: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 AS ok FROM blocks WHERE (blocker = ? AND blocked = ?) OR (blocker = ? AND blocked = ?)').bind(a, b, b, a).first<{ ok: number }>();
  return !!row;
}

export async function syncRow(io: WIO, d: WData): Promise<void> {
  const db = io.db;
  await db.prepare(`INSERT INTO wager_challenges (id, challenger_id, format, mode, rules, wager, start_at, checkin_opens_at, status, table_code, game_id, created_at, settled_at, end_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET status = excluded.status, table_code = excluded.table_code, game_id = excluded.game_id, settled_at = excluded.settled_at, end_reason = excluded.end_reason`)
    .bind(d.id, d.challengerId, d.format, d.mode, JSON.stringify(d.rules), d.wager, d.startAt, checkinOpensAt(d), d.status, d.tableCode, d.gameId, d.createdAt, d.settledAt, d.endReason).run();
  if (d.players.length) {
    await db.batch(d.players.map((p) => db.prepare(`INSERT INTO wager_challenge_players (challenge_id, user_id, side, seat, role, status, escrowed, checked_in, net)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (challenge_id, user_id) DO UPDATE SET side = excluded.side, seat = excluded.seat, status = excluded.status, escrowed = excluded.escrowed, checked_in = excluded.checked_in, net = excluded.net`)
      .bind(d.id, p.uid, p.side, p.seat, p.role, p.status, p.escrowed ? 1 : 0, p.checkedIn ? 1 : 0, p.net ?? null)));
  }
}

/** Level gate for adding a person (and their escrow) to a challenge. */
async function levelGate(io: WIO, who: WPerson): Promise<void> {
  if (who.admin) return;
  if (!(await wagerLevelOk(io.db, who.uid))) throw new WError(403, `${who.name} hasn't unlocked Big Bank yet — it opens at Rep Level 20 (Block Captain).`);
}

async function escrowGate(io: WIO, uid: string, wager: number): Promise<void> {
  if ((await wagerEscrowedCount(io.db, uid)) >= (await wagerMaxConcurrent(io.db))) {
    throw new WError(409, 'Too many challenges with coins down at once — finish or cancel one first.');
  }
  if ((await balance(io.db, uid)) < wager) throw new WError(400, 'Not enough coins for that wager.');
}

export interface WCreate {
  id: string;
  format: WagerFormat;
  rules: TableRules;
  wager: number;
  startAt: number;
  challenger: WPerson;
  /** partnership only: the named rival (the fourth seat's owner names their partner at accept) */
  opponent: WPerson | null;
  /** partnership: the challenger's own partner, named at send */
  partner: WPerson | null;
  /** cutthroat: exactly three direct invitees */
  invitees: WPerson[];
}

export async function create(io: WIO, c: WCreate): Promise<WData> {
  const now = io.now();
  if (!(await wagerEnabled(io.db))) throw new WError(404, 'Big Bank challenges are not open yet.');
  if (c.startAt - CHECKIN_MS <= now) throw new WError(400, 'Start time is too soon — players need time to accept before check-in opens.');
  const named = [c.challenger, ...(c.opponent ? [c.opponent] : []), ...(c.partner ? [c.partner] : []), ...c.invitees];
  if (new Set(named.map((p) => p.uid)).size !== named.length) throw new WError(400, 'Every player in a challenge must be a different person.');
  if (c.format === 'partnership') {
    if (!c.opponent) throw new WError(400, 'Partnership challenges name an opponent.');
    if (!c.partner) throw new WError(400, 'Partnership challenges name your partner when you send.');
    if (c.invitees.length) throw new WError(400, 'Partnership challenges take one opponent, not a list.');
  } else {
    if (c.opponent || c.partner) throw new WError(400, 'Cutthroat takes three invitees, no opponent or partner.');
    if (c.invitees.length !== 3) throw new WError(400, 'Cutthroat challenges invite exactly three players.');
  }
  await levelGate(io, c.challenger);
  for (const p of named.slice(1)) {
    if (await blockedPair(io.db, c.challenger.uid, p.uid)) throw new WError(403, `You can't challenge ${p.name}.`);
  }
  await escrowGate(io, c.challenger.uid, c.wager);

  const mk = (who: WPerson, role: WPlayer['role'], side: number | null, status: WPlayer['status']): WPlayer => ({
    uid: who.uid, name: who.name, role, side, status, escrowed: false, checkedIn: false, acceptedAt: status === 'accepted' ? now : null, seat: null,
  });
  const players: WPlayer[] = [mk(c.challenger, 'challenger', c.format === 'partnership' ? 0 : null, 'accepted')];
  if (c.format === 'partnership') {
    players.push(mk(c.opponent!, 'opponent', 1, 'invited'));
    players.push(mk(c.partner!, 'partner', 0, 'invited'));
  } else {
    for (const inv of c.invitees) players.push(mk(inv, 'opponent', null, 'invited'));
  }

  const d: WData = {
    id: c.id, challengerId: c.challenger.uid, format: c.format, mode: c.rules.mode, rules: c.rules, wager: c.wager,
    startAt: c.startAt, status: 'pending', players, tableCode: null, gameId: null, endReason: null,
    createdAt: now, settledAt: null, remindedCheckin: false, beginAttempts: 0,
  };
  // the send is only real once the challenger's coins are down (anti-spam)
  if (!(await wagerEscrow(io.db, c.challenger.uid, d.id, c.wager, now))) throw new WError(400, 'Not enough coins for that wager.');
  players[0]!.escrowed = true;
  await io.save(d);
  await syncRow(io, d);
  await io.setAlarm(Math.max(now + 1000, checkinOpensAt(d)));
  const text = `🏦 ${c.challenger.name} challenged you to Big Bank Take Lil Bank — ${terms(d)}. Accept to escrow your ${c.wager} 🪙.`;
  for (const p of players.slice(1)) {
    await io.notify([p.uid], { text, cid: d.id });
    await io.push(d.id, p.uid, 'invite', 'Big Bank challenge 🏦', `${c.challenger.name} wants to run it: ${c.wager} coins a player.`);
  }
  return d;
}

export async function accept(io: WIO, d: WData, me: WPerson, partnerPick: WPerson | null): Promise<WData> {
  const now = io.now();
  if (d.status !== 'pending') throw new WError(409, 'This challenge is no longer collecting players.');
  if (now >= checkinOpensAt(d)) throw new WError(409, 'The accept window has closed.');
  const mine = player(d, me.uid);
  if (!mine) throw new WError(404, 'You are not in this challenge.');
  if (mine.status === 'accepted') throw new WError(409, 'You already accepted.');
  if (mine.status === 'declined') throw new WError(409, 'You declined this challenge.');

  // partnership: the opponent's accept names their partner (the fourth seat)
  let newPartner: WPlayer | null = null;
  if (d.format === 'partnership' && mine.role === 'opponent') {
    if (!partnerPick) throw new WError(400, 'Name your partner to accept.');
    if (partnerPick.uid === me.uid) throw new WError(400, "You can't be your own partner.");
    if (player(d, partnerPick.uid)) throw new WError(409, `${partnerPick.name} is already in this challenge.`);
    newPartner = { uid: partnerPick.uid, name: partnerPick.name, role: 'partner', side: 1, status: 'invited', escrowed: false, checkedIn: false, acceptedAt: null, seat: null };
  } else if (partnerPick) {
    throw new WError(400, 'Only the opponent names a partner.');
  }

  await levelGate(io, me);
  if (newPartner) await levelGate(io, { uid: newPartner.uid, name: newPartner.name, admin: partnerPick!.admin });
  for (const p of d.players) {
    if (p.uid !== me.uid && (await blockedPair(io.db, me.uid, p.uid))) throw new WError(403, `You can't play with ${p.name}.`);
    if (newPartner && (await blockedPair(io.db, newPartner.uid, p.uid))) throw new WError(403, `${newPartner.name} can't play with ${p.name}.`);
  }
  await escrowGate(io, me.uid, d.wager);
  if (!(await wagerEscrow(io.db, me.uid, d.id, d.wager, now))) throw new WError(400, 'Not enough coins for that wager.');

  mine.status = 'accepted';
  mine.escrowed = true;
  mine.acceptedAt = now;
  if (newPartner) d.players.push(newPartner);

  if (d.players.length === 4 && d.players.every((p) => p.status === 'accepted')) {
    d.status = 'scheduled';
    await io.save(d);
    await syncRow(io, d);
    await io.notify(allUids(d), { text: `🏦 Big Bank match scheduled — ${terms(d)}. Check-in opens 10 minutes before the start.`, cid: d.id });
  } else {
    await io.save(d);
    await syncRow(io, d);
    if (newPartner) {
      const text = `🏦 ${me.name} named you their partner for a Big Bank Take Lil Bank match — ${terms(d)}. Accept to escrow your ${d.wager} 🪙.`;
      await io.notify([newPartner.uid], { text, cid: d.id });
      await io.push(d.id, newPartner.uid, 'invite', 'Big Bank challenge 🏦', `${me.name} named you their partner: ${d.wager} coins a player.`);
    }
  }
  return d;
}

/** Refund every escrow and park the challenge in a terminal state (early exits). */
async function finishEarly(io: WIO, d: WData, status: 'declined' | 'expired' | 'cancelled', reason: WagerEndReason, text: string): Promise<WData> {
  const now = io.now();
  for (const p of d.players) {
    if (p.escrowed) {
      await wagerRefund(io.db, p.uid, d.id, d.wager, now);
      p.escrowed = false;
    }
    p.net = 0; // refunded in full (or never escrowed): nobody gains or loses
  }
  d.status = status;
  d.endReason = reason;
  d.settledAt = now;
  await io.save(d);
  await syncRow(io, d);
  await io.notify(allUids(d), { text, cid: d.id });
  return d;
}

export async function decline(io: WIO, d: WData, uid: string): Promise<WData> {
  if (d.status !== 'pending' && d.status !== 'scheduled') throw new WError(409, 'This challenge can no longer be declined.');
  if (io.now() >= checkinOpensAt(d)) throw new WError(409, 'Check-in has opened — declining now would count as a no-show.');
  const me = player(d, uid);
  if (!me) throw new WError(404, 'You are not in this challenge.');
  me.status = 'declined';
  return finishEarly(io, d, 'declined', 'declined', `🏦 ${me.name} declined the Big Bank challenge — all wagers refunded.`);
}

export async function cancel(io: WIO, d: WData, uid: string, admin: boolean): Promise<WData> {
  if (d.status !== 'pending' && d.status !== 'scheduled') throw new WError(409, 'This challenge can no longer be cancelled.');
  if (io.now() >= checkinOpensAt(d)) throw new WError(409, 'Check-in has opened — cancelling now would count as a no-show.');
  if (!admin && !player(d, uid)) throw new WError(404, 'You are not in this challenge.');
  return finishEarly(io, d, 'cancelled', 'cancelled', '🏦 The Big Bank challenge was cancelled — all wagers refunded.');
}

export async function checkin(io: WIO, d: WData, uid: string): Promise<WData> {
  const now = io.now();
  if (d.status !== 'scheduled' && d.status !== 'checkin') throw new WError(409, 'Check-in is not open for this challenge.');
  if (now < checkinOpensAt(d)) throw new WError(409, 'Check-in opens 10 minutes before the start.');
  const me = player(d, uid);
  if (!me) throw new WError(404, 'You are not in this challenge.');
  me.checkedIn = true;
  await io.save(d);
  await syncRow(io, d);
  return d;
}

/** Seat order at the match table: partnership sides sit 0/2 vs 1/3; cutthroat seats in accept order, challenger first. */
function seatOrder(d: WData): WPlayer[] {
  if (d.format === 'partnership') {
    const by = (role: WPlayer['role'], side: number) => d.players.find((p) => p.role === role && p.side === side)!;
    return [by('challenger', 0), by('opponent', 1), by('partner', 0), by('partner', 1)];
  }
  const rest = d.players.filter((p) => p.role !== 'challenger').sort((a, b) => (a.acceptedAt ?? 0) - (b.acceptedAt ?? 0));
  return [d.players.find((p) => p.role === 'challenger')!, ...rest];
}

async function begin(io: WIO, d: WData): Promise<WData> {
  const ordered = seatOrder(d);
  ordered.forEach((p, i) => { p.seat = i; });
  let code: string;
  try {
    code = await io.createMatchTable({ cid: d.id, rules: d.rules, reserved: ordered.map((p) => ({ uid: p.uid, name: p.name })), autostartAt: io.now() + SEAT_GRACE_MS });
  } catch (e) {
    d.beginAttempts++;
    if (d.beginAttempts >= 5) {
      console.error('wager', 'seat_failed', { challenge: d.id, attempts: d.beginAttempts, error: String(e).slice(0, 160) });
      return finishEarly(io, d, 'cancelled', 'cancelled', '🏦 The Big Bank match could not be seated — all wagers refunded.');
    }
    await io.save(d);
    await io.setAlarm(io.now() + 30_000);
    return d;
  }
  d.tableCode = code;
  d.status = 'live';
  await io.save(d);
  await syncRow(io, d);
  for (const p of d.players) {
    await io.notify([p.uid], { text: '🏦 Your Big Bank table is ready — take your seat.', code, seat: p.seat ?? 0, cid: d.id });
    await io.push(d.id, p.uid, 'ready', 'Big Bank table ready 🏦', 'Your match is starting — take your seat.');
  }
  return d;
}

/** alarm: accept deadline / check-in opening / the scheduled start */
export async function alarm(io: WIO, d: WData): Promise<WData> {
  const now = io.now();
  if (d.status === 'pending') {
    if (now >= checkinOpensAt(d)) {
      return finishEarly(io, d, 'expired', 'expired', '🏦 The Big Bank challenge expired: not everyone accepted in time — all wagers refunded.');
    }
    await io.setAlarm(checkinOpensAt(d));
    return d;
  }
  if (d.status === 'scheduled' || d.status === 'checkin') {
    if (now >= d.startAt) return begin(io, d);
    if (now >= checkinOpensAt(d)) {
      if (!d.remindedCheckin) {
        d.remindedCheckin = true;
        d.status = 'checkin';
        await io.save(d);
        await syncRow(io, d);
        const mins = Math.max(1, Math.round((d.startAt - now) / 60_000));
        const text = `🏦 Check-in is open for your Big Bank match (${d.wager} 🪙 a player): starts in ${mins} min.`;
        await io.notify(allUids(d), { text, cid: d.id });
        for (const p of d.players) await io.push(d.id, p.uid, 'checkin', 'Big Bank check-in open 🏦', `Your match starts in ${mins} min — check in.`);
      }
      await io.setAlarm(d.startAt);
      return d;
    }
    await io.setAlarm(checkinOpensAt(d));
    return d;
  }
  return d;
}

/* ------------------------------------------------------------ settlement */

const sideOf = (d: WData, p: WPlayer): number => (d.format === 'partnership' ? (p.side ?? 0) : (p.seat ?? 0));
const bySeat = (a: WPlayer, b: WPlayer): number => (a.seat ?? 0) - (b.seat ?? 0);

async function outcome(io: WIO, d: WData, text: string): Promise<void> {
  await io.notify(allUids(d), { text, cid: d.id });
  for (const p of d.players) await io.push(d.id, p.uid, 'outcome', 'Big Bank 🏦', text.replace(/^🏦 /, ''));
}

/** Nobody gets paid; every escrow comes back. Used for voids and defensive paths. */
async function voidAll(io: WIO, d: WData, reason: WagerEndReason, text: string): Promise<WData> {
  const now = io.now();
  for (const p of d.players) {
    if (p.escrowed) {
      await wagerRefund(io.db, p.uid, d.id, d.wager, now);
      p.escrowed = false;
    }
    p.net = 0; // void: every escrow comes back, nobody gains or loses
  }
  d.status = 'void';
  d.endReason = reason;
  d.settledAt = now;
  await io.save(d);
  await syncRow(io, d);
  await outcome(io, d, text);
  return d;
}

async function settlePlayed(io: WIO, d: WData, r: Extract<WResult, { kind: 'played' }>, now: number): Promise<WData> {
  const pot = d.wager * 4;
  const winSides = new Set<number>();
  r.places.forEach((place, side) => { if (place === 1) winSides.add(side); });
  const winners = d.players.filter((p) => winSides.has(sideOf(d, p)));
  if (!winners.length) {
    // a played game with no readable winner must not strand escrowed coins
    return voidAll(io, d, 'played', '🏦 Big Bank: the match result could not be read — all wagers refunded.');
  }
  const share = Math.floor(pot / winners.length);
  const remainder = pot - share * winners.length;
  const ordered = [...winners].sort(bySeat);
  for (let i = 0; i < ordered.length; i++) {
    const paid = share + (i === 0 ? remainder : 0);
    await wagerPayWin(io.db, ordered[i]!.uid, d.id, d.wager, paid, now);
    ordered[i]!.net = paid - d.wager; // paid includes their escrow back; the rest is winnings
  }
  d.status = 'settled';
  d.endReason = 'played';
  d.gameId = r.gameId;
  d.settledAt = now;
  for (const p of d.players) { p.escrowed = false; if (p.net == null) p.net = -d.wager; } // losers' escrows are spent
  await io.save(d);
  await syncRow(io, d);
  // settlement pairing log for manual collusion review (matches the cred tripwire culture)
  console.warn('wager', 'settled', { challenge: d.id, format: d.format, wager: d.wager, winners: winners.map((w) => w.uid), losers: d.players.filter((p) => !winners.includes(p)).map((p) => p.uid), game: r.gameId });
  const names = ordered.map((w) => w.name).join(' + ');
  await outcome(io, d, `🏦 Big Bank settled: ${names} took the ${pot} 🪙 pot.`);
  return d;
}

async function settleNoshow(io: WIO, d: WData, shown: Set<string>, now: number): Promise<WData> {
  const w = d.wager;
  const noShows = d.players.filter((p) => !shown.has(p.uid));
  const strike = (p: WPlayer) => console.warn('wager', 'no_show', { challenge: d.id, user: p.uid, wager: w }); // launch: log only, no extra punishment

  if (d.format === 'partnership') {
    const sideComplete = (s: number) => d.players.filter((p) => p.side === s).every((p) => shown.has(p.uid));
    const c0 = sideComplete(0), c1 = sideComplete(1);
    if (c0 === c1) {
      // both sides complete can't reach here (the room starts the game), and
      // neither side complete is the owner's void case: full refunds either way
      for (const p of noShows) strike(p);
      return voidAll(io, d, 'double_no_show', '🏦 Big Bank called off: neither side showed in full — all wagers refunded.');
    }
    const winSide = c0 ? 0 : 1;
    const presentPair = d.players.filter((p) => p.side === winSide).sort(bySeat);
    const showedPartner = d.players.filter((p) => p.side !== winSide && shown.has(p.uid));
    const pool = w * noShows.length;
    const share = Math.floor(pool / presentPair.length);
    const remainder = pool - share * presentPair.length;
    for (let i = 0; i < presentPair.length; i++) {
      await wagerRefund(io.db, presentPair[i]!.uid, d.id, w, now);
      await wagerForfeit(io.db, presentPair[i]!.uid, d.id, share + (i === 0 ? remainder : 0), now);
      presentPair[i]!.net = share + (i === 0 ? remainder : 0); // escrow refunded + their cut of the forfeit
    }
    // the partner who showed is made whole; only the no-show's escrow is lost
    for (const p of showedPartner) { await wagerRefund(io.db, p.uid, d.id, w, now); p.net = 0; }
    for (const p of noShows) strike(p);
    d.status = 'forfeited';
    d.endReason = 'no_show';
    d.settledAt = now;
    for (const p of d.players) { p.escrowed = false; if (p.net == null) p.net = -w; } // the no-shows lose their wager
    await io.save(d);
    await syncRow(io, d);
    await outcome(io, d, `🏦 Big Bank no-show: ${noShows.map((p) => p.name).join(' + ')} didn't show — ${presentPair.map((p) => p.name).join(' + ')} take their wager.`);
    return d;
  }

  // cutthroat: any no-show voids the match; the players who showed split the no-shows' escrows
  const showers = d.players.filter((p) => shown.has(p.uid)).sort(bySeat);
  if (!noShows.length || !showers.length) {
    for (const p of noShows) strike(p);
    return voidAll(io, d, 'double_no_show', '🏦 Big Bank called off: not enough players showed — all wagers refunded.');
  }
  const pool = w * noShows.length;
  const share = Math.floor(pool / showers.length);
  const remainder = pool - share * showers.length;
  for (let i = 0; i < showers.length; i++) {
    await wagerRefund(io.db, showers[i]!.uid, d.id, w, now);
    await wagerForfeit(io.db, showers[i]!.uid, d.id, share + (i === 0 ? remainder : 0), now);
    showers[i]!.net = share + (i === 0 ? remainder : 0); // escrow refunded + their cut of the forfeits
  }
  for (const p of noShows) strike(p);
  d.status = 'forfeited';
  d.endReason = 'no_show';
  d.settledAt = now;
  for (const p of d.players) { p.escrowed = false; if (p.net == null) p.net = -w; } // the no-shows lose their wager
  await io.save(d);
  await syncRow(io, d);
  await outcome(io, d, `🏦 Big Bank no-show: ${noShows.map((p) => p.name).join(' + ')} didn't show — the match is void and their wager is split by the players who showed.`);
  return d;
}

async function settleAbandoned(io: WIO, d: WData, leaverUid: string | null, now: number): Promise<WData> {
  const w = d.wager;
  const leaver = leaverUid ? player(d, leaverUid) : undefined;
  if (!leaver) {
    // room expired with no named leaver (everyone vanished): safest money behavior is a void
    return voidAll(io, d, 'abandoned', '🏦 Big Bank called off: the match was abandoned — all wagers refunded.');
  }
  const others = d.players.filter((p) => p.uid !== leaver.uid).sort(bySeat);
  const share = Math.floor(w / others.length);
  const remainder = w - share * others.length;
  for (let i = 0; i < others.length; i++) {
    await wagerRefund(io.db, others[i]!.uid, d.id, w, now);
    await wagerForfeit(io.db, others[i]!.uid, d.id, share + (i === 0 ? remainder : 0), now);
    others[i]!.net = share + (i === 0 ? remainder : 0); // escrow refunded + their cut of the leaver's wager
  }
  d.status = 'forfeited';
  d.endReason = 'abandoned';
  d.settledAt = now;
  for (const p of d.players) { p.escrowed = false; if (p.net == null) p.net = -w; } // the leaver loses their wager
  await io.save(d);
  await syncRow(io, d);
  console.warn('wager', 'abandoned', { challenge: d.id, leaver: leaver.uid, wager: w });
  await outcome(io, d, `🏦 Big Bank: ${leaver.name} left mid-match — their ${w} 🪙 wager is split by the table.`);
  return d;
}

/** A table reported how the match ended. Settlement is once-only: the status guard makes duplicates no-ops. */
export async function result(io: WIO, d: WData, r: WResult): Promise<WData> {
  if (d.status !== 'live') return d;
  const now = io.now();
  if (r.kind === 'played') return settlePlayed(io, d, r, now);
  if (r.kind === 'noshow') return settleNoshow(io, d, new Set(r.shown), now);
  return settleAbandoned(io, d, r.leaverUid, now);
}

/** Public view (+ what the viewer can do). */
export function view(d: WData, viewer: string | null, now: number) {
  const me = viewer ? player(d, viewer) : undefined;
  const opens = checkinOpensAt(d);
  return {
    id: d.id,
    format: d.format,
    mode: d.mode,
    rules: { mode: d.rules.mode, deck: d.rules.deck, targetScore: d.rules.targetScore, turnTimerSec: d.rules.turnTimerSec, playerCount: d.rules.playerCount, partnerships: d.rules.partnerships },
    wager: d.wager,
    pot: d.wager * 4,
    startAt: d.startAt,
    checkinOpensAt: opens,
    createdAt: d.createdAt,
    status: d.status,
    endReason: d.endReason,
    tableCode: d.tableCode,
    gameId: d.gameId,
    settledAt: d.settledAt,
    players: d.players.map((p) => ({ uid: p.uid, name: p.name, role: p.role, side: p.side, seat: p.seat, status: p.status, escrowed: p.escrowed, checkedIn: p.checkedIn, net: p.net ?? null })),
    you: me ? {
      role: me.role, status: me.status, escrowed: me.escrowed, checkedIn: me.checkedIn,
      canAccept: d.status === 'pending' && me.status === 'invited' && now < opens,
      canCheckin: (d.status === 'scheduled' || d.status === 'checkin') && now >= opens && !me.checkedIn,
      canCancel: (d.status === 'pending' || d.status === 'scheduled') && now < opens,
    } : null,
    now,
  };
}
