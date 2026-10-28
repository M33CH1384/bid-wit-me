/**
 * Venue Life — Wave D (Animation Replacement Program §A7 row 72).
 *
 * ONE shared "life layer" system for every room: drifting smoke, light
 * flicker, dust in light, a breathing glow and a slow haze drift, driven
 * by per-venue PARAMETER SETS — no per-venue engines. The Pj's drive-by
 * (§A1 row 13) is the same system's one *cued* member: its sweep model
 * lives here too, timed to the audio scheduler's existing envelope.
 *
 * HyperFrames discipline: every value below is a PURE FUNCTION of a
 * looping clock (seekable, no drift). Nothing in an output path reads
 * Math.random or Date.now — variation comes from a seeded integer hash
 * of (venue seed, particle index), so every client rendering the same
 * t second of the same venue sees the same frame, and a paused/held
 * frame is exact, never a frozen mid-glitch.
 *
 * This module is entry-safe: pure data + math, no three.js, no DOM.
 * Consumers: three/Venue3D.tsx (the lazy 3D chunk's ambient props),
 * animfx's headlight sweep (CSS keyframes encode headlightSweepAt),
 * story/storyLiving.ts (the living-scene moods derive their dust
 * channel from the same hash/phase helpers).
 */
import type { VenueId } from './venues';

/* ------------------------------------------------------------------ seeds */

/** Deterministic 0..1 hash of an integer key (splitmix-style finaliser). */
export function lifeHash(key: number): number {
  let x = (key | 0) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = (x ^ (x >>> 16)) >>> 0;
  return x / 4294967296;
}

/** A venue's stable seed: hash of its id string, so adding a venue
 *  never reshuffles another room's particles. */
