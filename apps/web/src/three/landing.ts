/**
 * Physics-style trick landing (Tips OFF only). Pure and deterministic: every client computes the same
 * resting offset from the same seed + release vector, so online tables agree without sending positions.
 * Offsets are on the table plane (world x, z) plus an in-plane spin, relative to the seat's fixed trick spot.
 */

export interface Landing { dx: number; dz: number; spin: number }
export const NO_LANDING: Landing = { dx: 0, dz: 0, spin: 0 };

/** Farthest a thrown card may rest from its seat's spot, and the spin cap (radians). */
export const MAX_SLIDE = 0.6;
export const TAP_SCATTER = 0.3;
/** about ±35° */
export const MAX_SPIN = 0.61;
/** extra random spread on a throw, world units */
export const THROW_SPREAD = 0.1;
/** Felt friction: rest distance = v² / (2·FRICTION) in world units, v in world units per second. */
export const FRICTION = 260;
/** CSS px per world unit on the felt at phone size (rough; only scales the throw). */
export const PX_PER_WORLD = 150;

/** 32-bit string hash (FNV-1a). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** mulberry32: small, fast, identical in every JS engine. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The seed every client derives for one play: game seed, hand, trick and card. Bots get one too. */
export function playSeed(gameSeed: string, handNo: number, trickNo: number, card: string): number {
  return hashSeed(`${gameSeed}|${handNo}|${trickNo}|${card}`);
}

const clampAbs = (v: number, m: number) => Math.max(-m, Math.min(m, v));

/**
 * Where a card comes to rest. `release` is the drag release velocity in screen px/ms (x right, y down);
 * none means a two-tap / bot play, which gets a varied but tasteful toss.
 */
export function restingOffset(seed: number, release?: readonly [number, number] | null): Landing {
  const r = rng(seed);
  const jitter = () => r() * 2 - 1;
  if (release && Number.isFinite(release[0]) && Number.isFinite(release[1]) && Math.hypot(release[0], release[1]) > 0.05) {
    // px/ms → world units per second on the felt; screen down is toward the viewer (+z).
    const vx = (release[0] * 1000) / PX_PER_WORLD, vz = (release[1] * 1000) / PX_PER_WORLD;
    const v = Math.hypot(vx, vz);
    const dist = Math.min(MAX_SLIDE, (v * v) / (2 * FRICTION));
    const ux = vx / v, uz = vz / v;
    // a wide random spin (±35°), nudged by the sideways flick
    const spin = clampAbs(jitter() * MAX_SPIN + Math.sign(release[0]) * Math.min(1, v / 12) * 0.12, MAX_SPIN);
    return { dx: ux * dist + jitter() * THROW_SPREAD, dz: uz * dist + jitter() * THROW_SPREAD, spin };
  }
  const a = r() * Math.PI * 2, d = Math.sqrt(r()) * TAP_SCATTER;
  return { dx: Math.cos(a) * d, dz: Math.sin(a) * d, spin: clampAbs(jitter() * MAX_SPIN, MAX_SPIN) };
}

/** A card on the table plane: centre, half sizes and in-plane spin. */
export interface FeltCard { x: number; z: number; hw: number; hh: number; spin: number }

/** The top-left corner index of a card (screen-top is -z), a little inside the corner. */
export function cornerIndex(c: FeltCard): { x: number; z: number } {
  const lx = -c.hw * 0.72, lz = -c.hh * 0.76;
  const cs = Math.cos(c.spin), sn = Math.sin(c.spin);
  return { x: c.x + lx * cs - lz * sn, z: c.z + lx * sn + lz * cs };
}

export function covers(c: FeltCard, p: { x: number; z: number }, pad = 0.03): boolean {
  const dx = p.x - c.x, dz = p.z - c.z;
  const cs = Math.cos(-c.spin), sn = Math.sin(-c.spin);
  const lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
  return Math.abs(lx) < c.hw + pad && Math.abs(lz) < c.hh + pad;
}

export interface Felt { minX: number; maxX: number; minZ: number; maxZ: number }

/** The part of the felt that is on screen and not under the hand, for card centres (world units). */
export const VISIBLE_FELT: Felt = { minX: -1.1, maxX: 1.1, minZ: -1.2, maxZ: 0.75 };

const inside = (p: { x: number; z: number }, f: Felt) => p.x >= f.minX && p.x <= f.maxX && p.z >= f.minZ && p.z <= f.maxZ;

