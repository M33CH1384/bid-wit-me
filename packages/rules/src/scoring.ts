import { type TableRules, bagsOnOf, blindNilRulesOf, handSize, hostMinimum, nilRulesOf, shotOutOn } from './config';

/**
 * A bid: a number of tricks (≥1), Nil, or Blind Nil. A numeric 0 is normalised to 'nil'.
 * 'books' is never chosen by a player: it is the automatic bid of the "first hand: books bid themselves" hand.
 */
export type Bid = number | 'nil' | 'blindNil' | 'books';

/** Points per book in a books-bid-themselves hand. */
export const BOOK_VALUE = 10;

/** True for the automatic first hand where nobody bids and every book is worth 10. */
export function isBooksHand(bids: readonly (Bid | null)[]): boolean {
  return bids.length > 0 && bids.every((b) => b === 'books');
}

export function isNilBid(b: Bid | null | undefined): b is 'nil' | 'blindNil' {
  return b === 'nil' || b === 'blindNil';
}

export function bidLabel(b: Bid | null | undefined): string {
  if (b === null || b === undefined) return '—';
  if (b === 'nil') return 'Nil';
  if (b === 'blindNil') return 'Blind Nil';
  if (b === 'books') return 'Books';
  return String(b);
}

/** Number of scoring sides: 2 teams with partnerships, otherwise one per player. */
export function sideCount(r: TableRules): number {
  return r.partnerships ? 2 : r.playerCount;
}

export function sideOf(seat: number, r: TableRules): number {
  return r.partnerships ? seat % 2 : seat;
}

export function sideSeats(side: number, r: TableRules): number[] {
  return r.partnerships ? [side, side + 2] : [side];
}

export function partnerOf(seat: number, r: TableRules): number | null {
  return r.partnerships ? (seat + 2) % 4 : null;
}

export interface NilResult {
  seat: number;
  kind: 'nil' | 'blindNil';
  tricks: number;
  made: boolean;
  points: number;
}

export interface SideHandResult {
  side: number;
  seats: number[];
  /** Combined numeric bid of the non-nil players (0 if everyone on the side bid nil). */
  contract: number;
  /** Tricks counting toward the contract. */
  contractTricks: number;
  /** All tricks taken by the side. */
  tricks: number;
  contractMade: boolean | null; // null when there was no contract
  contractPoints: number;
  nils: NilResult[];
  bagsAdded: number;
  bagPenaltyCount: number;
  bagPenaltyPoints: number;
  /** First hand (books bid themselves): 10 per book taken. 0 otherwise. */
  bookPoints: number;
  /** Net points for this hand. */
  points: number;
  totalScore: number;
  totalBags: number;
  /** "Shot" this hand (set, or short of the first-hand minimum). Set by the game (finishHand) when Shot = out is on. */
  shot?: boolean;
  /** Cutthroat: this player was eliminated when the hand was scored. The sheet stays on. */
  out?: boolean;
}

/**
 * Scores one hand (spec §3.1). `bids` and `tricksWon` are per seat; `scores`/`bags` are per side before the hand.
 * - Contract made: +10×bid (+20×bid with tenForTwoHundred and bid ≥10) plus +1 per overtrick (bag).
 * - Contract set: −10×bid.
 * - Nil: ±nil.value; Blind Nil: ±blindNil.value, scored separately from the partner's contract.
 * - Tricks by a Nil bidder: bags (+1 each) by default, or count toward the partner's contract.
 * - Every `bagsPerPenalty` accumulated bags: −bagPenalty and the bag count drops accordingly.
 * - 'books' (first hand bids itself): +10 per trick taken, no bags added (so no penalty can trigger that hand).
 */
