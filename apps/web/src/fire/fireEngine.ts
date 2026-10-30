/**
 * Streak-fire renderer (owner, 2026-10-27; stepped up 2026-10-30 —
 * "the heat streak flames look really fake and lazy step it up").
 *
 * The Wave A sprite atlas is GONE. Stamping pre-rendered tongues —
 * however nicely baked — repeats: eight variants cycling by life
 * fraction reads as wallpaper once you watch it for ten seconds. The
 * fire is now a REAL-TIME PROCEDURAL FLAME: a WebGL fragment shader
 * evaluates a rising fbm turbulence field per pixel, so tongues form,
 * merge, tear off and die continuously and never repeat — there is no
 * frame to cycle and no period to spot.
 *
 * How it earns the word:
 *  - Flame body: the fragment shader warps a rising 4-octave value-
 *    noise field (warp grows with height, so tips sway and tear),
 *    shapes it against a height gradient (tongues erode as they
 *    climb), and ramps temperature white-hot at the base → yellow →
 *    orange → deep red at the tips, alpha eroded by the same field.
 *  - Light, not just paint: a warm glow is cast around the base —
 *    across the home band and around the plate's rim/felt — and it
 *    flickers with the SAME noise field and clock that drive the
 *    tongues, so flame and light breathe together. Tier sets its
 *    strength (streakFire.ts `glow`).
 *  - Embers and sparks are procedural point layers in the shader:
 *    per-cell seeded risers with buoyancy, lateral drift and twinkle;
 *    sparks are the same layer stretched and sped up. Smoke is a
 *    second, slower fbm field above the tongues, composited OVER the
 *    fire at low alpha in a warm-gray — it does not glow.
 *  - T4 heat shimmer: at the top tier the warp amplitude above the
 *    tongues grows and the smoke field gets a high-frequency wobble —
 *    the air over the fire visibly churns. (A canvas overlay cannot
 *    refract the page behind it; the shimmer lives in the fire's own
 *    field, honestly, rather than faking a refraction.)
 *  - Tier changes CROSS-FADE exactly as before: setParams snapshots
 *    the displayed tier and blends to the new one over
 *    TIER_CROSSFADE_MS; the shader reads the blended row every frame,
 *    so density, height, glow, embers, sparks and smoke ramp together
 *    and nothing pops. Calm mode never blends: one static frame at the
 *    target tier (a frozen instant of the same field), no loop.
 *  - Plate mode clips EVERY layer out of the plate's rect in the
 *    shader (mask uniform, +2 px margin): the fire burns around and
 *    behind the plate and never paints over name, avatar, or stats.
 *  - SMOLDER is the same shader with the flame body switched off by
 *    its params (streakFire.ts SMOLDER_PARAMS): embers + low glow only.
 *
 * Fallback: if a WebGL context or shader compile is unavailable, a
 * canvas-2D renderer draws the same composition procedurally — an
 * fbm column-silhouette flame with the physical ramp, the same glow,
 * hash-seeded embers — no sprites anywhere on either path. If even a
 * 2D context is unavailable (jsdom, exotic webviews) the effect simply
 * never paints, exactly as before (the marker chip still shows).
 *
 * Performance contract: ONE small WebGL canvas per surface, rendered
 * at FIRE_RENDER_SCALE of the (already DPR-capped) surface size —
 * fire is soft, the upscale is free softness. Surfaces: at most one
 * plate fire in game (the detector arms one seat) + the home band on
 * a different screen, so ≤2 live contexts, each a single full-quad
 * draw. No CPU particle simulation at all — every layer is evaluated
 * in the fragment shader. The loop pauses while the document is
 * hidden; a lost GL context is rebuilt on restore, degrading to the
 * 2D path if the rebuild fails. Deterministic: the start phase and
 * the shader seed derive from the tier row, so every client opens the
 * same fire at the same point in its churn — no unseeded randomness
 * anywhere in the file.
 */
import {
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
  return a + (b - a) * sx + (c - a) * sy + (a - b - c - d) * sx * sy;
}

/** Fractal value noise, 4 octaves, [0,1]. Used by the 2D fallback
 *  renderer and the plate-glow flicker there — the WebGL path runs
 *  the same construction in GLSL. */
