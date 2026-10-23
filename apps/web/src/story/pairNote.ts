/**
 * Story co-op versus headline (2026-10-23): the pair's own facts at this stop,
 * in story register — never league chrome. Built from the pair context /
 * pair-track progress the room already holds (attempts + clears are the
 * pair's recorded history together at the stop); absent data = no line.
 * `attempts` counts COMPLETED attempts before this game, so the current
 * run is attempts + 1 (the same convention buildStoryTape's history uses).
 */
export interface PairStopFacts { attempts: number; clears: number; doublePending?: boolean }

export function coopPairNote(stopName: string, pair: PairStopFacts | null | undefined): string | null {
  if (!pair) return null;
  if (pair.doublePending) return 'The double is live — one more win together takes the crown.';
  if (pair.clears > 0) return `You two hold this table — cleared ${pair.clears}× together. Here you go again.`;
  if (pair.attempts > 0) return `Attempt ${pair.attempts + 1} together at ${stopName} — still hunting the clear.`;
  return `Your first run at ${stopName} together.`;
}
