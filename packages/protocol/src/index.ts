/**
 * WebSocket protocol between the web client and the Table Durable Object (spec §4.2).
 * Plain TS types + small hand-written guards (no runtime schema lib, to keep the Worker bundle and CPU tiny).
 * Every client message is validated on the server with `parseClientMsg`; anything malformed is dropped.
 */
import type { Card, PlayerView, RunPlayout, Series, TableRules } from '@spades/rules';
import { isReactionEmoji, type ChatReactions } from './filter';
export * from './filter';
export * from './social';

/** Built-in host-music tracks the server accepts (the web playlist has 17; headroom for more). */
export const MAX_BEAT_TRACKS = 64;
/** Nuke intensity (table setting): Full Nuke (default) / Classic / Off. */
export const NUKE_INTENSITIES = ['full', 'classic', 'off'] as const;
/** Bot trash-talk intensity (host table setting, locked during a game): Family Friendly / Cookout (default) / No Mercy. */
export const TALK_INTENSITIES = ['family', 'cookout', 'nomercy'] as const;
export type TalkIntensity = (typeof TALK_INTENSITIES)[number];
export type NukeIntensity = (typeof NUKE_INTENSITIES)[number];
/** Extra lead-in after a nuked trick, per table level (ms). Covers the ~3.6 s blast; the score opens when this hold ends. */
export const NUKE_ALLOWANCE_MS: Record<NukeIntensity, number> = { full: 4000, classic: 3500, off: 1200 };
/**
 * 'Run it!': server cushion for the slam + tornado (zoom 1.5 s + slam 1.1 s + a beat + tornado 2.1 s).
 * The client show itself is 5350 ms (`RUN_SHOW_MS`); this is a little longer so the Table Talk countdown
 * is not already ticking down when the score screen opens.
 */
export const RUN_FX_MS = 5800;
/**
 * How long a finished trick stays on the table between hands' tricks (ms), at normal speed.
 * Not the hand-end score delay — see HAND_END_REVEAL_MS.
 */
export const TRICK_HOLD_MS = 1150;
/**
 * Flight of the last card onto the trick (Scene duration 0.5 s). The hand-end clock starts when the
 * play state arrives, which is when that flight starts, so the score is HAND_END_REVEAL_MS − this
 * after the card lands.
 */
export const CARD_LAND_MS = 500;
/** Readable beat after the last card lands, before the score screen, at normal speed. Inside 600–900 ms. */
export const HAND_END_AFTER_LAND_MS = 700;
/**
 * Normal hand end (no nuke, no Run it!): play state → score screen, at speed 1.
 * 500 ms flight + 700 ms to see the trick = 1200 ms. Other speeds scale this the same way as trick holds.
 *
 * Previously the screen also waited out scoring toasts (3200 ms), every hype effect (cap HYPE_SETTLE_MAX_MS),
 * and then HAND_END_BEAT_MS (1200 ms) — about 5 s after the card landed at normal speed, before any
 * Wheels / SHOT popup. Those still play; they no longer gate the screen.
 */
export const HAND_END_REVEAL_MS = CARD_LAND_MS + HAND_END_AFTER_LAND_MS;
/** Cap on one fx.hold so a stuck celebration cannot hang a caller of fx.whenIdle. Not added to the score delay. */
export const HYPE_SETTLE_MAX_MS = 8000;
/**
 * No extra beat after the trick is readable. Kept at 0 so older imports still resolve;
 * the old value was 1200 ms on top of the toast / hype queue.
 */
export const HAND_END_BEAT_MS = 0;
/**
 * Table Talk countdown lead-in for a normal hand: the same moment the client opens the score,
 * so the countdown the player sees is the talk time they picked.
 * Old value was HYPE_SETTLE_MAX_MS + 1200 = 9200 ms, matched to the old client wait.
 * A Run it! hand uses RUN_FX_MS instead. A nuked final trick adds NUKE_ALLOWANCE_MS on top of this
 * (the blast starts while the trick is still on the table). Tests pass handEndHoldMs: 0 to skip it.
 */
