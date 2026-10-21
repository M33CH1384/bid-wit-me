/**
 * Live highlights (league data wave, item 6b): notable moments from ONLINE
 * games in progress, captured by the room at the points where it already
 * resolves them — a trick completing (nuke) and a hand ending (Boston,
 * made nils / blind nils, Wheels). The table DO stores them here; the
 * ticker reads them back via GET /api/social/highlights.
 *
 * Honesty rules, same as everywhere in the league build:
 *  - public display names only, and only for people actually at the table:
 *    an event is reported when at least one HUMAN (signed-in or guest)
 *    is on the acting side / seat. Bot-only moments are not league news.
 *  - offline games never appear — they aren't on the server.
 *  - the store is bounded (latest ~30 events, pruned on write) and reads
 *    drop anything older than 15 minutes: a highlight is live news, not
 *    history. Finished-match results live in the results feed instead.
 *
 * The extraction helpers are pure functions of the records the room
 * already has (completed tricks, the finished hand's HandRecord), so what
 * counts as a Boston / Wheels matches the stats pipeline's definitions
 * exactly (see the wheels predicate in stats/record.ts).
 */
import { type Card, type HandRecord, isNukeTrick } from '@spades/rules';

export type HighlightType = 'nuke' | 'boston' | 'nil' | 'blindNil' | 'wheels';

export interface HighlightEvent {
  /** deterministic per (table, hand, type, principal): replays dedupe */
  id: string;
  at: number;
  type: HighlightType;
  /** the principal's public display name(s) — a player, or "A + B" for a side */
  name: string;
  /** the ticker-ready description, without the LIVE prefix (the client adds it) */
  text: string;
  /** the table code the moment happened at */
  code: string;
  hand: number | null;
  /** marquee tier (item 7): also posted to global chat as a League Wire line */
  marquee: boolean;
}

export interface HighlightSeat { name: string; kind: 'user' | 'guest' | 'bot'; side: number }

export const HIGHLIGHT_TTL_MS = 15 * 60_000;
const KEEP = 30;
const PRUNE_AGE_MS = 60 * 60_000;

const isHuman = (s: HighlightSeat) => s.kind === 'user' || s.kind === 'guest';

/** The human names on a side ("A + B"), or null when the side is all bots. */
function sideName(seats: HighlightSeat[], side: number): string | null {
  const humans = seats.filter((s) => s.side === side && isHuman(s)).map((s) => s.name);
  return humans.length ? humans.join(' + ') : null;
}

/** Nuke events from tricks that just completed (the room's fresh tricks). */
export function trickHighlights(o: {
  tricks: readonly { plays: readonly { seat: number; card: Card }[] }[];
  seats: HighlightSeat[]; code: string; handNo: number; at: number;
}): HighlightEvent[] {
  const out: HighlightEvent[] = [];
  for (const t of o.tricks) {
    if (!isNukeTrick(t.plays)) continue;
    const bj = t.plays.find((p) => p.card === 'BJ');
    if (!bj) continue;
    const seat = o.seats[bj.seat];
    if (!seat || !isHuman(seat)) continue;
    out.push({
      id: `${o.code}:${o.handNo}:nuke:${bj.seat}`, at: o.at, type: 'nuke', name: seat.name,
      text: `☢ ${seat.name}'s nuke blew in Hand ${o.handNo}`, code: o.code, hand: o.handNo, marquee: true,
    });
  }
  return out;
}

/** Hand-end events from the finished hand's record. */
export function handHighlights(o: {
  rec: HandRecord; seats: HighlightSeat[]; partnerships: boolean; code: string; at: number;
}): HighlightEvent[] {
  const { rec } = o;
  const out: HighlightEvent[] = [];
  const totalTricks = rec.sides.reduce((a, s) => a + s.tricks, 0);
  const booksHand = rec.bids.every((b) => b === 'books');
  for (const s of rec.sides) {
    const name = sideName(o.seats, s.side);
    if (name) {
      // Boston: the side took every book in the hand.
      const boston = totalTricks >= 13 && s.tricks === totalTricks;
      if (boston) {
        out.push({
          id: `${o.code}:${rec.handNo}:boston:${s.side}`, at: o.at, type: 'boston', name,
          text: `${name} just ran a Boston in Hand ${rec.handNo}`, code: o.code, hand: rec.handNo, marquee: true,
        });
      } else {
        // Wheels — the same predicate the stats pipeline stores per player
        // (record.ts): partnerships need a made 10+ contract (or a books
        // hand with 10+), cutthroat just 10+ tricks. A Boston hand already
        // headlined above; don't double-report the same hand for a side.
        const wheels = o.partnerships
          ? (s.contract >= 10 && s.contractMade === true) || (booksHand && s.tricks >= 10)
          : s.tricks >= 10;
        if (wheels) {
          out.push({
            id: `${o.code}:${rec.handNo}:wheels:${s.side}`, at: o.at, type: 'wheels', name,
            text: `${name} took Wheels in Hand ${rec.handNo}`, code: o.code, hand: rec.handNo, marquee: true,
          });
        }
      }
    }
    // Made nils name the seat, not the side — and only human seats.
    for (const n of s.nils) {
      if (!n.made) continue;
      const seat = o.seats[n.seat];
      if (!seat || !isHuman(seat)) continue;
      const blind = n.kind === 'blindNil';
      out.push({
        id: `${o.code}:${rec.handNo}:${blind ? 'blindNil' : 'nil'}:${n.seat}`, at: o.at,
        type: blind ? 'blindNil' : 'nil', name: seat.name,
        text: blind ? `${seat.name} made a BLIND NIL in Hand ${rec.handNo}` : `${seat.name} made a nil in Hand ${rec.handNo}`,
        code: o.code, hand: rec.handNo, marquee: blind,
      });
    }
  }
  return out;
}

/** Store one event and prune: older than an hour out, newest ~30 kept. */
export async function recordHighlight(db: D1Database, ev: HighlightEvent): Promise<void> {
  await db.prepare('INSERT OR REPLACE INTO live_highlights (id, at, type, name, text, code, hand) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(ev.id, ev.at, ev.type, ev.name, ev.text, ev.code, ev.hand).run();
  await db.prepare('DELETE FROM live_highlights WHERE at < ?').bind(ev.at - PRUNE_AGE_MS).run();
  await db.prepare(`DELETE FROM live_highlights WHERE id NOT IN (SELECT id FROM live_highlights ORDER BY at DESC, id DESC LIMIT ${KEEP})`).run();
}

/** The ticker's read: newest first, nothing older than the TTL. */
export async function recentHighlights(db: D1Database, now: number, limit = 12): Promise<Omit<HighlightEvent, 'marquee'>[]> {
  const rows = (await db.prepare('SELECT id, at, type, name, text, code, hand FROM live_highlights WHERE at > ? ORDER BY at DESC, id DESC LIMIT ?')
    .bind(now - HIGHLIGHT_TTL_MS, limit)
    .all<{ id: string; at: number; type: string; name: string; text: string; code: string; hand: number | null }>()).results;
  return rows.map((r) => ({ id: r.id, at: r.at, type: r.type as HighlightType, name: r.name, text: r.text, code: r.code, hand: r.hand }));
}
