/**
 * The game room: everything a Table Durable Object does, minus the Cloudflare plumbing, so it can be
 * unit-tested with mock sockets and a fake clock. The server is the referee (spec §4.2):
 *  - it shuffles/deals (packages/rules), validates every bid/play, and only ever sends a seat its own view;
 *  - bots (packages/bots) fill empty seats and play from that seat's view only;
 *  - human turns have a deadline; when it passes (or a disconnected player's short grace runs out)
 *    the bot logic plays for them;
 *  - all durable state lives in one plain-JSON `RoomData` object that the DO saves as a single row.
 */
import {
  type Action, type GameState, type Series, addSeriesGame, emptySeries, seriesMatches, seriesSides, summarizeGame, type PlayerView, type TableRules, RuleError, RulesConfigError, acceptRules, applyAction, canRunIt, type Seat, spectatorView, isFreshDeal, isNukeTrick, nextDealer, makeRules, newGame, pendingTurn, secureSeed, viewFor,
} from '@spades/rules';
import { type TalkEvent, type TalkLine, type TalkState, type TalkTable, botTalk, chooseBotAction, loudLoser, parseHint, leanBid, botSkillFor, personaSkillFloor, seatSkill, leanNil, momentsFor, newTalkState, pickBotNames, prePlayLine } from '@spades/bots';
import {
  type BotLevel, type ChatLine, type ClientMsg, type HostMusic, type MediaState, type RoomInfo, type RoomPhase, type SeatInfo, type ServerMsg,
  DEFAULT_AFK_LIMIT, LIMITS, PROTOCOL_VERSION, parseClientMsg,
  HAND_END_HOLD_MS, NUKE_ALLOWANCE_MS, RUN_FX_MS, type NukeIntensity, type TalkIntensity, cleanTeamName, pickTeamName, type VenueChoice, type VenueId, rollVenue,
} from '@spades/protocol';
import type { OpenTable } from '@spades/protocol';
import { blockLinks, cleanName, cleanText, maskProfanity } from './filter';
import { type GameRecord, type LiveStats, type SeatRef, buildRecord, isRated, newLiveStats, placementsOf } from './stats/record';

export const ROOM_DATA_VERSION = 1;

export type SeatSlot =
  | { kind: 'empty' }
  /** vacated: a bot that took over from a player who left / was kicked / went AFK (always open to spectators) */
  | { kind: 'bot'; name: string; level: BotLevel; vacated?: boolean }
  | { kind: 'human'; playerId: string };

export interface Member {
  name: string;
  token: string;
  seat: number | null;
  media: MediaState;
  joinedAt: number;
  /** tips on: own turn timers ×1.5 */
  learning?: boolean;
  /** consecutive turns this player ran out of time on (reset by any move of their own) */
  timeouts?: number;
  /** ids of this player's most recently applied actions (idempotency for retries after a reconnect) */
  acts?: string[];
  /** badges earned at this table (same shape as the client's local badges, for a future accounts system) */
  badges?: { id: string; earnedAt: number; context?: Record<string, unknown> }[];
  /** Release 9: signed-in account behind this seat (from a verified account ticket) → stats, ratings, recent players */
  uid?: string;
}

/** Everything that survives hibernation / restarts. Plain JSON. */
export interface RoomData {
  v: number;
  code: string;
  createdAt: number;
  lastActive: number;
  hostId: string | null;
  phase: RoomPhase;
  rules: TableRules;
  botLevel: BotLevel;
  seats: SeatSlot[];
  members: Record<string, Member>;
  game: GameState | null;
  /** key of the turn the deadline belongs to */
  turnKey: string | null;
  turnStartedAt: number | null;
  deadline: number | null;
  ready: string[];
  chat: ChatLine[];
  chatSeq: number;
  /** partner talk this hand (bidding only): the latest hint per seat, for bot partners bidding after it */
  hints?: Record<number, { hand: number; text: string }>;
  rev: number;
  /** game version (see RoomInfo.seq); optional only for rooms saved before it existed */
  seq?: number;
  /** host-set Table Talk countdown (s); unset = timing.handOverMs */
  talkSec?: number;
  music?: HostMusic;
  /** consecutive timeouts before a bot replaces a player; 0 = off; unset = DEFAULT_AFK_LIMIT */
  afkLimit?: number;
  /** host option: partner voice limiting during trick play (from the first card led); unset = off */
  partnerMicMute?: boolean;
  nukeIntensity?: NukeIntensity;
  talkIntensity?: TalkIntensity;
  venue?: VenueChoice;
  venueNow?: VenueId;
  /** host option: bot trash talk (default on) */
  botTalk?: boolean;
  /** per side: custom team name (null/unset = partner names) */
  teamNames?: (string | null)[];
  /** trash-talk cooldown state (bot reveals etc.) */
  talk?: TalkState;
  /** rematch series (see @spades/rules series) */
  series?: Series | null;
  /** per-seat member ids at the start of the current game (series composition) */
  seriesSeats?: string[];
  /** seat tokens and account ids kicked during the current game (can't rejoin until the next game starts) */
  kicked?: string[];
  /** open vote-kicks: target player id → voter ids */
  votes?: Record<string, string[]>;
  gamesPlayed: number;
  /** Release 9: per-seat counters for the current game (think times, Big Joker wins) */
  live?: LiveStats;
  /** Release 9b: this table runs a tournament match */
  tournament?: TournamentSeat;
  /** Release 10: hidden from Open tables (invite / code only) */
  private?: boolean;
  /**
   * Spectators may take bot seats mid-game.
   * unset = on, except at a rated table (a signed-in player facing a human on another side), where the default is off.
   * A seat a player left is always open. true/false are explicit host choices.
   */
  replaceBots?: boolean;
  /** epoch ms when the host's last socket dropped; another connected member becomes host after HOST_DISCONNECT_GRACE_MS */
  hostAwaySince?: number;
  /** latched when a game starts: this deal counts for Elo, so a leaver doesn't open their seat to a guest */
  rated?: boolean;
}

/** Release 9b: this table plays one tournament match (rules locked, seats reserved for the entrants, autostart). */
export interface TournamentSeat {
  id: string;
  match: string;
  name?: string;
  /** per seat: the account that owns it (null = a bot plays) */
  reserved: ({ uid: string; name: string } | null)[];
  autostartAt: number | null;
  /** bots play for entrants who don't show (off = a side with nobody present forfeits) */
  bots: boolean;
  /** local test runs: fast bot timing */
  fast?: boolean;
  reported?: boolean;
  /** everyone left mid-match since … (after a grace period the match is played out by bots so the bracket can't stall) */
  emptySince?: number;
}

export interface RoomTiming {
  /** delay before a bot moves */
  botMs: number;
  /** extra pause after a trick completes (clients show the finished trick) */
  trickPauseMs: number;
  /** extra pause at the start of a hand (shuffle + deal animation) */
  dealMs: number;
  /** how long a disconnected player's turn waits before auto-play */
  disconnectGraceMs: number;
  /** hand-results screen: auto-continue after this long even if not everyone pressed Next */
  handOverMs: number;
  /** extra Table Talk lead-in while clients finish the hand's hype effects (default HAND_END_HOLD_MS; tests use 0) */
  handEndHoldMs?: number;
}

/** learning mode (a player with tips on): their own turn timer runs this much longer */
export const LEARNING_TIMER = 1.5;
/** tournament table with nobody connected: play the match out after this long */
export const TOURNAMENT_EMPTY_GRACE_MS = 90_000;
/** seated host dropped without leaving: pass host after this long so the table can still start or rematch */
export const HOST_DISCONNECT_GRACE_MS = 30_000;
export const DEFAULT_TIMING: RoomTiming = { botMs: 750, trickPauseMs: 1300, dealMs: 3200, disconnectGraceMs: 10_000, handOverMs: 20_000 };

/** What the host environment (Durable Object or test harness) provides. */
export interface RoomIO {
  now(): number;
  send(connId: string, msg: ServerMsg): void;
  /** close a connection (e.g. a duplicate socket for the same player) */
  close?(connId: string, code: number, reason: string): void;
  /** ask for `tick()` to be called after `ms` (in-memory timer; short delays only) */
  wake(ms: number): void;
  /** durable wake-up at an absolute time (DO alarm). null = nothing pending. */
  setAlarm(at: number | null): void;
  /** state changed: save it (the DO batches/debounces this) */
  persist(): void;
  /** random id/token/seed source (crypto in prod, seeded in tests) */
  randomId(): string;
  /** Release 9: a finished game with at least one signed-in player (DO: write stats/Elo to D1) */
  gameOver?(rec: GameRecord, rated: boolean): void;
  /** Release 9b: a tournament match finished (per side: final score and placement, 1 = won) */
  tournamentResult?(t: TournamentSeat, scores: number[], places: number[]): void;
  /** Release 10: this table's Open tables entry (null = unlisted); called after every broadcast, the DO dedups */
  listing?(t: OpenTable | null): void;
}


