/**
 * Bullet holes for a shot team. The count is the current shot streak (a made hand
 * clears it), capped at two fixed slots. The same object is reused for a seed and
 * side, so a recap remount and the score pad share the count and the punched flags
 * and never roll new positions.
 */
import { type Bid, type SideHandResult, type TableRules, isShot, sideCount } from '@spades/rules';

/** Top-right gap left of the total, then the lower left by the progress bar. No third hole. */
export const HOLE_SLOTS: readonly { x: string; y: string; rot: number }[] = [
  { x: '62%', y: '16%', rot: -8 },
  { x: '14%', y: '82%', rot: 9 },
];

export interface TeamHoles {
  count: number;
  punched: [boolean, boolean];
  sheetPlayed: boolean;
}

export interface HoleMark {
  /** Visible holes, 0–2. */
  count: number;
  /** Slot earned this hand, or -1 when nothing new should punch. */
  fresh: number;
}

const store = new Map<string, TeamHoles>();
const buzzed = new Set<string>();

const keyOf = (seed: string, side: number) => `${seed}:${side}`;

export function clearTeamHoles(): void {
  store.clear();
  buzzed.clear();
}

/** Streak of consecutive shots ending at the latest hand. A made hand resets that side to 0. */
export function holeStreak(
  r: TableRules,
  history: readonly { bids: readonly Bid[]; sides: readonly SideHandResult[] }[],
): HoleMark[] {
  const n = sideCount(r);
  const raw = Array.from({ length: n }, () => 0);
  for (const hand of history) {
    for (const side of hand.sides) {
      const shot = isShot(r, hand.bids, side) || side.shot === true;
      raw[side.side] = shot ? (raw[side.side] ?? 0) + 1 : 0;
    }
  }
  return raw.map((c) => ({
    count: Math.min(2, c),
    fresh: c >= 1 && c <= 2 ? c - 1 : -1,
  }));
}

/** Stable team record. Older slots stay punched; the fresh slot keeps whatever the punch already set. */
export function rememberHoles(seed: string, side: number, count: number, fresh: number): TeamHoles {
  const k = keyOf(seed, side);
  let marks = store.get(k);
  if (!marks) {
    marks = { count: 0, punched: [false, false], sheetPlayed: false };
    store.set(k, marks);
  }
  const next = Math.max(0, Math.min(2, count));
  if (next === 0) {
    marks.count = 0;
    marks.punched[0] = false;
    marks.punched[1] = false;
    marks.sheetPlayed = false;
    return marks;
  }
  for (let i = 0; i < 2; i++) {
    if (i >= next) marks.punched[i] = false;
    else if (i !== fresh) marks.punched[i] = true;
  }
  marks.count = next;
  return marks;
}

export function markHolePunched(seed: string, side: number, index: number): void {
  const marks = store.get(keyOf(seed, side));
  if (!marks || (index !== 0 && index !== 1)) return;
  marks.punched[index] = true;
}

export function markSheetPlayed(seed: string, side: number): void {
  const marks = store.get(keyOf(seed, side));
  if (marks) marks.sheetPlayed = true;
}

/** One buzz per hole per game, including a strict-mode remount inside the punch window. */
export function claimHoleBuzz(seed: string, side: number, index: number): boolean {
  const k = `${seed}:${side}:${index}`;
  if (buzzed.has(k)) return false;
  buzzed.add(k);
  return true;
}

export function punchedLabel(marks: TeamHoles): string {
  if (marks.count <= 0) return '';
  return marks.punched.slice(0, marks.count).map((p) => (p ? '1' : '0')).join(',');
}
