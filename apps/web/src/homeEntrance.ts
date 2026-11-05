/**
 * MENU WEATHER / FIRE ENTRANCE (owner, 2026-11-05): "The weather / fire
 * shouldn't just snap on when I get to the menu — it should fade in for
 * snow, and light like a real fire, with sound."
 *
 * The home streak atmosphere (Setup.tsx's home step) used to mount at
 * full tier strength the instant the streak payload landed. Now every
 * ARRIVAL at Home gets an entrance:
 *
 *  - SNOW (blizzard.ts tiers): a smoothstep opacity/density ramp from
 *    nothing to the tier's full strength over SNOW_ENTRANCE_MS. At
 *    ramp 1 the layer is exactly the settled layer — tiers, frost and
 *    flake counts are untouched. Reduced motion keeps the same gentle
 *    opacity fade on the static frost (the layer's calm path).
 *  - FIRE (streakFire.ts HOME_FIRE_TIERS): the band's params start at
 *    a KINDLING row — a small, sparse, just-lit flame — and blend to
 *    the tier row along the catch curve below: kindle slow (with a
 *    small deterministic sputter — a catching fire flickers), catch
 *    fast, settle easing to EXACTLY the tier row at FIRE_ENTRANCE_MS,
 *    so the resting band ("fully visible rising over the ticker's
 *    edge") is byte-identical to before. The blend rides
 *    streakFire's blendFireParams — the same machinery tier changes
 *    already cross-fade through.
 *  - SOUND: the recorded fireIgnite cue (audio.ts; SSE Library, CC0 —
 *    CREDITS.md) fires once from Setup at the entrance's start when a
 *    fire tier presents, gated exactly like its sibling fire one-shot
 *    (the fireOut extinguish hiss): SFX settings rule it, and calm /
 *    reduce-effects silences it.
 *
 * Trigger discipline (Setup owns the gate; the decision is pure and
 * pinned here): the entrance plays ONCE per arrival, keyed to the
 * streak state's first presentation WITH an active atmosphere — a
 * pending payload arms nothing, a NEUTRAL payload presents nothing
 * and marks nothing, and once played, payload refires / re-renders /
 * tab returns within the arrival read settled. Leaving Home resets
 * the gate (Setup's step effect): a return IS a new arrival. On the
 * cold-open path the entrance additionally waits for the boot reveal
 * (bootSplash.ts's markBootRevealed — the slam moment), so it never
 * starts before the tap and never fights the splash sting.
 */
import { useEffect, useState } from 'react';
import { blendFireParams, type FireTierParams } from './streakFire';

/* ------------------------------------------------------------------ snow */

/** How long the weather takes to fade/build in on an arrival. */
export const SNOW_ENTRANCE_MS = 3400;

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const smoothstep = (t: number): number => { const x = clamp01(t); return x * x * (3 - 2 * x); };

/** Snow entrance strength at an elapsed time: 0 (nothing) → 1 (the
 *  tier's full strength), smoothstepped, clamped on both ends. */
export function snowEntranceAt(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  return smoothstep(elapsedMs / SNOW_ENTRANCE_MS);
}

/* ------------------------------------------------------------------ fire */

/** How long the home fire takes to light — kindle, catch, settle. */
export const FIRE_ENTRANCE_MS = 2600;

/** Under reduced motion the fire does not ramp its params (the engine
 *  paints its calm static frame); the band instead fades in gently
 *  over this long. */
export const FIRE_CALM_FADE_MS = 1400;

/** The just-lit flame the entrance starts from: small tongues, sparse
 *  spawn, a low glow, no sparks yet, barely any smoke — a fire in its
 *  first seconds, read against HOME_FIRE_TIERS (T1 is 30 particles /
 *  0.52 flame height / 0.35 glow). */
export const FIRE_KINDLE_PARAMS: FireTierParams = {
  particles: 12,
  spawnPerSec: 6,
  flameHeight: 0.16,
  embersPerSec: 1.2,
  sparksPerSec: 0,
  glow: 0.12,
  smokePerSec: 0.3,
};

