/**
 * Streak-fire renderer (owner, 2026-10-27 — "more photorealistic" than
 * the flat brushstroke-gradient sample he pasted).
 *
 * How it earns the word:
 *  - Flame tongues are PRE-RENDERED sprites: a teardrop body whose edge
 *    is eroded by fractal value noise (turbulent, broken edges — never a
 *    smooth blob), colored by a physical ramp (white-hot core low →
 *    yellow → orange → deep red → transparent tip). Four life stages are
 *    baked; a particle cross-picks its stage as it ages, narrows and
 *    shortens as it rises (erosion), and detaches as its tip fades.
 *  - Smoke is a separate noisy puff sprite, drawn with NORMAL blending
 *    at low alpha, rising slower and expanding — it reads as smoke
 *    because it does not glow.
 *  - Flames + embers + sparks draw with additive ('lighter') blending;
 *    embers twinkle individually; sparks are fast thin streaks.
 *  - A warm radial glow sits at the base and pulses with the same noise
 *    field that sways the tongues.
 *  - Plate mode clips every layer to OUTSIDE the plate's rect: the fire
 *    burns around and behind the plate, licking above its top edge, and
 *    never paints over the name, avatar, or stats on it.
 *
 * Performance contract: ONE canvas per surface, particle caps come from
 * the tier table (streakFire.ts), DPR capped at 1.5, the loop pauses
 * while the document is hidden, and all particle math is plain floats.
 * Zero assets: every sprite is generated at runtime on offscreen
 * canvases (seeded, so every client renders the same fire).
 */
import type { FireTierParams } from '../streakFire';

/* ------------------------------------------------------------ noise --- */

/** Deterministic hash → [0,1). Same seed, same fire, every client. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  h = h - Math.floor(h);
  return h;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal value noise, 4 octaves, [0,1]. */
export function fbm(x: number, y: number, seed = 0): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    v += amp * valueNoise(x * f, y * f, seed + o * 13);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm;
}

/* ------------------------------------------------------- color ramp --- */

type RGBA = [number, number, number, number];
const RAMP: { t: number; c: RGBA }[] = [
  { t: 0.0, c: [255, 244, 214, 1] },   // white-hot core
  { t: 0.28, c: [255, 205, 84, 1] },   // yellow
  { t: 0.52, c: [255, 128, 26, 1] },   // orange
  { t: 0.76, c: [226, 58, 10, 1] },    // deep orange-red
  { t: 0.93, c: [148, 26, 8, 0.55] },  // dark red, thinning
  { t: 1.0, c: [92, 16, 10, 0] },      // out
];

export function flameRamp(t: number): RGBA {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i]!.t) {
      const a = RAMP[i - 1]!, b = RAMP[i]!;
      const f = (x - a.t) / (b.t - a.t);
      return [
        a.c[0] + (b.c[0] - a.c[0]) * f,
        a.c[1] + (b.c[1] - a.c[1]) * f,
        a.c[2] + (b.c[2] - a.c[2]) * f,
        a.c[3] + (b.c[3] - a.c[3]) * f,
      ];
    }
  }
  return RAMP[RAMP.length - 1]!.c;
}

/* ------------------------------------------------------------ sprites - */

const FLAME_W = 96, FLAME_H = 160;

/**
 * One flame tongue sprite at a life stage (0 = young/full, 3 = old/
 * detached). The body is a teardrop: wide near the base, narrowing as
 * it rises; its half-width is eroded by fbm so the silhouette breaks up
 * like real flame edges, and the color ramp runs hot at the base to
 * dark at the tip, shifted hotter→cooler with the stage.
 */
