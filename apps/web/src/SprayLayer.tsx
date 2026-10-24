/**
 * The spray-paint transition layer (owner, 2026-10-23) — the visual half of
 * spray.ts. Mounted once in Root beside InkLayer / SocialRoot. It renders
 * nothing while idle; during a spray it is a single fixed <canvas>:
 *
 *  - COVER (~570 ms, THREE strict beats — owner, 2026-10-23: the spade
 *    must be sprayed as an outline first, "then fill in the rest"; v2's
 *    overlapped tag read as a progress fill, and its stamp steps read
 *    as stepping):
 *      1. OUTLINE (~330 ms): the can travels the spade's COMPLETE
 *         contour. The finished sprayed outline is pre-rendered once as
 *         a sprite and revealed through a moving mask stroked along the
 *         path, so the line is perfectly continuous — no stamp stepping —
 *         while a live nozzle dab + overspray puff ride the frontier.
 *         Interior still empty; the overspray halo gathers around.
 *      2. INTERIOR (~105 ms): the fill sprays in behind a SOFT moving
 *         front (a gradient-masked sprite, no band edges snapping in).
 *      3. BLOOM (~135 ms): the paint fills out from the finished spade,
 *         a black bloom with a speckled front spreading until the
 *         corners are covered and the swap lands.
 *    The spade geometry is the game's own mark, decoded from
 *    public/favicon.svg. Everything is pre-rendered sprites + bounded
 *    per-frame compositing (textures built once per spray) — no DOM
 *    churn, no per-frame layout.
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
  SPRAY_FILL_MS,
  SPRAY_OUTLINE_MS,
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
/** Gentle at both ends: the can eases into the trace and settles as it
 *  closes the tip, and the interior front starts/stops softly. */
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

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
  /** The sprayed outline, finished: a grained stroke along the contour
   *  with a speckle-ragged edge (transparent inside the mark). Revealed
   *  progressively through a moving mask during the outline beat, so the
   *  traced line is continuous by construction. */
  outline: HTMLCanvasElement;
  /** Overspray cloud only (transparent inside the mark). */
  halo: HTMLCanvasElement;
  /** Same-size scratch canvas for the per-frame mask composites. */
  scratch: HTMLCanvasElement;
  dpr: number;
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

/** The painted spade as stacked sprites — finished outline, interior
 *  fill, overspray halo — plus a scratch canvas the cover composites its
 *  moving masks through, so each beat reveals a pre-rendered layer
 *  instead of painting (and stepping) per frame. */
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
    const outlineC = mk();
    const halo = mk();
    const scratch = mk();
    const fg = fill.getContext('2d');
    const og = outlineC.getContext('2d');
    const hg = halo.getContext('2d');
    if (!fg || !og || !hg) return null;
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

    // --- outline: the finished sprayed contour. A soft wet under-stroke,
    // a dense core stroke, then speckle walked along the sampled path so
    // the edge is ragged like real overspray. Drawn once; the cover
    // reveals it through a mask, never re-stamps it per frame.
    place(og);
    og.lineJoin = 'round';
    og.lineCap = 'round';
    og.strokeStyle = PAINT;
    traceSpade(og);
    og.globalAlpha = 0.16;
    og.lineWidth = (geo.brush * 1.5) / geo.k;
    og.stroke();
    traceSpade(og);
    og.globalAlpha = 0.97;
    og.lineWidth = (geo.brush * 0.8) / geo.k;
    og.stroke();
    const rndO = mulberry32(0x0a17);
    for (const p of SPADE_OUTLINE.pts) {
      for (let j = 0; j < 2; j++) {
        const off = (rndO() - 0.5) * ((geo.brush * 1.1) / geo.k);
        const along = (rndO() - 0.5) * 0.9;
        og.globalAlpha = 0.08 + rndO() * 0.32;
        og.fillStyle = INKS[(rndO() * INKS.length) | 0]!;
        og.beginPath();
        og.arc(p.x + off + along, p.y + off - along, 0.3 + rndO() * 0.9, 0, TAU);
        og.fill();
      }
    }
    og.globalAlpha = 1;

    spadeSprites = {
      key,
      fill,
      outline: outlineC,
      halo,
      scratch,
      dpr,
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
/* Cover program — outline, then interior, then bloom                  */
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

/** Point at arc length `target` (px) along the outline, interpolated
 *  between the sampled points — the trace frontier moves continuously,
 *  never snapping from sample to sample. */
function frontierAt(
  pts: SpadeGeo['pts'],
  target: number,
): { x: number; y: number } {
  if (target <= 0) return { x: pts[0]!.x, y: pts[0]!.y };
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i]!;
    if (p.cum >= target) {
      const q = pts[i - 1]!;
      const span = p.cum - q.cum;
      const f = span > 0 ? (target - q.cum) / span : 0;
      return { x: q.x + (p.x - q.x) * f, y: q.y + (p.y - q.y) * f };
    }
  }
  const last = pts[pts.length - 1]!;
  return { x: last.x, y: last.y };
}

