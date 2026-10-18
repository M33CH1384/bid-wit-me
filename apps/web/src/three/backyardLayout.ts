import type { CubeVenueConfig } from './cubeVenue';
import { cubeTris } from './cubeVenue';
/** Backyard (VENUES.md): open-air. leafy_grass 7x8, fence in frame, grill W + cooler E at z~-2.5, string poles/bulbs across top. Dusk warm; sky is the exterior (local TOD). */
export const BACKYARD: CubeVenueConfig = {
  id: 'backyard', slug: 'backyard',
  floorUrl: '/assets/venues/tex/leafy_grass_512.jpg', floorRepeat: [7, 8], floorTint: '#8fa070', floorRough: 1,
  wall: '#6a4a2c', wallDark: '#5d3f24', ceiling: null, open: true, sky: true, pendants: false,
  boxes: [
    { p: [0, 0.72, -4.2], s: [7.2, 1.44, 0.09], c: '#6a4a2c', r: 0.9 },
    { p: [-3.6, 0.72, 0], s: [0.09, 1.44, 8.4], c: '#63452a', r: 0.9 },
    { p: [3.6, 0.72, 0], s: [0.09, 1.44, 8.4], c: '#63452a', r: 0.9 },
    { p: [-2.75, 0.5, -2.5], s: [0.85, 0.65, 0.6], c: '#1c1c1e', r: 0.5, m: 0.4 },
    { p: [-2.75, 0.9, -2.5], s: [0.9, 0.18, 0.65], c: '#2c2c30', r: 0.4, m: 0.5 },
    { p: [2.75, 0.33, -2.5], s: [0.8, 0.66, 0.55], c: '#2a5a9a', r: 0.5 },
    { p: [2.75, 0.69, -2.5], s: [0.84, 0.08, 0.59], c: '#e8e4da', r: 0.5 },
    { p: [-2, 2.92, -2.95], s: [0.13, 0.13, 0.13], c: '#ffb45c', e: '#ffb45c', ei: 2.5 },
    { p: [-1, 3.0, -2.95], s: [0.13, 0.13, 0.13], c: '#ffb45c', e: '#ffb45c', ei: 2.5 },
    { p: [0, 3.04, -2.95], s: [0.13, 0.13, 0.13], c: '#ffb45c', e: '#ffb45c', ei: 2.5 },
    { p: [1, 3.0, -2.95], s: [0.13, 0.13, 0.13], c: '#ffb45c', e: '#ffb45c', ei: 2.5 },
    { p: [2, 2.92, -2.95], s: [0.13, 0.13, 0.13], c: '#ffb45c', e: '#ffb45c', ei: 2.5 },
    { p: [2.9, 0.3, 1.8], s: [1.4, 0.6, 0.45], c: '#7a5a38', r: 0.85 },
  ],
  cyls: [
    { p: [-3.3, 1.5, -2.95], a: [0.045, 0.055, 3.0, 10], c: '#3a2a18', r: 0.8 },
    { p: [3.3, 1.5, -2.95], a: [0.045, 0.055, 3.0, 10], c: '#3a2a18', r: 0.8 },
    { p: [-2.75, 0.14, -2.3], a: [0.04, 0.04, 0.28, 8], c: '#555558', m: 0.7, r: 0.4 },
    { p: [-2.75, 0.14, -2.7], a: [0.04, 0.04, 0.28, 8], c: '#555558', m: 0.7, r: 0.4 },
  ],
  planes: [{ p: [0, 3.4, -6.2], s: [15, 6.5], sky: true }],
  points: [{ p: [0, 2.9, -2.9], c: '#ffb45c', i: 6, d: 7 }],
};
export function backyardTris(withProps: boolean): number { return cubeTris(withProps, BACKYARD); }
