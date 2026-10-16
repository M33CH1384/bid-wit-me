/**
 * Per-player (local) bot-talk preferences + bot voices (Web Speech API).
 * - botTalk: offline table setting "Bot trash talk" (online the host decides; default on)
 * - trash-talk intensity is a TABLE setting (offline: More options; online: the host), see setTableIntensity()
 * - hideBotTalk: hide bot lines from your chat (default off)
 * - voices / voiceVolume: bot voices (default on: recorded clips, Web Speech for lines without one) at this volume
 *   (× master volume; silent when sound is off)
 */
import { useSyncExternalStore } from 'react';
import { PERSONAS, type PersonaId, type TalkIntensity, maskMild, personaForName, voiceGender } from '@spades/bots';
import { sound } from './audio';
import { playClip, rawLine } from './voices/voices';

export interface TalkPrefs { botTalk: boolean; hideBotTalk: boolean; voices: boolean; voiceVolume: number; /** Voice Phase 3, on this device: play pre-voiced AI lines when the table offers them (default on; the host flag decides whether any are offered) */ aiVoices: boolean }
const KEY = 'bwm.talk.v1';
const DEFAULTS: TalkPrefs = { botTalk: true, hideBotTalk: false, voices: true, voiceVolume: 0.6, aiVoices: true };

function load(): TalkPrefs {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    // Bot voices default on only for players who never touched the setting: no save at all, or a save without a
    // voices value. A stored value is a choice and is kept (old saves wrote the whole object, so a stored "off" can't
    // be told apart from the old default; respecting it is the safe side). Old saves just get the gentler volume cap.
    if (j && !j.v) return { ...DEFAULTS, ...j, voiceVolume: Math.min(j.voiceVolume ?? DEFAULTS.voiceVolume, DEFAULTS.voiceVolume) };
    if (j) { const { v: _v, ...rest } = j; return { ...DEFAULTS, ...rest }; }
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}
let prefs = load();
const subs = new Set<() => void>();
export const talkPrefs = {
  get: () => prefs,
  set(p: Partial<TalkPrefs>) {
    prefs = { ...prefs, ...p };
    // only settings the player actually chose are stored, so a later default change still reaches untouched ones
    const chosen = { ...p };
    try {
      // (a legacy whole-object save stays whole: its values were all loaded as stored)
      const old = JSON.parse(localStorage.getItem(KEY) ?? 'null');
      localStorage.setItem(KEY, JSON.stringify({ ...(!old ? {} : old.v === 3 ? old : prefs), ...chosen, v: 3 }));
    } catch { /* ignore */ }
    if (!prefs.voices) { sound.stopVoice(); if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
export function useTalkPrefs(): TalkPrefs { return useSyncExternalStore(talkPrefs.subscribe, talkPrefs.get, talkPrefs.get); }

let intensity: TalkIntensity = 'cookout';
/** The table's trash-talk intensity (offline settings / the online host). Family Friendly also masks mild cursing. */
export function setTableIntensity(i: TalkIntensity | undefined): void { intensity = i ?? 'cookout'; }
export function tableIntensity(): TalkIntensity { return intensity; }
/** What a line looks like on this screen (Family Friendly masks mild cursing, for typed chat too). */
export function showLine(text: string): string { return intensity === 'family' ? maskMild(text) : text; }

const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
let voices: SpeechSynthesisVoice[] = [];
function loadVoices() { try { voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); } catch { /* ignore */ } }
if (typeof speechSynthesis !== 'undefined') { loadVoices(); speechSynthesis.addEventListener?.('voiceschanged', loadVoices); }

/**
 * Speak a bot line: its recorded clip (persona + line id → manifest), else the browser's Web Speech voice with the
 * persona's pitch/rate. No-op unless Bot voices is on and sound is on.
 */
export function speakBot(name: string, text: string, persona?: string, line?: string, bid?: number): void {
  if (!prefs.voices) return;
  const snd = sound.settings;
  if (!snd.on || snd.volume <= 0) return;
  const per = (persona && persona in PERSONAS ? persona : personaForName(name)) as PersonaId;
  // recorded clips go through the game's audio graph (master volume / mute already applied there)
  void playClip(per, name, rawLine(line), prefs.voiceVolume * 0.9, bid).then((played) => { if (!played) webSpeech(name, text); });
}

function webSpeech(name: string, text: string): void {
  if (typeof speechSynthesis === 'undefined' || !sound.atTable) return; // never talk behind Home
  const snd = sound.settings;
  const p = PERSONAS[personaForName(name)];
  const clean = maskMild(text).replace(/\*+/g, ''); // never read the asterisks out; masked words just drop
  const spoken = (intensity === 'family' ? clean : text).replace(/[^\p{L}\p{N}\s'?!.,…-]/gu, ' ').trim();
  if (!spoken) return;
  const u = new SpeechSynthesisUtterance(p.caps ? spoken.toLowerCase() : spoken);
  const jitter = (hash(name) % 100) / 100 - 0.5;
  const female = voiceGender(name) === 'f';
  u.pitch = Math.min(2, Math.max(0.1, p.voice.pitch * (female ? 1.12 : 0.92) + jitter * 0.2));
  u.rate = Math.min(1.6, Math.max(0.6, p.voice.rate + jitter * 0.1));
  // sits under the game SFX: a bit below the master level
  u.volume = Math.min(1, prefs.voiceVolume * snd.volume * 0.85);
  u.voice = browserVoiceFor(name, voices);
  try { if (speechSynthesis.speaking) speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* ignore */ }
}

/** Known system / browser voice names by gender (macOS, iOS, Windows, Chrome, Android). */
const FEMALE = /\b(samantha|victoria|karen|moira|tessa|serena|fiona|allison|ava|susan|zira|hazel|catherine|kate|nicky|joanna|salli|kimberly|kendra|ivy|emma|amy|aria|jenny|michelle|libby|sonia|natasha|female|woman|google uk english female|google us english)\b/i;
const MALE = /\b(daniel|alex|fred|aaron|arthur|ralph|bruce|tom|oliver|gordon|lee|rishi|david|mark|george|james|guy|ryan|christopher|eric|brian|matthew|joey|justin|male|man|google uk english male)\b/i;
/** The browser fallback voice for a bot: same gender as the name (never a male voice for a female name), stable per name. */
export function browserVoiceFor(name: string, list: Pick<SpeechSynthesisVoice, 'name'>[]): SpeechSynthesisVoice | null {
  const g = voiceGender(name);
  const ok = list.filter((v) => (g === 'f' ? FEMALE.test(v.name) && !MALE.test(v.name.replace(/google us english/i, '')) : MALE.test(v.name) && !FEMALE.test(v.name)));
  // no voice of the right gender known on this device: the default voice beats a wrong-gender one (pitch hints the rest)
  return (ok[hash(name) % Math.max(1, ok.length)] as SpeechSynthesisVoice | undefined) ?? null;
}
