/**
 * The game room: everything a Table Durable Object does, minus the Cloudflare plumbing, so it can be
 * unit-tested with mock sockets and a fake clock. The server is the referee (spec §4.2):
 *  - it shuffles/deals (packages/rules), validates every bid/play, and only ever sends a seat its own view;
 *  - bots (packages/bots) fill empty seats and play from that seat's view only;
 *  - human turns have a deadline from that table's timer; a disconnect waits the same length
 *    (not a fixed 10s) and then the bot logic plays that turn. The seat stays the human's unless they explicitly leave;
 *  - all durable state lives in one plain-JSON `RoomData` object that the DO saves as a single row.
 */
import {
  type Action, type GameHandLog, type GameState, type Series, addSeriesGame, emptySeries, seriesForGameStart, seriesMatches, seriesSides, summarizeGame, type PlayerView, type TableRules, RuleError, RulesConfigError, acceptRules, applyAction, canRunIt, runPlayout, type Seat, spectatorView, HandLogBuilder, isFreshDeal, isNukeTrick, nukeArmed, nextDealer, makeRules, newGameUndealt, dealFirstHand, pendingTurn, secureSeed, throwInOpen, viewFor, withCompleteNil,
} from '@spades/rules';
import { voiceGender } from '@spades/bots';
import { BUCKET_THIN } from './voice/writer';
import { type TalkEvent, type TalkLine, type TalkState, type TalkTable, botTalk, chooseBotAction, loudLoser, parseHint, leanBid, botSkillFor, personaSkillFloor, seatSkill, leanNil, momentsFor, newTalkState, pickBotNames, platePersona, prePlayLine, activeCatalog, bucketFor } from '@spades/bots';
import {
  type BotLevel, type ChatLine, type ClientMsg, type HostMusic, type MediaState, type RoomInfo, type RoomPhase, type RunPlayback, type SeatInfo, type ServerMsg,
  DEFAULT_AFK_LIMIT, LIMITS, PROTOCOL_VERSION, parseClientMsg, toggleReaction,
  HAND_END_HOLD_MS, NUKE_ALLOWANCE_MS, handEndLeadMs, type NukeIntensity, type TalkIntensity, cleanTeamName, pickTeamName, type VenueChoice, type VenueId, rollVenue,
} from '@spades/protocol';
import type { OpenTable } from '@spades/protocol';
import { blockLinks, cleanName, cleanText, maskProfanity } from './filter';
import { type GameRecord, type LiveStats, type SaveMeta, type SeatRef, abandonedRecord, buildRecord, isRated, newLiveStats, placementsOf } from './stats/record';
import { type HighlightEvent, handHighlights, trickHighlights } from './stats/highlights';

export const ROOM_DATA_VERSION = 1;

export type SeatSlot =
  | { kind: 'empty' }
  /** vacated: a bot that took over from a player who left / was kicked / went AFK (always open to spectators).
   *  replacedPid: the member who still owns this seat after a disconnect. A reconnect reclaims it; a leave does not set this. */
  | { kind: 'bot'; name: string; level: BotLevel; vacated?: boolean; /** display name of the human this bot replaced */ was?: string; replacedPid?: string }
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
  /** Browser guest id. A reload that minted a new seat token is still this member. */
  gid?: string;
  /** Epoch ms of the last socket drop. The disconnect grace is measured from here, not from each tick. */
  disconnectedAt?: number;
  /** False while this client's table is still drawing. Unset means an older client: the clock may run. */
  interactive?: boolean;
  /** Epoch ms when the loader started holding this player's turn clock. */
  loaderSince?: number;
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
  /** `seq` when this turn began. A play from earlier than this belongs to a previous turn. */
  turnSeq?: number;
  deadline: number | null;
  /** Pre-deal setup window: epoch ms when the current game's first hand deals.
   *  Set by startGame (the game is created undealt); cleared when the deal lands. */
  dealAt?: number | null;
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
  /** Kept for older clients. Timeouts are counted; they never hand the seat to a bot. */
  afkLimit?: number;
  /** host option: partner voice limiting during trick play (from the first card led); unset = off */
  partnerMicMute?: boolean;
  nukeIntensity?: NukeIntensity;
  talkIntensity?: TalkIntensity;
  /** host flag: pre-voiced AI catalog lines (default off); also gates the Voice (c) line writer */
  aiTalk?: boolean;
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
  /** Cutthroat players eliminated this game. They can watch, and they cannot sit again until the next game. */
  outPlayers?: string[];
  /** Seat each eliminated human left, so a finished game still records the account that played it. */
  outSeats?: { playerId: string; seat: number }[];
  /** open vote-kicks: target player id → voter ids */
  votes?: Record<string, string[]>;
  gamesPlayed: number;
  /** Release 9: per-seat counters for the current game (think times, Big Joker wins) */
  live?: LiveStats;
  /** Release 9b: this table runs a tournament match */
  tournament?: TournamentSeat;
  /** Big Bank Take Lil Bank: this table runs a wager match */
  challenge?: ChallengeSeat;
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
  /**
   * When the current bot turn should move (epoch ms). Saved with the row so a hibernated table
   * still knows the deadline; the in-memory wake alone does not survive.
   */
  botDueAt?: number | null;
  /** latched when a game starts: this deal counts for Elo, so a leaver doesn't open their seat to a guest */
  rated?: boolean;
  /** this deal was already written as abandoned (leave, replacement, or expiry) */
  abandonReported?: boolean;
  /**
   * The Run it! just resolved, in real seats. Broadcast with every state until the next hand
   * so a client that missed the claim frame can still play the remaining tricks.
   */
  runPlayback?: RunPlayback;
  /**
   * Hand-history log for testing (Demetrius 2026-10-19): the ground truth of the current
   * game — every hand's deal, actions, tricks and run-claim detail. Served at
   * GET /api/tables/<code>/handlog to admins and account holders at the table.
   * Reset when a new game starts.
   */
  handLog?: GameHandLog;
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

/** Big Bank Take Lil Bank: this table plays one wager match (rules locked, seats reserved for the four players, NO bot fill — coins are escrowed). */
export interface ChallengeSeat {
  id: string;
  /** per seat: the account that owns it (challenge tables always reserve all four seats) */
  reserved: ({ uid: string; name: string } | null)[];
  autostartAt: number | null;
  reported?: boolean;
  /** each side's team name from challenge setup ([side 0, side 1]); seeds the room's team names */
  teamNames?: [string | null, string | null];
}

/** Big Bank: how a wager match ended, reported exactly once to the Challenge DO, which settles the escrow. */
export type ChallengeResult =
  | { kind: 'played'; scores: number[]; places: number[]; gameId: string }
  | { kind: 'noshow'; shown: string[] }
  | { kind: 'abandoned'; leaverUid: string | null };

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
  /** extra Table Talk lead-in so the countdown starts as the score screen opens (default HAND_END_HOLD_MS; tests use 0) */
  handEndHoldMs?: number;
  /** pre-deal setup window before a game's first hand (default PRE_DEAL_MS; tests use 0 for instant deals) */
  preDealMs?: number;
}

/** learning mode (a player with tips on): their own turn timer runs this much longer */
export const LEARNING_TIMER = 1.5;
/** tournament table with nobody connected: play the match out after this long */
export const TOURNAMENT_EMPTY_GRACE_MS = 90_000;
/** seated host dropped without leaving: pass host after this long so the table can still start or rematch */
export const HOST_DISCONNECT_GRACE_MS = 30_000;
export const DEFAULT_TIMING: RoomTiming = { botMs: 750, trickPauseMs: 1300, dealMs: 3200, disconnectGraceMs: 10_000, handOverMs: 20_000 };
/** A loader that never reports ready must not freeze the table. Matches the client's give-up. */
export const LOADER_HOLD_MAX_MS = 45_000;
/**
 * Pre-deal setup window (owner, 2026-10-20): cards do NOT deal the instant a game
 * starts. The room creates the game undealt and holds the first deal this long —
 * the versus intro dismisses, the table is fully loaded and visible, and players
 * get a real window to set cameras/mics before anyone sees a card. Server-held so
 * every seat's deal (and the 30s bid clock behind it) starts at the same moment.
 */
