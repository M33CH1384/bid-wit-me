import type { TableRules } from '@spades/rules';

/**
 * MATCH POINT (owner, 2026-11-12: "We need a mood for this scenario when the next hand decides
 * the match"). A side is on match point when one ordinary made hand takes it to the target —
 * within HAND_REACH of it. When two or more sides are there at once, the next hand is the
 * decider: whoever makes their bid can close the match out.
 *
 * Read between hands from the running scores. It is a mood, not a promise — both sides can
 * still get set — so the wording says the hand CAN end it, never that it will.
 */
export const HAND_REACH_TEAM = 80;
/** A cutthroat seat plays alone, so its ordinary hand is about half a partnership's. */
export const HAND_REACH_SOLO = 50;

export interface MatchPointSide { side: number; needs: number }
export interface MatchPoint {
  /** 'decider': two or more sides can close it out. 'matchPoint': exactly one can. */
  tier: 'decider' | 'matchPoint';
  /** Sides on match point, closest to the target first. */
  sides: MatchPointSide[];
}

export function handReach(rules: Pick<TableRules, 'partnerships'>): number {
  return rules.partnerships ? HAND_REACH_TEAM : HAND_REACH_SOLO;
}

export function matchPoint(rules: Pick<TableRules, 'partnerships' | 'targetScore'>, scores: readonly number[], eliminated?: readonly boolean[]): MatchPoint | null {
  const target = rules.targetScore;
  if (!(target > 0)) return null;
  const reach = handReach(rules);
  const sides: MatchPointSide[] = [];
  scores.forEach((score, side) => {
    if (eliminated?.[side]) return;
    const needs = target - score;
    if (needs > 0 && needs <= reach) sides.push({ side, needs });
  });
  if (!sides.length) return null;
  sides.sort((a, b) => a.needs - b.needs || a.side - b.side);
  return { tier: sides.length >= 2 ? 'decider' : 'matchPoint', sides };
}

/** The strap's headline. */
export function matchPointHeadline(mp: MatchPoint, name: (side: number) => string): string {
  return mp.tier === 'decider' ? 'Next hand can end it' : `${name(mp.sides[0]!.side)} can close it out`;
}
