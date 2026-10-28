/**
 * Streak-fire renderer (owner, 2026-10-27 — "more photorealistic" than
 * the flat brushstroke-gradient sample he pasted).
 *
 * Wave A rebuild (animation replacement program rows 60–61 + §D): the
 * runtime sprite baking is GONE. Every tongue, puff and core now comes
 * from ONE pre-rendered sprite atlas (streakFire.ts STREAK_FIRE_ATLAS,
 * public/assets/fire/streak-fire-atlas.webp), generated offline by a
 * deterministic script porting this engine's original fbm-eroded
 * tongue math — teardrop body, turbulence-eroded edge, the physical
 * white-hot → yellow → orange → deep-red → transparent ramp, four life
 * stages (young/full → old/pinched/detached) × eight variants. A live
 * particle picks its atlas frame as a pure function of (life fraction,
 * variant), so the fire is a seekable composition: same streak, same
 * frames, every client.
 *
 * How it earns the word:
 *  - Flame tongues are atlas sprites: a particle cross-picks its life
 *    stage as it ages, narrows and shortens as it rises (erosion), and
 *    detaches as its tip fades.
 *  - Smoke is a separate noisy puff frame from the atlas strip, drawn
 *    with NORMAL blending at low alpha, rising slower and expanding —
 *    it reads as smoke because it does not glow.
 *  - Flames + embers + sparks draw with additive ('lighter') blending;
 *    embers (the atlas's hot ember core) twinkle individually; sparks
 *    are fast thin streaks.
 *  - A warm radial glow sits at the base — plate mode pulses it with
 *    the same noise field that sways the tongues (turbulence flicker);
 *    band (home) mode instead BREATHES it at the menu's idle rate
 *    (streakFire.ts homeBreatheFactor, 4 s period).
 *  - Tier changes CROSS-FADE: setParams snapshots the displayed tier
 *    and blends to the new one over TIER_CROSSFADE_MS, so a streak
 *    stepping up — or breaking — ramps spawn, cap, height and glow
 *    together and nothing pops. Calm mode never blends: the static
 *    frame is the target tier immediately (the calm contract).
 *  - Plate mode clips every layer to OUTSIDE the plate's rect: the fire
 *    burns around and behind the plate, licking above its top edge, and
 *    never paints over the name, avatar, or stats on it.
 *  - If the atlas fails to load, the surface degrades to the base glow
 *    only — no substitute fire is invented.
 *
 * Performance contract: ONE canvas per surface, ONE shared atlas image
 * per page, particle caps come from the tier table (streakFire.ts),
 * DPR capped at 1.5, the loop pauses while the document is hidden, and
 * all particle math is plain floats. Deterministic: the start phase is
 * derived from the tier size and every spawn reads a seeded hash — no
 * unseeded randomness anywhere in the file.
 */
import {
  STREAK_FIRE_ATLAS, atlasEmberFrame, atlasFlameFrame, atlasGlowFrame, atlasSmokeFrame,
  blendFireParams, homeBreatheFactor, TIER_CROSSFADE_MS,
  type FireTierParams,
} from '../streakFire';

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

/** Fractal value noise, 4 octaves, [0,1]. (Now used only for the
 *  plate-mode glow flicker and spawn hashing — the tongue silhouettes
 *  themselves are baked into the atlas.) */
export function fbm(x: number, y: number, seed = 0): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    v += amp * valueNoise(x * f, y * f, seed + o * 13);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm;
}

/* ------------------------------------------------------------- atlas -- */

/** The one shared atlas image for the whole page, loaded lazily by the
 *  first fire surface that mounts. Calm surfaces repaint once when it
 *  decodes; a load failure leaves every surface at base-glow only. */
let _atlas: HTMLImageElement | null = null;
let _atlasReady = false;
const _atlasListeners = new Set<() => void>();

function atlasImage(): HTMLImageElement | null {
  if (_atlas || typeof Image === 'undefined') return _atlas;
  const img = new Image();
  _atlas = img;
  img.onload = () => { _atlasReady = true; _atlasListeners.forEach((f) => f()); };
  img.onerror = () => { _atlasReady = false; };
  img.src = STREAK_FIRE_ATLAS.url;
  return img;
}

/** The atlas image once it has loaded, else null (not yet / failed). */
function atlasReady(): HTMLImageElement | null {
  return _atlasReady && _atlas && _atlas.naturalWidth > 0 ? _atlas : null;
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
  /** atlas variant column for this particle (frame = f(life, variant)) */
  variant: number;
}

const MAX_DPR = 1.5;

