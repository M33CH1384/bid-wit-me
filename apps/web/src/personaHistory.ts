/**
 * Persona memory — the WRITER half of the persona ledger (owner,
 * 2026-10-23). The canonical contract lives in personaLedger.ts
 * (localStorage `bwm.personaLedger.v1`, keyed by PersonaId, vs/together
 * splits of {games, wins, losses, streak} from the VIEWER's side); the
 * versus screen reads it there, and this module is the only writer.
 *
 * Scope, honestly: the ledger lives on THIS device, like the offline
 * stats and the first-meet registry. It is fed only by completed offline
 * bot games (Table's game-over effect — the same hook that records the
 * offline stats and the rematch series), so abandoned games never count,
 * story games never count (their cast has its own memory), and online
 * games never count (those opponents are people). There is no backfill:
 * no existing store keys finished games by persona, so the record starts
 * at zero on ship day and every number a persona cites was earned at
 * this table, on this device.
 *
 * The talk engine (@spades/bots historyTalk.ts) consumes the
 * speaker's-eye view: histViewsForSeats below converts each persona's
 * ledger splits through histViewFromLedger (vs numbers invert — a
 * persona's "I'm up 7–4" is the viewer's 4–7; together numbers don't —
 * partners shared the viewer's side).
 */
import {
  type HistView, type PersonaId,
  histViewAny, histViewFromLedger, personaForName,
} from '@spades/bots';
import {
  PERSONA_LEDGER_KEY, parsePersonaLedger,
  type PersonaLedger, type PersonaLedgerEntry, type PersonaLedgerSplit,
} from './personaLedger';

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function loadPersonaLedger(storage: Store = localStorage): PersonaLedger {
  try {
    return parsePersonaLedger(storage.getItem(PERSONA_LEDGER_KEY));
  } catch { return parsePersonaLedger(null); }
}

function savePersonaLedger(ledger: PersonaLedger, storage: Store): void {
  try { storage.setItem(PERSONA_LEDGER_KEY, JSON.stringify(ledger)); } catch { /* full/blocked — the table just forgets */ }
}

/** One completed game folded into one split, viewer-side: streak extends
 *  while the result repeats, restarts at ±1 when it flips. */
function bumpSplit(split: PersonaLedgerSplit | undefined, viewerWon: boolean): PersonaLedgerSplit {
  const s = split ?? { games: 0, wins: 0, losses: 0, streak: 0 };
  return {
    games: s.games + 1,
    wins: s.wins + (viewerWon ? 1 : 0),
    losses: s.losses + (viewerWon ? 0 : 1),
    streak: viewerWon ? (s.streak > 0 ? s.streak + 1 : 1) : (s.streak < 0 ? s.streak - 1 : -1),
  };
}

export interface PersonaGameResult { persona: PersonaId; role: 'opp' | 'partner'; viewerWon: boolean }

/** Fold one completed game's per-persona results into the ledger (Table calls this once per finished offline game). */
export function recordPersonaResults(results: PersonaGameResult[], storage: Store = localStorage): PersonaLedger {
  const ledger = loadPersonaLedger(storage);
  if (!results.length) return ledger;
  const personas: Partial<Record<PersonaId, PersonaLedgerEntry>> = { ...ledger.personas };
  for (const r of results) {
    const entry: PersonaLedgerEntry = { ...personas[r.persona] };
    if (r.role === 'partner') entry.together = bumpSplit(entry.together, r.viewerWon);
    else entry.vs = bumpSplit(entry.vs, r.viewerWon);
    personas[r.persona] = entry;
  }
  const next: PersonaLedger = { v: 1, personas };
  savePersonaLedger(next, storage);
  return next;
}

/** The gate-ready speaker's-eye view of one persona's record, or undefined when they have no history with the player at all. */
export function personaHistView(persona: PersonaId, storage: Store = localStorage): HistView | undefined {
  const entry = loadPersonaLedger(storage).personas[persona];
  if (!entry) return undefined;
  const v = histViewFromLedger(entry.vs, entry.together);
  return histViewAny(v) ? v : undefined;
}

/**
 * Per-seat record views for a talk table, aligned with `seats`: bot
 * seats get their persona's view (whichever name wears the persona,
 * the character remembers); the human's seat — and any seat whose
 * persona has never met the player — gets undefined, and history talk
 * stays silent for them.
 */
export function histViewsForSeats(seats: { name: string; bot: boolean }[], storage: Store = localStorage): (HistView | undefined)[] {
  const ledger = loadPersonaLedger(storage);
  return seats.map((s) => {
    if (!s.bot) return undefined;
    const entry = ledger.personas[personaForName(s.name)];
    if (!entry) return undefined;
    const v = histViewFromLedger(entry.vs, entry.together);
    return histViewAny(v) ? v : undefined;
  });
}
