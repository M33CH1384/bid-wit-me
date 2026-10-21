/**
 * Animation package (owner, 2026-10-20 — "Build all of them"): pure trigger
 * detection for the in-game scenario animations. Every predicate reads REAL
 * game state only — bids, completed tricks, hand records, score state,
 * elimination flags. If the engine didn't do it, nothing fires; there are no
 * random or decorative triggers in here. Kept pure so the whole package's
 * judgement calls (thresholds, predicates) are unit-testable in one place.
 */
import {
  type Bid, type GameResult, type GameState, type HandRecord, type TableRules, type Trick,
  booksStillNeeded, isNilBid, isTrump, naturalSuit, partnerOf, sideCount, sideOf, sideSeats,
  trickWinner, tricksStillRemaining,
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

/* ================= wave 3 (owner addendum 2, 2026-10-21) =================
 * Ten more moments on the same contract as waves 1–2: pure predicates over
 * real state, presentational only, silent. */

/* --------------------------------------------------------------------------
 * 1. THE SAVE — in a hand with a LIVE nil: the nil bidder's played card was
 * the trick's standing winner at the moment they played it (they were about
 * to take a trick and bust), and their partner went on to WIN that trick.
 * Play order inside a completed trick is exact: completed tricks store
 * their plays in play order (the rules package rotates them leader-first
 * without reordering), so "standing winner at the bidder's turn" is
 * reconstructed precisely by scoring the play prefix ending at their card
 * with the engine's own trickWinner — no approximation needed.
 * `wonBefore` = tricks each seat had already taken BEFORE this trick (the
 * bidder must still be clean — a bidder who already took one is busted, not
 * saved). Partnership only: cutthroat has no partner to save anyone.
 * ------------------------------------------------------------------------ */
export function saveInTrick(
  trick: Trick,
  bids: readonly (Bid | null)[],
  rules: TableRules,
  wonBefore: readonly number[],
): { bidder: number; saver: number } | null {
  if (!rules.partnerships || trick.winner === null) return null;
  const saver = trick.winner;
  const bidder = partnerOf(saver, rules);
  if (bidder === null || bidder === saver) return null;
  if (!isNilBid(bids[bidder])) return null;
  if ((wonBefore[bidder] ?? 0) > 0) return null;
  const idx = trick.plays.findIndex((p) => p.seat === bidder);
  if (idx < 0) return null;
  return trickWinner(trick.plays.slice(0, idx + 1), rules) === bidder
    ? { bidder, saver }
    : null;
}

/* --------------------------------------------------------------------------
 * 2. NIL, SEALED — at hand end, the seats whose nil (or blind nil) the
 * hand's own record says was MADE. Read straight off the scored record.
 * ------------------------------------------------------------------------ */
export function sealedNilSeats(rec: HandRecord): number[] {
  const out = new Set<number>();
  for (const s of rec.sides) for (const n of s.nils) if (n.made) out.add(n.seat);
  return [...out];
}

/* --------------------------------------------------------------------------
 * 3. NIL, BUSTED — the resolve edge: a seat whose nil was LIVE in the
 * previous view (nil bid, zero tricks) has taken a trick in the next view.
 * This is the same edge the nil spotlight ends on, detected from the
 * tricksWon transition alone — it does not care how the spotlight renders.
 * ------------------------------------------------------------------------ */
export function nilBustedSeats(
  prev: Pick<GameState, 'bids' | 'tricksWon'>,
  next: Pick<GameState, 'bids' | 'tricksWon'>,
): number[] {
  return nilLiveSeats(prev).filter((seat) => (next.tricksWon[seat] ?? 0) > 0);
}

/* --------------------------------------------------------------------------
 * 4. SPADES BROKEN — has a spade touched the table yet this hand? A REAL
 * spade only: the jokers are trumps but they are not spades (naturalSuit
 * returns null for them), so a joker lead does not break spades here. The
 * layer arms this per match and fires the ember on the first flip.
 * ------------------------------------------------------------------------ */
export function spadePlayed(tricks: readonly Trick[], current?: Trick | null): boolean {
  const hit = (t: Trick) => t.plays.some((p) => naturalSuit(p.card) === 'S');
  return tricks.some(hit) || (current ? hit(current) : false);
}

/* --------------------------------------------------------------------------
 * 5. ON FIRE — the trailing run of consecutive trick wins inside the
 * CURRENT hand (st.tricks is exactly the current hand's completed tricks,
 * so a run can never leak across hands). At FIRE_STREAK the seat's plate
 * carries the hot rim until another seat takes a trick or the hand ends.
 * ------------------------------------------------------------------------ */
export const FIRE_STREAK = 3;

export function trickStreak(tricks: readonly Trick[]): { seat: number; count: number } | null {
  let seat: number | null = null;
  let count = 0;
  for (let i = tricks.length - 1; i >= 0; i--) {
    const w = tricks[i]!.winner;
    if (w === null) break;
    if (seat === null) { seat = w; count = 1; }
    else if (w === seat) count += 1;
    else break;
  }
  return seat === null ? null : { seat, count };
}

export function fireSeat(st: Pick<GameState, 'tricks'>): number | null {
  const s = trickStreak(st.tricks);
  return s !== null && s.count >= FIRE_STREAK ? s.seat : null;
}

/* --------------------------------------------------------------------------
 * 6. STREAK HEAT — a SIDE that has won HEAT_STREAK or more consecutive
 * hands (by hand points, from the scored history) keeps a flame shimmer on
 * its scorebug cell until it loses a hand. A tied-points hand has no
 * winner and breaks every streak. Cutthroat: sides ARE seats, same math.
 * ------------------------------------------------------------------------ */
export const HEAT_STREAK = 3;

export function handWinnerSide(rec: HandRecord): number | null {
  let best: number | null = null;
  let bestPts = -Infinity;
  let tied = false;
  for (const s of rec.sides) {
    if (s.points > bestPts) { best = s.side; bestPts = s.points; tied = false; }
    else if (s.points === bestPts) tied = true;
  }
  return tied ? null : best;
}

export function heatSides(history: readonly HandRecord[]): number[] {
  let side: number | null = null;
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const w = handWinnerSide(history[i]!);
    if (w === null) break;
    if (side === null) { side = w; n = 1; }
    else if (w === side) n += 1;
    else break;
  }
  return side !== null && n >= HEAT_STREAK ? [side] : [];
}

