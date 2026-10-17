import { STUDIO, CHAIR_SPOTS, studioTris } from './classicStudioLayout';

/**
 * Barbershop: second production cube room (after Classic Studio, #228), from
 * scenes-audit/venues/VENUES.md + barbershop/index.html. Same shell truth as
 * Classic (floor y=0 in room space, Box3-grounded props, 90° cube); identity is
 * checker floor, teal walls, mirrors+stations WEST, glass storefront EAST onto
 * a street, barber chair E-interior, pole OUTSIDE the door.
 * The test scene rendered 110,444 tris (undecimated 22k chairs); production
 * reuses Classic's decimated chair (9,904) / lamp (6,192) GLBs — no new GLBs.
 */
export const BARBER = {
  ...STUDIO,
  wall: '#2f5f5a',
  wallDark: '#274f4b',
  ceiling: '#e8e0cc',
  baseboard: '#efe6d0',
  felt: '#14532d', // regraded per VENUES.md (was bright #1f6b3a)
  checkerLight: '#e8e4da',
  checkerDark: '#151515',
  checkerRepeat: [6, 7] as const,
  /** storefront on EAST wall (x=+roomX): 5 glass bays + door at the south end */
  storefrontBays: 5,
  glassY: 1.81,
  glassH: 3.24,
} as const;

export { CHAIR_SPOTS };

export type TodState = 'dawn' | 'day' | 'golden' | 'night';

/**
 * Time-of-day from the HOST'S clock (founder decision: host clock wins at
 * shared tables, so every seat sees the same sky/lighting; not per-client).
 * Solo/local play: this device is the host, so local time is authoritative.
 * Online: there is no host-clock field in the protocol yet — callers pass the
 * host Date when one is relayed; until then the hand-locked local time is
 * used and the state is locked identically per hand (see hand-lock below).
 * States per VENUES.md production spec: 05-07 dawn, 07-17 day, 17-20 golden,
 * 20-05 night. Lighting locks at hand start and never changes mid-hand;
 * the sky/street video keeps playing (its seek is set from the same clock).
 */
export function todFromDate(d: Date): TodState {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'golden';
  return 'night';
}

/** daylight fraction for sky-video seek: dawn->day clip position (hour-6)/12 clamped */
export function skySeekFraction(d: Date): number {
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  return Math.min(1, Math.max(0, (h - 6) / 12));
}

export interface TodLighting { exposureK: number; hemiK: number; spotK: number; glassOpacity: number; lampEmissive: number; streetDim: number; skySrc: 'day' | 'night'; poster: 'golden' }

export function todLighting(tod: TodState): TodLighting {
  switch (tod) {
    case 'night': return { exposureK: 0.94, hemiK: 0.45, spotK: 0.5, glassOpacity: 0.42, lampEmissive: 3, streetDim: 0.45, skySrc: 'night', poster: 'golden' };
    case 'golden': return { exposureK: 1.06, hemiK: 0.7, spotK: 0.85, glassOpacity: 0.22, lampEmissive: 1.2, streetDim: 0.8, skySrc: 'day', poster: 'golden' };
    case 'dawn': return { exposureK: 1.02, hemiK: 0.8, spotK: 0.8, glassOpacity: 0.18, lampEmissive: 0.8, streetDim: 0.9, skySrc: 'day', poster: 'golden' };
    default: return { exposureK: 1.1, hemiK: 1, spotK: 1.05, glassOpacity: 0.16, lampEmissive: 0.4, streetDim: 1, skySrc: 'day', poster: 'golden' };
  }
}

/** Shipped production assets (measured at encode time; see PR body). */
export const BARBER_ASSETS = {
  base: '/assets/venues/barbershop/room',
  skyDay: '/assets/venues/barbershop/room/sky-day.webm', // CC BY 2.0, see CREDITS.md
  skyNight: '/assets/venues/barbershop/room/sky-night.webm', // public domain
  street: '/assets/venues/barbershop/room/street.webm', // CC BY 3.0, heavily blurred — no legible plate/sign
  skyPoster: '/assets/venues/barbershop/room/sky-poster.jpg',
  streetPoster: '/assets/venues/barbershop/room/street-poster.jpg',
} as const;

/** Triangle estimate: Classic shell/props + storefront/props boxes (~1-2k). */
export function barberTris(withProps: boolean): number {
  return studioTris(withProps) + 1800;
}
