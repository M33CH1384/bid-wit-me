/**
 * The mechanical turning point (BWM Central Phase 1): pure score-timeline
 * math shared by the Central match view (server timeline rows) and the
 * in-session Postgame Report (cumulative hand points). It is MECHANICAL
 * only — the largest hand-to-hand swing and the final lead change, read
 * straight off the score line. It never claims a "best" or "smartest"
 * moment; there is no strategy judgement in here.
 */

export interface ScorePoint { hand: number; scores: number[] }

export interface TurningPoint {
  /** largest hand-to-hand margin change (the opening hand is measured
   *  from 0–0); delta is signed from side 0's view in a 2-side game.
   *  Null when no hand ever moved the margin. */
  swing: { hand: number; delta: number } | null;
  /** the last hand on which the outright lead changed sides, or null */
  leadChangeHand: number | null;
  /** one side held the outright lead after EVERY hand — no turning point */
  wireToWire: boolean;
}

/** the outright leader's side index, or -1 when the lead is tied */
function leaderOf(scores: number[]): number {
  let best = -Infinity;
  let idx = -1;
  let tied = false;
  scores.forEach((v, i) => {
    if (v > best) { best = v; idx = i; tied = false; }
    else if (v === best) tied = true;
  });
  return tied ? -1 : idx;
}

/** signed margin from side 0's view (2 sides); for 3+ sides, the current
 *  leader's cushion over the runner-up, signed + when side 0 leads,
 *  − when anyone else does, 0 on a tied lead */
function marginOf(scores: number[]): number {
  if (scores.length === 2) return (scores[0] ?? 0) - (scores[1] ?? 0);
  const sorted = [...scores].sort((a, b) => b - a);
  const cushion = (sorted[0] ?? 0) - (sorted[1] ?? 0);
  if (cushion === 0) return 0;
  return leaderOf(scores) === 0 ? cushion : -cushion;
}

export function analyzeScoreTimeline(points: ScorePoint[]): TurningPoint {
  const rows = [...points].sort((a, b) => a.hand - b.hand);
  if (!rows.length) return { swing: null, leadChangeHand: null, wireToWire: false };
  let swing: TurningPoint['swing'] = null;
  let prevMargin = 0;
  let lastLeader: number | null = null;
  let leadChangeHand: number | null = null;
  let leadersSeen = new Set<number>();
  let everyHandLed = true;
  for (const r of rows) {
    const margin = marginOf(r.scores);
    const delta = margin - prevMargin;
    if (delta !== 0 && (!swing || Math.abs(delta) > Math.abs(swing.delta))) {
      swing = { hand: r.hand, delta };
    }
    prevMargin = margin;
    const leader = leaderOf(r.scores);
    if (leader === -1) { everyHandLed = false; continue; }
    leadersSeen.add(leader);
    if (lastLeader !== null && leader !== lastLeader) leadChangeHand = r.hand;
    lastLeader = leader;
  }
  const wireToWire = everyHandLed && leadersSeen.size === 1 && leadChangeHand === null;
  return { swing, leadChangeHand, wireToWire };
}
