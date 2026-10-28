import type { CubeVenueConfig } from './cubeVenue';
import { cubeTris } from './cubeVenue';
/** Mansion (VENUES.md): marble_tiles 1.5x2, far columns +-2.75, tall windows x3 far, pedestal E. S: windows+columns / N: runner+pedestal. Cool-crystal bright. */
export const MANSION: CubeVenueConfig = {
  id: 'mansion', slug: 'mansion',
  floorUrl: '/assets/venues/tex/marble_tiles_512.jpg', floorRepeat: [1.5, 2], floorTint: '#cfc8bb', floorRough: 0.25,
  wall: '#e8e2d4', wallDark: '#d8d0be', ceiling: '#f2ecdd', sky: true, pendants: true,
  windows: [{ x: -2.2, y: 2.7, w: 1.1, h: 3.4 }, { x: 0, y: 2.7, w: 1.1, h: 3.4 }, { x: 2.2, y: 2.7, w: 1.1, h: 3.4 }],
  boxes: [
    { p: [0, 0.012, 0.4], s: [1.6, 0.024, 5.2], c: '#1a2448', r: 0.9 },
    { p: [3.05, 0.55, -1.8], s: [0.55, 1.1, 0.55], c: '#e8e4f0', r: 0.3 },
    { p: [3.05, 1.18, -1.8], s: [0.4, 0.16, 0.4], c: '#c9a86a', r: 0.35, m: 0.6 },
    { p: [-3.2, 1.4, -4.55], s: [1.2, 2.8, 0.8], c: '#24301e', r: 1 },
    { p: [0, 1.1, -4.6], s: [1.6, 2.2, 0.8], c: '#2c3824', r: 1 },
    { p: [3.2, 1.5, -4.55], s: [1.1, 3.0, 0.8], c: '#24301e', r: 1 },
  ],
  cyls: [
    { p: [-2.75, 2.3, -3.85], a: [0.22, 0.26, 4.6, 14], c: '#f0ead8', r: 0.3 },
    { p: [2.75, 2.3, -3.85], a: [0.22, 0.26, 4.6, 14], c: '#f0ead8', r: 0.3 },
    { p: [-2.75, 0.18, -3.85], a: [0.34, 0.38, 0.36, 14], c: '#d8cfb8', r: 0.4 },
    { p: [2.75, 0.18, -3.85], a: [0.34, 0.38, 0.36, 14], c: '#d8cfb8', r: 0.4 },
  ],
  // Wave D life: chandelier light — CubeLifePulse shimmers it on the mansion channel.
  points: [{ p: [0, 2.8, -2.6], c: '#fff0d0', i: 5, d: 8 }],
};
export function mansionTris(withProps: boolean): number { return cubeTris(withProps, MANSION); }