/**
 * Keep a landing on the table and readable. Cards may overlap earlier cards, but the new (top) card's centre and
 * corner index stay on the visible felt, and it never lands squarely on top of an earlier card (the one under
 * keeps some of its face). Shrinks the offset toward the seat's fixed spot until it fits; worst case is that spot.
 */
export function clampLanding(base: { x: number; z: number }, size: { hw: number; hh: number }, land: Landing, under: readonly FeltCard[], felt: Felt): Landing {
  for (let k = 0; k <= 10; k++) {
    const f = 1 - k / 10;
    const c: FeltCard = { x: base.x + land.dx * f, z: base.z + land.dz * f, hw: size.hw, hh: size.hh, spin: land.spin * f };
    const onTable = inside(c, felt) && inside(cornerIndex(c), felt);
    const notStacked = under.every((u) => Math.hypot(u.x - c.x, u.z - c.z) >= size.hw * 0.7);
    if ((onTable && notStacked) || k === 10) return k === 10 ? { dx: 0, dz: 0, spin: land.spin * 0.5 } : { dx: land.dx * f, dz: land.dz * f, spin: land.spin * f };
  }
  return NO_LANDING;
}

/** Tips ON keeps the fixed per-seat spots; Tips OFF lands where it was thrown. Decided per viewer. */
export function landingMode(tipsOn: boolean): 'fixed' | 'physics' {
  return tipsOn ? 'fixed' : 'physics';
}

/** Fixed spot centre on the felt for a landing computed against `trickSpot` (x, z of its position). */
export function landTrick(
  plays: readonly { card: string; rel?: readonly [number, number] }[],
  spots: readonly { x: number; z: number }[],
  size: { hw: number; hh: number },
  seedOf: (card: string) => number,
  felt: Felt,
): Landing[] {
  const down: FeltCard[] = [];
  return plays.map((pl, i) => {
    const base = spots[i]!;
    const land = clampLanding(base, size, restingOffset(seedOf(pl.card), pl.rel ?? null), down, felt);
    down.push({ x: base.x + land.dx, z: base.z + land.dz, hw: size.hw, hh: size.hh, spin: land.spin });
    return land;
  });
}

/** 'Run it!' drop: how the claimer's cards are thrown down before the tornado. Same physics as a Tips-off landing. */
export interface RunDrop extends Landing { delay: number }
/** Felt friction for the run drop (softer than a trick play: the cards are thrown down hard and slide further). */
export const RUN_FRICTION = 90;
export const RUN_MAX_SLIDE = 0.5;
export const RUN_MAX_SPIN = 0.9;
/** Half-extents of the patch of felt the dropped cards may rest on (world units, around the table centre). */
export const RUN_AREA = { hx: 0.95, zMin: -0.7, zMax: 0.25 };
/** The whole drop must land within this (s) so the tornado takes settled cards. */
export const RUN_DROP_WINDOW = 1.1;

/**
 * Where each of the claimer's k cards comes to rest (offsets from the table centre, on the felt plane),
 * plus when it is let go. Deterministic from the seed, so every client sees the same pile.
 */
export function runScatter(seed: number, k: number): RunDrop[] {
  const r = rng(seed);
  const j = () => r() * 2 - 1;
  const step = k > 1 ? Math.min(0.07, RUN_DROP_WINDOW / k) : 0;
  const out: RunDrop[] = [];
  for (let i = 0; i < k; i++) {
    // thrown away from the claimer, fanning left and right: speed sets the slide, friction stops it
    const ang = j() * 0.75;
    const v = 6 + r() * 4.5;
    const dist = Math.min(RUN_MAX_SLIDE, (v * v) / (2 * RUN_FRICTION));
    const row = k > 1 ? (i / (k - 1) - 0.5) * 1.1 : 0; // where it was let go along the drop line
    let dx = row + Math.sin(ang) * dist + j() * 0.08;
    let dz = 0.1 - Math.cos(ang) * dist + j() * 0.08;
    // never squarely on top of another card: nudge sideways until the index of the one below shows
    for (let tries = 0; tries < 6 && out.some((o) => Math.abs(o.dx - dx) < 0.12 && Math.abs(o.dz - dz) < 0.16); tries++) {
      dx += (j() >= 0 ? 1 : -1) * 0.14; dz += j() * 0.06;
    }
    dx = clampAbs(dx, RUN_AREA.hx);
    dz = Math.max(RUN_AREA.zMin, Math.min(RUN_AREA.zMax, dz));
    out.push({ dx, dz, spin: clampAbs(j() * RUN_MAX_SPIN, RUN_MAX_SPIN), delay: i * step });
  }
  return out;
}
