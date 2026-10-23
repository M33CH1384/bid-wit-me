/** Spatial audio groundwork (Phase 2): pure helpers + a thin PannerNode factory over the ONE existing
 *  engine in audio.ts. No second engine, and trigger timing is untouched — spatial nodes only route
 *  gain/pan downstream of the existing impact-frame triggers (#169). */
import type { VenueBed } from './audio';
import { isLockedVenue, type VenueId } from '@spades/protocol';

/** Seat directions mirrored from three/layout.ts seatDir (kept import-free: audio.ts loads on the
 *  first script, which must never statically pull in three). Keep in sync with layout.seatDir. */
export type SeatPos = 'bottom' | 'top' | 'left' | 'right';
function seatDirLocal(pos: SeatPos, n: number): { x: number; z: number } {
  if (n === 3 && pos === 'left') return { x: -0.86, z: -0.5 };
  if (n === 3 && pos === 'right') return { x: 0.86, z: -0.5 };
  switch (pos) { case 'bottom': return { x: 0, z: 1 }; case 'top': return { x: 0, z: -1 }; case 'left': return { x: -1, z: 0 }; case 'right': return { x: 1, z: 0 }; }
}

export type AudioQuality = 'low' | 'balanced' | 'high';
export type Category = 'master' | 'music' | 'ambience' | 'sfx' | 'playerVoice' | 'aiVoice' | 'crowd';
export interface CategoryVolumes { sfx: number; ambience: number; playerVoice: number; aiVoice: number; crowd: number }
export const DEFAULT_CATEGORY_VOLUMES: CategoryVolumes = { sfx: 1, ambience: 1, playerVoice: 1, aiVoice: 1, crowd: 1 };
const clamp01 = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

export function normalizeCategoryVolumes(raw: Partial<CategoryVolumes> | undefined): CategoryVolumes {
  return { sfx: clamp01(raw?.sfx, 1), ambience: clamp01(raw?.ambience, 1), playerVoice: clamp01(raw?.playerVoice, 1), aiVoice: clamp01(raw?.aiVoice, 1), crowd: clamp01(raw?.crowd, 1) };
}
/** HRTF panners allowed at once per quality tier (iOS CPU guard). */
export function pannerCap(q: AudioQuality): number { return q === 'low' ? 4 : q === 'high' ? 12 : 8; }
/** Same low-power heuristic family as the graphics defaultQuality(). */
export function defaultAudioQuality(env: { deviceMemory?: number; cores?: number } = {}): AudioQuality {
  const mem = env.deviceMemory, cores = env.cores ?? 8;
  return (mem !== undefined && mem <= 3) || cores <= 3 ? 'low' : 'balanced';
}
/** HRTF where supported; phones get the cheaper equalpower model. */
export function pickPanningModel(supportsHRTF: boolean, isPhone: boolean): 'HRTF' | 'equalpower' {
  return supportsHRTF && !isPhone ? 'HRTF' : 'equalpower';
}

/** World point for a seat's sounds (card lands / voice): seat direction at table radius, ear height. */
export function seatPoint(pos: SeatPos, n: number): { x: number; y: number; z: number } {
  const d = seatDirLocal(pos, n);
  const len = Math.hypot(d.x, d.z) || 1;
  return { x: (d.x / len) * 2.1, y: 0.55, z: (d.z / len) * 2.1 };
}
/** The AudioListener follows the actual camera, so Sitting (lower/closer) hears a closer table. */
export interface CamPose { pos: readonly number[]; look: readonly number[] }
/** Maps a camera pose (from three/layout cameraFor, passed in by the scene) to a listener pose, so
 *  the listener follows Sitting/Standing without spatial.ts importing three. */
export function listenerPose(c: CamPose) {
  return { position: { x: c.pos[0]!, y: c.pos[1]!, z: c.pos[2]! }, look: { x: c.look[0]!, y: c.look[1]!, z: c.look[2]! } };
}