/* --------------------------------------------------------------------------
 * 7. BAG BRINK — a side whose bags inside the current 10-bag penalty cycle
 * sit at 8 or 9. st.bags is the CUMULATIVE total (the wave-1 penalty math
 * floor-divides the same totals), so the in-cycle count is total mod 10 —
 * one bag from the line is 9, two is 8.
 * ------------------------------------------------------------------------ */
export function bagBrinkSides(bags: readonly number[]): number[] {
  const out: number[] = [];
  bags.forEach((b, side) => {
    const cycle = ((b % 10) + 10) % 10;
    if (cycle === 8 || cycle === 9) out.push(side);
  });
  return out;
}

/* --------------------------------------------------------------------------
 * 8. HIGH CONTRACT — the hand's contracts run hot. The threshold is NOT
 * the naive combined total: in partnership both sides' contracts sum to
 * ~13 in almost every hand, so "combined >= 12" would burn constantly.
 * The honest reading is that the TABLE is over-committed only when EVERY
 * side is carrying a real contract:
 *   partnership — every side's combined numeric bid >= HOT_SIDE_CONTRACT
 *     (nil/'books' bids contribute 0; a nil next to a 7 still counts —
 *     the partner's contract is genuinely huge);
 *   cutthroat — at least 3 numeric bidders and every numeric bid >=
 *     HOT_SEAT_BID (nils sit the seat out of the sum, they don't cool it).
 * Any seat yet to bid (null) means bidding isn't done — never hot early.
 * ------------------------------------------------------------------------ */
export const HOT_SIDE_CONTRACT = 6;
export const HOT_SEAT_BID = 3;

export function contractHeat(st: Pick<GameState, 'rules' | 'bids'>): boolean {
  const { rules, bids } = st;
  if (bids.some((b) => b === null || b === undefined)) return false;
  if (rules.partnerships) {
    for (let side = 0; side < sideCount(rules); side++) {
      const sum = sideSeats(side, rules).reduce(
        (a, seat) => a + (typeof bids[seat] === 'number' ? (bids[seat] as number) : 0),
        0,
      );
      if (sum < HOT_SIDE_CONTRACT) return false;
    }
    return true;
  }
  const nums = bids.filter((b): b is number => typeof b === 'number');
  return nums.length >= 3 && nums.every((b) => b >= HOT_SEAT_BID);
}

/* --------------------------------------------------------------------------
 * 9. DOWN TO THE WIRE — entering the FINAL trick of the hand (exactly one
 * trick still remains, counting the one about to be played) with a side
 * whose contract hangs on that last book: booksStillNeeded is the engine's
 * own arithmetic (combined numeric bid of the side's non-nil seats, nil
 * tricks counted only when the rules say so), so "exactly one book short"
 * is decided by the same numbers the hand will be scored with.
 * ------------------------------------------------------------------------ */
export function wireSides(
  st: Pick<GameState, 'rules' | 'bids' | 'tricksWon' | 'tricks' | 'trickCount' | 'phase'>,
): number[] {
  if (st.phase !== 'playing') return [];
  if (tricksStillRemaining(st) !== 1) return [];
  const out: number[] = [];
  for (let side = 0; side < sideCount(st.rules); side++) {
    if (booksStillNeeded(st.rules, st.bids, st.tricksWon, side) === 1) out.push(side);
  }
  return out;
}

/* --------------------------------------------------------------------------
 * 10. PHOTO FINISH — the game ended within PHOTO_FINISH_MARGIN points:
 * the best winning total minus the best non-winning total. A tie at the
 * top (co-winners) compares against the best LOSER, so shared wins aren't
 * called photo finishes on a 0 "margin".
 * ------------------------------------------------------------------------ */
export const PHOTO_FINISH_MARGIN = 10;

export function winMargin(result: GameResult): number | null {
  const finals = result.finalScores;
  if (!finals?.length) return null;
  const winners = new Set(result.winners);
  const losers = finals.filter((_, i) => !winners.has(i));
  if (!losers.length) return null;
  return Math.max(...finals) - Math.max(...losers);
}

export function photoFinish(result: GameResult): boolean {
  const m = winMargin(result);
  return m !== null && m <= PHOTO_FINISH_MARGIN;
}
