/** Spatial audio groundwork (Phase 2): pure helpers + a thin PannerNode factory over the ONE existing
 *  engine in audio.ts. No second engine, and trigger timing is untouched — spatial nodes only route
 *  gain/pan downstream of the existing impact-frame triggers (#169). */
import type { VenueBed } from './audio';

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

/** No-repeat variant picker: never the same sample variant twice in a row per event (count<=1 -> 0). */
export function pickVariant(count: number, last: number, rnd: () => number = Math.random): number {
  if (!(count > 1)) return 0;
  let pick = Math.floor(rnd() * count) % count;
  if (pick === last) pick = (pick + 1) % count;
  return pick;
}

/** Per-player local voice mute (never signalled; card SFX for that seat are unaffected). */
export function isVoiceMuted(muted: Record<string, true> | undefined, playerId: string): boolean { return !!muted?.[playerId]; }
export function withVoiceMuted(muted: Record<string, true> | undefined, playerId: string, mute: boolean): Record<string, true> {
  const next = { ...(muted ?? {}) };
  if (mute) next[playerId] = true; else delete next[playerId];
  return next;
}

export const SOUNDSCAPE_ROOMS: Exclude<VenueBed, 'none'>[] = ['cookout', 'basement', 'barbershop', 'casino', 'jazz', 'beach', 'kitchen', 'mansion', 'rooftop', 'yacht'];
export interface RoomStyle { venue: string; name: string; bed: VenueBed; surface: 'felt' | 'wood' | 'laminate' | 'glass'; reverb: 'dry-outdoor' | 'tight' | 'lively' | 'hall' | 'studio'; crowd: 'none' | 'low' | 'party' | 'arena' }
/** One sound style PER ROOM (Demetrius, supersedes shared families). Every repo venue gets its own
 *  ambience bed, reverb character, table surface and crowd. Pool/picker enumerate exactly these. */
export const ROOM_STYLES: RoomStyle[] = [
  { venue: 'classic', name: 'Classic Studio', bed: 'none', surface: 'felt', reverb: 'studio', crowd: 'none' },
  { venue: 'backyard', name: 'Backyard Cookout', bed: 'cookout', surface: 'wood', reverb: 'dry-outdoor', crowd: 'party' },
  { venue: 'mansion', name: 'Mansion', bed: 'mansion', surface: 'glass', reverb: 'hall', crowd: 'low' },
  { venue: 'barbershop', name: 'Barbershop', bed: 'barbershop', surface: 'wood', reverb: 'lively', crowd: 'low' },
  { venue: 'church', name: 'Basement Spades Night', bed: 'basement', surface: 'laminate', reverb: 'tight', crowd: 'low' },
  { venue: 'rooftop', name: 'Rooftop', bed: 'rooftop', surface: 'wood', reverb: 'dry-outdoor', crowd: 'low' },
  { venue: 'speakeasy', name: 'Speakeasy Lounge', bed: 'jazz', surface: 'felt', reverb: 'lively', crowd: 'low' },
  { venue: 'vegas', name: 'Vegas High Roller', bed: 'casino', surface: 'felt', reverb: 'hall', crowd: 'arena' },
  { venue: 'beach', name: 'Beach Cabana', bed: 'beach', surface: 'wood', reverb: 'dry-outdoor', crowd: 'low' },
  { venue: 'grandma', name: "Grandma's Kitchen", bed: 'kitchen', surface: 'laminate', reverb: 'tight', crowd: 'none' },
  { venue: 'yacht', name: 'Yacht Deck', bed: 'yacht', surface: 'wood', reverb: 'dry-outdoor', crowd: 'low' },
];
export function styleForVenue(venue: string): RoomStyle | undefined { return ROOM_STYLES.find((r) => r.venue === venue); }
export function styleForBed(bed: VenueBed): RoomStyle | undefined { return ROOM_STYLES.find((r) => r.bed === bed && r.bed !== 'none') ?? ROOM_STYLES[0]; }
export function roomName(room: VenueBed): string { return room === 'none' ? 'Classic Studio' : styleForBed(room)?.name ?? room; }
function seedHash(seed: string): number { let h = 2166136261; for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Room resolver. Explicit room wins and persists; then a Story stop's mapped room; then Auto =
 *  a seeded random room per game/session (host/session seed, so online clients agree).
 *  Auto is never follow-venue. */
export function resolveSoundscape(o: { explicit?: string; storyRoom?: string; seed?: string; auto?: boolean }): VenueBed {
  if (o.explicit && o.explicit !== 'auto' && (SOUNDSCAPE_ROOMS as string[]).includes(o.explicit)) return o.explicit as VenueBed;
  if (o.storyRoom && (SOUNDSCAPE_ROOMS as string[]).includes(o.storyRoom)) return o.storyRoom as VenueBed;
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