/** Composite the pre-rendered outline sprite through a moving mask:
 *  stroke the traced-so-far sub-path wide onto the scratch canvas, keep
 *  only the sprite inside it ('source-in'), and lay the result down.
 *  The revealed line is the finished sprite's own, so it cannot step —
 *  only the mask frontier moves, and it moves by the frame clock. */
function drawOutlineReveal(
  g: CanvasRenderingContext2D,
  sp: SpadeSprites,
  geo: SpadeGeo,
  outlineP: number,
): void {
  const sg = sp.scratch.getContext('2d');
  if (!sg) return;
  const target = outlineP * geo.outlineLen;
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalCompositeOperation = 'source-over';
  sg.globalAlpha = 1;
  sg.clearRect(0, 0, sp.scratch.width, sp.scratch.height);
  sg.setTransform(sp.dpr, 0, 0, sp.dpr, -sp.x * sp.dpr, -sp.y * sp.dpr);
  sg.beginPath();
  sg.moveTo(geo.pts[0]!.x, geo.pts[0]!.y);
  for (const p of geo.pts) {
    if (p.cum > target) break;
    sg.lineTo(p.x, p.y);
  }
  const f = frontierAt(geo.pts, target);
  sg.lineTo(f.x, f.y);
  sg.lineWidth = geo.brush * 1.8;
  sg.lineCap = 'round';
  sg.lineJoin = 'round';
  sg.strokeStyle = '#fff';
  sg.stroke();
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.drawImage(sp.outline, 0, 0);
  sg.globalCompositeOperation = 'source-over';
  g.drawImage(sp.scratch, sp.x, sp.y, sp.w, sp.h);
}

/** The can's business end at a point: a soft overspray puff with the
 *  nozzle dab at its heart — what makes a frontier read as a moving
 *  spray can rather than a drawing cursor. */
function drawNozzle(
  g: CanvasRenderingContext2D,
  brush: HTMLCanvasElement,
  x: number,
  y: number,
  brushSize: number,
): void {
  const puff = brushSize * 2.1;
  g.globalAlpha = 0.32;
  g.drawImage(brush, x - puff / 2, y - puff / 2, puff, puff);
  const dabSize = brushSize * 1.18;
  g.globalAlpha = 1;
  g.drawImage(brush, x - dabSize / 2, y - dabSize / 2, dabSize, dabSize);
  g.globalAlpha = 1;
}

/** Beat 1: the can traces the spade's COMPLETE outline. The overspray
 *  halo gathers as the trace travels; the interior stays EMPTY — the
 *  fill sprite is not touched in this beat (pinned by tests). outlineP
 *  is the beat's eased progress 0..1. */