export function scoreHand(
  r: TableRules,
  bids: readonly Bid[],
  tricksWon: readonly number[],
  scores: readonly number[],
  bags: readonly number[],
): SideHandResult[] {
  const out: SideHandResult[] = [];
  for (let side = 0; side < sideCount(r); side++) {
    const seats = sideSeats(side, r);
    let contract = 0, contractTricks = 0, nilTricks = 0, tricks = 0, nilPoints = 0, bookPoints = 0;
    const nils: NilResult[] = [];
    for (const s of seats) {
      const b = bids[s]!;
      const t = tricksWon[s]!;
      tricks += t;
      if (b === 'books') {
        bookPoints += BOOK_VALUE * t; // first hand: every book counts, no bags
      } else if (isNilBid(b)) {
        const value = b === 'nil' ? nilRulesOf(r).value : blindNilRulesOf(r).value;
        const made = t === 0;
        const points = made ? value : -value;
        nils.push({ seat: s, kind: b, tricks: t, made, points });
        nilPoints += points;
        nilTricks += t;
      } else {
        contract += b;
        contractTricks += t;
      }
    }
    let bagsAdded = 0;
    if (r.nilTricksCountForPartner) contractTricks += nilTricks;
    else bagsAdded += nilTricks;

    let contractPoints = 0;
    let contractMade: boolean | null = null;
    if (contract > 0) {
      contractMade = contractTricks >= contract;
      if (contractMade) {
        contractPoints = (r.tenForTwoHundred && contract >= 10 ? 20 : 10) * contract;
        bagsAdded += contractTricks - contract;
      } else {
        contractPoints = -10 * contract;
      }
    } else if (r.nilTricksCountForPartner) {
      bagsAdded += contractTricks; // no contract: every trick is a bag
    }

    if (isBooksHand(bids)) {
      const floor = hostMinimum(r);
      if (floor > 0 && tricks < floor) {
        // Short of the host minimum: a set at that number, not 10 points per book taken.
        bookPoints = 0;
        contract = floor;
        contractMade = false;
        contractPoints = -10 * floor;
      }
    }
    if (!bagsOnOf(r)) bagsAdded = 0; // "Bags and penalties" off: overtricks score nothing and never add up to a penalty
    let totalBags = bags[side]! + bagsAdded;
    const bagPenaltyCount = Math.floor(totalBags / r.bagsPerPenalty);
    totalBags -= bagPenaltyCount * r.bagsPerPenalty;
    const bagPenaltyPoints = bagPenaltyCount ? -bagPenaltyCount * r.bagPenalty : 0;
    const points = contractPoints + bagsAdded + nilPoints + bagPenaltyPoints + bookPoints;
    out.push({
      side, seats, contract, contractTricks, tricks, contractMade, contractPoints, nils,
      bagsAdded, bagPenaltyCount, bagPenaltyPoints, bookPoints, points,
      totalScore: scores[side]! + points, totalBags,
    });
  }
  return out;
}

export interface GameResult {
  /** shotOut: a side was shot on hand 1 or two hands in a row (house rule "Shot = out") */
  endReason: 'target' | 'floor' | 'shotOut';
  /** sides knocked out by Shot = out (endReason 'shotOut') */
  shotOut?: number[];
  finalScores: number[];
  /** 1-based placement per side; ties share a place (1,1,3). */
  placements: number[];
  /** Sides in first place. */
  winners: number[];
}

/** Standard competition ranking by score (higher is better). */
export function placementsFor(scores: readonly number[]): number[] {
  return scores.map((s) => 1 + scores.filter((o) => o > s).length);
}

/**
 * Game-end check after a hand (spec §3.1):
 * - Floor: any side at/below losingFloor ends the game immediately.
 * - Target: when the top score is ≥ target the game ends, unless the top is an exact tie (then play another hand).
 * A tie for first also continues a 2-team game ended by the floor (Cutthroat floor endings can share first place).
 */
export function checkGameEnd(r: TableRules, scores: readonly number[]): GameResult | null {
  const top = Math.max(...scores);
  const topCount = scores.filter((s) => s === top).length;
  const floorHit = r.losingFloor !== null && scores.some((s) => s <= r.losingFloor!);
  const finish = (endReason: GameResult['endReason']): GameResult => {
    const placements = placementsFor(scores);
    return { endReason, finalScores: [...scores], placements, winners: placements.flatMap((p, i) => (p === 1 ? [i] : [])) };
  };
  if (floorHit && (topCount === 1 || !r.partnerships)) return finish('floor');
  if (top >= r.targetScore && topCount === 1) return finish('target');
  return null;
}

/**
 * Was `side` shot this hand? Shot = set: the side had a contract and missed it (a busted Nil alone never makes a side
 * shot — same as the set logic). Books hand: shot when it took fewer books than the host minimum (off = nobody is shot).
 */
export function isShot(r: TableRules, bids: readonly Bid[], side: SideHandResult): boolean {
  if (isBooksHand(bids)) {
    const min = hostMinimum(r);
    return min > 0 && side.tricks < min;
  }
  return side.contractMade === false;
}