/** Predicted PannerNode inverse-distance gain (matches Spatializer's refDistance/rolloff). */
export function pannerGainAt(distance: number, refDistance = 2.2, rolloffFactor = 0.7): number {
  if (!(distance > refDistance)) return 1;
  return refDistance / (refDistance + rolloffFactor * (distance - refDistance));
}
/** Distance compensation for a seat: boost far seats back toward the near (bottom) seat's predicted
 *  loudness, capped, so a far slam keeps its punch (within ~10-15% of pre-spatial) without
 *  flattening the near seat. Direction still comes from the panner; this only restores level. */
export function seatCompensation(listener: { x: number; y: number; z: number }, pos: SeatPos, n: number): number {
  const d = (pt: { x: number; y: number; z: number }) => Math.hypot(pt.x - listener.x, pt.y - listener.y, pt.z - listener.z);
  const ratio = pannerGainAt(d(seatPoint('bottom', n))) / pannerGainAt(d(seatPoint(pos, n)));
  return Math.min(2.4, Math.max(1, ratio));
}

/** No-repeat variant picker: never the same sample variant twice in a row per event (count<=1 -> 0). */
export function pickVariant(count: number, last: number, rnd: () => number = Math.random): number {
  if (!(count > 1)) return 0;
  let pick = Math.floor(rnd() * count) % count;
  if (pick === last) pick = (pick + 1) % count;
  return pick;
}

/** Voice line gain, applied EXACTLY once (in playVoice): caller gain (talk-prefs voiceVolume x 0.9)
 *  times the AI-voice category volume. Callers must not pre-multiply the category, and the voice bus
 *  must not apply it again — that was the double-count to avoid. */
export function voiceLineGain(callerGain: number, volumes: Partial<CategoryVolumes> | undefined): number {
  return callerGain * normalizeCategoryVolumes(volumes).aiVoice;
}

/** Per-player local voice mute (never signalled; card SFX for that seat are unaffected). */
export function isVoiceMuted(muted: Record<string, true> | undefined, playerId: string): boolean { return !!muted?.[playerId]; }
export function withVoiceMuted(muted: Record<string, true> | undefined, playerId: string, mute: boolean): Record<string, true> {
  const next = { ...(muted ?? {}) };
  if (mute) next[playerId] = true; else delete next[playerId];
  return next;
}

export const SOUNDSCAPE_ROOMS: Exclude<VenueBed, 'none'>[] = ['cookout', 'basement', 'barbershop', 'casino', 'jazz', 'beach', 'kitchen', 'mansion', 'rooftop', 'yacht'];
/** Ambient one-shot event sets a venue's bed can schedule (audio.ts buildBed gates on these). */
export type VenueEvent = 'driveby' | 'headlights';
/** A venue's music character: `pin` = this track file always (The Pj's); `lean` = signature
 *  track files the shuffle opens with when the venue is applied (first pick only, then the
 *  global no-repeat shuffle resumes). Track files must exist in audio.ts TRACKS. */
export interface RoomMusic { pin?: string; lean: readonly string[] }
/**
 * VENUE AUDIO IDENTITY — the single source of truth for how a venue SOUNDS (owner, 2026-10-21:
 * "each venue should have its own feel audibly … and should be consistent"). One entry per
 * venue carrying its whole audible signature: ambience bed, card surface, reverb, crowd,
 * music character and ambient events. Every consumer reads from here — the bed player and
 * IR/surface in audio.ts (via applySoundscape → sessionRoom), the music picker, the bed
 * event schedulers, and venues.ts derives its `bed` field from this table — so a venue's
 * feel cannot drift between screens or visits. There is no user soundscape picker: the
 * venue decides, always.
 */
export interface RoomStyle { venue: string; name: string; bed: VenueBed; surface: 'felt' | 'wood' | 'laminate' | 'glass'; reverb: 'dry-outdoor' | 'tight' | 'lively' | 'hall' | 'studio'; crowd: 'none' | 'low' | 'party' | 'arena'; music: RoomMusic; events: readonly VenueEvent[] }
/** One sound style PER ROOM (Demetrius, supersedes shared families). Every repo venue gets its own
 *  ambience bed, reverb character, table surface and crowd. Pool/picker enumerate exactly these. */