export const HAND_END_HOLD_MS = HAND_END_REVEAL_MS;

/**
 * How long the server pushes the Table Talk deadline out past the hand ending.
 * `holdMs` is the configured beat (0 in fast tests). A run's show replaces that beat.
 * A nuke adds its allowance only when the beat is on, so tests that zero the hold stay fast.
 */
export function handEndLeadMs(opts: { holdMs: number; run: boolean; nuke: NukeIntensity | null }): number {
  if (opts.run) return RUN_FX_MS;
  if (opts.nuke && opts.holdMs > 0) return opts.holdMs + NUKE_ALLOWANCE_MS[opts.nuke];
  return opts.holdMs;
}
export const PROTOCOL_VERSION = 1;

/* ---------------------------------------------------------------- limits */
export const LIMITS = {
  nameMax: 20,
  chatMax: 200,
  /** chat lines per player per 10 s window */
  chatBurst: 5,
  chatHistory: 50,
  /** max members (seated + spectators) per table: 4 seats + LIMITS.spectators */
  members: 24,
  /** Release 10: max spectators (unseated members) per table (free-tier friendly) */
  spectators: 20,
  /** spectator chat lines per 10 s (players get chatBurst) */
  spectatorChatBurst: 3,
  /** reactions per player per 10 s window */
  reactBurst: 10,
  /** max size of a relayed WebRTC signaling payload (SDP ~ 3–8 KB) */
  rtcMax: 16_000,
} as const;

/** Bot skill table setting: mixed (default) or one fixed level; 'easy' / 'normal' are older names (novice / pro). */
export type BotLevel = 'mixed' | 'novice' | 'regular' | 'pro' | 'shark' | 'easy' | 'normal';
export const BOT_LEVELS: readonly BotLevel[] = ['mixed', 'novice', 'regular', 'pro', 'shark', 'easy', 'normal'];

/* ------------------------------------------------------------ client → server */
export type GameAction =
  | { type: 'reveal' }
  | { type: 'bid'; bid: number | 'nil' | 'blindNil' }
  | { type: 'exchange'; cards: Card[] }
  | { type: 'play'; card: Card; slam?: number; rel?: [number, number] }
  | { type: 'runIt' }
  | { type: 'misdeal' };

export interface MediaState { cam: boolean; mic: boolean }

/** Between-hands "Table Talk" countdown choices (seconds). */
export const TALK_SECS = [15, 20, 30, 45] as const;
/** Older clients still send this. A timeout plays the turn; it does not give the seat to a bot. */
export const AFK_LIMITS = [0, 2, 3, 5] as const;
export const DEFAULT_AFK_LIMIT = 3;
export const DEFAULT_TALK_SEC = 20;

/**
 * Host music for the whole table (spec: host music):
 *  - beat: one of the built-in tracks, synced — everyone starts track `track` at server time `startAt` (epoch ms)
 *  - link: a Spotify / Apple Music "now playing" link shown as a tappable card (each player listens in their own app)
 *  - stream: the host streams their device audio over the WebRTC mesh (`by` = host player id)
 */
export type HostMusic =
  | { mode: 'off' }
  | { mode: 'beat'; track: number; startAt: number }
  | { mode: 'link'; url: string; title: string }
  | { mode: 'stream'; by: string; title: string };

/** Only https links to the big music services are shown as a card (no arbitrary URLs in a shared table). */
export function isMusicLink(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /^(open\.spotify\.com|spotify\.link|music\.apple\.com|geo\.music\.apple\.com)$/.test(u.hostname);
  } catch { return false; }
}

