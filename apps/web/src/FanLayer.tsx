/**
 * The Card Fan — the transition program for PROFILE + SOCIAL moves
 * (owner, 2026-10-23: "Build them all" — stage 2 of the family).
 *
 * Nine abstract card backs fan up from a pivot below the screen's
 * bottom edge and open until the CARDS THEMSELVES cover the whole
 * screen — the swap lands under full fan cover — then the fan lifts
 * off the top and is gone. ~850 ms end to end: brisker than the
 * spray, because these moves are quick peeks (a profile, the social
 * panel), not journeys. The cards are the game's own idiom
 * abstracted: deep felt backs, a keyline border, the spade mark
 * watermarked large — never literal players' cards. Both themes run
 * the same fan; under Neon the felt goes ink-violet and the mark
 * glows cyan (visuals only).
 *
 * WHOLE-SCREEN COVERAGE (owner, on the first fan: "The fan should
 * cover the whole screen not just the bottom"). The first fan sized
 * its cards off the viewport's width alone, so they topped out in
 * the screen's lower fifth and a dark shade did the rest of the
 * covering — a fan sitting at the bottom, not a fan that IS the
 * cover. fanLayout() below derives the geometry from the viewport
 * itself: every card runs from the shared pivot (just below the
 * bottom edge) to past the farthest corner — length = the
 * pivot-to-corner distance, with overshoot, at true playing-card
 * aspect — and the spread opens past the corner angle, so at full
 * cover the union of the nine card bodies contains the entire
 * viewport, top corners included. A dark shade still sits behind
 * the cards, but only as a gap-filler for the slivers between card
 * edges: no region of the screen is shade alone. The coverage is
 * pinned in transitions.test.ts (all four corners plus a fine grid,
 * computed from fanLayout/fanCardContains at phone and desktop
 * sizes) so "fan at the bottom" fails CI if it ever regresses.
 *
 * Same family discipline as the spray (see transitions.ts): ONLY
 * WAAPI tweens of transform/opacity over static DOM — zero per-frame
 * painting, ever. Motion resumes mid-flight on a re-cover snap-back
 * exactly like the spray's (negative delay from the snapshot's
 * fromCoverage).
 *
 * WAVE D (2026-10-28, §A6 row 64; the motion-studio Card Fan
 * prototype — graded 6/7/7 — is the reference treatment): the cards
 * gain REAL 3D geometry. Each card body keeps the exact flat
 * rectangle fanCardContains pins (the cover math does not move), and
 * inside it a slightly inset FACE tilts in perspective — rotateY
 * proportional to the card's fan tilt, so the fan's edges angle away
 * like held cards while the center faces the player — with the
 * card's edge showing around the face as its thickness. A light
 * sweep then crosses the formed fan card by card (per-card stagger,
 * transform/opacity only), timed to finish inside the cover window.
 * The prototype's shallow-focus blur toward the fan's edges is NOT
 * carried over: filter blur on the covering cards would soften the
 * cover itself, and the family's calm contract prefers a crisp fan.
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
/** Cards in the fan. */
export const FAN_COUNT = 9;
/** Per-card stagger inside the cover sweep (ms). Each card's tween
 *  is shortened by its own stagger, so every card lands at full
 *  cover at the same instant the controller swaps — no card is
 *  still travelling when the reveal begins. */
const FAN_STAGGER_MS = 18;
/** Per-card stagger inside the reveal lift (ms), end-aligned the
 *  same way so the last card finishes inside the reveal window. */
const FAN_REVEAL_STAGGER_MS = 14;
/** Playing-card aspect (height / width). The fan keeps it at any
 *  size — the cards read as cards because the proportions hold. */
const FAN_ASPECT = 1.42;
/** The fan's hand point: the viewport's horizontal center, this far
 *  down its height — just below the bottom edge. */
const FAN_PIVOT_DEPTH = 1.06;
/** Card length overshoot past the pivot-to-corner distance, so the
 *  outermost cards' tops clear the top corners with room to spare
 *  instead of kissing them. */
const FAN_REACH = 1.07;
/** The fan never opens narrower than this half-spread (deg)… */
const FAN_MIN_SPREAD_DEG = 46;
/** …and always opens at least this far past the viewport's corner
 *  angle (deg), so the outermost cards aim beyond the top corners
 *  on squat and wide screens too, not just tall phones. */
const FAN_CORNER_LEAD_DEG = 14;

export interface FanLayout {
  /** The shared pivot every card is anchored by its bottom-center. */
  pivotX: number;
  pivotY: number;
  /** Card width/height in px. */
  w: number;
  h: number;
  /** Fan rotations (deg) across the cards, left to right. */
  tilts: number[];
}

/**
 * The fan's geometry for a viewport — see the header for the
 * whole-screen rule. Pure in (vw, vh) so the coverage pins can
 * compute against it without a DOM.
 */