export const ROOM_STYLES: RoomStyle[] = [
  { venue: 'classic', name: 'Classic Studio', bed: 'none', surface: 'felt', reverb: 'studio', crowd: 'none', music: { lean: ['windows-down', 'chillin-hard', 'glad-to-be-stuck-inside'] }, events: [] },
  { venue: 'backyard', name: 'Backyard Cookout', bed: 'cookout', surface: 'wood', reverb: 'dry-outdoor', crowd: 'party', music: { lean: ['sunset-drive', 'windows-down', 'coins'] }, events: [] },
  { venue: 'mansion', name: 'Mansion', bed: 'mansion', surface: 'glass', reverb: 'hall', crowd: 'low', music: { lean: ['slowly', 'memories-of-spring', 'chillin-hard'] }, events: [] },
  { venue: 'barbershop', name: 'Barbershop', bed: 'barbershop', surface: 'wood', reverb: 'lively', crowd: 'low', music: { lean: ['city', 'new-hip-hop-beat', 'slow-grind'] }, events: [] },
  { venue: 'church', name: 'Basement Spades Night', bed: 'basement', surface: 'laminate', reverb: 'tight', crowd: 'low', music: { lean: ['glad-to-be-stuck-inside', 'slowly', 'snow-drift'] }, events: [] },
  { venue: 'rooftop', name: 'Rooftop', bed: 'rooftop', surface: 'wood', reverb: 'dry-outdoor', crowd: 'low', music: { lean: ['nighttime-stroll', 'late-at-night', 'city'] }, events: [] },
  { venue: 'speakeasy', name: 'Speakeasy Lounge', bed: 'jazz', surface: 'felt', reverb: 'lively', crowd: 'low', music: { lean: ['slow-grind', 'pyro-flow', 'late-at-night'] }, events: [] },
  { venue: 'vegas', name: 'Vegas High Roller', bed: 'casino', surface: 'felt', reverb: 'hall', crowd: 'arena', music: { lean: ['coins', 'final-level', 'pyro-flow'] }, events: [] },
  { venue: 'beach', name: 'Beach Cabana', bed: 'beach', surface: 'wood', reverb: 'dry-outdoor', crowd: 'low', music: { lean: ['sunset-drive', '2-hour-delay', 'pretty-little-lies'] }, events: [] },
  { venue: 'grandma', name: "Grandma's Kitchen", bed: 'kitchen', surface: 'laminate', reverb: 'tight', crowd: 'none', music: { lean: ['memories-of-spring', 'glad-to-be-stuck-inside', 'snow-drift'] }, events: [] },
  { venue: 'yacht', name: 'Yacht Deck', bed: 'yacht', surface: 'wood', reverb: 'dry-outdoor', crowd: 'low', music: { lean: ['slowly', 'sunset-drive', '2-hour-delay'] }, events: [] },
  { venue: 'blockAfterDark', name: "The Pj's", bed: 'street', surface: 'felt', reverb: 'dry-outdoor', crowd: 'low', music: { pin: 'marty-gots-a-plan', lean: [] }, events: ['driveby', 'headlights'] },
];
export function styleForVenue(venue: string): RoomStyle | undefined { return ROOM_STYLES.find((r) => r.venue === venue); }

/**
 * STORY MODE AUDIO (Story Audio Pass, 2026-10-21) — how a story STOP sounds, layered over its
 * venue's identity. Each stop (ids from packages/bots story.ts) gets a score mood; the engine
 * (audio.ts setStoryStop → pickNext) resolves the mood to the game's original score:
 * 'theme' = the story theme in rotation, 'sparse' = the theme stripped down and looped for
 * the slow stops (Porch evening, Church Basement, Rooftop — the score breathes, per the
 * owner's range note), 'danger' = the tension bed looped, 'king' = the boss arrangement
 * looped. A stop may also name a bed override for when its VENUE is silent
 * by design — the Rec Center plays in the Classic Studio (bed 'none'), so the stop supplies
 * the gym's 'rec' bed. Everywhere else the venue's own bed (upgraded in buildBed) carries the
 * place. In story context the mood outranks the venue's music character (the Pj's stop plays
 * the danger bed, not the venue's Marty pin — the pin still rules normal Pj's games), and the
 * King gets his own music, full stop.
 *
 * SOUND SAMPLE (2026-10-23): the Porch is the pilot for the film-mix design — it carries its
 * own mood ('porch' → the Porchlight score, looped) AND its own bed ('porch': room tone /
 * close human sounds / outside world on separate layer gains the engine's film controller
 * rides — bidding thins the score, a set drops it a register, the nuke ducks everything).
 * The override pattern is the Rec Center's, extended: the Porch stop replaces its host
 * venue's bed outright, while a normal Grandma's Kitchen game keeps the 'kitchen' bed.
 * Every other stop keeps its identity above, byte for byte, until the owner rules on the
 * sample.
 */