export type ClientMsg =
  | { t: 'hello'; name: string; token?: string; v?: number; /** stable browser guest id, so a new seat token on reload is still this player */ gid?: string; /** Release 9: signed account ticket (links the seat to an account for stats) */ ticket?: string }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'addBot'; seat: number }
  | { t: 'removeBot'; seat: number }
  /** host: the table's venue (lobby / between games); everyone sees the same one */
  | { t: 'venue'; venue: VenueChoice }
  | { t: 'config'; rules: TableRules; botLevel?: BotLevel; talkSec?: number; afkLimit?: number; partnerMicMute?: boolean; nukeIntensity?: NukeIntensity; botTalk?: boolean; talkIntensity?: TalkIntensity; aiTalk?: boolean }
  /** rename your own team (team modes); '' resets to the partner names */
  | { t: 'teamName'; name: string }
  /** host only: what plays for the whole table (the server stamps `startAt` for beats) */
  | { t: 'music'; music: HostMusic }
  | { t: 'start' }
  /**
   * A game move. `seq` is required: the game version (RoomInfo.seq) the move was chosen from. Missing or outdated
   * seq is stale — the server drops the move (a late play must not become the next lead after the timer auto-played)
   * and answers `ack {stale}` + a fresh state instead of an error. `id` = client-chosen idempotency key: re-sending
   * the same id (e.g. after a reconnect) never applies twice.
   */
  | { t: 'act'; action: GameAction; seq?: number; id?: string }
  | { t: 'next' }
  | { t: 'rematch' }
  /** all typed chat is public to the whole table (partners talk books out loud on their mics during bidding) */
  | { t: 'chat'; text: string }
  /** emoji reaction to a chat line (toggle): the server applies it and broadcasts the new reaction map */
  | { t: 'react'; id: number; emoji: string }
  | { t: 'media'; media: MediaState }
  /** "Learning mode" (tips on): this player's own turn timers run 50% longer */
  | { t: 'learning'; on: boolean }
  /** This client's table is drawn and can take a bid or a play. False while the loader is up. */
  | { t: 'interactive'; on: boolean }
  /** host: kick the player in `seat` now (a bot takes over, no rejoin this game). Anyone else: vote to kick (toggles). */
  | { t: 'kick'; seat: number }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'leave' }
  /** Story co-op: concede the match for the pair (story rooms only; partnership = shared fate).
   *  The room ends the game as a pair loss and witnesses it like any story result. */
  | { t: 'concede' }
  /** Story co-op: arm this player's ready flag for the room's current story phase
   *  (lobby sit-down / tape / scene / outro). Both pair members ready = the phase advances.
   *  `stopId` (host, lobby phase; either player, outro phase) asks to run a different stop next —
   *  outro: the host's choice wins when both name one. */
  | { t: 'storyReady'; stopId?: string }
  /** Story co-op finale (Phase 4, spec §6): this pair member's standing choice at the
   *  King's proposal — take the cutthroat, or bank leg 1 as a normal clear. Each
   *  member's choice is visible to both and can be changed; the room acts only when
   *  BOTH members agree. Disagreement parks the proposal with nothing lost. */
  | { t: 'storyFinale'; choice: 'cutthroat' | 'bank' }
  /** Release 10, host: table options (any phase). private = hidden from Open tables (invite / code only);
   *  replaceBots = spectators may take a bot's seat mid-game (default on, except rated tables where the default is off;
   *  seats a player vacated are always open, and a rated game still requires an account to take one) */
  | { t: 'tableOpts'; private?: boolean; replaceBots?: boolean };

/* ------------------------------------------------------------ server → client */
export type SeatInfo =
  | { kind: 'empty' }
  | { kind: 'bot'; name: string; level: BotLevel; /** human this bot replaced mid-game; the game-over screen still names them */ was?: string }
  | { kind: 'human'; playerId: string; name: string; connected: boolean; media: MediaState; autoplay?: boolean;
      /** account id (Demetrius 2026-10-19): lets clients show the player's uploaded profile
       *  picture. Present for signed-in accounts, absent for guests (no account, no picture). */
      uid?: string };

export interface MemberInfo { playerId: string; name: string; connected: boolean; seat: number | null }

export type RoomPhase = 'lobby' | 'playing' | 'over';

