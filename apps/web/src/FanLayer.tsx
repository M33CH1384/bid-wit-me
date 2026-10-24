/**
 * The Card Fan — the transition program for PROFILE + SOCIAL moves
 * (owner, 2026-10-23: "Build them all" — stage 2 of the family).
 *
 * Seven abstract card backs fan up from a pivot below the screen's
 * bottom edge and sweep across until the screen is covered — the
 * swap lands under full fan cover — then the fan lifts off the top
 * and is gone. ~850 ms end to end: brisker than the spray, because
 * these moves are quick peeks (a profile, the social panel), not
 * journeys. The cards are the game's own idiom abstracted: deep felt
 * backs, a keyline border, the spade mark watermarked large — never
 * literal players' cards. Both themes run the same fan; under Neon
 * the felt goes ink-violet and the mark glows cyan (visuals only).
 *
 * Same family discipline as the spray (see transitions.ts): ONLY
 * WAAPI tweens of transform/opacity over static DOM — zero per-frame
 * painting, ever. A dark shade under the fan reaches full opacity at
 * cover, so the swap is guaranteed hidden even between card corners.
 * Motion resumes mid-flight on a re-cover snap-back exactly like the
 * spray's (negative delay from the snapshot's fromCoverage).
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { SPADE_PATH_D } from './SprayLayer';
import {
  PROGRAM_SPECS,
  getTransitionSnapshot,
  registerTransitionRenderer,
  subscribeTransitions,
} from './transitions';
import { useTheme } from './theme';
import './transitions.css';

const SPEC = PROGRAM_SPECS.fan;
/** Fan rotations (deg) across the seven cards, left to right. */
const FAN_TILTS = [-39, -26, -13, 0, 13, 26, 39] as const;
/** Per-card stagger inside the cover sweep (ms). */
const FAN_STAGGER_MS = 26;

interface FanGeo {
  /** Card width/height in px. */
  w: number;
  h: number;
  /** Card left/top so the card's bottom-center sits on the pivot. */
  left: number;
  top: number;
}

function fanGeometry(): FanGeo {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(vw * 0.46, vh * 0.36);
  const h = w * 1.42;
  // Pivot at (50vw, 116vh): cards anchored by their bottom-center
  // there fan up and outward, their tops sweeping the whole screen.
  return { w, h, left: vw / 2 - w / 2, top: vh * 1.16 - h };
}

const fromState = (tilt: number) => ({
  transform: `rotate(${tilt * 0.25}deg) translateY(26%) scale(0.94)`,
  opacity: '0',
});
const coveredState = (tilt: number) => ({
  transform: `rotate(${tilt}deg) translateY(0%) scale(1)`,
  opacity: '1',
});
const liftedState = (tilt: number) => ({
  transform: `rotate(${tilt + 58}deg) translateY(-46%) scale(1.02)`,
  opacity: '0',
});

export default function FanLayer() {
  const snap = useSyncExternalStore(subscribeTransitions, getTransitionSnapshot, getTransitionSnapshot);
  const theme = useTheme();
  const active = snap.phase !== 'idle' && snap.program === 'fan';
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => registerTransitionRenderer(true), []);

  const phase = snap.phase;
  const episodeId = snap.episodeId;
  const fromCoverage = snap.fromCoverage;

  useLayoutEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const q = (name: string) => root.querySelector<HTMLElement>(`[data-anim="${name}"]`);
    const qa = (name: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-anim="${name}"]`));
    const run = (el: HTMLElement | null, frames: Keyframe[], opts: KeyframeAnimationOptions) => {
      if (!el) return;
      try {
        el.animate(frames, { fill: 'both', ...opts });
      } catch {
        /* older engines: the CSS end state still lands */
      }
    };

    if (phase === 'cover') {
      const resumeMs = fromCoverage * SPEC.coverMs;
      run(q('fan-shade'), [{ opacity: '0' }, { opacity: '1' }], {
        duration: SPEC.coverMs,
        delay: -resumeMs,
        easing: 'ease-out',
      });
      qa('fan-card').forEach((el, i) => {
        const tilt = FAN_TILTS[i] ?? 0;
        run(el, [fromState(tilt), coveredState(tilt)], {
          duration: SPEC.coverMs,
          delay: i * FAN_STAGGER_MS - fromCoverage * SPEC.coverMs,
          easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)',
        });
      });
    } else {
      // Reveal: the fan keeps turning the way it came and lifts off
      // the top; the shade lets go first so the new screen breathes
      // in under the rising cards.
      run(q('fan-shade'), [{ opacity: '1' }, { opacity: '0' }], {
        duration: SPEC.revealMs * 0.55,
        easing: 'ease-out',
      });
      qa('fan-card').forEach((el, i) => {
        const tilt = FAN_TILTS[i] ?? 0;
        run(el, [coveredState(tilt), liftedState(tilt)], {
          duration: SPEC.revealMs,
          delay: i * 14,
          easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)',
        });
      });
    }
  }, [active, phase, episodeId, fromCoverage]);

  if (!active) return null;
  const geo = fanGeometry();
  const neon = theme === 'neon';

  return (
    <div
      ref={ref}
      className={`tfan-layer${neon ? ' tfan-neon' : ''}`}
      data-testid="fan-layer"
      data-phase={phase}
      style={{ pointerEvents: phase === 'cover' ? 'auto' : 'none' }}
      aria-hidden="true"
    >
      <div data-anim="fan-shade" className="tfan-shade" style={{ opacity: phase === 'cover' ? 0 : 1 }} />
      {FAN_TILTS.map((tilt, i) => (
        <div
          key={i}
          data-anim="fan-card"
          className="tfan-card"
          style={{
            left: geo.left,
            top: geo.top,
            width: geo.w,
            height: geo.h,
            transformOrigin: '50% 100%',
            ...(phase === 'cover' ? fromState(tilt) : coveredState(tilt)),
          }}
        >
          <svg className="tfan-mark" viewBox="0 0 64 64" aria-hidden="true">
            <path d={SPADE_PATH_D} fill="currentColor" />
          </svg>
        </div>
      ))}
    </div>
  );
}
