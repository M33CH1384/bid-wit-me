/**
 * Recap / victory surfaces — Wave B rebuild (program rows: Down to the Wire,
 * Photo Finish, Victory Confetti). HyperFrames code-lane: every visual is a
 * pure, seekable function of elapsed time and a seed — no Math.random, no
 * Date.now in any output path — so a frame can be graded, replayed and unit
 * tested without a clock.
 *
 * HELD TIMINGS (the unmodified contract, ±10% of shipped):
 *  - Down to the Wire: 900 ms shot (calm 750 ms); shipped CSS pulse .88 s.
 *  - Photo Finish:     3000 ms stamp, unchanged.
 *  - Victory Confetti: 2300 ms shot (calm 1300 ms); piece fall 2.15 s.
 * Triggers stay where they have always lived (animfx/detect.ts, read-only
 * here): wireSides / photoFinish / the result's winners. This module owns
 * only the rebuilt visuals' geometry and timing.
 */

/* ------------------------------------------------------------- shared ---- */

/** Deterministic 0..1 hash (the codebase's sin-hash family). */
export function recapHash(i: number, salt: number): number {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (t: number) => 1 - (1 - t) ** 3;

/* ------------------------------------------------- Down to the Wire ----- */

export const WIRE_MS = 900;
export const WIRE_STILL_MS = 750;

export interface WireGlow {
  /** Inset edge line thickness (px). */
  edgePx: number;
  /** Inset edge line alpha 0..1. */
  edgeAlpha: number;
  /** Inner glow blur reach (px). */
  glowPx: number;
  /** Inner glow alpha 0..1. */
  glowAlpha: number;
  /** Overall envelope 0..1 (1 at the held-breath peak). */
  breath: number;
}

/**
 * The table's edge light, tightened like a held breath: a fast inhale to
 * ~30%, a HOLD that keeps tightening to the peak at ~62% (the shipped pulse
 * peaked and immediately released — the rebuild holds the breath), then a
 * slow exhale to zero at the end of the shot. The calm/still read is one
 * low, brief outline with no glow bloom.
 */
export function wireGlowAt(tMs: number, still = false): WireGlow {
  const dur = still ? WIRE_STILL_MS : WIRE_MS;
  const t = clamp01(tMs / dur);
  let breath: number;
  if (still) {
    breath = t < 0.3 ? easeOut(t / 0.3) : 1 - easeOut((t - 0.3) / 0.7);
    breath *= 0.9;
  } else if (t < 0.3) {
    breath = 0.72 * easeOut(t / 0.3);
  } else if (t < 0.62) {
    breath = 0.72 + 0.28 * easeOut((t - 0.3) / 0.32);
  } else {
    breath = 1 - easeOut((t - 0.62) / 0.38);
  }
  return {
    edgePx: still ? 2 : 3 * breath,
    edgeAlpha: (still ? 0.7 : 0.75) * breath,
    glowPx: still ? 0 : 46 * breath,
    glowAlpha: (still ? 0 : 0.4) * breath,
    breath,
  };
}

/** The wire's box-shadow for a frame (both layers, shipped colours). */
export function wireShadowAt(tMs: number, still = false): string {
  const g = wireGlowAt(tMs, still);
  return `inset 0 0 0 ${g.edgePx.toFixed(2)}px rgba(255, 190, 90, ${g.edgeAlpha.toFixed(3)}), inset 0 0 ${g.glowPx.toFixed(1)}px rgba(255, 120, 40, ${g.glowAlpha.toFixed(3)})`;
}

/* ---------------------------------------------------- Photo Finish ------ */

export const PHOTO_MS = 3000;
/** The tape snaps across in the first 450 ms; scores print by 700 ms. */
export const PHOTO_TAPE_SNAP_MS = 450;
export const PHOTO_SCORES_IN_MS = 700;

/** Finish-line tape segments: alternating check, deterministic count. */
export function photoTapeSegments(count = 28): boolean[] {
  return Array.from({ length: count }, (_, i) => i % 2 === 0);
}

export interface PhotoTapeFrame {
  /** Tape scaleX 0..1 with a snap overshoot (peaks ~1.06 mid-snap). */
  tape: number;
  /** Tape opacity. */
  tapeAlpha: number;
  /** Headline opacity (rides the snap). */
  headAlpha: number;
  /** Scores-line opacity (prints after the tape lands). */
  scoresAlpha: number;
  /** Whole-card envelope: fades out over the final 400 ms of the 3 s hold. */
  out: number;
}

export function photoTapeAt(tMs: number): PhotoTapeFrame {
  const snapT = clamp01(tMs / PHOTO_TAPE_SNAP_MS);
  // Overshoot ease: out-back — races past full width, settles back to 1.
  const s = 1.70158;
  const u = snapT - 1;
  const tape = 1 + (s + 1) * u ** 3 + s * u ** 2;
  const scoresAlpha = easeOut(clamp01((tMs - PHOTO_TAPE_SNAP_MS) / (PHOTO_SCORES_IN_MS - PHOTO_TAPE_SNAP_MS)));
  const out = tMs <= PHOTO_MS - 400 ? 1 : 1 - easeOut((tMs - (PHOTO_MS - 400)) / 400);
  return {
    tape: snapT >= 1 ? 1 : Math.max(0, tape),
    tapeAlpha: clamp01(tMs / 60),
    headAlpha: easeOut(clamp01(tMs / 220)),
    scoresAlpha,
    out,
  };
}

/** The scores line printed at the tape: real final scores only. */
export function photoScoresLine(winnerScore: number, loserScore: number, margin: number): string {
  return `${winnerScore} — ${loserScore} · decided by ${margin}`;
}

/* ------------------------------------------------- Victory Confetti ----- */

export const CONFETTI_MS = 2300;
export const CONFETTI_STILL_MS = 1300;
export const CONFETTI_FALL_MS = 2150;
/** Shipped piece counts — the particle budget does not grow. */
export const CONFETTI_COUNT = 24;
export const CONFETTI_STILL_COUNT = 8;
/** The shipped gold palette (the winning side's colours may replace it). */
export const CONFETTI_GOLDS: readonly string[] = ['#ffd940', '#f5c542', '#fff0c4', '#ffb52e'];

export interface ConfettiPiece {
  /** Left position, % of the surface width. */
  l: number;
  /** Horizontal drift over the fall, px (the shipped --dx range). */
  dx: number;
  /** Start delay, ms. */
  d: number;
  /** Total tumble over the fall, deg (the shipped --rot range). */
  r: number;
  /** Glyph size, px. */
  s: number;
  /** Colour (winning side's palette, cycled deterministically). */
  c: string;
  /** Flutter sway amplitude, px. */
  sway: number;
  /** Flutter sway frequency, Hz. */
  swayHz: number;
  /** Face-flip frequency, Hz (the piece turns edge-on as it flutters). */
  flipHz: number;
  /** Rect chip instead of a spade glyph (every 4th piece). */
  chip: boolean;
}

/**
 * The rain, as a deterministic function of a seed string (the match seed):
 * the same game rains the same confetti on every device and every render.
 * With no seed the shipped index scatter is reproduced exactly in l/dx/d/r/s.
 */
export function confettiPieces(seed: string | null, still = false, colors: readonly string[] = CONFETTI_GOLDS): ConfettiPiece[] {
  const n = still ? CONFETTI_STILL_COUNT : CONFETTI_COUNT;
  let seedN = 0;
  if (seed) { for (const ch of seed) seedN = (seedN * 31 + ch.charCodeAt(0)) | 0; }
  return Array.from({ length: n }, (_, i) => {
    const base = seed ? seededPiece(i, seedN) : legacyPiece(i);
    return {
      ...base,
      c: colors[i % colors.length]!,
      sway: 10 + recapHash(i, 41) * 22,
      swayHz: 0.7 + recapHash(i, 43) * 0.9,
      flipHz: 1.1 + recapHash(i, 47) * 1.6,
      chip: i % 4 === 3,
    };
  });
}

function legacyPiece(i: number): Pick<ConfettiPiece, 'l' | 'dx' | 'd' | 'r' | 's'> {
  const h1 = Math.abs(Math.sin(i * 127.1 + 311.7));
  const h2 = Math.abs(Math.sin(i * 269.5 + 183.3));
  const h3 = Math.abs(Math.sin(i * 113.5 + 47.9));
  return {
    l: 3 + h1 * 94,
    dx: Math.round((h2 - 0.5) * 130),
    d: Math.round(h3 * 550),
    r: Math.round((h1 - 0.5) * 560),
    s: 13 + Math.round(h2 * 9),
  };
}

function seededPiece(i: number, seedN: number): Pick<ConfettiPiece, 'l' | 'dx' | 'd' | 'r' | 's'> {
  const h1 = recapHash(i + (seedN % 89), 3);
  const h2 = recapHash(i + (seedN % 89), 5);
  const h3 = recapHash(i + (seedN % 89), 7);
  return {
    l: 3 + h1 * 94,
    dx: Math.round((h2 - 0.5) * 130),
    d: Math.round(h3 * 550),
    r: Math.round((h1 - 0.5) * 560),
    s: 13 + Math.round(h2 * 9),
  };
}

export interface ConfettiPose {
  /** X position, px from the surface's left edge. */
  x: number;
  /** Y position, px from the surface's top edge. */
  y: number;
  /** Tumble rotation, deg. */
  rot: number;
  /** Face-on factor 0..1 (scaleX of the flutter — 0 = edge-on). */
  face: number;
  /** 0..1 opacity (the shipped envelope: in by 8%, out from 86%). */
  opacity: number;
  visible: boolean;
}

/**
 * One piece at one moment — real flutter physics as a closed form: gravity
 * ease-in fall (the shipped cubic-bezier(.25,.5,.45,1) approximated by the
 * same easeInQuad blend), sinusoidal sway, and a face flip that turns the
 * piece edge-on twice per flutter cycle. Pure in (piece, tMs, w, h).
 */
export function confettiPieceAt(p: ConfettiPiece, tMs: number, widthPx: number, heightPx: number): ConfettiPose {
  const local = tMs - p.d;
  if (local < 0) return { x: 0, y: 0, rot: 0, face: 1, opacity: 0, visible: false };
  const ft = clamp01(local / CONFETTI_FALL_MS);
  const fall = ft * ft * 0.55 + ft * 0.45; // ease-in blend, lands at 1
  const secs = local / 1000;
  const swayX = Math.sin(secs * p.swayHz * Math.PI * 2) * p.sway * (0.35 + 0.65 * ft);
  const x = (p.l / 100) * widthPx + p.dx * fall + swayX;
  const y = -0.06 * heightPx + fall * 1.18 * heightPx;
  const rot = p.r * fall + Math.sin(secs * p.swayHz * Math.PI * 2 + 1.3) * 24;
  const face = Math.abs(Math.cos(secs * p.flipHz * Math.PI));
  const opacity = ft < 0.08 ? ft / 0.08 : ft > 0.86 ? 1 - (ft - 0.86) / 0.14 : 1;
  return { x, y, rot, face, opacity, visible: ft < 1 };
}

/** The calm read: pieces rest near the top and fade (shipped still frame). */
export function confettiStillPose(p: ConfettiPiece, widthPx: number): ConfettiPose {
  return { x: (p.l / 100) * widthPx + p.dx * 0.1, y: 0, rot: p.r * 0.15, face: 1, opacity: 1, visible: true };
}