export function newRoomData(code: string, now: number, rules: TableRules = makeRules('joker')): RoomData {
  return {
    v: ROOM_DATA_VERSION, code, createdAt: now, lastActive: now, hostId: null, phase: 'lobby',
    rules, botLevel: 'mixed', seats: Array.from({ length: 4 }, () => ({ kind: 'empty' as const })), members: {},
    game: null, turnKey: null, turnStartedAt: null, deadline: null, ready: [], chat: [], chatSeq: 1, rev: 0, seq: 0, gamesPlayed: 0,
  };
}

/** Host rules are untrusted: rebuild them from the mode preset. Timers are clamped inside acceptRules. */
function clampRules(r: unknown): TableRules {
  return acceptRules(r);
}

export class Room {
  /** connection id → player id (null until `hello`) */
  private conns = new Map<string, string | null>();
  private chatWindow = new Map<string, number[]>();
  private botDueAt: number | null = null;
  private botKey: string | null = null;

  constructor(public data: RoomData, private io: RoomIO, private timing: RoomTiming = DEFAULT_TIMING) {
    data.seq ??= 0;
  }

  /* ------------------------------------------------------------ connections */

  /** Re-register a connection that survived hibernation (DO wake-up). */
  restoreConnection(connId: string, playerId: string | null): void {
    this.conns.set(connId, playerId && this.data.members[playerId] ? playerId : null);
  }

  open(connId: string): void {
    this.conns.set(connId, null);
  }

  close(connId: string): void {
    const pid = this.conns.get(connId);
    this.sentHistory.delete(connId);
    this.conns.delete(connId);
    if (!pid || this.isConnected(pid)) return;
    const m = this.data.members[pid];
    if (m && m.seat === null) {
      // an unseated member who dropped, in any phase: forget them so they don't fill the table
      this.dropGhosts();
    } else if (m && this.data.hostId === pid) {
      this.data.hostAwaySince ??= this.io.now();
    }
    this.after();
  }

  isConnected(playerId: string): boolean {
    for (const p of this.conns.values()) if (p === playerId) return true;
    return false;
  }

  connectionCount(): number {
    return this.conns.size;
  }

  humansConnected(): number {
    return this.data.seats.filter((s) => s.kind === 'human' && this.isConnected(s.playerId)).length;
  }

  /** Release 9: the connection proved an account (verified ticket): link its member for stats. One account, one seat. */
  linkUser(connId: string, uid: string): void {
    const pid = this.conns.get(connId);
    const m = pid ? this.data.members[pid] : undefined;
    if (!m || !pid) return;
    if (this.kickedOut(undefined, uid)) { this.rejectKick(connId); return; }
    if (m.uid === uid) return;
    this.claimAccount(pid, uid);
    const now = this.conns.get(connId) ?? pid;
    if (now !== pid) {
      const kept = this.data.members[now];
      if (kept) this.io.send(connId, { t: 'welcome', you: now, token: kept.token, code: this.data.code, chat: this.data.chat.slice(-LIMITS.chatHistory), v: PROTOCOL_VERSION });
    }
    this.after();
    this.io.persist();
  }

  /** Release 9b: turn a fresh table into a tournament match. */
  setupTournament(t: TournamentSeat, rules: TableRules): void {
    const d = this.data;
    d.rules = clampRules(rules);
    d.tournament = { ...t, reported: false };
    d.botLevel = 'mixed';
    d.seats = Array.from({ length: 4 }, () => ({ kind: 'empty' as const }));
    d.teamNames = undefined;
    if (t.autostartAt) this.io.setAlarm(t.autostartAt);
    this.system(`Tournament match${t.name ? ` · ${t.name}` : ''}: seats are reserved; the game starts automatically`);
    this.io.persist();
  }

  /** a member whose account owns a reserved seat sits there */
  private seatReserved(pid: string): void {
    const d = this.data;
    const t = d.tournament;
    const m = d.members[pid];
    if (!t || !m?.uid || m.seat !== null) return;
    const seat = t.reserved.findIndex((r) => r?.uid === m.uid);
    if (seat < 0) return;
    const slot = d.seats[seat]!;
    if (slot.kind === 'human' && slot.playerId !== pid && this.isConnected(slot.playerId)) return;
    if (slot.kind === 'human' && slot.playerId !== pid) d.members[slot.playerId]!.seat = null;
    if (d.phase === 'lobby' || slot.kind === 'bot' || slot.kind === 'empty' || slot.kind === 'human') {
      d.seats[seat] = { kind: 'human', playerId: pid };
      m.seat = seat;
      m.timeouts = 0;
    }
    if (d.phase === 'lobby' && this.allReservedSeated()) this.autostart();
  }

  private allReservedSeated(): boolean {
    const d = this.data;
    const t = d.tournament!;
    return t.reserved.slice(0, d.rules.playerCount).every((r, i) => !r || (d.seats[i]?.kind === 'human' && this.isConnected((d.seats[i] as { playerId: string }).playerId)));
  }

  /** start the match now (deadline passed, or everyone is here); no-shows → bots, or a forfeit when bots are off */
  private autostart(): void {
    const d = this.data;
    const t = d.tournament!;
    if (d.phase !== 'lobby') return;
    t.autostartAt = null;
    const n = d.rules.playerCount;
    const sides = d.rules.partnerships ? 2 : n;
    const present = Array.from({ length: sides }, (_, side) => {
      const seats = Array.from({ length: n }, (_, i) => i).filter((i) => (d.rules.partnerships ? i % 2 : i) === side);
      return seats.some((i) => d.seats[i]?.kind === 'human') || seats.every((i) => !t.reserved[i]);
    });
    if (!t.bots && present.some((p) => !p)) {
      // forfeit: sides with someone present win, absent sides lose
      d.phase = 'over';
      t.reported = true;
      const places = present.map((p) => (p ? 1 : 2));
      this.system(present.some(Boolean) ? 'No-show: the match is forfeited' : 'Nobody showed up: the match is a double forfeit');
      this.io.tournamentResult?.(t, present.map(() => 0), present.some(Boolean) ? places : present.map(() => 1));
      return;
    }
    for (let i = 0; i < n; i++) {
      const r = t.reserved[i];
      if (d.seats[i]!.kind === 'empty') d.seats[i] = { kind: 'bot', name: r ? `${r.name} (bot)`.slice(0, 20) : this.botName(), level: 'pro' };
    }
    // nobody showed at all: no grace, the bots play it out right away
    if (this.humansConnected() === 0) t.emptySince = this.io.now() - TOURNAMENT_EMPTY_GRACE_MS;
    this.startGame();
  }

  /** member ids → account ids (for tournament / stats bookkeeping) */
  accountOf(pid: string): string | undefined { return this.data.members[pid]?.uid; }

  /** a client-minted seat token: long enough that it isn't guessable, and safe to store */
  private tokenOk(token: string): boolean {
    return /^[A-Za-z0-9_-]{16,100}$/.test(token);
  }

  private kickedOut(token?: string, uid?: string): boolean {
    const k = this.data.kicked ?? [];
    return (!!token && k.includes(token)) || (!!uid && k.includes(uid));
  }

  private rejectKick(connId: string): void {
    this.err(connId, 'KICKED', 'You were removed from this table for this game');
    this.conns.delete(connId);
    this.io.close?.(connId, 4003, 'kicked');
  }

  /** members who still occupy a slot: seated, or unseated and actually connected */
  private liveCounts(): { members: number; watching: number } {
    let members = 0, watching = 0;
    for (const [id, m] of Object.entries(this.data.members)) {
      if (m.seat === null && !this.isConnected(id)) continue;
      members++;
      if (m.seat === null) watching++;
    }
    return { members, watching };
  }

  /** forget disconnected unseated members (they must not hold a member or spectator slot) */
  private dropGhosts(): void {
    const d = this.data;
    for (const [id, m] of Object.entries(d.members)) {
      if (m.seat !== null || this.isConnected(id)) continue;
      delete d.members[id];
      if (d.hostId === id) this.passHost();
    }
  }

  /**
   * One account, one member. A second connection of the same account joins the member already here
   * (and a second seat, if one was taken, is given back).
   */
  private claimAccount(pid: string, uid: string): void {
    const d = this.data;
    const m = d.members[pid];
    if (!m) return;
    const otherId = Object.keys(d.members).find((id) => id !== pid && d.members[id]?.uid === uid);
    if (!otherId) { m.uid = uid; this.seatReserved(pid); return; }
    const other = d.members[otherId]!;
    // keep the seated body when the account's older member is only watching; otherwise keep the one that already had the account
    const keepId = m.seat !== null && other.seat === null ? pid : otherId;
    const dropId = keepId === pid ? otherId : pid;
    const drop = d.members[dropId]!;
    const keep = d.members[keepId]!;
    if (drop.seat !== null && drop.seat !== keep.seat) {
      d.seats[drop.seat] = d.phase === 'playing' ? { kind: 'bot', name: this.botName(), level: d.botLevel, vacated: true } : { kind: 'empty' };
    }
    for (const [cid, p] of this.conns) if (p === dropId) this.conns.set(cid, keepId);
    if (d.hostId === dropId) d.hostId = keepId;
    if (d.hostId && this.isConnected(d.hostId)) delete d.hostAwaySince;
    delete d.members[dropId];
    keep.uid = uid;
    keep.name = m.name;
    this.seatReserved(keepId);
  }

