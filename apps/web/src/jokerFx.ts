/**
 * Radioactive joker pulse, plus the detonation clock and the whole-screen shake.
 *
 * The card face is never tinted. Pulse numbers drive layers that sit behind and around the card.
 * The explosion itself is Nuke3D (including the iOS cheap path: no bloom composer, no fullscreen fire).
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
  // Same treatment, scaled down, in purple.
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

/** Cubic-bezier easing. y may leave 0..1. */
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
 * How long the detonation clock stays up. The Big Joker matches Nuke3D's 3.6s blast so a stall
 * can still cancel haptics. The Little Joker win is haptic only, long enough for that pattern.
 */
export const BURST_MS: Record<JokerKind, number> = { BJ: 3600, LJ: 500 };

/** Whole-screen shake, transform only. 8px → 0 over 350ms, about 6 oscillations. None under reduced motion. */
export function shakeOffset(tMs: number, kind: JokerKind, reduced: boolean): { x: number; y: number } {
  if (reduced || tMs < 0 || tMs >= 350) return { x: 0, y: 0 };
  const amp0 = kind === 'BJ' ? 8 : 4;
  const osc = kind === 'BJ' ? 6 : 4;
  const u = tMs / 350;
  const amp = amp0 * (1 - u);
  const phase = u * osc * Math.PI * 2;
  return { x: amp * Math.sin(phase), y: amp * 0.65 * Math.cos(phase) };
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
 * frame, so the opening shake still plays when the browser can paint instead of being skipped.
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
