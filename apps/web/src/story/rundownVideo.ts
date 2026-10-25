/**
 * Dee's Rundown VIDEO selection (owner-approved 2026-10-25, Motion
 * Director): the 11 first-visit solo rundowns have a filmed version
 * (public/story/rundowns/, manifest rundowns.json keyed by stop id).
 *
 * The decision is pure and conservative: a line gets the video ONLY
 * when it is the solo 'first' variant, the manifest has an entry for
 * its stop whose variant is 'first' and whose script is the SAME text
 * (verbatim RUNDOWN_FIRST — so a re-written script never shows a stale
 * film), the device can play MP4, and this video hasn't already failed
 * to load this session. Everything else (return-after-loss/clear, King
 * leg 2, co-op pair lines, missing/failed files) keeps the existing
 * text + recorded-voice panel.
 *
 * The manifest is bundled (a few KB of JSON); the MP4s and posters are
 * plain public files fetched only when a rundown opens (preload="none").
 * The push-only service worker (public/sw.js) precaches nothing.
 */
import manifest from '../../public/story/rundowns/rundowns.json';

export interface RundownVideoEntry {
  file: string;
  poster: string;
  durationSeconds: number;
  variant: string;
  voice: string;
  text: string;
}

export const RUNDOWN_VIDEO_BASE = '/story/rundowns/';
export const RUNDOWN_VIDEOS = manifest as Record<string, RundownVideoEntry>;

/** Files that errored this session: they fall back to the text panel. */
const failed = new Set<string>();
export function markRundownVideoFailed(file: string) { failed.add(file); }
export function rundownVideoFailed(file: string) { return failed.has(file); }
export function resetRundownVideoFailures() { failed.clear(); }

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

export function canPlayMp4(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const v = document.createElement('video');
    return typeof v.canPlayType === 'function' && v.canPlayType('video/mp4') !== '';
  } catch { return false; }
}

export function pickRundownVideo(
  line: { stopId: string; variant: string; text: string },
  opts: { canPlay?: boolean; table?: Record<string, RundownVideoEntry> } = {},
): RundownVideoEntry | null {
  const canPlay = opts.canPlay ?? canPlayMp4();
  const table = opts.table ?? RUNDOWN_VIDEOS;
  if (!canPlay || line.variant !== 'first') return null;
  const e = Object.prototype.hasOwnProperty.call(table, line.stopId) ? table[line.stopId] : undefined;
  if (!e || e.variant !== 'first' || !e.file || !e.poster) return null;
  if (norm(e.text) !== norm(line.text)) return null;
  if (failed.has(e.file)) return null;
  return e;
}

/** How the video plays. `muted`: voices/sound off or Dee muted — the
 *  film plays silent with its burned-in captions. `autoplay`: only on
 *  the sit-down path, never under reduced effects, never once heard. */
export function rundownVideoPlayback(o: { autoplayPath: boolean; reduced: boolean; heard: boolean; voicesOff: boolean }) {
  return { muted: o.voicesOff, autoplay: o.autoplayPath && !o.reduced && !o.heard };
}
