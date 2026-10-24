/**
 * Sound for the spray-paint screen transition (owner, 2026-10-23: "add
 * sound to it — not no cheesy sounds, let's get authentic"). The sounds
 * themselves live in the audio engine (sound.spraySoundStart/Stop — real
 * recorded can foley on the SFX channel, see CREDITS.md); this module is
 * only the wiring: it translates the spray controller's phase events into
 * engine calls, deriving every picture timing from spray.ts's own
 * constants, so retuning the animation can never desync the sound.
 *
 * The sync map (owner's staging, 2026-10-23):
 *  - SHAKE: a fresh cover opens with the can's rattle, leading the spray —
 *    it runs SPRAY_SHAKE_LEAD_S and finishes right as the hiss begins
 *    (the tagger shakes, then sprays). A snap-back re-cover gets no second
 *    shake: the tagger is already painting, the hiss just resumes.
 *  - HISS: continuous close-nozzle aerosol from the shake's end, tracking
 *    the outline + fill beats, then decaying across the first
 *    SPRAY_HISS_BLOOM_FADE_S of the bloom — silent before full black.
 *  - SILENCE: at full black (the swap + hold) and through the whole
 *    dissolve/reveal — nothing sprays on the way off.
 *  - CANCEL: a cancelled spray (table navigation, failsafe) cuts the
 *    sound with the paint — no orphaned hiss over the next screen.
 * A suppressed spray (Reduce effects / OS reduce-motion) never changes
 * phase, so it never sounds: the sound belongs to the animation, not to
 * navigation in general. Cover timers here mirror the controller's own
 * setTimeout discipline; a phase event always wins over a pending timer.
 */
import { getSpraySnapshot, subscribeSpray, SPRAY_SPADE_MS, type SprayPhase } from './spray';
import { sound } from './audio';

/** The rattle's lead at the top of a fresh cover, in ms: the shake asset's
 *  strikes land inside this window and the hiss starts as they end. A
 *  sound-staging constant (it sizes the shake cut, not the picture). */
export const SPRAY_SHAKE_LEAD_MS = 220;
/** How long the hiss takes to decay once the bloom begins, in seconds. */
export const SPRAY_HISS_BLOOM_FADE_S = 0.15;
/** Cover completed: the safety stop as the reveal begins (seconds). In the
 *  normal run the hiss is already out (it decayed into the bloom). */
export const SPRAY_SOUND_COVER_END_FADE_S = 0.12;
/** Cancelled spray: the near-cut, in seconds. */
export const SPRAY_SOUND_CANCEL_FADE_S = 0.06;

let wired = false;

/** Wire the spray controller to the engine. Idempotent — Root mounts it
 *  once; returns the unsubscribe (used by tests). */
export function initSpraySound(): () => void {
  if (wired) return () => undefined;
  wired = true;
  let prev: SprayPhase = getSpraySnapshot().phase;
  let decayTimer: ReturnType<typeof setTimeout> | undefined;
  const clearDecay = () => {
    if (decayTimer !== undefined) clearTimeout(decayTimer);
    decayTimer = undefined;
  };
  const off = subscribeSpray(() => {
    const snap = getSpraySnapshot();
    const phase = snap.phase;
    if (phase === prev) return;
    const was = prev;
    prev = phase;
    if (phase === 'cover') {
      const fresh = snap.fromCoverage <= 0;
      sound.spraySoundStart(fresh, fresh ? SPRAY_SHAKE_LEAD_MS / 1000 : 0);
      // The hiss tracks outline + fill and decays into the bloom: schedule
      // its fade for the moment the bloom beat begins (SPRAY_SPADE_MS is
      // the controller's own outline+fill total, so a retune moves this
      // with the picture). A phase event before then replaces this timer.
      clearDecay();
      decayTimer = setTimeout(() => {
        decayTimer = undefined;
        sound.spraySoundStop(SPRAY_HISS_BLOOM_FADE_S);
      }, SPRAY_SPADE_MS);
    } else if (phase === 'reveal' && was === 'cover') {
      clearDecay();
      sound.spraySoundStop(SPRAY_SOUND_COVER_END_FADE_S);
    } else if (phase === 'idle' && was === 'cover') {
      clearDecay();
      sound.spraySoundStop(SPRAY_SOUND_CANCEL_FADE_S);
    }
    // reveal -> idle: the hiss is long out; the dissolve is silent.
  });
  return () => {
    clearDecay();
    off();
    wired = false;
  };
}
