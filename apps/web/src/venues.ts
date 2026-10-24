/**
 * Venues (Release 7): 3D arenas around the same card table. Pure data (no three.js here) so settings, the lobby
 * and tests can use it; the 3D side is three/Venue3D.tsx (lazy, one venue's assets at a time).
 *
 * Every venue: its own table finish (felt + rail), floor, backdrop (a CC0 Poly Haven HDRI baked down to a 1024×512
 * jpg backdrop + a 256×128 .hdr for lighting in High quality), light colours, a few procedural props and a quiet
 * procedural ambient sound bed (audio.ts → venueBed). Sources are in CREDITS.md.
 */
import { isVenueChoice, type VenueChoice, type VenueId, VENUES, rollVenue } from '@spades/protocol';
import { styleForVenue } from './spatial';
import { noteDailyBonus } from './dailyBonus';

export type { VenueChoice, VenueId };
export { VENUES };

export type RailKind = 'wood' | 'marble' | 'crystal' | 'teak' | 'bamboo' | 'leather' | 'chrome' | 'metal';
export type BedId = 'none' | 'cookout' | 'mansion' | 'barbershop' | 'basement' | 'rooftop' | 'jazz' | 'casino' | 'beach' | 'kitchen' | 'yacht' | 'street';

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

/** A venue's ambience bed is part of its AUDIO IDENTITY (spatial.ts ROOM_STYLES — the single
 *  source of truth for how a venue sounds). Derived here, never restated, so the visual def
 *  and the heard bed can't drift apart. */
const bedOf = (id: VenueId): BedId => (styleForVenue(id)?.bed ?? 'none') as BedId;

