/**
 * Emblem smoke (owner, 2026-10-29): "Can we animate the smoke in the
 * image of the spade on the Home Screen?"
 *
 * The Neon home emblem (styles.css `.wiz-home::before`, the
 * spade-emblem.webp painting) stays EXACTLY as it is — this layer sits
 * on top of that painting and adds only movement: a small canvas the
 * size of the emblem's own box, drifting violet/blue smoke inside the
 * spade's INNER glass outline (emblemSmoke.ts) so nothing ever crosses
 * the gold rim or escapes the silhouette. Two blend families do the
 * work: deep indigo puffs composited `multiply` (shadow rolling
 * through the clouds) under bright puffs composited `screen` (light
 * moving in the nebula). The first version was screen-only on a 120 s
 * loop and the owner "didn't see anything moving" — screen can only
 * lighten, so over the art's bright clouds it changed almost nothing.
 * This field churns on a 60 s seamless loop of wander, swirl and
 * breaths: visible within the first seconds of looking, still smoke —
 * not a screensaver.
 *
 * Round 3 (owner, later the same day): "I see some smoke in front of
 * the image (I like it) but the smoke in the image doesn't move." So
 * under the (kept) puff veil, the canvas now repaints the ARTWORK
 * ITSELF, warped: the emblem image — the same file the CSS paints, so
 * no new download in practice — is drawn in three horizontal bands,
 * each on its own slow rotation / drift / breathing scale, the bands
 * cross-dissolved where they overlap (ART_BANDS in emblemSmoke.ts).
 * The painted clouds themselves now drift and reshape at different
 * rates. The warped copy is alpha-faded before it reaches the glass
 * outline, so at the boundary the static painting shows through and
 * the gold rim stays pixel-exact; outside the glass nothing changes.
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
 * procedurally; the one image it loads is the emblem file the CSS
 * already fetched). Until that image arrives the puff veil runs
 * alone, exactly as round 2 shipped.
 */
import { useEffect, useRef, useState } from 'react';
import { useReduceEffects } from '../fx';
import { useTheme } from '../theme';
import { defaultQuality, loadSettings } from '../settings';
import { inkLowQuality } from '../ink/mode';
import {
  ART_BANDS, EMBLEM_ART_URL, EMBLEM_H, EMBLEM_W, SMOKE_DARK_TINTS, SMOKE_PUFFS, SMOKE_TINTS,
  artBandMaskAlpha, artBandPose, emblemPaintRect, emblemSmokeActive, puffPose,
  SPADE_GLASS_PATH_D, type ArtBand, type PaintRect, type SmokePuff,
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
    // A stored 'low' quality counts as a USER pick only where the
    // browser reports memory truthfully (Chrome/Android). On WebKit
    // `deviceMemory` is absent and the load-time heuristic in
    // settings.ts once answered 'low' on every iPhone (clamped core
    // counts), persisting that default — and a WebKit that later
    // reports more cores flips defaultQuality() to 'high', making the
    // stale stored 'low' indistinguishable from a deliberate pick.
    // Treating it as a pick would silently kill this layer on exactly
    // the phones it was built for, so there the pick is not evidence
    // and only inkLowQuality's positive signals (a reported memory
    // figure ≤ 2 GB) can classify the device.
    const userSetLow = nav.deviceMemory !== undefined
      && loadSettings().quality === 'low' && defaultQuality() === 'high';
    return inkLowQuality({
      deviceMemory: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      userSetLow,
    });
  } catch { return false; }
}

/**
 * Deterministic sprite bake: a cluster of soft blobs per tint,
 * edge-faded. `dense` bakes the dark (multiply) family heavier — a
 * multiply puff works by color density, so its sprite carries more
 * alpha in the core and satellites than a screen puff needs.
 */
