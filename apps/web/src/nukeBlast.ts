/**
 * Canvas detonation. No libraries.
 *
 * Sprites are baked once (gradients live only in that bake). Each frame is drawImage
 * from a struct-of-arrays pool: no per-frame allocation, no shadowBlur, no per-particle
 * gradients. Draws are batched by sprite and blend mode. DPR is capped at 2.
 * The pool starts at full count on every device. It shrinks only after a measured
 * frame takes longer than 50ms.
 *
 * License: procedural, written for this game. No stock footage.
 */

export const BLAST_MS = 1800;
/** Cards leave for the winner's pile at the end of the blast. */
export const SWEEP_MS = 1500;
/** Shockwave is gone, then the stamp. */
export const SHOCK_END_MS = 520;
export const BANNER_AT_MS = 560;
export const BANNER_MS = 500;
const SHAKE_MS = 700;

export function flashAlpha(tMs: number, reduced: boolean): number {
  if (tMs < 0 || tMs > 100) return 0;
  if (reduced) return tMs < 80 ? 0.9 : 0;
  if (tMs <= 40) return 1;
  return Math.max(0, 1 - (tMs - 40) / 60);
}

/** 1–2 frames of green at ignition, under the white flash as it clears. Not a fullscreen wash. */
export function ignitionAlpha(tMs: number, reduced: boolean): number {
  if (reduced || tMs < 30 || tMs > 90) return 0;
  const u = (tMs - 30) / 60;
  return u < 0.35 ? u / 0.35 : 1 - (u - 0.35) / 0.65;
}

/**
 * Violent whole-screen shake, decaying over 700ms. None under reduced motion.
 * Big Joker starts at 16px, Little Joker at 8px.
 */
export function shakeOffset(tMs: number, kind: 'BJ' | 'LJ', reduced: boolean): { x: number; y: number } {
  if (reduced || tMs < 0 || tMs >= SHAKE_MS) return { x: 0, y: 0 };
  const amp0 = kind === 'BJ' ? 16 : 8;
  const u = tMs / SHAKE_MS;
  const amp = amp0 * (1 - u) * (1 - u);
  const phase = u * 8 * Math.PI * 2;
  return { x: amp * Math.sin(phase), y: amp * 0.6 * Math.cos(phase * 0.85) };
}

export function shockwave(tMs: number): { mul: number; opacity: number } | null {
  if (tMs < 40 || tMs > SHOCK_END_MS) return null;
  const u = (tMs - 40) / (SHOCK_END_MS - 40);
  const e = 1 - (1 - u) ** 3;
  return { mul: e, opacity: Math.max(0, 1 - u * u) };
}

/** Other trick cards blow outward and fade. Opacity never hits 0. */
export function cardBlow(tMs: number): { px: number; opacity: number } {
  const dist = 32;
  if (tMs <= 0) return { px: 0, opacity: 1 };
  if (tMs < 400) {
    const e = 1 - (1 - tMs / 400) ** 3;
    return { px: dist * e, opacity: 1 - 0.6 * e };
  }
  return { px: dist, opacity: 0.4 };
}

/** Little Joker is crushed into the core, then gone. */
export function jokerCrush(tMs: number): { pull: number; opacity: number; scale: number } {
  if (tMs <= 0) return { pull: 0, opacity: 1, scale: 1 };
  if (tMs >= 160) return { pull: 1, opacity: 0, scale: 0.08 };
  const e = 1 - (1 - tMs / 160) ** 2;
  return { pull: e, opacity: 1 - e, scale: 1 - 0.92 * e };
}

/** Winning joker: 1 → 1.2 → 1, then it waits to fly. */
export function jokerPop(tMs: number): number {
  const start = 80;
  const dur = 520;
  const peak = 1.2;
  if (tMs < start || tMs > start + dur) return 1;
  const u = (tMs - start) / dur;
  if (u < 0.4) return 1 + (peak - 1) * (u / 0.4);
  return peak + (1 - peak) * ((u - 0.4) / 0.6);
}

export function bannerPose(tMs: number): { opacity: number; scale: number } | null {
  if (tMs < BANNER_AT_MS || tMs > BANNER_AT_MS + BANNER_MS) return null;
  const u = (tMs - BANNER_AT_MS) / BANNER_MS;
  const keys = [
    { t: 0, o: 0, s: 1.4 },
    { t: 0.16, o: 1, s: 0.96 },
    { t: 0.28, o: 1, s: 1 },
    { t: 0.62, o: 1, s: 1 },
    { t: 1, o: 0, s: 1.04 },
  ];
  let i = 1;
  while (i < keys.length - 1 && keys[i]!.t < u) i++;
  const a = keys[i - 1]!;
  const b = keys[i]!;
  const k = Math.min(1, Math.max(0, (u - a.t) / (b.t - a.t || 1)));
  return { opacity: a.o + (b.o - a.o) * k, scale: a.s + (b.s - a.s) * k };
}

