/**
 * Venues (Release 7): 3D arenas around the same card table. Pure data (no three.js here) so settings, the lobby
 * and tests can use it; the 3D side is three/Venue3D.tsx (lazy, one venue's assets at a time).
 *
 * Every venue: its own table finish (felt + rail), floor, backdrop (a CC0 Poly Haven HDRI baked down to a 1024×512
 * jpg backdrop + a 256×128 .hdr for lighting in High quality), light colours, a few procedural props and a quiet
 * procedural ambient sound bed (audio.ts → venueBed). Sources are in CREDITS.md.
 */
import { isVenueChoice, type VenueChoice, type VenueId, VENUES, rollVenue } from '@spades/protocol';

export type { VenueChoice, VenueId };
export { VENUES };

export type RailKind = 'wood' | 'marble' | 'crystal' | 'teak' | 'bamboo' | 'leather' | 'chrome' | 'metal';
export type BedId = 'none' | 'cookout' | 'mansion' | 'barbershop' | 'basement' | 'rooftop' | 'jazz' | 'casino' | 'beach' | 'kitchen' | 'yacht';

export interface VenueDef {
  id: VenueId;
  name: string;
  emoji: string;
  blurb: string;
  /** felt (playing surface) colour; pattern = a printed cloth instead of felt */
  felt: string;
  feltPattern?: 'gingham' | 'laminate';
  rail: RailKind;
  railTint: string;
  apron: string;
  /** floor texture (public/assets/venues/tex/<id>_512.jpg) or null = flat colour */
  floorTex: string | null;
  floorTint: string;
  floorRepeat: number;
  /** radius of the floor disc: past it you see the backdrop (null = endless floor + fog, the classic look) */
  floorRadius: number | null;
  floorRough: number;
  /** backdrop (public/assets/venues/<id>/bg.jpg): blur 0–1, brightness */
  bgBlur: number;
  bgIntensity: number;
  /** HDRI lighting strength (High quality) */
  envIntensity: number;
  /** key light colour / strength (×), hemisphere sky + ground, rim light colour */
  key: string;
  keyK: number;
  sky: string;
  ground: string;
  rim: string;
  /** the colour the screen clears to (and fog, when the floor is endless) */
  clear: string;
  bed: BedId;
}

const V = (d: Omit<VenueDef, 'floorRough' | 'keyK'> & Partial<Pick<VenueDef, 'floorRough' | 'keyK'>>): VenueDef => ({ floorRough: 0.9, keyK: 1, ...d });

