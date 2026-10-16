/**
 * Voice Phase 3 (docs/voice-phase2-design.md): pre-voiced catalog lines for three moments, behind the host flag
 * `aiTalk` (default off). A catalog line is only ever used when its baked clip exists (the bake writes both the
 * text and the clip id into catalog.json). Lines speak roles ("y'all", "partner") and numbers from the hand's facts,
 * so one clip is true at every table. Anything that misses falls back to today's canned line.
 */
import type { PersonaId } from './personas';
import CATALOG_JSON from './catalog.json';

export type VoiceMoment = 'set' | 'wheels' | 'win';

/**
 * Buckets: set by 1 / 2 / 3+, Wheels made on a 10+ bid, Wheels on an underbid (exact bid and books in the key),
 * match win. Wheels here = a team took 10 or more books, whatever it bid.
 */
export type VoiceBucket = 'set1' | 'set2' | 'set3' | `wheelsBid:${number}:${number}` | `wheelsUnder:${number}:${number}` | 'win';

export interface CatalogLine {
  /** sha256(voice | speed | normalized text), first 16 hex: also the clip file name (/voices/ai/<id>.mp3) */
  id: string;
  persona: PersonaId;
  g: 'f' | 'm';
  bucket: VoiceBucket;
  text: string;
}

export const CATALOG: readonly CatalogLine[] = (CATALOG_JSON as { lines: CatalogLine[] }).lines;
export const AI_CLIP_BASE = '/voices/ai';
export const aiClipUrl = (id: string) => `${AI_CLIP_BASE}/${id}.mp3`;

/** The bucket a moment's facts land in, or null when the catalog has nothing for it. */
export function bucketFor(moment: VoiceMoment, facts: { bid?: number; books?: number }): VoiceBucket | null {
  const { bid, books } = facts;
  if (moment === 'win') return 'win';
  if (moment === 'set') {
    if (typeof bid !== 'number' || typeof books !== 'number' || books >= bid) return null;
    const by = bid - books;
    return by >= 3 ? 'set3' : by === 2 ? 'set2' : 'set1';
  }
  if (typeof bid !== 'number' || typeof books !== 'number' || books < 10) return null;
  return bid >= 10 ? `wheelsBid:${bid}:${books}` : `wheelsUnder:${bid}:${books}`;
}

/** Per-table memory: catalog ids already said this game (never repeated) */
export interface CatalogMemory { said?: string[] }

/**
 * A fresh catalog line for this persona-gender and bucket, never one this table already heard. Null → canned.
 * `heard` lets a client prefer clips it has not played (device memory) when the bucket still has others.
 */
export function pickCatalog(mem: CatalogMemory, persona: PersonaId, g: 'f' | 'm', bucket: VoiceBucket, rnd: () => number, catalog: readonly CatalogLine[] = CATALOG): CatalogLine | null {
  const said = (mem.said ??= []);
  const pool = catalog.filter((l) => l.persona === persona && l.g === g && l.bucket === bucket && !said.includes(l.id));
  if (!pool.length) return null;
  const line = pool[Math.floor(rnd() * pool.length)]!;
  said.push(line.id);
  return line;
}
