/**
 * Neon Royale ink — adaptive quality governor (pure, no DOM, no GL).
 *
 * The engine renders its simulation into a small off-screen field; if the
 * device can't hold the frame budget at that size, the governor steps the
 * field down a rung at a time. If it is STILL over budget on the last rung,
 * the governor declares exhaustion and the layer hands off to the CSS-gradient
 * fallback rather than heating the phone. Decisions are sticky (no step back
 * up) so quality never oscillates mid-session.
 */

/** Simulation field widths per governor level (the field's long edge). */
export const SIM_WIDTHS: readonly number[] = [256, 192, 160, 128];
/** Sustained average frame time above this counts as "hot". */
export const GOVERNOR_HOT_MS = 24;
/** Consecutive hot frames before a step (or exhaustion) triggers. */
export const GOVERNOR_HOT_FRAMES = 90;

/**
 * Field texture size for a governor level and a viewport aspect (w/h).
 * The level's width budget applies to the field's LONG edge, preserving
 * aspect, so a portrait phone gets a tall narrow field, not a huge one.
 */
export function simSizeFor(level: number, aspect: number): { w: number; h: number } {
  const lvl = Math.max(0, Math.min(SIM_WIDTHS.length - 1, Math.trunc(level) || 0));
  const W = SIM_WIDTHS[lvl]!;
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
  if (a >= 1) return { w: W, h: Math.max(48, Math.round(W / a)) };
  return { w: Math.max(48, Math.round(W * a)), h: W };
}

export interface GovernorState {
  level: number;
  /** Exponential moving average of frame time, ms. */
  emaMs: number;
  /** Consecutive frames spent over budget. */
  hot: number;
  /** True once the last rung also failed: the engine should stop. */
  dead: boolean;
}

export function createGovernor(): GovernorState {
  return { level: 0, emaMs: 1000 / 60, hot: 0, dead: false };
}

export type GovernorAction = 'keep' | 'step' | 'fallback';

/**
 * Feeds one frame's duration. Long stalls (>250 ms — tab switches, hitch
 * frames) are ignored rather than averaged in: they say nothing about
 * sustained throughput. Returns 'step' exactly once per rung drop and
 * 'fallback' once the last rung is exhausted (state stays dead afterwards).
 */
export function governorFrame(g: GovernorState, frameMs: number): GovernorAction {
  if (g.dead) return 'fallback';
  if (frameMs > 0 && frameMs < 250) g.emaMs = g.emaMs * 0.95 + frameMs * 0.05;
  if (g.emaMs > GOVERNOR_HOT_MS) {
    g.hot++;
    if (g.hot >= GOVERNOR_HOT_FRAMES) {
      g.hot = 0;
      g.emaMs = GOVERNOR_HOT_MS;
      if (g.level >= SIM_WIDTHS.length - 1) {
        g.dead = true;
        return 'fallback';
      }
      g.level++;
      return 'step';
    }
  } else {
    g.hot = 0;
  }
  return 'keep';
}