export type StoryMood = 'theme' | 'sparse' | 'danger' | 'king' | 'porch';
export interface StoryStopAudio { mood: StoryMood; bed?: VenueBed }
export const STORY_STOP_AUDIO: Record<string, StoryStopAudio> = {
  'porch': { mood: 'porch', bed: 'porch' },
  'barbershop': { mood: 'theme' },
  'rec-center': { mood: 'theme', bed: 'rec' },
  'cookout': { mood: 'theme' },
  'corner': { mood: 'danger' },
  'church-basement': { mood: 'sparse' },
  'rooftop': { mood: 'sparse' },
  'high-rise': { mood: 'danger' },
  'the-pjs': { mood: 'danger' },
  'legends': { mood: 'theme' },
  'king': { mood: 'king' },
};
export function storyAudioForStop(stopId: string): StoryStopAudio | undefined { return STORY_STOP_AUDIO[stopId]; }
/** The venue audio identity for a venue id (alias of styleForVenue — the one resolver every
 *  audio consumer goes through). */
export type VenueAudioIdentity = RoomStyle;
export function audioIdentityForVenue(venue: string): VenueAudioIdentity | undefined { return styleForVenue(venue); }
/** Competitive Tournament (Demetrius's named room): a tournament-hall soundscape riding the casino
 *  bed/arena crowd — distinct name, hall reverb, felt surface. (It was a pickable soundscape
 *  until 2026-10-20; the venue decides the sounds now, so it stays as a named style only.) */
export const TOURNAMENT_ROOM: RoomStyle = { venue: 'vegas', name: 'Competitive Tournament', bed: 'casino', surface: 'felt', reverb: 'hall', crowd: 'arena', music: { lean: ['final-level', 'coins'] }, events: [] };
/** Unified session room (Phase 4): what you SEE is what you HEAR is what the loading screen NAMES.
 *  The VENUE decides the sounds, always (owner, 2026-10-20 — the soundscape picker is gone):
 *  online, the shared room venue decides (every client same); offline, the venue picked in
 *  setup/settings decides; on Random, a seeded roll per game picks the room — and that rolled
 *  room becomes the visual venue for the game too, so the sound still follows the venue.
 *  One style per room, all 12 venues covered by ROOM_STYLES. */
