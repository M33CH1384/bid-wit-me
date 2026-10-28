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
 *
 * WAVE D (2026-10-28, §A6 row 67): the door is now specific to the
 * destination stop's venue. The controller carries the destination
 * stop id on the episode (transitions.ts doorwayKindForStop resolves
 * it to a door kind), and this layer dresses the SAME door program
 * accordingly — a meshed screen door for the Porch, storefront glass
 * for the Barbershop and the Corner, slatted gates for the Cookout
 * and the Pj's, paired doors for the Rec Center / Church Basement /
 * Legends' / King, and brushed-steel elevator doors that part (they
 * do not swing) for the High-Rise. Kinds change the panel's material
 * and opening mechanics only: identical spec, identical beats,
 * silent under every kind. An episode that names no stop (the plain
 * Home -> Story entry) wears the original hall door, unchanged.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import {
  PROGRAM_SPECS,
  doorwayKindForStop,
  getTransitionSnapshot,
  registerTransitionRenderer,
  subscribeTransitions,
  type DoorwayKind,
} from './transitions';
import './transitions.css';

const SPEC = PROGRAM_SPECS.doorway;

/** Kinds whose door is two leaves meeting at a center seam rather
 *  than one panel on a side hinge. */
const SPLIT_KINDS: ReadonlySet<DoorwayKind> = new Set(['double', 'elevator']);

export default function DoorwayLayer() {
  const snap = useSyncExternalStore(subscribeTransitions, getTransitionSnapshot, getTransitionSnapshot);
  const active = snap.phase !== 'idle' && snap.program === 'doorway';
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => registerTransitionRenderer(true), []);

  const phase = snap.phase;
  const episodeId = snap.episodeId;
  const fromCoverage = snap.fromCoverage;
  const kind = doorwayKindForStop(snap.doorwayStop);
  const split = SPLIT_KINDS.has(kind);

  useLayoutEffect(() => {
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const q = (name: string) => root.querySelector<HTMLElement>(`[data-anim="${name}"]`);
    const d = (name: string) => root.querySelector<HTMLElement>(`[data-decor="${name}"]`);
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
      if (split) {
        // Paired doors open from their center seam: elevator leaves
        // slide apart, double doors swing outward on their outer
        // hinges. The panel wrapper itself never moves.
        if (kind === 'elevator') {
          run(d('door-leaf-l'), [{ transform: 'translateX(0%)' }, { transform: 'translateX(-72%)' }], {
            duration: SPEC.coverMs, delay: -resumeMs, easing: 'ease-out',
          });
          run(d('door-leaf-r'), [{ transform: 'translateX(0%)' }, { transform: 'translateX(72%)' }], {
            duration: SPEC.coverMs, delay: -resumeMs, easing: 'ease-out',
          });
        } else {
          run(d('door-leaf-l'), [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(26deg)' }], {
            duration: SPEC.coverMs, delay: -resumeMs, easing: 'ease-out',
          });
          run(d('door-leaf-r'), [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-26deg)' }], {
            duration: SPEC.coverMs, delay: -resumeMs, easing: 'ease-out',
          });
        }
      } else {
        // The door itself swings on its hinge (right edge).
        run(q('door-panel'), [
          { transform: 'rotateY(0deg)' },
          { transform: 'rotateY(-24deg)' },
        ], { duration: SPEC.coverMs, delay: -resumeMs, easing: 'ease-out' });
      }
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
      if (split) {
        if (kind === 'elevator') {
          run(d('door-leaf-l'), [
            { transform: 'translateX(-72%)', opacity: '1' },
            { transform: 'translateX(-58%)', opacity: '0' },
          ], { duration: SPEC.revealMs * 0.9, easing: 'ease-in-out' });
          run(d('door-leaf-r'), [
            { transform: 'translateX(72%)', opacity: '1' },
            { transform: 'translateX(58%)', opacity: '0' },
          ], { duration: SPEC.revealMs * 0.9, easing: 'ease-in-out' });
        } else {
          run(d('door-leaf-l'), [
            { transform: 'rotateY(26deg)', opacity: '1' },
            { transform: 'rotateY(4deg)', opacity: '0' },
          ], { duration: SPEC.revealMs * 0.9, easing: 'ease-in-out' });
          run(d('door-leaf-r'), [
            { transform: 'rotateY(-26deg)', opacity: '1' },
            { transform: 'rotateY(-4deg)', opacity: '0' },
          ], { duration: SPEC.revealMs * 0.9, easing: 'ease-in-out' });
        }
      } else {
        run(q('door-panel'), [
          { transform: 'rotateY(-24deg)', opacity: '1' },
          { transform: 'rotateY(-4deg)', opacity: '0' },
        ], { duration: SPEC.revealMs * 0.9, easing: 'ease-in-out' });
      }
      run(q('door-shade'), [{ opacity: '1' }, { opacity: '0' }], {
        duration: SPEC.revealMs,
        delay: 40,
        easing: 'ease-out',
      });
    }
  }, [active, phase, episodeId, fromCoverage, kind, split]);

  if (!active) return null;
  const covering = phase === 'cover';
  // A leaf's resting transform for the phase being rendered (the
  // WAAPI run above starts from exactly this state).
  const leafL = split
    ? covering
      ? kind === 'elevator'
        ? 'translateX(0%)'
        : 'rotateY(0deg)'
      : kind === 'elevator'
        ? 'translateX(-72%)'
        : 'rotateY(26deg)'
    : undefined;
  const leafR = split
    ? covering
      ? kind === 'elevator'
        ? 'translateX(0%)'
        : 'rotateY(0deg)'
      : kind === 'elevator'
        ? 'translateX(72%)'
        : 'rotateY(-26deg)'
    : undefined;

  return (
    <div
      ref={ref}
      className={`tdoor-layer tdoor-kind-${kind}`}
      data-testid="doorway-layer"
      data-phase={phase}
      data-door-kind={kind}
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
        style={split ? undefined : { transform: covering ? 'rotateY(0deg)' : 'rotateY(-24deg)' }}
      >
        {kind === 'screen' && <div data-decor="door-mesh" className="tdoor-mesh" />}
        {kind === 'shop' && <div data-decor="door-glass" className="tdoor-glass" />}
        {kind === 'gate' && <div data-decor="door-rails" className="tdoor-rails" />}
        {split && (
          <>
            <div data-decor="door-leaf-l" className="tdoor-leaf tdoor-leaf-l" style={{ transform: leafL }} />
            <div data-decor="door-leaf-r" className="tdoor-leaf tdoor-leaf-r" style={{ transform: leafR }} />
          </>
        )}
      </div>
    </div>
  );
}
