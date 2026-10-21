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
