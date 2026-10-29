/**
 * Emblem smoke (owner, 2026-10-29): "Can we animate the smoke in the
 * image of the spade on the Home Screen?"
 *
 * The Neon home emblem (styles.css `.wiz-home::before`, the
 * spade-emblem.webp painting) stays EXACTLY as it is — this layer sits
 * on top of that painting and adds only movement: a small canvas the
 * size of the emblem's own box, drawing slow violet/blue smoke wisps
 * with `screen` blending, clipped to the spade's INNER glass outline
 * (emblemSmoke.ts) so nothing ever crosses the gold rim or escapes the
 * silhouette. The painted smoke in the art is the body of the effect;
 * this layer is light moving inside it. Slow on purpose: a 120 s
 * seamless loop of drifts and breaths — embers in glass, not a
 * screensaver.
 *
 * Gates (any one off → no canvas at all, the emblem is byte-for-byte
 * today's static painting):
 *  - Neon only (the emblem exists only in Neon; Classic never had it).
 *  - OS `prefers-reduced-motion` or the app's Reduce effects switch.
 *  - Low-end devices, classified the ink layer's way (inkLowQuality —
 *    positive evidence only, never the iOS-poisoned heuristic).
 * The wrapper div renders in BOTH themes (identical home DOM — theme
 * parity); CSS keeps it display:none outside Neon.
 *
 * Discipline (Streak Fire home rules): DPR ≤ 1.5, ~30 fps throttle,
 * the loop pauses while the document is hidden or the layer is off
 * screen, and unmount stops everything. The static painting is CSS —
 * it is on screen before this engine ever runs; the engine starts
 * after mount and pays for nothing up front (sprites are baked
 * procedurally, no downloads, no image loads).
 */
import { useEffect, useRef, useState } from 'react';
import { useReduceEffects } from '../fx';
import { useTheme } from '../theme';
import { defaultQuality, loadSettings } from '../settings';
import { inkLowQuality } from '../ink/mode';
import {
  EMBLEM_H, EMBLEM_W, SMOKE_PUFFS, SMOKE_TINTS, emblemPaintRect, emblemSmokeActive, puffPose,
  SPADE_GLASS_PATH_D, type PaintRect,
} from './emblemSmoke';

const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;
const MQ_WIDE = '(min-width: 700px)';
const MQ_SHORT_LANDSCAPE = '(orientation: landscape) and (max-height: 520px)';

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

function lowEndDevice(): boolean {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    return inkLowQuality({
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      userSetLow: loadSettings().quality === 'low' && defaultQuality() === 'high',
    });
  } catch { return false; }
}

/** Deterministic sprite bake: a cluster of soft blobs per tint, edge-faded. */
function bakeSprite(tint: [number, number, number]): HTMLCanvasElement {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const ctx = c.getContext('2d')!;
  // small LCG — the same puffs on every load, no Math.random in art
  let seed = tint[0] * 31 + tint[1] * 17 + tint[2];
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const blob = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${tint[0]},${tint[1]},${tint[2]},${a})`);
    g.addColorStop(0.55, `rgba(${tint[0]},${tint[1]},${tint[2]},${a * 0.45})`);
    g.addColorStop(1, `rgba(${tint[0]},${tint[1]},${tint[2]},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  // Structure over wash: a modest core, more satellites, and a detail
  // pass of small blobs — a drifting sprite should read as smoke with
  // internal shape, not as a brightening fog ball (first solo capture).
  blob(S / 2, S / 2, S * 0.26, 0.34);
  for (let i = 0; i < 10; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = S * (0.06 + rnd() * 0.24);
    blob(S / 2 + Math.cos(ang) * dist, S / 2 + Math.sin(ang) * dist, S * (0.09 + rnd() * 0.11), 0.30);
  }
  for (let i = 0; i < 6; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = S * (0.05 + rnd() * 0.28);
    blob(S / 2 + Math.cos(ang) * dist, S / 2 + Math.sin(ang) * dist, S * (0.04 + rnd() * 0.045), 0.36);
  }
  // guarantee a soft sprite boundary whatever the blobs did
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  mask.addColorStop(0, 'rgba(0,0,0,1)');
  mask.addColorStop(0.7, 'rgba(0,0,0,0.85)');
  mask.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
  return c;
}

interface Probe { draws: number; lastMs: number; maxMs: number }

