/**
 * MANNER OF WIN — "word travels fast" (owner, 2026-10-24): the block
 * doesn't just hear THAT you won at a stop, it hears HOW — a close one
 * or an annihilation. This module is the ONE definition of the manner
 * bands; scene lines (storyScripts) and tests both read it here, so a
 * band can never drift between the talk and its proof.
 *
 * Bands derive ONLY from a recorded result fact (the stop's persisted
 * last result: won + final margin + how the game ended). A fact that
 * doesn't exist — an old result recorded before manner was kept, a
 * loss — yields NO band, and no manner line may fire without one
 * (data honesty: never dress a loss as a win, never invent a margin).
 *
 * The margin bands are FRACTIONS of the stop's race target, so they
 * scale: a 40-point win is a squeaker at the Porch (250) and a
 * rounding error at the King (750).
 */
import type { StoryStop } from './story';

/** How a story game ended (the rules engine's GameResult endReason). */
export type StoryEndReason = 'target' | 'floor' | 'shotOut' | 'third-set';

export const STORY_END_REASONS: readonly StoryEndReason[] = ['target', 'floor', 'shotOut', 'third-set'];

/** Clamp an unknown value to a legal end reason (null when it isn't one). */
export function storyEndReasonOf(v: unknown): StoryEndReason | null {
  return typeof v === 'string' && (STORY_END_REASONS as readonly string[]).includes(v)
    ? (v as StoryEndReason)
    : null;
}

/**
 * The manner of a WIN, in the block's own flavors:
 *  'early' — the game ended ahead of schedule: shot out, or the other
 *            side's third set ("3 the hard way"). Its own story.
 *  'rout'  — an annihilation: through the floor, or a margin at least
 *            55% of the race target.
 *  'close' — a squeaker: the margin is at most 20% of the target.
 *  'solid' — a real win between those poles; respect, no legend.
 */
export type MannerBand = 'close' | 'solid' | 'rout' | 'early';

/** The minimum recorded shape a manner can be derived from. */
export interface MannerFact {
  won: boolean;
  /** our score − theirs at game end (points) */
  margin?: number;
  endReason?: StoryEndReason | string | null;
}

/** The stop's race target: the twist's, else the game's standard 500. */
export function targetForStop(stop: StoryStop): number {
  return stop.twist?.targetScore ?? 500;
}

export function mannerBandOf(fact: MannerFact | null | undefined, target: number): MannerBand | null {
  if (!fact || !fact.won) return null;
  // An early ending outranks the margin — it IS the story people tell.
  if (fact.endReason === 'shotOut' || fact.endReason === 'third-set') return 'early';
  // Through the floor is a rout however the raw margin reads.
  if (fact.endReason === 'floor') return 'rout';
  if (typeof fact.margin !== 'number' || !Number.isFinite(fact.margin) || !(target > 0)) return null;
  const f = fact.margin / target;
  if (f <= 0.2) return 'close';
  if (f >= 0.55) return 'rout';
  return 'solid';
}

/** Decisive flavors — the ones that leave people holding smoke (owner's
 *  band discipline, 2026-10-24: a close win earns war stories, not smoke). */
export function isDecisiveBand(band: MannerBand | null | undefined): boolean {
  return band === 'rout' || band === 'early';
}
