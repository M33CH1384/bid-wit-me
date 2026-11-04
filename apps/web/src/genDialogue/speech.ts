/**
 * PROTOTYPE (proto/nemotron-dialogue): the SPEECH stage for generated
 * lines, behind the same replaceable-adapter pattern as the dialogue
 * model.
 *
 * THE FENCE (owner amendment, 2026-11-03) — read before touching this:
 * a generated line may be spoken ONLY in the speaking persona's OWN cast
 * voice, synthesized by the in-house Chatterbox studio chain: Chatterbox
 * generation from the persona's CREMA-D donor reference → DeepFilterNet
 * dfn_redo denoise → house audio format. ElevenLabs, Kokoro, any
 * external or catalog TTS, web speech (speechSynthesis) in ANY form, and
 * substitute voices remain FORBIDDEN. If it isn't the persona's own
 * Chatterbox voice, the line stays TEXT.
 *
 * MOCK speech mode (the default) proves the plumbing — interface,
 * timing, stale-drop, mute — WITHOUT producing any fake voice: it
 * reports text-only, labeled, every time. The real studio service is an
 * env-configured endpoint (VITE_GEN_SPEECH_URL; unset by default) that
 * fails closed to text. No tone/noise stand-ins are ever presented as
 * voice.
 */
import { voiceFor, type PersonaId } from '@spades/bots';

export type SpeechResult =
  | { status: 'clip'; buffer: AudioBuffer; ms: number }
  | { status: 'text-only'; reason: string };

export interface SpeechRequest {
  persona: PersonaId;
  name: string;
  text: string;
  emotion: string;
}

export interface SpeechAdapter {
  readonly id: string;
  readonly configured: boolean;
  synthesize(req: SpeechRequest, signal?: AbortSignal): Promise<SpeechResult>;
}

/** Clearly labeled mock: NO audio, ever — the plumbing runs, the line stays text. */
export class MockSpeechAdapter implements SpeechAdapter {
  readonly id = 'mock-speech';
  readonly configured = false;
  async synthesize(): Promise<SpeechResult> {
    return { status: 'text-only', reason: 'mock-speech: plumbing proof only — no voice is produced in mock mode' };
  }
}

/**
 * The persona → studio routing the speech service needs. The repo
 * carries persona → sprite voice key (PERSONA_VOICES via voiceFor); the
 * endpoint maps voiceKey → the persona's CREMA-D donor reference using
 * the studio's bake records (that table lives with the studio, not in
 * this repo — see the lane REPORT).
 */
export function speechRouteFor(persona: PersonaId, name: string): { voiceKey: string; gender: 'f' | 'm'; sprite: string; speed: number } {
  const v = voiceFor(persona, name);
  return { voiceKey: v.voice, gender: v.gender, sprite: `${persona}-${v.gender}`, speed: v.speed };
}

export interface ChatterboxSpeechConfig {
  url?: string;
  /** DEV ONLY, same rule as the dialogue adapter: production goes through the game's server proxy. */
  key?: string;
  fetchFn?: typeof fetch;
  decode?: (bytes: ArrayBuffer) => Promise<AudioBuffer>;
}

/**
 * The real studio chain, as an HTTP service contract:
 *   POST { persona, voiceKey, sprite, text, emotion, format: 'mp3' }
 *   → 200 audio bytes (house format: MP3 128k 44.1k) of the persona's own
 *     Chatterbox voice (donor-routed server-side), dfn_redo-denoised.
 * Anything else (unset URL, non-200, undecodable) fails closed to text.
 */
export class ChatterboxSpeechAdapter implements SpeechAdapter {
  readonly id = 'chatterbox-studio';
  constructor(private cfg: ChatterboxSpeechConfig) {}
  get configured(): boolean { return !!this.cfg.url && !!this.cfg.decode; }
  async synthesize(req: SpeechRequest, signal?: AbortSignal): Promise<SpeechResult> {
    if (!this.cfg.url) return { status: 'text-only', reason: 'speech-unconfigured' };
    if (!this.cfg.decode) return { status: 'text-only', reason: 'speech-no-decoder' };
    const route = speechRouteFor(req.persona, req.name);
    const fetchFn = this.cfg.fetchFn ?? fetch;
    try {
      const res = await fetchFn(this.cfg.url, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.cfg.key ? { Authorization: `Bearer ${this.cfg.key}` } : {}),
        },
        body: JSON.stringify({ persona: req.persona, voiceKey: route.voiceKey, sprite: route.sprite, speed: route.speed, text: req.text, emotion: req.emotion, format: 'mp3' }),
      });
      if (!res.ok) return { status: 'text-only', reason: `speech-http-${res.status}` };
      const bytes = await res.arrayBuffer();
      const buffer = await this.cfg.decode(bytes);
      return { status: 'clip', buffer, ms: Math.round(buffer.duration * 1000) };
    } catch (e) {
      return { status: 'text-only', reason: `speech-failed:${e instanceof Error ? e.message : 'unknown'}` };
    }
  }
}