  /** signed-in player facing a human on another side: this seating would count for Elo */
  private ratedTable(): boolean {
    const d = this.data;
    const n = d.rules.playerCount;
    let account = false;
    const sides = new Set<number>();
    for (let i = 0; i < n; i++) {
      const s = d.seats[i];
      if (s?.kind !== 'human') continue;
      sides.add(d.rules.partnerships ? i % 2 : i);
      if (d.members[s.playerId]?.uid) account = true;
    }
    return account && sides.size >= 2;
  }

  /** rated for seat-takeover policy: latched at the deal so a player leaving doesn't open the seat to a guest */
  private ratedSeats(): boolean {
    if ((this.data.phase === 'playing' || this.data.phase === 'over') && this.data.rated) return true;
    return this.ratedTable();
  }

  /** explicit host choice wins; otherwise on, except at a rated table */
  private replaceBotsOn(): boolean {
    if (this.data.replaceBots === false) return false;
    if (this.data.replaceBots === true) return true;
    return !this.ratedSeats();
  }

  /* --------------------------------------------------------------- messages */

  message(connId: string, raw: unknown, uid?: string | null): void {
    let msg: ClientMsg | null = null;
    try {
      if (!this.conns.has(connId)) this.conns.set(connId, null);
      msg = parseClientMsg(raw);
      if (!msg) return this.err(connId, 'BAD_MESSAGE', 'Malformed message');
      const pid = this.conns.get(connId) ?? null;
      if (msg.t === 'hello') return this.hello(connId, msg, uid || undefined);
      if (!pid || !this.data.members[pid]) return this.err(connId, 'NOT_JOINED', 'Say hello first');
      this.data.lastActive = this.io.now();
      this.handle(connId, pid, msg);
    } catch (e) {
      // A throw used to escape the Durable Object handler and freeze the table. Answer this message and keep going.
      this.failMessage(connId, msg, e);
    }
  }

  private hello(connId: string, msg: Extract<ClientMsg, { t: 'hello' }>, uid?: string): void {
    const d = this.data;
    this.dropGhosts();
    const name = cleanName(msg.name, LIMITS.nameMax) || 'Player';
    if (this.kickedOut(msg.token, uid)) { this.rejectKick(connId); return; }
    // same seat token, or the same account (a second tab / cleared storage still presenting the ticket)
    let pid = msg.token ? Object.keys(d.members).find((id) => d.members[id]!.token === msg.token) : undefined;
    if (pid && uid && d.members[pid]!.uid && d.members[pid]!.uid !== uid) pid = undefined;
    if (!pid && uid) pid = Object.keys(d.members).find((id) => d.members[id]!.uid === uid);
    if (pid) {
      // reconnect: same player, same seat; drop any older socket of theirs
      for (const [cid, p] of this.conns) if (p === pid && cid !== connId) { this.conns.delete(cid); this.io.close?.(cid, 4000, 'replaced'); }
      const m = d.members[pid]!;
      m.name = name;
      if (uid) m.uid = uid;
      if (d.hostId === pid) delete d.hostAwaySince;
    } else {
      const { members, watching } = this.liveCounts();
      if (members >= LIMITS.members || (d.phase !== 'lobby' && watching >= LIMITS.spectators)) {
        this.err(connId, 'TABLE_FULL', 'This table is full');
        this.io.close?.(connId, 4001, 'full');
        return;
      }
      pid = this.io.randomId().slice(0, 12);
      // honor a client-minted token so a second tab that stored it first lands in this same member
      const tokenTaken = !!msg.token && Object.values(d.members).some((m) => m.token === msg.token);
      const token = msg.token && this.tokenOk(msg.token) && !tokenTaken ? msg.token : this.io.randomId();
      d.members[pid] = { name, token, seat: null, media: { cam: false, mic: false }, joinedAt: this.io.now(), ...(uid ? { uid } : {}) };
      if (!d.hostId || !d.members[d.hostId]) d.hostId = pid;
      this.system(`${name} joined`);
    }
    this.conns.set(connId, pid);
    // token matched a different body than the account already seated here: fold them into one member
    if (uid && Object.keys(d.members).some((id) => id !== pid && d.members[id]!.uid === uid)) {
      this.claimAccount(pid, uid);
      pid = this.conns.get(connId) ?? pid;
    }
    this.sentHistory.delete(connId);
    const m = d.members[pid]!;
    this.io.send(connId, { t: 'welcome', you: pid, token: m.token, code: d.code, chat: d.chat.slice(-LIMITS.chatHistory), v: PROTOCOL_VERSION });
    if (uid) this.seatReserved(pid);
    d.lastActive = this.io.now();
    this.after();
  }