export function lifeSeed(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** Looping phase 0..1 of t on a period — the one clock every channel reads. */
export function lifePhase(tSec: number, periodSec: number): number {
  if (!(periodSec > 0)) return 0;
  const u = (tSec % periodSec) / periodSec;
  return u < 0 ? u + 1 : u;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, x: number): number => {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;

/* ------------------------------------------------------------- parameters */

export interface SmokeLife { count: number; /** seconds for one puff to rise its full loop */ periodSec: number; tint: string; opacity: number; /** sideways drift over the loop, world units */ drift: number }
export interface FlickerLife { /** hash steps per second */ rateHz: number; /** 0 = rock steady, 1 = hard buzz dips */ depth: number; tint: string }
export interface GlowLife { periodSec: number; lo: number; hi: number; tint: string }
export interface DustLife { count: number; periodSec: number; tint: string; opacity: number }
export interface HazeLife { periodSec: number; /** sideways sway, 0..1 of the layer width */ amp: number; tint: string }

export interface VenueLifeParams {
  id: VenueId;
  /** what the room's life is, in the room's own register — for reports/tests */
  note: string;
  smoke: SmokeLife | null;
  flicker: FlickerLife;
  glow: GlowLife;
  dust: DustLife;
  haze: HazeLife;
}

const P = (p: VenueLifeParams): VenueLifeParams => p;

/**
 * Per-venue parameter sets — one row per room, values in the room's
 * register (warm kitchens breathe slow and steady; the streetlight
 * buzzes; the lounge shimmers low). Particle counts stay at or below
 * the shipped caps (smoke 14, the count Venue3D's Smoke already proved).
 */
export const VENUE_LIFE: Record<VenueId, VenueLifeParams> = {
  classic: P({ id: 'classic', note: 'studio: dust in the key light, glow rock-steady',
    smoke: null, flicker: { rateHz: 2, depth: 0.04, tint: '#fff1dc' },
    glow: { periodSec: 12, lo: 0.92, hi: 1, tint: '#fff1dc' },
    dust: { count: 10, periodSec: 26, tint: '#ffeecb', opacity: 0.35 }, haze: { periodSec: 30, amp: 0.02, tint: '#cbb8ff' } }),
  backyard: P({ id: 'backyard', note: 'cookout: grill smoke, string-light glow, warm dust',
    smoke: { count: 14, periodSec: 5.6, tint: '#d8d4cc', opacity: 0.5, drift: 0.24 },
    flicker: { rateHz: 6, depth: 0.1, tint: '#ffcf8a' },
    glow: { periodSec: 8, lo: 0.85, hi: 1, tint: '#ffcf8a' },
    dust: { count: 8, periodSec: 22, tint: '#ffd9a0', opacity: 0.3 }, haze: { periodSec: 24, amp: 0.05, tint: '#ffcf9e' } }),
  mansion: P({ id: 'mansion', note: 'chandelier shimmer, slow and stately',
    smoke: null, flicker: { rateHz: 3, depth: 0.07, tint: '#fff0d0' },
    glow: { periodSec: 11, lo: 0.88, hi: 1, tint: '#fff0d0' },
    dust: { count: 12, periodSec: 30, tint: '#ffedbe', opacity: 0.32 }, haze: { periodSec: 34, amp: 0.02, tint: '#e8e4f0' } }),
  barbershop: P({ id: 'barbershop', note: 'shop: window light, dust in it, near-steady tubes',
    smoke: null, flicker: { rateHz: 4, depth: 0.05, tint: '#f4f7ff' },
    glow: { periodSec: 10, lo: 0.9, hi: 1, tint: '#eef2ff' },
    dust: { count: 10, periodSec: 24, tint: '#ffffff', opacity: 0.3 }, haze: { periodSec: 28, amp: 0.03, tint: '#ffd9de' } }),
  church: P({ id: 'church', note: 'basement: fluorescent hum-flicker (faint), still air',
    smoke: null, flicker: { rateHz: 9, depth: 0.12, tint: '#eef6ff' },
    glow: { periodSec: 13, lo: 0.9, hi: 0.98, tint: '#f2f7ff' },
    dust: { count: 8, periodSec: 32, tint: '#ffffff', opacity: 0.26 }, haze: { periodSec: 36, amp: 0.02, tint: '#fff4d6' } }),
  rooftop: P({ id: 'rooftop', note: 'night air: city haze drift, string-light warmth',
    smoke: null, flicker: { rateHz: 5, depth: 0.08, tint: '#ffd9a0' },
    glow: { periodSec: 9, lo: 0.86, hi: 1, tint: '#ffe2a6' },
    dust: { count: 9, periodSec: 20, tint: '#dfe6ff', opacity: 0.28 }, haze: { periodSec: 22, amp: 0.07, tint: '#6f7cff' } }),
  speakeasy: P({ id: 'speakeasy', note: 'lounge: amber pools breathe low, bottle-shelf shimmer, thin haze',
    smoke: { count: 6, periodSec: 9, tint: '#cbb59a', opacity: 0.16, drift: 0.3 },
    flicker: { rateHz: 3, depth: 0.09, tint: '#ffb35c' },
    glow: { periodSec: 14, lo: 0.78, hi: 1, tint: '#ff9a3d' },
    dust: { count: 10, periodSec: 28, tint: '#ffd6a8', opacity: 0.3 }, haze: { periodSec: 30, amp: 0.04, tint: '#ff8a3d' } }),
  vegas: P({ id: 'vegas', note: 'casino: neon edge flicker, gold dust, busy air',
    smoke: null, flicker: { rateHz: 7, depth: 0.16, tint: '#ffcc33' },
    glow: { periodSec: 7, lo: 0.84, hi: 1, tint: '#ffcc33' },
    dust: { count: 10, periodSec: 21, tint: '#ffe9a8', opacity: 0.3 }, haze: { periodSec: 25, amp: 0.04, tint: '#ff3d7f' } }),
  beach: P({ id: 'beach', note: 'cabana: torch flames, sea haze, salt dust',
    smoke: null, flicker: { rateHz: 8, depth: 0.3, tint: '#ff9a3d' },
    glow: { periodSec: 8, lo: 0.82, hi: 1, tint: '#ffc58a' },
    dust: { count: 8, periodSec: 19, tint: '#ffe2b8', opacity: 0.3 }, haze: { periodSec: 20, amp: 0.08, tint: '#ffbf80' } }),
  grandma: P({ id: 'grandma', note: "kitchen: steam off the pie, pendant glow, clock-steady warmth",
    smoke: { count: 6, periodSec: 7.5, tint: '#f4ead8', opacity: 0.34, drift: 0.1 },
    flicker: { rateHz: 2, depth: 0.03, tint: '#ffe6b8' },
    glow: { periodSec: 10, lo: 0.9, hi: 1, tint: '#ffe6b8' },
    dust: { count: 9, periodSec: 27, tint: '#ffedc4', opacity: 0.32 }, haze: { periodSec: 29, amp: 0.03, tint: '#fff2dc' } }),
  yacht: P({ id: 'yacht', note: 'deck: water shimmer, spray dust, breeze haze',
    smoke: null, flicker: { rateHz: 5, depth: 0.12, tint: '#cfe6ff' },
    glow: { periodSec: 9, lo: 0.85, hi: 1, tint: '#fff4e0' },
    dust: { count: 8, periodSec: 18, tint: '#dff2ff', opacity: 0.3 }, haze: { periodSec: 21, amp: 0.08, tint: '#7fd0ff' } }),
  blockAfterDark: P({ id: 'blockAfterDark', note: "the Pj's: sodium streetlight buzz, grill smoke, street dust",
    smoke: { count: 14, periodSec: 6.4, tint: '#cfc4b4', opacity: 0.46, drift: 0.34 },
    flicker: { rateHz: 12, depth: 0.42, tint: '#ffb45c' },
    glow: { periodSec: 11, lo: 0.8, hi: 1, tint: '#ffb45c' },
    dust: { count: 10, periodSec: 23, tint: '#ffd9a0', opacity: 0.3 }, haze: { periodSec: 27, amp: 0.06, tint: '#7fa8ff' } }),
};

export function venueLifeFor(id: VenueId): VenueLifeParams {
  return VENUE_LIFE[id] ?? VENUE_LIFE.classic;
}

/* ------------------------------------------------------- seekable channels */

export interface SmokePuff { x: number; y: number; scale: number; opacity: number }

/** One smoke puff at time t: rises its loop, sways on a seeded phase,
 *  fades in/out at the loop's ends. Pure in (params, seed, index, t). */
export function smokePuffAt(p: VenueLifeParams, i: number, tSec: number, rise = 1.6): SmokePuff {
  const s = p.smoke;
  if (!s || s.count <= 0) return { x: 0, y: 0, scale: 0, opacity: 0 };
  const seed = lifeSeed(p.id);
  const o = lifeHash(seed + i * 131);
  const u = lifePhase(tSec / s.periodSec + o, 1);
  const sway = Math.sin((u * 2 + lifeHash(seed + i * 57)) * Math.PI * 2) * s.drift * u;
  return {
    x: (lifeHash(seed + i * 197) - 0.5) * 0.5 + sway,
    y: u * rise,
    scale: (0.15 + u * 0.55) * (0.5 + lifeHash(seed + i * 89) * 0.6),
    opacity: s.opacity * Math.sin(Math.PI * clamp01(u)) ** 1.5,
  };
}

/**
 * Light level 0..1 at t. A smooth breathing floor plus deterministic
 * hash dips: at `depth` 0 the light is steady; the streetlight's 0.42
 * buzzes — brief notches at hashed step boundaries, never a full cut
 * (the cut belongs to the Pj's SET cover, not the ambience).
 */
export function flickerAt(p: VenueLifeParams, tSec: number): number {
  const f = p.flicker;
  const breathe = 0.97 + 0.03 * Math.sin(lifePhase(tSec, Math.max(3, p.glow.periodSec)) * Math.PI * 2);
  if (f.depth <= 0) return breathe;
  const step = Math.floor(tSec * f.rateHz);
  const h = lifeHash(lifeSeed(p.id) + step * 269 + 11);
  // a dip lives only in the first slice of a step, and only on hashed steps
  const inStep = (tSec * f.rateHz) - step;
  const dip = h < f.depth * 1.6 && inStep < 0.45 ? (1 - inStep / 0.45) * f.depth * (0.5 + h) : 0;
  return clamp01(breathe * (1 - dip));
}

/** Breathing glow 0..1 between the venue's lo/hi on its glow period. */
export function glowAt(p: VenueLifeParams, tSec: number): number {
  const u = lifePhase(tSec, p.glow.periodSec);
  const s = 0.5 - 0.5 * Math.cos(u * Math.PI * 2);
  return lerp(p.glow.lo, p.glow.hi, s);
}

export interface DustMote { x: number; y: number; opacity: number }

/** One dust mote at t: a slow seeded loop inside a unit box, brightest
 *  mid-loop. Coordinates are relative — the consumer scales to its stage. */
export function dustMoteAt(p: VenueLifeParams, i: number, tSec: number): DustMote {
  const d = p.dust;
  const seed = lifeSeed(p.id);
  const u = lifePhase(tSec / d.periodSec + lifeHash(seed + i * 149), 1);
  const x0 = lifeHash(seed + i * 173);
  const y0 = lifeHash(seed + i * 211);
  return {
    x: (x0 + u * 0.22 + Math.sin(u * Math.PI * 2 + i) * 0.03) % 1,
    y: (y0 + u * 0.12) % 1,
    opacity: d.opacity * Math.sin(Math.PI * clamp01(u)),
  };
}

/** Haze sway −amp..+amp at t (a translation fraction for a CSS/3D layer). */
export function hazeSwayAt(p: VenueLifeParams, tSec: number): number {
  const u = lifePhase(tSec, p.haze.periodSec);
  return Math.sin(u * Math.PI * 2) * p.haze.amp;
}

export interface VenueLifeFrame { flicker: number; glow: number; hazeSway: number; smoke: SmokePuff[]; dust: DustMote[] }

/** The whole room at one t — the seekable frame every consumer samples. */
export function venueLifeFrameAt(id: VenueId, tSec: number): VenueLifeFrame {
  const p = venueLifeFor(id);
  return {
    flicker: flickerAt(p, tSec),
    glow: glowAt(p, tSec),
    hazeSway: hazeSwayAt(p, tSec),
    smoke: p.smoke ? Array.from({ length: p.smoke.count }, (_, i) => smokePuffAt(p, i, tSec)) : [],
    dust: Array.from({ length: p.dust.count }, (_, i) => dustMoteAt(p, i, tSec)),
  };
}

/* ------------------------------------------------- Pj's drive-by (§A1 13) */

/**
 * HELD TIMING — the audio scheduler owns this clock (§D.9): in
 * audio.ts `headlightPass`, the pan crosses −11→+11 over 4.4 s and the
 * gain envelope peaks at 1.8 s and is gone by 4.6 s; the shipped visual
 * ran 4.6 s. The rebuilt visual keeps 4.6 s exactly and shapes itself
 * to that envelope: beams enter as the pan starts, peak as the car is
 * abreast (pan centre ≈ 2.2 s), and the taillight afterglow is what is
 * left as the gain dies.
 */
export const HEADLIGHT_SWEEP_SEC = 4.6;

export interface HeadlightFrame {
  /** 0..1 through the pass */
  p: number;
  /** beam centre, % of stage width (−20 = off left, 120 = off right) */
  beamX: number;
  /** two beam centres: a car's lamps sit apart, they do not merge */
  beamL: number; beamR: number;
  /** overall beam opacity, shaped to the audio gain envelope */
  envelope: number;
  /** fence-shadow striping strength: peaks while the beams rake the fence */
  stripe: number;
  /** stripe pattern phase (px of shadow shift as the light rakes across) */
  stripeShift: number;
  /** taillight afterglow: opacity + centre %, trailing the beams */
  tailOpacity: number; tailX: number;
}

export function headlightSweepAt(tSec: number): HeadlightFrame {
  const p = clamp01(tSec / HEADLIGHT_SWEEP_SEC);
  // pan is linear in the audio; the light's *brightness* follows the gain
  const beamX = lerp(-20, 120, p);
  const envelope = smooth(0, 0.16, p) * (1 - smooth(0.8, 1, p)) * (0.55 + 0.45 * Math.sin(Math.PI * clamp01(p)));
  const stripe = Math.sin(Math.PI * clamp01((p - 0.08) / 0.84)) ** 2;
  const tailP = smooth(0.52, 0.72, p);
  return {
    p,
    beamX,
    beamL: beamX - 4.5, beamR: beamX + 4.5,
    envelope: clamp01(envelope),
    stripe: clamp01(stripe),
    stripeShift: -beamX * 0.35,
    tailOpacity: tailP * (1 - smooth(0.86, 1, p)) * 0.8,
    tailX: beamX - 30 * tailP,
  };
}

/** Calm / reduced-effects read: no travel — a held frame at the pass's
 *  midpoint (beams abreast, stripes soft), opacity breathing only. */
export function headlightCalmAt(tSec: number): { opacity: number; beamX: number } {
  const u = lifePhase(tSec, HEADLIGHT_SWEEP_SEC);
  const opacity = u < 0.35 ? smooth(0, 0.35, u) : u > 0.65 ? 1 - smooth(0.65, 1, u) : 1;
  return { opacity, beamX: 50 };
}