export function fbm(x: number, y: number, seed = 0): number {
  let v = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < 4; o++) {
    v += amp * valueNoise(x * f, y * f, seed + o * 13);
    norm += amp; amp *= 0.5; f *= 2.03;
  }
  return v / norm;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/* ------------------------------------------------- shader mapping --- */

/** Everything the fragment shader needs from a tier row, derived in
 *  one auditable place. Pure — the tests pin this mapping. */
export interface FireShaderUniforms {
  /** flame body height in CSS px for this surface */
  flamePx: number;
  /** tongue density/coverage 0..1 (from the particle cap, per mode) */
  dens: number;
  /** 1 when the tier carries flame tongues at all (SMOLDER: 0) */
  flameOn: number;
  /** ember layer density 0..1 */
  ember: number;
  /** spark layer density 0..1 */
  spark: number;
  /** smoke amount 0..1 */
  smoke: number;
  /** base glow strength 0..1 (the tier row's own glow) */
  glow: number;
  /** heat-shimmer amount 0..1 — nonzero only at the top tier(s) */
  shimmer: number;
  /** ceiling-fade ratio: flames dissolve this far from the canvas top
   *  instead of hitting a flat ceiling (plate crowns fade deeper —
   *  the scorebug lives above the top plate) */
  ceil: number;
}

export function shaderUniformsFor(
  params: FireTierParams,
  mode: 'band' | 'plate',
  cssH: number,
  maskH: number,
): FireShaderUniforms {
  const band = mode === 'band';
  return {
    // mirrors the sprite engine's old spawn-band math, so a tier's
    // flames occupy the same stage they always did
    flamePx: band ? cssH * params.flameHeight : (maskH * 0.9 + 46) * params.flameHeight,
    dens: clamp01(params.particles / (band ? 96 : 60)),
    flameOn: params.particles > 0 ? 1 : 0,
    ember: clamp01(params.embersPerSec / (band ? 13 : 9)),
    spark: clamp01(params.sparksPerSec / 2.2),
    smoke: clamp01(params.smokePerSec * 0.22),
    glow: params.glow,
    shimmer: clamp01((params.sparksPerSec - 1.5) / 0.7),
    ceil: band ? 0.22 : 0.45,
  };
}

/** Deterministic start phase derived from the tier row — every client
 *  opens the same fire at the same point in its churn. */
export function fireStartPhase(params: FireTierParams): number {
  return ((params.particles * 7) % 23) * 0.41 + params.flameHeight * 1.7;
}

