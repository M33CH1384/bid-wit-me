/**
 * Living scene — per-stop motion character (owner pick, 2026-10-25:
 * "Both — living scene everywhere, video at the big stops").
 *
 * The living staging engine lives in ScriptPlayer + story.css and is
 * ONE engine for the whole route — no per-stop fork. What varies by
 * stop is DATA: the seated pair and the backdrop arrive through the
 * player's existing props, and the scene's motion character arrives
 * through here. Each stop's mood is a row of numbers/colors consumed
 * as CSS custom properties (--lv-*) on the scene root; story.css
 * carries the Porch values as the var() fallbacks, so a living render
 * with no mood IS the shipped Porch staging, value for value.
 *
 * The registers follow the route's own classes (the talk-density
 * classes, 2026-10-22): lively/loud stops breathe quicker and glow
 * warmer and stronger; tense/cold stops breathe slower and dimmer;
 * slow stops barely move; the King is the slowest and heaviest — the
 * visual mix bows under him like the audio one does. Speaker focus,
 * dimming, the cast strip and every beat stay the engine's, identical
 * at every stop.
 *
 * VIDEO (owner pick, 2026-10-25: "video at the big stops"): the three
 * BIG stops below are where a silent clip takes over the stage. The
 * living render stays mounted underneath as the base layer there — it
 * is the clip's loading state and its reduced-effects/static fallback —
 * so this table is the one place that knows which stops are big, and
 * the clip table at the bottom is the one place that knows their files.
 */
import type { CSSProperties } from 'react';

export type LivingRegister = 'lively' | 'loud' | 'steady' | 'slow' | 'tense' | 'cold' | 'climax';

export interface LivingMood {
  /** the stop id this mood stages */
  id: string;
  /** the route class the mood's pacing follows */
  register: LivingRegister;
  /** big stop: the video phase mounts its clip over this living base */
  big?: boolean;
  /** backdrop slow-scale (the "breathe") duration, seconds */
  breatheSec: number;
  /** backdrop scale endpoint (1 = still) */
  swell: number;
  /** light-play pulse duration, seconds */
  glowSec: number;
  /** glow opacity at the pulse's floor / peak */
  glowLo: number;
  glowHi: number;
  /** glow gradient core / shoulder (rgba, alpha baked in) */
  glowA: string;
  glowB: string;
  /** drifting-air duration, seconds */
  hazeSec: number;
  /** dust-in-light drift duration, seconds (Wave D: motes in the glow) */
  dustSec: number;
  /** haze gradient blobs (rgba, alpha baked in) */
  hazeA: string;
  hazeB: string;
  /** stage idle-bob durations for the left / right figure, seconds */
  bobLeftSec: number;
  bobRightSec: number;
  /** bob travel in px (negative = rises) */
  bobAmpPx: number;
}

/**
 * The Porch mood IS the shipped sample (2026-10-24, eb09c155): every
 * value below is a value the sample shipped with, and it doubles as
 * the fallback mood for any stop id without a row of its own.
 */
export const PORCH_LIVING_MOOD: LivingMood = {
  id: 'porch', register: 'lively',
  breatheSec: 36, swell: 1.07,
  glowSec: 7, glowLo: 0.55, glowHi: 1,
  glowA: 'rgba(255, 186, 92, 0.34)', glowB: 'rgba(255, 160, 64, 0.12)',
  hazeSec: 26, dustSec: 21, hazeA: 'rgba(255, 214, 150, 0.10)', hazeB: 'rgba(255, 200, 130, 0.08)',
  bobLeftSec: 9, bobRightSec: 11, bobAmpPx: -7,
};