export const VENUE_DEFS: Record<VenueId, VenueDef> = {
  classic: V({ id: 'classic', name: 'Classic Studio', emoji: '🎙️', blurb: 'The original: green felt, dark wood, purple glow.', felt: '#0d6a45', rail: 'wood', railTint: '#c98a5a', apron: '#7a4a2a', floorTex: null, floorTint: '#120b18', floorRepeat: 1, floorRadius: null, bgBlur: 0.55, bgIntensity: 0.22, envIntensity: 0.55, key: '#fff1dc', sky: '#fff3e0', ground: '#1a0f24', rim: '#9b5cff', clear: '#0c0712', bed: bedOf('classic') }),
  backyard: V({ id: 'backyard', name: 'Backyard Cookout', emoji: '🍖', blurb: 'Folding table with the picnic cloth on the lawn, string lights, smoke off the grill.', felt: '#2a5bd7', feltPattern: 'gingham', rail: 'metal', railTint: '#9aa0a6', apron: '#5d6168', floorTex: 'leafy_grass', floorTint: '#8fa070', floorRepeat: 7, floorRadius: 9, bgBlur: 0.12, bgIntensity: 0.7, envIntensity: 0.45, key: '#ffd9a8', sky: '#ffcf9e', ground: '#24301a', rim: '#ffb35c', clear: '#2a2233', bed: bedOf('backyard') }),
  mansion: V({ id: 'mansion', name: 'Mansion', emoji: '🏛️', blurb: 'Marble floors, a crystal table, chandelier light.', felt: '#0a1036', rail: 'crystal', railTint: '#e8f3ff', apron: '#d8e4f0', floorTex: 'marble_tiles', floorTint: '#cfc8bb', floorRepeat: 5, floorRadius: 10, floorRough: 0.25, bgBlur: 0.15, bgIntensity: 0.5, envIntensity: 0.3, key: '#fff6e8', sky: '#e8e4f0', ground: '#3a3028', rim: '#ffd27a', clear: '#2a2420', keyK: 0.75, bed: bedOf('mansion') }),
  barbershop: V({ id: 'barbershop', name: 'Barbershop', emoji: '💈', blurb: 'Checker floor, mirrors and stations, glass storefront onto the street.', felt: '#14532d', rail: 'leather', railTint: '#2b211c', apron: '#1c1a1a', floorTex: 'checkered_pavement_tiles', floorTint: '#e6e6e6', floorRepeat: 6, floorRadius: 8, floorRough: 0.5, bgBlur: 0.18, bgIntensity: 0.45, envIntensity: 0.6, key: '#f4f7ff', sky: '#eef2ff', ground: '#222', rim: '#ff2e55', clear: '#14121a', bed: bedOf('barbershop') }),
  church: V({ id: 'church', name: 'Church Basement', emoji: '⛪', blurb: 'Fellowship hall table, folding chairs, fluorescent hum.', felt: '#9c8f72', feltPattern: 'laminate', rail: 'metal', railTint: '#b9bcc0', apron: '#8b8e93', floorTex: 'old_linoleum_flooring_01', floorTint: '#d8d2c2', floorRepeat: 6, floorRadius: 9, floorRough: 0.6, bgBlur: 0.2, bgIntensity: 0.55, envIntensity: 0.7, key: '#eef6ff', sky: '#f2f7ff', ground: '#3a3630', rim: '#bcd7ff', clear: '#1c1b1a', bed: bedOf('church') }),
  rooftop: V({ id: 'rooftop', name: 'Rooftop', emoji: '🌃', blurb: 'Up top at night, the skyline all around.', felt: '#1a2f5a', rail: 'wood', railTint: '#6b4a3a', apron: '#2a1d18', floorTex: 'concrete_floor_02', floorTint: '#8a8a92', floorRepeat: 5, floorRadius: 6.5, bgBlur: 0.04, bgIntensity: 0.9, envIntensity: 0.5, key: '#dfe6ff', keyK: 0.9, sky: '#6f7cff', ground: '#151520', rim: '#ff4fd8', clear: '#05060c', bed: bedOf('rooftop') }),
  speakeasy: V({ id: 'speakeasy', name: 'Speakeasy Lounge', emoji: '🎷', blurb: 'Red velvet felt, dim amber light, low jazz.', felt: '#5c0d1a', rail: 'wood', railTint: '#5a2e1a', apron: '#2a140c', floorTex: 'herringbone_parquet', floorTint: '#7a5a44', floorRepeat: 5, floorRadius: 8, floorRough: 0.55, bgBlur: 0.22, bgIntensity: 0.4, envIntensity: 0.55, key: '#ffe8cc', keyK: 1.15, sky: '#ffd6a8', ground: '#1a0d08', rim: '#ff8a3d', clear: '#0d0705', bed: bedOf('speakeasy') }),
  vegas: V({ id: 'vegas', name: 'Vegas High Roller', emoji: '🎰', blurb: 'Casino felt, leather rail, chip stacks, slots ringing.', felt: '#3d060e', rail: 'leather', railTint: '#1a1414', apron: '#3a2a10', floorTex: 'dirty_carpet', floorTint: '#8a7a80', floorRepeat: 6, floorRadius: 9, bgBlur: 0.3, bgIntensity: 0.5, envIntensity: 0.5, key: '#fff0d0', sky: '#ffd27a', ground: '#2a0a1a', rim: '#ffcc33', clear: '#120810', bed: bedOf('vegas') }),
  beach: V({ id: 'beach', name: 'Beach Cabana', emoji: '🏝️', blurb: 'Tiki table on the sand at sunset, torches lit.', felt: '#176660', rail: 'bamboo', railTint: '#e0b878', apron: '#7a5530', floorTex: 'coast_sand_01', floorTint: '#e8cfa6', floorRepeat: 6, floorRadius: 8, bgBlur: 0.06, bgIntensity: 0.85, envIntensity: 0.6, key: '#ffc58a', sky: '#ffbf80', ground: '#5a4430', rim: '#ff7a3d', clear: '#3a2a2a', bed: bedOf('beach') }),
  grandma: V({ id: 'grandma', name: "Grandma's Kitchen", emoji: '🥧', blurb: 'Vinyl tablecloth, plastic on the couch, the clock ticking.', felt: '#9e1b24', feltPattern: 'gingham', rail: 'chrome', railTint: '#d8dde2', apron: '#9aa0a6', floorTex: 'linoleum_brown', floorTint: '#d6c6a8', floorRepeat: 6, floorRadius: 8, floorRough: 0.5, bgBlur: 0.25, bgIntensity: 0.5, envIntensity: 0.5, key: '#fff0d6', sky: '#fff2dc', ground: '#4a3a28', rim: '#ffd9a0', clear: '#1e1812', bed: bedOf('grandma') }),
  yacht: V({ id: 'yacht', name: 'Yacht Deck', emoji: '🛥️', blurb: 'Teak table on deck, nothing but open water.', felt: '#14365e', rail: 'teak', railTint: '#c08a5a', apron: '#6a4428', floorTex: 'wood_floor_deck', floorTint: '#d9b48a', floorRepeat: 4, floorRadius: null, floorRough: 0.6, bgBlur: 0.04, bgIntensity: 0.9, envIntensity: 0.85, key: '#fff4e0', sky: '#cfe6ff', ground: '#2a4a6a', rim: '#7fd0ff', clear: '#6a8aa8', bed: bedOf('yacht') }),
  blockAfterDark: V({ id: 'blockAfterDark', name: "The Pj's", emoji: '🌆', blurb: 'The block at night: folding table under the streetlight, grill smoke in the air. The game don\'t stop.', felt: '#122b22', rail: 'metal', railTint: '#8a8f94', apron: '#3a3d40', floorTex: 'brushed_concrete', floorTint: '#4a4a50', floorRepeat: 6, floorRadius: 10, floorRough: 0.95, bgBlur: 0.08, bgIntensity: 0.85, envIntensity: 0.35, key: '#ffb45c', keyK: 1.1, sky: '#2a3a5c', ground: '#0a0c10', rim: '#7fa8ff', clear: '#05070c', bed: bedOf('blockAfterDark') }),
};

