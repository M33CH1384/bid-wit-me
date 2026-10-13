/**
 * Recorded bot voices (Kokoro-82M, Apache-2.0). Every persona has a female and a male voice; the bot's NAME picks
 * which (voiceGender in @spades/bots), so a female name never gets a male voice. All of a persona-gender's lines live
 * in ONE audio sprite (/voices/v2/<persona>-<f|m>.(webm|m4a)) with a small JSON of [startMs, durMs] per raw line, so
 * a seated bot costs one fetch and nothing else is downloaded. Lines are matched by their raw (unfilled) template;
 * templated lines have a generic take ("SET! {opp} going backwards" → "Set! Y'all going backwards!"), and the
 * "You bid {bid} for THAT?!" lines have one take per number. Lines without a clip → Web Speech (right gender).
 * Opus/WebM where the browser can play it, else AAC/M4A (Safari).
 */
import { type PersonaId, lineById, voiceFor } from '@spades/bots';
import { decodeAudioBuffer, sound } from '../audio';

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

interface Sprite { clips: Record<string, [number, number]>; buf: AudioBuffer | null }
/** sprite key ("og-f") → its clip map + decoded audio (or the pending fetch) */
const cache = new Map<string, Promise<Sprite | null>>();
export const VOICE_BASE = '/voices/v2';
function load(key: string): Promise<Sprite | null> {
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const meta = await fetch(`${VOICE_BASE}/${key}.json`);
        if (!meta.ok) return null;
        const { clips } = (await meta.json()) as { clips: Record<string, [number, number]> };
        const res = await fetch(`${VOICE_BASE}/${key}.${format()}`);
        if (!res.ok) return { clips, buf: null };
        const data = await res.arrayBuffer();
        const ctx = sound.audioContext();
        return { clips, buf: ctx ? await decodeAudioBuffer(ctx, data) : null };
      } catch { return null; }
    })();
    cache.set(key, p);
  }
  return p;
}

/** Raw line for a server/offline line id, if this build knows it. */
export function rawLine(lineId: string | undefined): string | undefined { return lineId ? lineById(lineId) : undefined; }

/** A bot sat down: fetch + decode its persona-gender sprite in the background (only seated bots are ever fetched). */
export function preloadVoice(persona: PersonaId, name: string): void {
  const key = voiceFor(persona, name).key;
  if (cache.has(key)) return;
  const go = () => { void load(key); };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (ric) ric(go); else setTimeout(go, 400);
}

/**
 * Play the recorded clip for this line. Resolves true when a clip played (or is playing), false when there's no clip
 * (the caller falls back to Web Speech). A sprite that isn't decoded yet still plays if it arrives within 1.5 s.
 */
export async function playClip(persona: PersonaId, name: string, raw: string | undefined, gain: number, bid?: number): Promise<boolean> {
  if (!raw) return false;
  const t0 = performance.now();
  const sp = await load(voiceFor(persona, name).key);
  const at = sp && ((bid !== undefined ? sp.clips[`${raw}#${bid}`] : undefined) ?? sp.clips[raw]);
  if (!sp?.buf || !at) return false;
  if (performance.now() - t0 > 1500) return true; // too late to still fit the moment: stay quiet
  sound.playVoice(sp.buf, gain, [at[0] / 1000, at[1] / 1000]);
  return true;
}