export const LIVING_MOODS: readonly LivingMood[] = [
  PORCH_LIVING_MOOD,
  { // The Barbershop — steady: old-head calm, warm light, slower air
    id: 'barbershop', register: 'steady',
    breatheSec: 44, swell: 1.05,
    glowSec: 9, glowLo: 0.5, glowHi: 0.95,
    glowA: 'rgba(255, 176, 102, 0.30)', glowB: 'rgba(255, 150, 80, 0.10)',
    hazeSec: 32, dustSec: 26, hazeA: 'rgba(255, 210, 150, 0.08)', hazeB: 'rgba(255, 195, 130, 0.06)',
    bobLeftSec: 11, bobRightSec: 13, bobAmpPx: -6,
  },
  { // The Rec Center — loud: gym-bright, quickest breathe on the route
    id: 'rec-center', register: 'loud',
    breatheSec: 30, swell: 1.08,
    glowSec: 6, glowLo: 0.6, glowHi: 1,
    glowA: 'rgba(255, 226, 160, 0.36)', glowB: 'rgba(255, 205, 110, 0.13)',
    hazeSec: 22, dustSec: 18, hazeA: 'rgba(255, 230, 170, 0.11)', hazeB: 'rgba(255, 215, 140, 0.09)',
    bobLeftSec: 8, bobRightSec: 10, bobAmpPx: -8,
  },
  { // The Cookout — loud: golden-hour backyard, grill-warm haze
    id: 'cookout', register: 'loud',
    breatheSec: 32, swell: 1.08,
    glowSec: 6.5, glowLo: 0.55, glowHi: 1,
    glowA: 'rgba(255, 170, 80, 0.36)', glowB: 'rgba(255, 140, 60, 0.13)',
    hazeSec: 24, dustSec: 20, hazeA: 'rgba(255, 200, 130, 0.11)', hazeB: 'rgba(255, 180, 110, 0.09)',
    bobLeftSec: 8, bobRightSec: 10, bobAmpPx: -8,
  },
  { // The Corner — tense: cold streetlight, everything pulled in
    id: 'corner', register: 'tense',
    breatheSec: 52, swell: 1.04,
    glowSec: 11, glowLo: 0.35, glowHi: 0.8,
    glowA: 'rgba(170, 190, 220, 0.22)', glowB: 'rgba(140, 160, 200, 0.08)',
    hazeSec: 38, dustSec: 31, hazeA: 'rgba(180, 195, 220, 0.07)', hazeB: 'rgba(160, 180, 210, 0.05)',
    bobLeftSec: 13, bobRightSec: 15, bobAmpPx: -5,
  },
  { // The Church Basement — slow: soft light, near-still air
    id: 'church-basement', register: 'slow',
    breatheSec: 56, swell: 1.03,
    glowSec: 12, glowLo: 0.5, glowHi: 0.9,
    glowA: 'rgba(255, 240, 205, 0.26)', glowB: 'rgba(250, 230, 190, 0.09)',
    hazeSec: 40, dustSec: 33, hazeA: 'rgba(255, 244, 214, 0.07)', hazeB: 'rgba(250, 236, 200, 0.05)',
    bobLeftSec: 13, bobRightSec: 16, bobAmpPx: -5,
  },
  { // The Rooftop — slow: dusk air over the block
    id: 'rooftop', register: 'slow',
    breatheSec: 50, swell: 1.05,
    glowSec: 10, glowLo: 0.45, glowHi: 0.9,
    glowA: 'rgba(255, 170, 120, 0.26)', glowB: 'rgba(190, 130, 200, 0.09)',
    hazeSec: 34, dustSec: 28, hazeA: 'rgba(255, 190, 140, 0.08)', hazeB: 'rgba(170, 140, 220, 0.06)',
    bobLeftSec: 12, bobRightSec: 14, bobAmpPx: -6,
  },
  { // The High-Rise — cold: steel and glass, measured movement
    id: 'high-rise', register: 'cold',
    breatheSec: 48, swell: 1.04,
    glowSec: 10, glowLo: 0.4, glowHi: 0.85,
    glowA: 'rgba(160, 200, 255, 0.24)', glowB: 'rgba(120, 170, 240, 0.09)',
    hazeSec: 36, dustSec: 30, hazeA: 'rgba(190, 215, 255, 0.07)', hazeB: 'rgba(165, 195, 245, 0.05)',
    bobLeftSec: 12, bobRightSec: 14, bobAmpPx: -5,
  },
  { // The Pj's — tense, BIG: sodium streetlight + grill smoke, slow
    id: 'the-pjs', register: 'tense', big: true,
    breatheSec: 54, swell: 1.04,
    glowSec: 11, glowLo: 0.4, glowHi: 0.9,
    glowA: 'rgba(255, 160, 70, 0.28)', glowB: 'rgba(255, 130, 50, 0.10)',
    hazeSec: 40, dustSec: 33, hazeA: 'rgba(255, 190, 120, 0.10)', hazeB: 'rgba(255, 170, 100, 0.08)',
    bobLeftSec: 13, bobRightSec: 15, bobAmpPx: -5,
  },
  { // The Legends' Table — steady, BIG: stately Vegas gold
    id: 'legends', register: 'steady', big: true,
    breatheSec: 46, swell: 1.05,
    glowSec: 9, glowLo: 0.5, glowHi: 0.95,
    glowA: 'rgba(255, 200, 110, 0.32)', glowB: 'rgba(240, 180, 90, 0.11)',
    hazeSec: 34, dustSec: 28, hazeA: 'rgba(255, 214, 150, 0.09)', hazeB: 'rgba(245, 200, 130, 0.07)',
    bobLeftSec: 11, bobRightSec: 13, bobAmpPx: -6,
  },
  { // The King of the Block — climax, BIG: the slowest push-in on the
    // route and a glow that stays LOW — the room bows under him
    id: 'king', register: 'climax', big: true,
    breatheSec: 60, swell: 1.06,
    glowSec: 13, glowLo: 0.3, glowHi: 0.75,
    glowA: 'rgba(255, 140, 60, 0.24)', glowB: 'rgba(200, 80, 40, 0.09)',
    hazeSec: 44, dustSec: 37, hazeA: 'rgba(255, 170, 110, 0.07)', hazeB: 'rgba(230, 140, 90, 0.05)',
    bobLeftSec: 14, bobRightSec: 17, bobAmpPx: -4,
  },
];

