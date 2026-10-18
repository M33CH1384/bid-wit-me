import type { CubeVenueConfig } from './cubeVenue';
import { cubeTris } from './cubeVenue';
/** Beach Cabana (VENUES.md): open-air, sand over deck boards. coast_sand 6x7, cabana posts + thatch slab y3.28, low rails, tiki W vs cooler E, sea beyond far rail, sunset side light. Near-symmetric by nature (honest). */
export const BEACH: CubeVenueConfig = {
  id: 'beach', slug: 'beach',
  floorUrl: '/assets/venues/tex/coast_sand_01_512.jpg', floorRepeat: [6, 7], floorTint: '#e8cfa6', floorRough: 1,
  wall: '#7a5530', wallDark: '#6a4a28', ceiling: null, open: true, sky: true, pendants: false,
  boxes: [
    { p: [0, 3.32, 0], s: [7.6, 0.2, 8.8], c: '#9a7a44', r: 1 },
    { p: [0, 3.18, -4.05], s: [7.6, 0.14, 0.35], c: '#6a4a28', r: 0.9 },
    { p: [0, 3.18, 4.05], s: [7.6, 0.14, 0.35], c: '#6a4a28', r: 0.9 },
    { p: [0, 0.85, -4.15], s: [7.2, 0.1, 0.12], c: '#8a6238', r: 0.8 },
    { p: [-3.55, 0.85, 0], s: [0.12, 0.1, 8.3], c: '#8a6238', r: 0.8 },
    { p: [3.55, 0.85, 0], s: [0.12, 0.1, 8.3], c: '#8a6238', r: 0.8 },
    { p: [-3.05, 0.85, -2.2], s: [0.35, 1.7, 0.35], c: '#5a3d20', r: 0.9 },
    { p: [-3.05, 1.85, -2.2], s: [0.5, 0.35, 0.5], c: '#7a4a22', r: 0.9, e: '#ff7a3d', ei: 0.7 },
    { p: [3.0, 0.33, -2.2], s: [0.8, 0.66, 0.55], c: '#c8d4d8', r: 0.5 },
    { p: [3.0, 0.69, -2.2], s: [0.84, 0.08, 0.59], c: '#2a7a8a', r: 0.5 },
  ],
  cyls: [
    { p: [-3.35, 1.64, -3.9], a: [0.09, 0.11, 3.28, 10], c: '#6a4a28', r: 0.9 },
    { p: [3.35, 1.64, -3.9], a: [0.09, 0.11, 3.28, 10], c: '#6a4a28', r: 0.9 },
    { p: [-3.35, 1.64, 3.9], a: [0.09, 0.11, 3.28, 10], c: '#6a4a28', r: 0.9 },
    { p: [3.35, 1.64, 3.9], a: [0.09, 0.11, 3.28, 10], c: '#6a4a28', r: 0.9 },
  ],
  planes: [
    { p: [0, 3.6, -6.6], s: [16, 5.5], sky: true },
    { p: [0, 1.05, -6.4], s: [16, 2.1], sea: true, c: '#2a7a9a' },
  ],
  points: [{ p: [2.4, 2.4, -1.5], c: '#ffc58a', i: 6, d: 8 }],
};
export function beachTris(withProps: boolean): number { return cubeTris(withProps, BEACH); }
