/**
 * Static spray textures for the transition layer (SprayLayer.tsx).
 *
 * Every texture here is rendered ONCE, lazily, on a small offscreen
 * canvas and handed to the layer as a data URL. The layer then animates
 * only composited CSS properties (transform, opacity, clip-path, SVG
 * stroke-dashoffset) over these still images — nothing in this module
 * ever runs per frame.
 *
 * Why: three generations of the spray layer painted full-screen
 * canvases every frame (v1's swept front, v2's stamp walk, v3's
 * pre-rendered sprites behind per-frame mask composites), and on the
 * owner's iPhone every one dropped frames — iOS Safari cannot
 * composite a 1170x2532 canvas chain at 60 fps, and the dropped frames
 * were the choppiness he kept reporting ("still very choppy and far
 * from smooth", 2026-10-23). Spray is soft by nature, so small
 * textures upscale invisibly; the frame loop is gone entirely.
 *
 * If canvas 2D is unavailable every texture degrades to '' and the
 * layer renders its shapes untextured — the choreography never
 * depends on a texture existing.
 */

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

export interface SprayTextures {
  /** One dab of the can: an opaque core dissolving into speckle. */
  brush: string;
  /** A wide, short speckle band, alpha feathered at its vertical
   *  edges — the wet front that rides the interior fill's clip edge. */
  front: string;
  /** A speckle annulus (transparent inside and out) that straddles
   *  the bloom disc's edge as it expands. */
  ring: string;
  /** Two grain tiles for the reveal's dissolving masks; independent
   *  seeds so the layers' dot fields never align. */
  grainA: string;
  grainB: string;
}

const EMPTY: SprayTextures = { brush: '', front: '', ring: '', grainA: '', grainB: '' };

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  try {
    const c = document.createElement('canvas');
    c.width = Math.max(2, Math.round(w));
    c.height = Math.max(2, Math.round(h));
    const g = c.getContext('2d');
    return g ? [c, g] : null;
  } catch {
    return null;
  }
}

/** One dab of the can: an opaque core dissolving into speckle (the v3
 *  brush recipe, now rendered once into an image instead of being
 *  stamped along a path every frame). */
function buildBrush(): string {
  const made = makeCanvas(160, 160);
  if (!made) return '';
  const [c, g] = made;
  const cx = 80;
  const core = 160 * 0.3;
  const grad = g.createRadialGradient(cx, cx, core * 0.25, cx, cx, core);
  grad.addColorStop(0, 'rgba(7,7,8,0.98)');
  grad.addColorStop(0.75, 'rgba(7,7,8,0.92)');
  grad.addColorStop(1, 'rgba(7,7,8,0.55)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cx, core, 0, TAU);
  g.fill();
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
  return c.toDataURL();
}

/** The interior fill's wet front: speckle whose alpha is windowed to
 *  zero at the strip's top and bottom edges, so wherever the strip
 *  sits over the fill's clip edge, the edge is buried in mist. */
function buildFront(): string {
  const W = 512;
  const H = 128;
  const made = makeCanvas(W, H);
  if (!made) return '';
  const [c, g] = made;
  const rnd = mulberry32(0xf207);
  for (let i = 0; i < 1500; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const window = Math.sin((y / H) * Math.PI); // 0 at the edges, 1 mid-strip
    const a = window * (0.12 + rnd() * 0.68);
    if (a < 0.03) continue;
    g.globalAlpha = a;
    g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
    g.beginPath();
    g.arc(x, y, 0.6 + rnd() * 2.1, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return c.toDataURL();
}

/** The bloom's speckle front: dots in an annulus near the tile's edge,
 *  densest just inside it, thinning outward — drawn on a disc slightly
 *  larger than the solid bloom disc so the band straddles its edge. */
function buildRing(): string {
  const S = 512;
  const made = makeCanvas(S, S);
  if (!made) return '';
  const [c, g] = made;
  const R = S / 2;
  const rnd = mulberry32(0x9156);
  for (let i = 0; i < 1100; i++) {
    const a = rnd() * TAU;
    const rr = R * (0.78 + Math.pow(rnd(), 1.6) * 0.3); // 0.78R .. 1.08R
    const fade = rr <= R ? 0.35 + ((rr / R - 0.78) / 0.22) * 0.6 : Math.max(0, 1 - (rr / R - 1) / 0.08);
    g.globalAlpha = fade * (0.25 + rnd() * 0.65);
    g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
    g.beginPath();
    g.arc(R + Math.cos(a) * rr, R + Math.sin(a) * rr, 0.8 + rnd() * 2.8, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return c.toDataURL();
}

/** A grain tile for the reveal masks: white dots of uneven alpha (the
 *  mask reads alpha), so some specks of paint linger while others
 *  clear early — a dry-paint dissolve instead of a uniform fade. */
function buildGrain(seed: number): string {
  const S = 256;
  const made = makeCanvas(S, S);
  if (!made) return '';
  const [c, g] = made;
  const rnd = mulberry32(seed);
  const dots = Math.round((S * S) / 90);
  for (let i = 0; i < dots; i++) {
    g.globalAlpha = 0.2 + rnd() * 0.8;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(rnd() * S, rnd() * S, 1 + rnd() * 3.6, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return c.toDataURL();
}

let cache: SprayTextures | null = null;

/** The texture set, built on first use and reused for every spray —
 *  the only canvas work in the whole transition, and it happens once. */
export function getSprayTextures(): SprayTextures {
  if (cache) return cache;
  try {
    cache = {
      brush: buildBrush(),
      front: buildFront(),
      ring: buildRing(),
      grainA: buildGrain(0x9a17),
      grainB: buildGrain(0x51d3),
    };
  } catch {
    cache = EMPTY;
  }
  return cache;
}
