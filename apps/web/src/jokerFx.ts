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

export const BURST_MS: Record<JokerKind, number> = { BJ: 1100, LJ: 800 };

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

/** Shockwave diameter as a multiple of the table width, and its opacity. 0..450ms (shorter for LJ). */
export function shockwave(tMs: number, kind: JokerKind): { mul: number; opacity: number } | null {
  const dur = kind === 'BJ' ? 450 : 320;
  const maxMul = kind === 'BJ' ? 4 : 2.2;
  if (tMs < 0 || tMs > dur) return null;
  const e = cubicBezier(0.1, 0.7, 0.2, 1, tMs / dur);
  return { mul: maxMul * e, opacity: Math.max(0, 1 - e) };
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

/** Mushroom sprites: rise and scale from 120ms, gone by 900ms (sooner and smaller for the Little Joker). */
export function cloudPose(tMs: number, kind: JokerKind, reduced: boolean): { rise: number; scale: number; opacity: number } | null {
  if (reduced) return null;
  const start = 120;
  const end = kind === 'BJ' ? 900 : 680;
  if (tMs < start || tMs > end) return null;
  const u = (tMs - start) / (end - start);
  const riseMax = kind === 'BJ' ? 60 : 36;
  const scaleMax = kind === 'BJ' ? 1.3 : 0.95;
  const scaleMin = 0.4;
  const grow = Math.min(1, u / 0.62);
  const fade = u < 0.55 ? 1 : Math.max(0, 1 - (u - 0.55) / 0.45);
  return { rise: riseMax * grow, scale: scaleMin + (scaleMax - scaleMin) * grow, opacity: fade };
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
 * Other trick cards: pushed out and faded over 300ms.
 * Opacity comes back after 900ms so the iOS blast (which needs the cards on the table) can finish
 * and the trick is readable again before the sweep. The push itself is the spec's 20px (12px for LJ).
 */
export function cardPush(tMs: number, kind: JokerKind): { px: number; opacity: number } {
  const dist = kind === 'BJ' ? 20 : 12;
  if (tMs <= 0) return { px: 0, opacity: 1 };
  if (tMs < 300) {
    const e = cubicBezier(0.1, 0.7, 0.2, 1, tMs / 300);
    return { px: dist * e, opacity: 1 - 0.65 * e };
  }
  if (tMs < 900) return { px: dist, opacity: 0.35 };
  const back = Math.min(1, (tMs - 900) / 400);
  return { px: dist * (1 - back), opacity: 0.35 + 0.65 * back };
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

export interface BurstClock { start: number; kind: JokerKind; reduced: boolean }

let burst: BurstClock | null = null;
const listeners = new Set<() => void>();

export function getBurst(): BurstClock | null { return burst; }
export function subscribeBurst(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function startBurst(kind: JokerKind, reduced: boolean, now = performance.now()): BurstClock {
  burst = { start: now, kind, reduced };
  listeners.forEach((f) => f());
  return burst;
}
export function clearBurst(): void {
  if (!burst) return;
  burst = null;
  listeners.forEach((f) => f());
}
