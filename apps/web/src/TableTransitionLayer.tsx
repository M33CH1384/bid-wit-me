/**
 * The table pair of the transition family (owner, 2026-10-23:
 * "Build them all" — stage 3): THE DEAL on table entry and THE BOOK
 * SWEEP on table exit. One layer renders both programs; the shared
 * controller (transitions.ts) owns their lifecycles.
 *
 * THE DEAL: eight face-down cards deal out of the bottom-left corner
 * and fan across a darkening felt until the screen is covered. The
 * swap (the table mounting) happened instantly underneath at nav
 * time — what the deal covers is the table's own seats-loading hold,
 * which proceeds as always; the controller lifts the deal when the
 * table signals ready AND the ~700 ms dwell has passed, with a hard
 * readiness cap so the deal can never trap the player (it resolves
 * onto the seats hold instead). Story tables never deal: story co-op
 * rooms render inside StoryHome and never take the /t/ route, and
 * the offline story table enters through StoryHome's own state.
 *
 * THE BOOK SWEEP: a won-book stack rides the leading edge of a felt
 * scoop panel that slides across and covers the screen (the swap to
 * home/lobby lands underneath), then the whole pile is carried off
 * toward the bottom-left corner and fades — a collected trick,
 * taken. Exit only: it never plays between hands.
 *
 * Family discipline: WAAPI transform/opacity only, zero per-frame
 * painting; input locked only while a cover is up.
 *
 * WAVE D (2026-10-28, §A6 rows 65–66): §A6 asks the Deal and the
 * Book Sweep to reuse the table's own 3D deal/gather flights. Those
 * flights live in the table's three.js scene, and two standing laws
 * bar importing them here: the transitions' compositor-only
 * invariant (transform/opacity/clip-path/filter ONLY) and the
 * entry-graph law (no static three.js imports into entry-reachable
 * modules — this layer mounts in Root). So Wave D re-expresses the
 * same motions in CSS 3D within the invariant, and flags the
 * substitution as a coordinator item in the wave report:
 *  - THE DEAL: each card now flies an ARC — it leaves the corner,
 *    rises and tips (rotateX) at mid-flight, overshoots its slot's
 *    rotation a breath, and settles flat. Same 320 ms flight, same
 *    50 ms stagger, same 700 ms dwell: the last card still lands
 *    inside the dwell, and the ready-driven lifecycle is untouched.
 *    The reveal gather rides the same arc home (the shipped reveal
 *    teleported each card to the corner on its first frame — its
 *    opening keyframe sat at the corner, not at the slot; the arc
 *    home removes the jump).
 *  - THE BOOK SWEEP: the reveal no longer shrinks the whole panel
 *    away. The felt fades through to the menu while the won-book
 *    stack peels off card by card and gathers along an arc to the
 *    SAME bottom-left dealer corner the Deal deals from — one
 *    continuous motion language for entering and leaving a table.
 */
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { SPADE_PATH_D } from './SprayLayer';
import {
  PROGRAM_SPECS,
  getTransitionSnapshot,
  registerTransitionRenderer,
  subscribeTransitions,
} from './transitions';
import './transitions.css';

const DEAL = PROGRAM_SPECS.deal;
const SWEEP = PROGRAM_SPECS.sweep;

/** Deal slots: [left %, top %, rotation deg] the cards fan out to. */
const DEAL_SLOTS: ReadonlyArray<readonly [number, number, number]> = [
  [6, 16, -14], [24, 8, -7], [43, 5, -2], [62, 8, 4],
  [80, 16, 11], [16, 52, -9], [38, 58, 0], [62, 52, 9],
];

function dealGeo() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(vw * 0.21, vh * 0.16);
  return { w, h: w * 1.42, vw, vh };
}

/** Wave D: the Deal flight's arc height (px) for a card travelling
 *  (dx, dy) from the dealer corner to its slot — proportional to the
 *  distance, clamped so short hops stay flat and long ones sail.
 *  Pure, so the flight model is pinned by tests, not eyeballing. */
export function dealArcHeight(dx: number, dy: number): number {
  const dist = Math.hypot(dx, dy);
  return Math.round(Math.min(120, Math.max(24, dist * 0.16)));
}

function sweepGeo() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(vw * 0.24, vh * 0.18);
  return { w, h: w * 1.42, vw, vh };
}

