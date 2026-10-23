/**
 * Persona memory (owner, 2026-10-23): regular-table bot personas keep a
 * running record against THIS player — meetings, wins, losses, the current
 * streak, the last result, kept separately as OPPONENT and as PARTNER —
 * and talk crap from it, ahead or behind, in their own register
 * (historyPools.ts). This module is the pure half: the conversion from
 * the stored record to a speaker's-eye view, and the truth gates every
 * history line must pass.
 *
 * The record itself is the persona ledger (web: personaLedger.ts holds
 * the canonical contract — localStorage `bwm.personaLedger.v1`, keyed by
 * PersonaId, splits {games, wins, losses, streak} from the VIEWER's
 * side; web: personaHistory.ts is the writer). It is fed ONLY by
 * completed offline bot games, from ship day forward. There is no
 * backfill: no existing store keys results by persona, so the record
 * honestly starts at zero and the gates below keep a persona from citing
 * a history it doesn't have — a first meeting has NO history talk, by
 * construction, not by politeness.
 *
 * Gates (a line may fire only when every number it cites is true):
 * - series talk (ahead / behind) needs 3+ meetings;
 * - dead-even talk needs 4+ (a 1–1 "series" is two games, not a saga);
 * - streak talk needs a streak of 2+ either way;
 * - last-meeting talk needs exactly that: a completed last meeting;
 * - partner talk needs 2+ games together; the together-series needs 3+.
 * Persona ids are the identity: whichever bot name wears the persona,
 * the record is the character's — the Professor remembers being the
 * Professor. Partner games never touch the vs record and vice versa, so
 * a partner can never cite a "record against you" that doesn't exist.
 */
import type { PersonaId } from './personas';

/**
 * One split of the stored persona ledger, exactly as the web contract
 * defines it (personaLedger.ts): numbers from the VIEWER's side —
 * wins/losses are the viewer's, and `streak` is signed viewer-side
 * (+ the viewer's current win streak, − their loss streak).
 */
export interface LedgerSplit {
  games: number;
  wins: number;
  losses: number;
  streak: number;
}

/** The flattened, gate-ready view of a record — what TalkEvent.hist carries, one entry per seat.
 *  Persona-side throughout: w/l/streak/last are the SPEAKER's, so a line's
 *  slots ({hw} = "my wins") read true as spoken. */
export interface HistView {
  g: number; w: number; l: number; streak: number; last: 'W' | 'L' | null;
  tg: number; tw: number; tl: number;
}

/**
 * Convert a persona's ledger splits into the speaker's-eye view. The vs
 * split inverts (the persona's wins are the viewer's losses; the streak
 * flips sign; the last result is the streak's sign, since a nonzero
 * streak always ends at the most recent meeting). The together split
 * does NOT invert wins — persona and viewer were on the same side, so
 * the partnership's wins are the viewer's wins. A split with a zero
 * streak but games played (foreign/legacy data) yields last = null:
 * last-meeting talk sits out rather than guess.
 */
export function histViewFromLedger(vs?: LedgerSplit | null, together?: LedgerSplit | null): HistView {
  return {
    g: vs?.games ?? 0,
    w: vs?.losses ?? 0,
    l: vs?.wins ?? 0,
    streak: vs?.streak ? -vs.streak : 0,
    last: !vs || vs.games <= 0 || vs.streak === 0 ? null : vs.streak < 0 ? 'W' : 'L',
    tg: together?.games ?? 0,
    tw: together?.wins ?? 0,
    tl: together?.losses ?? 0,
  };
}
/** True when the record holds anything at all (a first meeting has no view). */
export const histViewAny = (v: HistView): boolean => v.g > 0 || v.tg > 0;

/**
 * A truth requirement a history line makes on its speaker's record,
 * carried in LINE_META (personas.ts) and enforced in talk.ts's pick():
 * a line whose requirement fails — or whose speaker has no view at
 * all — sits out, exactly like a {bid} line without a bid.
 */
export type HistReq =
  | 'ahead'       // persona leads the vs series (3+ meetings)
  | 'behind'      // player leads the vs series (3+) — the comeback framing, never a concession
  | 'even'        // dead level (4+)
  | 'streak'      // persona has won 2+ straight
  | 'streakVs'    // player has won 2+ straight — persona talks about ending it
  | 'aheadStreak' // persona leads the series AND is streaking (the compound boast)
  | 'lastW'       // persona won the last completed meeting
  | 'lastL'       // player won the last completed meeting
  | 'tog'         // 2+ games together as partners
  | 'togAhead'    // partnership leads its together series (3+)
  | 'togBehind';  // partnership trails its together series (3+) — the rally framing

export const HIST_MIN_SERIES = 3;
export const HIST_MIN_STREAK = 2;
export const HIST_MIN_TOGETHER = 2;

export function histOk(req: HistReq, v: HistView | undefined): boolean {
  if (!v) return false;
  switch (req) {
    case 'ahead': return v.g >= HIST_MIN_SERIES && v.w > v.l;
    case 'behind': return v.g >= HIST_MIN_SERIES && v.l > v.w;
    case 'even': return v.g >= 4 && v.w === v.l;
    case 'streak': return v.streak >= HIST_MIN_STREAK;
    case 'streakVs': return v.streak <= -HIST_MIN_STREAK;
    case 'aheadStreak': return v.g >= HIST_MIN_SERIES && v.w > v.l && v.streak >= HIST_MIN_STREAK;
    case 'lastW': return v.last === 'W';
    case 'lastL': return v.last === 'L';
    case 'tog': return v.tg >= HIST_MIN_TOGETHER;
    case 'togAhead': return v.tg >= HIST_MIN_SERIES && v.tw > v.tl;
    case 'togBehind': return v.tg >= HIST_MIN_SERIES && v.tl > v.tw;
  }
}

/** The template slots a history line may cite — filled from the speaker's view in talk.ts's fill(). */
export const HIST_SLOTS = ['hw', 'hl', 'streak', 'tw', 'tl', 'tg'] as const;
export type { PersonaId };
