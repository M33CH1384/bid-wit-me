/**
 * The parked Forge sedan at The Pj's vs a detonation — owner direction, 2026-10-28:
 * "if the nuke happens the car should be blown off the table with everything else."
 * ALL cars go: when a nuke/mega detonates, the sedan launches off its spot by the
 * street, tumbling into the dark, on the same flash the cards sweep on. It stays gone
 * for the rest of the hand and is restored at the next hand's deal (the recap covers
 * the swap), so a later nuke in the match blows it away again.
 *
 * Pure pose + state machine, mirroring the card sweep's profile (blastSweep.ts:
 * cubic-out sweep over ~0.55 s, sin rise over ~0.7 s, mega reaches farther and its
 * second detonation re-kicks). `calm` (OS reduce-motion): the car slides away with
 * no tumble and is gone sooner. The gate mirrors Nuke3D: nuke mode 'off' has no
 * visual sweep anywhere, so the sedan stays parked.
 */

/** Seconds from the fx detonation event to the flash — mirrors NUKE_FLASH_S in
 *  nukeVisual.ts; the launch lands on the flash, with the cards. */
export const SEDAN_BLAST_FLASH_S = 0.3;
/** Unit direction from the table centre to the sedan's spot (3.0, −5.9), XZ plane. */
const DIR: readonly [number, number] = (() => {
  const l = Math.hypot(3.0, -5.9);
  return [3.0 / l, -5.9 / l] as const;
})();
/** Mega's second detonation, seconds after the flash (MEGA_STAGE2_S 1.45 − flash 0.3, rounded). */
const MEGA_REKICK_U = 1.15;

export interface SedanBlastPose {
  /** Offset from the parked spot, world units. */
  off: [number, number, number];
  /** Group rotation (the parked yaw is baked on the model inside the group). */
  rot: [number, number, number];
  visible: boolean;
}

const REST: SedanBlastPose = { off: [0, 0, 0], rot: [0, 0, 0], visible: true };

/** The sedan's pose `u` seconds after the flash (u < 0 → still parked, flash not landed). */
export function sedanBlastPoseAt(u: number, opts: { mega: boolean; calm: boolean }): SedanBlastPose {
  if (u < 0) return REST;
  const { mega, calm } = opts;
  const sweepWin = calm ? 0.4 : 0.55;
  const s = u < sweepWin ? 1 - (1 - u / sweepWin) ** 3 : 1;
  let reach = (mega ? 7.0 : 5.2) * s + (mega ? 1.7 : 1.15) * Math.max(0, u - sweepWin);
  if (mega && u > MEGA_REKICK_U) reach += 1.7 * (1 - (1 - Math.min(1, (u - MEGA_REKICK_U) / 0.4)) ** 3);
  const rise = Math.sin(Math.min(1, u / 0.7) * (Math.PI / 2));
  let lift = (mega ? 1.9 : 1.35) * rise + 0.85 * Math.max(0, u - 0.7);
  if (calm) lift *= 0.45;
  const tumble = calm ? 0 : (mega ? 3.1 : 2.3) * s;
  const visible = u <= (calm ? 1.05 : mega ? 4.1 : 3.3);
  return {
    off: [DIR[0] * reach, lift, DIR[1] * reach],
    rot: [tumble * 0.8, tumble * 0.35, tumble * 0.6],
    visible,
  };
}

/** Same gate as the 3D blast itself: 'off' mode sweeps nothing. */
export function sedanBlastReaction(kind: 'nuke' | 'mega', nukeMode: string): 'nuke' | 'mega' | 'none' {
  if (nukeMode === 'off') return 'none';
  return kind;
}

export type SedanBlastState =
  | { phase: 'parked' }
  | { phase: 'flying'; at: number; mega: boolean; calm: boolean };

export type SedanBlastEvent =
  | { type: 'blast'; at: number; mega: boolean; calm: boolean }
  | { type: 'hand' };

/**
 * Parked → flying on a detonation. A second detonation while it's already gone
 * changes nothing (it does NOT pop back to its spot to be blown away twice).
 * Any blast state → parked when the hand changes: the restore point is the next
 * hand's deal.
 */
export function sedanBlastReducer(state: SedanBlastState, ev: SedanBlastEvent): SedanBlastState {
  if (ev.type === 'hand') return { phase: 'parked' };
  if (state.phase === 'flying') return state;
  return { phase: 'flying', at: ev.at, mega: ev.mega, calm: ev.calm };
}
