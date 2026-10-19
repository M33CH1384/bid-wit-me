/** Street Cred System A: divisions. Pure, unit-tested. Division is computed from Elo, so it moves automatically. */
export type Division = 'stoop' | 'corner' | 'block' | 'avenue' | 'boulevard' | 'legend';

export const DIVISIONS: { id: Division; label: string; min: number; blurb: string }[] = [
  { id: 'stoop', label: 'Stoop', min: 0, blurb: 'Learning the game' },
  { id: 'corner', label: 'Corner', min: 800, blurb: 'Regular player' },
  { id: 'block', label: 'Block', min: 1000, blurb: 'Solid' },
  { id: 'avenue', label: 'Avenue', min: 1200, blurb: 'Strong' },
  { id: 'boulevard', label: 'Boulevard', min: 1400, blurb: 'Elite' },
  { id: 'legend', label: 'Legend', min: 1600, blurb: 'Best on the block' },
];

/** Elo bands: <800 stoop, 800-999 corner, 1000-1199 block, 1200-1399 avenue, 1400-1599 boulevard, 1600+ legend. */
export function divisionOf(elo: number): Division {
  let d: Division = 'stoop';
  for (const x of DIVISIONS) if (elo >= x.min) d = x.id;
  return d;
}

/** Rank order for comparisons ("reach Block division" etc). */
export const divisionRank = (d: Division): number => DIVISIONS.findIndex((x) => x.id === d);
