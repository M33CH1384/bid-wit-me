/**
 * BLIZZARD (owner, 2026-11-04): "When a person keeps losing there should
 * be snow - blizzard on their Home Screen — same thought as the fire but
 * backwards." The home fire celebrates a real WIN streak; this is its
 * mirror for a losing run: the signed-in player's own home screen gets
 * snow that builds toward a blizzard the longer the skid runs, and
 * clears when they win.
 *
 * Data honesty (the standing rule): the number comes from the SAME
 * source as the fire — the `streakFire` field of the SELF profile
 * payload (/api/profile/me), parsed by streakFire.ts's
 * homeStreakFromProfile into HomeStreak.lossStreak / lossKind. The
 * server derives the loss run at read time from the player's recorded
 * finished games (cred/hooks.ts `streakFireFor` / `currentLossRun`) —
 * the same history the fire's cred_totals rows are built from. Nothing
 * here is inferred client-side: a payload without loss members (an
 * older build) parses as 0 and shows NO weather, and a signed-out /
 * guest session gets no payload at all (fetchHomeStreak reads null), so
 * no weather either. The streak is per-kind server-side; the home
 * weather takes the max across kinds with the kind named, exactly the
 * fire's pick rule mirrored.
 *
 * Scope: the home (wizard 'home' step) only, personal to the signed-in
 * player. The table's fire/streak logic is untouched.
 *
 * Performance (a hard gate, set by the 2026-11-04 Social crash — a
 * ~629 MB transient graphics spike from a menu transition): one
 * canvas-2D layer, flakes hard-capped at SNOW_MAX_FLAKES, no sprites,
 * no blur / backdrop-filter / will-change anywhere in snow.css (pinned
 * by test/blizzard.test.ts), rAF paused when the page is hidden.
 */

export type BlizzardTier = 0 | 1 | 2 | 3;

/** The whole feature's particle budget: no tier may exceed this many
 *  live flakes, ever (pinned by test). */
export const SNOW_MAX_FLAKES = 150;

/** Everything the renderer needs to scale a tier, in one auditable row. */
export interface BlizzardTierParams {
  /** live flakes on screen (never above SNOW_MAX_FLAKES) */
  flakes: number;
  /** fall speed range, px/s */
  fallMin: number;
  fallMax: number;
  /** sideways sway amplitude, px (a flake drifts ± this around its path) */
  sway: number;
  /** wind drift, px/s at full gust (blizzard leans the whole field) */
  wind: number;
  /** frost vignette strength, 0..1 (the frost div's opacity) */
  frost: number;
  /** largest flake radius, px */
  maxRadius: number;
}

const S = (flakes: number, fallMin: number, fallMax: number, sway: number, wind: number, frost: number, maxRadius: number): BlizzardTierParams =>
  ({ flakes, fallMin, fallMax, sway, wind, frost, maxRadius });

/** Home tiers (current LOSS streak), the fire's escalation read
 *  backwards: nothing below 3 (a loss or two is just a night), a first
 *  flurry at 3, real snowfall with frost creeping in at 4–5, and the
 *  full blizzard — densest fall, wind-slanted, heavy frost — from 6. */
export const BLIZZARD_TIERS: Record<BlizzardTier, BlizzardTierParams> = {
  0: S(0, 0, 0, 0, 0, 0, 0),
  1: S(36, 26, 52, 10, 4, 0.18, 2.0),
  2: S(84, 40, 84, 16, 10, 0.45, 2.4),
  3: S(SNOW_MAX_FLAKES, 90, 170, 8, 64, 0.8, 2.8),
};

/** Home tier for a current loss streak: 0–2 none · 3 flurry ·
 *  4–5 snowfall · 6+ blizzard. */
export function homeBlizzardTier(lossStreak: number): BlizzardTier {
  if (!Number.isFinite(lossStreak) || lossStreak < 3) return 0;
  if (lossStreak === 3) return 1;
  if (lossStreak <= 5) return 2;
  return 3;
}

/** The honest home chip line, real number in it (the fire chip's mirror). */
export function homeBlizzardLabel(lossStreak: number): string {
  return `Ice cold — ${lossStreak}-game losing streak`;
}
