import type { CubeVenueConfig } from './cubeVenue';
import { cubeTris } from './cubeVenue';
/** Vegas (VENUES.md): windowless. dirty_carpet burgundy 4x5, gold panels 2.3m emissive .12, chip table E, blank dark panel W (no slot screens/signs). Felt #3d060e. */
export const VEGAS: CubeVenueConfig = {
  id: 'vegas', slug: 'vegas',
  floorUrl: '/assets/venues/tex/dirty_carpet_512.jpg', floorRepeat: [4, 5], floorTint: '#7a3a4a', floorRough: 0.95,
  wall: '#1e1420', wallDark: '#150e16', ceiling: '#120810', sky: false, pendants: true,
  boxes: [
    { p: [-1.8, 1.45, -4.12], s: [1.25, 2.3, 0.07], c: '#8a6a20', r: 0.35, m: 0.7, e: '#ffcc33', ei: 0.12 },
    { p: [0, 1.45, -4.12], s: [1.25, 2.3, 0.07], c: '#9a7626', r: 0.35, m: 0.7, e: '#ffcc33', ei: 0.12 },
    { p: [1.8, 1.45, -4.12], s: [1.25, 2.3, 0.07], c: '#8a6a20', r: 0.35, m: 0.7, e: '#ffcc33', ei: 0.12 },
    { p: [-3.56, 1.5, -0.6], s: [0.07, 2.4, 1.8], c: '#0e0a12', r: 0.4, m: 0.3 },
    { p: [3.0, 0.38, -1.6], s: [0.85, 0.76, 0.85], c: '#241612', r: 0.6 },
  ],
  cyls: [
    { p: [3.0, 0.82, -1.6], a: [0.5, 0.5, 0.06, 18], c: '#3d060e', r: 0.7 },
    { p: [2.82, 0.9, -1.72], a: [0.09, 0.09, 0.1, 12], c: '#e8e4da', r: 0.5 },
    { p: [3.05, 0.9, -1.5], a: [0.09, 0.09, 0.16, 12], c: '#b03030', r: 0.5 },
    { p: [3.2, 0.9, -1.75], a: [0.09, 0.09, 0.07, 12], c: '#2a4a8a', r: 0.5 },
  ],
  points: [{ p: [0, 2.6, -2.2], c: '#ffcc33', i: 5, d: 6 }],
};
export function vegasTris(withProps: boolean): number { return cubeTris(withProps, VEGAS); }
