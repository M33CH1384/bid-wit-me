import { useEffect, useState } from 'react';

/** Phone in landscape (short + wide): gets its own HUD + 3D framing. */
export const isShortLandscape = (w: number, h: number) => w > h * 1.25 && h <= 540;

export interface Viewport { w: number; h: number; short: boolean; safe: { l: number; r: number; t: number; b: number } }

function read(probe: HTMLElement | null): Viewport {
  const w = window.innerWidth, h = window.innerHeight;
  let safe = { l: 0, r: 0, t: 0, b: 0 };
  if (probe) {
    const cs = getComputedStyle(probe);
    safe = { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
  }
  return { w, h, short: isShortLandscape(w, h), safe };
}

/** Viewport size + iOS safe-area insets (env(safe-area-inset-*)), live on resize / rotation. */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => read(null));
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
    const on = () => setVp(read(probe));
    on();
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    return () => { window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); probe.remove(); };
  }, []);
  return vp;
}
