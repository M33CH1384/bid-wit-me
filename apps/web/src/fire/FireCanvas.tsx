/**
 * Streak-fire surface (owner, 2026-10-27): the React shell around the
 * canvas engine (fire/fireEngine.ts). Two shapes:
 *  - band: a wide low fire along an edge (the home screen's bottom).
 *  - plate: fire around one seat's name plate at a table — flames rise
 *    from the plate's bottom edge around its sides and above its top,
 *    clipped out of the plate's own rect so the plate stays readable.
 * Purely presentational: pointer-events none, aria-hidden, no buttons,
 * no state — identical DOM in Classic and Neon (theme parity: the fire
 * is the same effect in both themes; only the app's own chrome differs).
 *
 * Reduced motion / Reduce effects (the app's fx prefs, passed in as
 * `calm`): no loop — the engine paints ONE static frame (a gentle glow
 * with a few still tongues), the same "persistent looks stay, motion
 * goes" convention the animfx layer already follows.
 */
import { useEffect, useRef, type CSSProperties } from 'react';
import type { FireTierParams } from '../streakFire';
import { FireEffect, type FireRect } from './fireEngine';
import './fire.css';

export interface FireCanvasProps {
  params: FireTierParams;
  mode: 'band' | 'plate';
  /** plate mode: plate rect in canvas-local CSS px (the component's own
   *  box is the plate rect expanded by the caller) */
  mask?: FireRect | null;
  calm?: boolean;
  className?: string;
  testId?: string;
  /** compact marker line (e.g. "ON FIRE ×4") shown as a chip */
  label?: string | null;
  labelTestId?: string;
  /** where the chip sits inside the box (plate anchors position it
   *  against the plate's corner; the band leaves it centered) */
  chipStyle?: CSSProperties;
}

export default function FireCanvas({ params, mode, mask, calm, className, testId, label, labelTestId, chipStyle }: FireCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<FireEffect | null>(null);
  const optsRef = useRef({ mode, mask, calm });
  optsRef.current = { mode, mask, calm };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fx = new FireEffect(canvas, params, optsRef.current);
    fxRef.current = fx;
    return () => { fx.destroy(); fxRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fxRef.current?.setParams(params, optsRef.current);
  }, [params, mode, mask, calm]);

  return (
    <div ref={hostRef} className={`streak-fire ${mode}${calm ? ' calm' : ''}${className ? ` ${className}` : ''}`} data-testid={testId} aria-hidden="true">
      <canvas ref={canvasRef} className="streak-fire-canvas" />
      {label && <span className="streak-fire-chip" data-testid={labelTestId} style={chipStyle}>{label}</span>}
    </div>
  );
}