const MOOD_BY_STOP: ReadonlyMap<string, LivingMood> = new Map(LIVING_MOODS.map((m) => [m.id, m]));

/** The motion character for a stop's living scene. An unknown id gets
 *  the Porch mood — the shipped sample's staging — never a fork. */
export function livingMoodFor(stopId: string): LivingMood {
  return MOOD_BY_STOP.get(stopId) ?? PORCH_LIVING_MOOD;
}

/**
 * A big stop's intro clip. The files are SILENT by construction — the
 * encode carries no audio stream at all — so the scene's cast
 * recordings / text play over the clip through the beat engine, per
 * the voice fence. Produced 2026-10-25 (identity-gated per character;
 * QC.md in ~/workspace/your_files/big-stop-videos/).
 */
export interface LivingClip {
  src: string;
  /** poster frame: paints instantly, the clip fades in over it once playing */
  poster: string;
}

const LIVING_CLIPS: Readonly<Record<string, LivingClip>> = {
  king: {
    src: '/assets/story/videos/king-intro.mp4',
    poster: '/assets/story/videos/king-intro-poster.webp',
  },
  legends: {
    src: '/assets/story/videos/legends-intro.mp4',
    poster: '/assets/story/videos/legends-intro-poster.webp',
  },
  'the-pjs': {
    src: '/assets/story/videos/pjs-intro.mp4',
    poster: '/assets/story/videos/pjs-intro-poster.webp',
  },
};

/** The stop's intro clip, or null: only the mood table's `big` rows
 *  carry one, and only the three produced stops have files. */
export function livingClipFor(mood: LivingMood): LivingClip | null {
  if (!mood.big) return null;
  return LIVING_CLIPS[mood.id] ?? null;
}

/** The mood as CSS custom properties for the scene root. story.css
 *  reads exactly these names (with the Porch values as fallbacks). */
export function livingMoodVars(mood: LivingMood): CSSProperties {
  return {
    '--lv-breathe': `${mood.breatheSec}s`,
    '--lv-swell': `${mood.swell}`,
    '--lv-glow-dur': `${mood.glowSec}s`,
    '--lv-glow-lo': `${mood.glowLo}`,
    '--lv-glow-hi': `${mood.glowHi}`,
    '--lv-glow-a': mood.glowA,
    '--lv-glow-b': mood.glowB,
    '--lv-haze-dur': `${mood.hazeSec}s`,
    '--lv-dust-dur': `${mood.dustSec}s`,
    '--lv-haze-a': mood.hazeA,
    '--lv-haze-b': mood.hazeB,
    '--lv-bob-l': `${mood.bobLeftSec}s`,
    '--lv-bob-r': `${mood.bobRightSec}s`,
    '--lv-bob-amp': `${mood.bobAmpPx}px`,
  } as CSSProperties;
}
