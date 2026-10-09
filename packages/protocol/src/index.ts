/**
 * WebSocket protocol between the web client and the Table Durable Object (spec §4.2).
 * Plain TS types + small hand-written guards (no runtime schema lib, to keep the Worker bundle and CPU tiny).
 * Every client message is validated on the server with `parseClientMsg`; anything malformed is dropped.
 */
import type { Card, PlayerView, TableRules } from '@spades/rules';

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

export type ClientMsg =
  | { t: 'hello'; name: string; token?: string; v?: number }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'addBot'; seat: number }
  | { t: 'removeBot'; seat: number }
  | { t: 'config'; rules: TableRules; botLevel?: BotLevel }
  | { t: 'start' }
  | { t: 'act'; action: GameAction }
  | { t: 'next' }
  | { t: 'rematch' }
  | { t: 'chat'; text: string }
  | { t: 'media'; media: MediaState }
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
  /** monotonically increasing state version, handy for clients/tests */
  rev: number;
  /** games started at this table (1 = first game); changes on rematch */
  game: number;
  /** server clock (epoch ms) when this was sent, so clients can correct the deadline for clock skew */
  now: number;
}

export interface ChatLine { id: number; from: string | null; name: string; text: string; at: number; system?: boolean }

export type ServerMsg =
  | { t: 'welcome'; you: string; token: string; code: string; chat: ChatLine[]; v: number }
  | { t: 'state'; room: RoomInfo; seat: number | null; view: PlayerView | null }
  | { t: 'chat'; line: ChatLine }
  | { t: 'rtc'; from: string; data: unknown }
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
    case 'sit': case 'addBot': case 'removeBot':
      return isInt(m.seat) && m.seat >= 0 && m.seat < 4 ? { t: m.t, seat: m.seat } : null;
    case 'stand': case 'start': case 'next': case 'rematch': case 'leave':
      return { t: m.t };
    case 'config':
      if (!isObj(m.rules)) return null;
      return { t: 'config', rules: m.rules as unknown as TableRules, botLevel: m.botLevel === 'easy' || m.botLevel === 'normal' ? m.botLevel : undefined };
    case 'act': {
      const action = parseAction(m.action);
      return action ? { t: 'act', action } : null;
    }
    case 'chat':
      return isStr(m.text, 1000) ? { t: 'chat', text: m.text } : null;
    case 'media':
      return isObj(m.media) ? { t: 'media', media: { cam: m.media.cam === true, mic: m.media.mic === true } } : null;
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
