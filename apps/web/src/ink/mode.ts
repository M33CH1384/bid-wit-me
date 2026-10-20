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
 *
 * "Low-quality" is decided by inkLowQuality() below — NOT by the persisted
 * graphics setting, whose heuristic default is poisoned on iOS (see there).
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

/** Raw device signals the ink layer classifies on, exactly as reported. */
export interface InkDeviceSignals {
  /** `navigator.deviceMemory` (GB), when the browser reports it at all. */
  deviceMemory?: number;
  /** `navigator.hardwareConcurrency`, when reported. Never trusted — see below. */
  hardwareConcurrency?: number;
  /**
   * The user themselves picked Low graphics (the stored quality says 'low'
   * while a fresh heuristic read says 'high' — i.e. the value cannot have
   * come from the load-time default). Computed by InkLayer.
   */
  userSetLow: boolean;
}

/**
 * Is this device low-end FOR THE INK? Deliberately stricter than the game's
 * graphics heuristic (settings.ts `defaultQuality()`), and for a concrete
 * reason: that heuristic reads `(deviceMemory ≤ 3) || (cores ≤ 3)`, and on
 * iOS Safari BOTH signals lie. Safari does not implement `deviceMemory`
 * (undefined), and WebKit clamps `hardwareConcurrency` to 2 on iOS as an
 * anti-fingerprinting measure, regardless of the chip — an A17 Pro reports
 * the same "2 cores" as a decade-old phone. So the heuristic answers 'low'
 * on every iPhone, the answer is persisted into settings, and the ink
 * layer's old `loadSettings().quality === 'low'` check took it at face
 * value: **every iPhone got the CSS gradient and the engine never ran**
 * (the owner's "it doesn't feel active, just seems like a nice gradient"
 * was literal). The classification here therefore demands POSITIVE
 * evidence of a weak device:
 *  - an explicit user pick of Low graphics is honored (`userSetLow`);
 *  - a memory figure the browser ACTUALLY reports at ≤ 2 GB counts —
 *    Chrome/Android expose `deviceMemory` truthfully, so a present, tiny
 *    figure is real evidence;
 *  - absent signals are "unknown", never "weak": no memory figure (all of
 *    WebKit) says nothing, and core counts are ignored entirely — clamped
 *    exactly where the old heuristic trusted them.
 * A genuinely weak device that slips through is still protected by the
 * engine's governor, which steps the sim resolution down rung by rung
 * under sustained load and only hands off to the gradient as a last resort.
 */
export function inkLowQuality(s: InkDeviceSignals): boolean {
  if (s.userSetLow) return true;
  return s.deviceMemory !== undefined && s.deviceMemory <= 2;
}
