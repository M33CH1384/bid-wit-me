/**
 * The spray-paint transition layer (owner, 2026-10-23) — the visual half of
 * spray.ts. Mounted once in Root beside InkLayer / SocialRoot. It renders
 * nothing while idle; during a spray it is a single fixed <canvas>:
 *
 *  - COVER (~320 ms, two beats — the owner asked for motion with a shape to
 *    it, not a linear wipe): first the can TAGS A SPADE at center screen —
 *    a speckle brush stamps its way around the spade's outline while the
 *    interior fills in behind it in stroke bands, the whole mark wreathed
 *    in overspray — then the paint FILLS OUT from the painted spade, a
 *    black bloom with a speckled front spreading until the corners are
 *    covered. The spade geometry is the game's own mark, decoded from
 *    public/favicon.svg. Everything is pre-rendered sprites + brush stamps
 *    (a bounded number of drawImage calls per frame, textures built once
 *    per spray) — no DOM churn, no per-frame layout.
 *  - REVEAL: the full black is erased through a pre-rendered grain mask
 *    (destination-out), so the paint speckles and dissolves off the new
 *    screen instead of sliding away, with a short opacity tail so no
 *    residue pops at the end.
 *
 * The cover is a pure function of position along the cover timeline, so a
 * dissolve snapped back into a cover (spray.ts's fromCoverage) resumes the
 * program mid-beat with no state to reconcile.
 *
 * The layer intercepts touches only while covering (the controller's input
 * lock); during the dissolve touches pass straight through to the new
 * screen. If canvas 2D is unavailable the layer paints nothing and the
 * controller's timers still remove it on schedule — it can never become a
 * stuck black screen.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  SPRAY_COVER_MS,
  SPRAY_REVEAL_MS,
  SPRAY_SPADE_MS,
  getSpraySnapshot,
  registerSprayRenderer,
  subscribeSpray,
} from './spray';
import './spray.css';

const PAINT = '#070708';
const INKS = ['#060607', '#0a0a0c', '#101014', '#050505'] as const;
const TAU = Math.PI * 2;

/** Deterministic RNG so the spray texture is the same can, every time. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Precomputed jitter, indexed by stamp number: the paint pattern is stable
 *  frame to frame (no shimmering), varied stamp to stamp. */
const JITTER: readonly number[] = (() => {
  const rnd = mulberry32(0x71aa);
  return Array.from({ length: 512 }, () => rnd());
})();
const jit = (i: number, salt: number): number => JITTER[(i * 7 + salt * 131) & 511]!;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

/* ------------------------------------------------------------------ */
/* The spade. Geometry decoded from public/favicon.svg — the game's    */
/* own mark (viewBox 0 0 64 64, spade spans x 12..52, y 8..56). Each    */
/* segment is [c1x, c1y, c2x, c2y, x, y] in favicon units, starting     */
/* where the previous one ended; the path opens at the tip (32, 8).    */
/* The base line is written as a degenerate cubic so one sampler       */
/* walks the whole outline. Keep in sync if the mark ever changes.     */
/* ------------------------------------------------------------------ */
const SPADE_START: { x: number; y: number } = { x: 32, y: 8 };
const SPADE_SEGS: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  [26, 18, 12, 26, 12, 37], // tip -> left lobe, outer
  [12, 44, 17, 48, 23, 48], // left lobe, bottom
  [26.5, 48, 29.2, 46.6, 30.4, 44.8], // in toward the stem
  [30, 50, 27.5, 54, 22, 56], // stem, left side
  [28.7, 56, 35.3, 56, 42, 56], // base (straight in the source path)
  [36.5, 54, 34, 50, 33.6, 44.8], // stem, right side
  [34.8, 46.6, 37.5, 48, 41, 48], // out to the right lobe
  [47, 48, 52, 44, 52, 37], // right lobe, bottom
  [52, 26, 38, 18, 32, 8], // right lobe, outer -> tip
];
const SPADE_W_UNITS = 40; // 52 - 12
const SPADE_H_UNITS = 48; // 56 - 8

export interface SpadeOutline {
  /** Sampled outline points in favicon units, tip first, closed. */
  pts: Array<{ x: number; y: number; cum: number }>;
  /** Total outline length in favicon units. */
  length: number;
}

