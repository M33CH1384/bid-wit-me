import type { TableRules } from './config';

/** A bid: a number of tricks (≥1), Nil, or Blind Nil. A numeric 0 is normalised to 'nil'. */
export type Bid = number | 'nil' | 'blindNil';

export function isNilBid(b: Bid | null | undefined): b is 'nil' | 'blindNil' {
  return b === 'nil' || b === 'blindNil';
}

export function bidLabel(b: Bid | null | undefined): string {
  if (b === null || b === undefined) return '—';
  if (b === 'nil') return 'Nil';
  if (b === 'blindNil') return 'Blind Nil';
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
  /** Net points for this hand. */
  points: number;
  totalScore: number;
  totalBags: number;
}

/**
 * Scores one hand (spec §3.1). `bids` and `tricksWon` are per seat; `scores`/`bags` are per side before the hand.
 * - Contract made: +10×bid (+20×bid with tenForTwoHundred and bid ≥10) plus +1 per overtrick (bag).
 * - Contract set: −10×bid.
 * - Nil: ±nil.value; Blind Nil: ±blindNil.value, scored separately from the partner's contract.
 * - Tricks by a Nil bidder: bags (+1 each) by default, or count toward the partner's contract.
 * - Every `bagsPerPenalty` accumulated bags: −bagPenalty and the bag count drops accordingly.
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
    let contract = 0, contractTricks = 0, nilTricks = 0, tricks = 0, nilPoints = 0;
    const nils: NilResult[] = [];
    for (const s of seats) {
      const b = bids[s]!;
      const t = tricksWon[s]!;
      tricks += t;
      if (isNilBid(b)) {
        const value = b === 'nil' ? r.nil.value : r.blindNil.value;
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

    let totalBags = bags[side]! + bagsAdded;
    const bagPenaltyCount = Math.floor(totalBags / r.bagsPerPenalty);
    totalBags -= bagPenaltyCount * r.bagsPerPenalty;
    const bagPenaltyPoints = -bagPenaltyCount * r.bagPenalty;
    const points = contractPoints + bagsAdded + nilPoints + bagPenaltyPoints;
    out.push({
      side, seats, contract, contractTricks, tricks, contractMade, contractPoints, nils,
      bagsAdded, bagPenaltyCount, bagPenaltyPoints, points,
      totalScore: scores[side]! + points, totalBags,
    });
  }
  return out;
}

export interface GameResult {
  endReason: 'target' | 'floor';
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
