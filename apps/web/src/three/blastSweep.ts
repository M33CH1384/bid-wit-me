import { type Card, isNukeTrick } from '@spades/rules';

/**
 * How far a table card is carried, in world units, along its outward direction.
 * The felt is about 1.5 by 1.8. The old kick topped out near 0.75 and then
 * sprung home, so the trick was back under the cloud. This clears the rail.
 */
export const TABLE_BLAST_REACH = 4.4;

export interface BlastPose {
  /** World units outward from the card's own spot. */
  out: number;
  /** World units up. */
  lift: number;
  /** Radians of tumble around the card's random axis. */
  tumble: number;
  /** Extra world Z. Hand cards keep the small nudge they had toward the camera. */
  z?: number;
}

/**
 * Pose of one card at `u` seconds after the flash.
 * Table cards sweep off and stay off. Hand cards (Full Nuke only) still kick and spring home.
 * `null` means the blast is not acting: a table card that already left keeps its last pose.
 */
export function blastPose(u: number, kind: 'table' | 'hand'): BlastPose | null {
  if (u < 0) return null;
  if (kind === 'hand') {
    if (u > 2.6) return null;
    const env = u < 0.22 ? 1 - (1 - u / 0.22) ** 3 : Math.max(0, Math.exp(-(u - 0.22) * 1.9) * Math.cos((u - 0.22) * 2.4));
    const liftWindow = u < 1.2 ? Math.sin(Math.PI * Math.min(1, u / 1.2)) : 0;
    return { out: 0.112 * env, lift: 0.042 * liftWindow, tumble: 0.35 * env, z: 0.08 * env };
  }
  const sweep = u < 0.55 ? 1 - (1 - u / 0.55) ** 3 : 1;
  const rise = Math.sin(Math.min(1, u / 0.7) * Math.PI * 0.5);
  return { out: TABLE_BLAST_REACH * sweep, lift: 1.15 * rise, tumble: 2.6 * sweep };
}

/** Trick cards, won piles, and every other mesh on the felt. The hand is not one of these. */
export function nukeBlastCards<T extends { hand?: boolean }>(items: readonly T[]): T[] {
  return items.filter((it) => !it.hand);
}

/**
 * The seated player and a spectator share this. Both see the same public trick,
 * so both cue the blast. A resumed save and a Run it! slam do not.
 */
export function clientSeesNuke(plays: readonly { card: Card; run?: boolean }[], slam: boolean): boolean {
  return !slam && isNukeTrick(plays);
}
