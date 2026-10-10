/**
 * Recorded bot voices (Kokoro-82M, Apache-2.0): one clip per persona line, in /voices/<persona>/<lineId>.(webm|m4a).
 * A picked line is matched by persona + its raw (unfilled) line text via manifest.json; templated lines have a generic
 * recording ("SET! {opp} going backwards" → "Set! Y'all going backwards!"). Clean talk uses the `clean` take if there is one.
 * Opus/WebM where the browser can play it, else AAC/M4A (Safari). Clips are fetched + decoded lazily per persona when a
 * bot of that persona sits down. Lines without a clip (text-only, or added since the clips were made) → Web Speech.
 */
import { COMMON, PERSONAS, type PersonaId, lineById } from '@spades/bots';
import { sound } from '../audio';
import manifest from './manifest.json';

type Lookup = Record<string, Record<string, string[]>>;
const LOOKUP = (manifest as { lookup: Lookup }).lookup;

let ext: 'webm' | 'm4a' | null = null;
function format(): 'webm' | 'm4a' {
  if (ext) return ext;
  try {
    const a = document.createElement('audio');
    // Safari can say "maybe" for WebM/Opus but fail in decodeAudioData: only trust it off WebKit-only browsers
    const webkitOnly = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox|FxiOS|CriOS/.test(navigator.userAgent);
    ext = !webkitOnly && a.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'm4a';
  } catch { ext = 'm4a'; }
  return ext;
}

/** stem ("mama/common.nuke.2") → decoded clip (or the pending fetch) */
const cache = new Map<string, Promise<AudioBuffer | null>>();
function load(stem: string): Promise<AudioBuffer | null> {
  let p = cache.get(stem);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`/voices/${stem}.${format()}`);
        if (!res.ok) return null;
        const data = await res.arrayBuffer();
        const ctx = sound.audioContext();
        return ctx ? await ctx.decodeAudioData(data) : null;
      } catch { return null; }
    })();
    cache.set(stem, p);
  }
  return p;
}

/** The clip stem for a line (clean take when asked and available), or null. */
export function clipFor(persona: string, raw: string | undefined, clean: boolean): string | null {
  if (!raw) return null;
  const v = LOOKUP[persona]?.[raw];
  if (!v) return null;
  return (clean && v[1]) || v[0]!;
}

/** Raw line for a server/offline line id, if this build knows it. */
export function rawLine(lineId: string | undefined): string | undefined { return lineId ? lineById(lineId) : undefined; }

const preloaded = new Set<string>();
/** A bot of this persona sat down: fetch + decode its clips in the background (a few at a time). */
export function preloadPersona(persona: string, clean = true): void {
  if (preloaded.has(persona) || !LOOKUP[persona]) return;
  preloaded.add(persona);
  const stems = Object.values(LOOKUP[persona]!).map((v) => (clean && v[1]) || v[0]!);
  let i = 0;
  const next = (): Promise<void> => (i < stems.length ? load(stems[i++]!).then(() => next()) : Promise.resolve());
  const go = () => { for (let k = 0; k < 3; k++) void next(); };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (ric) ric(go); else setTimeout(go, 400);
}

/**
 * Play the recorded clip for this line. Resolves true when a clip played (or is playing), false when there's no clip
 * (the caller falls back to Web Speech). A clip that isn't decoded yet still plays if it arrives within 1.5 s.
 */
export async function playClip(persona: string, raw: string | undefined, clean: boolean, gain: number): Promise<boolean> {
  const stem = clipFor(persona, raw, clean);
  if (!stem) return false;
  const t0 = performance.now();
  const buf = await load(stem);
  if (!buf) return false;
  if (performance.now() - t0 > 1500) return true; // too late to still fit the moment: stay quiet
  sound.playVoice(buf, gain);
  return true;
}

/** Lines in this build with no recorded clip (new / edited since the clips were made, or text-only). */
export function unmatchedLines(): number {
  let n = 0;
  for (const persona of Object.keys(PERSONAS) as PersonaId[]) {
    const own = Object.values(PERSONAS[persona].lines).flat() as string[];
    const common = persona === 'silent' ? [] : (Object.values(COMMON).flat() as string[]);
    for (const raw of new Set([...own, ...common])) if (!LOOKUP[persona]?.[raw] && !/^…$/.test(raw)) n++;
  }
  return n;
}
if (import.meta.env.DEV) console.info(`[voices] ${unmatchedLines()} bot lines have no recorded clip (Web Speech fallback); clips made from personas.ts ${(manifest as { source: string }).source.slice(0, 8)}`);
