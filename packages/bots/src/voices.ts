/**
 * Kokoro-82M voices per persona and gender (recorded clips; see /workspace/bwm-voices). Kokoro v1.0 ids:
 * af_ / am_ American female / male, bf_ / bm_ British female / male. Personas that share a base voice use a different
 * speed so they still sound apart. All synthetic voices (no cloning, no real-person imitation).
 */
import type { PersonaId } from './personas';
import { voiceGender } from './names';

export interface KokoroVoice { voice: string; lang: 'en-us' | 'en-gb'; speed: number }
export const PERSONA_VOICES: Record<PersonaId, { f: KokoroVoice; m: KokoroVoice }> = {
  professor: { m: { voice: 'bm_george', lang: 'en-gb', speed: 0.95 }, f: { voice: 'bf_isabella', lang: 'en-gb', speed: 0.95 } },
  mama: { f: { voice: 'af_heart', lang: 'en-us', speed: 0.92 }, m: { voice: 'am_onyx', lang: 'en-us', speed: 0.9 } },
  hype: { m: { voice: 'am_puck', lang: 'en-us', speed: 1.12 }, f: { voice: 'af_bella', lang: 'en-us', speed: 1.12 } },
  petty: { f: { voice: 'bf_emma', lang: 'en-gb', speed: 1.05 }, m: { voice: 'bm_fable', lang: 'en-gb', speed: 1.05 } },
  og: { m: { voice: 'am_fenrir', lang: 'en-us', speed: 0.88 }, f: { voice: 'af_kore', lang: 'en-us', speed: 0.88 } },
  hustler: { m: { voice: 'am_michael', lang: 'en-us', speed: 0.95 }, f: { voice: 'af_jessica', lang: 'en-us', speed: 0.95 } },
  silent: { m: { voice: 'bm_lewis', lang: 'en-gb', speed: 0.85 }, f: { voice: 'bf_alice', lang: 'en-gb', speed: 0.85 } },
  deacon: { m: { voice: 'am_eric', lang: 'en-us', speed: 0.9 }, f: { voice: 'af_sarah', lang: 'en-us', speed: 0.9 } },
  conspiracy: { m: { voice: 'am_echo', lang: 'en-us', speed: 1.08 }, f: { voice: 'af_river', lang: 'en-us', speed: 1.08 } },
  barber: { m: { voice: 'am_liam', lang: 'en-us', speed: 1.05 }, f: { voice: 'af_alloy', lang: 'en-us', speed: 1.02 } },
  gambler: { m: { voice: 'am_adam', lang: 'en-us', speed: 1 }, f: { voice: 'af_aoede', lang: 'en-us', speed: 1 } },
  hothead: { m: { voice: 'am_onyx', lang: 'en-us', speed: 1.15 }, f: { voice: 'af_kore', lang: 'en-us', speed: 1.15 } },
  comedian: { m: { voice: 'am_santa', lang: 'en-us', speed: 1.05 }, f: { voice: 'af_sky', lang: 'en-us', speed: 1.05 } },
  lilcuz: { m: { voice: 'am_michael', lang: 'en-us', speed: 1.18 }, f: { voice: 'af_nova', lang: 'en-us', speed: 1.15 } },
  coach: { m: { voice: 'am_eric', lang: 'en-us', speed: 1.1 }, f: { voice: 'af_alloy', lang: 'en-us', speed: 1.12 } },
  smooth: { m: { voice: 'bm_daniel', lang: 'en-gb', speed: 0.92 }, f: { voice: 'af_nicole', lang: 'en-us', speed: 0.92 } },
  storyteller: { m: { voice: 'am_fenrir', lang: 'en-us', speed: 0.98 }, f: { voice: 'af_sarah', lang: 'en-us', speed: 1.02 } },
  influencer: { m: { voice: 'am_adam', lang: 'en-us', speed: 1.12 }, f: { voice: 'af_bella', lang: 'en-us', speed: 1.06 } },
  sorelose: { m: { voice: 'am_echo', lang: 'en-us', speed: 0.98 }, f: { voice: 'af_jessica', lang: 'en-us', speed: 1.06 } },
};
/** Hustler while still "new": a quicker, goofier read */
export const HUSTLER_NEWBIE_SPEED = 1.06;

/** the gender of a Kokoro voice id */
export function kokoroGender(voice: string): 'f' | 'm' { return voice[1] === 'f' ? 'f' : 'm'; }
/** the recorded voice a bot name speaks with */
export function voiceFor(persona: PersonaId, name: string): KokoroVoice & { gender: 'f' | 'm'; key: string } {
  const g = voiceGender(name);
  return { ...PERSONA_VOICES[persona][g], gender: g, key: `${persona}-${g}` };
}
