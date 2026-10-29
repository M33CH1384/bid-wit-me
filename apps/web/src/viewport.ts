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
  // Automated-check seam (like sound.testState): an e2e can inject a real iPhone's safe-area bottom
  // (home indicator ~34px) that desktop WebKit reports as 0, so chrome coverage is actually tested.
  const injected = (window as unknown as { __bwmSafeBottom?: unknown }).__bwmSafeBottom;
  if (typeof injected === 'number' && Number.isFinite(injected) && injected > safe.b) safe = { ...safe, b: injected };
  return { w, h, short: isShortLandscape(w, h), safe };
}

/**
 * Viewport size + iOS safe-area insets (env(safe-area-inset-*)), live on resize / rotation.
 *
 * Rotation perf (owner device report, 2026-10-29: "lags extremely bad when
 * switching between portrait and landscape"): a rotation is not one event —
 * window resize, orientationchange and a stream of visualViewport resizes
 * (Safari chrome retracting) all fire, and the old hook committed a fresh
 * Viewport object for EVERY one, re-rendering the whole table (and with it
 * the 3D scene's prop tree) dozens of times per flip. Two guards now:
 *  - events are coalesced through one rAF, so a burst costs one read;
 *  - a read commits only when something the table actually consumes moved:
 *    the `short` landscape class or a safe-area inset. Pixel-only size
 *    wiggles (chrome show/hide mid-rotation) are layout's job (dvh/CSS), not
 *    React's — no consumer reads w/h off this record (Table takes short +
 *    safe only), so w/h ride along with the last meaningful commit.
 */
export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => read(null));
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
    let raf = 0;
    let committed: Viewport | null = null;
    const commit = () => {
      raf = 0;
      const next = read(probe);
      if (committed && next.short === committed.short
        && next.safe.l === committed.safe.l && next.safe.r === committed.safe.r
        && next.safe.t === committed.safe.t && next.safe.b === committed.safe.b) return;
      committed = next;
      setVp(next);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(commit); };
    commit(); // the mount read always commits (real insets replace the safe-less initial state)
    window.addEventListener('resize', on);
    window.addEventListener('orientationchange', on);
    // Safari's bottom chrome shows/hides with scroll/gesture: innerHeight/dvh lag visualViewport.
    window.visualViewport?.addEventListener('resize', on);
    return () => { if (raf) cancelAnimationFrame(raf); window.removeEventListener('resize', on); window.removeEventListener('orientationchange', on); window.visualViewport?.removeEventListener('resize', on); probe.remove(); };
  }, []);
  return vp;
}