export class FireEffect {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private opts: FireOptions;
  /** the DISPLAYED params — during a tier change this is the cross-fade
   *  blend, so caps/spawn/height/glow all read the blended row */
  private params: FireTierParams;
  private fadeFrom: FireTierParams | null = null;
  private fadeTo: FireTierParams;
  private fadeT = 1;
  private parts: P[] = [];
  private counts: Record<P['kind'], number> = { flame: 0, ember: 0, spark: 0, smoke: 0 };
  private raf = 0;
  private last = 0;
  private time = 0;
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
    this.fadeTo = params;
    this.opts = opts;
    // Deterministic start phase derived from the tier size — every
    // client opens the same fire at the same point in its sway.
    this.time = ((params.particles * 7) % 23) * 0.41 + params.flameHeight * 1.7;
    if (!this.ctx) return;
    atlasImage();
    _atlasListeners.add(this.onAtlas);
    this.resize();
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    if (this.ro && canvas.parentElement) this.ro.observe(canvas.parentElement);
    document.addEventListener('visibilitychange', this.onVis);
    if (opts.calm) this.drawStatic();
    else this.start();
  }

  /** The atlas decoded after this surface mounted: a calm surface
   *  repaints its one static frame with the real frames in it. */
  private onAtlas = () => {
    if (this.destroyed) return;
    if (this.opts.calm) this.drawStatic();
  };

  setParams(params: FireTierParams, opts?: Partial<FireOptions>) {
    if (opts) this.opts = { ...this.opts, ...opts };
    if (!this.ctx) { this.params = params; this.fadeTo = params; return; }
    if (this.opts.calm) {
      // calm never blends — the static frame IS the target tier
      this.fadeFrom = null;
      this.fadeTo = params;
      this.fadeT = 1;
      this.params = params;
      this.stop();
      this.drawStatic();
      return;
    }
    if (params !== this.fadeTo) {
      // cross-fade: snapshot what is on screen now, blend to the new tier
      this.fadeFrom = this.params;
      this.fadeTo = params;
      this.fadeT = 0;
      this.params = blendFireParams(this.fadeFrom, this.fadeTo, 0);
    }
    if (!this.raf) this.start();
  }

  destroy() {
    this.destroyed = true;
    this.stop();
    this.ro?.disconnect();
    _atlasListeners.delete(this.onAtlas);
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
        variant: Math.floor(rnd() * STREAK_FIRE_ATLAS.flameVariants),
      });
    } else if (kind === 'ember') {
      this.parts.push({
        kind, x, y: base - rnd() * 6, vx: (rnd() - 0.5) * 14, vy: -(26 + rnd() * 46),
        life: 0, maxLife: 1.4 + rnd() * 1.8, size: 2.2 + rnd() * 3.4, phase: rnd() * Math.PI * 2, seed: rnd() * 10,
        variant: 0,
      });
    } else if (kind === 'spark') {
      this.parts.push({
        kind, x, y: base - 2, vx: (rnd() - 0.5) * 22, vy: -(120 + rnd() * 130),
        life: 0, maxLife: 0.5 + rnd() * 0.5, size: 1.3 + rnd() * 0.9, phase: 0, seed: rnd() * 10,
        variant: 0,
      });
    } else {
      const topY = this.opts.mode === 'plate' ? (this.opts.mask ? this.opts.mask.y - 8 : base - 60) : base - this.h * this.params.flameHeight * 0.8;
      this.parts.push({
        kind, x: x + (rnd() - 0.5) * 18, y: topY, vx: 5 + rnd() * 9, vy: -(13 + rnd() * 15),
        life: 0, maxLife: 2.6 + rnd() * 2.2, size: 26 + rnd() * 30, phase: rnd() * Math.PI * 2, seed: rnd() * 10,
        variant: Math.floor(rnd() * STREAK_FIRE_ATLAS.smokeVariants),
      });
    }
    this.counts[kind]++;
  }

  private step(dt: number) {
    this.time += dt;
    // tier cross-fade: advance the blend; the displayed row (caps,
    // rates, height, glow) is the blend, so nothing pops either way
    if (this.fadeFrom) {
      this.fadeT = Math.min(1, this.fadeT + (dt * 1000) / TIER_CROSSFADE_MS);
      this.params = blendFireParams(this.fadeFrom, this.fadeTo, this.fadeT);
      if (this.fadeT >= 1) this.fadeFrom = null;
    }
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
    const spr = atlasReady();
    const p = this.params;
    const base = this.baseY();
    // band (home) surfaces breathe at the menu's idle rate; plate
    // surfaces keep the turbulence flicker on the glow instead
    const breathe = this.opts.mode === 'band' ? homeBreatheFactor(this.time * 1000) : 1;
    ctx.clearRect(0, 0, w, h);
    const masked = this.clipOutsideMask();
    try {
      // --- smoke first, normal blending: it must NOT glow
      if (spr) {
        ctx.globalCompositeOperation = 'source-over';
        for (const q of this.parts) {
          if (q.kind !== 'smoke') continue;
          const lf = q.life / q.maxLife;
          const frame = atlasSmokeFrame(lf, q.variant);
          const size = q.size * (0.7 + lf * 1.5);
          ctx.globalAlpha = 0.16 * Math.sin(Math.PI * Math.min(1, lf)) * Math.min(1, p.smokePerSec / 2);
          ctx.drawImage(spr, frame.x, frame.y, frame.w, frame.h, q.x - size / 2, q.y - size / 2, size, size);
        }
      }
      // --- base glow, pulsing: the one layer that survives an
      // atlas-load failure (the degradation floor — glow only)
      if (p.glow > 0) {
        const pulse = this.opts.mode === 'band' ? breathe : 0.82 + 0.3 * fbm(this.time * 0.6, 3.7, 5);
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
        // the atlas's baked glow dot, laid under the tongues' feet
        if (spr) {
          const frame = atlasGlowFrame();
          const s = gw * 0.55;
          ctx.globalAlpha = 0.5 * p.glow * pulse;
          ctx.drawImage(spr, frame.x, frame.y, frame.w, frame.h, cx - s / 2, base - s / 2, s, s);
          ctx.globalAlpha = 1;
        }
      }
      if (spr) {
        // --- flame tongues, additive: frame = f(life, variant)
        ctx.globalCompositeOperation = 'lighter';
        const bandH = this.opts.mode === 'plate'
          ? (this.opts.mask ? this.opts.mask.h * 0.9 + 46 : 90)
          : h;
        for (const q of this.parts) {
          if (q.kind !== 'flame') continue;
          const lf = q.life / q.maxLife;
          const frame = atlasFlameFrame(lf, q.variant);
          const fh = bandH * p.flameHeight * q.size * (1 - lf * 0.22) * breathe;
          const fw = fh * (frame.w / frame.h) * (1 - lf * 0.5) * 0.92; // erosion: tongues narrow as they rise
          // dissolve as a tongue nears the canvas top — flames fade into
          // the air instead of hitting a flat ceiling (plate crowns get
          // the deeper fade: the scorebug lives above the top plate)
          const ceilZone = h * (this.opts.mode === 'plate' ? 0.45 : 0.22);
          const ceilFade = Math.min(1, Math.max(0, (q.y - fh) / Math.max(1, ceilZone)));
          ctx.globalAlpha = Math.min(1, Math.sin(Math.PI * Math.min(1, lf * 1.06)) * 1.15) * 0.6 * ceilFade;
          ctx.drawImage(spr, frame.x, frame.y, frame.w, frame.h, q.x - fw / 2, q.y - fh, fw, fh);
        }
        // --- embers (twinkling cores) + sparks (streaks), additive
        const emberFrame = atlasEmberFrame();
        for (const q of this.parts) {
          if (q.kind === 'ember') {
            const lf = q.life / q.maxLife;
            const tw = 0.5 + 0.5 * Math.sin(this.time * (5 + q.seed) + q.phase * 3);
            ctx.globalAlpha = (1 - lf) * (0.35 + 0.65 * tw);
            const s = q.size * (0.8 + tw * 0.5);
            ctx.drawImage(spr, emberFrame.x, emberFrame.y, emberFrame.w, emberFrame.h, q.x - s, q.y - s, s * 2, s * 2);
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
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    } finally {
      if (masked) ctx.restore();
    }
  }

  /** Calm mode: ONE composed static frame — a gentle glow and a few
   *  still tongues (atlas frames at deterministic spots/variants).
   *  No loop, no motion. Repaints once when the atlas decodes. */
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
          variant: i % STREAK_FIRE_ATLAS.flameVariants,
        });
      }
      for (let i = 0; i < 4; i++) {
        this.parts.push({ kind: 'ember', x: this.w * (0.2 + i * 0.2), y: this.baseY() - 12 - i * 5, vx: 0, vy: 0, life: 0.2, maxLife: 1, size: 2.6, phase: i * 1.3, seed: i, variant: 0 });
      }
    }
    ctx0.save();
    this.draw();
    ctx0.restore();
    this.parts = keep;
  }
}