/** Sample the spade outline at fine steps with cumulative arc length
 *  (normalized 0..1 in `cum`). Pure math over the segment table — exported
 *  so the choreography's geometry is pinned by tests, not by eyeballing. */
export function buildSpadeOutline(subdiv = 42): SpadeOutline {
  const raw: Array<{ x: number; y: number }> = [{ ...SPADE_START }];
  let pen = { ...SPADE_START };
  for (const [c1x, c1y, c2x, c2y, x, y] of SPADE_SEGS) {
    for (let i = 1; i <= subdiv; i++) {
      const t = i / subdiv;
      const u = 1 - t;
      raw.push({
        x: u * u * u * pen.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x,
        y: u * u * u * pen.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y,
      });
    }
    pen = { x, y };
  }
  let length = 0;
  const pts = raw.map((p, i) => {
    if (i > 0) {
      const q = raw[i - 1]!;
      length += Math.hypot(p.x - q.x, p.y - q.y);
    }
    return { ...p, cum: length };
  });
  for (const p of pts) p.cum = length > 0 ? p.cum / length : 0;
  return { pts, length };
}

export const SPADE_OUTLINE: SpadeOutline = buildSpadeOutline();

/** Trace the spade silhouette onto a 2D context whose transform maps
 *  favicon units to the target space. */
function traceSpade(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(SPADE_START.x, SPADE_START.y);
  for (const [c1x, c1y, c2x, c2y, x, y] of SPADE_SEGS) g.bezierCurveTo(c1x, c1y, c2x, c2y, x, y);
  g.closePath();
}

/* ------------------------------------------------------------------ */
/* Sprites — built once per spray (per viewport size), never per frame */
/* ------------------------------------------------------------------ */

let brushSprite: HTMLCanvasElement | null = null;
/** One dab of the can: an opaque core dissolving into speckle. Stamped
 *  along the spade's outline, around the fill front, wherever paint lands. */