/** Deterministic shader seed derived from the tier row. */
export function fireSeed(params: FireTierParams): number {
  return ((Math.round(params.particles) * 13) % 29) * 0.613 + params.flameHeight * 2.77 + 1.3;
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

const MAX_DPR = 1.5;
/** The shader renders at this fraction of the DPR-capped surface
 *  size: fire is soft, and the browser's upscale adds free blur. A
 *  home T4 band (430×224 CSS) backs at ≈355×185 on a 3× phone. */
export const FIRE_RENDER_SCALE = 0.55;

interface Renderer {
  /** paint one frame for effect-time t (seconds) with blended params */
  draw: (t: number, params: FireTierParams) => void;
  /** the backing store was resized to (bw, bh) device px */
  resize: (bw: number, bh: number) => void;
  destroy: () => void;
}

export class FireEffect {
  private canvas: HTMLCanvasElement;
  private opts: FireOptions;
  /** the DISPLAYED params — during a tier change this is the cross-fade
   *  blend, so density/height/glow/embers/smoke all read the blended row */
  private params: FireTierParams;
  private fadeFrom: FireTierParams | null = null;
  private fadeTo: FireTierParams;
  private fadeT = 1;
  private renderer: Renderer | null = null;
  private raf = 0;
  private last = 0;
  private elapsed = 0;
  private ro: ResizeObserver | null = null;
  private destroyed = false;

  constructor(canvas: HTMLCanvasElement, params: FireTierParams, opts: FireOptions) {
    this.canvas = canvas;
    this.params = params;
    this.fadeTo = params;
    this.opts = opts;
    this.elapsed = 0;
    this.renderer = this.buildRenderer();
    if (!this.renderer) return;
    this.resize();
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    if (this.ro && canvas.parentElement) this.ro.observe(canvas.parentElement);
    document.addEventListener('visibilitychange', this.onVis);
    if (opts.calm) this.drawStatic();
    else this.start();
  }

  private buildRenderer(): Renderer | null {
    return createGlRenderer(this.canvas, () => this.opts, () => this.rebuildRenderer())
      ?? create2dRenderer(this.canvas, () => this.opts);
  }

  setParams(params: FireTierParams, opts?: Partial<FireOptions>) {
    if (opts) this.opts = { ...this.opts, ...opts };
    if (!this.renderer) { this.params = params; this.fadeTo = params; return; }
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
    document.removeEventListener('visibilitychange', this.onVis);
    this.renderer?.destroy();
    this.renderer = null;
  }

  private onVis = () => {
    if (this.destroyed || this.opts.calm) return;
    if (document.hidden) this.stop();
    else if (!this.raf && this.renderer) this.start();
  };

  private start() {
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.destroyed) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - this.last) / 1000));
      this.last = now;
      this.elapsed += dt;
      if (this.fadeFrom) {
        this.fadeT = Math.min(1, this.fadeT + (dt * 1000) / TIER_CROSSFADE_MS);
        this.params = blendFireParams(this.fadeFrom, this.fadeTo, this.fadeT);
        if (this.fadeT >= 1) this.fadeFrom = null;
      }
      this.renderer?.draw(fireStartPhase(this.fadeTo) + this.elapsed, this.params);
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
    if (!parent || !this.renderer) return;
    const w = parent.clientWidth, h = parent.clientHeight;
    if (!w || !h) return;
    const scale = Math.min(MAX_DPR, window.devicePixelRatio || 1) * FIRE_RENDER_SCALE;
    this.canvas.width = Math.max(2, Math.round(w * scale));
    this.canvas.height = Math.max(2, Math.round(h * scale));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.renderer.resize(this.canvas.width, this.canvas.height);
    if (this.opts.calm) this.drawStatic();
  }

  private get w() { return this.canvas.clientWidth || this.canvas.parentElement?.clientWidth || 0; }
  private get h() { return this.canvas.clientHeight || this.canvas.parentElement?.clientHeight || 0; }

  /** Calm mode: ONE composed static frame — a frozen instant of the
   *  same procedural field at the tier's deterministic start phase.
   *  No loop, no motion. */
  private drawStatic() {
    if (!this.renderer || !this.w || !this.h) return;
    this.renderer.draw(fireStartPhase(this.params), this.params);
  }

  /** A WebGL context was lost and restored (mobile backgrounding):
   *  rebuild the renderer — GL first, 2D if the rebuild fails — and
   *  repaint. Called by the GL renderer's own restore hook. */
  rebuildRenderer() {
    if (this.destroyed) return;
    this.renderer?.destroy();
    this.renderer = this.buildRenderer();
    if (!this.renderer) return;
    this.resize();
    if (this.opts.calm) this.drawStatic();
    else if (!this.raf) this.start();
  }
}

/* ---------------------------------------------------- GLSL sources -- */

const VERT_SRC = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG_SRC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_css;
uniform float u_scale;
uniform float u_time;
uniform float u_seed;
uniform vec4 u_mask;
uniform float u_plate;
uniform float u_baseY;
uniform float u_flamePx;
uniform float u_glow;
uniform float u_dens;
uniform float u_flameOn;
uniform float u_ember;
uniform float u_spark;
uniform float u_smoke;
uniform float u_flick;
uniform float u_ceil;
uniform float u_shimmer;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(19.7, 7.3);
    a *= 0.5;
  }
  return v / 0.9375;
}
vec3 ramp(float t) {
  vec3 col = mix(vec3(0.42, 0.04, 0.0), vec3(0.98, 0.30, 0.02), smoothstep(0.05, 0.35, t));
  col = mix(col, vec3(1.00, 0.62, 0.08), smoothstep(0.35, 0.60, t));
  col = mix(col, vec3(1.00, 0.85, 0.30), smoothstep(0.60, 0.82, t));
  col = mix(col, vec3(1.00, 0.98, 0.90), smoothstep(0.82, 1.05, t));
  return col;
}
/* One rising point layer (embers; sparks = stretched, faster cells).
 * Per-cell seeded: position, rise speed and twinkle all derive from
 * the cell hash — nothing repeats across cells, nothing cycles. */
