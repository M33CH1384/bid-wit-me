/**
 * BLIZZARD layer (owner, 2026-11-04 — losing-streak snow on the Home
 * Screen, the streak fire read backwards; see blizzard.ts for the data
 * source and tier table). Rendered by Setup's home step only, when
 * homeBlizzardTier(lossStreak) > 0.
 *
 * Shape: ONE absolutely-positioned wrapper inside .wiz-home, in DOM
 * order right after EmblemSmoke (the splash and the actions paint
 * above it — the snow lives behind/around the content, never over the
 * buttons), holding a static frost div (pure CSS gradients, snow.css)
 * and ONE canvas-2D snow field. No layout participation (absolute,
 * inset 0), pointer-events none end to end.
 *
 * Performance (the Social-crash lesson — this is a menu screen): the
 * flake population is created once per tier from the tier table and
 * hard-capped by BLIZZARD_TIERS (max SNOW_MAX_FLAKES = 150 across the
 * whole feature); flakes are plain filled circles — no sprites, no
 * shadowBlur, no per-flake gradients; the backing store is one
 * full-screen canvas at dpr ≤ 2 (~6.4 MB at 430×932, against the fan's
 * ~629 MB transient that killed Social). The rAF loop clamps dt,
 * cancels on unmount, and pauses while the page is hidden.
 *
 * Reduced motion: when `calm` (the same signal the fire band takes —
 * useReduceEffects() || fx.osReducedMotion), the canvas never mounts;
 * the static frost vignette renders alone at tier strength, so the
 * skid's depth still reads with zero motion.
 */
import { useEffect, useRef } from 'react';
import { BLIZZARD_TIERS, type BlizzardTier, type BlizzardTierParams } from '../blizzard';
import './snow.css';

interface Flake {
  /** base x (wind moves this; sway is added at draw time) */
  bx: number;
  y: number;
  r: number;
  speed: number;
  alpha: number;
  phase: number;
  swayFreq: number;
}

function makeFlakes(params: BlizzardTierParams, w: number, h: number): Flake[] {
  const flakes: Flake[] = [];
  for (let i = 0; i < params.flakes; i++) {
    const r = 0.8 + Math.random() * (params.maxRadius - 0.8);
    const depth = r / params.maxRadius; // bigger flakes read nearer: faster, brighter
    flakes.push({
      bx: Math.random() * w,
      y: Math.random() * h,
      r,
      speed: (params.fallMin + Math.random() * (params.fallMax - params.fallMin)) * (0.55 + 0.45 * depth),
      alpha: 0.35 + 0.55 * depth,
      phase: Math.random() * Math.PI * 2,
      swayFreq: 0.6 + Math.random() * 0.9,
    });
  }
  return flakes;
}

function SnowCanvas({ params }: { params: BlizzardTierParams }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w = 0;
    let h = 0;
    let flakes: Flake[] = [];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, rect.width);
      h = Math.max(1, rect.height);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!flakes.length) flakes = makeFlakes(params, w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let raf = 0;
    let last = performance.now();
    let running = true;
    const frame = (now: number) => {
      if (!running) return;
      const dt = Math.min(50, now - last) / 1000;
      last = now;
      // gusting wind: a slow swell between ~55% and full strength
      const wind = params.wind * (0.55 + 0.45 * Math.sin(now * 0.00035));
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#ffffff';
      for (const f of flakes) {
        f.y += f.speed * dt;
        f.bx += wind * dt * (0.5 + 0.5 * (f.r / params.maxRadius));
        if (f.y > h + f.r) { f.y = -f.r; f.bx = Math.random() * w; }
        if (f.bx > w + 12) f.bx -= w + 24;
        const x = f.bx + Math.sin(now * 0.001 * f.swayFreq + f.phase) * params.sway;
        ctx.globalAlpha = f.alpha;
        ctx.beginPath();
        ctx.arc(x, f.y, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      ro.disconnect();
    };
  }, [params]);

  return <canvas ref={ref} className="home-blizzard-canvas" />;
}

export default function BlizzardLayer({ tier, calm }: { tier: Exclude<BlizzardTier, 0>; calm: boolean }) {
  const params = BLIZZARD_TIERS[tier];
  return (
    <div className="home-blizzard" data-testid="home-blizzard" data-tier={tier} aria-hidden="true">
      <div className="home-blizzard-frost" style={{ opacity: params.frost }} />
      {!calm && <SnowCanvas params={params} />}
    </div>
  );
}
