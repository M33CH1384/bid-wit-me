import { CH, CR, CW } from './layout';

export interface Pt { x: number; y: number }

/**
 * Playable cards stay in suit order (spades, hearts, clubs, diamonds). Re-sorting them together on your turn would
 * break that read — voids and suit length are how a spades hand is scanned — and then snap back when the turn ends.
 * Follow-suit and "spades not broken" already land on one contiguous block. If a gap ever shows up, each block gets
 * its own outline instead of one halo that bridges the cards you can't play.
 */
export function contiguousRuns(playable: readonly boolean[]): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i < playable.length; i++) {
    if (playable[i]) { if (start < 0) start = i; }
    else if (start >= 0) { runs.push([start, i - 1]); start = -1; }
  }
  if (start >= 0) runs.push([start, playable.length - 1]);
  return runs;
}

/** Centreline of the group stroke, just outside the faces. Close to the old per-card backing (1.09 × 1.065). */
export const HALO_SX = 1.1;
export const HALO_SY = 1.08;

/** Rounded rectangle in card-local space, CCW. Corner radii scale with the non-uniform pad so the rim stays even. */
export function roundedRect(hw: number, hh: number, rx: number, ry: number, segs = 4): Pt[] {
  const cxr = Math.max(0, Math.min(rx, hw));
  const cyr = Math.max(0, Math.min(ry, hh));
  const corners: [number, number, number][] = [
    [hw - cxr, hh - cyr, 0],
    [-(hw - cxr), hh - cyr, Math.PI / 2],
    [-(hw - cxr), -(hh - cyr), Math.PI],
    [hw - cxr, -(hh - cyr), Math.PI * 1.5],
  ];
  const pts: Pt[] = [];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (Math.PI / 2) * (i / segs);
      pts.push({ x: cx + Math.cos(a) * cxr, y: cy + Math.sin(a) * cyr });
    }
  }
  return pts;
}

/** Card-local halo (the old gold backing was the card face scaled up). `s` is the fan's card scale, applied by the caller. */
export function haloLocal(sx: number, sy: number, segs = 4): Pt[] {
  return roundedRect((CW / 2) * sx, (CH / 2) * sy, CR * sx, CR * sy, segs);
}

/** Major-axis angle of a point cloud, so a fanned run is boxed with the cards instead of the screen. */
function clusterAngle(pts: readonly Pt[]): number {
  let n = 0, mx = 0, my = 0;
  for (const p of pts) { n++; mx += p.x; my += p.y; }
  if (n < 2) return 0;
  mx /= n; my /= n;
  let xx = 0, xy = 0, yy = 0;
  for (const p of pts) {
    const dx = p.x - mx, dy = p.y - my;
    xx += dx * dx; xy += dx * dy; yy += dy * dy;
  }
  return 0.5 * Math.atan2(2 * xy, xx - yy);
}

/**
 * One rounded rectangle around a run: `pad` outside the faces, corner radius `radius`.
 * The box follows the run (a tight fan is not square to the screen), so it stays off the cards
 * you can't play. One convex outline — no per-card scallop, so the stroke has nothing to flare into rays.
 * Returns null when there is nothing to wrap.
 */
/** A projected corner past this (plane units at depth 1) is a bad divide, not a card. A hand is under 1. */
export const MAX_PLANE = 6;

export function planePointOk(x: number, y: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= MAX_PLANE && Math.abs(y) <= MAX_PLANE;
}

export function groupOutline(polys: readonly (readonly Pt[])[], pad: number, radius: number, segs = 5): Pt[] | null {
  const pts: Pt[] = [];
  for (const poly of polys) for (const p of poly) if (planePointOk(p.x, p.y)) pts.push(p);
  if (!pts.length) return null;
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x; cy += p.y; }
  cx /= pts.length; cy /= pts.length;
  const ang = clusterAngle(pts);
  const co = Math.cos(ang), si = Math.sin(ang);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    const dx = p.x - cx, dy = p.y - cy;
    const x = dx * co + dy * si;
    const y = -dx * si + dy * co;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (!(maxX >= minX) || !(maxY >= minY)) return null;
  const hw = (maxX - minX) / 2 + pad;
  const hh = (maxY - minY) / 2 + pad;
  // One wild corner used to stretch the stroke across the whole view. Drop the run instead.
  if (!planePointOk(hw, hh)) return null;
  const ox = (minX + maxX) / 2;
  const oy = (minY + maxY) / 2;
  return roundedRect(hw, hh, radius, radius, segs).map((p) => {
    const x = p.x + ox, y = p.y + oy;
    return { x: cx + x * co - y * si, y: cy + x * si + y * co };
  });
}

