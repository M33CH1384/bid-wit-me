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
 * storyteller-f, storyteller-m. Batch C extends this list as the
 * remaining figures ship.
 */
import { personaForName, voiceGender } from '@spades/bots';

export const PERSONA_FIGURE_KEYS: readonly string[] = [
  'barber-f',
  'barber-m',
  'coach-f',
  'coach-m',
  'comedian-f',
  'conspiracy-f',
  'conspiracy-m',
  'deacon-f',
  'deacon-m',
  'gambler-m',
  'hothead-f',
  'hothead-m',
  'hustler-m',
  'hype-f',
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
  'professor-m',
  'silent-m',
  'smooth-f',
  'smooth-m',
  'storyteller-f',
  'storyteller-m',
];

const SHIPPED = new Set(PERSONA_FIGURE_KEYS);

/** The shipped figure key for a bot's display name, or null when that
 *  persona has no figure yet (or the name is empty). */
export function personaFigureKeyForName(name: string): string | null {
  if (!name) return null;
  const key = `${personaForName(name)}-${voiceGender(name)}`;
  return SHIPPED.has(key) ? key : null;
}
