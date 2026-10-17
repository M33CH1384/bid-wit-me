/**
 * Voice Phase 3 client playback. A bot line may carry `ai` (a pre-voiced catalog line, only when the host flag
 * `aiTalk` is on). The catalog text and its clip always go together: if the clip plays, that text goes in the chat;
 * if anything misses (player toggle off, voices or sound off, clip missing, slow, or no table), the canned line goes
 * out exactly as today, text and audio together. The game never waits on this beyond a short clip fetch.
 */
import { aiClipUrl } from '@spades/bots';
import { sound } from '../audio';

/** Past this, the moment has passed: fall back to the canned line. */
export const AI_CLIP_TIMEOUT_MS = 1200;
const cache = new Map<string, Promise<AudioBuffer | null>>();

/** Fetch + decode one clip (cached per id; a failure is cached too so a missing clip costs one request). */
export function loadAiClip(id: string, fetchFn: typeof fetch = fetch): Promise<AudioBuffer | null> {
  let p = cache.get(id);
  if (!p) {
    p = (async () => {
      try {
        const ctx = sound.audioContext();
        if (!ctx) return null;
        const res = await fetchFn(aiClipUrl(id));
        if (!res.ok) return null;
        return await ctx.decodeAudioData(await res.arrayBuffer());
      } catch { return null; }
    })();
    cache.set(id, p);
  }
  return p;
}
export function clearAiClipCache(): void { cache.clear(); }

export interface AiGate { aiVoices: boolean; voices: boolean; soundOn: boolean }
/** Whether this device should even try the AI clip. */
export function wantsAi(line: { ai?: { id: string; text: string } }, g: AiGate): boolean {
  return !!line.ai && g.aiVoices && g.voices && g.soundOn;
}

/**
 * Deliver one bot line. `show` puts text in the chat; `canned` speaks today's line. Exactly one text is shown,
 * and it is the one whose audio plays.
 */
export async function deliverBotLine(
  line: { text: string; ai?: { id: string; text: string } },
  g: AiGate & { gain: number },
  show: (text: string) => void,
  canned: () => void,
  load: (id: string) => Promise<AudioBuffer | null> = loadAiClip,
  play: (buf: AudioBuffer, gain: number) => boolean = (b, gain) => sound.playVoice(b, gain),
): Promise<'ai' | 'canned'> {
  if (wantsAi(line, g)) {
    const buf = await Promise.race([load(line.ai!.id), new Promise<null>((r) => setTimeout(() => r(null), AI_CLIP_TIMEOUT_MS))]);
    if (buf && play(buf, g.gain)) { show(line.ai!.text); return 'ai'; }
  }
  show(line.text);
  canned();
  return 'canned';
}
