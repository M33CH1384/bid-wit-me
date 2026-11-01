import { rng } from './landing';

/**
 * 'Run it!' slam disturbance (owner, 2026-11-01: the slam "should have an effect
 * where the cards on the table (if any) are disturbed whether they bounce or
 * slide"). When the claimer's cards strike the felt, the impact pushes ONE event
 * onto this bus — the same frame the runSlam impact sound and the pile thump
 * fire — and every Card3D resting on the felt drains it and jolts on its inner
 * group, the deuce knock's layer:
 *
 *  - BOUNCE: a small hop with a tip away from the impact.
 *  - SLIDE: a radial shove that runs out fast and creeps back on friction.
 *
 * Magnitude falls off with distance from the strike point, so the trick cards
 * at the centre jump hardest and the book piles at the rails only shiver. The
 * model here is pure and seeded (the impact seed + the card's own id), so every
 * client disturbs the same cards the same way; only the frame is local, like
 * the landing sounds. Every offset is an envelope that returns to EXACTLY
 * zero — a disturbed card ends on its own rest pose, which is the only state
 * the tornado that follows is allowed to find (and the funnel anchors to the
 * outer group anyway, so it could not be disturbed if it tried).
 *
 * The mega run needs no event: its detonation blast goes off on the same
 * impact frame and owns these cards' inner groups outright — the blast IS
 * the disturbance there, and the shared ownership gate keeps the two from
 * ever writing the same group in the same frame.
 */
export interface SlamDisturbance {
  /** Monotonic id; consumers keep a watermark. */
  id: number;
  /** performance.now() at the impact frame. */
  at: number;
  /** The strike point on the felt (the last slam card's landing spot). */
  x: number;
  z: number;
  /** The card that struck (it does not disturb itself). */
  source: string | null;
  /** Deterministic per slam (seeded from the striking card + its target). */
  seed: number;
}

const MAX_KEPT = 8;
let seq = 0;
const events: SlamDisturbance[] = [];

export function pushSlamDisturbance(e: Omit<SlamDisturbance, 'id'>): void {
  events.push({ ...e, id: ++seq });
  if (events.length > MAX_KEPT) events.splice(0, events.length - MAX_KEPT);
}

/** All slam disturbances after `afterId`, oldest first. */
export function slamDisturbancesAfter(afterId: number): SlamDisturbance[] {
  return events.filter((e) => e.id > afterId);
}

export const lastSlamDisturbanceId = (): number => seq;

/** Test hook: forget every event (the bus is module state). */
export function resetSlamDisturbances(): void { events.length = 0; seq = 0; }

/** How long a disturbed card takes to settle back onto its spot (ms). */
export const DISTURBANCE_MS = 600;
/** Cards farther than this from the strike feel nothing (world units). */
export const DISTURBANCE_RADIUS = 1.7;
/** Peak slide of a card struck dead-on (world units). */
export const DISTURBANCE_SLIDE = 0.095;
/** Peak hop of a bounced card struck dead-on (world units). */
export const DISTURBANCE_HOP = 0.06;

export interface DisturbanceParams {
  mode: 'bounce' | 'slide';
  /** Unit direction of the shove on the felt (away from the strike, seeded jitter). */
  dirX: number;
  dirZ: number;
  /** Peak horizontal travel (world units). */
  mag: number;
  /** Peak hop height (world units). */
  hop: number;
  /** Peak tilt (radians), tipping away from the strike. */
  tilt: number;
}

/**
 * What one resting card does when the slam lands `dist` away. `dx`/`dz` point
 * from the strike to the card. Seeded per card (impact seed ^ card hash at the
 * call site), so the bounce/slide coin flip and the jitter agree everywhere.
 * Returns null when the card is out of reach.
 */
export function disturbanceFor(dx: number, dz: number, seed: number): DisturbanceParams | null {
  const dist = Math.hypot(dx, dz);
  if (!(dist < DISTURBANCE_RADIUS)) return null;
  const fall = Math.pow(1 - dist / DISTURBANCE_RADIUS, 1.3);
  const r = rng(seed >>> 0);
  const mode: DisturbanceParams['mode'] = r() < 0.5 ? 'bounce' : 'slide';
  // radial direction, jittered so neighbours don't march in lockstep
  const baseAng = Math.atan2(dz, dx);
  const ang = baseAng + (r() * 2 - 1) * 0.5;
  const strength = fall * (0.75 + 0.5 * r());
  return {
    mode,
    dirX: Math.cos(ang),
    dirZ: Math.sin(ang),
    mag: (mode === 'slide' ? DISTURBANCE_SLIDE : DISTURBANCE_SLIDE * 0.3) * strength,
    hop: (mode === 'bounce' ? DISTURBANCE_HOP : DISTURBANCE_HOP * 0.35) * strength,
    tilt: (mode === 'bounce' ? 0.3 : 0.16) * strength,
  };
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const smoothstep = (u: number) => { const c = clamp01(u); return c * c * (3 - 2 * c); };
const easeOutCubic = (u: number) => 1 - Math.pow(1 - clamp01(u), 3);

/** A slide's reach over the envelope: out fast, held a beat, then friction creeps it home. */
export function slideReach(u: number): number {
  const c = clamp01(u);
  if (c <= 0.28) return easeOutCubic(c / 0.28);
  return 1 - smoothstep((c - 0.28) / 0.72);
}

/**
 * The inner-group offset (world) + tilt for a disturbed card at `elapsedMs`
 * after the strike. Zero at both ends — the card leaves its spot and comes
 * home to it, never anywhere else. Null once the envelope is over.
 */
export function disturbanceOffsetAt(p: DisturbanceParams, elapsedMs: number): { x: number; y: number; z: number; tilt: number } | null {
  const u = elapsedMs / DISTURBANCE_MS;
  if (!(u >= 0) || u >= 1) return null;
  if (p.mode === 'bounce') {
    const hopEnv = Math.pow(Math.sin(Math.PI * u), 1.3);
    const drift = slideReach(u);
    return { x: p.dirX * p.mag * drift, y: p.hop * hopEnv, z: p.dirZ * p.mag * drift, tilt: p.tilt * Math.sin(Math.PI * u) };
  }
  const reach = slideReach(u);
  return { x: p.dirX * p.mag * reach, y: p.hop * Math.sin(Math.PI * u), z: p.dirZ * p.mag * reach, tilt: p.tilt * reach * Math.sin(Math.PI * Math.min(1, u * 1.15)) };
}