export const VENUE_DEFS: Record<VenueId, VenueDef> = {
  classic: V({ id: 'classic', name: 'Classic Studio', emoji: '🎙️', blurb: 'The original: green felt, dark wood, purple glow.', felt: '#0d6a45', rail: 'wood', railTint: '#c98a5a', apron: '#7a4a2a', floorTex: null, floorTint: '#120b18', floorRepeat: 1, floorRadius: null, bgBlur: 0.55, bgIntensity: 0.22, envIntensity: 0.55, key: '#fff1dc', sky: '#fff3e0', ground: '#1a0f24', rim: '#9b5cff', clear: '#0c0712', bed: 'none' }),
  backyard: V({ id: 'backyard', name: 'Backyard Cookout', emoji: '🍖', blurb: 'Folding table with the picnic cloth on the lawn, string lights, smoke off the grill.', felt: '#2a5bd7', feltPattern: 'gingham', rail: 'metal', railTint: '#9aa0a6', apron: '#5d6168', floorTex: 'leafy_grass', floorTint: '#8fa070', floorRepeat: 7, floorRadius: 9, bgBlur: 0.12, bgIntensity: 0.7, envIntensity: 0.45, key: '#ffd9a8', sky: '#ffcf9e', ground: '#24301a', rim: '#ffb35c', clear: '#2a2233', bed: 'cookout' }),
  mansion: V({ id: 'mansion', name: 'Mansion', emoji: '🏛️', blurb: 'Marble floors, a crystal table, chandelier light.', felt: '#0a1036', rail: 'crystal', railTint: '#e8f3ff', apron: '#d8e4f0', floorTex: 'marble_tiles', floorTint: '#cfc8bb', floorRepeat: 5, floorRadius: 10, floorRough: 0.25, bgBlur: 0.15, bgIntensity: 0.5, envIntensity: 0.3, key: '#fff6e8', sky: '#e8e4f0', ground: '#3a3028', rim: '#ffd27a', clear: '#2a2420', keyK: 0.75, bed: 'mansion' }),
  barbershop: V({ id: 'barbershop', name: 'Barbershop', emoji: '💈', blurb: 'Checker floor, mirrors and stations, glass storefront onto the street.', felt: '#14532d', rail: 'leather', railTint: '#2b211c', apron: '#1c1a1a', floorTex: 'checkered_pavement_tiles', floorTint: '#e6e6e6', floorRepeat: 6, floorRadius: 8, floorRough: 0.5, bgBlur: 0.18, bgIntensity: 0.45, envIntensity: 0.6, key: '#f4f7ff', sky: '#eef2ff', ground: '#222', rim: '#ff2e55', clear: '#14121a', bed: 'barbershop' }),
  church: V({ id: 'church', name: 'Church Basement', emoji: '⛪', blurb: 'Fellowship hall table, folding chairs, fluorescent hum.', felt: '#9c8f72', feltPattern: 'laminate', rail: 'metal', railTint: '#b9bcc0', apron: '#8b8e93', floorTex: 'old_linoleum_flooring_01', floorTint: '#d8d2c2', floorRepeat: 6, floorRadius: 9, floorRough: 0.6, bgBlur: 0.2, bgIntensity: 0.55, envIntensity: 0.7, key: '#eef6ff', sky: '#f2f7ff', ground: '#3a3630', rim: '#bcd7ff', clear: '#1c1b1a', bed: 'basement' }),
  rooftop: V({ id: 'rooftop', name: 'Rooftop', emoji: '🌃', blurb: 'Up top at night, the skyline all around.', felt: '#1a2f5a', rail: 'wood', railTint: '#6b4a3a', apron: '#2a1d18', floorTex: 'concrete_floor_02', floorTint: '#8a8a92', floorRepeat: 5, floorRadius: 6.5, bgBlur: 0.04, bgIntensity: 0.9, envIntensity: 0.5, key: '#dfe6ff', keyK: 0.9, sky: '#6f7cff', ground: '#151520', rim: '#ff4fd8', clear: '#05060c', bed: 'rooftop' }),
  speakeasy: V({ id: 'speakeasy', name: 'Speakeasy Lounge', emoji: '🎷', blurb: 'Red velvet felt, dim amber light, low jazz.', felt: '#5c0d1a', rail: 'wood', railTint: '#5a2e1a', apron: '#2a140c', floorTex: 'herringbone_parquet', floorTint: '#7a5a44', floorRepeat: 5, floorRadius: 8, floorRough: 0.55, bgBlur: 0.22, bgIntensity: 0.4, envIntensity: 0.55, key: '#ffe8cc', keyK: 1.15, sky: '#ffd6a8', ground: '#1a0d08', rim: '#ff8a3d', clear: '#0d0705', bed: 'jazz' }),
  vegas: V({ id: 'vegas', name: 'Vegas High Roller', emoji: '🎰', blurb: 'Casino felt, leather rail, chip stacks, slots ringing.', felt: '#3d060e', rail: 'leather', railTint: '#1a1414', apron: '#3a2a10', floorTex: 'dirty_carpet', floorTint: '#8a7a80', floorRepeat: 6, floorRadius: 9, bgBlur: 0.3, bgIntensity: 0.5, envIntensity: 0.5, key: '#fff0d0', sky: '#ffd27a', ground: '#2a0a1a', rim: '#ffcc33', clear: '#120810', bed: 'casino' }),
  beach: V({ id: 'beach', name: 'Beach Cabana', emoji: '🏝️', blurb: 'Tiki table on the sand at sunset, torches lit.', felt: '#176660', rail: 'bamboo', railTint: '#e0b878', apron: '#7a5530', floorTex: 'coast_sand_01', floorTint: '#e8cfa6', floorRepeat: 6, floorRadius: 8, bgBlur: 0.06, bgIntensity: 0.85, envIntensity: 0.6, key: '#ffc58a', sky: '#ffbf80', ground: '#5a4430', rim: '#ff7a3d', clear: '#3a2a2a', bed: 'beach' }),
  grandma: V({ id: 'grandma', name: "Grandma's Kitchen", emoji: '🥧', blurb: 'Vinyl tablecloth, plastic on the couch, the clock ticking.', felt: '#9e1b24', feltPattern: 'gingham', rail: 'chrome', railTint: '#d8dde2', apron: '#9aa0a6', floorTex: 'linoleum_brown', floorTint: '#d6c6a8', floorRepeat: 6, floorRadius: 8, floorRough: 0.5, bgBlur: 0.25, bgIntensity: 0.5, envIntensity: 0.5, key: '#fff0d6', sky: '#fff2dc', ground: '#4a3a28', rim: '#ffd9a0', clear: '#1e1812', bed: 'kitchen' }),
  yacht: V({ id: 'yacht', name: 'Yacht Deck', emoji: '🛥️', blurb: 'Teak table on deck, nothing but open water.', felt: '#14365e', rail: 'teak', railTint: '#c08a5a', apron: '#6a4428', floorTex: 'wood_floor_deck', floorTint: '#d9b48a', floorRepeat: 4, floorRadius: null, floorRough: 0.6, bgBlur: 0.04, bgIntensity: 0.9, envIntensity: 0.85, key: '#fff4e0', sky: '#cfe6ff', ground: '#2a4a6a', rim: '#7fd0ff', clear: '#6a8aa8', bed: 'yacht' }),
};

