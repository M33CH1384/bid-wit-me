/**
 * The Doorway — the transition program for STORY entries (owner,
 * 2026-10-23: "Build them all" — stage 4, the last of the family):
 * Home -> Story Mode, and the story map -> a stop's tape/intro. Warm
 * light spills from a door cracking open on the right of the screen,
 * the room warms through it, the swap lands under full warm cover,
 * and the light settles. ~1.2 s — the slowest of the family, because
 * this one is a threshold, not a shortcut. Story register only:
 * amber light and dark wood, never broadcast chrome. Every other
 * story move keeps the spray/ink it already had, and story tables
 * are untouched (their scene ceremonies own those doors).
 *
 * Construction: four static pieces — a warm shade, a spilled-light
 * panel scaling from the door's crack edge, a glow, and the door
 * panel itself swinging on its hinge under perspective — moved only
 * by WAAPI transform/opacity, per the family law (no canvas, no
 * per-frame painting). Silent by design: no existing foley fits a
 * door of light, and story scenes own their own sound.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  PROGRAM_SPECS,
  getTransitionSnapshot,
  registerTransitionRenderer,
  subscribeTransitions,
} from './transitions';
import './transitions.css';

const SPEC = PROGRAM_SPECS.doorway;

export default function DoorwayLayer() {
  const snap = useSyncExternalStore(subscribeTransitions, getTransitionSnapshot, getTransitionSnapshot);
  const active = snap.phase !== 'idle' && snap.program === 'doorway';
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
      // The room warms first — everything else happens inside it.
      run(q('door-shade'), [{ opacity: '0' }, { opacity: '1' }], {
        duration: SPEC.coverMs * 0.7,
        delay: -resumeMs * 0.7,
        easing: 'ease-out',
      });
      run(q('door-glow'), [
        { opacity: '0', transform: 'translate(-50%, -50%) scale(0.72)' },
        { opacity: '0.85', transform: 'translate(-50%, -50%) scale(1.12)' },
      ], { duration: SPEC.coverMs, delay: -resumeMs, easing: 'ease-out' });
      // The crack widens: light spills left from the door's edge.
      run(q('door-light'), [
        { transform: 'scaleX(0.015)', opacity: '0.4' },
        { transform: 'scaleX(1)', opacity: '1' },
      ], { duration: SPEC.coverMs * 0.9, delay: 60 - resumeMs * 0.9, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)' });
      // The door itself swings on its hinge (right edge).
      run(q('door-panel'), [
        { transform: 'rotateY(0deg)' },
        { transform: 'rotateY(-24deg)' },
      ], { duration: SPEC.coverMs, delay: -resumeMs, easing: 'ease-out' });
    } else {
      // The light settles: spill and glow let go, the door eases
      // nearly shut, and the warm shade lifts last so the new
      // screen arrives warm and cools to normal.
      run(q('door-light'), [
        { transform: 'scaleX(1)', opacity: '1' },
        { transform: 'scaleX(0.86)', opacity: '0' },
      ], { duration: SPEC.revealMs * 0.8, easing: 'ease-out' });
      run(q('door-glow'), [
        { opacity: '0.85', transform: 'translate(-50%, -50%) scale(1.12)' },
        { opacity: '0', transform: 'translate(-50%, -50%) scale(1.22)' },
      ], { duration: SPEC.revealMs, easing: 'ease-out' });
      run(q('door-panel'), [
        { transform: 'rotateY(-24deg)', opacity: '1' },
        { transform: 'rotateY(-4deg)', opacity: '0' },
      ], { duration: SPEC.revealMs * 0.9, easing: 'ease-in-out' });
      run(q('door-shade'), [{ opacity: '1' }, { opacity: '0' }], {
        duration: SPEC.revealMs,
        delay: 40,
        easing: 'ease-out',
      });
    }
  }, [active, phase, episodeId, fromCoverage]);

  if (!active) return null;
  const covering = phase === 'cover';

  return (
    <div
      ref={ref}
      className="tdoor-layer"
      data-testid="doorway-layer"
      data-phase={phase}
      style={{ pointerEvents: covering ? 'auto' : 'none' }}
      aria-hidden="true"
    >
      <div data-anim="door-shade" className="tdoor-shade" style={{ opacity: covering ? 0 : 1 }} />
      <div
        data-anim="door-glow"
        className="tdoor-glow"
        style={{ opacity: covering ? 0 : 0.85, transform: 'translate(-50%, -50%) scale(1.12)' }}
      />
      <div
        data-anim="door-light"
        className="tdoor-light"
        style={{ transform: covering ? 'scaleX(0.015)' : 'scaleX(1)', opacity: covering ? 0.4 : 1 }}
      />
      <div
        data-anim="door-panel"
        className="tdoor-panel"
        style={{ transform: covering ? 'rotateY(0deg)' : 'rotateY(-24deg)' }}
      />
    </div>
  );
}