export default function TableTransitionLayer() {
  const snap = useSyncExternalStore(subscribeTransitions, getTransitionSnapshot, getTransitionSnapshot);
  const program = snap.program;
  const active = snap.phase !== 'idle' && (program === 'deal' || program === 'sweep');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => registerTransitionRenderer(true), []);

  const phase = snap.phase;
  const episodeId = snap.episodeId;

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

    if (program === 'deal') {
      if (phase === 'cover') {
        run(q('deal-felt'), [{ opacity: '0' }, { opacity: '1' }], {
          duration: 380,
          easing: 'ease-out',
        });
        // Each slot's landing shadow gathers as its card comes
        // down — the flight's weight, on transform/opacity only.
        qa('deal-shadow').forEach((el, i) => {
          run(
            el,
            [
              { transform: 'scale(0.55)', opacity: '0' },
              { transform: 'scale(1)', opacity: '0.38' },
            ],
            { duration: 180, delay: i * 50 + 140, easing: 'ease-out' },
          );
        });
        qa('deal-card').forEach((el, i) => {
          const slot = DEAL_SLOTS[i] ?? DEAL_SLOTS[0];
          const dx = Number(el.dataset.dx ?? 0);
          const dy = Number(el.dataset.dy ?? 0);
          const arc = dealArcHeight(dx, dy);
          run(
            el,
            [
              { transform: 'translate(0px, 0px) rotate(0deg) rotateX(0deg) scale(0.94)', opacity: '0' },
              {
                transform: `translate(${dx * 0.55}px, ${dy * 0.55 - arc}px) rotate(${slot[2] * 0.6}deg) rotateX(16deg) scale(1.03)`,
                opacity: '1',
                offset: 0.55,
              },
              {
                transform: `translate(${dx}px, ${dy}px) rotate(${slot[2]}deg) rotateX(0deg) scale(1)`,
                opacity: '1',
              },
            ],
            { duration: 320, delay: i * 50, easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)' },
          );
        });
      } else {
        // The table is ready and live underneath: the dealt cards
        // gather back to the corner they came from and the felt
        // lets go — the table is interactive the instant this ends
        // (input was never locked past the cover).
        run(q('deal-felt'), [{ opacity: '1' }, { opacity: '0' }], {
          duration: DEAL.revealMs,
          delay: 60,
          easing: 'ease-out',
        });
        qa('deal-shadow').forEach((el, i) => {
          run(el, [{ transform: 'scale(1)', opacity: '0.38' }, { transform: 'scale(0.8)', opacity: '0' }], {
            duration: 160,
            delay: i * 16,
            easing: 'ease-out',
          });
        });
        qa('deal-card').forEach((el, i) => {
          const slot = DEAL_SLOTS[i] ?? DEAL_SLOTS[0];
          const dx = Number(el.dataset.dx ?? 0);
          const dy = Number(el.dataset.dy ?? 0);
          const arc = dealArcHeight(dx, dy);
          // Wave D: the gather home starts AT the slot (the shipped
          // first keyframe sat at the corner — a one-frame teleport)
          // and rides the flight arc back down to the corner pile.
          run(
            el,
            [
              { transform: `translate(${dx}px, ${dy}px) rotate(${slot[2]}deg) rotateX(0deg) scale(1)`, opacity: '1' },
              {
                transform: `translate(${dx * 0.45}px, ${dy * 0.45 - arc * 0.7}px) rotate(${slot[2] * 0.4}deg) rotateX(12deg) scale(0.97)`,
                opacity: '1',
                offset: 0.5,
              },
              { transform: 'translate(0px, 0px) rotate(0deg) rotateX(0deg) scale(0.94)', opacity: '0' },
            ],
            { duration: DEAL.revealMs * 0.8, delay: i * 16, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)' },
          );
        });
      }
    } else {
      // Book Sweep.
      if (phase === 'cover') {
        run(q('sweep-panel'), [{ transform: 'translateX(103%)' }, { transform: 'translateX(0%)' }], {
          duration: SWEEP.coverMs,
          easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)',
        });
        // The book stack rides the panel's leading edge in — it is a
        // sibling of the panel now (so the reveal can fade the felt
        // without fading the books), travelling the same distance on
        // the same curve.
        const vw = window.innerWidth;
        run(q('sweep-stack'), [{ transform: `translateX(${vw}px)` }, { transform: 'translateX(0px)' }], {
          duration: SWEEP.coverMs,
          easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)',
        });
      } else {
        // Wave D reveal: the felt fades through to the menu while
        // the won books peel off the stack one by one and gather
        // along an arc to the dealer corner (the Deal's own corner).
        run(
          q('sweep-panel'),
          [
            { transform: 'translateX(0%)', opacity: '1' },
            { transform: 'translateX(-4%)', opacity: '0' },
          ],
          { duration: SWEEP.revealMs * 0.72, easing: 'ease-out' },
        );
        qa('sweep-card').forEach((el, i) => {
          const dx = Number(el.dataset.dx ?? 0);
          const dy = Number(el.dataset.dy ?? 0);
          const bx = i * 5;
          const by = -i * 5;
          const rot = -6 + i * 3;
          run(
            el,
            [
              { transform: `translate(${bx}px, ${by}px) rotate(${rot}deg)`, opacity: '1' },
              {
                transform: `translate(${dx * 0.5 + bx}px, ${dy * 0.5 + by - 36}px) rotate(${rot * 0.5}deg)`,
                opacity: '1',
                offset: 0.55,
              },
              {
                transform: `translate(${dx + bx}px, ${dy + by}px) rotate(${rot * 0.3}deg)`,
                opacity: '0',
              },
            ],
            { duration: SWEEP.revealMs * 0.7, delay: 30 + i * 30, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)' },
          );
        });
      }
    }
  }, [active, phase, episodeId, program]);

  if (!active) return null;

  if (program === 'deal') {
    const g = dealGeo();
    const cornerX = g.vw * 0.04;
    const cornerY = g.vh - g.h - g.vh * 0.04;
    return (
      <div
        ref={ref}
        className="tt-layer"
        data-testid="table-transition-layer"
        data-program="deal"
        data-phase={phase}
        style={{ pointerEvents: phase === 'cover' ? 'auto' : 'none' }}
        aria-hidden="true"
      >
        <div data-anim="deal-felt" className="tt-felt" style={{ opacity: phase === 'cover' ? 0 : 1 }} />
        {DEAL_SLOTS.map((slot, i) => {
          const x = (slot[0] / 100) * g.vw;
          const y = (slot[1] / 100) * g.vh;
          return (
            <div
              key={`shadow-${i}`}
              data-anim="deal-shadow"
              className="tt-deal-shadow"
              style={{
                left: x - g.w * 0.08,
                top: y - g.h * 0.05,
                width: g.w * 1.16,
                height: g.h * 1.1,
                opacity: phase === 'cover' ? 0 : 0.38,
              }}
            />
          );
        })}
        {DEAL_SLOTS.map((slot, i) => {
          const x = (slot[0] / 100) * g.vw;
          const y = (slot[1] / 100) * g.vh;
          const dx = x - cornerX;
          const dy = y - cornerY;
          const dealt = `translate(${dx}px, ${dy}px) rotate(${slot[2]}deg)`;
          return (
            <div
              key={i}
              data-anim="deal-card"
              data-dx={dx}
              data-dy={dy}
              className="tfan-card tt-card"
              style={{
                left: cornerX,
                top: cornerY,
                width: g.w,
                height: g.h,
                transform: phase === 'cover' ? 'rotate(0deg)' : dealt,
                opacity: phase === 'cover' ? 0 : 1,
              }}
            >
              <svg className="tfan-mark" viewBox="0 0 64 64" aria-hidden="true">
                <path d={SPADE_PATH_D} fill="currentColor" />
              </svg>
            </div>
          );
        })}
      </div>
    );
  }

  const g = sweepGeo();
  // Wave D gather geometry: the stack sits at the scoop's leading
  // edge (explicit px, so the gather math below is exact), and the
  // dealer corner it gathers to is the Deal's own corner.
  const stackX = 26;
  const stackY = g.vh / 2 - g.h / 2;
  const cornerX = g.vw * 0.04;
  const cornerY = g.vh - g.h - g.vh * 0.04;
  const sdx = cornerX - stackX;
  const sdy = cornerY - stackY;
  return (
    <div
      ref={ref}
      className="tt-layer"
      data-testid="table-transition-layer"
      data-program="sweep"
      data-phase={phase}
      style={{ pointerEvents: phase === 'cover' ? 'auto' : 'none' }}
      aria-hidden="true"
    >
      <div data-anim="sweep-panel" className="tt-scoop" style={{ transform: phase === 'cover' ? 'translateX(103%)' : 'translateX(0%)' }}>
        <div className="tt-scoop-edge" />
      </div>
      <div
        data-anim="sweep-stack"
        className="tt-stack"
        style={{
          left: stackX,
          top: stackY,
          marginTop: 0,
          width: g.w,
          height: g.h,
          transform: phase === 'cover' ? `translateX(${g.vw}px)` : 'translateX(0px)',
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            data-anim="sweep-card"
            data-dx={sdx}
            data-dy={sdy}
            className="tfan-card tt-stack-card"
            style={{ transform: `translate(${i * 5}px, ${-i * 5}px) rotate(${-6 + i * 3}deg)` }}
          >
            {i === 3 && (
              <svg className="tfan-mark" viewBox="0 0 64 64" aria-hidden="true">
                <path d={SPADE_PATH_D} fill="currentColor" />
              </svg>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