function getBrushSprite(): HTMLCanvasElement | null {
  if (brushSprite) return brushSprite;
  try {
    const S = 160;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    if (!g) return null;
    const cx = S / 2;
    const core = S * 0.3;
    const grad = g.createRadialGradient(cx, cx, core * 0.25, cx, cx, core);
    grad.addColorStop(0, 'rgba(7,7,8,0.98)');
    grad.addColorStop(0.75, 'rgba(7,7,8,0.92)');
    grad.addColorStop(1, 'rgba(7,7,8,0.55)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cx, core, 0, TAU);
    g.fill();
    // Speckle skirt: dots thinning out past the core, a few escaping it.
    const rnd = mulberry32(0xb007);
    for (let i = 0; i < 420; i++) {
      const a = rnd() * TAU;
      const rr = core * (0.55 + Math.pow(rnd(), 1.5) * 0.95);
      const r = 0.5 + rnd() * (rr > core ? 1.1 : 2.0);
      g.globalAlpha = Math.max(0.06, 0.85 - (rr / (core * 1.5)) * 0.8) * (0.4 + rnd() * 0.6);
      g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
      g.beginPath();
      g.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, r, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    brushSprite = c;
    return c;
  } catch {
    return null;
  }
}

interface SpadeSprites {
  key: string;
  /** Silhouette fill + interior grain (transparent outside the mark). */
  fill: HTMLCanvasElement;
  /** Overspray cloud only (transparent inside the mark). */
  halo: HTMLCanvasElement;
  /** Draw position of the sprite canvases (CSS px). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The spade bbox inside the sprite (CSS px from the sprite's origin). */
  pad: number;
  spadeH: number;
}
let spadeSprites: SpadeSprites | null = null;

/** The painted spade as two stacked sprites, so the cover can reveal the
 *  fill in stroke bands while the overspray halo is already present. */
function getSpadeSprites(geo: SpadeGeo, dpr: number): SpadeSprites | null {
  const key = `${Math.round(geo.w)}x${Math.round(geo.h)}@${dpr}`;
  if (spadeSprites?.key === key) return spadeSprites;
  try {
    const pad = geo.brush * 0.95;
    const w = geo.w + pad * 2;
    const h = geo.h + pad * 2;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = Math.max(2, Math.round(w * dpr));
      c.height = Math.max(2, Math.round(h * dpr));
      return c;
    };
    const fill = mk();
    const halo = mk();
    const fg = fill.getContext('2d');
    const hg = halo.getContext('2d');
    if (!fg || !hg) return null;
    // Sprite space: favicon units, origin at the spade bbox's top-left,
    // padded by `pad` on every side.
    const place = (g: CanvasRenderingContext2D) => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.translate(pad, pad);
      g.scale(geo.k, geo.k);
      g.translate(-12, -8);
    };

    // --- halo: classify speckle inside/outside the silhouette, keep the
    // outside dots; plus a faint bloom of the mark itself.
    place(hg);
    traceSpade(hg);
    const rndH = mulberry32(0xaa10);
    const outside: Array<{ x: number; y: number; r: number; a: number }> = [];
    for (let i = 0; i < 900 && outside.length < 210; i++) {
      const x = 12 - 6 + rndH() * (SPADE_W_UNITS + 12);
      const y = 8 - 6 + rndH() * (SPADE_H_UNITS + 12);
      if (!hg.isPointInPath(x, y)) {
        outside.push({ x, y, r: 0.4 + rndH() * 1.7, a: 0.08 + rndH() * 0.22 });
      }
    }
    hg.save();
    hg.translate(32, 32);
    hg.scale(1.07, 1.07);
    hg.translate(-32, -32);
    traceSpade(hg);
    hg.globalAlpha = 0.1;
    hg.fillStyle = PAINT;
    hg.fill();
    hg.restore(); // back to the place() transform saved above
    for (const d of outside) {
      hg.globalAlpha = d.a;
      hg.fillStyle = INKS[(rndH() * INKS.length) | 0]!;
      hg.beginPath();
      hg.arc(d.x, d.y, d.r, 0, TAU);
      hg.fill();
    }
    hg.globalAlpha = 1;

    // --- fill: the silhouette in paint, grained, with faint horizontal
    // stroke banding so the banded reveal reads as passes of the can.
    place(fg);
    traceSpade(fg);
    fg.fillStyle = PAINT;
    fg.fill();
    fg.clip();
    const rndF = mulberry32(0xf111);
    for (let i = 0; i < 620; i++) {
      const x = 12 + rndF() * SPADE_W_UNITS;
      const y = 8 + rndF() * SPADE_H_UNITS;
      fg.globalAlpha = 0.05 + rndF() * 0.17;
      fg.fillStyle = INKS[(rndF() * INKS.length) | 0]!;
      fg.beginPath();
      fg.arc(x, y, 0.4 + rndF() * 1.5, 0, TAU);
      fg.fill();
    }
    for (let y = 9.5; y < 56; y += 2.3) {
      for (let i = 0; i < 30; i++) {
        const x = 12 + rndF() * SPADE_W_UNITS;
        fg.globalAlpha = 0.04 + rndF() * 0.1;
        fg.fillStyle = INKS[(rndF() * INKS.length) | 0]!;
        fg.beginPath();
        fg.arc(x, y + (rndF() - 0.5) * 1.1, 0.35 + rndF() * 0.9, 0, TAU);
        fg.fill();
      }
    }
    fg.globalAlpha = 1;

    spadeSprites = {
      key,
      fill,
      halo,
      x: geo.left - pad,
      y: geo.top - pad,
      w,
      h,
      pad,
      spadeH: geo.h,
    };
    return spadeSprites;
  } catch {
    return null;
  }
}

let grainCache: { key: string; canvas: HTMLCanvasElement } | null = null;
/** Full-viewport grain alpha mask for the dissolve: uneven dot alphas make
 *  some specks linger while others clear early — a real dry-paint dissolve. */
