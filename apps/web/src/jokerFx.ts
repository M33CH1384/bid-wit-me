/**
 * Radioactive joker + detonation keyframes.
 *
 * The card face is never tinted. These numbers drive transforms and opacities of layers that sit
 * behind and around the card, plus the DOM/canvas burst (flash, shockwave, cloud, shake).
 * The 3D nuke (including the iOS cheap path: no bloom composer, no fullscreen fire) stays in Nuke3D.
 */

export type JokerKind = 'BJ' | 'LJ';

export interface Rgb { r: number; g: number; b: number; hex: string }

export interface JokerPalette {
  core: Rgb;
  hot: Rgb;
  deep: Rgb;
  /** Halo diameter relative to the card. */
  halo: number;
  /** Heartbeat scale peaks are multiplied by this (Little Joker is a smaller beat). */
  beat: number;
  /** Ripple grows from 1 to this. */
  rippleTo: number;
  particles: number;
}

const rgb = (r: number, g: number, b: number, hex: string): Rgb => ({ r, g, b, hex });

export const JOKER_PALETTE: Record<JokerKind, JokerPalette> = {
  BJ: {
    core: rgb(124, 255, 79, '#7CFF4F'),
    hot: rgb(182, 255, 59, '#B6FF3B'),
    deep: rgb(31, 92, 18, '#1F5C12'),
    halo: 2.2,
    beat: 1,
    rippleTo: 1.6,
    particles: 8,
  },
  // Same treatment, scaled down, in purple. No shared white flash (see flashOpacity).
  LJ: {
    core: rgb(200, 107, 255, '#C86BFF'),
    hot: rgb(231, 182, 255, '#E7B6FF'),
    deep: rgb(61, 20, 96, '#3D1460'),
    halo: 1.55,
    beat: 0.55,
    rippleTo: 1.35,
    particles: 6,
  },
};

/** Cubic-bezier easing. y may leave 0..1 (the detonation pop's control point is 1.4). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return bez(1, y1, y2);
  let t = x;
  for (let i = 0; i < 8; i++) {
    const dx = bez(t, x1, x2) - x;
    const d = bezD(t, x1, x2);
    if (Math.abs(dx) < 1e-5 || Math.abs(d) < 1e-6) break;
    t = Math.min(1, Math.max(0, t - dx / d));
  }
  return bez(t, y1, y2);
}
function bez(t: number, a: number, b: number): number {
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
}
function bezD(t: number, a: number, b: number): number {
  const u = 1 - t;
  return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
}

const easeInOut = (u: number) => cubicBezier(0.42, 0, 0.58, 1, u);
const easeOut = (u: number) => cubicBezier(0, 0, 0.58, 1, u);

/** 1.1s with nothing played after the joker, 0.8s with one card, 0.55s with two (the final cycle). */
export function cycleMs(cardsAfter: number): number {
  if (cardsAfter >= 2) return 550;
  if (cardsAfter === 1) return 800;
  return 1100;
}

/** Double-beat marks inside one cycle. Haptics and the ripple fire when phase crosses these. */
export const BEAT_MARKS = [0.14, 0.42] as const;

const HEART = [
  { t: 0, scale: 1, glow: 0.35 },
  { t: 0.14, scale: 1.035, glow: 0.9 },
  { t: 0.28, scale: 1, glow: 0.35 },
  { t: 0.42, scale: 1.02, glow: 0.9 },
  { t: 0.58, scale: 1, glow: 0.35 },
  { t: 1, scale: 1, glow: 0.35 },
] as const;

/** Heartbeat pose. `phase` is 0..1 within the current cycle. Glow is the shadow opacity .35 → .9. */
export function heartbeat(phase: number, kind: JokerKind): { scale: number; glow: number } {
  const p = ((phase % 1) + 1) % 1;
  let i = 0;
  while (i < HEART.length - 2 && HEART[i + 1]!.t <= p) i++;
  const a = HEART[i]!, b = HEART[i + 1]!;
  const u = b.t === a.t ? 0 : (p - a.t) / (b.t - a.t);
  const e = easeInOut(Math.min(1, Math.max(0, u)));
  const k = JOKER_PALETTE[kind].beat;
  const s0 = 1 + (a.scale - 1) * k;
  const s1 = 1 + (b.scale - 1) * k;
  return { scale: s0 + (s1 - s0) * e, glow: a.glow + (b.glow - a.glow) * e };
}

/** A ripple launched at a beat: scale 1 → rippleTo, opacity .5 → 0, 700ms ease-out. */
export function ripplePose(ageMs: number, kind: JokerKind): { scale: number; opacity: number } | null {
  if (ageMs < 0 || ageMs > 700) return null;
  const e = easeOut(ageMs / 700);
  const to = JOKER_PALETTE[kind].rippleTo;
  return { scale: 1 + (to - 1) * e, opacity: 0.5 * (1 - e) };
}