float emberLayer(vec2 tp, float cellW, float riseH, float speed, float density, float stretch, float seedOff, float baseY, float pointR) {
  float col = floor(tp.x / cellW);
  float h1 = hash21(vec2(col, seedOff));
  /* Plate mode: a column hidden behind the plate would spend its
   * whole rise invisible — its embers escape from the plate's TOP
   * edge instead (that is where the visible fire line is). */
  float base = baseY;
  if (u_plate > 0.5) {
    float colC = (col + 0.5) * cellW;
    if (colC > u_mask.x && colC < u_mask.x + u_mask.z) base = u_mask.y;
  }
  float cyc = fract(u_time * speed * (0.55 + h1 * 0.8) + h1 * 7.31);
  float ex = (col + 0.18 + 0.64 * h1) * cellW + sin(u_time * (1.3 + h1 * 2.2) + h1 * 43.7) * 4.5 * cyc;
  float ey = base - cyc * riseH;
  vec2 d = vec2(tp.x - ex, (tp.y - ey) * stretch);
  float tw = 0.68 + 0.32 * sin(u_time * (5.0 + h1 * 5.0) + h1 * 81.0);
  float fade = (1.0 - cyc) * (1.0 - cyc);
  return smoothstep(pointR, pointR * 0.24, length(d)) * tw * fade * step(h1, density);
}