/** Place a card-local polygon on the depth-1 camera plane (same pose the fan projects). */
export function placeOnPlane(local: readonly Pt[], pose: { x: number; y: number; roll: number; s: number }): Pt[] {
  const c = Math.cos(pose.roll), s = Math.sin(pose.roll), k = pose.s;
  return local.map((p) => {
    const lx = p.x * k, ly = p.y * k;
    return { x: pose.x + lx * c - ly * s, y: pose.y + lx * s + ly * c };
  });
}

/** Vertical extent of a polygon at x, or null if the slice misses it. */
export function yRangeAt(poly: readonly Pt[], x: number): [number, number] | null {
  let y0 = Infinity, y1 = -Infinity, hit = false;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i]!, b = poly[(i + 1) % n]!;
    const minX = a.x < b.x ? a.x : b.x;
    const maxX = a.x > b.x ? a.x : b.x;
    if (x < minX - 1e-8 || x > maxX + 1e-8) continue;
    hit = true;
    if (Math.abs(b.x - a.x) < 1e-10) {
      if (a.y < y0) y0 = a.y;
      if (b.y < y0) y0 = b.y;
      if (a.y > y1) y1 = a.y;
      if (b.y > y1) y1 = b.y;
    } else {
      const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return hit ? [y0, y1] : null;
}

export interface Contour { top: Pt[]; bot: Pt[] }

/**
 * Outer silhouette of a left-to-right chain of card halos. A gap in x (a card you can't play, or two runs passed
 * together) starts a new contour, so the highlight never bridges across a card that isn't part of the group.
 * Top and bottom share x samples, which makes the ribbon a plain triangle strip.
 */
export function unionContours(polys: readonly (readonly Pt[])[], samplesPer = 18): Contour[] {
  if (!polys.length) return [];
  let x0 = Infinity, x1 = -Infinity;
  for (const poly of polys) for (const p of poly) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
  }
  if (!(x1 > x0)) return [];
  const n = Math.max(24, polys.length * samplesPer);
  const contours: Contour[] = [];
  let top: Pt[] = [], bot: Pt[] = [];
  const flush = () => {
    if (top.length >= 2) contours.push({ top, bot });
    top = []; bot = [];
  };
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    let lo = Infinity, hi = -Infinity, hit = false;
    for (const poly of polys) {
      const r = yRangeAt(poly, x);
      if (!r) continue;
      hit = true;
      if (r[0] < lo) lo = r[0];
      if (r[1] > hi) hi = r[1];
    }
    if (!hit) { flush(); continue; }
    top.push({ x, y: hi });
    bot.push({ x, y: lo });
  }
  flush();
  return contours;
}

/** Soften card-corner bumps so a run reads as one arc instead of a scalloped stack of borders. */
export function smoothContour(c: Contour, passes = 2): Contour {
  const smooth = (pts: Pt[]): Pt[] => {
    let cur = pts.map((p) => ({ x: p.x, y: p.y }));
    for (let k = 0; k < passes; k++) {
      cur = cur.map((p, i) => (i === 0 || i === cur.length - 1 ? p : { x: p.x, y: cur[i - 1]!.y * 0.22 + p.y * 0.56 + cur[i + 1]!.y * 0.22 }));
    }
    return cur;
  };
  return { top: smooth(c.top), bot: smooth(c.bot) };
}

/**
 * Same rim as `strokeRibbon`, but only the outside half (u = 0 on the path, u = 1 outside).
 * The glow can then draw above the neighbouring cards without tinting the faces.
 */
export function strokeOutward(c: Contour, radius: number): { pos: Float32Array; uv: Float32Array } {
  return strokeRibbon(c, radius, true);
}

