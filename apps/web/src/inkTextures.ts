/**
 * Static ink textures for the Ink Bloom transition (SprayLayer.tsx's
 * Neon skin of the spray program).
 *
 * Same discipline as sprayTextures.ts: every texture is rendered
 * ONCE, lazily, on a small offscreen canvas and handed to the layer
 * as a data URL; the layer animates only composited properties over
 * these stills. Nothing here ever runs per frame — the Neon ink the
 * game already ships (ink/) proved the look; this module carries its
 * palette (midnight navy, violet, electric blue, cyan) in the
 * transition's own static-texture idiom.
 *
 * If canvas 2D is unavailable every texture degrades to '' and the
 * layer renders its shapes untextured — the choreography never
 * depends on a texture existing.
 */

const PALETTE = ['#8054FF', '#269CFF', '#5BDFFF', '#6a3df0'] as const;
const TAU = Math.PI * 2;

/** Deterministic RNG so the ink is the same pour, every time. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14) >>> 0) / 4294967296);
  };
}

export interface InkTextures {
  /** One drop of ink at the nozzle: a violet core bleeding blue. */
  brush: string;
  /** A wide, short speckle band, alpha feathered at its edges — the
   *  wet front that rides the interior fill's clip edge. */
  front: string;
  /** A speckle annulus that straddles the bloom disc's edge. */
  ring: string;
  /** Two grain tiles for the reveal's dissolving masks. */
  grainA: string;
  grainB: string;
  /** Soft ink blobs (violet / blue / cyan) on transparency — the
   *  spade's ink overlay and the curling blooms at its lobes. */
  splats: string;
}

const EMPTY: InkTextures = { brush: '', front: '', ring: '', grainA: '', grainB: '', splats: '' };

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

/** One drop of ink: a saturated violet heart, an electric-blue bleed,
 *  and a scatter of satellite droplets — the nozzle dab's face. */
function buildBrush(): string {
  const made = makeCanvas(160, 160);
  if (!made) return '';
  const [c, g] = made;
  const cx = 80;
  const core = 160 * 0.3;
  const grad = g.createRadialGradient(cx, cx, core * 0.15, cx, cx, core);
  grad.addColorStop(0, 'rgba(128,84,255,0.95)');
  grad.addColorStop(0.55, 'rgba(38,156,255,0.75)');
  grad.addColorStop(1, 'rgba(91,223,255,0.25)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cx, core, 0, TAU);
  g.fill();
  const rnd = mulberry32(0x1b10);
  for (let i = 0; i < 120; i++) {
    const a = rnd() * TAU;
    const rr = core * (0.5 + Math.pow(rnd(), 1.5) * 0.8);
    g.globalAlpha = Math.max(0.05, 0.7 - (rr / (core * 1.5)) * 0.65) * (0.4 + rnd() * 0.6);
    g.fillStyle = PALETTE[(rnd() * PALETTE.length) | 0]!;
    g.beginPath();
    g.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, 0.5 + rnd() * 1.3, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return c.toDataURL();
}

/** The interior fill's wet front: neon speckle windowed to zero at
 *  the strip's edges, burying the clip edge in ink mist. */
function buildFront(): string {
  const W = 512;
  const H = 128;
  const made = makeCanvas(W, H);
  if (!made) return '';
  const [c, g] = made;
  const rnd = mulberry32(0x1f20);
  for (let i = 0; i < 800; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const window = Math.sin((y / H) * Math.PI);
    const a = window * (0.1 + rnd() * 0.4);
    if (a < 0.03) continue;
    g.globalAlpha = a;
    g.fillStyle = PALETTE[(rnd() * PALETTE.length) | 0]!;
    g.beginPath();
    g.arc(x, y, 0.5 + rnd() * 1.3, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return c.toDataURL();
}

/** The bloom's front: neon dots in a thin annulus near the tile's
 *  edge, straddling the ink disc's expanding rim. */
function buildRing(): string {
  const S = 512;
  const made = makeCanvas(S, S);
  if (!made) return '';
  const [c, g] = made;
  const R = S / 2;
  const rnd = mulberry32(0x1a56);
  for (let i = 0; i < 650; i++) {
    const a = rnd() * TAU;
    const rr = R * (0.86 + Math.pow(rnd(), 1.6) * 0.18); // 0.86R .. 1.04R
    const fade = rr <= R ? 0.3 + ((rr / R - 0.86) / 0.14) * 0.6 : Math.max(0, 1 - (rr / R - 1) / 0.04);
    g.globalAlpha = fade * (0.25 + rnd() * 0.55);
    g.fillStyle = PALETTE[(rnd() * PALETTE.length) | 0]!;
    g.beginPath();
    g.arc(R + Math.cos(a) * rr, R + Math.sin(a) * rr, 0.6 + rnd() * 1.6, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return c.toDataURL();
}

/** A grain tile for the reveal masks: white dots of uneven alpha
 *  (the mask reads alpha) — the ink dissipates, it doesn't fade
 *  uniformly. */
function buildGrain(seed: number): string {
  const S = 256;
  const made = makeCanvas(S, S);
  if (!made) return '';
  const [c, g] = made;
  const rnd = mulberry32(seed);
  const dots = Math.round((S * S) / 150);
  for (let i = 0; i < dots; i++) {
    g.globalAlpha = 0.25 + rnd() * 0.65;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(rnd() * S, rnd() * S, 0.7 + rnd() * 2, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return c.toDataURL();
}

/** The ink's body: a dozen soft blobs poured over one tile — violet
 *  hearts, blue mid-tones, cyan rims — each a radial gradient with a
 *  ragged satellite scatter, so a scaled-up overlay reads as ink
 *  blooming in water rather than a flat tint. */
function buildSplats(): string {
  const S = 512;
  const made = makeCanvas(S, S);
  if (!made) return '';
  const [c, g] = made;
  const rnd = mulberry32(0x5107);
  for (let i = 0; i < 14; i++) {
    const x = rnd() * S;
    const y = rnd() * S;
    const r = 40 + rnd() * 110;
    const col = PALETTE[(rnd() * PALETTE.length) | 0]!;
    const grad = g.createRadialGradient(x, y, r * 0.1, x, y, r);
    grad.addColorStop(0, col + 'cc');
    grad.addColorStop(0.6, col + '55');
    grad.addColorStop(1, col + '00');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    for (let j = 0; j < 26; j++) {
      const a = rnd() * TAU;
      const rr = r * (0.55 + rnd() * 0.6);
      g.globalAlpha = 0.12 + rnd() * 0.3;
      g.fillStyle = col;
      g.beginPath();
      g.arc(x + Math.cos(a) * rr, y + Math.sin(a) * rr, 0.6 + rnd() * 2.2, 0, TAU);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  return c.toDataURL();
}

let cache: InkTextures | null = null;

/** The texture set, built on first use and reused for every bloom —
 *  the only canvas work in the transition, and it happens once. */
export function getInkTextures(): InkTextures {
  if (cache) return cache;
  try {
    cache = {
      brush: buildBrush(),
      front: buildFront(),
      ring: buildRing(),
      grainA: buildGrain(0x1a17),
      grainB: buildGrain(0x15d3),
      splats: buildSplats(),
    };
  } catch {
    cache = EMPTY;
  }
  return cache;
}