export const VENUE_LIST: VenueDef[] = VENUES.map((v) => VENUE_DEFS[v]);

export function venueLabel(v: VenueChoice): string {
  return v === 'random' ? '🎲 Random' : `${VENUE_DEFS[v].emoji} ${VENUE_DEFS[v].name}`;
}

/** offline: 'random' → a concrete venue for this game */
export function resolveVenue(v: VenueChoice | undefined, r = Math.random()): VenueId {
  if (!v) return 'classic';
  return v === 'random' ? rollVenue(r) : v;
}

/** asset URLs for one venue (lazy: only the venue in play is fetched) */
export function venueAssetUrls(id: VenueId, quality: 'high' | 'low'): { bg: string | null; env: string | null; floor: string | null; rail: string | null } {
  if (id === 'classic') return { bg: null, env: null, floor: null, rail: null };
  const d = VENUE_DEFS[id];
  const railTex: Partial<Record<RailKind, string>> = { marble: 'marble_01', teak: 'teak_veneer', bamboo: 'bamboo_veneer', leather: 'brown_leather' };
  const rt = railTex[d.rail];
  return {
    bg: `/assets/venues/${id}/bg.jpg`,
    env: quality === 'high' ? `/assets/venues/${id}/env.hdr` : null,
    floor: d.floorTex ? `/assets/venues/tex/${d.floorTex}_512.jpg` : null,
    rail: rt ? `/assets/venues/tex/${rt}_512.jpg` : null,
  };
}

/** Venue picked on the online setup screen, carried to the table it creates (the host's
 * client applies it once in the lobby, like pending music). One-shot: taking clears it. */
export function savePendingVenue(code: string, venue: VenueChoice): void {
  try { sessionStorage.setItem(`bwm.pendingVenue.${code}`, venue); } catch { /* ignore */ }
}
export function takePendingVenue(code: string): VenueChoice | null {
  try {
    const k = `bwm.pendingVenue.${code}`;
    const v = sessionStorage.getItem(k);
    if (v !== null) sessionStorage.removeItem(k);
    return isVenueChoice(v) ? v : null;
  } catch { return null; }
}