export interface RoomInfo {
  code: string;
  hostId: string;
  phase: RoomPhase;
  rules: TableRules;
  botLevel: BotLevel;
  seats: SeatInfo[];
  members: MemberInfo[];
  /** epoch ms when the current turn auto-plays (null when no human is on the clock) */
  deadline: number | null;
  /**
   * Epoch ms when that human's own clock started, after the deal / trick lead-in.
   * Null when `deadline` is not a turn clock (Table Talk, a bot, nobody to act).
   * The HUD ring is `(deadline − now) / (deadline − turnClockStart)`.
   */
  turnClockStart: number | null;
  /**
   * Seconds on the clock for the current human turn: the table's bid or play setting
   * (longer while that player has learning mode on). The countdown is `deadline`; this
   * is the length it was given, so the client does not invent a shorter one. Null when
   * no human is on the clock.
   */
  turnSec?: number | null;
  /** players (ids) who have pressed "next hand" */
  ready: string[];
  /** monotonically increasing broadcast counter (any change: seats, media, timers, game) */
  rev: number;
  /** game version: bumps only when the game itself changes (a move, auto-play, next hand, new game). Actions carry it. */
  seq: number;
  /** games started at this table (1 = first game); changes on rematch */
  game: number;
  /** Pre-deal setup window: epoch ms when the FIRST hand of the current game deals.
   *  Set only while the room holds that deal (players are on the loaded table setting
   *  cameras/mics); null/absent once dealt or when no window is running. */
  dealAt?: number | null;
  /** server clock (epoch ms) when this was sent, so clients can correct the deadline for clock skew */
  now: number;
  /** between-hands Table Talk countdown (s) */
  talkSec: number;
  /** host music (absent = off) */
  music?: HostMusic;
  /** consecutive timeouts before a bot replaces a player (0 = off) */
  afkLimit?: number;
  /** host option: partners can't hear each other during trick play (from the first card led); bidding, Table Talk and lobby stay open; default off */
  partnerMicMute?: boolean;
  /** table setting: how big the Big-over-Little-Joker nuke plays for everyone (default full) */
  nukeIntensity?: NukeIntensity;
  talkIntensity?: TalkIntensity;
  /** host option: bots chat (trash talk) at the table; default on */
  botTalk?: boolean;
  /** host option: pre-voiced AI catalog lines + Voice (c) writer; default off */
  aiTalk?: boolean;
  /** the host's venue pick (default classic) */
  venue?: VenueChoice;
  /** the venue this game is played in ('random' resolved at the start; absent before the first game = venue) */
  venueNow?: VenueId;
  /** per side: a custom team name, or null = default (partner names) */
  teamNames?: (string | null)[];
  /** bot seats whose Hustler act is over (their lines drop the newbie cover; the plate tag does not) */
  revealed?: number[];
  /** rematch series at this table (survives reconnects; resets when the teams change) */
  series?: Series | null;
  /** open vote-kicks: target player, who voted, votes needed */
  votes?: { target: string; by: string[]; need: number }[];
  /** Release 9b: this table plays a tournament match */
  tournament?: { id: string; name?: string; match: string; autostartAt: number | null; reserved: (string | null)[] };
  /** Big Bank wager table: the challenge this room plays (sent by the room; absent elsewhere). */
  challenge?: { id: string; autostartAt: number | null; reserved: (string | null)[] };
  /** Story co-op room: the pair's run lives in the descriptor's own phase machine
   *  (lobby → tape → scene → game → outro), separate from the room phase. `track` is
   *  the pair track key (null until a share-code partner binds). `gameId` names the
   *  current/last game — the id both players post their witnessed result under.
   *  `ready` = pair uids armed for the current story phase. */
  story?: {
    track: string | null; stopId: string;
    phase: 'lobby' | 'tape' | 'scene' | 'game' | 'finale' | 'finale-game' | 'outro';
    gameId: string; hostUid: string; partnerUid: string | null;
    ready: string[]; concededBy?: string;
    /** The King's finale (Phase 4): present while a pair holds the double mark in
     *  this room — `short` = the proposal scene's short form (a later sit-down;
     *  false when leg 1 was just won in this room). `choices` are the members'
     *  standing picks, visible to both. `outcome`/`gameId` land when the finale
     *  resolves (the cutthroat's result, or the decline's banked clear). */
    finale?: {
      short: boolean;
      choices: { uid: string; choice: 'cutthroat' | 'bank' }[];
      outcome?: 'double' | 'clear' | 'lost' | 'declined';
      gameId?: string;
    };
  };
  /** Release 10: hidden from the Open tables list (default public) */
  private?: boolean;
  /** Release 10: spectators may take bot seats mid-game (default on; off by default when the table is rated) */
  replaceBots?: boolean;
  /** Release 10: connected spectators (unseated members while a game is on) */
  spectators?: { playerId: string; name: string }[];
  /** Release 10: seats a spectator may take right now (mid-game, non-tournament): vacated seats + bots if allowed */
  takeable?: number[];
}