/**
 * The catch curve, 0 → 1 over FIRE_ENTRANCE_MS:
 *  - kindle (0–0.9 s): rises slowly to 0.22, with a small deterministic
 *    sputter wobble that dies out as the fire takes hold;
 *  - catch (0.9–2.0 s): the fast sweep, 0.22 → 0.94;
 *  - settle (2.0–2.6 s): eases 0.94 → exactly 1.
 */
export function fireEntranceBlend(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (elapsedMs >= FIRE_ENTRANCE_MS) return 1;
  if (elapsedMs < 900) {
    const t = elapsedMs / 900;
    const sputter = Math.sin(elapsedMs * 0.045) * 0.025 * (1 - t);
    return clamp01(smoothstep(t) * 0.22 + sputter);
  }
  if (elapsedMs < 2000) return 0.22 + smoothstep((elapsedMs - 900) / 1100) * 0.72;
  return 0.94 + smoothstep((elapsedMs - 2000) / 600) * 0.06;
}

/** The band's params at an elapsed time in the entrance: kindling at
 *  0, the tier row EXACTLY at/after FIRE_ENTRANCE_MS (the guard keeps
 *  the settled row bit-exact — the resting look never drifts). */
export function fireEntranceParams(target: FireTierParams, elapsedMs: number): FireTierParams {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return FIRE_KINDLE_PARAMS;
  if (elapsedMs >= FIRE_ENTRANCE_MS) return target;
  return blendFireParams(FIRE_KINDLE_PARAMS, target, fireEntranceBlend(elapsedMs));
}

/* ------------------------------------------------------------------ gate */

export type EntranceDecision = 'play' | 'settled' | 'none';

/**
 * The once-per-arrival decision, pure: an arrival with no active
 * atmosphere presents NO entrance (and marks nothing — a later active
 * presentation in the same arrival still gets its entrance); the
 * first active presentation PLAYS; anything after that is SETTLED.
 */
export function entranceDecision(playedThisArrival: boolean, hasAtmosphere: boolean): EntranceDecision {
  if (!hasAtmosphere) return 'none';
  return playedThisArrival ? 'settled' : 'play';
}

/* ------------------------------------------------------------------ hooks */

/**
 * Elapsed ms since `startedAt`, rAF-driven, clamped to [0, durationMs]
 * and stepped at ~50 ms (enough for both ramps; a menu screen does not
 * need 60 state updates a second). `startedAt === null` reads as
 * FINISHED (durationMs) — no entrance in flight means settled. The
 * state is keyed to the startedAt it belongs to, so a fresh arrival
 * never inherits a previous entrance's elapsed for even one frame.
 */
export function useEntranceElapsedMs(startedAt: number | null, durationMs: number): number {
  const [tick, setTick] = useState<{ at: number | null; elapsed: number }>({ at: null, elapsed: 0 });
  useEffect(() => {
    if (startedAt == null) return;
    let raf = 0;
    let last = -1;
    const step = () => {
      const elapsed = Math.min(durationMs, Math.max(0, performance.now() - startedAt));
      if (elapsed !== last && (elapsed - last >= 50 || elapsed >= durationMs)) {
        last = elapsed;
        setTick({ at: startedAt, elapsed });
      }
      if (elapsed < durationMs) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, durationMs]);
  if (startedAt == null) return durationMs;
  return tick.at === startedAt ? tick.elapsed : 0;
}

/**
 * The home band's live params during an entrance. Settled (no
 * startedAt, or the calm path — the engine paints its static frame at
 * full params and the band fades instead) reads the tier row as-is;
 * during the entrance it walks the catch curve from kindling.
 */
export function useIgnitedFireParams(target: FireTierParams, startedAt: number | null, ramp: boolean): FireTierParams {
  const elapsed = useEntranceElapsedMs(ramp ? startedAt : null, FIRE_ENTRANCE_MS);
  if (!ramp || startedAt == null) return target;
  return fireEntranceParams(target, elapsed);
}
