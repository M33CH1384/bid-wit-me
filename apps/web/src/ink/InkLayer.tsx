/**
 * Neon Royale ink — the React layer that mounts the ink behind the app.
 *
 * One component, mounted once at the root (main.tsx, beside SoundDock /
 * SocialRoot). It renders:
 *  - nothing at all under Classic, or while a table is live,
 *  - a <canvas> driven by the dye-advection engine when every gate is green,
 *  - the CSS-gradient fallback when Neon is on but the engine can't/ shouldn't run.
 *
 * The pointer is OBSERVED, never intercepted: listeners are passive, on
 * window, and the canvas itself is pointer-events:none (CSS). Scrolling,
 * buttons, text selection, and card gestures cannot tell the ink exists.
 * While the user is typing in a text field, splats are suppressed so chat
 * stays calm (audit §3).
 *
 * Gate changes that leave 'webgl' mode unmount the canvas; the engine's
 * destroy() releases the GL context, so at a live table the Three.js scene is
 * the only WebGL context in the page.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '../theme';
import { fx, useReduceEffects } from '../fx';
import { loadSettings } from '../settings';
import { inkGradientAnimated, inkMode, type InkGateState } from './mode';
import { pressSplat, segmentSplats, type InkSplat } from './splat';
import { InkEngine } from './engine';

const TEXTY = 'input, textarea, select, [contenteditable="true"]';

interface PointerTrail {
  x: number;
  y: number;
  t: number;
}

/** Client pixels → field units (field is 1 unit tall, y up). */
function toField(clientX: number, clientY: number): { x: number; y: number } {
  const h = window.innerHeight || 1;
  return { x: clientX / h, y: 1 - clientY / h };
}

/** True while the interaction is about text entry — ink stays out of the way. */
function isTextyInteraction(e: PointerEvent): boolean {
  const t = e.target as Element | null;
  if (t && typeof t.closest === 'function' && t.closest(TEXTY)) return true;
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}

export default function InkLayer() {
  const theme = useTheme();
  const reduceEffects = useReduceEffects();
  const [inGame, setInGame] = useState<boolean>(
    () => typeof document !== 'undefined' && document.documentElement.classList.contains('bwm-in-game'),
  );
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => fx.osReducedMotion);
  const [glFailed, setGlFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<InkEngine | null>(null);

  /** Device quality (heuristic-backed, from game settings): 'low' ⇒ gradient. */
  const lowQuality = useMemo(() => {
    try {
      return loadSettings().quality === 'low';
    } catch {
      return false;
    }
  }, []);

  // A theme flip re-arms the GL path: an earlier failure or governor
  // exhaustion shouldn't stick forever across the user's own toggle.
  useEffect(() => {
    setGlFailed(false);
  }, [theme]);

  // In-game signal: Table mounts add .bwm-in-game to <html> (antiPan.lockBody).
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setInGame(el.classList.contains('bwm-in-game'));
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  // OS reduced motion, live.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReducedMotion(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const gates: InkGateState = {
    theme,
    inGame,
    reducedMotion,
    reduceEffects,
    lowQuality,
    webgl: !glFailed,
  };
  const mode = inkMode(gates);

  // Engine lifecycle, keyed strictly on the webgl mode: entering creates the
  // context, leaving (any gate) tears it down completely.
  useEffect(() => {
    if (mode !== 'webgl') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = InkEngine.create(canvas, { onExhausted: () => setGlFailed(true) });
    if (!engine) {
      setGlFailed(true);
      return;
    }
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [mode]);

  // Pointer observation — passive listeners only; splats go to the engine.
  useEffect(() => {
    if (mode !== 'webgl') return;
    const trails = new Map<number, PointerTrail>();
    const scratch: InkSplat[] = [];
    const feed = (s: InkSplat): void => {
      engineRef.current?.addSplat(s);
    };
    const onDown = (e: PointerEvent): void => {
      if (isTextyInteraction(e)) {
        trails.delete(e.pointerId);
        return;
      }
      const p = toField(e.clientX, e.clientY);
      trails.set(e.pointerId, { x: p.x, y: p.y, t: e.timeStamp });
      feed(pressSplat(p.x, p.y));
    };
    const onMove = (e: PointerEvent): void => {
      let from = trails.get(e.pointerId);
      if (!from) return;
      if (isTextyInteraction(e)) {
        trails.delete(e.pointerId);
        return;
      }
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const steps = events.length > 0 ? events : [e];
      for (const ev of steps) {
        const p = toField(ev.clientX, ev.clientY);
        const n = segmentSplats(from.x, from.y, p.x, p.y, (ev.timeStamp - from.t) / 1000, scratch);
        for (let i = 0; i < n; i++) feed(scratch[i]!);
        from = { x: p.x, y: p.y, t: ev.timeStamp };
      }
      trails.set(e.pointerId, from);
    };
    const onUp = (e: PointerEvent): void => {
      trails.delete(e.pointerId);
    };
    const onBlur = (): void => {
      trails.clear();
    };
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [mode]);

  if (mode === 'none') return null;
  if (mode === 'gradient') {
    return (
      <div
        className={`ink-fallback${inkGradientAnimated(gates) ? ' anim' : ''}`}
        aria-hidden="true"
        data-testid="ink-fallback"
      />
    );
  }
  return <canvas ref={canvasRef} className="ink-canvas" aria-hidden="true" data-testid="ink-canvas" />;
}