export interface ChatLine {
  id: number; from: string | null; name: string; text: string; at: number; system?: boolean;
  /** emoji reactions (emoji -> reactor pids); see REACTION_PALETTE */
  reactions?: ChatReactions;
  /** a bot's trash talk: its seat, persona, and whether this line is the Hustler's reveal (raw text; clients mask per Clean talk) */
  bot?: { seat: number; persona: string; reveal?: boolean; line?: string; bid?: number };
  /** a bot partner's bidding hint ("I got about 3"): public like every line; clients may voice it */
  hint?: true;
  /** Release 10: posted by a spectator (players may hide these) */
  spectator?: true;
  /** @mentions resolved server-side at post time: ROOM pids of the table members this line tags (accounts only; resolved via their usernames, self and block-paired members excluded). Absent when the line tags nobody at the table. */
  mentions?: string[];
}

/** Venues (3D arenas). 'classic' = the original studio table; 'random' is a pick resolved when a game starts. */
export const VENUES = ['classic', 'backyard', 'mansion', 'barbershop', 'church', 'rooftop', 'speakeasy', 'vegas', 'beach', 'grandma', 'yacht', 'blockAfterDark'] as const;
export type VenueId = (typeof VENUES)[number];
export type VenueChoice = VenueId | 'random';
export function isVenueChoice(v: unknown): v is VenueChoice {
  return v === 'random' || (typeof v === 'string' && (VENUES as readonly string[]).includes(v));
}
/** Venues behind an unlock (The Pj's: Rep Level 20 / the After Dark achievement, or a dev account).
 *  A locked venue may only be picked or rolled by a player entitled to it — every roll and every
 *  room venue pick must go through this gate, never just the picker UI. */
export const LOCKED_VENUES: readonly VenueId[] = ['blockAfterDark'];
export function isLockedVenue(v: VenueId): boolean {
  return (LOCKED_VENUES as readonly string[]).includes(v);
}
/** a concrete venue for 'random' (never 'classic', and not the one just played when possible).
 *  Locked venues stay out of the pool unless the roller is entitled to them (`includeLocked`). */
export function rollVenue(r: number, not?: VenueId, includeLocked = false): VenueId {
  const pool = VENUES.filter((v) => v !== 'classic' && v !== not && (includeLocked || !isLockedVenue(v)));
  return pool[Math.min(pool.length - 1, Math.floor(r * pool.length))]!;
}

/**
 * Public play-out of a resolved 'Run it!', real seats, kept until the next hand.
 * `seq` is the room version of the claim so each client starts the show once.
 */