export const PRE_DEAL_MS = 8000;
/**
 * After a bot's scheduled delay, this much longer with the turn still unmoved means the brain
 * did not resolve it. The server then plays a legal bid or card itself.
 */
export const BOT_WATCHDOG_MS = 5_000;

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
  /** Release 9: a finished game with at least one signed-in player (DO: write stats/Elo to D1). meta marks an abandon. */
  gameOver?(rec: GameRecord, rated: boolean, meta?: SaveMeta): void;
  /** League data wave (6b): a live highlight resolved at this table (nuke / Boston / made nil / Wheels). The DO stores it for the ticker (and wires marquee ones to global chat). */
  highlight?(ev: HighlightEvent): void;
  /** Release 9b: a tournament match finished (per side: final score and placement, 1 = won) */
  tournamentResult?(t: TournamentSeat, scores: number[], places: number[]): void;
  /** Big Bank: a wager match resolved (played out, a no-show at the start deadline, or abandoned mid-match) */
  challengeResult?(c: ChallengeSeat, r: ChallengeResult): void;
  /** Release 10: this table's Open tables entry (null = unlisted); called after every broadcast, the DO dedups */
  listing?(t: OpenTable | null): void;
  /** Voice (c): a persona's catalog bucket for a set/Wheels/win moment is thin; the DO runs the writer in waitUntil */
  voiceMiss?(req: import('./voice/writer').WriterRequest): void;
  /** Push: a new bid/play turn began for `seat` (the DO notifies the player when they have no live socket). */
  turnBegan?(seat: number, kind: 'bid' | 'play'): void;
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
  /** emoji-reaction rate limiter: pid → timestamps (10 s window) */
  private reactWindow = new Map<string, number[]>();
  /**
   * Tests only. The next N times a bot is due, the brain is skipped so the turn stays put
   * and the watchdog has to play a legal card or bid.
   */
  stallsLeft = 0;
  /** Wraps `data.handLog`; rebuilt lazily after hibernation. */
  private logBuilder: HandLogBuilder | null = null;

  constructor(public data: RoomData, private io: RoomIO, private timing: RoomTiming = DEFAULT_TIMING) {
    data.seq ??= 0;
  }

  /** One JSON line per table event. Wrangler tail and Workers logs can filter `src=bwm.table`. */
  private trace(event: string, fields: Record<string, unknown>): void {
    console.log(JSON.stringify({ src: 'bwm.table', event, table: this.data.code, at: this.io.now(), ...fields }));
  }

  /** The Durable Object calls this before `close`, while the socket is still bound. */
  noteSocketClose(connId: string, code: number, reason: string, wasClean: boolean): void {
    const pid = this.conns.get(connId) ?? null;
    const m = pid ? this.data.members[pid] : undefined;
    let others = 0;
    if (pid) for (const [cid, p] of this.conns) if (p === pid && cid !== connId) others++;
    this.trace('socket_close', {
      cid: connId, code, reason: reason.slice(0, 120), wasClean, pid, seat: m?.seat ?? null, name: m?.name ?? null, otherSockets: others,
    });
  }

  /* ------------------------------------------------------------ connections */

  /** Re-register a connection that survived hibernation (DO wake-up). A null id must not wipe a live binding. */
  restoreConnection(connId: string, playerId: string | null): void {
    if (playerId && this.data.members[playerId]) {
      this.conns.set(connId, playerId);
      return;
    }
    if (!this.conns.has(connId)) this.conns.set(connId, null);
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
    // The grace starts when the last socket actually drops. A second socket for this
    // player returns above, so a reload is not a leave and does not start a new grace.
    if (m) m.disconnectedAt = this.io.now();
    if (m && m.seat === null) {
      // an unseated member who dropped, in any phase: forget them so they don't fill the table.
      // A seat held by their replacement bot is not forgotten — the reconnect reclaims it.
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

  /** Big Bank: turn a fresh table into a wager match. Private, rules locked, no bots ever. */
  setupChallenge(c: ChallengeSeat, rules: TableRules): void {
    const d = this.data;
    d.rules = clampRules(rules);
    d.challenge = { ...c, reported: false };
    d.private = true;
    d.botLevel = 'mixed';
    d.seats = Array.from({ length: 4 }, () => ({ kind: 'empty' as const }));
    // the captains named their sides at challenge setup — seed the room with
    // those names (players can still rename from the table lobby)
    d.teamNames = c.teamNames ? [cleanTeamName(c.teamNames[0] ?? '') || null, cleanTeamName(c.teamNames[1] ?? '') || null] : undefined;
    if (c.autostartAt) this.io.setAlarm(c.autostartAt);
    this.system('Big Bank match: seats are reserved for the four players; the game starts automatically');
    this.io.persist();
  }

  /** a member whose account owns a reserved seat sits there */
  private seatReserved(pid: string): void {
    const d = this.data;
    const t = d.tournament ?? d.challenge;
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
    if (d.phase === 'lobby' && this.allReservedSeated()) {
      if (d.challenge) this.challengeBegin();
      else this.autostart();
    }
  }

  private allReservedSeated(): boolean {
    const d = this.data;
    const t = (d.tournament ?? d.challenge)!;
    return t.reserved.slice(0, d.rules.playerCount).every((r, i) => !r || (d.seats[i]?.kind === 'human' && this.isConnected((d.seats[i] as { playerId: string }).playerId)));
  }

  /** Big Bank: all four players are seated — start now, ahead of the grace deadline. */
  private challengeBegin(): void {
    const d = this.data;
    const c = d.challenge!;
    if (d.phase !== 'lobby') return;
    c.autostartAt = null;
    this.startGame();
  }

  /**
   * Big Bank: the seat grace deadline passed. All four present → the match starts.
   * Anyone missing → the match is called off and the Challenge DO settles the escrow
   * from exactly who showed. A wager match is never bot-filled.
   */
  private challengeDeadline(): void {
    const d = this.data;
    const c = d.challenge!;
    if (d.phase !== 'lobby') return;
    c.autostartAt = null;
    const shown: string[] = [];
    let all = true;
    for (let i = 0; i < d.rules.playerCount; i++) {
      const r = c.reserved[i];
      if (!r) continue;
      const s = d.seats[i];
      if (s?.kind === 'human' && this.isConnected(s.playerId) && d.members[s.playerId]?.uid === r.uid) shown.push(r.uid);
      else all = false;
    }
    if (all) { this.startGame(); return; }
    d.phase = 'over';
    c.reported = true;
    this.system(shown.length ? 'No-show: the Big Bank match is called off' : 'Nobody showed up: the Big Bank match is called off');
    this.io.challengeResult?.(c, { kind: 'noshow', shown });
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
      if (d.seats[i]!.kind === 'empty') d.seats[i] = { kind: 'bot', name: r ? `${r.name} (bot)`.slice(0, 20) : this.botName(), level: 'pro', ...(r ? { was: r.name } : {}) };
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

  private kickedOut(token?: string, uid?: string, gid?: string): boolean {
    const k = this.data.kicked ?? [];
    return (!!token && k.includes(token)) || (!!uid && k.includes(uid)) || (!!gid && this.gidOk(gid) && k.includes(gid));
  }

  /** Same shape the browser mints for `bwm.social.guest`. */
  private gidOk(gid: string): boolean {
    return /^[A-Za-z0-9_-]{8,64}$/.test(gid);
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

  /** A bot is keeping this member's seat until they reconnect. */
  private seatHeld(pid: string): boolean {
    return this.data.seats.some((s) => s.kind === 'bot' && s.replacedPid === pid);
  }

  /** forget disconnected unseated members (they must not hold a member or spectator slot) */
  private dropGhosts(): void {
    const d = this.data;
    for (const [id, m] of Object.entries(d.members)) {
      if (m.seat !== null || this.isConnected(id) || this.seatHeld(id)) continue;
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
      d.seats[drop.seat] = d.phase === 'playing' ? this.botSeat(drop.name) : { kind: 'empty' };
    }
    for (const [cid, p] of this.conns) if (p === dropId) this.conns.set(cid, keepId);
    if (d.hostId === dropId) d.hostId = keepId;
    if (d.hostId && this.isConnected(d.hostId)) delete d.hostAwaySince;
    keep.gid ??= drop.gid;
    delete d.members[dropId];
    keep.uid = uid;
    // The name already on the kept member stays. A second hello must not rename the seat.
    this.seatReserved(keepId);
  }

  /** signed-in players on at least two sides: this seating would count for Elo (a guest does not) */
  private ratedTable(): boolean {
    const d = this.data;
    const n = d.rules.playerCount;
    const sides = new Set<number>();
    for (let i = 0; i < n; i++) {
      const s = d.seats[i];
      if (s?.kind !== 'human' || !d.members[s.playerId]?.uid) continue;
      sides.add(d.rules.partnerships ? i % 2 : i);
    }
    return sides.size >= 2;
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
    const gid = msg.gid && this.gidOk(msg.gid) ? msg.gid : undefined;
    if (this.kickedOut(msg.token, uid, gid)) {
      this.trace('reconnect', { cid: connId, how: 'kicked', name });
      this.rejectKick(connId);
      return;
    }
    // same seat token, same account, or the same browser guest (a reload can mint a new token)
    let how: 'token' | 'uid' | 'gid' | 'new' = 'new';
    let pid = msg.token ? Object.keys(d.members).find((id) => d.members[id]!.token === msg.token) : undefined;
    if (pid && uid && d.members[pid]!.uid && d.members[pid]!.uid !== uid) pid = undefined;
    if (pid) how = 'token';
    if (!pid && uid) {
      pid = Object.keys(d.members).find((id) => d.members[id]!.uid === uid);
      if (pid) how = 'uid';
    }
    if (!pid && gid) {
      pid = Object.keys(d.members).find((id) => {
        const m = d.members[id]!;
        return m.gid === gid && !(uid && m.uid && m.uid !== uid);
      });
      if (pid) how = 'gid';
    }
    const returning = !!pid && !this.isConnected(pid);
    if (pid) {
      const m = d.members[pid]!;
      // The name stuck at the first hello. A reconnect, a second tab, or an account
      // username must not rewrite the scoreboard.
      if (!m.name) m.name = name;
      if (gid && !m.gid) m.gid = gid;
      if (uid) m.uid = uid;
      delete m.disconnectedAt;
      m.timeouts = 0;
      if (d.hostId === pid) delete d.hostAwaySince;
      // A new socket draws the table again, even when the previous one has not closed yet.
      // Hold this player's clock until that client says it can act, so a reload cannot
      // auto-play a card behind the loader.
      if (d.phase === 'playing') {
        m.interactive = false;
        m.loaderSince = this.io.now();
        const turn = d.game ? pendingTurn(d.game) : null;
        if (turn && m.seat === turn.seat) d.deadline = null;
      }
      // Bind the new socket BEFORE dropping the old one. Closing the old socket can
      // re-enter close() (the DO restores the dying socket). If this socket is not
      // bound yet, that re-entry looks like the player left and the turn clock starts
      // the disconnect grace — the path that hands the seat to a bot.
      this.conns.set(connId, pid);
      for (const [cid, p] of this.conns) if (p === pid && cid !== connId) { this.conns.delete(cid); this.io.close?.(cid, 4000, 'replaced'); }
    } else {
      const { members, watching } = this.liveCounts();
      if (members >= LIMITS.members || (d.phase !== 'lobby' && watching >= LIMITS.spectators)) {
        this.trace('reconnect', { cid: connId, how: 'full', name });
        this.err(connId, 'TABLE_FULL', 'This table is full');
        this.io.close?.(connId, 4001, 'full');
        return;
      }
      pid = this.io.randomId().slice(0, 12);
      // honor a client-minted token so a second tab that stored it first lands in this same member
      const tokenTaken = !!msg.token && Object.values(d.members).some((m) => m.token === msg.token);
      const token = msg.token && this.tokenOk(msg.token) && !tokenTaken ? msg.token : this.io.randomId();
      d.members[pid] = { name, token, seat: null, media: { cam: false, mic: false }, joinedAt: this.io.now(), ...(uid ? { uid } : {}), ...(gid ? { gid } : {}) };
      if (!d.hostId || !d.members[d.hostId]) d.hostId = pid;
      this.system(`${name} joined`);
      this.conns.set(connId, pid);
    }
    // token matched a different body than the account already seated here: fold them into one member
    if (uid && Object.keys(d.members).some((id) => id !== pid && d.members[id]!.uid === uid)) {
      this.claimAccount(pid, uid);
      pid = this.conns.get(connId) ?? pid;
    }
    // A bot that took the seat during the disconnect grace gives it back. Never leave them watching.
    this.reclaimSeat(pid);
    this.sentHistory.delete(connId);
    const m = d.members[pid]!;
    this.trace('reconnect', { cid: connId, how, returning, pid, seat: m.seat, name: m.name });
    this.io.send(connId, { t: 'welcome', you: pid, token: m.token, code: d.code, chat: d.chat.slice(-LIMITS.chatHistory), v: PROTOCOL_VERSION });
    if (uid) this.seatReserved(pid);
    d.lastActive = this.io.now();
    this.after();
  }

  /** Put `pid` back in the seat a disconnect-grace bot is holding for them. */
  private reclaimSeat(pid: string): void {
    const d = this.data;
    const m = d.members[pid];
    if (!m || m.seat !== null) return;
    const seat = d.seats.findIndex((s) => s.kind === 'bot' && s.replacedPid === pid);
    if (seat < 0) return;
    this.trace('seat', { cause: 'reclaim', seat, fromPid: pid, toKind: 'human', toPid: pid, turnKey: d.turnKey, turnStartedAt: d.turnStartedAt, deadline: d.deadline });
    d.seats[seat] = { kind: 'human', playerId: pid };
    m.seat = seat;
    m.timeouts = 0;
    const g = d.game;
    if (g && pendingTurn(g)?.seat === seat) {
      d.turnKey = null;
      d.deadline = null;
    }
  }

  private handle(connId: string, pid: string, msg: ClientMsg): void {
    const d = this.data;
    const me = d.members[pid]!;
    const isHost = d.hostId === pid;
    const n = d.rules.playerCount;
    switch (msg.t) {
      case 'sit': {
        if (msg.seat >= n) throw new RoomError('BAD_SEAT', 'No such seat');
        if (d.phase === 'playing' && (d.outPlayers?.includes(pid) || d.game?.eliminated?.[msg.seat])) throw new RoomError('ELIMINATED', 'You are out of this game');
        if (d.tournament) {
          const r = d.tournament.reserved[msg.seat];
          if (!r || r.uid !== me.uid) throw new RoomError('RESERVED', 'Seats at a tournament table are reserved for the entrants');
          this.seatReserved(pid);
          break;
        }
        if (d.challenge) {
          const r = d.challenge.reserved[msg.seat];
          if (!r || r.uid !== me.uid) throw new RoomError('RESERVED', 'Seats at a Big Bank table are reserved for the players in the challenge');
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
        if (d.challenge) throw new RoomError('LOCKED', 'Big Bank tables are locked');
        if (d.phase === 'playing') throw new RoomError('IN_GAME', 'Game in progress');
        if (msg.seat >= n) throw new RoomError('BAD_SEAT', 'No such seat');
        const slot = d.seats[msg.seat]!;
        // the host may replace a player who disconnected from the lobby
        if (slot.kind === 'human' && !this.isConnected(slot.playerId)) {
          this.trace('seat', { cause: 'addBot', seat: msg.seat, fromPid: slot.playerId, toKind: 'bot', turnKey: d.turnKey, turnStartedAt: d.turnStartedAt, deadline: d.deadline });
          d.members[slot.playerId]!.seat = null;
        } else if (slot.kind !== 'empty') throw new RoomError('SEAT_TAKEN', 'That seat is taken');
        d.seats[msg.seat] = { kind: 'bot', name: this.botName(), level: d.botLevel };
        break;
      }
      case 'removeBot': {
        this.requireHost(isHost);
        if (d.tournament) throw new RoomError('LOCKED', 'Tournament tables are locked');
        if (d.challenge) throw new RoomError('LOCKED', 'Big Bank tables are locked');
        if (d.phase === 'playing') throw new RoomError('IN_GAME', 'Game in progress');
        if (d.seats[msg.seat]?.kind !== 'bot') throw new RoomError('BAD_SEAT', 'No bot there');
        d.seats[msg.seat] = { kind: 'empty' };
        break;
      }
      case 'config': {
        this.requireHost(isHost);
        if (d.tournament) throw new RoomError('LOCKED', 'Tournament tables are locked');
        if (d.challenge) throw new RoomError('LOCKED', 'Big Bank tables are locked');
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
        if (msg.aiTalk !== undefined) d.aiTalk = msg.aiTalk;
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
        if (d.challenge) {
          if (d.phase !== 'lobby') throw new RoomError('IN_GAME', 'Game in progress');
          if (!this.allReservedSeated()) throw new RoomError('WAITING', 'Waiting for every player (the match starts automatically)');
          this.challengeBegin();
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
        if (d.challenge) throw new RoomError('LOCKED', 'Big Bank matches have no rematch: send a new challenge');
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
      case 'react': {
        // emoji reaction to a chat line: toggle, persist, broadcast the new reaction map.
        // not an error to rate-limit or to react to a missing line: silently drop it.
        const line = d.chat.find((l) => l.id === msg.id);
        if (!line || line.system || !line.from) return;
        const now = this.io.now();
        const w = (this.reactWindow.get(pid) ?? []).filter((t) => now - t < 10_000);
        if (w.length >= LIMITS.reactBurst) { this.reactWindow.set(pid, w); return; }
        w.push(now);
        this.reactWindow.set(pid, w);
        line.reactions = toggleReaction(line.reactions, msg.emoji, pid);
        for (const [cid, p] of this.conns) if (p) this.io.send(cid, { t: 'chatReact', id: line.id, reactions: line.reactions });
        this.io.persist();
        return; // reactions don't change the table state
      }
      case 'media': {
        // spectators never transmit (they watch and listen)
        me.media = me.seat === null && d.phase !== 'lobby' ? { cam: false, mic: false } : msg.media;
        break;
      }
      case 'kick': {
        if (d.tournament) throw new RoomError('LOCKED', 'No kicking at tournament tables');
        if (d.challenge) throw new RoomError('LOCKED', 'No kicking at Big Bank tables');
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
      case 'interactive': {
        const turn = d.game ? pendingTurn(d.game) : null;
        const mine = !!turn && me.seat === turn.seat;
        if (msg.on) {
          const held = me.interactive === false || me.loaderSince != null;
          me.interactive = true;
          delete me.loaderSince;
          if (held && mine) { d.turnStartedAt = this.io.now(); d.deadline = null; }
        } else {
          me.interactive = false;
          me.loaderSince ??= this.io.now();
          if (mine) d.deadline = null;
        }
        this.trace('interactive', { pid, on: msg.on, seat: me.seat });
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
        if (d.challenge) throw new RoomError('LOCKED', 'Big Bank tables are locked');
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
   *     turn timed out and auto-played, the hand ended, …) → silently dropped: ack stale + a fresh FULL state, never an error.
   *     A card that is still legal on this same turn is applied (a reload can be holding the seq this turn started on).
   *     A play from before this turn is not: it must not become the next lead.
   *  3. rule checks → ack with the rule error code (or an `error` message for legacy clients that send no id)
   * The DO is single-threaded, so a late human move and the turn-timer auto-play can't interleave: whichever runs
   * first bumps `seq` and the other one becomes stale (auto-play re-checks the turn key before acting).
   */
  private act(connId: string, me: Member, msg: Extract<ClientMsg, { t: 'act' }>): void {
    const d = this.data;
    this.healNilRules();
    const id = msg.id;
    if (id && me.acts?.includes(id)) {
      this.sendState(connId);
      this.io.send(connId, { t: 'ack', id, ok: true, dup: true });
      return;
    }
    if (msg.seq === undefined || msg.seq !== (d.seq ?? 0)) {
      // The turn did not move (a reload's seq can be the one this turn started on). Apply the card
      // they chose. A play from before this turn stays stale, so it cannot become the next lead.
      if (msg.action.type === 'play' && this.sameTurnCard(me, msg.action.card, msg.seq)) {
        this.trace('play', { cause: 'accept-stale-seq', seq: msg.seq ?? null, serverSeq: d.seq ?? 0, seat: me.seat, card: msg.action.card });
      } else {
        this.sentHistory.delete(connId);
        this.sendState(connId);
        if (id) this.io.send(connId, { t: 'ack', id, ok: false, stale: true });
        this.trace('play', { cause: 'drop-stale', seq: msg.seq ?? null, serverSeq: d.seq ?? 0, seat: me.seat, turn: d.game ? pendingTurn(d.game)?.seat ?? null : null });
        return;
      }
    }
    try {
      if (d.phase !== 'playing' || !d.game) throw new RoomError('WRONG_PHASE', 'No game in progress');
      if (me.seat === null) throw new RoomError('NOT_SEATED', 'You are not seated');
      const a = msg.action;
      const action: Action = a.type === 'reveal' ? { type: 'reveal', seat: me.seat }
        : a.type === 'bid' ? { type: 'bid', seat: me.seat, bid: a.bid }
        : a.type === 'exchange' ? { type: 'exchange', seat: me.seat, cards: a.cards }
        : a.type === 'runIt' ? { type: 'runIt', seat: me.seat }
        : a.type === 'misdeal' ? { type: 'misdeal', seat: me.seat }
        : { type: 'play', seat: me.seat, card: a.card, ...(a.slam !== undefined ? { slam: a.slam } : {}), ...(a.rel ? { rel: a.rel } : {}) };
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

  /**
   * A card play that is still legal for the turn in progress. `seq` has to be from this turn
   * (`turnSeq`), not from the previous trick, or a late tap would lead the next one.
   * The last-card throw-in window is also honored (out-of-turn final-trick throws are legal).
   */
  private sameTurnCard(me: Member, card: string, seq: number | undefined): boolean {
    const d = this.data;
    const g = d.game;
    if (!g || d.phase !== 'playing' || me.seat === null || seq === undefined) return false;
    if (seq < (d.turnSeq ?? 0)) return false;
    const turn = pendingTurn(g);
    if (!turn || turn.kind !== 'play') return false;
    if (turn.seat !== me.seat && !throwInOpen(g)) return false;
    if (g.trick.plays.some((p) => p.seat === me.seat)) return false;
    return viewFor(g, me.seat).legal.some((c) => c === card);
  }

  private requireHost(isHost: boolean): void {
    if (!isHost) throw new RoomError('NOT_HOST', 'Only the host can do that');
  }

  /** A bot taking a human's seat mid-game. `was` keeps their name for the game-over screen. */
  private botSeat(was: string): SeatSlot {
    return { kind: 'bot', name: this.botName(), level: this.data.botLevel, vacated: true, was };
  }

  /** The only mid-game path that gives a human's chair to a bot: they left, or the table removed them. */
  private handSeatToBot(seat: number, was: string, fromPid: string, cause: 'leave' | 'host' | 'vote'): SeatSlot {
    const d = this.data;
    const bot = this.botSeat(was);
    const name = bot.kind === 'bot' ? bot.name : null;
    this.trace('seat', {
      cause, seat, fromPid, toKind: 'bot', botName: name,
      timeouts: d.members[fromPid]?.timeouts ?? null,
      disconnectedAt: d.members[fromPid]?.disconnectedAt ?? null,
      turnKey: d.turnKey, turnStartedAt: d.turnStartedAt, deadline: d.deadline,
    });
    return bot;
  }

  private botName(): string {
    const used = new Set(this.data.seats.flatMap((s) => (s.kind === 'bot' ? [s.name] : [])));
    for (const m of Object.values(this.data.members)) used.add(m.name);
    // random per table from the shared pool, with a plate tag no one else at the table already has.
    // The name is stored on the seat, so every client sees the same tag for the whole game.
    return pickBotNames(1, used, undefined, platePersona)[0]!;
  }

  private leave(pid: string): void {
    const d = this.data;
    const m = d.members[pid];
    if (!m) return;
    if (m.seat !== null && d.phase === 'playing') this.reportAbandoned(pid);
    if (m.seat !== null) {
      // mid-game the seat goes to a bot so the others can finish; in the lobby it just opens up
      const seat = m.seat;
      if (d.phase === 'playing') d.seats[seat] = this.handSeatToBot(seat, m.name, pid, 'leave');
      else {
        this.trace('seat', { cause: 'leave', seat, fromPid: pid, toKind: 'empty', turnKey: d.turnKey, turnStartedAt: d.turnStartedAt, deadline: d.deadline });
        d.seats[seat] = { kind: 'empty' };
      }
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
    if (m.seat !== null) {
      const seat = m.seat;
      d.seats[seat] = d.phase === 'playing' ? this.handSeatToBot(seat, m.name, target, how) : { kind: 'empty' };
      if (d.phase !== 'playing') this.trace('seat', { cause: how, seat, fromPid: target, toKind: 'empty', turnKey: d.turnKey, turnStartedAt: d.turnStartedAt, deadline: d.deadline });
    }
    delete d.members[target];
    if (d.votes) delete d.votes[target];
    d.ready = d.ready.filter((x) => x !== target);
    d.kicked = [...(d.kicked ?? []), m.token, ...(m.uid ? [m.uid] : []), ...(m.gid ? [m.gid] : [])];
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
    if (d.phase === 'playing' && d.game && d.game.phase !== 'gameOver') this.reportAbandoned(d.hostId);
    const prevGame = d.game;
    const n = d.rules.playerCount;
    const seats = d.seats.slice(0, n);
    if (!d.tournament && !seats.some((s) => s.kind === 'human')) throw new RoomError('NO_PLAYERS', 'Sit down first');
    for (let s = 0; s < n; s++) if (d.seats[s]!.kind === 'empty') d.seats[s] = { kind: 'bot', name: this.botName(), level: d.botLevel };
    d.rated = this.ratedTable();
    // a rematch continues the deal rotation (one seat clockwise from the last dealer); a new game deals from a random seat
    const dealer = rematch && prevGame && prevGame.rules.playerCount === n ? nextDealer(prevGame) : undefined;
    try {
      // Created UNDEALT: the first hand deals only when the pre-deal setup window
      // ends (see PRE_DEAL_MS / dealFirstHand below), so no seat can be on the bid
      // clock while their table is still loading or their camera is off.
      d.game = newGameUndealt(d.rules, secureSeed(), { dealer });
    } catch (e) {
      if (e instanceof RulesConfigError) throw new RoomError('BAD_RULES', e.problems.join('; ') || 'Invalid rules');
      throw e;
    }
    d.dealAt = this.io.now() + (this.timing.preDealMs ?? PRE_DEAL_MS);
    // Hand-history log (Demetrius 2026-10-19): a fresh ground-truth log per game.
    // It opens at the deal (dealFirstHand below) so hand 1's entry carries the
    // dealt cards, not the undealt shell.
    this.logBuilder = null;
    d.handLog = undefined;
    // venue: a 'random' pick is rolled per game (so a rematch can land somewhere new); everyone gets the same one
    d.venueNow = (d.venue ?? 'classic') === 'random' ? rollVenue(parseInt(secureSeed().slice(0, 8), 16) / 4294967296, d.venueNow) : (d.venue ?? 'classic') as VenueId;
    d.seq = (d.seq ?? 0) + 1;
    d.phase = 'playing';
    d.ready = [];
    d.turnKey = null;
    d.deadline = null;
    d.gamesPlayed++;
    d.abandonReported = false;
    d.live = newLiveStats(n);
    // A new game opens at 0–0. Rematch is the explicit resume and keeps the tally.
    d.series = seriesForGameStart(d.series, rematch);
    this.startSeries();
    d.talk = { ...newTalkState(), revealed: [] }; // a new game: every Hustler is back in character
    d.kicked = []; // a new game: kicked players may come back
    d.runPlayback = undefined;
    d.outPlayers = [];
    d.outSeats = [];
    d.votes = {};
    for (const m of Object.values(d.members)) m.timeouts = 0;
    this.system(`Game ${d.gamesPlayed} started`);
  }

  /**
   * The pre-deal window ended: deal hand 1 to everyone at once. The deck is the
   * seeded one `newGame` would have dealt at startGame time — the window changes
   * WHEN the cards land, never WHICH cards. Opens the hand log on the dealt
   * state (startGame deliberately leaves it closed on the undealt shell).
   */
  private dealFirstHand(): void {
    const d = this.data;
    if (!d.game || d.game.handNo !== 0) { d.dealAt = null; return; }
    d.game = dealFirstHand(d.game);
    d.dealAt = null;
    d.seq = (d.seq ?? 0) + 1;
    d.turnKey = null; // the turn machinery keys the first bidder fresh next drive
    const b = HandLogBuilder.start(d.game, this.io.now(), d.code);
    this.logBuilder = b;
    d.handLog = b.log;
    this.trace('deal', { cause: 'pre-deal-window', game: d.gamesPlayed, hand: d.game.handNo });
  }

  /* ---------------------------------------------------------------- game */

  /* ------------------------------------------------------------ hand log */

  /**
   * The hand log for the current game (Demetrius 2026-10-19). Lazily wraps `data.handLog`
   * so a hibernated Durable Object rebuilds the builder on wake. A game already running when
   * logging arrived gets an empty log whose first recorded action opens the current hand.
   */
  private handLog(): HandLogBuilder | null {
    const d = this.data;
    if (!d.game) { this.logBuilder = null; return null; }
    if (this.logBuilder && this.logBuilder.log === d.handLog) return this.logBuilder;
    if (!d.handLog) d.handLog = { v: 1, seed: d.game.seed, rules: d.game.rules, startedAt: this.io.now(), room: d.code, hands: [] };
    this.logBuilder = HandLogBuilder.wrap(d.handLog);
    return this.logBuilder;
  }

  /** The hand log as plain JSON for GET /api/tables/<code>/handlog (testing). */
  handLogJson(): GameHandLog | null {
    return this.data.handLog ?? null;
  }

  private apply(action: Action): void {
    const d = this.data;
    const before = d.game!;
    const next = applyAction(before, action);
    // Idempotent play: the seat already has this card in the trick. Do not bump seq or retell the moment.
    if (next === before) return;
    d.game = next;
    d.seq = (d.seq ?? 0) + 1;
    this.handLog()?.record(before, next, action, d.seq);
    this.parkEliminated();
    for (const ev of momentsFor(before, action, d.game)) this.talk(ev);
    d.lastActive = this.io.now();
    const fresh = d.game.handNo === before.handNo ? d.game.tricks.slice(before.tricks.length) : [];
    if (d.live) for (const t of fresh) if (t.winner !== null && t.plays.some((p) => p.seat === t.winner && p.card === 'BJ')) d.live.bj[t.winner] = (d.live.bj[t.winner] ?? 0) + 1;
    if (action.type === 'runIt') {
      const books = fresh.length;
      const playout = runPlayout(before, d.game, action.seat);
      if (playout) d.runPlayback = { ...playout, seq: d.seq };
      this.system(`🌪 ${this.seatName(action.seat)} ran the board (+${books} books)`);
      const slot = d.seats[action.seat];
      const m = slot?.kind === 'human' ? d.members[slot.playerId] : undefined;
      if (m && !(m.badges ?? []).some((b) => b.id === 'storm-chaser')) {
        m.badges = [...(m.badges ?? []), { id: 'storm-chaser', earnedAt: this.io.now(), context: { room: d.code, hand: before.handNo, books } }];
      }
    } else if (fresh.some((t) => isNukeTrick(t.plays))) this.system('☢ Nuked');
    // ☢ a nuke arming (second Joker down, trick still open — any trick) is announced once, on the way in;
    // the blast itself is announced above, when the trick completes
    if (nukeArmed(d.game) && !nukeArmed(before)) this.system('☢ Nuke armed — ready to blow');
    // Live highlights (league data wave 6b): the same resolution points,
    // reported out for the ticker / League Wire. Fresh tricks may carry a
    // detonation; a grown history means the hand just ended.
    if (this.io.highlight) {
      const seats = this.seatRefs();
      const at = this.io.now();
      for (const ev of trickHighlights({ tricks: fresh, seats, code: d.code, handNo: before.handNo, at })) this.io.highlight(ev);
      if (d.game.history.length > before.history.length) {
        const rec = d.game.history[d.game.history.length - 1]!;
        for (const ev of handHighlights({ rec, seats, partnerships: d.rules.partnerships, code: d.code, at })) this.io.highlight(ev);
      }
    }
    if (d.game.phase === 'gameOver') {
      d.phase = 'over';
      const res = d.game.result!;
      this.recordSeries();
      this.reportGame();
      if (d.tournament && !d.tournament.reported) {
        d.tournament.reported = true;
        this.io.tournamentResult?.(d.tournament, [...res.finalScores], d.game.result ? placementsOf([...res.finalScores], [...res.winners]) : []);
      }
      if (d.challenge && !d.challenge.reported) {
        d.challenge.reported = true;
        this.io.challengeResult?.(d.challenge, { kind: 'played', scores: [...res.finalScores], places: placementsOf([...res.finalScores], [...res.winners]), gameId: this.familyId() });
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
    return { seats, partnerships: d.rules.partnerships, teamNames: this.sideNames(), intensity: d.talkIntensity ?? 'cookout', jokers: d.rules.deck === 'joker54', aiTalk: !!d.aiTalk };
  }

  /** a game moment → maybe one bot line (cooldowns live in the talk state) */
  private talk(ev: TalkEvent): void {
    const d = this.data;
    if (d.botTalk === false || d.phase === 'lobby') return;
    const line = botTalk(this.talkState(), this.talkTable(), ev, this.io.now(), Math.random);
    if (line) this.pushBotLine(line);
    // Voice (c): behind the same host flag, a thin bucket schedules ONE writer pass (waitUntil in the DO).
    if (d.aiTalk && this.io.voiceMiss && (ev.kind === 'setThem' || ev.kind === 'wheels' || ev.kind === 'win')) {
      const bucket = bucketFor(ev.kind === 'setThem' ? 'set' : ev.kind, { bid: ev.bid, books: ev.books });
      if (bucket && line) {
        const g = voiceGender(line.name) ?? 'm';
        const fresh = activeCatalog().filter((l) => l.persona === line.persona && l.g === g && l.bucket === bucket);
        if (fresh.length < BUCKET_THIN) this.io.voiceMiss({ persona: line.persona, g, bucket, forbiddenNames: this.talkTable().seats.map((s) => s.name), existingTexts: fresh.map((l) => l.text) });
      }
    }
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

  private familyId(): string {
    const d = this.data;
    return `${d.code}-${d.createdAt.toString(36)}-${d.gamesPlayed}`;
  }

  private seatRefs(): SeatRef[] {
    const d = this.data;
    const n = d.rules.playerCount;
    return d.seats.slice(0, n).map((s, i) => {
      const side = d.rules.partnerships ? i % 2 : i;
      const parked = d.outSeats?.find((o) => o.seat === i);
      if (parked) {
        const m = d.members[parked.playerId];
        return m?.uid ? { name: m.name, side, kind: 'user' as const, uid: m.uid } : { name: m?.name ?? 'Player', side, kind: 'guest' as const };
      }
      if (s.kind === 'human') {
        const m = d.members[s.playerId];
        return m?.uid ? { name: m.name, side, kind: 'user', uid: m.uid } : { name: m?.name ?? 'Player', side, kind: 'guest' };
      }
      return { name: s.kind === 'bot' ? s.name : `Seat ${i + 1}`, side, kind: 'bot' };
    });
  }

  /**
   * The deal will not finish with these seats. Called before a leaver's seat becomes a bot.
   * The live game keeps going. A later finish is a separate row with the same family.
   */
  private reportAbandoned(leaverPid: string | null): void {
    const d = this.data;
    if (d.abandonReported || d.phase !== 'playing' || !d.game || d.game.phase === 'gameOver') return;
    d.abandonReported = true;
    const leaverId = leaverPid ? (d.members[leaverPid]?.uid ?? null) : null;
    // Big Bank settles at the abandon (leaver-forfeit), even though the deal plays out with a bot.
    if (d.challenge && !d.challenge.reported) {
      d.challenge.reported = true;
      this.io.challengeResult?.(d.challenge, { kind: 'abandoned', leaverUid: leaverId });
    }
    if (!this.io.gameOver) return;
    const seats = this.seatRefs();
    if (!seats.some((x) => x.kind === 'user')) return;
    const family = this.familyId();
    const rec = abandonedRecord({ id: `${family}-abandoned`, room: d.code, game: d.game, seats, names: this.sideNames(), teamNames: d.teamNames, endedAt: this.io.now(), tournamentId: d.tournament?.id });
    this.io.gameOver(rec, d.rated ?? this.ratedTable(), { endReason: 'abandoned', leaverId, family, venue: d.venueNow ?? d.venue ?? 'classic' });
  }

  /** Idle room is about to be deleted. No leaver: everyone gets a game started, nobody gets a loss. */
  expire(): void {
    this.reportAbandoned(null);
  }

  /** Release 9: hand the finished game to the host (stats + Elo) when an account played */
  private reportGame(): void {
    const d = this.data;
    if (!this.io.gameOver || !d.game) return;
    const seats = this.seatRefs();
    if (!seats.some((x) => x.kind === 'user')) return;
    const family = this.familyId();
    const rec = buildRecord({ id: family, room: d.code, game: d.game, seats, names: this.sideNames(), teamNames: d.teamNames, live: d.live, endedAt: this.io.now(), tournamentId: d.tournament?.id });
    this.io.gameOver(rec, isRated(rec, d.rules), { endReason: 'finished', family, venue: d.venueNow ?? d.venue ?? 'classic' });
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

  /**
   * The host's timer for this kind of turn. A missing value keeps Normal
   * (bid 20 / play 30). Play is the longer of the two. That is not a new length.
   */
  private turnSeconds(kind: string): number {
    const t = this.data.rules.turnTimerSec;
    const sec = kind === 'bid' ? t?.bid : t?.play;
    if (typeof sec === 'number' && Number.isFinite(sec)) return sec;
    return kind === 'bid' ? 20 : 30;
  }

  /** Milliseconds the table allows for this turn, including learning mode's stretch. */
  private turnLimitMs(kind: string, learning: boolean): number {
    return this.turnSeconds(kind) * 1000 * (learning ? LEARNING_TIMER : 1);
  }

  /** What the client clock is counting: the table's setting for the human who is to act. */
  private clockSeconds(): number | null {
    const g = this.data.game;
    if (this.data.phase !== 'playing' || !g) return null;
    const turn = pendingTurn(g);
    if (!turn) return null;
    const slot = this.data.seats[turn.seat];
    if (!slot || slot.kind !== 'human') return null;
    const learning = !!this.data.members[slot.playerId]?.learning;
    return Math.round(this.turnLimitMs(turn.kind, learning) / 1000);
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

  /**
   * Start of the acting human's own clock (lead-in already elapsed), or null when `deadline`
   * belongs to Table Talk / a bot / nobody. Does not change how long the turn lasts.
   */
  private turnClockStart(): number | null {
    const d = this.data;
    const g = d.game;
    if (d.deadline === null || d.turnStartedAt === null || !g) return null;
    const turn = pendingTurn(g);
    if (!turn || d.seats[turn.seat]?.kind !== 'human') return null;
    return d.turnStartedAt + this.leadIn(g);
  }

  /** e2e only (TEST_HOOKS): jump the running table to a given game position (same seats), then carry on as normal */
  testLoadGame(game: GameState): void {
    const d = this.data;
    d.game = game;
    d.phase = 'playing';
    d.seq = (d.seq ?? 0) + 1;
    d.turnKey = null; d.deadline = null; d.ready = [];
    this.parkEliminated();
    this.after();
  }

  /** Cutthroat: an eliminated human leaves the seat and stays as a spectator. The seat cannot be taken. */
  private parkEliminated(): void {
    const d = this.data;
    const g = d.game;
    if (!g || g.rules.partnerships || !g.eliminated?.some(Boolean)) return;
    g.eliminated.forEach((out, seat) => {
      if (!out) return;
      const slot = d.seats[seat];
      if (slot?.kind !== 'human') return;
      const m = d.members[slot.playerId];
      if (m && m.seat === seat) {
        m.seat = null;
        if (!d.outPlayers?.includes(slot.playerId)) d.outPlayers = [...(d.outPlayers ?? []), slot.playerId];
        if (!d.outSeats?.some((o) => o.seat === seat)) d.outSeats = [...(d.outSeats ?? []), { playerId: slot.playerId, seat }];
        d.seats[seat] = { kind: 'empty' };
        this.system(`${m.name} is out`);
      }
    });
  }

  /**
   * Older saved games can omit `nil` / `blindNil`. Bidding reads `.allowed` on those objects; a throw there
   * aborts the tick before broadcast, so the table (and every spectator) stops. Fill the preset in place.
   */
  private healNilRules(): void {
    const d = this.data;
    const rules = withCompleteNil(d.rules);
    if (rules !== d.rules) d.rules = rules;
    if (!d.game) return;
    const gr = withCompleteNil(d.game.rules);
    if (gr !== d.game.rules) d.game.rules = gr;
  }

  /**
   * Recompute timers after any change, run due bots/auto-plays, broadcast, persist.
   * A throw in the drive used to skip the broadcast. Hello has already sent welcome by then,
   * and the client waits on state, so the loader never leaves. Send the state we have anyway.
   */
  private after(): void {
    try {
      this.healNilRules();
      this.checkVotes();
      this.considerHost();
      this.drive();
    } catch (e) {
      console.error('room after failed', e);
    }
    this.broadcast();
    this.io.persist();
  }

  /** Called by timers/alarms. One bad tick must not kill the alarm loop. */
  tick(): void {
    try {
      this.healNilRules();
      const hostChanged = this.considerHost();
      const t = this.data.tournament;
      if (t?.autostartAt && this.data.phase === 'lobby' && this.io.now() >= t.autostartAt - 50) {
        this.autostart();
        this.after();
        return;
      }
      const ch = this.data.challenge;
      if (ch?.autostartAt && this.data.phase === 'lobby' && this.io.now() >= ch.autostartAt - 50) {
        this.challengeDeadline();
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
        d.turnSeq = d.seq ?? 0;
        d.deadline = null;
        d.botDueAt = null;
        changed = true;
        // Push: a fresh bid/play turn — the DO pings the player when they're away.
        const pt = pendingTurn(g);
        if (pt && (pt.kind === 'bid' || pt.kind === 'play')) this.io.turnBegan?.(pt.seat, pt.kind);
      } else if (d.turnSeq === undefined) d.turnSeq = d.seq ?? 0;
      // Release 10: a bot claims 'Run it!' as soon as it's guaranteed from its own cards, even off-turn.
      // canRunIt is proved at most once per seat per state (and never for a spectator), so this loop stays cheap.
      if (g.phase === 'playing') {
        let claimer = -1;
        try {
          // A throw here must not abort the turn. The claim itself is unchanged when the proof returns.
          claimer = d.seats.slice(0, g.rules.playerCount).findIndex((sl, i) => !!sl && sl.kind === 'bot' && i !== g.turn && canRunIt(g, i as Seat));
        } catch (e) {
          console.error('run it check failed', e);
        }
        if (claimer >= 0) { this.apply({ type: 'runIt', seat: claimer as Seat }); changed = true; continue; }
      }
      // Seated players or a connected spectator (an eliminated player stays to watch). Nobody connected: freeze.
      let paused = !Object.keys(this.data.members).some((id) => this.isConnected(id));
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
          // the pre-deal window never blocks a bracket: an empty room deals at once
          if (g.handNo === 0 && d.dealAt != null) { this.dealFirstHand(); changed = true; continue; }
          const tt = pendingTurn(g);
          if (!tt) return changed;
          const sl = d.seats[tt.seat]!;
          this.autoAct(tt.seat, sl.kind === 'bot' ? sl.level : 'normal');
          changed = true;
          if (guard === 399) this.io.wake(10);
          continue;
        }
      }

      // Pre-deal setup window: the game exists but hand 1 is not dealt yet. Hold
      // here — no turn, no clock — until the window ends, then deal to everyone
      // at once. Nobody connected: stay frozen (the deal waits for an audience,
      // like every other timer at this table).
      if (g.handNo === 0 && d.dealAt != null) {
        if (paused) { this.io.setAlarm(null); return changed; }
        if (now >= d.dealAt) { this.dealFirstHand(); changed = true; continue; }
        this.io.setAlarm(d.dealAt);
        return changed;
      }

      if (g.phase === 'handOver') {
        const humans = d.seats.filter((s): s is Extract<SeatSlot, { kind: 'human' }> => s.kind === 'human' && this.isConnected(s.playerId));
        if (humans.length > 0 && humans.every((h) => d.ready.includes(h.playerId))) {
          this.nextHand();
          changed = true;
          continue;
        }
        if (paused) { d.deadline = null; d.turnKey = null; this.io.setAlarm(null); return changed; }
        // The score screen is client-timed (trick beat, or the nuke / Run it! show). This lead-in only
        // keeps the countdown from starting before that screen — it does not change ready / next-hand.
        // trickPauseMs does not apply here: the last trick is already handOver in this same state.
        const last = g.tricks.at(-1)?.plays ?? [];
        const ran = last.some((p) => p.run);
        const lead = handEndLeadMs({
          holdMs: this.timing.handEndHoldMs ?? HAND_END_HOLD_MS,
          run: ran,
          nuke: !ran && isNukeTrick(last) ? (this.data.nukeIntensity ?? 'full') : null,
        });
        d.deadline ??= now + (d.talkSec ? d.talkSec * 1000 : this.timing.handOverMs) + lead;
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
        d.botDueAt = null;
        this.io.setAlarm(null);
        return changed;
      }

      if (slot.kind === 'bot' || slot.kind === 'empty') {
        d.deadline = null;
        // The in-memory wake is the fast path. It does not survive hibernation, and a client
        // ping is answered without waking the object, so a bot with only that timer sits on
        // "to play" until some other message arrives. The storage alarm is the same durable
        // clock a human turn already uses.
        if (d.botDueAt == null) {
          let at = Math.max(now, (d.turnStartedAt ?? now) + leadIn + this.timing.botMs);
          // sometimes a bot talks before it plays (never a tell: the line doesn't see its cards), then a short beat
          if (turn.kind === 'play' && slot.kind === 'bot' && d.botTalk !== false) {
            const line = prePlayLine(this.talkState(), this.talkTable(), turn.seat, now, Math.random);
            if (line) { this.pushBotLine(line); at += 900; changed = true; }
          }
          d.botDueAt = at;
          changed = true;
        }
        const due = d.botDueAt;
        const watchdogAt = due + BOT_WATCHDOG_MS;
        if (now >= watchdogAt) {
          try {
            this.apply(this.fallbackAction(turn.seat));
          } catch (e) {
            console.error('bot watchdog failed', e);
            this.io.wake(1000);
            this.io.setAlarm(now + 1000);
            return changed;
          }
          changed = true;
          continue;
        }
        if (now >= due) {
          const level = slot.kind === 'bot' ? slot.level : d.botLevel;
          let moved = false;
          if (this.stallsLeft > 0) this.stallsLeft--;
          else {
            try { this.autoAct(turn.seat, level); } catch (e) { console.error('bot act failed', e); }
            moved = this.turnKeyOf(d.game!) !== key;
          }
          if (moved) { changed = true; continue; }
          // The brain hung or declined. Do not spin: the watchdog plays a legal card or bid.
          this.io.wake(Math.max(0, watchdogAt - now));
          this.io.setAlarm(watchdogAt);
          return true;
        }
        this.io.wake(due - now);
        this.io.setAlarm(due);
        return changed;
      }

      // a human's turn (Release 9: bot partners no longer post typed bidding hints; partners talk out loud over open mics)
      const member = d.members[slot.playerId];
      const timerMs = this.turnLimitMs(turn.kind, !!member?.learning);
      const connected = this.isConnected(slot.playerId);
      // The clock does not run while this player's own table is still drawing.
      if (connected && member?.interactive === false) {
        if (d.deadline !== null) { d.deadline = null; changed = true; }
        if (member.loaderSince == null) { member.loaderSince = now; changed = true; }
        const capAt = member.loaderSince + LOADER_HOLD_MAX_MS;
        if (now >= capAt) {
          member.interactive = true;
          delete member.loaderSince;
          d.turnStartedAt = now;
          this.trace('timer', { cause: 'loader-cap', seat: turn.seat, pid: slot.playerId });
          changed = true;
          continue;
        }
        this.io.wake(Math.max(250, Math.min(1000, capAt - now)));
        this.io.setAlarm(capAt);
        return changed;
      }
      if (connected && member?.loaderSince != null) {
        delete member.loaderSince;
        d.turnStartedAt = now;
        d.deadline = null;
        changed = true;
      }
      const full = (d.turnStartedAt ?? now) + leadIn + timerMs;
      if (!connected) {
        // Same length as this table's bid or play timer, measured from the drop.
        // A fixed 10s grace was auto-playing Relaxed tables during a reload.
        // Later ticks must not push that deadline out.
        if (member && member.disconnectedAt == null) member.disconnectedAt = now;
        const since = member?.disconnectedAt ?? now;
        const want = Math.min(full, since + timerMs);
        if (d.deadline === null || want < d.deadline) { d.deadline = want; changed = true; }
      } else {
        if (member) delete member.disconnectedAt;
        // A reconnect undoes the grace shortening, back up to the original timer — not a new clock.
        if (d.deadline === null || d.deadline < full) { d.deadline = full; changed = true; }
      }
      // a slow human gets roasted once per turn (bots only)
      const slowAt = (d.turnStartedAt ?? now) + leadIn + Math.max(12_000, timerMs * 0.6);
      if (this.slowKey !== key && now >= slowAt && now < (d.deadline ?? full)) { this.slowKey = key; this.talk({ kind: 'slow', them: turn.seat }); changed = true; }
      else if (this.slowKey !== key && slowAt < (d.deadline ?? full)) this.io.wake(Math.max(50, slowAt - now));
      if (d.deadline !== null && now >= d.deadline) {
        const before = d.seq ?? 0;
        try { this.autoAct(turn.seat, 'normal'); } catch (e) { console.error('human auto-act failed', e); }
        // The brain declined and the fallback didn't move. Counting that as AFK in a tight
        // loop is how one reload replaced the player with a bot in the same tick.
        if ((d.seq ?? 0) === before) {
          this.io.wake(1000);
          this.io.setAlarm(now + 1000);
          return changed;
        }
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

  /** A timed-out turn was auto-played. The chair is not part of that: only `leave` gives it to a bot. */
  private countTimeout(pid: string, seat: number): void {
    const d = this.data;
    const m = d.members[pid];
    if (!m) return;
    const connected = this.isConnected(pid);
    if (!connected) {
      this.trace('timeout', { cause: 'disconnect-autoplay', seat, pid, name: m.name, connected, turnKey: d.turnKey, turnStartedAt: d.turnStartedAt, deadline: d.deadline });
      return;
    }
    m.timeouts = (m.timeouts ?? 0) + 1;
    this.trace('timeout', { cause: 'turn-timer', seat, pid, name: m.name, connected, timeouts: m.timeouts, turnKey: d.turnKey, turnStartedAt: d.turnStartedAt, deadline: d.deadline });
  }

  private clearTimers(): void {
    this.data.deadline = null;
    this.data.turnKey = null;
    this.data.botDueAt = null;
    this.io.setAlarm(null);
  }

  private nextHand(): void {
    const d = this.data;
    const before = d.game!;
    d.game = applyAction(before, { type: 'nextHand' });
    d.seq = (d.seq ?? 0) + 1;
    // Hand-log: open the new hand's entry from the dealt state.
    this.handLog()?.record(before, d.game, { type: 'nextHand' }, d.seq);
    d.runPlayback = undefined;
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
    let action = chooseBotAction(view, skill, undefined, hint) ?? this.fallbackAction(seat);
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
      this.apply(this.fallbackAction(seat));
    }
  }

  /** A legal bid, reveal, exchange, or card for `seat`. Used when the bot brain does not move the turn. */
  private fallbackAction(seat: number): Action {
    const v = viewFor(this.data.game!, seat);
    if (v.phase === 'playing') return { type: 'play', seat, card: v.legal[0]! };
    if (v.phase === 'bidding') return v.hand === null ? { type: 'reveal', seat } : { type: 'bid', seat, bid: v.bidOptions && v.bidOptions.max < 1 && v.bidOptions.nil ? 'nil' : v.bidOptions?.min ?? 1 };
    return { type: 'exchange', seat, cards: (v.hand ?? []).slice(0, v.exchange[0]?.count ?? 0) };
  }

  /* --------------------------------------------------------------- output */

  roomInfo(): RoomInfo {
    const d = this.data;
    const seats: SeatInfo[] = d.seats.slice(0, d.rules.playerCount).map((s) => {
      if (s.kind === 'empty') return { kind: 'empty' };
      if (s.kind === 'bot') return { kind: 'bot', name: s.name, level: s.level, ...(s.was ? { was: s.was } : {}) };
      const m = d.members[s.playerId];
      return { kind: 'human', playerId: s.playerId, name: m?.name ?? 'Player', connected: this.isConnected(s.playerId), media: m?.media ?? { cam: false, mic: false }, ...(m?.uid ? { uid: m.uid } : {}) };
    });
    return {
      code: d.code, hostId: d.hostId ?? '', phase: d.phase, rules: d.rules, botLevel: d.botLevel, seats,
      members: Object.entries(d.members).map(([playerId, m]) => ({ playerId, name: m.name, connected: this.isConnected(playerId), seat: m.seat })),
      deadline: d.deadline, turnClockStart: this.turnClockStart(), turnSec: this.clockSeconds(), ready: [...d.ready], rev: d.rev, seq: d.seq ?? 0, game: d.gamesPlayed, dealAt: d.dealAt ?? null, now: this.io.now(),
      talkSec: d.talkSec ?? Math.round(this.timing.handOverMs / 1000), afkLimit: d.afkLimit ?? DEFAULT_AFK_LIMIT, partnerMicMute: d.partnerMicMute ?? false, nukeIntensity: d.nukeIntensity ?? 'full', talkIntensity: d.talkIntensity ?? 'cookout', botTalk: d.botTalk ?? true, aiTalk: !!d.aiTalk,
      venue: d.venue ?? 'classic', ...(d.venueNow ? { venueNow: d.venueNow } : {}),
      teamNames: d.rules.partnerships ? [...(d.teamNames ?? [null, null])] : undefined, series: d.series ?? null, revealed: [...(d.talk?.revealed ?? [])],
      ...(d.tournament ? { tournament: { id: d.tournament.id, name: d.tournament.name, match: d.tournament.match, autostartAt: d.tournament.autostartAt, reserved: d.tournament.reserved.map((r) => r?.name ?? null) } } : {}),
      ...(d.challenge ? { challenge: { id: d.challenge.id, autostartAt: d.challenge.autostartAt, reserved: d.challenge.reserved.map((r) => r?.name ?? null) } } : {}),
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
    if (d.phase !== 'playing' || d.tournament || d.challenge || !d.game) return [];
    const bots = this.replaceBotsOn();
    return d.seats.slice(0, d.rules.playerCount).flatMap((s, i) => (s.kind === 'bot' && (s.vacated || bots) && !d.game?.eliminated?.[i] ? [i] : []));
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
    const run = d.runPlayback && view && d.runPlayback.handNo === view.handNo ? d.runPlayback : undefined;
    this.io.send(cid, watching ? { t: 'state', room, seat, view, spectator: true, ...(run ? { run } : {}) } : { t: 'state', room, seat, view, ...(run ? { run } : {}) });
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
