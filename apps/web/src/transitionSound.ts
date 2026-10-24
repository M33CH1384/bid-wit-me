/**
 * Transition-family sounds (owner, 2026-10-23) — the non-spray
 * programs' foley, riding the same discipline as spraySound.ts:
 * phase-event driven off the shared controller's snapshots, one
 * instance per episode, on the normal SFX bus (so the player's SFX
 * settings govern), and silent whenever the transition itself is
 * suppressed (a suppressed move never starts an episode, so nothing
 * fires). The spray program has its own module (the can); the Ink
 * Bloom and the Doorway stay silent by design.
 *
 * The sounds are the game's existing CC0 card foley (Kenney, see
 * CREDITS.md): the Fan gets a soft shuffle, the Deal gets three card
 * slides staggered across its dwell, the Book Sweep gets one card
 * shove. All are short one-shots scheduled inside their cover window
 * — a cancel leaves nothing playing past the moment it happened.
 */
import { sound } from './audio';
import { getTransitionSnapshot, subscribeTransitions } from './transitions';

let lastEpisode = -1;

export function initTransitionSound(): () => void {
  return subscribeTransitions(() => {
    const snap = getTransitionSnapshot();
    if (snap.phase !== 'cover' || snap.episodeId === lastEpisode) return;
    lastEpisode = snap.episodeId;
    if (snap.program === 'fan') {
      sound.play('shuffle', { dur: 0.8, gain: 0.5 });
    } else if (snap.program === 'deal') {
      sound.play('deal', { delay: 0, gain: 0.55 });
      sound.play('deal', { delay: 0.14, gain: 0.5 });
      sound.play('deal', { delay: 0.28, gain: 0.5 });
    } else if (snap.program === 'sweep') {
      sound.play('sweep', { gain: 0.6 });
    }
  });
}