/**
 * The whole detonation (flash, ring, push, cloud, pop, stamp, flight) is about 1.1–1.3s.
 * The 3D blast keeps its own longer clock; these times are the overlay and the card flight.
 */
export const BURST_MS: Record<JokerKind, number> = { BJ: 1300, LJ: 1000 };
/** Shockwave ends, then the NUKED stamp hits 350ms later. */
export const SHOCK_MS = 450;
export const BANNER_AT_MS = SHOCK_MS + 350;
/** Cards leave the trick for the winner's pile. The stamp fades out with them. */
export const SWEEP_MS = 900;

/** Mushroom window. Big enough to read on a phone, gone as the cards fly. */
const CLOUD_START = 120;
const CLOUD_END: Record<JokerKind, number> = { BJ: 1150, LJ: 880 };

/**
 * White flash. Big Joker only: 0→.85 over 60ms, then back to 0 over 220ms ease-out.
 * Little Joker has no white flash. Reduced motion is one softer flash, same shape.
 */
export function flashOpacity(tMs: number, kind: JokerKind, reduced: boolean): number {
  if (kind === 'LJ' || tMs < 0) return 0;
  const peak = reduced ? 0.28 : 0.85;
  if (tMs <= 60) return peak * (tMs / 60);
  const u = (tMs - 60) / 220;
  if (u >= 1) return 0;
  return peak * (1 - easeOut(u));
}

/**
 * Shockwave diameter as a multiple of the table width, and its opacity.
 * 0..450ms for the Big Joker (shorter for LJ). The ease reaches full size early;
 * opacity follows the clock so the ring is still readable once it is large.
 */
export function shockwave(tMs: number, kind: JokerKind): { mul: number; opacity: number } | null {
  const dur = kind === 'BJ' ? SHOCK_MS : 320;
  const maxMul = kind === 'BJ' ? 4 : 2.2;
  if (tMs < 0 || tMs > dur) return null;
  const u = tMs / dur;
  const e = cubicBezier(0.1, 0.7, 0.2, 1, u);
  // The ease is front-loaded, so fading with it hides the ring once it is large.
  // Fade on the clock instead: still full early, gone at the end of the shockwave.
  return { mul: maxMul * e, opacity: Math.max(0, 1 - u * u) };
}

/** Screen shake, transform only. 8px → 0 over 350ms, about 6 oscillations. None under reduced motion. */
export function shakeOffset(tMs: number, kind: JokerKind, reduced: boolean): { x: number; y: number } {
  if (reduced || tMs < 0 || tMs >= 350) return { x: 0, y: 0 };
  const amp0 = kind === 'BJ' ? 8 : 4;
  const osc = kind === 'BJ' ? 6 : 4;
  const u = tMs / 350;
  const amp = amp0 * (1 - u);
  const phase = u * osc * Math.PI * 2;
  return { x: amp * Math.sin(phase), y: amp * 0.65 * Math.cos(phase) };
}

/**
 * Mushroom pose. `rise` and `scale` are 0..1 fractions (pixel size comes from the viewport).
 * Already large on the first frame, bright through the shockwave, fading as the cards fly.
 * Reduced motion draws no cloud.
 */
export function cloudPose(tMs: number, kind: JokerKind, reduced: boolean): { rise: number; scale: number; opacity: number } | null {
  if (reduced) return null;
  const end = CLOUD_END[kind];
  if (tMs < CLOUD_START || tMs > end) return null;
  const u = (tMs - CLOUD_START) / (end - CLOUD_START);
  const grow = Math.min(1, u / 0.22);
  const fadeIn = Math.min(1, 0.75 + u / 0.05);
  const fadeOut = u < 0.62 ? 1 : Math.max(0, 1 - (u - 0.62) / 0.38);
  return { rise: 0.45 + 0.55 * grow, scale: 0.82 + 0.18 * grow, opacity: fadeIn * fadeOut };
}

export interface MushroomSprite {
  /** Offset from the blast center, CSS pixels. y grows downward. */
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** 0 = yellow crown, 1 = orange body. */
  hot: 0 | 1;
}

/**
 * A handful of billboards: a stem and a wide cap. Sized from the short side of the screen so a 390px
 * phone gets a cloud that covers the trick, not a 60px puff. No particle system.
 */
