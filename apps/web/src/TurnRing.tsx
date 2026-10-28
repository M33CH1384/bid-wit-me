import { useLayoutEffect, useRef } from 'react';
import { vibrationOn } from './haptics';
import { fx } from './fx';
import { applyTurnRing, fuseSparkFrame, ownTurnBuzz, turnBuzzMarks, turnRingSample } from './turnRing';
import './animfx/animfx.css';
import './recapfx.css';

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
    // FUSE CLOCK (animation package wave 2): the local player's own plate
    // edge burns down like a fuse through the final 5 seconds of their
    // clock. Visual only — the deadline, the buzz marks and every timer are
    // untouched. Driven by this same rAF sampler (direct DOM writes, no
    // React state), removed with the turn.
    let fuse: HTMLDivElement | null = null;
    let fuseBar: HTMLDivElement | null = null;
    // Wave B: the spark is a real particle, not a CSS dot — a tiny canvas
    // lane over the fuse track draws the spark head + its deterministic
    // ember falloff from fuseSparkFrame (turnRing.ts). The bar's width
    // contract is unchanged; the canvas is decoration on the same read.
    let fuseCanvas: HTMLCanvasElement | null = null;
    if (mine) {
      const plate = root.current?.closest('.plate');
      if (plate) {
        fuse = document.createElement('div');
        fuse.className = 'animfx-fuse';
        fuse.dataset.testid = 'animfx-fuse';
        fuseBar = document.createElement('div');
        fuseBar.className = 'animfx-fuse-bar';
        const spark = document.createElement('div');
        spark.className = 'animfx-fuse-spark';
        fuseBar.appendChild(spark);
        fuse.appendChild(fuseBar);
        fuseCanvas = document.createElement('canvas');
        fuseCanvas.className = 'recapfx-fuse-canvas';
        fuseCanvas.dataset.testid = 'animfx-fuse-spark-canvas';
        fuse.appendChild(fuseCanvas);
        plate.appendChild(fuse);
      }
    }
    const drawFuseSpark = (rem: number, t: number, calmFuse: boolean) => {
      if (!fuse || !fuseCanvas) return;
      const w = fuse.clientWidth;
      if (!w) return;
      const dpr = Math.min(1.5, window.devicePixelRatio || 1);
      const H = 16;
      if (fuseCanvas.width !== Math.round(w * dpr) || fuseCanvas.height !== Math.round(H * dpr)) {
        fuseCanvas.width = Math.round(w * dpr);
        fuseCanvas.height = Math.round(H * dpr);
      }
      let ctx: CanvasRenderingContext2D | null = null;
      try { ctx = fuseCanvas.getContext('2d'); } catch { ctx = null; }
      if (!ctx) return;
      const f = fuseSparkFrame(rem, calmFuse ? 0 : t, calmFuse);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, H);
      if (!f.lit) return;
      const headX = (calmFuse ? 1 : f.head) * w;
      const midY = H / 2;
      for (const e of f.embers) {
        ctx.globalAlpha = e.alpha;
        ctx.fillStyle = '#ff9a3c';
        ctx.beginPath();
        ctx.arc(headX + e.dx * w, midY + e.dy * 6, e.size, 0, Math.PI * 2);
        ctx.fill();
      }
      // spark head: white-hot core with an ember halo, flickering per frame model
      const halo = ctx.createRadialGradient(headX, midY, 0, headX, midY, 7);
      halo.addColorStop(0, 'rgba(255, 246, 216, .95)');
      halo.addColorStop(0.35, `rgba(255, 179, 71, ${0.55 + 0.4 * f.flicker})`);
      halo.addColorStop(1, 'rgba(255, 120, 30, 0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(headX, midY, 7, 0, Math.PI * 2);
      ctx.fill();
    };
    const frame = () => {
      const t = clock();
      const sample = turnRingSample(t, start, deadline);
      applyTurnRing(root.current, track.current, glow.current, shade.current, arc.current, sample);
      if (fuse && fuseBar) {
        const rem = sample.remaining;
        if (rem <= 5000 && rem > 0) {
          const calmFuse = fx.reduced || fx.osReducedMotion;
          fuse.style.opacity = '1';
          fuse.classList.toggle('calm', calmFuse);
          fuseBar.style.width = calmFuse ? '100%' : `${Math.max(0, rem / 50)}%`;
          drawFuseSpark(rem, t, calmFuse);
        } else {
          fuse.style.opacity = '0';
        }
      }
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
      fuse?.remove();
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
