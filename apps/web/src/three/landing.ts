/**
 * Physics-style trick landing (Tips OFF only). Pure and deterministic: every client computes the same
 * resting offset from the same seed + release vector, so online tables agree without sending positions.
 * Offsets are on the table plane (world x, z) plus an in-plane spin, relative to the seat's fixed trick spot.
 */

export interface Landing { dx: number; dz: number; spin: number }
export const NO_LANDING: Landing = { dx: 0, dz: 0, spin: 0 };

/** Farthest a thrown card may rest from its seat's spot, and the spin cap (radians). */
export const MAX_SLIDE = 0.2;
export const TAP_SCATTER = 0.07;
export const MAX_SPIN = 0.32;
/** Felt friction: rest distance = v² / (2·FRICTION) in world units, v in world units per second. */
export const FRICTION = 400;
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
    const spin = clampAbs(jitter() * 0.12 + Math.sign(release[0]) * Math.min(1, v / 12) * 0.22, MAX_SPIN);
    return { dx: ux * dist + jitter() * 0.015, dz: uz * dist + jitter() * 0.015, spin };
  }
  const a = r() * Math.PI * 2, d = Math.sqrt(r()) * TAP_SCATTER;
  return { dx: Math.cos(a) * d, dz: Math.sin(a) * d, spin: clampAbs(jitter() * 0.18, MAX_SPIN) };
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

/**
 * Keep a landing on the felt and off the corner index of every card already down. Shrinks the offset
 * toward the seat's fixed spot (which never overlaps) until it fits; worst case is the fixed spot.
 */
export function clampLanding(base: { x: number; z: number }, size: { hw: number; hh: number }, land: Landing, under: readonly FeltCard[], felt: Felt): Landing {
  for (let k = 0; k <= 8; k++) {
    const f = 1 - k / 8;
    const c: FeltCard = { x: base.x + land.dx * f, z: base.z + land.dz * f, hw: size.hw, hh: size.hh, spin: land.spin * f };
    const r = Math.hypot(c.hw, c.hh);
    const onFelt = c.x - r * 0.6 >= felt.minX && c.x + r * 0.6 <= felt.maxX && c.z - r * 0.6 >= felt.minZ && c.z + r * 0.6 <= felt.maxZ;
    const clear = under.every((u) => !covers(c, cornerIndex(u)));
    // stay readable: its own index must not be pushed off the felt either
    if ((onFelt && clear) || k === 8) return { dx: land.dx * f, dz: land.dz * f, spin: land.spin * f };
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