function makeFlameSprite(stage: number): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = FLAME_W; cv.height = FLAME_H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(FLAME_W, FLAME_H);
  const d = img.data;
  for (let y = 0; y < FLAME_H; y++) {
    const v = 1 - y / FLAME_H; // 0 at base → 1 at tip
    // teardrop half-width profile: swells just above the base, then
    // narrows steadily; older stages pinch off sooner (detachment)
    const pinch = Math.max(0, 1 - stage * 0.16);
    let half = Math.pow(1 - v, 0.5) * (0.3 + 0.7 * Math.min(1, v * 5)) * pinch;
    half = Math.max(0.02, half);
    for (let x = 0; x < FLAME_W; x++) {
      const u = x / FLAME_W;
      const dx = Math.abs(u - 0.5) * 2; // 0 center → 1 edge
      // turbulence: the edge wanders with noise that scrolls with stage
      const turb = fbm(u * 3.1 + stage * 7.3, v * 4.2 - stage * 1.7, 41);
      const edge = half * (0.72 + turb * 0.55);
      const body = 1 - dx / Math.max(0.02, edge);
      if (body <= 0) continue;
      const density = Math.pow(Math.min(1, body), 0.72) * (0.75 + 0.45 * fbm(u * 6, v * 7, 97));
      // heat: hottest low + center; the stage pushes the whole tongue cooler
      const heat = Math.min(1, Math.max(0, v * 0.92 + stage * 0.16 + (1 - density) * 0.22 - 0.06));
      const [r, g, b, ra] = flameRamp(heat);
      const idx = (y * FLAME_W + x) * 4;
      d[idx] = r; d[idx + 1] = g; d[idx + 2] = b;
      const baseTaper = v < 0.13 ? v / 0.13 : 1; // detached tongues narrow at BOTH ends
      d[idx + 3] = Math.min(255, density * ra * 255 * baseTaper * (v > 0.97 ? (1 - v) / 0.03 : 1));
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function makeSmokeSprite(): HTMLCanvasElement {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      const dist = Math.hypot(u - 0.5, v - 0.5) * 2;
      const n = fbm(u * 4.6, v * 4.6, 7);
      const a = Math.max(0, (1 - dist) * (0.35 + n * 0.85) - 0.18);
      const idx = (y * S + x) * 4;
      d[idx] = 96; d[idx + 1] = 92; d[idx + 2] = 98;
      d[idx + 3] = Math.min(200, a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function makeGlowDot(): HTMLCanvasElement {
  const S = 32;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,224,160,1)');
  g.addColorStop(0.35, 'rgba(255,178,84,0.85)');
  g.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return cv;
}

let _sprites: { flames: HTMLCanvasElement[]; smoke: HTMLCanvasElement; dot: HTMLCanvasElement } | null = null;
function sprites() {
  if (!_sprites) {
    _sprites = {
      flames: [makeFlameSprite(0), makeFlameSprite(1), makeFlameSprite(2), makeFlameSprite(3)],
      smoke: makeSmokeSprite(),
      dot: makeGlowDot(),
    };
  }
  return _sprites;
}

/* ------------------------------------------------------------- engine - */

export interface FireRect { x: number; y: number; w: number; h: number }

export interface FireOptions {
  mode: 'band' | 'plate';
  /** plate mode: the plate's rect in canvas-local CSS px — fire is
   *  clipped OUT of it, so it burns around/behind the plate only */
  mask?: FireRect | null;
  /** calm (Reduce effects / OS reduce-motion): one static frame, no loop */
  calm?: boolean;
}

interface P {
  kind: 'flame' | 'ember' | 'spark' | 'smoke';
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; phase: number; seed: number;
}

const MAX_DPR = 1.5;

export class FireEffect {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private opts: FireOptions;
  private params: FireTierParams;
  private parts: P[] = [];
  private counts: Record<P['kind'], number> = { flame: 0, ember: 0, spark: 0, smoke: 0 };
  private raf = 0;
  private last = 0;
  private time = Math.random() * 100;
  private spawnAcc = { flame: 0, ember: 0, spark: 0, smoke: 0 };
  private ro: ResizeObserver | null = null;
  private destroyed = false;
  private seedCounter = 1;

  constructor(canvas: HTMLCanvasElement, params: FireTierParams, opts: FireOptions) {
    this.canvas = canvas;
    // jsdom and a few embedded webviews hand back no 2D context — the
    // effect then simply never paints (the marker chip still shows).
    this.ctx = null;
    try { this.ctx = canvas.getContext('2d'); } catch { this.ctx = null; }
    this.params = params;
    this.opts = opts;
    if (!this.ctx) return;
    this.resize();
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    if (this.ro && canvas.parentElement) this.ro.observe(canvas.parentElement);
    document.addEventListener('visibilitychange', this.onVis);
    if (opts.calm) this.drawStatic();
    else this.start();
  }

  setParams(params: FireTierParams, opts?: Partial<FireOptions>) {
    this.params = params;
    if (opts) this.opts = { ...this.opts, ...opts };
    if (!this.ctx) return;
    if (this.opts.calm) { this.stop(); this.drawStatic(); }
    else if (!this.raf) this.start();
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    this.ro?.disconnect();
    document.removeEventListener('visibilitychange', this.onVis);
  }

  private onVis = () => {
    if (this.destroyed || this.opts.calm) return;
    if (document.hidden) this.stop();
    else if (!this.raf) this.start();
  };

  private start() {
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.destroyed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
      this.last = now;
      this.step(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth, h = parent.clientHeight;
    if (!w || !h) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.opts.calm) this.drawStatic();
  }

  private get w() { return this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 0; }
  private get h() { return this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 0; }

  /** The y of the fire's base line (CSS px, canvas-local). */
  private baseY() {
    if (this.opts.mode === 'plate' && this.opts.mask) return this.opts.mask.y + this.opts.mask.h;
    return this.h;
  }

  private spawn(kind: P['kind']) {
    const w = this.w, base = this.baseY();
    const rnd = () => hash2(this.seedCounter++, this.time * 60, 3);
    let x: number;
    if (this.opts.mode === 'plate' && this.opts.mask) {
      const m = this.opts.mask;
      const r = rnd();
      if (r < 0.36) { // edge tongues: hug the plate's left/right sides
        x = r < 0.18 ? m.x - 6 + rnd() * m.w * 0.25 : m.x + m.w * 0.75 + rnd() * m.w * 0.25 + 6;
      } else {
        x = m.x - 6 + rnd() * (m.w + 12);
      }
    } else {
      x = rnd() * w;
    }
    if (kind === 'flame') {
      const hBand = this.opts.mode === 'plate'
        ? (this.opts.mask ? this.opts.mask.h * 0.9 + 46 : 90)
        : this.h;
      this.parts.push({
        kind, x, y: base + rnd() * 4, vx: (rnd() - 0.5) * 6, vy: -(0.27 + rnd() * 0.22) * hBand,
        life: 0, maxLife: 0.85 + rnd() * 0.75, size: 0.5 + rnd() * 0.6, phase: rnd() * Math.PI * 2, seed: rnd() * 10,
      });
    } else if (kind === 'ember') {
      this.parts.push({
        kind, x, y: base - rnd() * 6, vx: (rnd() - 0.5) * 14, vy: -(26 + rnd() * 46),
        life: 0, maxLife: 1.4 + rnd() * 1.8, size: 2.2 + rnd() * 3.4, phase: rnd() * Math.PI * 2, seed: rnd() * 10,
      });
    } else if (kind === 'spark') {
      this.parts.push({
        kind, x, y: base - 2, vx: (rnd() - 0.5) * 22, vy: -(120 + rnd() * 130),
        life: 0, maxLife: 0.5 + rnd() * 0.5, size: 1.3 + rnd() * 0.9, phase: 0, seed: rnd() * 10,
      });
    } else {
      const topY = this.opts.mode === 'plate' ? (this.opts.mask ? this.opts.mask.y - 8 : base - 60) : base - this.h * this.params.flameHeight * 0.8;
      this.parts.push({
        kind, x: x + (rnd() - 0.5) * 18, y: topY, vx: 5 + rnd() * 9, vy: -(13 + rnd() * 15),
        life: 0, maxLife: 2.6 + rnd() * 2.2, size: 26 + rnd() * 30, phase: rnd() * Math.PI * 2, seed: rnd() * 10,
      });
    }
    this.counts[kind]++;
  }

  private step(dt: number) {
    this.time += dt;
    const p = this.params;
    const caps: Record<P['kind'], number> = {
      flame: p.particles,
      ember: Math.max(6, Math.round(p.particles * 0.7)),
      spark: 14,
      smoke: 22,
    };
    const rates: Record<P['kind'], number> = { flame: p.spawnPerSec, ember: p.embersPerSec, spark: p.sparksPerSec, smoke: p.smokePerSec };
    (Object.keys(rates) as P['kind'][]).forEach((kind) => {
      this.spawnAcc[kind] += rates[kind] * dt;
      while (this.spawnAcc[kind] >= 1) {
        this.spawnAcc[kind] -= 1;
        if (this.counts[kind] < caps[kind]) this.spawn(kind);
      }
    });
    const swayAmp = 7;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const q = this.parts[i]!;
      q.life += dt;
      if (q.life >= q.maxLife) { this.parts.splice(i, 1); this.counts[q.kind]--; continue; }
      const lf = q.life / q.maxLife;
      if (q.kind === 'flame') {
        q.x += q.vx * dt + Math.sin(this.time * 2.2 + q.phase + q.y * 0.02) * swayAmp * dt * (0.4 + lf);
        q.y += q.vy * dt * (1 + lf * 0.55); // buoyancy accelerates the rise
      } else if (q.kind === 'smoke') {
        q.x += (q.vx + Math.sin(this.time * 0.7 + q.phase) * 5) * dt;
        q.y += q.vy * dt;
      } else {
        q.x += q.vx * dt + Math.sin(this.time * 3 + q.phase) * 6 * dt;
        q.y += q.vy * dt;
        if (q.kind === 'ember') q.vy -= 6 * dt; // embers keep climbing gently
      }
    }
  }

  /** Clip everything to outside the plate rect (plate mode).
   *  Saves the context first — the caller restores in its finally. */
  private clipOutsideMask() {
    const m = this.opts.mode === 'plate' ? this.opts.mask : null;
    if (!m || !this.ctx) return false;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.w, this.h);
    ctx.rect(m.x - 2, m.y - 2, m.w + 4, m.h + 4);
    ctx.clip('evenodd');
    return true;
  }

  private draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.w, h = this.h;
    if (!w || !h) return;
    const spr = sprites();
    const p = this.params;
    const base = this.baseY();
    ctx.clearRect(0, 0, w, h);
    const masked = this.clipOutsideMask();
    try {
      // --- smoke first, normal blending: it must NOT glow
      ctx.globalCompositeOperation = 'source-over';
      for (const q of this.parts) {
        if (q.kind !== 'smoke') continue;
        const lf = q.life / q.maxLife;
        const size = q.size * (0.7 + lf * 1.5);
        ctx.globalAlpha = 0.16 * Math.sin(Math.PI * Math.min(1, lf)) * Math.min(1, p.smokePerSec / 2);
        ctx.drawImage(spr.smoke, q.x - size / 2, q.y - size / 2, size, size);
      }
      // --- base glow, pulsing with the turbulence field
      if (p.glow > 0) {
        const pulse = 0.82 + 0.3 * fbm(this.time * 0.6, 3.7, 5);
        const gw = (this.opts.mode === 'plate' && this.opts.mask ? this.opts.mask.w : w) * (0.62 + p.glow * 0.3);
        const gh = Math.max(26, h * 0.34) * (0.7 + p.glow * 0.5);
        const cx = this.opts.mode === 'plate' && this.opts.mask ? this.opts.mask.x + this.opts.mask.w / 2 : w / 2;
        const g = ctx.createRadialGradient(cx, base, 0, cx, base, gw / 2);
        g.addColorStop(0, `rgba(255,166,66,${(0.44 * p.glow * pulse).toFixed(3)})`);
        g.addColorStop(0.55, `rgba(255,110,26,${(0.2 * p.glow * pulse).toFixed(3)})`);
        g.addColorStop(1, 'rgba(255,90,10,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.translate(cx, base);
        ctx.scale(1, gh / (gw / 2));
        ctx.translate(-cx, -base);
        ctx.fillStyle = g;
        ctx.fillRect(cx - gw / 2, base - gh, gw, gh * 2);
        ctx.restore();
      }
      // --- flame tongues, additive
      ctx.globalCompositeOperation = 'lighter';
      const bandH = this.opts.mode === 'plate'
        ? (this.opts.mask ? this.opts.mask.h * 0.9 + 46 : 90)
        : h;
      for (const q of this.parts) {
        if (q.kind !== 'flame') continue;
        const lf = q.life / q.maxLife;
        const stage = Math.min(3, Math.floor(lf * 4));
        const fh = bandH * p.flameHeight * q.size * (1 - lf * 0.22);
        const fw = fh * (FLAME_W / FLAME_H) * (1 - lf * 0.5) * 0.92; // erosion: tongues narrow as they rise
        // dissolve as a tongue nears the canvas top — flames fade into
        // the air instead of hitting a flat ceiling (plate crowns get
        // the deeper fade: the scorebug lives above the top plate)
        const ceilZone = h * (this.opts.mode === 'plate' ? 0.45 : 0.22);
        const ceilFade = Math.min(1, Math.max(0, (q.y - fh) / Math.max(1, ceilZone)));
        ctx.globalAlpha = Math.min(1, Math.sin(Math.PI * Math.min(1, lf * 1.06)) * 1.15) * 0.6 * ceilFade;
        ctx.drawImage(spr.flames[stage]!, q.x - fw / 2, q.y - fh, fw, fh);
      }
      // --- embers (twinkling) + sparks (streaks), additive
      for (const q of this.parts) {
        if (q.kind === 'ember') {
          const lf = q.life / q.maxLife;
          const tw = 0.5 + 0.5 * Math.sin(this.time * (5 + q.seed) + q.phase * 3);
          ctx.globalAlpha = (1 - lf) * (0.35 + 0.65 * tw);
          const s = q.size * (0.8 + tw * 0.5);
          ctx.drawImage(spr.dot, q.x - s, q.y - s, s * 2, s * 2);
        } else if (q.kind === 'spark') {
          const lf = q.life / q.maxLife;
          ctx.globalAlpha = (1 - lf) * 0.9;
          ctx.strokeStyle = 'rgba(255,214,130,1)';
          ctx.lineWidth = q.size;
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x - q.vx * 0.045, q.y - q.vy * 0.045);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } finally {
      if (masked) ctx.restore();
    }
  }

  /** Calm mode: ONE composed static frame — a gentle glow and a few
   *  still tongues at deterministic spots. No loop, no motion. */
  private drawStatic() {
    const ctx0 = this.ctx;
    if (!ctx0) return;
    const keep = this.parts;
    this.parts = [];
    const p = this.params;
    if (p.glow > 0 || p.particles > 0) {
      const n = Math.max(4, Math.round(p.particles / 6));
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        this.parts.push({
          kind: 'flame', x: (this.opts.mode === 'plate' && this.opts.mask ? this.opts.mask.x + f * this.opts.mask.w : f * this.w),
          y: this.baseY(), vx: 0, vy: 0, life: (i % 4) * 0.22, maxLife: 1, size: 0.55 + (i % 3) * 0.16, phase: i, seed: i,
        });
      }
      for (let i = 0; i < 4; i++) {
        this.parts.push({ kind: 'ember', x: this.w * (0.2 + i * 0.2), y: this.baseY() - 12 - i * 5, vx: 0, vy: 0, life: 0.2, maxLife: 1, size: 2.6, phase: i * 1.3, seed: i });
      }
    }
    ctx0.save();
    this.draw();
    ctx0.restore();
    this.parts = keep;
  }
}