function drawSpadeOutline(
  g: CanvasRenderingContext2D,
  geo: SpadeGeo,
  outlineP: number,
  dpr: number,
): void {
  const sp = getSpadeSprites(geo, dpr);
  if (sp) {
    g.globalAlpha = Math.min(0.92, outlineP * 1.3);
    g.drawImage(sp.halo, sp.x, sp.y, sp.w, sp.h);
    g.globalAlpha = 1;
    if (outlineP >= 1) {
      g.drawImage(sp.outline, sp.x, sp.y, sp.w, sp.h);
    } else if (outlineP > 0) {
      drawOutlineReveal(g, sp, geo, outlineP);
    }
  }
  const brush = getBrushSprite();
  if (!brush || outlineP <= 0) return;
  const f = frontierAt(geo.pts, outlineP * geo.outlineLen);
  drawNozzle(g, brush, f.x, f.y, geo.brush);
  g.globalAlpha = 1;
}

/** Composite the fill sprite behind a soft moving front: a
 *  destination-in gradient on the scratch canvas — alpha 1 above the
 *  front, feathering to 0 across a wide band — so the interior arrives
 *  as a sweep of wet paint with no hard band edge anywhere. */
function drawFillReveal(
  g: CanvasRenderingContext2D,
  sp: SpadeSprites,
  fillP: number,
): void {
  const sg = sp.scratch.getContext('2d');
  if (!sg) return;
  const srcPad = (sp.pad / sp.h) * sp.fill.height;
  const srcSpadeH = (sp.spadeH / sp.h) * sp.fill.height;
  const band = srcSpadeH * 0.3;
  const front = srcPad - band + fillP * (srcSpadeH + band * 2);
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalCompositeOperation = 'source-over';
  sg.globalAlpha = 1;
  sg.clearRect(0, 0, sp.scratch.width, sp.scratch.height);
  sg.drawImage(sp.fill, 0, 0);
  const grad = sg.createLinearGradient(0, front - band / 2, 0, front + band / 2);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sg.globalCompositeOperation = 'destination-in';
  sg.fillStyle = grad;
  sg.fillRect(0, 0, sp.scratch.width, sp.scratch.height);
  sg.globalCompositeOperation = 'source-over';
  g.drawImage(sp.scratch, sp.x, sp.y, sp.w, sp.h);
}

/** Beat 2: the interior sprays in. The completed outline stands; the
 *  fill arrives behind the soft front while the nozzle rides it with a
 *  sway, like a can sweeping back and forth. fillP is the beat's eased
 *  progress 0..1; at 1 the spade stands finished (the bloom's base). */
function drawSpadeFill(
  g: CanvasRenderingContext2D,
  geo: SpadeGeo,
  fillP: number,
  dpr: number,
): void {
  const sp = getSpadeSprites(geo, dpr);
  if (sp) {
    g.globalAlpha = 0.92;
    g.drawImage(sp.halo, sp.x, sp.y, sp.w, sp.h);
    g.globalAlpha = 1;
    g.drawImage(sp.outline, sp.x, sp.y, sp.w, sp.h);
    if (fillP >= 1) {
      g.drawImage(sp.fill, sp.x, sp.y, sp.w, sp.h);
    } else if (fillP > 0) {
      drawFillReveal(g, sp, fillP);
    }
  }
  const brush = getBrushSprite();
  if (!brush || fillP <= 0 || fillP >= 1) return;
  const band = geo.h * 0.3;
  const frontY = geo.top - band + fillP * (geo.h + band * 2);
  const swayX = geo.cx + Math.sin(fillP * 5.1) * geo.w * 0.18;
  const y = Math.min(geo.top + geo.h, Math.max(geo.top, frontY));
  drawNozzle(g, brush, swayX, y, geo.brush);
  g.globalAlpha = 1;
}

/** Beat 3: the paint fills out from the spade — a black bloom whose front
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
  if (pos < SPRAY_OUTLINE_MS) {
    // Beat 1: the can traces the complete outline; interior still empty.
    drawSpadeOutline(g, geo, easeInOutCubic(pos / SPRAY_OUTLINE_MS), dpr);
  } else if (pos < SPRAY_SPADE_MS) {
    // Beat 2: the outline stands finished; the interior sprays in.
    drawSpadeFill(g, geo, easeInOutCubic((pos - SPRAY_OUTLINE_MS) / SPRAY_FILL_MS), dpr);
  } else {
    // Beat 3: the finished spade, then the bloom out to full black.
    drawSpadeFill(g, geo, 1, dpr);
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