export function corePose(tMs: number): { radius: number; alpha: number } | null {
  if (tMs < 70 || tMs > 420) return null;
  const u = (tMs - 70) / (420 - 70);
  const radius = 6 + 78 * Math.min(1, u / 0.35);
  const alpha = u < 0.2 ? u / 0.2 : Math.max(0, 1 - (u - 0.2) / 0.8);
  return { radius, alpha };
}

let owns = false;
/** True once a 2D context was created. Same visuals on every device that can paint one. */
export function canvasOwnsBlast(): boolean { return owns; }

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface Sprites {
  fire: AnyCanvas;
  smoke: AnyCanvas;
  ash: AnyCanvas;
  ember: AnyCanvas;
  spark: AnyCanvas;
  bolt: AnyCanvas;
  ring: AnyCanvas;
  ringGreen: AnyCanvas;
}

let sprites: Sprites | null = null;

function blank(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function bakeRadial(size: number, stops: { t: number; color: string }[]): AnyCanvas {
  const c = blank(size, size);
  const ctx = c.getContext('2d') as AnyCtx | null;
  if (!ctx) return c;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const s of stops) g.addColorStop(s.t, s.color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function bakeSprites(): Sprites {
  if (sprites) return sprites;
  const ring = blank(128, 128);
  const rctx = ring.getContext('2d') as AnyCtx | null;
  if (rctx) {
    rctx.strokeStyle = '#fff';
    rctx.lineWidth = 6;
    rctx.beginPath();
    rctx.arc(64, 64, 52, 0, Math.PI * 2);
    rctx.stroke();
    rctx.globalAlpha = 0.45;
    rctx.lineWidth = 14;
    rctx.beginPath();
    rctx.arc(64, 64, 46, 0, Math.PI * 2);
    rctx.stroke();
  }
  const ringGreen = blank(128, 128);
  const gctx = ringGreen.getContext('2d') as AnyCtx | null;
  if (gctx) {
    gctx.strokeStyle = '#B6FF3B';
    gctx.lineWidth = 5;
    gctx.beginPath();
    gctx.arc(64, 64, 54, 0, Math.PI * 2);
    gctx.stroke();
  }
  const bolt = blank(16, 96);
  const bctx = bolt.getContext('2d') as AnyCtx | null;
  if (bctx) {
    bctx.strokeStyle = '#fff4e0';
    bctx.lineWidth = 2;
    bctx.beginPath();
    bctx.moveTo(8, 2);
    bctx.lineTo(4, 32);
    bctx.lineTo(12, 48);
    bctx.lineTo(6, 94);
    bctx.stroke();
  }
  sprites = {
    fire: bakeRadial(64, [
      { t: 0, color: '#fffef8' },
      { t: 0.25, color: '#ffd24d' },
      { t: 0.55, color: '#ff4d1f' },
      { t: 0.8, color: 'rgba(180,20,80,0.45)' },
      { t: 1, color: 'rgba(180,20,80,0)' },
    ]),
    smoke: bakeRadial(64, [
      { t: 0, color: 'rgba(255,90,30,0.55)' },
      { t: 0.35, color: 'rgba(42,37,34,0.72)' },
      { t: 0.7, color: 'rgba(18,14,16,0.55)' },
      { t: 1, color: 'rgba(8,6,8,0)' },
    ]),
    ash: bakeRadial(32, [
      { t: 0, color: 'rgba(90,86,82,0.9)' },
      { t: 0.6, color: 'rgba(40,38,36,0.55)' },
      { t: 1, color: 'rgba(20,18,18,0)' },
    ]),
    ember: bakeRadial(32, [
      { t: 0, color: '#fff6d0' },
      { t: 0.4, color: '#ff8a3d' },
      { t: 1, color: 'rgba(255,77,31,0)' },
    ]),
    spark: bakeRadial(16, [
      { t: 0, color: '#fff' },
      { t: 0.5, color: '#ffe38a' },
      { t: 1, color: 'rgba(255,227,138,0)' },
    ]),
    bolt,
    ring,
    ringGreen,
  };
  return sprites;
}

/** Probe a 2D context and bake sprites. Safe to call more than once. */
export function warmBlast(): boolean {
  try {
    if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return owns;
    const c = blank(8, 8);
    const ctx = c.getContext('2d');
    if (!ctx) { owns = false; return false; }
    bakeSprites();
    owns = true;
    return true;
  } catch {
    owns = false;
    return false;
  }
}

export const CAP = {
  fire: 220,
  smoke: 180,
  ember: 420,
  ash: 280,
  spark: 160,
  bolt: 16,
} as const;

export type PoolName = keyof typeof CAP;

interface Pool {
  cap: number;
  alive: number;
  x: Float32Array;
  y: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  age: Float32Array;
  life: Float32Array;
  size: Float32Array;
  spin: Float32Array;
  on: Uint8Array;
  free: Int32Array;
  freeN: number;
}

export interface Blast {
  t: number;
  rng: number;
  budget: number;
  slowed: boolean;
  cx: number;
  cy: number;
  w: number;
  h: number;
  dpr: number;
  reduced: boolean;
  frac: Record<PoolName, number>;
  pools: Record<PoolName, Pool>;
}

function makePool(cap: number): Pool {
  const free = new Int32Array(cap);
  for (let i = 0; i < cap; i++) free[i] = cap - 1 - i;
  return {
    cap,
    alive: 0,
    x: new Float32Array(cap),
    y: new Float32Array(cap),
    vx: new Float32Array(cap),
    vy: new Float32Array(cap),
    age: new Float32Array(cap),
    life: new Float32Array(cap),
    size: new Float32Array(cap),
    spin: new Float32Array(cap),
    on: new Uint8Array(cap),
    free,
    freeN: cap,
  };
}

function rnd(b: Blast): number {
  b.rng = (b.rng * 1664525 + 1013904223) >>> 0;
  return b.rng / 4294967296;
}

export function createBlast(seed = 1): Blast {
  return {
    t: 0,
    rng: seed || 1,
    budget: 1,
    slowed: false,
    cx: 0,
    cy: 0,
    w: 1,
    h: 1,
    dpr: 1,
    reduced: false,
    frac: { fire: 0, smoke: 0, ember: 0, ash: 0, spark: 0, bolt: 0 },
    pools: {
      fire: makePool(CAP.fire),
      smoke: makePool(CAP.smoke),
      ember: makePool(CAP.ember),
      ash: makePool(CAP.ash),
      spark: makePool(CAP.spark),
      bolt: makePool(CAP.bolt),
    },
  };
}

export function resetBlast(b: Blast, opts: { cx: number; cy: number; w: number; h: number; dpr: number; reduced: boolean }): void {
  b.t = 0;
  b.cx = opts.cx;
  b.cy = opts.cy;
  b.w = opts.w;
  b.h = opts.h;
  b.dpr = opts.dpr;
  b.reduced = opts.reduced;
  b.frac.fire = b.frac.smoke = b.frac.ember = b.frac.ash = b.frac.spark = b.frac.bolt = 0;
  for (const name of Object.keys(b.pools) as PoolName[]) {
    const p = b.pools[name];
    p.on.fill(0);
    p.alive = 0;
    p.freeN = p.cap;
    for (let i = 0; i < p.cap; i++) p.free[i] = p.cap - 1 - i;
  }
}

function take(p: Pool): number {
  if (p.freeN <= 0) return -1;
  const i = p.free[--p.freeN]!;
  p.on[i] = 1;
  p.alive++;
  return i;
}

function drop(p: Pool, i: number): void {
  if (!p.on[i]) return;
  p.on[i] = 0;
  p.alive--;
  p.free[p.freeN++] = i;
}

function emit(b: Blast, name: PoolName, n: number, init: (i: number) => void): void {
  const p = b.pools[name];
  const room = Math.floor(p.cap * b.budget) - p.alive;
  const count = Math.max(0, Math.min(n, room));
  for (let k = 0; k < count; k++) {
    const i = take(p);
    if (i < 0) return;
    init(i);
  }
}

/** A measured draw/sim frame. Shrinks the live set once, only when a frame actually ran long. */
export function noteFrame(b: Blast, ms: number): void {
  if (ms <= 50 || b.budget <= 0.4) return;
  b.budget *= 0.7;
  b.slowed = true;
  for (const name of Object.keys(b.pools) as PoolName[]) {
    const p = b.pools[name];
    const keep = Math.floor(p.cap * b.budget);
    if (p.alive <= keep) continue;
    for (let i = p.cap - 1; i >= 0 && p.alive > keep; i--) drop(p, i);
  }
}

function integrate(p: Pool, dt: number, drag: number, gravity: number): void {
  for (let i = 0; i < p.cap; i++) {
    if (!p.on[i]) continue;
    p.age[i] += dt;
    if (p.age[i] >= p.life[i]) { drop(p, i); continue; }
    p.vx[i] *= 1 - drag * dt;
    p.vy[i] = p.vy[i] * (1 - drag * dt) + gravity * dt;
    p.x[i] += p.vx[i] * dt;
    p.y[i] += p.vy[i] * dt;
    p.spin[i] += dt;
  }
}

/** Advance by dt seconds. Returns false when the blast is over. */
export function stepBlast(b: Blast, dt: number): boolean {
  if (b.reduced) {
    b.t += dt;
    return b.t < 0.12;
  }
  const step = Math.min(0.033, Math.max(0, dt));
  b.t += step;
  const t = b.t;
  const rate = (name: PoolName, perSec: number) => {
    b.frac[name] += perSec * step * b.budget;
    const n = b.frac[name] | 0;
    b.frac[name] -= n;
    return n;
  };
  if (t >= 0.06 && t <= 0.75) {
    const n = rate('fire', 140);
    emit(b, 'fire', n, (i) => {
      const p = b.pools.fire;
      p.x[i] = (rnd(b) - 0.5) * 10;
      p.y[i] = rnd(b) * 8;
      p.vx[i] = (rnd(b) - 0.5) * 36;
      p.vy[i] = -(480 + rnd(b) * 320);
      p.age[i] = 0;
      p.life[i] = 0.38 + rnd(b) * 0.22;
      p.size[i] = 26 + rnd(b) * 40;
      p.spin[i] = 0;
    });
  }
  if (t >= 0.16 && t <= 1.05) {
    const n = rate('smoke', 100);
    emit(b, 'smoke', n, (i) => {
      const p = b.pools.smoke;
      const ang = rnd(b) * Math.PI;
      const sp = 90 + rnd(b) * 240;
      p.x[i] = (rnd(b) - 0.5) * 16;
      p.y[i] = -20 - rnd(b) * 30;
      p.vx[i] = Math.cos(ang) * sp;
      p.vy[i] = -Math.abs(Math.sin(ang)) * (60 + rnd(b) * 180) - 40;
      p.age[i] = 0;
      p.life[i] = 0.7 + rnd(b) * 0.45;
      p.size[i] = 36 + rnd(b) * 70;
      p.spin[i] = rnd(b) * 6;
    });
  }
  if (t >= 0.04 && t <= 0.4) {
    const n = rate('spark', 260);
    emit(b, 'spark', n, (i) => {
      const p = b.pools.spark;
      const ang = rnd(b) * Math.PI * 2;
      const sp = 180 + rnd(b) * 520;
      p.x[i] = 0;
      p.y[i] = 0;
      p.vx[i] = Math.cos(ang) * sp;
      p.vy[i] = Math.sin(ang) * sp;
      p.age[i] = 0;
      p.life[i] = 0.18 + rnd(b) * 0.22;
      p.size[i] = 6 + rnd(b) * 10;
      p.spin[i] = 0;
    });
  }
  if (t >= 0.28 && t <= 1.55) {
    const n = rate('ember', 160);
    emit(b, 'ember', n, (i) => {
      const p = b.pools.ember;
      p.x[i] = (rnd(b) - 0.5) * 80;
      p.y[i] = -40 - rnd(b) * 120;
      p.vx[i] = (rnd(b) - 0.5) * 80;
      p.vy[i] = -(40 + rnd(b) * 160);
      p.age[i] = 0;
      p.life[i] = 0.7 + rnd(b) * 0.7;
      p.size[i] = 5 + rnd(b) * 9;
      p.spin[i] = 0;
    });
  }
  if (t >= 0.45 && t <= 1.65) {
    const n = rate('ash', 90);
    emit(b, 'ash', n, (i) => {
      const p = b.pools.ash;
      p.x[i] = (rnd(b) - 0.5) * 140;
      p.y[i] = -80 - rnd(b) * 160;
      p.vx[i] = (rnd(b) - 0.5) * 24;
      p.vy[i] = 16 + rnd(b) * 36;
      p.age[i] = 0;
      p.life[i] = 0.9 + rnd(b) * 0.6;
      p.size[i] = 8 + rnd(b) * 16;
      p.spin[i] = rnd(b);
    });
  }
  if (t >= 0.2 && t <= 1.15 && b.pools.bolt.alive < Math.floor(CAP.bolt * b.budget)) {
    emit(b, 'bolt', 1, (i) => {
      const p = b.pools.bolt;
      const side = rnd(b) < 0.5 ? -1 : 1;
      p.x[i] = side * (30 + rnd(b) * 90);
      p.y[i] = -80 - rnd(b) * 140;
      p.vx[i] = side * (20 + rnd(b) * 40);
      p.vy[i] = 30 + rnd(b) * 40;
      p.age[i] = 0;
      p.life[i] = 0.08 + rnd(b) * 0.1;
      p.size[i] = 50 + rnd(b) * 70;
      p.spin[i] = side;
    });
  }
  integrate(b.pools.fire, step, 0.6, 140);
  integrate(b.pools.smoke, step, 1.4, 20);
  integrate(b.pools.spark, step, 1.1, 40);
  integrate(b.pools.ember, step, 0.8, 220);
  integrate(b.pools.ash, step, 0.4, 12);
  integrate(b.pools.bolt, step, 0, 0);
  return b.t < BLAST_MS / 1000;
}

function drawPool(ctx: AnyCtx, sprite: AnyCanvas, p: Pool, ox: number, oy: number, lighter: boolean): void {
  ctx.globalCompositeOperation = lighter ? 'lighter' : 'source-over';
  for (let i = 0; i < p.cap; i++) {
    if (!p.on[i]) continue;
    const u = p.age[i] / p.life[i];
    const alpha = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
    if (alpha <= 0.02) continue;
    const s = p.size[i] * (0.7 + 0.5 * u);
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.drawImage(sprite as CanvasImageSource, ox + p.x[i] - s / 2, oy + p.y[i] - s / 2, s, s);
  }
}

export function drawBlast(ctx: AnyCtx, b: Blast): void {
  const sp = bakeSprites();
  const tMs = b.t * 1000;
  const dpr = b.dpr || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, b.w, b.h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (b.reduced) {
    const a = flashAlpha(tMs, true);
    if (a > 0) {
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, b.w, b.h);
    }
    ctx.globalAlpha = 1;
    return;
  }
  drawPool(ctx, sp.ash, b.pools.ash, b.cx, b.cy, false);
  drawPool(ctx, sp.smoke, b.pools.smoke, b.cx, b.cy, false);
  drawPool(ctx, sp.fire, b.pools.fire, b.cx, b.cy, true);
  drawPool(ctx, sp.ember, b.pools.ember, b.cx, b.cy, true);
  drawPool(ctx, sp.spark, b.pools.spark, b.cx, b.cy, true);
  ctx.globalCompositeOperation = 'lighter';
  const bolts = b.pools.bolt;
  for (let i = 0; i < bolts.cap; i++) {
    if (!bolts.on[i]) continue;
    const u = bolts.age[i] / bolts.life[i];
    ctx.globalAlpha = 1 - u;
    const bh = bolts.size[i];
    const side = bolts.spin[i] < 0 ? -1 : 1;
    ctx.setTransform(dpr * side, 0, 0, dpr, dpr * (b.cx + bolts.x[i]), dpr * (b.cy + bolts.y[i]));
    ctx.drawImage(sp.bolt as CanvasImageSource, -7, 0, 14, bh);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const core = corePose(tMs);
  if (core && core.alpha > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = core.alpha;
    const s = core.radius * 2;
    ctx.drawImage(sp.fire as CanvasImageSource, b.cx - s / 2, b.cy - s / 2, s, s);
  }
  const sw = shockwave(tMs);
  if (sw && sw.opacity > 0.02) {
    const table = Math.min(b.w, b.h) * 0.92;
    const rad = Math.max(8, (sw.mul * table) / 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = sw.opacity;
    ctx.drawImage(sp.ring as CanvasImageSource, b.cx - rad, b.cy - rad, rad * 2, rad * 2);
    const wobble = Math.sin(tMs * 0.08) * 8;
    ctx.globalAlpha = sw.opacity * 0.55;
    ctx.drawImage(sp.ring as CanvasImageSource, b.cx - rad + wobble, b.cy - rad * 0.92, rad * 2.05, rad * 1.9);
  }
  const ign = ignitionAlpha(tMs, false);
  if (ign > 0.02) {
    const rad = Math.min(b.w, b.h) * 0.18;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = ign;
    ctx.drawImage(sp.ringGreen as CanvasImageSource, b.cx - rad, b.cy - rad, rad * 2, rad * 2);
  }
  const flash = flashAlpha(tMs, false);
  if (flash > 0.01) {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = flash;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, b.w, b.h);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

export function dprCap(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(2, window.devicePixelRatio || 1);
}

if (typeof window !== 'undefined') warmBlast();