export function fanLayout(vw: number, vh: number): FanLayout {
  const pivotX = vw / 2;
  const pivotY = vh * FAN_PIVOT_DEPTH;
  const cornerDist = Math.hypot(pivotX, pivotY);
  const cornerDeg = (Math.atan2(pivotX, pivotY) * 180) / Math.PI;
  const spread = Math.max(FAN_MIN_SPREAD_DEG, cornerDeg + FAN_CORNER_LEAD_DEG);
  const h = cornerDist * FAN_REACH;
  const w = h / FAN_ASPECT;
  const tilts = Array.from({ length: FAN_COUNT }, (_, i) => -spread + (2 * spread * i) / (FAN_COUNT - 1));
  return { pivotX, pivotY, w, h, tilts };
}

/**
 * Is viewport point (x, y) inside the card at `tiltDeg` in `layout`?
 * The card is the rectangle standing on the pivot: axial distance
 * along its tilted up-axis within [0, h], lateral offset from the
 * axis within ±w/2. This is the same math the render performs
 * (bottom-center anchored at the pivot, rotated about it), and the
 * coverage pins assert the viewport against it.
 */
export function fanCardContains(layout: FanLayout, tiltDeg: number, x: number, y: number): boolean {
  const rad = (tiltDeg * Math.PI) / 180;
  const ax = Math.sin(rad);
  const ay = -Math.cos(rad);
  const vx = x - layout.pivotX;
  const vy = y - layout.pivotY;
  const s = vx * ax + vy * ay;
  if (s < 0 || s > layout.h) return false;
  const t = vx * -ay + vy * ax;
  return Math.abs(t) <= layout.w / 2;
}

/** Wave D 3D face tilt for a fan card at `tilt` deg: the face angles
 *  away from the viewer in proportion to the card's fan rotation
 *  (outer cards turn most, the center card stays nearly square-on),
 *  with a small constant rotateX lift. Pure in the tilt — the same
 *  fan, every episode. The face is inset inside the card body, so
 *  this tilt never opens a gap in the pinned cover rectangle. */
export function fanFaceTilt(tilt: number): { rotateY: number; rotateX: number } {
  const clamped = Math.max(-18, Math.min(18, -tilt * 0.3));
  return { rotateY: clamped === 0 ? 0 : clamped, rotateX: 4 };
}

/** The light sweep's schedule inside the cover (Wave D): it starts
 *  once the fan is mostly formed and the last card's sweep lands
 *  inside the cover window, so the swap never cuts it. */
const FAN_SHEEN_START_MS = 150;
const FAN_SHEEN_STAGGER_MS = 12;
const FAN_SHEEN_MS = 150;

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
    const layout = fanLayout(window.innerWidth, window.innerHeight);
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
        const tilt = layout.tilts[i] ?? 0;
        run(el, [fromState(tilt), coveredState(tilt)], {
          duration: Math.max(1, SPEC.coverMs - i * FAN_STAGGER_MS),
          delay: i * FAN_STAGGER_MS - resumeMs,
          easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)',
        });
      });
      // The light sweep crosses the formed fan, card by card.
      qa('fan-sheen').forEach((el, i) => {
        run(
          el,
          [
            { transform: 'translateX(-140%) skewX(-14deg)', opacity: '0' },
            { opacity: '0.9', offset: 0.3 },
            { transform: 'translateX(240%) skewX(-14deg)', opacity: '0' },
          ],
          {
            duration: FAN_SHEEN_MS,
            delay: FAN_SHEEN_START_MS + i * FAN_SHEEN_STAGGER_MS - resumeMs,
            easing: 'ease-out',
          },
        );
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
        const tilt = layout.tilts[i] ?? 0;
        run(el, [coveredState(tilt), liftedState(tilt)], {
          duration: Math.max(1, SPEC.revealMs - i * FAN_REVEAL_STAGGER_MS),
          delay: i * FAN_REVEAL_STAGGER_MS,
          easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)',
        });
      });
    }
  }, [active, phase, episodeId, fromCoverage]);

  if (!active) return null;
  const layout = fanLayout(window.innerWidth, window.innerHeight);
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
      {layout.tilts.map((tilt, i) => (
        <div
          key={i}
          data-anim="fan-card"
          className="tfan-card"
          style={{
            left: layout.pivotX - layout.w / 2,
            top: layout.pivotY - layout.h,
            width: layout.w,
            height: layout.h,
            transformOrigin: '50% 100%',
            ...(phase === 'cover' ? fromState(tilt) : coveredState(tilt)),
          }}
        >
          <div
            className="tfan-face"
            style={{
              transform: `rotateY(${fanFaceTilt(tilt).rotateY}deg) rotateX(${fanFaceTilt(tilt).rotateX}deg)`,
            }}
          >
            <div data-anim="fan-sheen" className="tfan-sheen" style={{ opacity: 0 }} />
            <svg className="tfan-mark" viewBox="0 0 64 64" aria-hidden="true">
              <path d={SPADE_PATH_D} fill="currentColor" />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
