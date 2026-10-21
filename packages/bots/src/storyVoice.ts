/**
 * Story voice casting (owner, 2026-10-21): story characters resolve their
 * voice by CHARACTER, never by the generic bot-name table or its hash.
 *
 * Why this exists: voiceGender(name) looks a display name up in a generic
 * table and coin-flips by hash for names it doesn't know. Story character
 * names weren't in that table as written ('Auntie Pat' was; 'Pat' was
 * not), so 9 of the 23 characters resolved to the WRONG gender — Pat came
 * out storyteller-m (a man's voice), the King came out female — and the
 * Web Speech fallback could land an American porch elder on an en-GB
 * voice ("sounds like an old Englishman"). STORY_CHARACTERS gender is
 * authoritative here; this map is consumed by the recorded lookup and the
 * fallback picker whenever the speaker is a story character. Normal bots
 * resolve exactly as before.
 *
 * Casting rule (owner): these characters are rooted in Black American
 * neighborhood life — voices are American (en-US Kokoro ids, a*_*) with
 * register matched to the character: elders deeper and slower, Smoke low
 * and quiet, Lil' Man/Trey young and quick, Velvet/Coleman/Accountant
 * polished but American. `kokoro`/`speed` are the casting for the queued
 * story voice bake (which can key story lines per character); `persona`
 * is the family the live paths resolve through until the bake lands —
 * recast where the persona's house voice is British (silent, smooth-m,
 * professor, petty) or the wrong register entirely (comedian's am_santa
 * for Uncle Ray).
 */
import type { PersonaId } from './personas';
import { STORY_CHARACTERS } from './story';

export interface StoryVoiceCast {
  characterId: string;
  /** persona family the live recorded/fallback paths resolve through */
  persona: PersonaId;
  /** the character card's own personaId (play-style persona) — callers
   *  speaking for this character pass one of these two personas */
  cardPersona: PersonaId;
  /** the character card's gender — authoritative, never the name hash */
  gender: 'f' | 'm';
  /** Kokoro voice the story bake should use for this character (American) */
  kokoro: string;
  /** bake playback speed for the character's register */
  speed: number;
  /** fallback pitch multiplier (register) */
  pitch: number;
  /** fallback rate multiplier (register) */
  rate: number;
}

const cast = (characterId: string, persona: PersonaId, kokoro: string, speed: number, pitch: number, rate: number): StoryVoiceCast => ({
  characterId, persona, kokoro, speed, pitch, rate,
  gender: STORY_CHARACTERS[characterId]!.gender,
  cardPersona: STORY_CHARACTERS[characterId]!.personaId,
});

export const STORY_VOICE_CAST: Record<string, StoryVoiceCast> = {
  dee: cast('dee', 'lilcuz', 'af_nova', 1.12, 1.04, 1.02),
  uncleRay: cast('uncleRay', 'storyteller', 'am_onyx', 0.92, 0.9, 0.94), // warm gravel elder — not am_santa, not a Brit
  pat: cast('pat', 'storyteller', 'af_sarah', 1.0, 1.0, 1.0),
  mrColeman: cast('mrColeman', 'barber', 'am_liam', 1.0, 0.95, 0.97),
  june: cast('june', 'og', 'af_kore', 0.92, 1.0, 0.98),
  lilMan: cast('lilMan', 'lilcuz', 'am_michael', 1.16, 1.06, 1.08),
  trey: cast('trey', 'hype', 'am_puck', 1.1, 1.05, 1.05),
  keisha: cast('keisha', 'influencer', 'af_bella', 1.04, 1.02, 1.02),
  teisha: cast('teisha', 'influencer', 'af_bella', 1.04, 1.09, 1.04), // recast from petty (bf_emma, British); twin-distinct by pitch
  smoke: cast('smoke', 'og', 'am_fenrir', 0.88, 0.82, 0.9), // recast from smooth (bm_daniel, British): low and quiet
  redd: cast('redd', 'hothead', 'am_onyx', 1.08, 0.9, 1.02),
  deaconFord: cast('deaconFord', 'deacon', 'am_eric', 0.9, 0.92, 0.94),
  sisterMae: cast('sisterMae', 'coach', 'af_alloy', 1.04, 0.98, 0.97),
  poet: cast('poet', 'conspiracy', 'am_echo', 1.0, 0.95, 0.95),
  seven: cast('seven', 'deacon', 'am_adam', 0.95, 0.85, 0.88), // recast from silent (bm_lewis, British): flat, rare, heavy
  velvet: cast('velvet', 'hustler', 'af_jessica', 0.95, 0.95, 0.96),
  accountant: cast('accountant', 'gambler', 'am_adam', 1.0, 0.9, 0.95), // recast from professor (bm_george, British): polished American, measured
  captainBlock: cast('captainBlock', 'coach', 'am_eric', 1.02, 0.9, 1.0),
  brick: cast('brick', 'coach', 'af_alloy', 1.0, 0.9, 0.92), // recast from silent (bf_alice, British)
  queenie: cast('queenie', 'mama', 'af_heart', 0.92, 1.0, 0.95),
  ace: cast('ace', 'gambler', 'am_adam', 1.0, 1.0, 1.0),
  king: cast('king', 'og', 'am_fenrir', 0.86, 0.85, 0.9),
  ringer: cast('ringer', 'hustler', 'am_michael', 1.0, 0.85, 0.92), // recast from silent (bm_lewis, British)
};

/** The recorded sprite key a story character resolves: cast persona + card gender. */
export const storyVoiceKey = (characterId: string): string => {
  const c = STORY_VOICE_CAST[characterId]!;
  return `${c.persona}-${c.gender}`;
};

const BY_NAME = new Map(Object.values(STORY_CHARACTERS).map((c) => [c.name, STORY_VOICE_CAST[c.id]]));

/** The cast for a speaker by display name, when the speaker is a story character. */
export const storyCastForName = (name: string): StoryVoiceCast | undefined => BY_NAME.get(name);
