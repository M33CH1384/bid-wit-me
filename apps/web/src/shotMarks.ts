/**
 * Bullet holes for a shot team. The count is how many times that side has been
 * shot this game (it does not reset when a later hand is made). Three fixed slots
 * are visible; a fourth shot and beyond add no hole, only the tally. The same
 * object is reused for a seed and side, so a recap remount and the score pad
 * share the count and the punched flags and never roll new positions.
 */
import { type Bid, type SideHandResult, type TableRules, isShot, sideCount } from '@spades/rules';

/**
 * On-notice card. All three sit in the tape lane: below the name and the total,
 * above the bid line. The old top slot (62%, 30px) sat on the team name, and
 * 145px clipped the score line.
 */
export const HOLE_SLOTS: readonly { x: string; y: string; rot: number }[] = [
  { x: '22%', y: '124px', rot: -8 },
  { x: '46%', y: '128px', rot: 9 },
  { x: '78%', y: '118px', rot: -6 },
];

/**
 * Eliminated card. There is no tape lane, so the holes sit in the bottom padding,
 * left of the time-of-death tag.
 */
export const SHROUD_HOLE_SLOTS: readonly { x: string; y: string; rot: number }[] = [
  { x: '12%', y: 'calc(100% - 30px)', rot: -8 },
  { x: '28%', y: 'calc(100% - 36px)', rot: 8 },
  { x: '42%', y: 'calc(100% - 28px)', rot: -5 },
];

export function holeSlots(sheet: boolean): readonly { x: string; y: string; rot: number }[] {
  return sheet ? SHROUD_HOLE_SLOTS : HOLE_SLOTS;
}

export const HOLE_CAP = 3;

export interface TeamHoles {
  /** Shots this game, not capped. */
  count: number;
  punched: [boolean, boolean, boolean];
  sheetPlayed: boolean;
}

export interface HoleMark {
  /** Shots this game. */
  count: number;
  /** Holes to draw, 0–3. */
  visible: number;
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

/**
 * Shot count per side, same hands `shotCounts` reads, plus a side the engine
 * already marked `shot`. The fresh slot is only the hole earned on the latest hand,
 * and only while that hole still fits in the three slots.
 */
export function holeMarks(
  r: TableRules,
  history: readonly { bids: readonly Bid[]; sides: readonly SideHandResult[] }[],
): HoleMark[] {
  const n = sideCount(r);
  const raw = Array.from({ length: n }, () => 0);
  const lastShot = Array.from({ length: n }, () => false);
  for (const hand of history) {
    for (let i = 0; i < n; i++) lastShot[i] = false;
    for (const side of hand.sides) {
      const shot = isShot(r, hand.bids, side) || side.shot === true;
      lastShot[side.side] = shot;
      if (shot) raw[side.side] = (raw[side.side] ?? 0) + 1;
    }
  }
  return raw.map((c, i) => ({
    count: c,
    visible: Math.min(HOLE_CAP, c),
    fresh: lastShot[i] && c >= 1 && c <= HOLE_CAP ? c - 1 : -1,
  }));
}

/** Stable team record. Older slots stay punched; the fresh slot keeps whatever the punch already set. */
export function rememberHoles(seed: string, side: number, count: number, fresh: number): TeamHoles {
  const k = keyOf(seed, side);
  let marks = store.get(k);
  if (!marks) {
    marks = { count: 0, punched: [false, false, false], sheetPlayed: false };
    store.set(k, marks);
  }
  const next = Math.max(0, count);
  const visible = Math.min(HOLE_CAP, next);
  if (next === 0) {
    marks.count = 0;
    marks.punched[0] = false;
    marks.punched[1] = false;
    marks.punched[2] = false;
    marks.sheetPlayed = false;
    return marks;
  }
  for (let i = 0; i < HOLE_CAP; i++) {
    if (i >= visible) marks.punched[i] = false;
    else if (i !== fresh) marks.punched[i] = true;
  }
  marks.count = next;
  return marks;
}

export function markHolePunched(seed: string, side: number, index: number): void {
  const marks = store.get(keyOf(seed, side));
  if (!marks || index < 0 || index >= HOLE_CAP) return;
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
  const n = Math.min(HOLE_CAP, marks.count);
  if (n <= 0) return '';
  return marks.punched.slice(0, n).map((p) => (p ? '1' : '0')).join(',');
}
