/**
 * Boot splash: the decision + the choreography numbers (owner, 2026-11-04).
 *
 * The shipped app-open sting failed the owner's device verdict — it fired
 * off the audio-settings button instead of at open, and its slam never
 * landed. His replacement: a splash screen that prompts "Touch to begin";
 * the tap is the audio unlock, the sting plays (shuffle → whole-deck
 * SLAM), the home UI fades in slowly under the shuffle and SNAPS to full
 * at the slam.
 *
 * Cold-open only. The claim latch below lives for exactly one page load:
 * the first surface of the load claims the decision, and no later mount —
 * resume, route change, back-navigation — can show the splash again. A
 * fresh page load is a fresh module, so the splash shows again there.
 */

/** Fade endpoints (pinned with styles.css's [data-splash-reveal] rules):
 *  the home surface starts at 0.14, rises to 0.88 across the shuffle, and
 *  snaps to full strength at the slam. */
export const SPLASH_FADE_FROM = 0.14;
export const SPLASH_FADE_TO = 0.88;

/**
 * When the slam lands inside the sting, in ms from the sting's start —
 * the fade's duration and the snap's moment.
 *
 * PICK-DEPENDENT: the owner picked sting-B (2026-11-04) — the double
 * riffle into the deepest thud — so the wire-in set this to sting-B's
 * measured slam timestamp (see
 * ~/workspace/your_files/app-open-sting-candidates/README.md) and pointed
 * the deckSlam slot at sting-B's file. If the asset is ever re-picked,
 * this constant moves to the new file's measured slam with it.
 */
export const SPLASH_SLAM_MS = 1050;

export type BootSplashMode = 'sting' | 'instant';
export interface BootSplashPlan {
  /** Render the splash gate at all (false once this load has claimed). */
  show: boolean;
  /** 'sting': tap → unlock → sting + fade + snap. 'instant': the splash
   *  still gates entry, but the tap goes straight in at full strength —
   *  the player's sound is off (the boot gate in audioSession.ts) or the
   *  player asked for reduced motion, so there is nothing to choreograph. */
  mode: BootSplashMode;
}

export function planBootSplash(input: {
  claimed: boolean;
  reducedMotion: boolean;
  stingAudible: boolean;
}): BootSplashPlan {
  if (input.claimed) return { show: false, mode: 'instant' };
  if (input.reducedMotion || !input.stingAudible) return { show: true, mode: 'instant' };
  return { show: true, mode: 'sting' };
}

let claimed = false;

/** Claim this page load's splash decision. The first caller wins (true);
 *  every later caller in the same load gets false. Boot into a resumed
 *  game claims it too (consumed, never shown) so exiting to the menu
 *  mid-session can't splash either. */
export function claimBootSplash(): boolean {
  if (claimed) return false;
  claimed = true;
  return true;
}

/** Test seam, following the engine's __setSfxDelayForTest precedent. */
export function __resetBootSplashClaimForTest(): void {
  claimed = false;
}
