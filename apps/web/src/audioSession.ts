/** What to do with an AudioContext that is not producing sound. */
export type AudioWake = 'ok' | 'resume' | 'recreate';

/**
 * iOS Safari sets `AudioContext.state` to `'interrupted'` when a call, Siri, or the lock screen
 * takes the audio session. `resume()` does not clear that, and a `'closed'` context cannot be resumed.
 * Both need a new context. `'suspended'` (autoplay, or a backgrounded page) can be resumed.
 */
export function audioContextAction(state: string | null | undefined): AudioWake {
  if (state === 'running') return 'ok';
  if (state === 'interrupted' || state === 'closed') return 'recreate';
  return 'resume';
}

/**
 * The header speaker should look tappable. Only after the player has already unlocked audio, and
 * only while they still want sound. A brand-new suspended context (before the first tap) stays quiet.
 */
export function soundRestorePending(state: string | null | undefined, unlocked: boolean, soundWanted: boolean): boolean {
  if (!unlocked || !soundWanted) return false;
  return state !== 'running';
}

/** Accessible name for the existing header speaker. A suspended context is restored by tapping that icon. */
export function speakerAriaLabel(needsTap: boolean, muted: boolean): string {
  if (needsTap) return 'Sound paused — tap to restore';
  if (muted) return 'Sound (muted) — hold to unmute';
  return 'Sound settings — hold to mute all';
}

/**
 * Minimum gap between context rebuilds. While an iOS interruption persists, every statechange /
 * wake would otherwise rebuild the context again — each rebuild copies every decoded buffer and
 * retires two music elements — so rebuilds are rate-limited and the heal retry below re-checks
 * once the gap has passed (by then the interruption has usually ended, and the fresh context can run).
 */
export const RECREATE_COOLDOWN_MS = 3000;

/** Whether a context rebuild is due, given when the last one happened (ms timestamps). */
export function recreateDue(lastRecreateAt: number, now: number): boolean {
  return now - lastRecreateAt >= RECREATE_COOLDOWN_MS;
}

/**
 * How often the engine retries recovery while a restore is pending (context not running after
 * unlock). iOS ends most interruptions on its own — a phone call ends, an utterance finishes —
 * but a suspended/interrupted context does not resume itself; this cadence is what turns
 * "sound returns at the player's next random tap" into "sound returns on its own, promptly".
 */
export const RESTORE_HEAL_MS = 1500;

/**
 * `AudioContext.resume()` and `close()` reject when the output device cannot start (headless WebKit,
 * a closed context). The rejection is not an exception, so a bare `void promise` becomes an unhandled
 * rejection and can tear the page down. Always settle it.
 */
export function settleAudio(p: Promise<unknown> | void | undefined | null): Promise<void> {
  return Promise.resolve(p).then(() => undefined, () => undefined);
}

/** The slice of the Audio Session API this app uses (`navigator.audioSession`, Safari on iOS 17+). */
export interface AudioSessionLike { type: string }

/**
 * Claim the system audio session for playback (Demetrius 2026-10-21, the prevention pass).
 * Where the Audio Session API exists, setting `navigator.audioSession.type = 'playback'`
 * tells iOS the game's Web Audio is first-class media playback — the category music and
 * ambience apps get — instead of an ambient afterthought other audio can push around.
 * It is a claim, not a shield: a phone call or Siri still interrupts, which is why the heal
 * above stays. Feature-detected and silent: browsers without the API keep the old behavior
 * exactly, and a host object that refuses the write just reports false. Returns true when
 * the session now reads 'playback'.
 */
export function claimPlaybackSession(nav: { audioSession?: AudioSessionLike } | null | undefined): boolean {
  try {
    const s = nav?.audioSession;
    if (!s) return false;
    if (s.type !== 'playback') s.type = 'playback';
    return s.type === 'playback';
  } catch { return false; }
}

/** The slice of the speech engine the cancel guard needs (the real `speechSynthesis` satisfies it). */
export interface SpeechEngineLike { speaking: boolean; pending: boolean; cancel(): void }

/**
 * Stop speech ONLY when an utterance is actually active (Demetrius 2026-10-21, the
 * prevention pass). On iOS, touching `speechSynthesis` at all — even an idle `cancel()`
 * with nothing speaking — pokes the system audio session the game's AudioContext lives
 * on, so table/scene exits and the voices-off toggle must not call it out of habit. With
 * the Web Speech fallback fenced off during live play (talkPrefs), no utterance can be
 * active at a table, so in practice this never fires there; the guard keeps the
 * stop-anything-speaking intent for any path that does have one. Returns true when a
 * cancel was actually issued.
 */
export function cancelActiveSpeech(synth: SpeechEngineLike | null | undefined): boolean {
  try {
    if (!synth || !(synth.speaking || synth.pending)) return false;
    synth.cancel();
    return true;
  } catch { return false; }
}