void main() {
  vec2 tp = vec2(gl_FragCoord.x / u_scale, u_css.y - gl_FragCoord.y / u_scale);
  float relY = u_baseY - tp.y;
  float flamePx = max(u_flamePx, 1.0);
  float hn = relY / flamePx;

  /* span: band burns full-width; plate flames live on the plate's span */
  float span = 1.0;
  float spanC = u_css.x * 0.5;
  float spanHW = u_css.x * 0.5;
  if (u_plate > 0.5) {
    spanC = u_mask.x + u_mask.z * 0.5;
    spanHW = u_mask.z * 0.5 + 6.0;
    float sd = abs(tp.x - spanC) / max(spanHW, 1.0);
    span = smoothstep(1.25, 0.8, sd);
  }

  /* one flicker for flame AND light — same field, same clock */
  float flickN = fbm(vec2(u_time * 0.75, u_seed * 1.71));
  float flick = u_flick * (0.84 + 0.34 * flickN);

  /* ---- flame body: warped rising turbulence, eroded by height ---- */
  float hnC = clamp(hn, 0.0, 1.6);
  float warpAmp = min(10.0 + 30.0 * hnC, 6.0 + 0.30 * u_flamePx * hnC) * (1.0 + u_shimmer * 0.7 * smoothstep(0.45, 1.15, hn));
  float wob = fbm(vec2(tp.x * 0.021 + u_seed, relY * 0.021 - u_time * 0.65));
  float wx = tp.x + (wob - 0.5) * warpAmp;
  float rise = 2.2 + 0.9 * u_dens;
  float f = fbm(vec2(wx * 0.052 + u_seed * 3.17, relY * 0.040 - u_time * rise));
  float shape = f * 1.42 - hn * 0.68 + (u_dens - 0.45) * 0.22 + 0.14 * (1.0 - clamp(hn, 0.0, 1.0));
  float body = smoothstep(0.27, 0.54, shape) * u_flameOn;
  float temp = clamp(shape * 1.30 + (1.0 - clamp(hn, 0.0, 1.0)) * 0.34, 0.0, 1.3);
  float ceilFade = clamp(tp.y / max(u_css.y * u_ceil, 1.0), 0.0, 1.0);
  float flameA = body * 0.88 * span * ceilFade * smoothstep(-2.0, 2.0, relY);
  vec3 col = ramp(temp) * (flameA * flick * 1.15);
  float alpha = flameA;

  /* ---- light cast: warm glow around the base, same flicker ------- */
  float glowI;
  if (u_plate > 0.5) {
    vec2 gd = vec2((tp.x - spanC) / (spanHW * 2.1), (tp.y - u_baseY) / (u_css.y * 0.85));
    glowI = exp(-dot(gd, gd) * 2.4);
  } else {
    float gy = clamp((u_css.y - tp.y) / max(u_css.y * 0.85, 1.0), 0.0, 1.0);
    float lat = 0.7 + 0.5 * fbm(vec2(tp.x * 0.012, u_time * 0.45 + u_seed));
    glowI = pow(gy, 1.7) * lat;
  }
  float glowA = glowI * u_glow * 0.42 * flick;
  col += vec3(1.0, 0.50, 0.13) * glowA;
  alpha = max(alpha, glowA);

  /* ---- embers + sparks ------------------------------------------- */
  float riseH = max(flamePx * 1.5, u_css.y * 0.30) + 26.0;
  float emb = emberLayer(tp, 30.0, riseH, 0.16, u_ember, 1.0, u_seed * 7.0 + 1.0, u_baseY, 4.6);
  float emb2 = emberLayer(tp, 17.0, riseH * 0.8, 0.11, u_ember * 0.55, 1.0, u_seed * 19.0 + 3.0, u_baseY, 2.4);
  float spk = emberLayer(tp, 54.0, riseH * 1.25, 0.42, u_spark * 0.5, 0.22, u_seed * 13.0 + 5.0, u_baseY, 3.0);
  float eA = (emb * 1.0 + emb2 * 0.7 + spk * 0.95) * span * clamp(tp.y / max(u_css.y * u_ceil, 1.0), 0.55, 1.0);
  col += vec3(1.0, 0.78, 0.42) * eA * (0.95 + 0.5 * flickN);
  alpha = max(alpha, clamp(eA, 0.0, 1.0));

  /* ---- smoke: a slower field ABOVE the tongues, never glowing ---- */
  if (u_smoke > 0.003) {
    float zone = smoothstep(0.45, 1.0, hn) * (1.0 - smoothstep(1.6, 2.6, hn));
    vec2 sp = tp * 0.020 + vec2(u_seed * 5.0 - u_time * 0.045, -u_time * 0.22);
    sp.x += (fbm(tp * 0.03 + u_time * 0.05) - 0.5) * (0.6 + u_shimmer * 0.9) * zone * 3.0;
    float s = fbm(sp);
    float smokeA = u_smoke * zone * smoothstep(0.42, 0.78, s) * 0.16 * span;
    vec3 smokeCol = mix(vec3(0.36, 0.33, 0.32), vec3(0.55, 0.38, 0.26), (1.0 - clamp(hn, 0.0, 1.0)) * 0.6);
    col = smokeCol * smokeA + col * (1.0 - smokeA);
    alpha = smokeA + alpha * (1.0 - smokeA);
  }

  /* ---- plate clip: NOTHING paints inside the plate rect (+2 px) -- */
  if (u_plate > 0.5) {
    vec2 q = tp - u_mask.xy;
    if (q.x > -2.0 && q.y > -2.0 && q.x < u_mask.z + 2.0 && q.y < u_mask.w + 2.0) {
      col = vec3(0.0);
      alpha = 0.0;
    }
  }

  /* ---- edge falloff: cast light never traces the canvas rect ----- */
  float edge = smoothstep(0.0, u_css.x * 0.07, tp.x) * smoothstep(u_css.x, u_css.x * 0.93, tp.x)
    * smoothstep(0.0, u_css.y * 0.06, tp.y);
  if (u_plate > 0.5) edge *= smoothstep(u_css.y, u_css.y * 0.90, tp.y);
  col *= edge;
  alpha *= edge;
  gl_FragColor = vec4(col, alpha);
}
`;

/* -------------------------------------------------- WebGL renderer -- */

function createGlRenderer(
  canvas: HTMLCanvasElement,
  getOpts: () => FireOptions,
  onRestore: () => void,
): Renderer | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    gl = (canvas.getContext('webgl', {
      alpha: true, antialias: false, depth: false, stencil: false,
      powerPreference: 'low-power',
    }) as WebGLRenderingContext | null) ?? null;
  } catch { gl = null; }
  if (!gl) return null;

  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = gl!.createShader(type);
    if (!sh) return null;
    gl!.shaderSource(sh, src);
    gl!.compileShader(sh);
    if (!gl!.getShaderParameter(sh, gl!.COMPILE_STATUS)) { gl!.deleteShader(sh); return null; }
    return sh;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  const U = (name: string) => gl!.getUniformLocation(prog, name);
  const u = {
    css: U('u_css'), scale: U('u_scale'), time: U('u_time'), seed: U('u_seed'),
    mask: U('u_mask'), plate: U('u_plate'), baseY: U('u_baseY'), flamePx: U('u_flamePx'),
    glow: U('u_glow'), dens: U('u_dens'), flameOn: U('u_flameOn'), ember: U('u_ember'),
    spark: U('u_spark'), smoke: U('u_smoke'), flick: U('u_flick'), ceil: U('u_ceil'),
    shimmer: U('u_shimmer'),
  };

  let bw = 0, bh = 0;
  let lost = false;
  const onLost = (e: Event) => { e.preventDefault(); lost = true; };
  const onRestored = () => { onRestore(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  return {
    resize(w, h) {
      bw = w; bh = h;
      if (!lost) gl!.viewport(0, 0, w, h);
    },
    draw(t, params) {
      if (lost || !bw || !bh) return;
      const opts = getOpts();
      const parent = canvas.parentElement;
      const cssW = canvas.clientWidth || parent?.clientWidth || 0;
      const cssH = canvas.clientHeight || parent?.clientHeight || 0;
      if (!cssW || !cssH) return;
      const mask = opts.mode === 'plate' ? opts.mask ?? null : null;
      const uni = shaderUniformsFor(params, opts.mode, cssH, mask?.h ?? 0);
      const baseY = mask ? mask.y + mask.h : cssH;
      const g = gl!;
      g.uniform2f(u.css, cssW, cssH);
      g.uniform1f(u.scale, bw / cssW);
      g.uniform1f(u.time, t);
      g.uniform1f(u.seed, fireSeed(params));
      g.uniform4f(u.mask, mask?.x ?? 0, mask?.y ?? 0, mask?.w ?? 0, mask?.h ?? 0);
      g.uniform1f(u.plate, opts.mode === 'plate' ? 1 : 0);
      g.uniform1f(u.baseY, baseY);
      g.uniform1f(u.flamePx, uni.flamePx);
      g.uniform1f(u.glow, uni.glow);
      g.uniform1f(u.dens, uni.dens);
      g.uniform1f(u.flameOn, uni.flameOn);
      g.uniform1f(u.ember, uni.ember);
      g.uniform1f(u.spark, uni.spark);
      g.uniform1f(u.smoke, uni.smoke);
      // band surfaces breathe at the menu's idle rate (the 4 s swell is
      // a shipped contract); plate surfaces flicker on shader noise
      g.uniform1f(u.flick, opts.mode === 'band' ? homeBreatheFactor(t * 1000) : 1);
      g.uniform1f(u.ceil, uni.ceil);
      g.uniform1f(u.shimmer, uni.shimmer);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
    },
    destroy() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      // the canvas owns the context — a successor renderer on the same
      // canvas re-acquires it and recompiles; nothing to release here
    },
  };
}

/* ------------------------------------------- canvas-2D fallback ----- */

/**
 * The no-WebGL path: the same composition drawn procedurally in 2D —
 * an fbm column-silhouette flame (each column's tongue height and
 * erosion read the same rising field family), the physical color ramp
 * as a vertical gradient, the base glow, hash-seeded ember points, and
 * the evenodd plate clip. No sprites, no atlas.
 */
function create2dRenderer(canvas: HTMLCanvasElement, getOpts: () => FireOptions): Renderer | null {
  let ctx: CanvasRenderingContext2D | null = null;
  try { ctx = canvas.getContext('2d'); } catch { ctx = null; }
  if (!ctx) return null;
  const c = ctx;

  const cssSize = () => ({
    w: canvas.clientWidth || canvas.parentElement?.clientWidth || 0,
    h: canvas.clientHeight || canvas.parentElement?.clientHeight || 0,
  });

  return {
    resize() { /* the 2D path draws in device px via the transform below */ },
    draw(t, params) {
      const { w, h } = cssSize();
      if (!w || !h) return;
      const opts = getOpts();
      const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const mask = opts.mode === 'plate' ? opts.mask ?? null : null;
      const uni = shaderUniformsFor(params, opts.mode, h, mask?.h ?? 0);
      const base = mask ? mask.y + mask.h : h;
      const seed = fireSeed(params);
      const flick = (opts.mode === 'band' ? homeBreatheFactor(t * 1000) : 1) * (0.84 + 0.34 * fbm(t * 0.75, seed * 1.71, 5));
      c.clearRect(0, 0, w, h);
      c.save();
      if (mask) {
        c.beginPath();
        c.rect(0, 0, w, h);
        c.rect(mask.x - 2, mask.y - 2, mask.w + 4, mask.h + 4);
        c.clip('evenodd');
      }
      try {
        // base glow — the light cast, pulsing with the flame's noise
        if (uni.glow > 0) {
          const cx = mask ? mask.x + mask.w / 2 : w / 2;
          const gw = (mask ? mask.w : w) * (0.62 + uni.glow * 0.3);
          const gh = Math.max(26, h * 0.34) * (0.7 + uni.glow * 0.5);
          const g = c.createRadialGradient(cx, base, 0, cx, base, gw / 2);
          g.addColorStop(0, `rgba(255,166,66,${(0.44 * uni.glow * flick).toFixed(3)})`);
          g.addColorStop(0.55, `rgba(255,110,26,${(0.2 * uni.glow * flick).toFixed(3)})`);
          g.addColorStop(1, 'rgba(255,90,10,0)');
          c.globalCompositeOperation = 'lighter';
          c.save();
          c.translate(cx, base);
          c.scale(1, gh / (gw / 2));
          c.translate(-cx, -base);
          c.fillStyle = g;
          c.fillRect(cx - gw / 2, base - gh, gw, gh * 2);
          c.restore();
          c.globalCompositeOperation = 'source-over';
        }
        // flame silhouette: per-column tongue heights from the field
        if (uni.flameOn > 0 && uni.flamePx > 1) {
          const x0 = mask ? mask.x - 6 : 0;
          const x1 = mask ? mask.x + mask.w + 6 : w;
          const step = 3;
          const grad = c.createLinearGradient(0, base, 0, base - uni.flamePx);
          grad.addColorStop(0, 'rgba(255,244,214,0.95)');
          grad.addColorStop(0.25, 'rgba(255,196,64,0.9)');
          grad.addColorStop(0.55, 'rgba(255,110,20,0.75)');
          grad.addColorStop(0.85, 'rgba(190,30,2,0.4)');
          grad.addColorStop(1, 'rgba(120,10,0,0)');
          c.globalCompositeOperation = 'lighter';
          c.fillStyle = grad;
          c.beginPath();
          c.moveTo(x0, base);
          for (let x = x0; x <= x1; x += step) {
            const n = fbm(x * 0.052 + seed * 3.17, -t * (2.2 + 0.9 * uni.dens), seed);
            const n2 = fbm(x * 0.013 + seed, -t * 0.9, seed + 4);
            const th = uni.flamePx * Math.max(0, (n * 1.25 + n2 * 0.35 - 0.42)) * (0.75 + uni.dens * 0.35) * flick;
            c.lineTo(x, base - th);
          }
          c.lineTo(x1, base);
          c.closePath();
          c.globalAlpha = 0.85;
          c.fill();
          c.globalAlpha = 1;
          c.globalCompositeOperation = 'source-over';
        }
        // embers: hash-seeded risers, twinkling, drifting
        const emberN = Math.round(uni.ember * 26);
        for (let i = 0; i < emberN; i++) {
          const s1 = hash2(i * 3 + 1, i * 7 + 1, seed);
          const s2 = hash2(i * 5 + 2, i * 11 + 3, seed);
          const cyc = (t * (0.10 + s1 * 0.12) + s1 * 7.31) % 1;
          const x = (mask ? mask.x - 4 : 0) + s2 * ((mask ? mask.w + 8 : w));
          const y = base - cyc * (uni.flamePx * 1.5 + 26);
          const tw = 0.55 + 0.45 * Math.sin(t * (5 + s1 * 5) + s1 * 81);
          c.globalAlpha = (1 - cyc) * (0.3 + 0.7 * tw) * 0.9;
          c.fillStyle = 'rgb(255,199,107)';
          c.beginPath();
          c.arc(x + Math.sin(t * 1.6 + s1 * 43) * 4 * cyc, y, 1.4 + s1 * 1.4, 0, Math.PI * 2);
          c.fill();
        }
        c.globalAlpha = 1;
      } finally {
        c.restore();
      }
    },
    destroy() { /* nothing held */ },
  };
}
