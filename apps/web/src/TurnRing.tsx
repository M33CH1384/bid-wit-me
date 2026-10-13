import { useLayoutEffect, useRef } from 'react';
import { vibrationOn } from './haptics';
import { applyTurnRing, ownTurnBuzz, turnBuzzMarks, turnRingSample } from './turnRing';

/**
 * Countdown ring for the seat that is on the clock. Paint runs on one
 * requestAnimationFrame and writes SVG attributes only — no React render,
 * no filter, no box-shadow — so WebKit can keep it on a small layer.
 * `start` and `deadline` are already corrected onto the local clock.
 */
export function TurnCountdown({ start, deadline, mine, now }: {
  start: number;
  deadline: number;
  /** This browser's own seat. The last-3s tick only fires then. */
  mine: boolean;
  now?: () => number;
}) {
  const root = useRef<SVGSVGElement>(null);
  const track = useRef<SVGCircleElement>(null);
  const glow = useRef<SVGCircleElement>(null);
  const shade = useRef<SVGCircleElement>(null);
  const arc = useRef<SVGCircleElement>(null);

  useLayoutEffect(() => {
    const clock = now ?? (() => Date.now());
    let prev = deadline - clock();
    let raf = 0;
    const frame = () => {
      const t = clock();
      const sample = turnRingSample(t, start, deadline);
      applyTurnRing(root.current, track.current, glow.current, shade.current, arc.current, sample);
      if (mine && turnBuzzMarks(prev, sample.remaining).length) {
        ownTurnBuzz(vibrationOn() && !document.hidden);
      }
      prev = sample.remaining;
      if (sample.remaining > 0 && !document.hidden) raf = requestAnimationFrame(frame);
    };
    const resume = () => {
      cancelAnimationFrame(raf);
      if (document.hidden) return;
      prev = deadline - clock();
      frame();
    };
    frame();
    document.addEventListener('visibilitychange', resume);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [start, deadline, mine, now]);

  return (
    <svg ref={root} className="turn-ring" viewBox="0 0 36 36" data-testid="turn-ring" aria-hidden="true">
      <circle ref={track} className="turn-ring-track" cx="18" cy="18" r="16.2" />
      <g transform="rotate(-90 18 18)">
        <circle ref={glow} className="turn-ring-glow" cx="18" cy="18" r="16.2" />
        <circle ref={shade} className="turn-ring-shade" cx="18" cy="18" r="16.2" />
        <circle ref={arc} className="turn-ring-arc" cx="18" cy="18" r="16.2" />
      </g>
    </svg>
  );
}