/**
 * How many times each side has been shot this game, counted from the scored hands.
 * History is part of the synced state, so every client and a reconnect see the same counts.
 * A busted nil alone is not a shot. A books hand counts only when it missed the first-hand minimum.
 */
export function shotCounts(r: TableRules, history: readonly { bids: readonly Bid[]; sides: readonly SideHandResult[] }[]): number[] {
  const counts = Array.from({ length: sideCount(r) }, () => 0);
  for (const hand of history) {
    for (const side of hand.sides) {
      if (isShot(r, hand.bids, side)) counts[side.side] = (counts[side.side] ?? 0) + 1;
    }
  }
  return counts;
}

/** True when the host minimum is not higher than the tricks this hand will play. */
export function minimumFits(r: TableRules, tricks: number): boolean {
  return hostMinimum(r) <= tricks;
}

/** The side made its books: a made contract, or a books hand that reached the host minimum. */
function madeItsBooks(r: TableRules, bids: readonly Bid[], side: SideHandResult): boolean {
  if (isBooksHand(bids)) {
    const min = hostMinimum(r);
    return min === 0 || side.tricks >= min;
  }
  return side.contractMade === true;
}

/**
 * Scorecard cover for one side. This is the only place the recap decides tape and sheet.
 * It reads the engine's shot-out result (`shotOutSides` / `shotOutResult`, or the recorded `result`).
 * It does not count shots across the whole game.
 */
export interface ShotCover {
  /** Caution tape after a non-losing shot, and also on a hand-1 loss (together with the sheet). Off once a later hand makes its books. */
  tape: boolean;
  /** White sheet only for an elimination: a hand-1 shot-out, or a later shot while the previous hand was a shot. */
  sheet: boolean;
  /** Siren and police lights. On whenever the sheet is showing. */
  siren: boolean;
}

/**
 * What covers each side's scorecard. History and `result` are synced, so every client and a reconnect agree.
 * Tape marks a shot that did not lose the game, and comes off when a later hand makes its books.
 * A hand-1 elimination shows the tape and the sheet together.
 * The sheet follows the recorded loss (`result.endReason === 'shotOut'`). When `result` is omitted, the same
 * shot-out functions the engine uses decide it, so a rules change shows up here without a second copy of the rule.
 */
export function shotCovers(
  r: TableRules,
  history: readonly { handNo: number; bids: readonly Bid[]; sides: readonly SideHandResult[] }[],
  result?: GameResult | null,
): ShotCover[] {
  const n = sideCount(r);
  const blank = (): ShotCover => ({ tape: false, sheet: false, siren: false });
  const covers = Array.from({ length: n }, blank);
  let prevShot = Array.from({ length: n }, () => false);
  for (let h = 0; h < history.length; h++) {
    const hand = history[h]!;
    const shot = Array.from({ length: n }, () => false);
    const made = Array.from({ length: n }, () => false);
    const scores = Array.from({ length: n }, () => 0);
    const markedOut = new Set<number>();
    for (const side of hand.sides) {
      shot[side.side] = isShot(r, hand.bids, side) || side.shot === true;
      made[side.side] = madeItsBooks(r, hand.bids, side);
      scores[side.side] = side.totalScore;
      if (side.out) markedOut.add(side.side);
    }
    const last = h === history.length - 1;
    const lost = last && result !== undefined
      ? new Set(result?.endReason === 'shotOut' ? result.shotOut ?? [] : [])
      : new Set(shotOutResult(scores, shotOutSides(r, hand.handNo, shot, prevShot))?.shotOut ?? []);
    for (let side = 0; side < n; side++) {
      if (lost.has(side) || markedOut.has(side)) covers[side] = { tape: hand.handNo === 1, sheet: true, siren: true };
      else if (shot[side]) covers[side] = { tape: true, sheet: false, siren: false };
      else if (made[side]) covers[side] = blank();
    }
    prevShot = shot;
  }
  return covers;
}

/**
 * Books still needed before this side is shot, or null when that side cannot be set
 * (bidding not finished, no numeric contract, or a books hand whose minimum is off).
 * On a books hand this is the host minimum minus the books that side has taken.
 * Nil tricks count only when `nilTricksCountForPartner` is on, matching scoreHand.
 */