export interface RunPlayback extends RunPlayout {
  seq: number;
}

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string; code: string; chat: ChatLine[]; v: number }
  /** `view.history` is null when unchanged since the last state sent on this connection (keep the previous one) */
  | { t: 'state'; room: RoomInfo; seat: number | null; view: PlayerView | null; /** Release 10: you're watching (view = a redacted table view from seat 0: no hand, no legal moves) */ spectator?: boolean; /** remaining tricks of a resolved Run it!, so every client can play them out */ run?: RunPlayback }
  | { t: 'chat'; line: ChatLine }
  /** a chat line's reactions changed (toggle): `id` names the line, the client upserts the map (not a new line) */
  | { t: 'chatReact'; id: number; reactions: ChatReactions }
  | { t: 'rtc'; from: string; data: unknown }
  /**
   * Reply to an `act` that carried an `id`. ok = applied (dup = it had already been applied earlier).
   * stale = dropped because the game moved on (a fresh `state` is sent right before) — benign, don't show an error.
   * Otherwise code/message say why it was rejected.
   */
  | { t: 'ack'; id: string; ok: boolean; dup?: boolean; stale?: boolean; code?: string; message?: string }
  | { t: 'error'; code: string; message: string };

/* ------------------------------------------------------------------ guards */
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isStr = (x: unknown, max = 10_000): x is string => typeof x === 'string' && x.length <= max;

function parseAction(a: unknown): GameAction | null {
  if (!isObj(a)) return null;
  switch (a.type) {
    case 'reveal': return { type: 'reveal' };
    case 'bid':
      if (isInt(a.bid) && a.bid >= 0 && a.bid <= 17) return { type: 'bid', bid: a.bid };
      if (a.bid === 'nil' || a.bid === 'blindNil') return { type: 'bid', bid: a.bid };
      return null;
    case 'exchange':
      return Array.isArray(a.cards) && a.cards.length <= 2 && a.cards.every((c) => isStr(c, 2)) ? { type: 'exchange', cards: a.cards as Card[] } : null;
    case 'play':
      if (!isStr(a.card, 2)) return null;
      {
        const out: { type: 'play'; card: Card; slam?: number; rel?: [number, number] } = { type: 'play', card: a.card as Card };
        if (typeof a.slam === 'number' && Number.isFinite(a.slam)) out.slam = Math.max(0, Math.min(1, a.slam));
        const r = a.rel;
        if (Array.isArray(r) && r.length === 2 && r.every((x) => typeof x === 'number' && Number.isFinite(x))) out.rel = [Math.max(-20, Math.min(20, r[0] as number)), Math.max(-20, Math.min(20, r[1] as number))];
        return out;
      }
    case 'runIt': return { type: 'runIt' };
    case 'misdeal': return { type: 'misdeal' };
    default: return null;
  }
}

