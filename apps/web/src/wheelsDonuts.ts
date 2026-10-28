/**
 * Entry-side seam for the Wheels car (the 3D show itself lives in
 * three/wheelsCar3d.ts + three/WheelsCar3D.tsx — this module must never import
 * the three chunk). What stays here is the part DOM code needs: when a
 * detonation may claim the car, and when the sweep lands.
 *
 * The gate mirrors Nuke3D's own: with the nuke mode 'off' the blast has no
 * visual sweep anywhere on the table (banner + boom only), so nothing on the
 * table moves — the car included. In every other mode a nuke sweeps the car
 * and a mega sweeps it harder (the second detonation re-kicks mid-flight).
 */

/** Seconds from the fx detonation event to the flash — the sweep lands on the flash.
 *  Mirrors NUKE_FLASH_S in three/nukeVisual.ts. */
export const BLAST_FLASH_S = 0.3;

/**
 * Whether a detonation sweeps the car. The gate mirrors Nuke3D's own: with the nuke
 * mode 'off' the blast has no visual sweep at all (banner + boom), so nothing on the
 * table moves — the car included.
 */
export function wheelsBlastReaction(kind: 'nuke' | 'mega', nukeMode: string): 'swept' | 'mega-swept' | 'none' {
  if (nukeMode === 'off') return 'none';
  return kind === 'mega' ? 'mega-swept' : 'swept';
}
