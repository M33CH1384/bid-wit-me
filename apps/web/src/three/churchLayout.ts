import type { CubeVenueConfig } from './cubeVenue';
import { cubeTris } from './cubeVenue';
/** Church Basement (VENUES.md): old_linoleum 4x5, benches WEST, urn table E-far, high small windows x3 near ceiling, flat fluorescent (ceiling panels, no pendants). */
export const CHURCH: CubeVenueConfig = {
  id: 'church', slug: 'church',
  floorUrl: '/assets/venues/tex/old_linoleum_flooring_01_512.jpg', floorRepeat: [4, 5], floorTint: '#d8d2c2', floorRough: 0.6,
  wall: '#d9d5c9', wallDark: '#cbc6b8', ceiling: '#e9e7df', sky: true, pendants: false,
  windows: [{ x: -2.0, y: 3.95, w: 1.0, h: 0.8 }, { x: 0, y: 3.95, w: 1.0, h: 0.8 }, { x: 2.0, y: 3.95, w: 1.0, h: 0.8 }],
  boxes: [
    { p: [-1.2, 4.92, -0.6], s: [1.7, 0.06, 0.55], c: '#f4f7ff', e: '#eef6ff', ei: 1.4, r: 0.4 },
    { p: [1.2, 4.92, -0.6], s: [1.7, 0.06, 0.55], c: '#f4f7ff', e: '#eef6ff', ei: 1.4, r: 0.4 },
    { p: [-3.15, 0.28, -1.8], s: [0.5, 0.12, 1.5], c: '#8a6a44', r: 0.7 },
    { p: [-3.15, 0.75, -1.98], s: [0.5, 0.85, 0.1], c: '#8a6a44', r: 0.7 },
    { p: [-3.15, 0.28, -0.2], s: [0.5, 0.12, 1.5], c: '#8a6a44', r: 0.7 },
    { p: [-3.15, 0.75, -0.38], s: [0.5, 0.85, 0.1], c: '#8a6a44', r: 0.7 },
    { p: [-3.15, 0.28, 1.4], s: [0.5, 0.12, 1.5], c: '#8a6a44', r: 0.7 },
    { p: [-3.15, 0.75, 1.22], s: [0.5, 0.85, 0.1], c: '#8a6a44', r: 0.7 },
    { p: [3.0, 0.4, -3.4], s: [0.8, 0.8, 0.6], c: '#7a6248', r: 0.7 },
  ],
  cyls: [
    { p: [3.0, 0.95, -3.4], a: [0.14, 0.2, 0.42, 14], c: '#b9bcc0', r: 0.25, m: 0.9 },
    { p: [3.0, 1.2, -3.4], a: [0.2, 0.2, 0.08, 14], c: '#8b8e93', r: 0.3, m: 0.9 },
  ],
  // Wave D life: fluorescent room light — CubeLifePulse hums it faintly on the church channel.
  points: [{ p: [0, 2.9, -1.8], c: '#eef6ff', i: 4, d: 7 }],
};
export function churchTris(withProps: boolean): number { return cubeTris(withProps, CHURCH); }
