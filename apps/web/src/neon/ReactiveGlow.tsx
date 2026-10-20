/** Neon Royale P3 — reactive borders. ONE delegated pair of passive pointer
 *  listeners on window lights the border of the glass panel under the
 *  pointer: it writes --mx/--my (pointer position inside the panel) and
 *  --glow-a (ring opacity) as CSS custom properties, and the ring itself is
 *  drawn by CSS. No per-panel listeners, no React state, no layout reads
 *  beyond one getBoundingClientRect per animation frame while the pointer
 *  moves. Mouse/pen track continuously; touch lights on press only (a touch
 *  drag is a scroll, never a hover) and clears on release. Renders null;
 *  mounted once at the root next to InkLayer. The gate mirrors the ink
 *  engine's: Neon only, off under reduced motion / Reduce effects. */
import { useEffect, useState } from 'react';
import { useReduceEffects } from '../fx';
import { useTheme } from '../theme';
import { glowEnabled, glowPoint, glowSurfaceFor } from './pointerGlow';

function useOsReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

export default function ReactiveGlow() {
  const theme = useTheme();
  const reduceFx = useReduceEffects();
  const osReduced = useOsReducedMotion();
  const enabled = glowEnabled({ theme, reducedMotion: osReduced, reduceEffects: reduceFx });

  useEffect(() => {
    if (!enabled) return;
    let current: HTMLElement | null = null;
    let raf = 0;
    let pending: { x: number; y: number; target: EventTarget | null } | null = null;

    const clear = () => {
      if (current) current.style.removeProperty('--glow-a');
      current = null;
    };
    const apply = () => {
      raf = 0;
      if (!pending) return;
      const { x, y, target } = pending;
      pending = null;
      const el = target instanceof Element ? target : null;
      const panel = glowSurfaceFor(el) as HTMLElement | null;
      if (panel !== current) {
        clear();
        current = panel;
      }
      if (!current) return;
      const p = glowPoint(current.getBoundingClientRect(), x, y);
      current.style.setProperty('--mx', `${Math.round(p.x)}px`);
      current.style.setProperty('--my', `${Math.round(p.y)}px`);
      current.style.setProperty('--glow-a', '1');
    };
    const queue = (e: PointerEvent) => {
      pending = { x: e.clientX, y: e.clientY, target: e.target };
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onMove = (e: PointerEvent) => { if (e.pointerType !== 'touch') queue(e); };
    const onDown = (e: PointerEvent) => queue(e);
    const onUp = (e: PointerEvent) => { if (e.pointerType === 'touch') clear(); };
    const onLeave = () => clear();

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointercancel', onUp, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
      clear();
    };
  }, [enabled]);

  return null;
}
