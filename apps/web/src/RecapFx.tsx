import { useEffect, useRef } from 'react';
import {
  CONFETTI_FALL_MS, CONFETTI_MS, CONFETTI_STILL_MS, PHOTO_MS, WIRE_MS, WIRE_STILL_MS,
  confettiPieceAt, confettiPieces, confettiStillPose, photoScoresLine, photoTapeAt, photoTapeSegments,
  wireShadowAt, type ConfettiPiece,
} from './recapfx';
import './recapfx.css';

/**
 * Wave B recap/victory surfaces — the rebuilt renderers for Down to the
 * Wire, Photo Finish and Victory Confetti. All motion derives from the
 * pure, seekable models in recapfx.ts (elapsed time is the only clock
 * input). Presentational only: pointer-events none, no timers touched,
 * held timings — wire 900 ms, photo 3000 ms, confetti 2300 ms (calm
 * 750 / 3000-still / 1300 ms).
 *
 * These components are the drop-in replacements for the AnimFxLayer shots
 * of the same names; the layer's trigger calls are the coordinator hook
 * (see the Wave B report).
 */

function useElapsed(active: boolean, onFrame: (tMs: number) => void, maxMs: number): void {
  const cb = useRef(onFrame);
  cb.current = onFrame;
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const t0 = performance.now();
    const frame = () => {
      const t = performance.now() - t0;
      cb.current(Math.min(t, maxMs));
      if (t < maxMs && !document.hidden) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, [active, maxMs]);
}

/** Down to the Wire — the table's edge light tightens like a held breath. */
export function WireOverlay({ still = false }: { still?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useElapsed(true, (t) => {
    const el = ref.current;
    if (el) el.style.boxShadow = wireShadowAt(t, still);
  }, still ? WIRE_STILL_MS : WIRE_MS);
  useEffect(() => { // paint the first frame even before rAF (calm = static read)
    const el = ref.current;
    if (el) el.style.boxShadow = wireShadowAt(still ? 225 : 270, still);
  }, [still]);
  return <div ref={ref} className={`recapfx-wire${still ? ' still' : ''}`} data-testid="recapfx-wire" aria-hidden="true" />;
}

/** Photo Finish — a finish-line tape snaps across, both final scores at the tape. */
export function PhotoFinishTape({
  winnerScore, loserScore, margin, inRecap = false,
}: {
  winnerScore: number;
  loserScore: number;
  margin: number;
  /** Render inside the recap sheet (absolute) instead of the viewport. */
  inRecap?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const tape = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const scores = useRef<HTMLDivElement>(null);
  useElapsed(true, (t) => {
    const f = photoTapeAt(t);
    if (root.current) root.current.style.opacity = String(f.out);
    if (tape.current) {
      tape.current.style.transform = `scaleX(${f.tape.toFixed(4)})`;
      tape.current.style.opacity = String(f.tapeAlpha * f.out);
    }
    if (head.current) head.current.style.opacity = String(f.headAlpha * f.out);
    if (scores.current) scores.current.style.opacity = String(f.scoresAlpha * f.out);
  }, PHOTO_MS);
  return (
    <div ref={root} className={`recapfx-photo${inRecap ? ' in-recap' : ''}`} data-testid="recapfx-photofinish" aria-hidden="true">
      <div ref={tape} className="pf-tape">
        {photoTapeSegments().map((on, i) => <i key={i} className={on ? 'on' : 'off'} />)}
      </div>
      <div ref={head} className="pf-head">PHOTO FINISH</div>
      <div ref={scores} className="pf-scores">{photoScoresLine(winnerScore, loserScore, margin)}</div>
    </div>
  );
}

/** Victory Confetti — canvas rain with real flutter physics, seeded per match. */
export function VictoryConfetti({
  seed = null, still = false, colors,
}: {
  seed?: string | null;
  still?: boolean;
  /** The winning side's colours; defaults to the shipped gold palette. */
  colors?: readonly string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pieces: ConfettiPiece[] = confettiPieces(seed, still, colors);
    const dpr = Math.min(1.5, window.devicePixelRatio || 1); // §D cap
    let raf = 0;
    let stopped = false;
    const draw = (tMs: number) => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      let ctx: CanvasRenderingContext2D | null = null;
      try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      for (const p of pieces) {
        const pose = still ? confettiStillPose(p, w) : confettiPieceAt(p, tMs, w, h);
        if (!pose.visible || pose.opacity <= 0) continue;
        ctx.save();
        ctx.globalAlpha = still ? Math.min(1, tMs / CONFETTI_STILL_MS) : pose.opacity;
        ctx.translate(pose.x, still ? 0.04 * h : pose.y);
        ctx.rotate((pose.rot * Math.PI) / 180);
        ctx.scale(Math.max(0.08, pose.face), 1);
        ctx.fillStyle = p.c;
        ctx.shadowColor = 'rgba(255, 200, 60, .55)';
        ctx.shadowBlur = 8;
        if (p.chip) {
          ctx.fillRect(-p.s / 2, -p.s * 0.32, p.s, p.s * 0.64);
        } else {
          ctx.font = `${p.s}px serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('♠', 0, 0);
        }
        ctx.restore();
      }
    };
    if (still) {
      draw(CONFETTI_STILL_MS);
      return;
    }
    const t0 = performance.now();
    const frame = () => {
      if (stopped) return;
      const t = performance.now() - t0;
      draw(Math.min(t, CONFETTI_FALL_MS + 600));
      if (t < CONFETTI_MS && !document.hidden) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, [seed, still, colors]);
  return (
    <div className="recapfx-confetti" data-testid="recapfx-confetti" aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