export function mushroomSprites(
  pose: { rise: number; scale: number },
  kind: JokerKind,
  minSide: number,
): MushroomSprite[] {
  const k = kind === 'BJ' ? 1 : 0.62;
  const s = pose.scale * k;
  const stem = minSide * 0.34 * pose.rise * k;
  const capW = minSide * 0.46 * s;
  const capH = minSide * 0.16 * s;
  const sprites: MushroomSprite[] = [];
  // One solid column so the stem still reads on green felt and through the full-path screen fire.
  sprites.push({ x: 0, y: -stem * 0.46, rx: minSide * 0.055 * s, ry: stem * 0.52, hot: 1 });
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const rad = minSide * (0.04 + 0.022 * t) * s;
    sprites.push({ x: 0, y: -stem * t, rx: rad * 0.9, ry: rad * 1.15, hot: 1 });
  }
  for (let i = 0; i < 7; i++) {
    const u = i / 6;
    const crown = Math.sin(u * Math.PI);
    const rad = capH * (0.55 + 0.35 * crown);
    sprites.push({
      x: (u - 0.5) * capW,
      y: -stem - crown * capH,
      rx: rad * 1.05,
      ry: rad * 0.72,
      hot: i % 2 === 0 ? 0 : 1,
    });
  }
  sprites.push({ x: 0, y: -stem - capH * 0.35, rx: capH * 0.5, ry: capH * 0.38, hot: 0 });
  return sprites;
}

/**
 * Winning joker pop: at 200ms, scale 1 → peak → 1 over 500ms, cubic-bezier(.2, 1.4, .3, 1).
 * Peak is 1.25 for the Big Joker and 1.12 for the Little one. Then the existing sweep flies it to the books.
 */
export function jokerPop(tMs: number, kind: JokerKind): number {
  const start = 200;
  const dur = 500;
  const peak = kind === 'BJ' ? 1.25 : 1.12;
  if (tMs < start || tMs > start + dur) return 1;
  const u = (tMs - start) / dur;
  // The overshooting bezier shapes the way up; the way down eases back to 1.
  const split = 0.42;
  if (u <= split) {
    const e = Math.min(1.15, Math.max(0, cubicBezier(0.2, 1.4, 0.3, 1, u / split)));
    return 1 + (peak - 1) * Math.min(1, e);
  }
  const e = easeOut((u - split) / (1 - split));
  return peak + (1 - peak) * e;
}

/**
 * Other trick cards: pushed out and faded over 300ms, then held until the sweep.
 * Opacity floors at 0.35 so the iOS blast still has cards, and they fade out with the flight
 * instead of popping back to full and then vanishing.
 */
export function cardPush(tMs: number, kind: JokerKind): { px: number; opacity: number } {
  const dist = kind === 'BJ' ? 20 : 12;
  if (tMs <= 0) return { px: 0, opacity: 1 };
  if (tMs < 300) {
    const e = cubicBezier(0.1, 0.7, 0.2, 1, tMs / 300);
    return { px: dist * e, opacity: 1 - 0.65 * e };
  }
  return { px: dist, opacity: 0.35 };
}

/** Final-cycle jitter: 1px, sampled at 30fps, only while two cards have already followed the joker. */
export function jitterPx(nowMs: number, cardsAfter: number, reduced: boolean): { x: number; y: number } {
  if (reduced || cardsAfter < 2) return { x: 0, y: 0 };
  const frame = Math.floor(nowMs / (1000 / 30));
  const h = Math.sin(frame * 12.9898) * 43758.5453;
  const a = h - Math.floor(h);
  const h2 = Math.sin(frame * 78.233) * 12345.6789;
  const b = h2 - Math.floor(h2);
  return { x: (a * 2 - 1), y: (b * 2 - 1) };
}

export interface BurstClock { start: number; kind: JokerKind; reduced: boolean; elapsed: number; last: number }

let burst: BurstClock | null = null;
const listeners = new Set<() => void>();

export function getBurst(): BurstClock | null { return burst; }
export function subscribeBurst(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function startBurst(kind: JokerKind, reduced: boolean, now = performance.now()): BurstClock {
  burst = { start: now, kind, reduced, elapsed: 0, last: 0 };
  listeners.forEach((f) => f());
  return burst;
}
/**
 * Advance the detonation on painted frames. A long hitch (shader compile, a stalled GPU) counts as one
 * frame, so the flash and shockwave still play when the browser can paint instead of being skipped.
 */
export function advanceBurst(now = performance.now()): BurstClock | null {
  if (!burst) return null;
  if (burst.last) {
    const dt = Math.max(0, now - burst.last);
    // Opening flash stays frame-capped so a hitch cannot skip it. After that, allow a longer
    // step so the mushroom keeps up with the wall clock when a frame is late.
    const cap = burst.elapsed < 300 ? 50 : 200;
    burst.elapsed += Math.min(cap, dt);
  }
  burst.last = now;
  return burst;
}
export function clearBurst(): void {
  if (!burst) return;
  burst = null;
  listeners.forEach((f) => f());
}
