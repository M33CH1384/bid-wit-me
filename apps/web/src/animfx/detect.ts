/**
 * Animation package (owner, 2026-10-20 — "Build all of them"): pure trigger
 * detection for the in-game scenario animations. Every predicate reads REAL
 * game state only — bids, completed tricks, hand records, score state,
 * elimination flags. If the engine didn't do it, nothing fires; there are no
 * random or decorative triggers in here. Kept pure so the whole package's
 * judgement calls (thresholds, predicates) are unit-testable in one place.
 */
import {
  type GameState, type HandRecord, type TableRules, type Trick,
  isNilBid, isTrump, sideOf, sideSeats,
} from '@spades/rules';
import { wheelsMade } from '../landCue';

/* ------------------------------------------------------------ thresholds */

/**
 * Match point: a side pulses when it is tied for the lead and one realistic
 * hand from the target. A full 10+ contract hand is worth ~100+ points, so
 * "within 100 of the target" is the honest one-hand reach.
 */
export const MATCH_POINT_REACH = 100;
/** Comeback: the side was down by at least this much before the hand… */
export const COMEBACK_DEFICIT = 100;
/** …and the hand closed it to this much or less (or took the lead). */
export const COMEBACK_CLOSE = 25;

/* ---------------------------------------------------------------- bidding */

/** Seats whose nil (or blind nil) is still live: bid in, no trick taken yet. */
export function nilLiveSeats(st: Pick<GameState, 'bids' | 'tricksWon'>): number[] {
  const out: number[] = [];
  st.bids.forEach((b, seat) => {
    if (isNilBid(b) && (st.tricksWon[seat] ?? 0) === 0) out.push(seat);
  });
  return out;
}

/** Seats playing a blind nil this hand. */
export function blindNilSeats(st: Pick<GameState, 'bids'>): number[] {
  const out: number[] = [];
  st.bids.forEach((b, seat) => { if (b === 'blindNil') out.push(seat); });
  return out;
}

/* ------------------------------------------------------------- during play */

/**
 * A trick was CUT: the winner took it with a trump on a trick where trump
 * was not led. (Out-trumping a led trump is a fair beat, not a cut.)
 */
export function trickWasCut(trick: Trick, rules: TableRules): boolean {
  if (trick.winner === null || trick.plays.length < 2) return false;
  const led = trick.plays[0]!;
  if (isTrump(led.card, rules)) return false;
  const win = trick.plays.find((p) => p.seat === trick.winner);
  return !!win && isTrump(win.card, rules);
}

/** The seat that played the Big Joker in this trick, or null. */
export function bigJokerSeat(trick: Trick): number | null {
  const p = trick.plays.find((p) => p.card === 'BJ');
  return p ? p.seat : null;
}

/* --------------------------------------------------------------- hand end */

/** Sides the scored record hit with a 10-bag penalty this hand. */
export function bagPenaltySides(rec: HandRecord): number[] {
  return rec.sides.filter((s) => s.bagPenaltyCount > 0).map((s) => s.side);
}

/** Sides whose bag total crossed a multiple of 10 between two totals. */
export function bagsCrossed(prev: readonly number[], next: readonly number[]): number[] {
  const out: number[] = [];
  next.forEach((bags, side) => {
    if (Math.floor(bags / 10) > Math.floor((prev[side] ?? 0) / 10)) out.push(side);
  });
  return out;
}

/** Sides that took EVERY book of the hand (a Boston). */
export function bostonSides(rec: HandRecord): number[] {
  const total = rec.tricksWon.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  return rec.sides.filter((s) => s.tricks === total).map((s) => s.side);
}

/**
 * Sides that made Wheels on this record: the game's own team predicate
 * (landCue.wheelsMade — bid 10+ together, home), plus the stats engine's
 * cutthroat reading (a solo player who took 10+ books).
 */
export function wheelsSides(rec: HandRecord, rules: TableRules): number[] {
  const out = new Set(wheelsMade(rules, rec).map((w) => w.side));
  if (!rules.partnerships) {
    for (const s of rec.sides) if (s.tricks >= 10) out.add(s.side);
  }
  return [...out];
}

