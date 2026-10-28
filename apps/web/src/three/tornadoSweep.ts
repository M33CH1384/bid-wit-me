/**
 * The Run it! funnel. Once it has taken a card, clearing the clock must not
 * put that card back on its spot. That restore is the previous trick and the
 * old hand flashing onto the felt before the recap.
 */

export interface TornadoCardState {
  /** The funnel has started moving this card. */
  taken: boolean;
  /** The card has left and must not return for the rest of this mount. */
  gone: boolean;
  visible: boolean;
}

/**
 * `fx.tornado` is null, or the funnel has not reached this card yet.
 * A card still on its spot is left alone. A card the funnel has taken stays invisible.
 */
export function releaseTornadoCard(card: TornadoCardState): TornadoCardState {
  if (card.gone || card.taken) return { taken: true, gone: true, visible: false };
  return card;
}

/**
 * The card has left the table. 1.9s is the fling (Tornado3D). Reduce effects
 * shrinks the card away instead, and that counts as gone too.
 */
export function tornadoCardLeft(tt: number, scale: number): boolean {
  return tt >= 1.9 || scale <= 0.002;
}

/* ---------------------------------------------------------------------------
 * SWEEP CHOREOGRAPHY (Wave B rebuild, program row "Run It sweep"): the
 * card-path geometry extracted from Card3D's inline math into a pure,
 * seekable timeline — a pose is a function of (card, tt) only, so any frame
 * can be graded, replayed or tested without a clock. The numbers are the
 * shipped choreography, unchanged: 0.5 s cubic pull-in, funnel rise over
 * 1.3 s, fling from 1.25 s, gone at 1.9 s (tornadoCardLeft above). Claim,
 * timing and audio behaviour live elsewhere and are untouched. The one
 * addition is `bank`: the card rolls into its turn proportional to angular
 * velocity — a read-only extra a consumer may apply; ignoring it reproduces
 * the shipped flight exactly.
 * ------------------------------------------------------------------------ */

/** Stable per-card seed from the card's name (Card3D's shipped hash). */
export function sweepSeedFor(name: string): number {
  let h = 7;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}

/** The shipped sin-hash random for seed slot `k` — deterministic, 0..1. */
export function sweepRand(seed: number, k: number): number {
  const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export interface SweepCardParams {
  /** Starting angle around the funnel (rad). */
  a0: number;
  /** Per-card height factor 0..1 (higher cards ride the funnel taller). */
  h0: number;
  /** Seconds before this card starts moving. */
  delay: number;
  /** Tumble axis (unit vector). */
  axis: readonly [number, number, number];
}

/** A card's sweep parameters, derived from its resting spot + name seed. */
export function sweepParamsFor(name: string, restX: number, restZ: number, fromHand: boolean): SweepCardParams {
  const seed = sweepSeedFor(name);
  const r = (k: number) => sweepRand(seed, k);
  const ax = r(4) - 0.5, ay = r(5) - 0.5, az = r(6) - 0.5;
  const len = Math.hypot(ax, ay, az) || 1;
  return {
    a0: Math.atan2(restZ, restX) + (r(1) - 0.5) * 0.8,
    h0: r(2),
    delay: (fromHand ? 0 : 0.1) + r(3) * 0.2,
    axis: [ax / len, ay / len, az / len],
  };
}

export interface SweepPose {
  /** Local sweep time (seconds since the funnel started, minus the card's delay). */
  tt: number;
  /** Cubic pull-in 0..1 over the first 0.5 s of tt. */
  pull: number;
  /** World funnel spot (the consumer offsets it from the card's resting spot). */
  x: number;
  y: number;
  z: number;
  /** Tumble angle (rad) about the card's axis. */
  spin: number;
  /** Roll into the turn (rad) — angular-velocity bank, the rebuild's addition. */
  bank: number;
  /** Scale factor before the consumer's size normalisation (reduced: the shrink). */
  scale: number;
  /** The card has left and must not return (tornadoCardLeft on this pose). */
  left: boolean;
}

/** The fling starts at 1.25 s of local sweep time. */
export const SWEEP_FLING_S = 1.25;

/** The pose of a swept card at local sweep time `tt` (seconds). Pure. */
export function sweepPoseAt(p: SweepCardParams, tt: number, reduced = false): SweepPose {
  const t = Math.max(0, tt);
  const pull = t <= 0 ? 0 : 1 - (1 - Math.min(1, t / 0.5)) ** 3;
  if (reduced) {
    const scale = Math.max(0.001, 1 - Math.max(0, (t - 0.35) / 0.4));
    return { tt: t, pull, x: 0, y: 0.06, z: 0, spin: 0, bank: 0, scale, left: tornadoCardLeft(t, scale) };
  }
  const height = 0.12 + 1.35 * Math.min(1, t / 1.3) * (0.35 + 0.65 * p.h0);
  let radius = 0.1 + 0.3 * (height / 1.5);
  let y = height;
  if (t > SWEEP_FLING_S) { const f = t - SWEEP_FLING_S; radius += 9 * f * f + 1.5 * f; y += 2.2 * f; }
  const angVel = (6.5 + 4 * (1 - p.h0)) + 2 * 1.5 * t;
  const ang = p.a0 + t * (6.5 + 4 * (1 - p.h0)) + t * t * 1.5;
  const spin = t * 9;
  const scale = 1;
  return {
    tt: t, pull,
    x: Math.cos(ang) * radius, y, z: Math.sin(ang) * radius,
    spin,
    bank: Math.min(0.6, angVel * 0.045) * pull,
    scale,
    left: tornadoCardLeft(t, scale),
  };
}