export default function EmblemSmoke() {
  const theme = useTheme();
  const reduceFx = useReduceEffects();
  const osReduced = useOsReducedMotion();
  const [lowEnd] = useState(lowEndDevice);
  const active = emblemSmokeActive({ theme, reducedMotion: osReduced, reduceEffects: reduceFx, lowEnd });
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
    if (!ctx || typeof Path2D === 'undefined') return;

    const sprites = SMOKE_TINTS.map(bakeSprite);
    const glassPath = new Path2D(SPADE_GLASS_PATH_D);
    const mqWide = window.matchMedia(MQ_WIDE);
    const mqLand = window.matchMedia(MQ_SHORT_LANDSCAPE);

    let rect: PaintRect = { x: 0, y: 0, w: 0, h: 0 };
    let boxW = 0;
    let boxH = 0;
    let dpr = 1;
    const layout = () => {
      boxW = host.clientWidth;
      boxH = host.clientHeight;
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(boxW * dpr));
      canvas.height = Math.max(1, Math.round(boxH * dpr));
      rect = emblemPaintRect({ boxW, boxH, wide: mqWide.matches, shortLandscape: mqLand.matches });
    };
    layout();

    const probe: Probe = { draws: 0, lastMs: 0, maxMs: 0 };
    (window as unknown as { __emblemSmoke?: Probe }).__emblemSmoke = probe;

    const draw = (t: number) => {
      const started = performance.now();
      ctx!.setTransform(1, 0, 0, 1, 0, 0);
      ctx!.clearRect(0, 0, canvas.width, canvas.height);
      if (rect.w > 0 && rect.h > 0) {
        ctx!.save();
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx!.translate(rect.x, rect.y);
        ctx!.scale(rect.w / EMBLEM_W, rect.h / EMBLEM_H);
        ctx!.clip(glassPath);
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx!.globalCompositeOperation = 'screen';
        for (const p of SMOKE_PUFFS) {
          const pose = puffPose(p, t);
          const cx = rect.x + pose.x * rect.w;
          const cy = rect.y + pose.y * rect.h;
          const rr = pose.r * rect.w;
          ctx!.save();
          ctx!.translate(cx, cy);
          ctx!.rotate(pose.rot);
          ctx!.globalAlpha = pose.alpha;
          ctx!.drawImage(sprites[p.tint]!, -rr, -rr, rr * 2, rr * 2);
          ctx!.restore();
        }
        ctx!.globalAlpha = 1;
        ctx!.globalCompositeOperation = 'source-over';
        ctx!.restore();
        // capture-rig only: __emblemSmokeDebug = 'fill' paints the clip
        // solid so the path fit against the artwork can be eyeballed.
        if ((window as unknown as { __emblemSmokeDebug?: string }).__emblemSmokeDebug === 'fill') {
          ctx!.save();
          ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx!.translate(rect.x, rect.y);
          ctx!.scale(rect.w / EMBLEM_W, rect.h / EMBLEM_H);
          ctx!.fillStyle = 'rgba(255,0,255,0.55)';
          ctx!.fill(glassPath);
          ctx!.restore();
        }
      }
      probe.draws += 1;
      probe.lastMs = performance.now() - started;
      probe.maxMs = Math.max(probe.maxMs, probe.lastMs);
    };

    let raf = 0;
    let running = false;
    let visible = true;
    let tAcc = 0;
    let lastNow = 0;
    let lastDrawn = -1;
    const tick = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.25, (now - lastNow) / 1000);
      lastNow = now;
      tAcc += dt;
      if ((tAcc - lastDrawn) * 1000 >= FRAME_MS || lastDrawn < 0) {
        lastDrawn = tAcc;
        draw(tAcc);
      }
    };
    const start = () => {
      if (running) return;
      running = true;
      lastNow = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const sync = () => { if (visible && !document.hidden) start(); else stop(); };
    const onVis = () => sync();
    document.addEventListener('visibilitychange', onVis);
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); sync(); }, { threshold: 0.01 });
      io.observe(host);
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => layout()) : null;
    ro?.observe(host);
    mqWide.addEventListener?.('change', layout);
    mqLand.addEventListener?.('change', layout);
    sync();

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVis);
      io?.disconnect();
      ro?.disconnect();
      mqWide.removeEventListener?.('change', layout);
      mqLand.removeEventListener?.('change', layout);
      delete (window as unknown as { __emblemSmoke?: Probe }).__emblemSmoke;
    };
  }, [active]);

  return (
    <div ref={hostRef} className="emblem-smoke" aria-hidden="true">
      {active && <canvas ref={canvasRef} className="emblem-smoke-canvas" />}
    </div>
  );
}