/**
 * Comeback surge: a side that started the hand down by COMEBACK_DEFICIT+
 * and finished it within COMEBACK_CLOSE of the lead (or ahead of it).
 */
export function comebackSides(rec: HandRecord): number[] {
  const out: number[] = [];
  for (const s of rec.sides) {
    const before = s.totalScore - s.points;
    const bestOppBefore = Math.max(...rec.sides.filter((o) => o.side !== s.side).map((o) => o.totalScore - o.points));
    const bestOppAfter = Math.max(...rec.sides.filter((o) => o.side !== s.side).map((o) => o.totalScore));
    if (bestOppBefore - before >= COMEBACK_DEFICIT && bestOppAfter - s.totalScore <= COMEBACK_CLOSE) out.push(s.side);
  }
  return out;
}

/* ------------------------------------------------------------ match state */

/**
 * Sides at match point: tied for the lead, game still live, and within
 * MATCH_POINT_REACH of the target (one big hand from winning it all).
 */
export function matchPointSides(st: Pick<GameState, 'scores' | 'rules' | 'phase' | 'result'>): number[] {
  if (st.result || st.phase === 'gameOver') return [];
  const target = st.rules.targetScore;
  const lead = Math.max(...st.scores);
  if (lead <= 0) return [];
  const out: number[] = [];
  st.scores.forEach((score, side) => {
    const remaining = target - score;
    if (score === lead && remaining > 0 && remaining <= MATCH_POINT_REACH) out.push(side);
  });
  return out;
}

/** Seats eliminated between two snapshots (false → true edges). */
export function newlyEliminated(prev: readonly boolean[] | undefined, next: readonly boolean[] | undefined): number[] {
  if (!next) return [];
  const out: number[] = [];
  next.forEach((dead, seat) => { if (dead && !(prev?.[seat] ?? false)) out.push(seat); });
  return out;
}

/** The seats belonging to a side (re-exported for the layer's convenience). */
export function seatsOfSide(rules: TableRules, side: number): number[] {
  return sideSeats(side, rules);
}

/** The side index a seat plays for. */
export function sideIndexOf(rules: TableRules, seat: number): number {
  return sideOf(seat, rules);
}

/* --------------------------------------------------------- wave 2 (owner addendum) */

/**
 * THE SET: sides whose real contract (contract > 0 — a nil-only side has no
 * contract to lose) was set (shot) this hand: contractMade === false in the
 * scored record. The shooting sides are simply the sides NOT in this list.
 */
export function setSides(rec: HandRecord): number[] {
  return rec.sides.filter((s) => s.contractMade === false && s.contract > 0).map((s) => s.side);
}

/**
 * IN SYNC: partnership sides that made their contract with BOTH partners
 * bidding real (numeric) bids — nobody rode a nil or a board to the number.
 */
export function syncSides(rec: HandRecord, rules: TableRules): number[] {
  if (!rules.partnerships) return [];
  return rec.sides
    .filter((s) => s.contractMade === true && s.seats.length === 2 && s.seats.every((seat) => typeof rec.bids[seat] === 'number'))
    .map((s) => s.side);
}

/** An underdog gap (points of average rating) that earns the UPSET stamp. */
export const UPSET_GAP = 150;

/**
 * UPSET math (pure): how far the winners' average rating sits BELOW the
 * losers' average. Positive = the winners were the underdogs. The layer only
 * calls this when every seat at the table resolved to a real (presence)
 * rating — a missing rating means no stamp, never an invented one.
 */
export function ratingGap(winnerRatings: number[], loserRatings: number[]): number {
  if (!winnerRatings.length || !loserRatings.length) return 0;
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return avg(loserRatings) - avg(winnerRatings);
}

/**
 * The seat that claimed "Run it!" once the claim has resolved: the winner
 * of the last trick whose plays carry the engine's run flag (the same scan
 * Table's own runClaimerSeat does — kept here so the layer stays decoupled).
 */
export function runClaimerSeat(tricks: readonly Trick[]): number | null {
  for (let i = tricks.length - 1; i >= 0; i--) {
    const t = tricks[i]!;
    if (t.winner !== null && t.plays.some((p) => p.run)) return t.winner;
  }
  return null;
}