function getGrain(w: number, h: number): HTMLCanvasElement | null {
  const key = `${w}x${h}`;
  if (grainCache?.key === key) return grainCache.canvas;
  try {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(w));
    c.height = Math.max(2, Math.round(h));
    const g = c.getContext('2d');
    if (!g) return null;
    const rnd = mulberry32(0x9a17);
    const dots = Math.round((w * h) / 480);
    for (let i = 0; i < dots; i++) {
      const r = 1 + rnd() * 3.6;
      g.globalAlpha = 0.2 + rnd() * 0.8;
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, r, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    grainCache = { key, canvas: c };
    return c;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Cover program — tag the spade, then fill out from it                */
/* ------------------------------------------------------------------ */

interface SpadeGeo {
  cx: number;
  cy: number;
  /** CSS px per favicon unit. */
  k: number;
  left: number;
  top: number;
  w: number;
  h: number;
  brush: number;
  /** Outline points in screen px with cumulative length in px. */
  pts: Array<{ x: number; y: number; cum: number }>;
  outlineLen: number;
}

function spadeGeometry(vw: number, vh: number): SpadeGeo {
  // Bold and centered: ~46% of the screen's height, capped so it never
  // crowds a short or narrow viewport.
  const h = Math.min(vh * 0.46, (vw * 0.8 * SPADE_H_UNITS) / SPADE_W_UNITS);
  const w = (h * SPADE_W_UNITS) / SPADE_H_UNITS;
  const k = h / SPADE_H_UNITS;
  const cx = vw / 2;
  const cy = vh / 2;
  const outlineLen = SPADE_OUTLINE.length * k;
  const pts = SPADE_OUTLINE.pts.map((p) => ({
    x: cx + (p.x - 32) * k,
    y: cy + (p.y - 32) * k,
    cum: p.cum * outlineLen,
  }));
  return {
    cx,
    cy,
    k,
    left: cx - w / 2,
    top: cy - h / 2,
    w,
    h,
    brush: Math.min(46, Math.max(15, h * 0.088)),
    pts,
    outlineLen,
  };
}

/** Milliseconds along the cover timeline for this frame. fromCoverage is
 *  the coverage the controller credited when a dissolve snapped back into
 *  a cover; on this program position == coverage fraction of the timeline,
 *  so the resume point is a plain offset and the beats stay in order. */
function coverPosition(snap: { phaseAt: number; fromCoverage: number }): number {
  const start = snap.fromCoverage * SPRAY_COVER_MS;
  return Math.min(SPRAY_COVER_MS, Math.max(0, start + (performance.now() - snap.phaseAt)));
}

/** Beat 1: the spade is tagged. The brush stamps its way around the
 *  outline (leading stamp = the nozzle), the overspray halo gathers as
 *  the trace progresses, and the interior fills behind the trace in
 *  stroke bands. s is the beat's progress 0..1. */
function drawSpadeTag(
  g: CanvasRenderingContext2D,
  geo: SpadeGeo,
  s: number,
  dpr: number,
): void {
  const OUTLINE_END = 0.78; // trace completes at 78% of the beat
  const FILL_START = 0.22; // interior strokes start once the trace is moving
  const outlineP = easeOutCubic(clamp01(s / OUTLINE_END));
  const fillP = clamp01((s - FILL_START) / (1 - FILL_START));

  const sp = getSpadeSprites(geo, dpr);
  if (sp) {
    g.globalAlpha = Math.min(0.92, outlineP * 1.25);
    g.drawImage(sp.halo, sp.x, sp.y, sp.w, sp.h);
    if (fillP > 0) {
      // Reveal the fill sprite in a horizontal band (stroke passes): crop
      // the source to the spade's own height inside the sprite.
      const srcPad = (sp.pad / sp.h) * sp.fill.height;
      const srcSpadeH = (sp.spadeH / sp.h) * sp.fill.height;
      const srcH = srcSpadeH * easeOutCubic(fillP);
      if (srcH > 0.5) {
        g.globalAlpha = 1;
        g.drawImage(
          sp.fill,
          0,
          srcPad,
          sp.fill.width,
          srcH,
          sp.x,
          sp.y + sp.pad,
          sp.w,
          sp.spadeH * easeOutCubic(fillP),
        );
      }
    }
    g.globalAlpha = 1;
  }

  const brush = getBrushSprite();
  if (!brush) return;
  const target = outlineP * geo.outlineLen;
  const spacing = geo.brush * 0.42;
  let lastX = Number.NEGATIVE_INFINITY;
  let lastY = 0;
  let stamp = 0;
  const dab = (x: number, y: number, scale: number, alpha: number) => {
    const size = geo.brush * scale;
    g.globalAlpha = alpha;
    g.drawImage(brush, x - size / 2, y - size / 2, size, size);
  };
  for (const p of geo.pts) {
    if (p.cum > target) {
      // The nozzle: one dab right at the frontier of the trace.
      if (stamp > 0 && p.cum - target < spacing) {
        dab(p.x, p.y, 1.18, 1);
      }
      break;
    }
    if (stamp === 0 || Math.hypot(p.x - lastX, p.y - lastY) >= spacing) {
      dab(p.x, p.y, 0.86 + jit(stamp, 1) * 0.34, 0.8 + jit(stamp, 2) * 0.2);
      lastX = p.x;
      lastY = p.y;
      stamp++;
    }
  }
  g.globalAlpha = 1;
}

/** Beat 2: the paint fills out from the spade — a black bloom whose front
 *  is a ring of overspray speckle, spreading until it swallows the screen.
 *  u is the beat's eased progress 0..1; at 1 the screen is flat black. */
function drawFillBloom(
  g: CanvasRenderingContext2D,
  vw: number,
  vh: number,
  geo: SpadeGeo,
  u: number,
): void {
  if (u >= 1) {
    g.fillStyle = PAINT;
    g.fillRect(0, 0, vw, vh);
    return;
  }
  const r0 = geo.h * 0.3;
  const maxR =
    Math.hypot(Math.max(geo.cx, vw - geo.cx), Math.max(geo.cy, vh - geo.cy)) + geo.brush * 1.6;
  const r = r0 + (maxR - r0) * u;
  g.globalAlpha = 1;
  g.fillStyle = PAINT;
  g.beginPath();
  g.arc(geo.cx, geo.cy, r, 0, TAU);
  g.fill();
  const brush = getBrushSprite();
  if (!brush) return;
  const count = Math.min(150, Math.max(24, Math.floor((TAU * r) / (geo.brush * 0.55))));
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + jit(i, 3) * 0.06;
    const rr = r + (jit(i, 4) - 0.3) * geo.brush * 1.9;
    const size = geo.brush * (0.65 + jit(i, 5) * 0.6);
    g.globalAlpha = 0.3 + jit(i, 6) * 0.55;
    g.drawImage(brush, geo.cx + Math.cos(a) * rr - size / 2, geo.cy + Math.sin(a) * rr - size / 2, size, size);
  }
  g.globalAlpha = 1;
}

function drawCover(
  g: CanvasRenderingContext2D,
  vw: number,
  vh: number,
  snap: { phaseAt: number; fromCoverage: number },
  dpr: number,
): void {
  const pos = coverPosition(snap);
  g.clearRect(0, 0, vw, vh);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const geo = spadeGeometry(vw, vh);
  if (pos < SPRAY_SPADE_MS) {
    drawSpadeTag(g, geo, pos / SPRAY_SPADE_MS, dpr);
  } else {
    drawSpadeTag(g, geo, 1, dpr);
    drawFillBloom(g, vw, vh, geo, easeOutCubic((pos - SPRAY_SPADE_MS) / (SPRAY_COVER_MS - SPRAY_SPADE_MS)));
  }
}

function drawReveal(g: CanvasRenderingContext2D, vw: number, vh: number, phaseAt: number, canvas: HTMLCanvasElement): void {
  const q = clamp01((performance.now() - phaseAt) / SPRAY_REVEAL_MS);
  g.clearRect(0, 0, vw, vh);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.fillStyle = PAINT;
  g.fillRect(0, 0, vw, vh);
  const grain = getGrain(vw, vh);
  if (grain) {
    g.globalCompositeOperation = 'destination-out';
    g.globalAlpha = Math.min(1, q * 1.3);
    g.drawImage(grain, 0, 0, vw, vh);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  }
  // Final fade so any lingering speckle residue never pops off.
  canvas.style.opacity = q > 0.72 ? String(1 - ((q - 0.72) / 0.28) * 0.92) : '1';
}

export default function SprayLayer() {
  const snap = useSyncExternalStore(subscribeSpray, getSpraySnapshot);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    registerSprayRenderer(true);
    return () => registerSprayRenderer(false);
  }, []);

  const sprayId = snap.sprayId;
  const active = snap.phase !== 'idle';
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.style.opacity = '1';
    let raf = 0;
    const frame = () => {
      const s = getSpraySnapshot();
      if (s.phase === 'idle') {
        g.clearRect(0, 0, vw, vh);
        return;
      }
      if (s.phase === 'cover') drawCover(g, vw, vh, s, dpr);
      else drawReveal(g, vw, vh, s.phaseAt, canvas);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [sprayId, active]);

  if (!active) return null;
  return (
    <div
      className="spray-layer"
      data-testid="spray-layer"
      data-phase={snap.phase}
      aria-hidden="true"
      style={{ pointerEvents: snap.phase === 'cover' ? 'auto' : 'none' }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
