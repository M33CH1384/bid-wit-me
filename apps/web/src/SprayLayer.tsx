/**
 * The spray-paint transition layer (owner, 2026-10-23) — the visual half of
 * spray.ts. Mounted once in Root beside InkLayer / SocialRoot. It renders
 * nothing while idle; during a spray it is a single fixed <canvas>:
 *
 *  - COVER: a pre-rendered spray-front sprite (solid black body, grainy
 *    speckle falloff — built once, offscreen) sweeps left to right behind a
 *    black fill, so the paint lands like a tagger's pass: dense where it
 *    hits first, overspray speckling ahead of the front. One fillRect + one
 *    drawImage per frame — no DOM churn, no per-frame layout.
 *  - REVEAL: the full black is erased through a pre-rendered grain mask
 *    (destination-out), so the paint speckles and dissolves off the new
 *    screen instead of sliding away, with a short opacity tail so no
 *    residue pops at the end.
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
  getSpraySnapshot,
  registerSprayRenderer,
  subscribeSpray,
} from './spray';
import './spray.css';

const PAINT = '#070708';
const INKS = ['#060607', '#0a0a0c', '#101014', '#050505'] as const;

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

let frontSprite: HTMLCanvasElement | null = null;
/** The spray front: opaque for its first ~36%, then a speckle falloff to
 *  nothing — drawn once, stretched over the sweep band at paint time. */
function getFrontSprite(): HTMLCanvasElement | null {
  if (frontSprite) return frontSprite;
  try {
    const W = 640;
    const H = 1024;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    if (!g) return null;
    const solid = Math.floor(W * 0.36);
    g.fillStyle = PAINT;
    g.fillRect(0, 0, solid, H);
    const rnd = mulberry32(0x5eed);
    // Speckle field past the solid edge: density and dot size fall off with
    // distance, like overspray thinning out from the pass.
    for (let i = 0; i < 5200; i++) {
      const x = solid + Math.pow(rnd(), 1.7) * (W - solid);
      const y = rnd() * H;
      const near = 1 - (x - solid) / (W - solid);
      const r = 0.6 + rnd() * (1 + near * 3.4);
      g.globalAlpha = 0.3 + rnd() * 0.7;
      g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
      g.beginPath();
      g.arc(x, y, r, 0, 6.2832);
      g.fill();
    }
    // A few heavier clumps in the falloff — paint gathers, it isn't uniform.
    for (let i = 0; i < 130; i++) {
      const x = solid + Math.pow(rnd(), 2.2) * (W - solid) * 0.7;
      const y = rnd() * H;
      const r = 3.5 + rnd() * 6;
      g.globalAlpha = 0.16 + rnd() * 0.22;
      g.fillStyle = INKS[(rnd() * INKS.length) | 0]!;
      g.beginPath();
      g.arc(x, y, r, 0, 6.2832);
      g.fill();
    }
    g.globalAlpha = 1;
    frontSprite = c;
    return c;
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
      g.arc(rnd() * w, rnd() * h, r, 0, 6.2832);
      g.fill();
    }
    g.globalAlpha = 1;
    grainCache = { key, canvas: c };
    return c;
  } catch {
    return null;
  }
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

function drawCover(g: CanvasRenderingContext2D, vw: number, vh: number, snap: { phaseAt: number; fromCoverage: number }): void {
  const p = easeOutCubic(clamp01((performance.now() - snap.phaseAt) / SPRAY_COVER_MS));
  const t = snap.fromCoverage + (1 - snap.fromCoverage) * p;
  const band = Math.max(340, vw * 0.62);
  const core = -band + t * (vw + band); // sprite's left edge
  g.clearRect(0, 0, vw, vh);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  const solidTo = core + band * 0.36;
  if (solidTo > 0) {
    g.fillStyle = PAINT;
    g.fillRect(0, 0, Math.min(vw, solidTo + 2), vh);
  }
  const sprite = getFrontSprite();
  if (sprite) g.drawImage(sprite, core, 0, band, vh);
  else if (solidTo > 0) {
    g.fillStyle = PAINT;
    g.fillRect(0, 0, vw, vh);
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
      if (s.phase === 'cover') drawCover(g, vw, vh, s);
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
