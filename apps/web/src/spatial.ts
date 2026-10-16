/** Spatial audio groundwork (Phase 2): pure helpers + a thin PannerNode factory over the ONE existing
 *  engine in audio.ts. No second engine, and trigger timing is untouched — spatial nodes only route
 *  gain/pan downstream of the existing impact-frame triggers (#169). */
import { cameraFor, seatDir, type SeatPos } from './three/layout';
import type { VenueBed } from './audio';

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
  const d = seatDir(pos, n);
  return { x: d.x * 2.1, y: 0.55, z: d.z * 2.1 };
}
/** The AudioListener follows the actual camera, so Sitting (lower/closer) hears a closer table. */
export function listenerPose(aspect: number, short: boolean, view: 'standing' | 'sitting') {
  const c = cameraFor(aspect, short, view);
  return { position: { x: c.pos[0], y: c.pos[1], z: c.pos[2] }, look: { x: c.look[0], y: c.look[1], z: c.look[2] } };
}

/** Per-player local voice mute (never signalled; card SFX for that seat are unaffected). */
export function isVoiceMuted(muted: Record<string, true> | undefined, playerId: string): boolean { return !!muted?.[playerId]; }
export function withVoiceMuted(muted: Record<string, true> | undefined, playerId: string, mute: boolean): Record<string, true> {
  const next = { ...(muted ?? {}) };
  if (mute) next[playerId] = true; else delete next[playerId];
  return next;
}

export const SOUNDSCAPE_ROOMS: Exclude<VenueBed, 'none'>[] = ['cookout', 'basement', 'barbershop', 'casino', 'jazz', 'beach', 'kitchen', 'mansion', 'rooftop', 'yacht'];
/** Demetrius's four soundscape families. EVERY room stays in the Auto random pool; each room maps to
 *  exactly one family's audio character (bed tone, convolver size, card surface). Competitive
 *  Tournament is a family (large hall), not a room — mansion/casino carry it. */
export type SoundscapeFamily = 'cookout' | 'basement' | 'barbershop' | 'tournament';
export const ROOM_FAMILY: Record<(typeof SOUNDSCAPE_ROOMS)[number], SoundscapeFamily> = {
  cookout: 'cookout', beach: 'cookout', rooftop: 'cookout', yacht: 'cookout', kitchen: 'cookout',
  basement: 'basement',
  barbershop: 'barbershop', jazz: 'barbershop',
  mansion: 'tournament', casino: 'tournament',
};
export function familyOf(room: VenueBed): SoundscapeFamily | null { return room === 'none' ? null : ROOM_FAMILY[room as (typeof SOUNDSCAPE_ROOMS)[number]] ?? null; }
/** Intelligible name for the loading chip / menu (Phase 4): the room's own name; the family only
 *  shapes the audio. basement's room is the Church Basement venue, whose soundscape name follows. */
export const ROOM_NAMES: Record<(typeof SOUNDSCAPE_ROOMS)[number], string> = {
  cookout: 'Backyard Cookout', basement: 'Basement Spades Night', barbershop: 'Barbershop', casino: 'Vegas High Roller',
  jazz: 'Speakeasy Lounge', beach: 'Beach Cabana', kitchen: "Grandma's Kitchen", mansion: 'Mansion', rooftop: 'Rooftop', yacht: 'Yacht Deck',
};
export function roomName(room: VenueBed): string { return room === 'none' ? '' : ROOM_NAMES[room as (typeof SOUNDSCAPE_ROOMS)[number]] ?? room; }
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
  applyListener(ctx: SpatialCtxLike, aspect: number, short: boolean, view: 'standing' | 'sitting'): void {
    const l = ctx.listener; if (!l) return;
    const pose = listenerPose(aspect, short, view);
    l.positionX.value = pose.position.x; l.positionY.value = pose.position.y; l.positionZ.value = pose.position.z;
    l.forwardX.value = pose.look.x - pose.position.x; l.forwardY.value = pose.look.y - pose.position.y; l.forwardZ.value = pose.look.z - pose.position.z;
    l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
  }
}