export const VENUE_LIST: VenueDef[] = VENUES.map((v) => VENUE_DEFS[v]);

/** Phase 4: The Pj's is a premium unlockable venue. The unlock item id
 *  granted by the 'after-dark' achievement (or reaching Rep level 20). */
export const AFTER_DARK_VENUE: VenueId = 'blockAfterDark';
export const AFTER_DARK_UNLOCK_ITEM = 'after-dark';
/** Rep level that auto-unlocks The Pj's — the Ten of Clubs on the rank
 *  ladder (the gate itself stays this number; only the words changed). */
export const AFTER_DARK_UNLOCK_LEVEL = 20;

/** Venues gated behind unlocks. Everything else is always available. */
const LOCKED_VENUES: Partial<Record<VenueId, string>> = {
  [AFTER_DARK_VENUE]: AFTER_DARK_UNLOCK_ITEM,
};

/** True if the player may pick this venue: unlocked, or a developer (owner) account. */
export function venueUnlocked(id: VenueId, unlockItemIds: readonly string[], isDev: boolean): boolean {
  if (isDev) return true;
  const need = LOCKED_VENUES[id];
  return !need || unlockItemIds.includes(need);
}

/** Label for a venue option in pickers: locked venues show a lock until
 *  unlocked. The Pj's gate reads as the rank card that opens it (owner,
 *  2026-10-23: Rep level 20 IS the Ten of Clubs) — the After Dark
 *  achievement path is named in the venue's own unlock copy elsewhere. */
export function venueOptionLabel(v: VenueDef, unlocked: boolean): string {
  if (unlocked) return `${v.emoji} ${v.name}`;
  return v.id === AFTER_DARK_VENUE ? `🔒 ${v.name} — opens at the Ten of Clubs (10♣)` : `🔒 ${v.name} — unlock via Rep`;
}

/** Minimal unlock state for gating venue pickers. Fetched once per page load;
 *  null when signed out or the fetch fails (locked venues stay locked). */
export interface VenueUnlockState { unlocks: string[]; dev: boolean; storyAccess: boolean }
let unlockCache: Promise<VenueUnlockState | null> | null = null;
export function fetchVenueUnlocks(): Promise<VenueUnlockState | null> {
  if (!unlockCache) {
    unlockCache = fetch('/api/profile/me', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      // This read can be the one that lands today's daily grant (it runs on
      // the first venue-picker/setup visit of the day): receipt it before
      // mapping the payload down to unlock state (see dailyBonus.ts).
      .then((p) => { noteDailyBonus(p); return p ? { unlocks: (p.unlocks ?? []).map((u: { itemId: string }) => u.itemId), dev: !!p.dev, storyAccess: !!p.storyAccess } : null; })
      .catch(() => null);
  }
  return unlockCache;
}

/** The cached profile describes whoever was signed in when it was fetched —
 *  a profile read while signed out (401 → null) or under a previous account
 *  must never outlive an identity change. The account store calls this from
 *  its single set() choke point whenever the signed-in identity changes
 *  (sign-in, sign-out, account switch), so unlocks / dev / storyAccess
 *  converge to the new identity's truth on the next read, with no reload. */
export function invalidateVenueUnlocks(): void { unlockCache = null; }

export function venueLabel(v: VenueChoice): string {
  return v === 'random' ? '🎲 Random' : `${VENUE_DEFS[v].emoji} ${VENUE_DEFS[v].name}`;
}

/** offline: 'random' → a concrete venue for this game. Locked venues (The Pj's) roll only
 *  for a player entitled to them — pass the unlock state (see fetchVenueUnlocks/venueUnlocked);
 *  the default is locked, so an unknown/signed-out state can never roll into The Pj's. */
export function resolveVenue(v: VenueChoice | undefined, r = Math.random(), includeLocked = false): VenueId {
  if (!v) return 'classic';
  return v === 'random' ? rollVenue(r, undefined, includeLocked) : v;
}

/** asset URLs for one venue (lazy: only the venue in play is fetched) */
export function venueAssetUrls(id: VenueId, quality: 'high' | 'low'): { bg: string | null; env: string | null; floor: string | null; rail: string | null } {
  if (id === 'classic') return { bg: null, env: null, floor: null, rail: null };
  const d = VENUE_DEFS[id];
  const railTex: Partial<Record<RailKind, string>> = { marble: 'marble_01', teak: 'teak_veneer', bamboo: 'bamboo_veneer', leather: 'brown_leather' };
  const rt = railTex[d.rail];
  // Phase 4: The Pj's photorealistic backdrop (Demetrius 2026-10-19).
  if (id === 'blockAfterDark') {
    return {
      bg: `/assets/venues/blockAfterDark/bg.jpg`,
      env: null,
      floor: d.floorTex ? `/assets/venues/tex/${d.floorTex}_512.jpg` : null,
      rail: rt ? `/assets/venues/tex/${rt}_512.jpg` : null,
    };
  }
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
