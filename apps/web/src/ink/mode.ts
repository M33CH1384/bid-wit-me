/**
 * Neon Royale ink — the mode decision (pure, no DOM).
 *
 * The ink layer has exactly three modes:
 *  - 'webgl'    — the live dye-advection engine (see engine.ts),
 *  - 'gradient' — the animated CSS-gradient fallback layer (static when motion
 *                 must be calmed),
 *  - 'none'     — nothing renders at all: Classic theme, or a live table (the
 *                 table's Three.js scene owns the WebGL budget there — the ink
 *                 canvas unmounts entirely, per the Neon audit §3).
 *
 * Gates, in order: theme=Neon ∧ not in-game, then any calming signal (OS
 * reduced motion, the app's Reduce effects switch, a low-quality device) or a
 * missing WebGL context drops the engine to the gradient. Visibility is NOT a
 * mode input: a hidden tab keeps mode 'webgl' and the engine just pauses its
 * rAF loop.
 */
import type { ThemeName } from '../theme';

export type InkMode = 'webgl' | 'gradient' | 'none';

export interface InkGateState {
  /** Active theme from the theme store. */
  theme: ThemeName;
  /** A live table is on screen (`html.bwm-in-game`, set by antiPan.lockBody). */
  inGame: boolean;
  /** OS `prefers-reduced-motion: reduce`. */
  reducedMotion: boolean;
  /** The app's own "Reduce effects" switch (`fx.reduced`, key `bwm.fx`). */
  reduceEffects: boolean;
  /** Device quality is 'low' (settings.ts heuristic / user quality choice). */
  lowQuality: boolean;
  /** A WebGL context was created successfully for the ink canvas. */
  webgl: boolean;
}

export function inkMode(s: InkGateState): InkMode {
  if (s.theme !== 'neon' || s.inGame) return 'none';
  if (s.reducedMotion || s.reduceEffects || s.lowQuality || !s.webgl) return 'gradient';
  return 'webgl';
}

/** The fallback gradient drifts slowly — unless motion must be calmed. */
export function inkGradientAnimated(s: InkGateState): boolean {
  return !s.reducedMotion && !s.reduceEffects;
}
