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
 * Cold-open only. The claim latch below lives for exactly one app
 * SESSION: the first surface of the session claims the decision, and no
 * later mount — resume, route change, back-navigation — can show the
 * splash again. The claim is remembered in sessionStorage, so it also
 * survives a same-session document reload (the chunk self-heal spends
 * one reload per build on a page a deploy stranded; post-game surfaces
 * navigate with location.href; iOS can discard and reload a backgrounded
 * page). A genuinely fresh session — the app fully closed and relaunched,
 * a new tab — starts with empty sessionStorage, so the splash shows
 * again there: that is the cold open (owner, 2026-11-05: leaving a game
 * for the menu re-showed the splash after such a reload; the latch used
 * to live in module state alone and every reload re-armed it).
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

/** The session flag: sessionStorage is the tab-scoped lifetime the chunk
 *  self-heal's own reload flag already trusts (chunkLoad.ts), and the
 *  StoryHome mode gate set the precedent of remembering a gate's answer
 *  there so a heal reload never re-asks it. Storage can throw (private
 *  mode); every access is guarded and the claim falls back to the
 *  in-memory latch alone rather than breaking the gate. */
export const BOOT_SPLASH_SESSION_KEY = 'bwm.boot-splash';

function sessionClaimed(): boolean {
  try { return sessionStorage.getItem(BOOT_SPLASH_SESSION_KEY) === '1'; } catch { return false; }
}

function persistSessionClaim(): void {
  try { sessionStorage.setItem(BOOT_SPLASH_SESSION_KEY, '1'); } catch { /* private mode: the in-memory latch still holds for this load */ }
}

/** Claim this session's splash decision. The first caller wins (true);
 *  every later caller in the session gets false — in this load, and in
 *  any same-session reload of it. Boot into a resumed game claims it too
 *  (consumed, never shown) so exiting to the menu mid-session can't
 *  splash either. */
export function claimBootSplash(): boolean {
  if (claimed) return false;
  claimed = true;
  if (sessionClaimed()) return false;
  persistSessionClaim();
  return true;
}

/** Test seam, following the engine's __setSfxDelayForTest precedent. */
export function __resetBootSplashClaimForTest(): void {
  claimed = false;
  try { sessionStorage.removeItem(BOOT_SPLASH_SESSION_KEY); } catch { /* ignore */ }
}