/** A closed stroke around a contour. u = 0 is the inside edge and u = 1 the outside, unless `outwardOnly`. */
export function strokeRibbon(c: Contour, radius: number, outwardOnly = false): { pos: Float32Array; uv: Float32Array } {
  const line: Pt[] = [];
  const push = (p: Pt) => {
    const prev = line[line.length - 1];
    if (!prev || Math.hypot(prev.x - p.x, prev.y - p.y) > 1e-5) line.push(p);
  };
  for (const p of c.bot) push(p);
  for (let i = c.top.length - 1; i >= 0; i--) push(c.top[i]!);
  if (line.length > 2 && Math.hypot(line[0]!.x - line[line.length - 1]!.x, line[0]!.y - line[line.length - 1]!.y) < 1e-5) line.pop();
  const n = line.length;
  if (n < 3 || radius <= 0) return { pos: new Float32Array(), uv: new Float32Array() };
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const prev = line[(i - 1 + n) % n]!, next = line[(i + 1) % n]!, p = line[i]!;
    let dx = next.x - prev.x, dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    // CCW rim (bottom left→right, top right→left): outward is to the right of the tangent.
    outer.push({ x: p.x + dy * radius, y: p.y - dx * radius });
    inner.push({ x: p.x - dy * radius, y: p.y + dx * radius });
  }
  const pos = new Float32Array(n * 6 * 3);
  const uv = new Float32Array(n * 6 * 2);
  let o = 0, u = 0;
  const vert = (p: Pt, s: number) => { pos[o++] = p.x; pos[o++] = p.y; pos[o++] = 0; uv[u++] = s; uv[u++] = 0.5; };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (outwardOnly) {
      // u = 0 sits on the outline (the blur's peak) and u = 1 is the outer edge.
      vert(line[i]!, 0); vert(outer[i]!, 1); vert(line[j]!, 0);
      vert(line[j]!, 0); vert(outer[i]!, 1); vert(outer[j]!, 1);
    } else {
      vert(inner[i]!, 0); vert(outer[i]!, 1); vert(inner[j]!, 0);
      vert(inner[j]!, 0); vert(outer[i]!, 1); vert(outer[j]!, 1);
    }
  }
  return { pos, uv };
}

export function strokeContour(c: Contour, radius: number): Float32Array {
  return strokeRibbon(c, radius).pos;
}

/** Triangle list (x,y,0) for one or more filled ribbons. Winding is not guaranteed; the mesh is double-sided. */
export function contoursToTriangles(contours: readonly Contour[]): Float32Array {
  let verts = 0;
  for (const c of contours) verts += Math.max(0, c.top.length - 1) * 6;
  const arr = new Float32Array(verts * 3);
  let o = 0;
  const push = (p: Pt) => { arr[o++] = p.x; arr[o++] = p.y; arr[o++] = 0; };
  for (const c of contours) {
    for (let i = 0; i < c.top.length - 1; i++) {
      const b0 = c.bot[i]!, b1 = c.bot[i + 1]!, t0 = c.top[i]!, t1 = c.top[i + 1]!;
      push(b0); push(t0); push(b1);
      push(b1); push(t0); push(t1);
    }
  }
  return arr;
}

/** True when `p` sits between the contour's bottom and top at its x (the ribbon, not the bounding box). */
export function contourContains(c: Contour, p: Pt, eps = 1e-4): boolean {
  const n = c.bot.length;
  if (n < 2 || p.x < c.bot[0]!.x - eps || p.x > c.bot[n - 1]!.x + eps) return false;
  let i = 0;
  while (i < n - 2 && c.bot[i + 1]!.x < p.x) i++;
  const a = c.bot[i]!, b = c.bot[i + 1]!;
  const t = Math.abs(b.x - a.x) < 1e-10 ? 0 : (p.x - a.x) / (b.x - a.x);
  const lo = a.y + (b.y - a.y) * t;
  const ta = c.top[i]!, tb = c.top[i + 1]!;
  const hi = ta.y + (tb.y - ta.y) * t;
  return p.y >= lo - eps && p.y <= hi + eps;
}
