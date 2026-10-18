import type { CubeVenueConfig } from './cubeVenue';
import { cubeTris } from './cubeVenue';
/**
 * Grandma's Kitchen (VENUES.md): linoleum_brown 5x6, counter+cabinets far,
 * fridge W, stove E, windows x2 above cabinets, door S (opp view).
 * DESIGN FIX for the top-down "diner" read (hero was PARTIAL): the counter
 * run is made taller (0.95m) and deeper, wall cabinets protrude 0.45m at
 * head height, the fridge stands a full 2m, and a stove + pie + wall clock
 * sit in the far strip — from the playing camera the far edge now reads as a
 * home kitchen run, not a diner counter. Felt regraded #9e1b24.
 */
export const GRANDMA: CubeVenueConfig = {
  id: 'grandma', slug: 'grandma',
  floorUrl: '/assets/venues/tex/linoleum_brown_512.jpg', floorRepeat: [5, 6], floorTint: '#d6c6a8', floorRough: 0.5,
  wall: '#e6d7b8', wallDark: '#dbc9a4', ceiling: '#f4ead2', sky: true, pendants: true,
  windows: [{ x: -1.1, y: 3.15, w: 1.2, h: 1.0 }, { x: 1.1, y: 3.15, w: 1.2, h: 1.0 }],
  boxes: [
    { p: [0, 0.475, -3.82], s: [5.2, 0.95, 0.72], c: '#8a5a34', r: 0.7 },
    { p: [0, 0.99, -3.82], s: [5.4, 0.07, 0.84], c: '#eadfc6', r: 0.4 },
    { p: [-2.15, 2.05, -3.95], s: [1.5, 1.25, 0.45], c: '#9a6a3c', r: 0.65 },
    { p: [2.15, 2.05, -3.95], s: [1.5, 1.25, 0.45], c: '#9a6a3c', r: 0.65 },
    { p: [0, 1.78, -3.98], s: [1.1, 0.7, 0.4], c: '#9a6a3c', r: 0.65 },
    { p: [-3.0, 1.0, -3.55], s: [0.92, 2.0, 0.82], c: '#e9e1cd', r: 0.35, m: 0.15 },
    { p: [-3.0, 1.42, -3.12], s: [0.94, 0.05, 0.04], c: '#b9ac8e', r: 0.4 },
    { p: [2.95, 0.5, -3.82], s: [1.05, 1.0, 0.72], c: '#e8e4da', r: 0.35 },
    { p: [2.95, 1.03, -3.82], s: [1.05, 0.05, 0.72], c: '#2a2a2a', r: 0.5 },
    { p: [-1.1, 2.55, -4.12], s: [1.24, 0.14, 0.03], c: '#b03030', r: 0.9 },
    { p: [1.1, 2.55, -4.12], s: [1.24, 0.14, 0.03], c: '#b03030', r: 0.9 },
    { p: [-2.9, 1.3, -4.55], s: [1.3, 2.6, 0.8], c: '#3a4a34', r: 1 },
    { p: [2.9, 1.2, -4.55], s: [1.4, 2.4, 0.8], c: '#44543c', r: 1 },
  ],
  cyls: [
    { p: [1.35, 1.06, -3.8], a: [0.17, 0.19, 0.07, 16], c: '#c98a3a', r: 0.55 },
    { p: [2.75, 1.07, -3.95], a: [0.11, 0.11, 0.02, 14], c: '#111111', r: 0.4 },
    { p: [3.15, 1.07, -3.68], a: [0.09, 0.09, 0.02, 14], c: '#111111', r: 0.4 },
  ],
  tori: [{ p: [0, 3.85, -4.12], a: [0.22, 0.035, 10, 24], c: '#f4ead2' }],
};
export function grandmaTris(withProps: boolean): number { return cubeTris(withProps, GRANDMA); }
