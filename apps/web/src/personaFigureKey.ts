/**
 * Persona figure keys (regular-table bot bodies, owner go 2026-10-29).
 *
 * A bot seat's figure key is the SAME `<persona>-<gender>` key its
 * portrait plate uses (PersonaFace.tsx: personaForName x voiceGender
 * from @spades/bots), so the face and the body at a seat can never
 * disagree. Only keys whose rigged GLB has actually shipped resolve —
 * an unbuilt persona returns null and the seat keeps the portrait
 * treatment exactly as today. The GLBs live at
 * /assets/figures/personas/<key>.glb (three/PersonaFigures.tsx).
 *
 * Batch A (2026-10-30): coach-f (Ingrid), mama-m, influencer-f, og-m,
 * hype-f, smooth-m. Batch B (2026-10-30): barber-f, barber-m, coach-m,
 * comedian-f, conspiracy-f, conspiracy-m, deacon-f, deacon-m, gambler-m,
 * hothead-f, hothead-m, hustler-m, influencer-m, lilcuz-f, lilcuz-m,
 * mama-f, og-f, petty-f, petty-m, professor-m, silent-m, smooth-f,
 * storyteller-f, storyteller-m. Batch C (2026-10-30) completes the
 * roster: comedian-m, gambler-f, hustler-f, hype-m, professor-f,
 * silent-f, sorelose-f, sorelose-m — all 38 persona x gender keys now
 * ship a figure, so every non-empty bot name resolves.
 */
import { personaForName, voiceGender } from '@spades/bots';

export const PERSONA_FIGURE_KEYS: readonly string[] = [
  'barber-f',
  'barber-m',
  'coach-f',
  'coach-m',
  'comedian-f',
  'comedian-m',
  'conspiracy-f',
  'conspiracy-m',
  'deacon-f',
  'deacon-m',
  'gambler-f',
  'gambler-m',
  'hothead-f',
  'hothead-m',
  'hustler-f',
  'hustler-m',
  'hype-f',
  'hype-m',
  'influencer-f',
  'influencer-m',
  'lilcuz-f',
  'lilcuz-m',
  'mama-f',
  'mama-m',
  'og-f',
  'og-m',
  'petty-f',
  'petty-m',
  'professor-f',
  'professor-m',
  'silent-f',
  'silent-m',
  'smooth-f',
  'smooth-m',
  'sorelose-f',
  'sorelose-m',
  'storyteller-f',
  'storyteller-m',
];

const SHIPPED = new Set(PERSONA_FIGURE_KEYS);

/** The shipped figure key for a bot's display name, or null when the
 *  name is empty (with the roster complete, every persona x gender
 *  key has a figure). */
export function personaFigureKeyForName(name: string): string | null {
  if (!name) return null;
  const key = `${personaForName(name)}-${voiceGender(name)}`;
  return SHIPPED.has(key) ? key : null;
}