export function booksStillNeeded(r: TableRules, bids: readonly (Bid | null)[], tricksWon: readonly number[], side: number): number | null {
  if (bids.length === 0 || bids.some((b) => b === null || b === undefined)) return null;
  const seats = sideSeats(side, r);
  if (isBooksHand(bids)) {
    const min = hostMinimum(r);
    if (min <= 0) return null;
    const taken = seats.reduce((n, seat) => n + (tricksWon[seat] ?? 0), 0);
    return min - taken;
  }
  let contract = 0;
  let taken = 0;
  let nilTricks = 0;
  for (const seat of seats) {
    const b = bids[seat]!;
    const t = tricksWon[seat] ?? 0;
    if (isNilBid(b)) nilTricks += t;
    else if (typeof b === 'number') { contract += b; taken += t; }
  }
  if (contract <= 0) return null;
  if (r.nilTricksCountForPartner) taken += nilTricks;
  return contract - taken;
}

/** Tricks not yet won. The trick in progress still counts as remaining. A short Cutthroat table uses that hand's trick count. */
export function tricksStillRemaining(st: { rules: TableRules; tricks: { length: number }; trickCount?: number }): number {
  return (st.trickCount ?? handSize(st.rules)) - st.tricks.length;
}

/**
 * Sides exactly one trick from being shot: books still needed equals tricks still remaining,
 * so losing one more trick makes the contract (or the first-hand minimum) unreachable.
 * A nil bid is not itself a shot; it only changes which tricks count toward the partner's contract.
 */
export function sidesOneTrickFromShot(st: {
  phase: string;
  rules: TableRules;
  bids: readonly (Bid | null)[];
  tricksWon: readonly number[];
  tricks: { length: number };
}): number[] {
  if (st.phase !== 'playing') return [];
  const remaining = tricksStillRemaining(st);
  if (remaining <= 0) return [];
  const out: number[] = [];
  for (let side = 0; side < sideCount(st.rules); side++) {
    const needed = booksStillNeeded(st.rules, st.bids, st.tricksWon, side);
    if (needed !== null && needed > 0 && needed === remaining) out.push(side);
  }
  return out;
}

/**
 * Sides that just entered the one-trick-from-set window. The first snapshot of a hand is a baseline
 * (a resumed game does not replay the cue). `already` remembers who has been pumped this hand, so
 * dropping out and falling back in does not play a second time. Every client runs this on the same
 * state transition, so an online table hears it together.
 */
export function newlyOneTrickFromShot<T extends { handNo: number; phase: string; rules: TableRules; bids: readonly (Bid | null)[]; tricksWon: readonly number[]; tricks: { length: number } }>(
  prev: T | null,
  next: T,
  already: ReadonlySet<number>,
): number[] {
  if (!prev || prev.handNo !== next.handNo) return [];
  const before = new Set(sidesOneTrickFromShot(prev));
  return sidesOneTrickFromShot(next).filter((side) => !before.has(side) && !already.has(side));
}

/**
 * Shot = out after a hand: the sides that are out — shot on hand 1, or shot this hand AND the previous hand.
 * `prevShot[side]` = shot on the previous hand. Empty when the rule is off.
 */
export function shotOutSides(r: TableRules, handNo: number, shot: readonly boolean[], prevShot: readonly boolean[]): number[] {
  if (!shotOutOn(r)) return [];
  return shot.flatMap((s, side) => (s && (handNo === 1 || (handNo > 2 && prevShot[side])) ? [side] : []));
}

/**
 * The game result when sides are shot out: the sides still in finish ahead of the shot-out ones (each group ranked
 * by score). If every side is out on the same hand, the higher score wins; an exact tie for first plays on (null).
 */
export function shotOutResult(scores: readonly number[], out: readonly number[]): GameResult | null {
  if (!out.length) return null;
  const alive = scores.map((_, i) => i).filter((i) => !out.includes(i));
  if (!alive.length) {
    const top = Math.max(...scores);
    if (scores.filter((s) => s === top).length > 1) return null;
    const placements = placementsFor(scores);
    return { endReason: 'shotOut', shotOut: [...out], finalScores: [...scores], placements, winners: placements.flatMap((p, i) => (p === 1 ? [i] : [])) };
  }
  // rank: alive sides by score first, then the shot-out sides by score
  const key = (i: number) => (out.includes(i) ? -1e9 : 0) + scores[i]!;
  const keys = scores.map((_, i) => key(i));
  const placements = keys.map((k) => 1 + keys.filter((o) => o > k).length);
  return { endReason: 'shotOut', shotOut: [...out], finalScores: [...scores], placements, winners: placements.flatMap((p, i) => (p === 1 ? [i] : [])) };
}
