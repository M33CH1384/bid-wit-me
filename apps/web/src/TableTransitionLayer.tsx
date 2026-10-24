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
        qa('deal-card').forEach((el, i) => {
          const slot = DEAL_SLOTS[i] ?? DEAL_SLOTS[0];
          run(
            el,
            [
              { transform: 'rotate(0deg)', opacity: '0' },
              { transform: `translate(${el.dataset.dx}px, ${el.dataset.dy}px) rotate(${slot[2]}deg)`, opacity: '1' },
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
        qa('deal-card').forEach((el, i) => {
          const slot = DEAL_SLOTS[i] ?? DEAL_SLOTS[0];
          run(
            el,
            [
              { transform: `translate(0px, 0px) rotate(${slot[2]}deg)`, opacity: '1' },
              { transform: `translate(${-Number(el.dataset.dx ?? 0)}px, ${-Number(el.dataset.dy ?? 0)}px) rotate(0deg)`, opacity: '0' },
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
      } else {
        run(
          q('sweep-panel'),
          [
            { transform: 'translateX(0%) translateY(0%) scale(1)', opacity: '1' },
            { transform: 'translateX(-34%) translateY(26%) scale(0.55)', opacity: '0' },
          ],
          { duration: SWEEP.revealMs, easing: 'cubic-bezier(0.5, 0, 0.75, 0.4)' },
        );
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
        <div className="tt-stack" style={{ width: g.w, height: g.h }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
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
    </div>
  );
}
