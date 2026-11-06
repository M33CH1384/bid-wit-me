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
