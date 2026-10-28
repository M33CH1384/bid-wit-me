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
 *
 * The recipes below carry the 2026-10-23 tuning pass (owner: the
 * spray should be "cleaner"): speckle counts down, dots smaller,
 * overspray pulled in tight to the shapes it textures, grain finer
 * and more even. The counts and bands in these builders ARE the
 * clean discipline — the spray test pins their ceilings.
 *
 * WAVE D (2026-10-28, Animation Replacement Program §A6 row 62): the
 * same recipes re-rendered at higher fidelity — the brush tile grows
 * 160 -> 192 px and gains a micro-speckle pass and a faint overspray
 * halo ring, the fill front gains a denser wet core band, the bloom
 * ring gains a sparse far-overspray scatter, and the reveal grains
 * gain a few larger dry flakes. Every addition is a second seeded
 * pass INSIDE the same static builders (same mulberry streams, no
 * Math.random / Date.now anywhere) and every pinned clean-pass
 * count, band, and alpha range above is untouched — fidelity went
 * up, the clean discipline did not move. Still rendered once, still
 * consumed as stills; nothing here ever runs per frame.
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
 *  stamped along a path every frame). Wave D renders the tile at
 *  192 px and adds two seeded passes after the pinned speckle loop:
 *  micro-speckle clustered at the core's edge (the wet rim where a
 *  real dab breaks up) and a faint overspray halo ring just outside
 *  the core — detail the 160 px tile smeared away. */
function buildBrush(): string {
  const made = makeCanvas(192, 192);
  if (!made) return '';
  const [c, g] = made;
  const cx = 96;
  const core = 192 * 0.3;
  const grad = g.createRadialGradient(cx, cx, core * 0.25, cx, cx, core);
  grad.addColorStop(0, 'rgba(7,7,8,0.98)');
  grad.addColorStop(0.75, 'rgba(7,7,8,0.92)');
  grad.addColorStop(1, 'rgba(7,7,8,0.55)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cx, core, 0, TAU);
  g.fill();
  const rnd = mulberry32(0xb007);
  for (let i = 0; i < 260; i++) {
    const a = rnd() * TAU;
    const rr = core * (0.5 + Math.pow(rnd(), 1.5) * 0.75);
    const r = 0.5 + rnd() * (rr > core ? 0.8 : 1.4);
    g.globalAlpha = Math.max(0.06, 0.85 - (rr / (core * 1.5)) * 0.8) * (0.4 + rnd() * 0.6);
    g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
    g.beginPath();
    g.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, r, 0, TAU);
    g.fill();
  }
  // Wave D pass 2 — micro-speckle at the wet rim: tiny dots hugging
  // the core's edge (0.82R..1.12R), where the dab's skin tears.
  for (let i = 0; i < 150; i++) {
    const a = rnd() * TAU;
    const rr = core * (0.82 + rnd() * 0.3);
    g.globalAlpha = 0.1 + rnd() * 0.3;
    g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
    g.beginPath();
    g.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, 0.3 + rnd() * 0.6, 0, TAU);
    g.fill();
  }
  // Wave D pass 3 — the overspray halo: a whisper of paint carried
  // past the dab (1.18R..1.45R), alpha low enough to read as air,
  // not as a second shape.
  for (let i = 0; i < 70; i++) {
    const a = rnd() * TAU;
    const rr = core * (1.18 + rnd() * 0.27);
    g.globalAlpha = 0.03 + rnd() * 0.07;
    g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
    g.beginPath();
    g.arc(cx + Math.cos(a) * rr, cx + Math.sin(a) * rr, 0.4 + rnd() * 0.9, 0, TAU);
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
  for (let i = 0; i < 950; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const window = Math.sin((y / H) * Math.PI); // 0 at the edges, 1 mid-strip
    const a = window * (0.1 + rnd() * 0.45);
    if (a < 0.03) continue;
    g.globalAlpha = a;
    g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
    g.beginPath();
    g.arc(x, y, 0.5 + rnd() * 1.4, 0, TAU);
    g.fill();
  }
  // Wave D — the wet core band: a denser, finer speckle concentrated
  // at the strip's vertical middle, so the front's leading heart
  // reads wet and heavy while its edges stay mist.
  for (let i = 0; i < 320; i++) {
    const x = rnd() * W;
    const y = H * (0.5 + (rnd() + rnd() - 1) * 0.22); // clustered mid-strip
    g.globalAlpha = 0.12 + rnd() * 0.3;
    g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
    g.beginPath();
    g.arc(x, y, 0.4 + rnd() * 0.9, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return c.toDataURL();
}

/** The bloom's speckle front: dots in a THIN annulus near the tile's
 *  edge, densest just inside it, thinning outward — drawn on a disc
 *  slightly larger than the solid bloom disc so the band straddles
 *  its edge. (Clean pass: the band narrowed from 0.78R..1.08R to
 *  0.86R..1.04R, with fewer, smaller dots.) */
function buildRing(): string {
  const S = 512;
  const made = makeCanvas(S, S);
  if (!made) return '';
  const [c, g] = made;
  const R = S / 2;
  const rnd = mulberry32(0x9156);
  for (let i = 0; i < 700; i++) {
    const a = rnd() * TAU;
    const rr = R * (0.86 + Math.pow(rnd(), 1.6) * 0.18); // 0.86R .. 1.04R
    const fade = rr <= R ? 0.3 + ((rr / R - 0.86) / 0.14) * 0.6 : Math.max(0, 1 - (rr / R - 1) / 0.04);
    g.globalAlpha = fade * (0.25 + rnd() * 0.6);
    g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
    g.beginPath();
    g.arc(R + Math.cos(a) * rr, R + Math.sin(a) * rr, 0.6 + rnd() * 1.7, 0, TAU);
    g.fill();
  }
  // Wave D — far overspray: a sparse scatter carried just past the
  // pinned annulus (1.05R..1.16R), faint enough that the clean
  // band still defines the bloom's edge.
  for (let i = 0; i < 90; i++) {
    const a = rnd() * TAU;
    const rr = R * (1.05 + rnd() * 0.11);
    g.globalAlpha = 0.04 + rnd() * 0.1;
    g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
    g.beginPath();
    g.arc(R + Math.cos(a) * rr, R + Math.sin(a) * rr, 0.5 + rnd() * 1.1, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  return c.toDataURL();
}

/** A grain tile for the reveal masks: white dots of uneven alpha (the
 *  mask reads alpha), so some specks of paint linger while others
 *  clear early — a dry-paint dissolve instead of a uniform fade.
 *  (Clean pass: finer dots, a tighter alpha range, and a lower dot
 *  density — the dissolve breaks into fine speckle, not clumps.) */
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
  // Wave D — dry flakes: a handful of larger, fainter specks in the
  // same pinned alpha family, so the dissolve's last moments break
  // into flakes instead of uniform dust.
  for (let i = 0; i < 22; i++) {
    g.globalAlpha = 0.25 + rnd() * 0.4;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(rnd() * S, rnd() * S, 2.1 + rnd() * 1.6, 0, TAU);
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
