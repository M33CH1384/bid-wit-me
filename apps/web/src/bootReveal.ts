/**
 * App-open reveal (owner, 2026-11-04): the choreographed half of the boot
 * sting. When the engine fires the sting (deck-slam.mp3 — a shuffle, then
 * the whole deck slammed down), it dispatches 'bwm:bootsting' carrying the
 * slam's offset in the file. The home surface fades in slowly for exactly
 * that long — dim, building — and the animation ends BELOW full strength,
 * so the surface's return to its resting opacity 1 lands with the slam:
 * sound and picture hit together.
 *
 * The event is the only trigger. With sound off (or the sting otherwise
 * silent) the engine never dispatches it, so the home simply appears at
 * full strength — no fade ever waits on a sound that does not come.
 * Reduced motion: snap only, no fade.
 */
import { useEffect, type RefObject } from 'react';

/** Kept in step with BOOT_STING_EVENT in audio.ts (the cross-named-constant
 *  pattern, like THUNDER_DELAY_S): the engine dispatches, this listens. */
export const BOOT_STING_EVENT = 'bwm:bootsting';

export interface BootFadePlan { kind: 'fade' | 'snap'; durationMs: number }

/** Pure: the fade lasts exactly until the slam — the duration is the offset
 *  it was handed, never a tuned constant of this module's own. Reduced
 *  motion (or a missing offset) snaps. */
export function bootFadePlan(slamMs: number, reducedMotion: boolean): BootFadePlan {
  if (reducedMotion || !(slamMs > 0)) return { kind: 'snap', durationMs: 0 };
  return { kind: 'fade', durationMs: slamMs };
}

/** The wind-up: dim, building, deliberately NOT reaching full strength —
 *  when the animation ends (fill: none) the surface returns to its resting
 *  opacity 1 in one step, and that step is the snap. */
export function bootRevealKeyframes(): Keyframe[] {
  return [
    { opacity: 0.14, offset: 0 },
    { opacity: 0.88, offset: 1 },
  ];
}

/** Run the reveal on the one home surface. While it runs the surface is
 *  presentational ([data-boot-reveal] kills pointer events in styles.css);
 *  input is live again the moment the animation finishes — at the snap. */
export function runBootReveal(el: HTMLElement, slamMs: number, reducedMotion: boolean): void {
  const plan = bootFadePlan(slamMs, reducedMotion);
  if (plan.kind === 'snap') return; // already at full strength; nothing to do
  el.setAttribute('data-boot-reveal', '');
  let anim: Animation | null = null;
  try {
    anim = el.animate(bootRevealKeyframes(), { duration: plan.durationMs, easing: 'linear' });
  } catch { /* no WAAPI: fall through to the cleanup below */ }
  if (!anim) { el.removeAttribute('data-boot-reveal'); return; }
  const done = () => el.removeAttribute('data-boot-reveal');
  anim.onfinish = done;
  anim.oncancel = done;
}

/** Listen for the boot sting and run the reveal on the home surface. */
export function useBootReveal(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const onSting = (e: Event) => {
      const el = ref.current;
      if (!el) return;
      const slamMs = (e as CustomEvent<{ slamMs?: number }>).detail?.slamMs ?? 0;
      const reduced = typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      runBootReveal(el, slamMs, reduced);
    };
    window.addEventListener(BOOT_STING_EVENT, onSting);
    return () => window.removeEventListener(BOOT_STING_EVENT, onSting);
  }, [ref]);
}
