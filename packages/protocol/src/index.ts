/**
 * WebSocket protocol between the web client and the Table Durable Object (spec §4.2).
 * Plain TS types + small hand-written guards (no runtime schema lib, to keep the Worker bundle and CPU tiny).
 * Every client message is validated on the server with `parseClientMsg`; anything malformed is dropped.
 */
import type { Card, PlayerView, Series, TableRules } from '@spades/rules';
export * from './filter';

/** Built-in host-music tracks the server accepts (the web playlist has 17; headroom for more). */
export const MAX_BEAT_TRACKS = 64;
/** Nuke intensity (table setting): Full Nuke (default) / Classic / Off. */
export const NUKE_INTENSITIES = ['full', 'classic', 'off'] as const;
export type NukeIntensity = (typeof NUKE_INTENSITIES)[number];
/** Extra lead-in after a nuked trick, per table level (ms). */
export const NUKE_ALLOWANCE_MS: Record<NukeIntensity, number> = { full: 4000, classic: 3500, off: 1200 };
export const PROTOCOL_VERSION = 1;

/* ---------------------------------------------------------------- limits */
export const LIMITS = {
  nameMax: 20,
  chatMax: 200,
  /** chat lines per player per 10 s window */
  chatBurst: 5,
  chatHistory: 50,
  /** max members (seated + waiting) per table */
  members: 12,
  /** max size of a relayed WebRTC signaling payload (SDP ~ 3–8 KB) */
  rtcMax: 16_000,
} as const;

export type BotLevel = 'easy' | 'normal';

/* ------------------------------------------------------------ client → server */
export type GameAction =
  | { type: 'reveal' }
  | { type: 'bid'; bid: number | 'nil' | 'blindNil' }
  | { type: 'exchange'; cards: Card[] }
  | { type: 'play'; card: Card };

export interface MediaState { cam: boolean; mic: boolean }

/** Between-hands "Table Talk" countdown choices (seconds). */
export const TALK_SECS = [15, 20, 30, 45] as const;
/** consecutive turn timeouts before a player is replaced by a bot (0 = never) */
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
  | { t: 'hello'; name: string; token?: string; v?: number }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'addBot'; seat: number }
  | { t: 'removeBot'; seat: number }
  | { t: 'config'; rules: TableRules; botLevel?: BotLevel; talkSec?: number; afkLimit?: number; partnerMicMute?: boolean; nukeIntensity?: NukeIntensity; botTalk?: boolean }
  /** rename your own team (team modes); '' resets to the partner names */
  | { t: 'teamName'; name: string }
  /** host only: what plays for the whole table (the server stamps `startAt` for beats) */
  | { t: 'music'; music: HostMusic }
  | { t: 'start' }
  /**
   * A game move. `seq` = the game version (RoomInfo.seq) the move was chosen from: if the game has moved on since
   * (e.g. the turn timer auto-played), the server drops it and answers `ack {stale}` + a fresh state instead of an
   * error. `id` = client-chosen idempotency key: re-sending the same id (e.g. after a reconnect) never applies twice.
   */
  | { t: 'act'; action: GameAction; seq?: number; id?: string }
  | { t: 'next' }
  | { t: 'rematch' }
  | { t: 'chat'; text: string }
  | { t: 'media'; media: MediaState }
  /** "Learning mode" (tips on): this player's own turn timers run 50% longer */
  | { t: 'learning'; on: boolean }
  /** host: kick the player in `seat` now (a bot takes over, no rejoin this game). Anyone else: vote to kick (toggles). */
  | { t: 'kick'; seat: number }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'leave' };

/* ------------------------------------------------------------ server → client */
export type SeatInfo =
  | { kind: 'empty' }
  | { kind: 'bot'; name: string; level: BotLevel }
  | { kind: 'human'; playerId: string; name: string; connected: boolean; media: MediaState; autoplay?: boolean };

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
  /** players (ids) who have pressed "next hand" */
  ready: string[];
  /** monotonically increasing broadcast counter (any change: seats, media, timers, game) */
  rev: number;
  /** game version: bumps only when the game itself changes (a move, auto-play, next hand, new game). Actions carry it. */
  seq: number;
  /** games started at this table (1 = first game); changes on rematch */
  game: number;
  /** server clock (epoch ms) when this was sent, so clients can correct the deadline for clock skew */
  now: number;
  /** between-hands Table Talk countdown (s) */
  talkSec: number;
  /** host music (absent = off) */
  music?: HostMusic;
  /** consecutive timeouts before a bot replaces a player (0 = off) */
  afkLimit?: number;
  /** host option: partners can't hear each other during bidding and play (Table Talk / lobby stay open); default off */
  partnerMicMute?: boolean;
  /** table setting: how big the Big-over-Little-Joker nuke plays for everyone (default full) */
  nukeIntensity?: NukeIntensity;
  /** host option: bots chat (trash talk) at the table; default on */
  botTalk?: boolean;
  /** per side: a custom team name, or null = default (partner names) */
  teamNames?: (string | null)[];
  /** rematch series at this table (survives reconnects; resets when the teams change) */
  series?: Series | null;
  /** open vote-kicks: target player, who voted, votes needed */
  votes?: { target: string; by: string[]; need: number }[];
}

export interface ChatLine { id: number; from: string | null; name: string; text: string; at: number; system?: boolean }

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string; code: string; chat: ChatLine[]; v: number }
  /** `view.history` is null when unchanged since the last state sent on this connection (keep the previous one) */
  | { t: 'state'; room: RoomInfo; seat: number | null; view: PlayerView | null }
  | { t: 'chat'; line: ChatLine }
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
      return isStr(a.card, 2) ? { type: 'play', card: a.card as Card } : null;
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
      return { t: 'hello', name: m.name, token: isStr(m.token, 100) ? m.token : undefined, v: isInt(m.v) ? m.v : undefined };
    case 'sit': case 'addBot': case 'removeBot': case 'kick':
      return isInt(m.seat) && m.seat >= 0 && m.seat < 4 ? { t: m.t, seat: m.seat } : null;
    case 'stand': case 'start': case 'next': case 'rematch': case 'leave':
      return { t: m.t };
    case 'teamName': {
      if (typeof m.name !== 'string' || m.name.length > 200) return null;
      return { t: 'teamName', name: m.name }; // the room validates it (cleanTeamName) so it can say why
    }
    case 'config': {
      if (!isObj(m.rules)) return null;
      const out: Extract<ClientMsg, { t: 'config' }> = { t: 'config', rules: m.rules as unknown as TableRules, botLevel: m.botLevel === 'easy' || m.botLevel === 'normal' ? m.botLevel : undefined };
      if (isInt(m.talkSec) && (TALK_SECS as readonly number[]).includes(m.talkSec)) out.talkSec = m.talkSec;
      if (isInt(m.afkLimit) && (AFK_LIMITS as readonly number[]).includes(m.afkLimit)) out.afkLimit = m.afkLimit;
      if (typeof m.partnerMicMute === 'boolean') out.partnerMicMute = m.partnerMicMute;
      if (typeof m.botTalk === 'boolean') out.botTalk = m.botTalk;
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
    case 'media':
      return isObj(m.media) ? { t: 'media', media: { cam: m.media.cam === true, mic: m.media.mic === true } } : null;
    case 'learning':
      return { t: 'learning', on: m.on === true };
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