/** Validates the shape of a client message (semantic checks happen in the room). Returns null if malformed. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  let m: unknown = raw;
  if (typeof raw === 'string') {
    if (raw.length > LIMITS.rtcMax + 1000) return null;
    try { m = JSON.parse(raw); } catch { return null; }
  }
  if (!isObj(m) || typeof m.t !== 'string') return null;
  switch (m.t) {
    case 'hello':
      if (!isStr(m.name, 100)) return null;
      return { t: 'hello', name: m.name, token: isStr(m.token, 100) ? m.token : undefined, v: isInt(m.v) ? m.v : undefined, ...(isStr(m.gid, 64) ? { gid: m.gid } : {}), ...(isStr(m.ticket, 400) ? { ticket: m.ticket } : {}) };
    case 'sit': case 'addBot': case 'removeBot': case 'kick':
      return isInt(m.seat) && m.seat >= 0 && m.seat < 4 ? { t: m.t, seat: m.seat } : null;
    case 'stand': case 'start': case 'next': case 'rematch': case 'leave': case 'concede':
      return { t: m.t };
    case 'storyReady':
      return { t: 'storyReady', ...(isStr(m.stopId, 40) ? { stopId: m.stopId } : {}) };
    case 'storyFinale':
      return m.choice === 'cutthroat' || m.choice === 'bank' ? { t: 'storyFinale', choice: m.choice } : null;
    case 'venue':
      return isVenueChoice(m.venue) ? { t: 'venue', venue: m.venue } : null;
    case 'teamName': {
      if (typeof m.name !== 'string' || m.name.length > 200) return null;
      return { t: 'teamName', name: m.name }; // the room validates it (cleanTeamName) so it can say why
    }
    case 'config': {
      if (!isObj(m.rules)) return null;
      const out: Extract<ClientMsg, { t: 'config' }> = { t: 'config', rules: m.rules as unknown as TableRules, botLevel: typeof m.botLevel === 'string' && (BOT_LEVELS as readonly string[]).includes(m.botLevel) ? (m.botLevel as BotLevel) : undefined };
      if (isInt(m.talkSec) && (TALK_SECS as readonly number[]).includes(m.talkSec)) out.talkSec = m.talkSec;
      if (isInt(m.afkLimit) && (AFK_LIMITS as readonly number[]).includes(m.afkLimit)) out.afkLimit = m.afkLimit;
      if (typeof m.partnerMicMute === 'boolean') out.partnerMicMute = m.partnerMicMute;
      if (typeof m.botTalk === 'boolean') out.botTalk = m.botTalk;
      if (typeof m.aiTalk === 'boolean') out.aiTalk = m.aiTalk;
      if (typeof m.talkIntensity === 'string' && (TALK_INTENSITIES as readonly string[]).includes(m.talkIntensity)) out.talkIntensity = m.talkIntensity as TalkIntensity;
      if (typeof m.nukeIntensity === 'string' && (NUKE_INTENSITIES as readonly string[]).includes(m.nukeIntensity)) out.nukeIntensity = m.nukeIntensity as NukeIntensity;
      return out;
    }
    case 'music': {
      const mu = m.music;
      if (!isObj(mu)) return null;
      if (mu.mode === 'off') return { t: 'music', music: { mode: 'off' } };
      if (mu.mode === 'beat' && isInt(mu.track) && mu.track >= 0 && mu.track < MAX_BEAT_TRACKS) return { t: 'music', music: { mode: 'beat', track: mu.track, startAt: 0 } };
      if (mu.mode === 'link' && isStr(mu.url, 300) && isMusicLink(mu.url)) return { t: 'music', music: { mode: 'link', url: mu.url, title: isStr(mu.title, 200) ? mu.title : '' } };
      if (mu.mode === 'stream') return { t: 'music', music: { mode: 'stream', by: '', title: isStr(mu.title, 200) ? mu.title : '' } };
      return null;
    }
    case 'act': {
      const action = parseAction(m.action);
      if (!action) return null;
      const out: Extract<ClientMsg, { t: 'act' }> = { t: 'act', action };
      if (isInt(m.seq) && m.seq >= 0) out.seq = m.seq;
      if (isStr(m.id, 40) && m.id.length > 0) out.id = m.id;
      return out;
    }
    case 'chat':
      return isStr(m.text, 1000) ? { t: 'chat', text: m.text } : null;
    case 'react':
      return isInt(m.id) && m.id > 0 && typeof m.emoji === 'string' && isReactionEmoji(m.emoji)
        ? { t: 'react', id: m.id, emoji: m.emoji }
        : null;
    case 'media':
      return isObj(m.media) ? { t: 'media', media: { cam: m.media.cam === true, mic: m.media.mic === true } } : null;
    case 'learning':
      return { t: 'learning', on: m.on === true };
    case 'interactive':
      return { t: 'interactive', on: m.on === true };
    case 'tableOpts': {
      const out: Extract<ClientMsg, { t: 'tableOpts' }> = { t: 'tableOpts' };
      if (typeof m.private === 'boolean') out.private = m.private;
      if (typeof m.replaceBots === 'boolean') out.replaceBots = m.replaceBots;
      return out;
    }
    case 'rtc':
      if (!isStr(m.to, 64) || m.data === undefined) return null;
      if (JSON.stringify(m.data).length > LIMITS.rtcMax) return null;
      return { t: 'rtc', to: m.to, data: m.data };
    default:
      return null;
  }
}

/* -------------------------------------------------------------- room codes */
/** Unambiguous alphabet (no 0/O, 1/I/L). */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;
export function isRoomCode(s: string): boolean {
  return s.length === CODE_LENGTH && [...s].every((c) => CODE_ALPHABET.includes(c));
}
export function normalizeRoomCode(s: string): string {
  return s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
