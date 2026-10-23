/**
 * Persona ledger — the device-local record of YOUR history with each bot
 * persona (owner, 2026-10-23: personas should "remember the historical games
 * they've played against you... and speak to the metrics").
 *
 * CONTRACT (shared with the persona-memory writer — keep the two in sync):
 * - Storage: localStorage key `bwm.personaLedger.v1`, one JSON object.
 * - Keyed by PersonaId (packages/bots PERSONAS) — a persona is the recurring
 *   character identity; names that map to it share its record.
 * - Two splits per persona:
 *     vs       — games where the persona sat AGAINST the viewer
 *     together — games where the persona sat as the viewer's PARTNER
 * - Every split is { games, wins, losses, streak } from the VIEWER's side:
 *   wins/losses are the viewer's, and `streak` is signed — positive = the
 *   viewer's current win streak in that split, negative = current loss
 *   streak, 0 = no games yet (or unknown). Talk lines spoken BY a persona
 *   invert the numbers at read time ("I'm up 7–4" = viewer is 4–7).
 * - The writer records COMPLETED games only (abandoned games never count),
 *   only in contexts it owns (offline bot tables); a missing entry means
 *   "no recorded meetings" — readers must treat that as an honest empty,
 *   never as a zero-filled record to present as fact.
 *
 * This module is the READ side plus the canonical types. It never writes.
 */
import type { PersonaId } from '@spades/bots';

export const PERSONA_LEDGER_KEY = 'bwm.personaLedger.v1';

export interface PersonaLedgerSplit {
  games: number;
  /** viewer's wins in this split */
  wins: number;
  /** viewer's losses in this split */
  losses: number;
  /** signed, viewer-perspective: + current win streak, − current loss streak */
  streak: number;
}

export interface PersonaLedgerEntry {
  vs?: PersonaLedgerSplit;
  together?: PersonaLedgerSplit;
}

export interface PersonaLedger {
  v: 1;
  personas: Partial<Record<PersonaId, PersonaLedgerEntry>>;
}

export const EMPTY_LEDGER: PersonaLedger = { v: 1, personas: {} };

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;

/** One split, sanitized: only a well-formed split with at least one game survives;
 *  anything else is "no record" (null), never a repaired zero. */
export function sanitizeLedgerSplit(raw: unknown): PersonaLedgerSplit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.games) || !isNum(r.wins) || !isNum(r.losses)) return null;
  const games = Math.floor(r.games);
  if (games <= 0) return null;
  const streak = typeof r.streak === 'number' && Number.isFinite(r.streak) ? Math.trunc(r.streak) : 0;
  return { games, wins: Math.floor(r.wins), losses: Math.floor(r.losses), streak };
}

/** Parse the stored ledger tolerantly: malformed JSON, wrong version, or junk
 *  entries all degrade to an empty record — readers never throw and never
 *  present repaired numbers as fact. */
export function parsePersonaLedger(raw: string | null | undefined): PersonaLedger {
  if (!raw) return EMPTY_LEDGER;
  try {
    const j = JSON.parse(raw) as { v?: unknown; personas?: unknown };
    if (!j || typeof j !== 'object' || !j.personas || typeof j.personas !== 'object') return EMPTY_LEDGER;
    const out: PersonaLedger = { v: 1, personas: {} };
    for (const [id, entry] of Object.entries(j.personas as Record<string, unknown>)) {
      if (!entry || typeof entry !== 'object') continue;
      const e = entry as Record<string, unknown>;
      const vs = sanitizeLedgerSplit(e.vs);
      const together = sanitizeLedgerSplit(e.together);
      if (vs || together) {
        out.personas[id as PersonaId] = { ...(vs ? { vs } : {}), ...(together ? { together } : {}) };
      }
    }
    return out;
  } catch {
    return EMPTY_LEDGER;
  }
}

/** Read the ledger from device storage (synchronous — safe at intro time, the
 *  versus screen never waits on it). */
export function readPersonaLedger(): PersonaLedger {
  try {
    return parsePersonaLedger(window.localStorage.getItem(PERSONA_LEDGER_KEY));
  } catch {
    return EMPTY_LEDGER;
  }
}

/** The viewer's record with one persona, per relationship. Null split = no
 *  recorded meetings in that relationship. */
export function personaRecord(ledger: PersonaLedger, persona: PersonaId | null | undefined): PersonaLedgerEntry | null {
  if (!persona) return null;
  return ledger.personas[persona] ?? null;
}
