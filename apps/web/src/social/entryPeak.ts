/**
 * crash-social3 — the Social entry peak. Entering Social rides the
 * Card Fan (store.open/close → coverThen 'profile-social'): at the
 * swap, the compositor holds the fan's nine oversized cards AND,
 * until now, the panel's entire first paint — its destination body
 * (up to the full ProfileView) plus full-screen backdrop filters
 * that re-rasterize on every fan frame. On a session already
 * carrying an evening of table play that coincidence is what kills
 * the renderer (rounds 1–2 shrank the fan's retention and its
 * repetition; the peak itself is the fan's by design).
 *
 * So the panel splits its arrival: the FRAME (backdrop, header,
 * nav, footer ticker) paints under the fan exactly as before, but
 * the BODY is held until the episode ends, and the backdrop filters
 * stand down while an episode runs (social.css .soc-episode). The
 * settled panel is byte-for-byte the old one — same glass, same
 * body, a beat later. Nothing here removes a feature; it only
 * sequences the two paints so they never coincide.
 */
import type { TransitionSnapshot } from '../transitions';

/** True while a Card Fan episode (cover or reveal) is in flight.
 *  Other programs (spray, deal, doorway) never hold the panel. */
export function fanEpisodeActive(snap: Pick<TransitionSnapshot, 'phase' | 'program'>): boolean {
  return snap.program === 'fan' && snap.phase !== 'idle';
}

/** The body is held only during an episode, and only until it has
 *  landed once: the latch means a later fan episode (say a profile
 *  move over the open panel) never blanks an arrived body. */
export function panelBodyHeld(episodeActive: boolean, bodyLatched: boolean): boolean {
  return episodeActive && !bodyLatched;
}

/* ------------------------------------------------------------------ */
/* crash-social4 — the reserve shelf, spent for ONE surface: round 3  */
/* removed the panel's own paint from the fan's peak, but the peak    */
/* itself (the fan's nine oversized cards, ≈629 MB of analytic        */
/* backing) still fires on every Social open/close, and on a session  */
/* loaded by an evening of table play it still kills the iOS          */
/* renderer at the swap — the owner bounced home again on            */
/* 2026-11-08, first tap dead, second tap (fresh process) fine. So    */
/* on iOS the Social PANEL's moves skip the fan episode entirely and  */
/* apply instantly — the same instant cut the fan's own repeat        */
/* cooldown already uses. The fan itself is untouched: /profile       */
/* routes keep it on every platform, and non-iOS keeps it for the     */
/* panel too. The settled panel is byte-for-byte the old one; only    */
/* the iOS entry/exit flourish is gone.                               */
/* ------------------------------------------------------------------ */

export interface SocialEntryDevice {
  ua: string;
  platform: string;
  maxTouchPoints: number;
}

/** iPhone, iPod, iPad, and iPadOS Safari that sends a Macintosh UA
 *  plus a touch screen — the house device read, mirrored from
 *  three/nukeVisual.ts isIosWebKit (kept local so this module stays
 *  dependency-free; the two must agree). */
export function isIosDevice(d: SocialEntryDevice): boolean {
  if (/iPhone|iPad|iPod/i.test(d.ua)) return true;
  if (d.maxTouchPoints > 1 && (/Macintosh|MacIntel/i.test(d.ua) || d.platform === 'MacIntel')) return true;
  return false;
}

/** True when a Social panel move must skip the Card Fan episode. */
export function socialFanSkipped(d: SocialEntryDevice): boolean {
  return isIosDevice(d);
}

/** The live device read for the predicate above. Never throws. */
export function currentSocialEntryDevice(): SocialEntryDevice {
  try {
    return {
      ua: navigator.userAgent ?? '',
      platform: navigator.platform ?? '',
      maxTouchPoints: navigator.maxTouchPoints ?? 0,
    };
  } catch {
    return { ua: '', platform: '', maxTouchPoints: 0 };
  }
}