export function sessionRoom(o: { visualVenue?: string; seed?: string; onlineVenue?: string; lockedVenues?: boolean }): RoomStyle {
  if (o.onlineVenue) return styleForVenue(o.onlineVenue) ?? ROOM_STYLES[0]!;
  // 1) The venue picked for this game wins (seen = heard = named, still unified).
  if (o.visualVenue) return styleForVenue(o.visualVenue) ?? ROOM_STYLES[0]!;
  // 2) Random venue: roll over ALL 12 rooms — Classic included (its bed is 'none': a quiet studio game).
  //    Locked venues (The Pj's) join the roll only when the player is entitled to them
  //    (`lockedVenues`, from the venue unlock state); the default keeps them out.
  if (o.seed !== undefined) {
    const pool = o.lockedVenues ? ROOM_STYLES : ROOM_STYLES.filter((s) => !isLockedVenue(s.venue as VenueId));
    return pool[seedHash(o.seed) % pool.length]!;
  }
  return ROOM_STYLES[0]!;
}
/** Convolver character per room (pre-baked/generated IRs only — no assets): length + wet level. */
export const IR_SPECS: Record<RoomStyle['reverb'], { seconds: number; wet: number }> = {
  'dry-outdoor': { seconds: 0.25, wet: 0.1 }, tight: { seconds: 0.55, wet: 0.22 }, lively: { seconds: 0.95, wet: 0.32 },
  hall: { seconds: 2.3, wet: 0.42 }, studio: { seconds: 0.35, wet: 0.16 },
};
export function irSpec(style: RoomStyle): { seconds: number; wet: number } { return IR_SPECS[style.reverb]; }
/** Card-sound surface character: brighter = harder surface (glass/wood slap), softer = felt. */
export const SURFACE_HZ: Record<RoomStyle['surface'], number> = { felt: 5200, laminate: 6800, wood: 8400, glass: 11500 };
export function surfaceHz(style: RoomStyle): number { return SURFACE_HZ[style.surface]; }
export function styleForBed(bed: VenueBed): RoomStyle | undefined { return ROOM_STYLES.find((r) => r.bed === bed && r.bed !== 'none') ?? ROOM_STYLES[0]; }
export function roomName(room: VenueBed): string { return room === 'none' ? 'Classic Studio' : styleForBed(room)?.name ?? room; }
function seedHash(seed: string): number { let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Soundscape bed resolver. The venue's signature bed wins (owner, 2026-10-20: each room
 *  has its own signature sounds, set automatically — there is no user soundscape pick).
 *  No venue (Random): a seeded roll per game/session (host/session seed, so online clients
 *  agree on the room the roll picked). */
export function resolveSoundscape(o: { venue?: string; seed?: string }): VenueBed {
  if (o.venue && o.venue !== 'random') { const st = styleForVenue(o.venue); if (st) return st.bed; }
  if (o.seed !== undefined) return SOUNDSCAPE_ROOMS[seedHash(o.seed) % SOUNDSCAPE_ROOMS.length]!;
  return 'none';
}

/** Minimal structural type so tests can fake an AudioContext. */
export interface PannerLike { panningModel: string; distanceModel: string; refDistance: number; rolloffFactor: number; positionX: { value: number }; positionY: { value: number }; positionZ: { value: number }; connect(dest: unknown): unknown }
export interface SpatialCtxLike { createPanner(): PannerLike; listener?: { positionX: { value: number }; positionY: { value: number }; positionZ: { value: number }; forwardX: { value: number }; forwardY: { value: number }; forwardZ: { value: number }; upX: { value: number }; upY: { value: number }; upZ: { value: number } } }

/** Creates a seat panner, or returns null when spatial is off (caller then connects straight to the
 *  bus, exactly today's stereo graph). Caps live HRTF nodes per quality tier. */
export class Spatializer {
  private live = 0;
  constructor(private quality: AudioQuality, private enabled: boolean, private model: 'HRTF' | 'equalpower') {}
  get livePanners(): number { return this.live; }
  seatPanner(ctx: SpatialCtxLike, pos: SeatPos, n: number): PannerLike | null {
    if (!this.enabled || this.live >= pannerCap(this.quality)) return null;
    const p = ctx.createPanner();
    p.panningModel = this.model; p.distanceModel = 'inverse'; p.refDistance = 2.2; p.rolloffFactor = 0.7;
    const pt = seatPoint(pos, n);
    p.positionX.value = pt.x; p.positionY.value = pt.y; p.positionZ.value = pt.z;
    this.live++;
    return p;
  }
  release(): void { if (this.live > 0) this.live--; }
  /** Slave the listener to the camera pose for the current view. */
  applyListener(ctx: SpatialCtxLike, cam: CamPose): void {
    const l = ctx.listener; if (!l) return;
    const pose = listenerPose(cam);
    l.positionX.value = pose.position.x; l.positionY.value = pose.position.y; l.positionZ.value = pose.position.z;
    l.forwardX.value = pose.look.x - pose.position.x; l.forwardY.value = pose.look.y - pose.position.y; l.forwardZ.value = pose.look.z - pose.position.z;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  }
}