  private handle(connId: string, pid: string, msg: ClientMsg): void {
    const d = this.data;
    const me = d.members[pid]!;
    const isHost = d.hostId === pid;
    const n = d.rules.playerCount;
    switch (msg.t) {
      case 'sit': {
        if (msg.seat >= n) throw new RoomError('BAD_SEAT', 'No such seat');
        if (d.tournament) {
          const r = d.tournament.reserved[msg.seat];
          if (!r || r.uid !== me.uid) throw new RoomError('RESERVED', 'Seats at a tournament table are reserved for the entrants');
          this.seatReserved(pid);
          break;
        }
        const slot = d.seats[msg.seat]!;
        if (me.seat === msg.seat) return;
        if (me.uid && Object.entries(d.members).some(([id, o]) => id !== pid && o.uid === me.uid && o.seat !== null)) {
          throw new RoomError('ALREADY_SEATED', 'This account is already seated at this table');
        }
        if (d.phase === 'playing') {
          // mid-game you may only take over a bot's seat (and only if you're not already playing)
          if (me.seat !== null) throw new RoomError('IN_GAME', 'You are already playing');
          if (slot.kind !== 'bot') throw new RoomError('SEAT_TAKEN', 'That seat is taken');
          if (!this.takeable().includes(msg.seat)) throw new RoomError('SEAT_LOCKED', "The host doesn't let spectators replace bots");
          if (this.ratedSeats() && !me.uid) throw new RoomError('ACCOUNT_REQUIRED', 'Sign in to take a seat in a rated game');
        } else if (slot.kind === 'human') throw new RoomError('SEAT_TAKEN', 'That seat is taken');
        if (me.seat !== null) d.seats[me.seat] = { kind: 'empty' };
        d.seats[msg.seat] = { kind: 'human', playerId: pid };
        me.seat = msg.seat;
        me.timeouts = 0;
        if (d.phase === 'playing') {
          // the new player takes over the seat's hand and score as is; on that seat's own turn their clock starts fresh
          const g = d.game;
          if (g && pendingTurn(g)?.seat === msg.seat) d.turnKey = null;
          this.system(`${me.name} took over ${slot.kind === 'bot' ? `${slot.name}'s` : 'a'} seat`);
        }
        break;
      }
      case 'stand': {
        if (me.seat === null) return;
        if (d.phase === 'playing') throw new RoomError('IN_GAME', 'Leave the table to give your seat to a bot');
        d.seats[me.seat] = { kind: 'empty' };
        me.seat = null;
        break;
      }
      case 'addBot': {
        this.requireHost(isHost);
        if (d.tournament) throw new RoomError('LOCKED', 'Tournament tables are locked');
        if (d.phase === 'playing') throw new RoomError('IN_GAME', 'Game in progress');
        if (msg.seat >= n) throw new RoomError('BAD_SEAT', 'No such seat');
        const slot = d.seats[msg.seat]!;
        // the host may replace a player who disconnected from the lobby
        if (slot.kind === 'human' && !this.isConnected(slot.playerId)) d.members[slot.playerId]!.seat = null;
        else if (slot.kind !== 'empty') throw new RoomError('SEAT_TAKEN', 'That seat is taken');
        d.seats[msg.seat] = { kind: 'bot', name: this.botName(), level: d.botLevel };
        break;
      }
      case 'removeBot': {
        this.requireHost(isHost);
        if (d.tournament) throw new RoomError('LOCKED', 'Tournament tables are locked');
        if (d.phase === 'playing') throw new RoomError('IN_GAME', 'Game in progress');
        if (d.seats[msg.seat]?.kind !== 'bot') throw new RoomError('BAD_SEAT', 'No bot there');
        d.seats[msg.seat] = { kind: 'empty' };
        break;
      }
      case 'config': {
        this.requireHost(isHost);
        if (d.tournament) throw new RoomError('LOCKED', 'Tournament tables are locked');
        if (d.phase === 'playing') {
          // Rule lock: anything that affects scoring / the outcome is locked until the game ends (rematch / new game
          // unlocks it). Social + pace settings (Table Talk timer, AFK kick, bot chat on/off) stay adjustable.
          if (this.changesLockedRules(msg)) throw new RoomError('RULES_LOCKED', 'House rules are locked for this game');
          if (msg.talkSec) d.talkSec = msg.talkSec;
          if (msg.afkLimit !== undefined) d.afkLimit = msg.afkLimit;
          if (msg.botTalk !== undefined) d.botTalk = msg.botTalk;
          const tt = clampRules(msg.rules).turnTimerSec;
          d.rules = { ...d.rules, turnTimerSec: { ...tt } };
          if (d.game) d.game = { ...d.game, rules: { ...d.game.rules, turnTimerSec: { ...tt } } };
          break;
        }
        let rules: TableRules;
        try {
          rules = clampRules(msg.rules);
        } catch (e) {
          if (e instanceof RoomError) throw e;
          if (e instanceof RulesConfigError) throw new RoomError('BAD_RULES', e.problems.join('; ') || 'Invalid rules');
          throw new RoomError('BAD_RULES', 'Invalid rules');
        }
        d.rules = rules;
        if (msg.talkSec) d.talkSec = msg.talkSec;
        if (msg.afkLimit !== undefined) d.afkLimit = msg.afkLimit;
        if (msg.partnerMicMute !== undefined) d.partnerMicMute = msg.partnerMicMute;
        if (msg.nukeIntensity !== undefined) d.nukeIntensity = msg.nukeIntensity;
        if (msg.talkIntensity !== undefined) d.talkIntensity = msg.talkIntensity;
        if (msg.botTalk !== undefined) d.botTalk = msg.botTalk;
        if (msg.botLevel) {
          d.botLevel = msg.botLevel;
          d.seats.forEach((s) => { if (s.kind === 'bot') s.level = msg.botLevel!; });
        }
        // seats beyond the player count are vacated
        for (let s = rules.playerCount; s < 4; s++) {
          const slot = d.seats[s]!;
          if (slot.kind === 'human') d.members[slot.playerId]!.seat = null;
          d.seats[s] = { kind: 'empty' };
        }
        break;
      }
      case 'music': {
        this.requireHost(isHost);
        const mu = msg.music;
        d.music = mu.mode === 'beat' ? { ...mu, startAt: this.io.now() + 1500 } // a beat of lead time so every client starts together
          : mu.mode === 'stream' ? { ...mu, by: pid }
          : mu;
        this.system(mu.mode === 'off' ? `${me.name} stopped the music` : mu.mode === 'link' ? `${me.name} shared what's playing` : mu.mode === 'stream' ? `${me.name} is streaming music` : `${me.name} picked the table music`);
        break;
      }
      case 'venue': {
        this.requireHost(isHost);
        if (d.phase === 'playing') throw new RoomError('IN_GAME', 'Pick the venue before the game starts');
        if ((d.venue ?? 'classic') === msg.venue) return;
        d.venue = msg.venue;
        d.venueNow = msg.venue === 'random' ? undefined : msg.venue;
        break;
      }
      case 'teamName': {
        if (!d.rules.partnerships) throw new RoomError('NO_TEAMS', 'No teams in Cutthroat');
        if (me.seat === null || me.seat >= d.rules.playerCount) throw new RoomError('NOT_SEATED', 'Sit down to name your team');
        const name = cleanTeamName(msg.name);
        if (name === null) throw new RoomError('BAD_NAME', "That team name isn't allowed");
        const side = me.seat % 2;
        const names = [...(d.teamNames ?? [null, null])];
        if ((names[side] ?? '') === name) return;
        names[side] = name || null;
        d.teamNames = names;
        this.system(name ? `${me.name} named their team “${name}”` : `${me.name} reset their team name`);
        break;
      }
      case 'start': {
        if (d.tournament) {
          if (d.phase !== 'lobby') throw new RoomError('IN_GAME', 'Game in progress');
          if (!this.allReservedSeated()) throw new RoomError('WAITING', 'Waiting for every entrant (the match starts automatically)');
          this.autostart();
          break;
        }
        this.requireHost(isHost);
        if (d.phase === 'playing') throw new RoomError('IN_GAME', 'Game in progress');
        this.startGame();
        break;
      }
      case 'rematch': {
        this.requireHost(isHost);
        if (d.tournament) throw new RoomError('LOCKED', 'Tournament matches have no rematch: check the bracket');
        if (d.phase !== 'over') throw new RoomError('WRONG_PHASE', 'The game is not over');
        this.startGame(true);
        this.talk({ kind: 'rematch' });
        break;
      }
      case 'act':
        return this.act(connId, me, msg);
      case 'next': {
        if (d.phase !== 'playing' || d.game?.phase !== 'handOver' || me.seat === null) return;
        if (!d.ready.includes(pid)) d.ready.push(pid);
        break;
      }
      case 'chat': {
        const text = maskProfanity(blockLinks(cleanText(msg.text, LIMITS.chatMax)));
        if (!text) return;
        const now = this.io.now();
        const w = (this.chatWindow.get(pid) ?? []).filter((t) => now - t < 10_000);
        const watcher = me.seat === null && d.phase !== 'lobby';
        if (w.length >= (watcher ? LIMITS.spectatorChatBurst : LIMITS.chatBurst)) throw new RoomError('RATE_LIMITED', 'Slow down a little');
        w.push(now);
        this.chatWindow.set(pid, w);
        // all chat is public. During bidding (team games) a line that reads like a count ("3-ish", "I'm weak") is
        // remembered as that player's hint, so a bot partner bidding after it can take it into account
        const g = d.game;
        if (g && d.phase === 'playing' && d.rules.partnerships && me.seat !== null && g.phase === 'bidding' && parseHint(text))
          (d.hints ??= {})[me.seat] = { hand: g.handNo, text };
        this.pushChat({ id: d.chatSeq++, from: pid, name: me.name, text, at: now, ...(watcher ? { spectator: true as const } : {}) });
        // a trailing player running their mouth (3+ lines in 10 s): the bots answer
        const ev = loudLoser(d.game, me.seat, w);
        if (ev && d.phase === 'playing') this.talk(ev);
        this.io.persist();
        return; // chat doesn't change the table state
      }
      case 'media': {
        // spectators never transmit (they watch and listen)
        me.media = me.seat === null && d.phase !== 'lobby' ? { cam: false, mic: false } : msg.media;
        break;
      }
      case 'kick': {
        if (d.tournament) throw new RoomError('LOCKED', 'No kicking at tournament tables');
        const slot = d.seats[msg.seat];
        if (!slot || slot.kind !== 'human') throw new RoomError('BAD_SEAT', 'No player there');
        const target = slot.playerId;
        if (target === pid) throw new RoomError('BAD_SEAT', "You can't kick yourself");
        if (isHost) { this.kick(target, 'host'); break; }
        if (me.seat === null) throw new RoomError('NOT_SEATED', 'Only players at the table can vote');
        const votes = (d.votes ??= {});
        const by = votes[target] ?? [];
        // a second press takes the vote back
        votes[target] = by.includes(pid) ? by.filter((x) => x !== pid) : [...by, pid];
        if (!votes[target]!.length) delete votes[target];
        else if (!by.includes(pid)) this.system(`${me.name} voted to kick ${d.members[target]!.name} (${votes[target]!.length}/${this.votesNeeded(target)})`);
        this.checkVotes();
        break;
      }
      case 'learning': {
        if (me.learning === msg.on) return;
        me.learning = msg.on;
        break;
      }
      case 'rtc': {
        // WebRTC signaling relay: between seated humans, and (Release 10) between a seated human and a spectator
        // (receive-only: spectators' media is forced off). Never spectator ↔ spectator.
        const to = d.members[msg.to];
        if (!to || (me.seat === null && to.seat === null) || ((me.seat === null || to.seat === null) && d.phase === 'lobby')) return;
        for (const [cid, p] of this.conns) if (p === msg.to) this.io.send(cid, { t: 'rtc', from: pid, data: msg.data });
        return;
      }
      case 'tableOpts': {
        this.requireHost(isHost);
        if (d.tournament) throw new RoomError('LOCKED', 'Tournament tables are locked');
        if (msg.private !== undefined) d.private = msg.private;
        if (msg.replaceBots !== undefined) d.replaceBots = msg.replaceBots;
        break;
      }
      case 'leave': {
        this.leave(pid);
        this.conns.set(connId, null);
        break;
      }
      case 'hello':
        return;
    }
    this.after();
  }

  /**
   * A game move. Order of checks:
   *  1. duplicate id (a retry of a move that was already applied) → ack ok+dup, nothing applied again
   *  2. missing or stale seq (the client didn't say which version it moved from, or the game moved on since: the
   *     turn timed out and auto-played, the hand ended, …) → silently dropped: ack stale + a fresh state, never an error.
   *     A late play must not become this seat's next lead.
   *  3. rule checks → ack with the rule error code (or an `error` message for legacy clients that send no id)
   * The DO is single-threaded, so a late human move and the turn-timer auto-play can't interleave: whichever runs
   * first bumps `seq` and the other one becomes stale (auto-play re-checks the turn key before acting).
   */
  private act(connId: string, me: Member, msg: Extract<ClientMsg, { t: 'act' }>): void {
    const d = this.data;
    const id = msg.id;
    if (id && me.acts?.includes(id)) {
      this.sendState(connId);
      this.io.send(connId, { t: 'ack', id, ok: true, dup: true });
      return;
    }
    if (msg.seq === undefined || msg.seq !== (d.seq ?? 0)) {
      this.sendState(connId);
      if (id) this.io.send(connId, { t: 'ack', id, ok: false, stale: true });
      return;
    }
    try {
      if (d.phase !== 'playing' || !d.game) throw new RoomError('WRONG_PHASE', 'No game in progress');
      if (me.seat === null) throw new RoomError('NOT_SEATED', 'You are not seated');
      const a = msg.action;
      const action: Action = a.type === 'reveal' ? { type: 'reveal', seat: me.seat }
        : a.type === 'bid' ? { type: 'bid', seat: me.seat, bid: a.bid }
        : a.type === 'exchange' ? { type: 'exchange', seat: me.seat, cards: a.cards }
        : a.type === 'runIt' ? { type: 'runIt', seat: me.seat }
        : { type: 'play', seat: me.seat, card: a.card };
      const g0 = d.game;
      const thinkMs = g0.turn === me.seat && d.turnStartedAt !== null ? Math.max(0, Math.min(120_000, this.io.now() - d.turnStartedAt - this.leadIn(g0))) : null;
      this.apply(action);
      me.timeouts = 0;
      if (thinkMs !== null && d.live && (action.type === 'bid' || action.type === 'play')) {
        const k = action.type === 'bid' ? 'bid' : 'play';
        d.live[`${k}Ms`][me.seat] = (d.live[`${k}Ms`][me.seat] ?? 0) + thinkMs;
        d.live[`${k}N`][me.seat] = (d.live[`${k}N`][me.seat] ?? 0) + 1;
      }
    } catch (e) {
      if (!id || !(e instanceof RuleError || e instanceof RoomError)) throw e;
      this.io.send(connId, { t: 'ack', id, ok: false, code: e.code, message: e.message });
      return;
    }
    if (id) me.acts = [...(me.acts ?? []).slice(-7), id];
    this.after();
    if (id) this.io.send(connId, { t: 'ack', id, ok: true });
  }

  private requireHost(isHost: boolean): void {
    if (!isHost) throw new RoomError('NOT_HOST', 'Only the host can do that');
  }

  private botName(): string {
    const used = new Set(this.data.seats.flatMap((s) => (s.kind === 'bot' ? [s.name] : [])));
    for (const m of Object.values(this.data.members)) used.add(m.name);
    // random per table from the shared pool (packages/bots/src/names.ts); stored in the seat, so every client sees
    // the same name and it survives reconnects / refreshes for the whole game
    return pickBotNames(1, used)[0]!;
  }

  private leave(pid: string): void {
    const d = this.data;
    const m = d.members[pid];
    if (!m) return;
    if (m.seat !== null) {
      // mid-game the seat goes to a bot so the others can finish; in the lobby it just opens up
      d.seats[m.seat] = d.phase === 'playing' ? { kind: 'bot', name: this.botName(), level: d.botLevel, vacated: true } : { kind: 'empty' };
    }
    delete d.members[pid];
    d.ready = d.ready.filter((x) => x !== pid);
    this.system(`${m.name} left`);
    if (d.music?.mode === 'stream' && d.music.by === pid) d.music = { mode: 'off' };
    if (d.hostId === pid) this.passHost();
  }

  /** Seated humans other than `target` who are online: a majority of them can vote `target` off. */
  private voters(target: string): string[] {
    return this.data.seats.flatMap((s) => (s.kind === 'human' && s.playerId !== target && this.isConnected(s.playerId) ? [s.playerId] : []));
  }

  private votesNeeded(target: string): number {
    return Math.floor(this.voters(target).length / 2) + 1;
  }

  /** Drops stale votes (voter left / went offline, target gone) and carries out any vote that reached a majority. */
  private checkVotes(): void {
    const d = this.data;
    if (!d.votes) return;
    for (const [target, by] of Object.entries(d.votes)) {
      const seated = d.seats.some((s) => s.kind === 'human' && s.playerId === target);
      const eligible = new Set(this.voters(target));
      const live = by.filter((x) => eligible.has(x));
      if (!seated || !live.length) { delete d.votes[target]; continue; }
      d.votes[target] = live;
      if (live.length >= this.votesNeeded(target)) this.kick(target, 'vote');
    }
  }

  /** Removes a player: a bot takes their seat mid-game, and their token can't rejoin until the next game. */
  private kick(target: string, how: 'host' | 'vote'): void {
    const d = this.data;
    const m = d.members[target];
    if (!m) return;
    if (m.seat !== null) d.seats[m.seat] = d.phase === 'playing' ? { kind: 'bot', name: this.botName(), level: d.botLevel, vacated: true } : { kind: 'empty' };
    delete d.members[target];
    if (d.votes) delete d.votes[target];
    d.ready = d.ready.filter((x) => x !== target);
    d.kicked = [...(d.kicked ?? []), m.token, ...(m.uid ? [m.uid] : [])];
    if (d.music?.mode === 'stream' && d.music.by === target) d.music = { mode: 'off' };
    this.system(how === 'host' ? `${m.name} was removed by the host${d.phase === 'playing' ? ' — a bot took their seat' : ''}` : `${m.name} was voted off the table${d.phase === 'playing' ? ' — a bot took their seat' : ''}`);
    for (const [cid, p] of this.conns) {
      if (p !== target) continue;
      this.err(cid, 'KICKED', how === 'host' ? 'The host removed you from this table' : 'The table voted to remove you');
      this.conns.delete(cid);
      this.io.close?.(cid, 4003, 'kicked');
    }
    if (d.hostId === target) this.passHost();
  }

  private passHost(): void {
    const d = this.data;
    const prev = d.hostId;
    delete d.hostAwaySince;
    const ids = Object.keys(d.members).sort((a, b) => d.members[a]!.joinedAt - d.members[b]!.joinedAt);
    d.hostId = ids.find((id) => this.isConnected(id)) ?? ids[0] ?? null;
    if (d.hostId && d.hostId !== prev) this.system(`${d.members[d.hostId]!.name} is now the host`);
  }

  /** Host's socket is gone: after a grace period (long enough for a reload), the oldest connected member takes over. */
  private considerHost(): boolean {
    const d = this.data;
    const id = d.hostId;
    const host = id ? d.members[id] : undefined;
    if (!host || !id) {
      if (d.hostAwaySince === undefined) return false;
      delete d.hostAwaySince;
      return true;
    }
    if (this.isConnected(id)) {
      if (d.hostAwaySince === undefined) return false;
      delete d.hostAwaySince;
      return true;
    }
    let marked = false;
    if (d.hostAwaySince === undefined) { d.hostAwaySince = this.io.now(); marked = true; }
    const due = d.hostAwaySince + HOST_DISCONNECT_GRACE_MS;
    if (this.io.now() < due) { this.io.setAlarm(due); return marked; }
    if (!Object.keys(d.members).some((pid) => pid !== id && this.isConnected(pid))) return marked;
    this.passHost();
    return true;
  }


  private changesLockedRules(msg: Extract<ClientMsg, { t: 'config' }>): boolean {
    const d = this.data;
    let rules: TableRules;
    try { rules = clampRules(msg.rules); }
    catch (e) {
      if (e instanceof RulesConfigError) throw new RoomError('BAD_RULES', e.problems.join('; ') || 'Invalid rules');
      return true;
    }
    let current: TableRules;
    try { current = clampRules(d.rules); } catch { return true; }
    // the turn timer is pace, not outcome: it may change mid-game (applied below)
    const norm = (r: TableRules) => JSON.stringify(sortKeys({ ...r, turnTimerSec: null }));
    if (norm(rules) !== norm(current)) return true;
    if (msg.botLevel && msg.botLevel !== d.botLevel) return true;
    if (msg.nukeIntensity !== undefined && msg.nukeIntensity !== (d.nukeIntensity ?? 'full')) return true;
    if (msg.partnerMicMute !== undefined && msg.partnerMicMute !== (d.partnerMicMute ?? false)) return true;
    if (msg.talkIntensity !== undefined && msg.talkIntensity !== (d.talkIntensity ?? 'cookout')) return true;
    return false;
  }

  private startGame(rematch = false): void {
    const d = this.data;
    const prevGame = d.game;
    const n = d.rules.playerCount;
    const seats = d.seats.slice(0, n);
    if (!d.tournament && !seats.some((s) => s.kind === 'human')) throw new RoomError('NO_PLAYERS', 'Sit down first');
    for (let s = 0; s < n; s++) if (d.seats[s]!.kind === 'empty') d.seats[s] = { kind: 'bot', name: this.botName(), level: d.botLevel };
    d.rated = this.ratedTable();
    // a rematch continues the deal rotation (one seat clockwise from the last dealer); a new game deals from a random seat
    const dealer = rematch && prevGame && prevGame.rules.playerCount === n ? nextDealer(prevGame) : undefined;
    try {
      d.game = newGame(d.rules, secureSeed(), { dealer });
    } catch (e) {
      if (e instanceof RulesConfigError) throw new RoomError('BAD_RULES', e.problems.join('; ') || 'Invalid rules');
      throw e;
    }
    // venue: a 'random' pick is rolled per game (so a rematch can land somewhere new); everyone gets the same one
    d.venueNow = (d.venue ?? 'classic') === 'random' ? rollVenue(parseInt(secureSeed().slice(0, 8), 16) / 4294967296, d.venueNow) : (d.venue ?? 'classic') as VenueId;
    d.seq = (d.seq ?? 0) + 1;
    d.phase = 'playing';
    d.ready = [];
    d.turnKey = null;
    d.deadline = null;
    d.gamesPlayed++;
    d.live = newLiveStats(n);
    this.startSeries();
    d.talk = { ...newTalkState(), revealed: [] }; // a new game: every Hustler is back in character
    d.kicked = []; // a new game: kicked players may come back
    d.votes = {};
    for (const m of Object.values(d.members)) m.timeouts = 0;
    this.system(`Game ${d.gamesPlayed} started`);
  }

  /* ---------------------------------------------------------------- game */

  private apply(action: Action): void {
    const d = this.data;
    const before = d.game!;
    d.game = applyAction(before, action);
    d.seq = (d.seq ?? 0) + 1;
    for (const ev of momentsFor(before, action, d.game)) this.talk(ev);
    d.lastActive = this.io.now();
    const fresh = d.game.handNo === before.handNo ? d.game.tricks.slice(before.tricks.length) : [];
    if (d.live) for (const t of fresh) if (t.winner !== null && t.plays.some((p) => p.seat === t.winner && p.card === 'BJ')) d.live.bj[t.winner] = (d.live.bj[t.winner] ?? 0) + 1;
    if (action.type === 'runIt') {
      const books = fresh.length;
      this.system(`🌪 ${this.seatName(action.seat)} ran the board (+${books} books)`);
      const slot = d.seats[action.seat];
      const m = slot?.kind === 'human' ? d.members[slot.playerId] : undefined;
      if (m && !(m.badges ?? []).some((b) => b.id === 'storm-chaser')) {
        m.badges = [...(m.badges ?? []), { id: 'storm-chaser', earnedAt: this.io.now(), context: { room: d.code, hand: before.handNo, books } }];
      }
    } else if (fresh.some((t) => t.plays.some((p) => p.auto))) this.system('☢ Nuked — remaining cards auto-played');
    if (d.game.phase === 'gameOver') {
      d.phase = 'over';
      const res = d.game.result!;
      this.recordSeries();
      this.reportGame();
      if (d.tournament && !d.tournament.reported) {
        d.tournament.reported = true;
        this.io.tournamentResult?.(d.tournament, [...res.finalScores], d.game.result ? placementsOf([...res.finalScores], [...res.winners]) : []);
      }
      this.system(`Game over: ${res.winners.map((w) => this.sideLabel(w)).join(' & ')} win${res.winners.length > 1 || d.rules.partnerships ? '' : 's'}`);
    }
  }

  private slowKey: string | null = null;

  private talkState(): TalkState { return (this.data.talk ??= newTalkState()); }

  private talkTable(): TalkTable {
    const d = this.data;
    const n = d.rules.playerCount;
    const seats = d.seats.slice(0, n).map((s, i) => ({ bot: s.kind === 'bot', name: s.kind === 'human' ? (d.members[s.playerId]?.name ?? 'Player') : s.kind === 'bot' ? s.name : `Seat ${i + 1}` }));
    return { seats, partnerships: d.rules.partnerships, teamNames: this.sideNames(), intensity: d.talkIntensity ?? 'cookout', jokers: d.rules.deck === 'joker54' };
  }

  /** a game moment → maybe one bot line (cooldowns live in the talk state) */
  private talk(ev: TalkEvent): void {
    const d = this.data;
    if (d.botTalk === false || d.phase === 'lobby') return;
    const line = botTalk(this.talkState(), this.talkTable(), ev, this.io.now(), Math.random);
    if (line) this.pushBotLine(line);
  }

  private pushBotLine(l: TalkLine): void {
    const d = this.data;
    this.pushChat({ id: d.chatSeq++, from: `bot:${l.seat}`, name: l.name, text: l.text, at: this.io.now(), bot: { seat: l.seat, persona: l.persona, ...(l.reveal ? { reveal: true } : {}), ...(l.line ? { line: l.line } : {}), ...(l.bid !== undefined ? { bid: l.bid } : {}) } });
  }

  /** per-seat member ids: humans by player id, bots by seat */
  private seatIds(): string[] {
    const d = this.data;
    return d.seats.slice(0, d.rules.playerCount).map((s, i) => (s.kind === 'human' ? `p:${s.playerId}` : `bot:${i}`));
  }

  /** Game start: all-bot teams get a fun name; a series whose teams changed resets (with a note). */
  private startSeries(): void {
    const d = this.data;
    const ids = this.seatIds();
    d.seriesSeats = ids;
    if (d.rules.partnerships) {
      const names = [...(d.teamNames ?? [null, null])];
      for (let side = 0; side < 2; side++) {
        const allBots = d.seats.slice(0, d.rules.playerCount).every((s, i) => i % 2 !== side || s.kind === 'bot');
        if (allBots && !names[side]) names[side] = pickTeamName(d.gamesPlayed * 7 + side * 13 + d.code.charCodeAt(0), names.filter((n): n is string => !!n));
      }
      d.teamNames = names;
    }
    const sides = seriesSides({ rules: d.rules }, ids, this.sideNames());
    const mode = d.rules.mode ?? 'mode';
    if (d.series && !seriesMatches(d.series, mode, sides)) {
      if (d.series.games.length) this.system('New series: the teams changed');
      d.series = emptySeries(mode, sides, d.series.games.length ? 'New series: the teams changed' : undefined);
    } else if (!d.series) d.series = emptySeries(mode, sides);
  }

  private sideNames(): string[] {
    const d = this.data;
    const n = d.rules.partnerships ? 2 : d.rules.playerCount;
    return Array.from({ length: n }, (_, i) => this.sideLabel(i));
  }

  private recordSeries(): void {
    const d = this.data;
    const g = d.game!;
    const ids = d.seriesSeats ?? this.seatIds();
    const names = this.sideNames();
    const sides = seriesSides({ rules: d.rules }, ids, names);
    const mode = d.rules.mode ?? 'mode';
    const no = (d.series?.games.length ?? 0) + 1;
    d.series = addSeriesGame(d.series, mode, sides, summarizeGame(g, names, no, this.io.now()));
  }

  /** Release 9: hand the finished game to the host (stats + Elo) when an account played */
  private reportGame(): void {
    const d = this.data;
    if (!this.io.gameOver || !d.game) return;
    const n = d.rules.playerCount;
    const seats: SeatRef[] = d.seats.slice(0, n).map((s, i) => {
      const side = d.rules.partnerships ? i % 2 : i;
      if (s.kind === 'human') {
        const m = d.members[s.playerId];
        return m?.uid ? { name: m.name, side, kind: 'user', uid: m.uid } : { name: m?.name ?? 'Player', side, kind: 'guest' };
      }
      return { name: s.kind === 'bot' ? s.name : `Seat ${i + 1}`, side, kind: 'bot' };
    });
    if (!seats.some((x) => x.kind === 'user')) return;
    const rec = buildRecord({ id: `${d.code}-${d.createdAt.toString(36)}-${d.gamesPlayed}`, room: d.code, game: d.game, seats, names: this.sideNames(), teamNames: d.teamNames, live: d.live, endedAt: this.io.now(), tournamentId: d.tournament?.id });
    this.io.gameOver(rec, isRated(rec, d.rules));
  }

  private sideLabel(side: number): string {
    const d = this.data;
    const seatName = (s: number) => this.seatName(s);
    return d.rules.partnerships ? (d.teamNames?.[side] || `${seatName(side)} + ${seatName(side + 2)}`) : seatName(side);
  }

  seatName(seat: number): string {
    const s = this.data.seats[seat];
    if (!s || s.kind === 'empty') return `Seat ${seat + 1}`;
    if (s.kind === 'bot') return s.name;
    return this.data.members[s.playerId]?.name ?? 'Player';
  }

  private turnKeyOf(g: GameState): string | null {
    const t = pendingTurn(g);
    if (!t) return g.phase === 'handOver' ? `h${g.handNo}:over` : null;
    return `h${g.handNo}:${g.phase}:${g.tricks.length}:${g.trick.plays.length}:${t.seat}:${g.bids.filter((b) => b !== null).length}:${g.exchange.length}`;
  }

  /** Extra pause owed before the current turn (trick just completed / fresh deal). */
  private leadIn(g: GameState): number {
    if (isFreshDeal(g)) return this.timing.dealMs; // also the books first hand, which starts straight in play
    if (g.phase === 'playing' && g.trick.plays.length === 0 && g.tricks.length > 0) {
      // a nuked trick (Big Joker over Little Joker) gets the table's fixed nuke allowance on top
      const last = g.tricks[g.tricks.length - 1]!.plays;
      const nuked = isNukeTrick(last); // either Joker order
      return this.timing.trickPauseMs + (nuked ? NUKE_ALLOWANCE_MS[this.data.nukeIntensity ?? 'full'] : 0);
    }
    return 0;
  }

  /** e2e only (TEST_HOOKS): jump the running table to a given game position (same seats), then carry on as normal */
  testLoadGame(game: GameState): void {
    const d = this.data;
    d.game = game;
    d.phase = 'playing';
    d.seq = (d.seq ?? 0) + 1;
    d.turnKey = null; d.deadline = null; d.ready = [];
    this.after();
  }

  /** Recompute timers after any change, run due bots/auto-plays, broadcast, persist. */
  private after(): void {
    this.checkVotes();
    this.considerHost();
    this.drive();
    this.broadcast();
    this.io.persist();
  }

  /** Called by timers/alarms. One bad tick must not kill the alarm loop. */
  tick(): void {
    try {
      const hostChanged = this.considerHost();
      const t = this.data.tournament;
      if (t?.autostartAt && this.data.phase === 'lobby' && this.io.now() >= t.autostartAt - 50) {
        this.autostart();
        this.after();
        return;
      }
      const changed = this.drive();
      if (changed || hostChanged) {
        this.broadcast();
        this.io.persist();
      }
    } catch (e) {
      console.error('room tick failed', e);
    }
  }

  /** Advances bots / timeouts that are due. Returns true if the state changed. */
  private drive(): boolean {
    const d = this.data;
    let changed = false;
    for (let guard = 0; guard < 400; guard++) {
      const g = d.game;
      if (d.phase !== 'playing' || !g) {
        this.clearTimers();
        return changed;
      }
      const now = this.io.now();
      const key = this.turnKeyOf(g);
      if (key !== d.turnKey) {
        d.turnKey = key;
        d.turnStartedAt = now;
        d.deadline = null;
        this.botDueAt = null;
        this.botKey = null;
        changed = true;
      }
      // Release 10: a bot claims 'Run it!' as soon as it's guaranteed from its own cards, even off-turn.
      // canRunIt is proved at most once per seat per state (and never for a spectator), so this loop stays cheap.
      if (g.phase === 'playing') {
        const claimer = d.seats.slice(0, g.rules.playerCount).findIndex((sl, i) => sl.kind === 'bot' && i !== g.turn && canRunIt(g, i as Seat));
        if (claimer >= 0) { this.apply({ type: 'runIt', seat: claimer as Seat }); changed = true; continue; }
      }
      let paused = this.humansConnected() === 0; // nobody watching: don't burn writes autoplaying
      const tour = d.tournament;
      if (tour) {
        if (!paused) delete tour.emptySince;
        else {
          tour.emptySince ??= now;
          const graceAt = tour.emptySince + (tour.fast ? 3000 : TOURNAMENT_EMPTY_GRACE_MS);
          if (now < graceAt) { this.io.setAlarm(graceAt); return changed; }
          // nobody came back: bots play the match out instantly (the bracket must keep moving)
          paused = false;
          if (g.phase === 'handOver') { this.nextHand(); changed = true; continue; }
          const tt = pendingTurn(g);
          if (!tt) return changed;
          const sl = d.seats[tt.seat]!;
          this.autoAct(tt.seat, sl.kind === 'bot' ? sl.level : 'normal');
          changed = true;
          if (guard === 399) this.io.wake(10);
          continue;
        }
      }

      if (g.phase === 'handOver') {
        const humans = d.seats.filter((s): s is Extract<SeatSlot, { kind: 'human' }> => s.kind === 'human' && this.isConnected(s.playerId));
        if (humans.length > 0 && humans.every((h) => d.ready.includes(h.playerId))) {
          this.nextHand();
          changed = true;
          continue;
        }
        if (paused) { d.deadline = null; d.turnKey = null; this.io.setAlarm(null); return changed; }
        // after 'Run it!' the clients play the tornado first: Table Talk gets that much longer
        const ran = g.tricks.at(-1)?.plays.some((p) => p.run) ? RUN_FX_MS : 0;
        // clients hold Table Talk until the hand's hype effects finish (≤ HAND_END_HOLD_MS): the countdown starts after that
        d.deadline ??= now + (d.talkSec ? d.talkSec * 1000 : this.timing.handOverMs) + ran + (this.timing.handEndHoldMs ?? HAND_END_HOLD_MS);
        if (now >= d.deadline) { this.nextHand(); changed = true; continue; }
        this.io.setAlarm(d.deadline);
        return changed;
      }

      const turn = pendingTurn(g);
      if (!turn) return changed;
      const slot = d.seats[turn.seat]!;
      const leadIn = this.leadIn(g);

      if (paused) {
        // nobody is connected: freeze the table (no bot moves, no timers) until someone comes back
        if (d.deadline !== null) { d.deadline = null; changed = true; }
        d.turnKey = null; // the clock restarts when someone reconnects
        this.botKey = null;
        this.io.setAlarm(null);
        return changed;
      }

      if (slot.kind === 'bot' || slot.kind === 'empty') {
        d.deadline = null;
        if (this.botKey !== key) {
          this.botKey = key;
          this.botDueAt = Math.max(now, (d.turnStartedAt ?? now) + leadIn + this.timing.botMs);
          // sometimes a bot talks before it plays (never a tell: the line doesn't see its cards), then a short beat
          if (turn.kind === 'play' && slot.kind === 'bot' && d.botTalk !== false) {
            const line = prePlayLine(this.talkState(), this.talkTable(), turn.seat, now, Math.random);
            if (line) { this.pushBotLine(line); this.botDueAt += 900; changed = true; }
          }
        }
        if (now >= this.botDueAt!) {
          this.autoAct(turn.seat, slot.kind === 'bot' ? slot.level : d.botLevel);
          changed = true;
          continue;
        }
        this.io.wake(this.botDueAt! - now);
        return changed;
      }

      // a human's turn (Release 9: bot partners no longer post typed bidding hints; partners talk out loud over open mics)
      const timerMs = (turn.kind === 'bid' ? d.rules.turnTimerSec.bid : d.rules.turnTimerSec.play) * 1000 * (d.members[slot.playerId]?.learning ? LEARNING_TIMER : 1);
      const full = (d.turnStartedAt ?? now) + leadIn + timerMs;
      const connected = this.isConnected(slot.playerId);
      const want = connected ? full : Math.min(full, now + this.timing.disconnectGraceMs);
      // the deadline only ever moves earlier for a turn (a disconnect shortens it; a reconnect doesn't extend it)
      if (d.deadline === null || want < d.deadline) { d.deadline = want; changed = true; }
      // a slow human gets roasted once per turn (bots only)
      const slowAt = (d.turnStartedAt ?? now) + leadIn + Math.max(12_000, timerMs * 0.6);
      if (this.slowKey !== key && now >= slowAt && now < d.deadline) { this.slowKey = key; this.talk({ kind: 'slow', them: turn.seat }); changed = true; }
      else if (this.slowKey !== key && slowAt < d.deadline) this.io.wake(Math.max(50, slowAt - now));
      if (now >= d.deadline) {
        this.autoAct(turn.seat, 'normal');
        this.system(`${this.seatName(turn.seat)} ran out of time`);
        this.countTimeout(slot.playerId, turn.seat);
        changed = true;
        continue;
      }
      this.io.setAlarm(d.deadline);
      return changed;
    }
    return changed;
  }

  /** AFK: after `afkLimit` timeouts in a row a bot takes the seat; the player stays at the table and can sit again. */
  private countTimeout(pid: string, seat: number): void {
    const d = this.data;
    const m = d.members[pid];
    if (!m) return;
    m.timeouts = (m.timeouts ?? 0) + 1;
    const limit = d.afkLimit ?? DEFAULT_AFK_LIMIT;
    if (!limit || m.timeouts < limit || d.seats[seat]?.kind !== 'human') return;
    const bot = this.botName();
    d.seats[seat] = { kind: 'bot', name: bot, level: d.botLevel };
    m.seat = null;
    m.timeouts = 0;
    if (d.votes) delete d.votes[pid];
    this.system(`${m.name} was AFK and replaced by a bot (${bot})`);
  }

  private clearTimers(): void {
    this.data.deadline = null;
    this.data.turnKey = null;
    this.botDueAt = null;
    this.botKey = null;
    this.io.setAlarm(null);
  }

  private nextHand(): void {
    const d = this.data;
    d.game = applyAction(d.game!, { type: 'nextHand' });
    d.seq = (d.seq ?? 0) + 1;
    d.ready = [];
    d.deadline = null;
  }

  /** Bot logic plays for `seat` (a bot, or a human who ran out of time). */
  private autoAct(seat: number, level: BotLevel): void {
    const d = this.data;
    const view = viewFor(d.game!, seat);
    // Mixed skill rolls per seat from the game seed (stable across reconnects); persona floors (the Hustler is Pro+)
    const slot0 = d.seats[seat];
    const skill = slot0?.kind === 'bot' ? botSkillFor(level, d.game!.seed, seat, slot0.name) : seatSkill(level, d.game!.seed, seat);
    const mate = d.rules.partnerships ? (seat + 2) % d.rules.playerCount : -1;
    const h = mate >= 0 ? d.hints?.[mate] : undefined;
    const hint = h && h.hand === d.game!.handNo && d.seats[mate]?.kind === 'human' ? parseHint(h.text) : null;
    let action = chooseBotAction(view, skill, undefined, hint);
    if (!action) return;
    // persona lean (bots only): a slight bid nudge / Nil reluctance; illegal nudges fall through to the catch below
    const slot = d.seats[seat];
    if (slot?.kind === 'bot' && action.type === 'bid') {
      const revealed = (d.talk?.revealed ?? []).includes(seat);
      if (typeof action.bid === 'number') action = { ...action, bid: leanBid(action.bid, slot.name, revealed, Math.random) };
      else if (action.bid === 'nil' && leanNil(slot.name, Math.random)) action = { ...action, bid: 1 };
      try { applyAction(d.game!, action); } catch { action = chooseBotAction(view, skill, undefined, hint)!; }
    }
    try {
      this.apply(action);
    } catch {
      // never get stuck: fall back to the first legal card / minimum bid
      const v = viewFor(d.game!, seat);
      action = v.phase === 'playing' ? { type: 'play', seat, card: v.legal[0]! }
        : v.phase === 'bidding' ? (v.hand === null ? { type: 'reveal', seat } : { type: 'bid', seat, bid: v.bidOptions?.min ?? 1 })
        : { type: 'exchange', seat, cards: (v.hand ?? []).slice(0, v.exchange[0]?.count ?? 0) };
      this.apply(action);
    }
  }

  /* --------------------------------------------------------------- output */

  roomInfo(): RoomInfo {
    const d = this.data;
    const seats: SeatInfo[] = d.seats.slice(0, d.rules.playerCount).map((s) => {
      if (s.kind === 'empty') return { kind: 'empty' };
      if (s.kind === 'bot') return { kind: 'bot', name: s.name, level: s.level };
      const m = d.members[s.playerId];
      return { kind: 'human', playerId: s.playerId, name: m?.name ?? 'Player', connected: this.isConnected(s.playerId), media: m?.media ?? { cam: false, mic: false } };
    });
    return {
      code: d.code, hostId: d.hostId ?? '', phase: d.phase, rules: d.rules, botLevel: d.botLevel, seats,
      members: Object.entries(d.members).map(([playerId, m]) => ({ playerId, name: m.name, connected: this.isConnected(playerId), seat: m.seat })),
      deadline: d.deadline, ready: [...d.ready], rev: d.rev, seq: d.seq ?? 0, game: d.gamesPlayed, now: this.io.now(),
      talkSec: d.talkSec ?? Math.round(this.timing.handOverMs / 1000), afkLimit: d.afkLimit ?? DEFAULT_AFK_LIMIT, partnerMicMute: d.partnerMicMute ?? false, nukeIntensity: d.nukeIntensity ?? 'full', talkIntensity: d.talkIntensity ?? 'cookout', botTalk: d.botTalk ?? true,
      venue: d.venue ?? 'classic', ...(d.venueNow ? { venueNow: d.venueNow } : {}),
      teamNames: d.rules.partnerships ? [...(d.teamNames ?? [null, null])] : undefined, series: d.series ?? null, revealed: [...(d.talk?.revealed ?? [])],
      ...(d.tournament ? { tournament: { id: d.tournament.id, name: d.tournament.name, match: d.tournament.match, autostartAt: d.tournament.autostartAt, reserved: d.tournament.reserved.map((r) => r?.name ?? null) } } : {}),
      private: !!d.private, replaceBots: this.replaceBotsOn(), takeable: this.takeable(),
      spectators: d.phase === 'lobby' ? [] : Object.entries(d.members).filter(([id, m]) => m.seat === null && this.isConnected(id)).map(([playerId, m]) => ({ playerId, name: m.name })),
      ...(d.votes && Object.keys(d.votes).length ? { votes: Object.entries(d.votes).map(([target, by]) => ({ target, by: [...by], need: this.votesNeeded(target) })) } : {}), ...(d.music && d.music.mode !== 'off' ? { music: d.music } : {}),
    };
  }

  /** per connection: the hand-history length it already has (history is only re-sent when it grows) */
  private sentHistory = new Map<string, string>();

  private broadcast(): void {
    const d = this.data;
    d.rev++;
    const room = this.roomInfo();
    for (const cid of this.conns.keys()) this.sendState(cid, room);
    this.io.listing?.(this.listing(room));
  }

  /** Release 10: seats a spectator may take right now (mid-game, not at a tournament table) */
  takeable(): number[] {
    const d = this.data;
    if (d.phase !== 'playing' || d.tournament || !d.game) return [];
    const bots = this.replaceBotsOn();
    return d.seats.slice(0, d.rules.playerCount).flatMap((s, i) => (s.kind === 'bot' && (s.vacated || bots) ? [i] : []));
  }

  /** Release 10: the Open tables entry (null = not listed: private, or nobody connected) */
  listing(room: RoomInfo = this.roomInfo()): OpenTable | null {
    const d = this.data;
    if (d.private) return null;
    const humans = room.seats.filter((s) => s.kind === 'human').length;
    if (!d.seats.some((s) => s.kind === 'human' && this.isConnected(s.playerId)) && !Object.keys(d.members).some((id) => this.isConnected(id))) return null;
    const open = d.phase === 'lobby' ? room.seats.filter((s) => s.kind === 'empty').map((_, i) => i) : room.takeable ?? [];
    const firstOpen = d.phase === 'lobby' ? room.seats.findIndex((s) => s.kind === 'empty') : (room.takeable ?? [])[0] ?? -1;
    const spectators = room.spectators?.length ?? 0;
    return {
      code: d.code, host: d.hostId ? d.members[d.hostId]?.name ?? '' : '', mode: d.rules.mode, playerCount: d.rules.playerCount,
      target: d.rules.targetScore, venue: d.venueNow ?? (d.venue && d.venue !== 'random' ? d.venue : d.venue ?? 'classic'),
      humans, bots: room.seats.filter((s) => s.kind === 'bot').length, open: d.tournament ? 0 : open.length,
      status: d.phase === 'lobby' ? 'waiting' : d.phase === 'playing' ? 'playing' : 'over',
      ...(d.phase === 'playing' && d.game ? { hand: d.game.handNo } : {}),
      spectators, ...(spectators >= LIMITS.spectators ? { watchFull: true } : {}),
      ...(d.tournament ? { tournament: d.tournament.name ?? 'Tournament' } : {}),
      ...(firstOpen >= 0 && !d.tournament ? { seat: firstOpen } : {}),
      at: this.io.now(),
    };
  }

  /** The current state as one connection may see it (its own seat's view only). */
  private sendState(cid: string, room: RoomInfo = this.roomInfo()): void {
    const d = this.data;
    const pid = this.conns.get(cid);
    if (!pid) return;
    const seat = d.members[pid]?.seat ?? null;
    // Release 10: spectators (unseated mid-game) get the redacted table view: never a single card of any hand
    const watching = seat === null && !!d.game && d.phase !== 'lobby';
    let view: PlayerView | null = d.game && seat !== null && seat < d.rules.playerCount ? viewFor(d.game, seat) : watching ? spectatorView(d.game!, 0) : null;
    if (view) {
      // the hand history only changes once per hand: send it then, and `history: null` ("unchanged") otherwise
      const key = `${room.game}:${view.history.length}`;
      if (this.sentHistory.get(cid) === key) view = { ...view, history: null as unknown as PlayerView['history'] };
      else this.sentHistory.set(cid, key);
    }
    this.io.send(cid, watching ? { t: 'state', room, seat, view, spectator: true } : { t: 'state', room, seat, view });
  }

  private system(text: string): void {
    this.pushChat({ id: this.data.chatSeq++, from: null, name: 'System', text, at: this.io.now(), system: true });
  }

  private pushChat(line: ChatLine): void {
    const d = this.data;
    d.chat.push(line);
    if (d.chat.length > LIMITS.chatHistory) d.chat.splice(0, d.chat.length - LIMITS.chatHistory);
    for (const [cid, pid] of this.conns) if (pid) this.io.send(cid, { t: 'chat', line });
  }

  private err(connId: string, code: string, message: string): void {
    this.io.send(connId, { t: 'error', code, message });
  }

  /** Reply to the message that failed. An in-flight `act` gets an ack so the client unlocks its hand. */
  private failMessage(connId: string, msg: ClientMsg | null, e: unknown): void {
    let code = 'INTERNAL';
    let text = 'Something went wrong';
    if (e instanceof RuleError || e instanceof RoomError) { code = e.code; text = e.message; }
    else console.error('room message failed', e);
    if (msg?.t === 'act' && msg.id) {
      this.io.send(connId, { t: 'ack', id: msg.id, ok: false, code, message: text });
      return;
    }
    this.err(connId, code, text);
  }

  /** Public summary for the join screen (no secrets). */
  summary() {
    const d = this.data;
    return {
      code: d.code, phase: d.phase, mode: d.rules.mode, playerCount: d.rules.playerCount,
      seats: this.roomInfo().seats.map((s) => (s.kind === 'human' ? { kind: s.kind, name: s.name } : s.kind === 'bot' ? { kind: s.kind, name: s.name } : { kind: s.kind })),
      host: d.hostId ? d.members[d.hostId]?.name ?? null : null,
    };
  }
}

export class RoomError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
  }
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}