function bakeSprite(tint: [number, number, number], dense = false): HTMLCanvasElement {
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
  const core = dense ? 0.68 : 0.34;
  const sat = dense ? 0.55 : 0.30;
  const det = dense ? 0.50 : 0.36;
  blob(S / 2, S / 2, S * (dense ? 0.30 : 0.26), core);
  for (let i = 0; i < 10; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = S * (0.06 + rnd() * 0.24);
    blob(S / 2 + Math.cos(ang) * dist, S / 2 + Math.sin(ang) * dist, S * (0.09 + rnd() * 0.11), sat);
  }
  for (let i = 0; i < 6; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = S * (0.05 + rnd() * 0.28);
    blob(S / 2 + Math.cos(ang) * dist, S / 2 + Math.sin(ang) * dist, S * (0.04 + rnd() * 0.045), det);
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

    // one sprite strip: bright bakes first, then the dense dark bakes —
    // a puff's sprite is at `tint` or `SMOKE_TINTS.length + tint`.
    const sprites = [
      ...SMOKE_TINTS.map((t) => bakeSprite(t)),
      ...SMOKE_DARK_TINTS.map((t) => bakeSprite(t, true)),
    ];
    const glassPath = new Path2D(SPADE_GLASS_PATH_D);
    const mqWide = window.matchMedia(MQ_WIDE);
    const mqLand = window.matchMedia(MQ_SHORT_LANDSCAPE);

    // The art pass (round 3): the emblem image itself, loaded from the
    // same URL the CSS painting uses. Until it arrives, artReady stays
    // false and the puff veil runs alone (round 2's exact behavior).
    const artImg = new Image();
    let artReady = false;
    artImg.onload = () => { artReady = true; };
    artImg.src = EMBLEM_ART_URL;
    if (artImg.complete && artImg.naturalWidth > 0) artReady = true;
    // Offscreen buffers for the warp, sized to the painting at
    // ART_RES of device resolution — nebula art is soft, the slight
    // upscale on composite is invisible, and the per-frame cost stays
    // in the puff field's class. Masks are baked per layout: one
    // gradient-alpha mask per band (derived from artBandMaskAlpha, so
    // the component and the pinned math can never drift apart) and a
    // quarter-scale glass mask whose upscale IS the feather.
    const ART_RES = 0.75;
    const bandCanvas = document.createElement('canvas');
    const artCanvas = document.createElement('canvas');
    const bandCtx = bandCanvas.getContext('2d');
    const artCtx = artCanvas.getContext('2d');
    let bandMasks: HTMLCanvasElement[] = [];
    let glassMask: HTMLCanvasElement | null = null;
    const bakeBandMask = (band: ArtBand, w: number, h: number): HTMLCanvasElement => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d')!;
      g.setTransform(w / EMBLEM_W, 0, 0, h / EMBLEM_H, 0, 0);
      const grad = g.createLinearGradient(0, 0, 0, EMBLEM_H);
      const stops = new Set<number>([0, EMBLEM_H]);
      for (const y of [band.yTop, band.yTop + band.fadeIn, band.yBottom - band.fadeOut, band.yBottom]) {
        if (y > 0 && y < EMBLEM_H) stops.add(y);
      }
      for (const y of [...stops].sort((a, b) => a - b)) {
        grad.addColorStop(y / EMBLEM_H, `rgba(255,255,255,${artBandMaskAlpha(band, y)})`);
      }
      g.fillStyle = grad;
      g.fillRect(0, 0, EMBLEM_W, EMBLEM_H);
      return c;
    };
    const bakeGlassMask = (w: number, h: number): HTMLCanvasElement => {
      const qw = Math.max(2, Math.round(w / 4));
      const qh = Math.max(2, Math.round(h / 4));
      const c = document.createElement('canvas');
      c.width = qw; c.height = qh;
      const g = c.getContext('2d')!;
      g.setTransform(qw / EMBLEM_W, 0, 0, qh / EMBLEM_H, 0, 0);
      // drawn at 96% about the glass center: the warped copy reaches
      // full strength only inside the glass and feathers out across
      // the boundary (the upscale smooths the edge), where the static
      // CSS painting takes over — rim pixel-exact, no seam.
      g.translate(345, 339);
      g.scale(0.96, 0.96);
      g.translate(-345, -339);
      g.fillStyle = '#fff';
      g.fill(glassPath);
      return c;
    };

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
      if (bandCtx && artCtx && rect.w > 0 && rect.h > 0) {
        const aw = Math.max(2, Math.round(rect.w * dpr * ART_RES));
        const ah = Math.max(2, Math.round(rect.h * dpr * ART_RES));
        bandCanvas.width = aw; bandCanvas.height = ah;
        artCanvas.width = aw; artCanvas.height = ah;
        bandMasks = ART_BANDS.map((b) => bakeBandMask(b, aw, ah));
        glassMask = bakeGlassMask(aw, ah);
      }
    };
    layout();

    const probe: Probe = { draws: 0, lastMs: 0, maxMs: 0 };
    (window as unknown as { __emblemSmoke?: Probe }).__emblemSmoke = probe;

    /**
     * Repaint the artwork, warped, into artCanvas: each band drawn
     * from the emblem image under its own pose, alpha-masked to its
     * window, composited over the previous bands; the stack is then
     * faded by the soft glass mask so it never reaches the rim.
     */
    const drawArt = (t: number) => {
      if (!artReady || !bandCtx || !artCtx || !glassMask || bandMasks.length !== ART_BANDS.length) return;
      const aw = artCanvas.width;
      const ah = artCanvas.height;
      artCtx.setTransform(1, 0, 0, 1, 0, 0);
      artCtx.globalCompositeOperation = 'source-over';
      artCtx.globalAlpha = 1;
      artCtx.clearRect(0, 0, aw, ah);
      ART_BANDS.forEach((band, i) => {
        const pose = artBandPose(band, t);
        bandCtx.setTransform(1, 0, 0, 1, 0, 0);
        bandCtx.globalCompositeOperation = 'source-over';
        bandCtx.globalAlpha = 1;
        bandCtx.clearRect(0, 0, aw, ah);
        bandCtx.setTransform(aw / EMBLEM_W, 0, 0, ah / EMBLEM_H, 0, 0);
        bandCtx.translate(band.cx + pose.dx, band.cy + pose.dy);
        bandCtx.rotate(pose.rot);
        bandCtx.scale(pose.scale, pose.scale);
        bandCtx.translate(-band.cx, -band.cy);
        bandCtx.drawImage(artImg, 0, 0);
        bandCtx.setTransform(1, 0, 0, 1, 0, 0);
        bandCtx.globalCompositeOperation = 'destination-in';
        bandCtx.drawImage(bandMasks[i]!, 0, 0);
        artCtx.drawImage(bandCanvas, 0, 0);
      });
      artCtx.globalCompositeOperation = 'destination-in';
      artCtx.imageSmoothingEnabled = true;
      artCtx.drawImage(glassMask, 0, 0, aw, ah);
      artCtx.globalCompositeOperation = 'source-over';
    };

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
        // the art pass first (round 3): the painting itself, warped,
        // under everything else in the clip. Capture-rig only:
        // __emblemSmokeDebug = 'artonly' skips the puff passes so the
        // art's own motion can be verified with the veil covered.
        const debugMode = (window as unknown as { __emblemSmokeDebug?: string }).__emblemSmokeDebug;
        if (artReady) {
          drawArt(t);
          ctx!.translate(rect.x, rect.y);
          ctx!.drawImage(artCanvas, 0, 0, rect.w, rect.h);
          ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        // two passes inside the same clip: the dark family first
        // (multiply — shadow rolling through the painted clouds), the
        // bright family over it (screen — light in the nebula).
        const drawPuff = (p: SmokePuff) => {
          const pose = puffPose(p, t);
          const cx = rect.x + pose.x * rect.w;
          const cy = rect.y + pose.y * rect.h;
          const rr = pose.r * rect.w;
          ctx!.save();
          ctx!.translate(cx, cy);
          ctx!.rotate(pose.rot);
          ctx!.globalAlpha = pose.alpha;
          const sprite = sprites[p.dark ? SMOKE_TINTS.length + p.tint : p.tint]!;
          ctx!.drawImage(sprite, -rr, -rr, rr * 2, rr * 2);
          ctx!.restore();
        };
        if (debugMode !== 'artonly') {
          ctx!.globalCompositeOperation = 'multiply';
          for (const p of SMOKE_PUFFS) if (p.dark) drawPuff(p);
          ctx!.globalCompositeOperation = 'screen';
          for (const p of SMOKE_PUFFS) if (!p.dark) drawPuff(p);
          ctx!.globalAlpha = 1;
          ctx!.globalCompositeOperation = 'source-over';
        }
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
      artImg.onload = null;
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
