/** Music tension signal (Phase 6): how close the game feels, 0 (menu/calm) .. 1 (match point).
 *  Pure: the table feeds it state, the engine turns it into a layer gain.
 *  Tension is not just "leader near target": a CLOSE RACE (both teams near the
 *  target, small gap) is tenser than the same leader score in a blowout. */
export interface TensionInput {
  scores: readonly number[];
  target: number;
  phase: string;
  handNo: number;
  /** any seat bid Nil this hand (a nil on the line raises the heart rate) */
  nilBid?: boolean;
}
export function musicTension(s: TensionInput): number {
  const scores = s.scores.length ? s.scores : [0];
  const top = Math.max(...scores);
  const bottom = Math.min(...scores);
  const scorePressure = s.target > 0 ? Math.min(1, Math.max(0, top / s.target)) : 0;
  // Close-race factor: 1 when level, fading to 0 as the gap reaches a quarter of the target.
  const gap = top - bottom;
  const closeRace = s.scores.length >= 2 && s.target > 0 ? Math.max(0, 1 - gap / (s.target * 0.25)) : 0;
  const bothNear = s.target > 0 ? Math.min(1, Math.max(0, bottom / s.target)) : 0;
  const race = closeRace * bothNear;
  const late = Math.min(1, Math.max(0, s.handNo) / 10) * 0.25;
  const nil = s.nilBid ? 0.15 : 0;
  const live = s.phase === 'playing' || s.phase === 'bidding' ? 0.05 : 0;
  return Math.min(1, Math.max(0, 0.55 * scorePressure + 0.35 * race + late + nil + live));
}
