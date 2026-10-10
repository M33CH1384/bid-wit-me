/**
 * Per-player (local) bot-talk preferences + bot voices (Web Speech API).
 * - botTalk: offline table setting "Bot trash talk" (online the host decides; default on)
 * - cleanTalk: mask mild cursing on screen and in speech (default on)
 * - hideBotTalk: hide bot lines from your chat (default off)
 * - voices / voiceVolume: bot voices (default on: recorded clips, Web Speech for lines without one) at this volume
 *   (× master volume; silent when sound is off)
 */
import { useSyncExternalStore } from 'react';
import { PERSONAS, maskMild, personaForName } from '@spades/bots';
import { sound } from './audio';
import { playClip, rawLine } from './voices/voices';

export interface TalkPrefs { botTalk: boolean; cleanTalk: boolean; hideBotTalk: boolean; voices: boolean; voiceVolume: number }
const KEY = 'bwm.talk.v1';
const DEFAULTS: TalkPrefs = { botTalk: true, cleanTalk: true, hideBotTalk: false, voices: true, voiceVolume: 0.6 };

function load(): TalkPrefs {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    // v2: bot voices are recorded now → on by default (saves from before stored the old robotic default, off)
    if (j && !j.v) return { ...DEFAULTS, ...j, voices: true, voiceVolume: Math.min(j.voiceVolume ?? DEFAULTS.voiceVolume, DEFAULTS.voiceVolume) };
    if (j) return { ...DEFAULTS, ...j };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}
let prefs = load();
const subs = new Set<() => void>();
export const talkPrefs = {
  get: () => prefs,
  set(p: Partial<TalkPrefs>) {
    prefs = { ...prefs, ...p };
    try { localStorage.setItem(KEY, JSON.stringify({ ...prefs, v: 2 })); } catch { /* ignore */ }
    if (!prefs.voices) { sound.stopVoice(); if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }
    subs.forEach((f) => f());
  },
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
export function useTalkPrefs(): TalkPrefs { return useSyncExternalStore(talkPrefs.subscribe, talkPrefs.get, talkPrefs.get); }

/** What a bot line looks like on this screen (Clean talk masking). */
export function showLine(text: string): string { return prefs.cleanTalk ? maskMild(text) : text; }

const hash = (s: string) => { let h = 7; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); };
let voices: SpeechSynthesisVoice[] = [];
function loadVoices() { try { voices = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)); } catch { /* ignore */ } }
if (typeof speechSynthesis !== 'undefined') { loadVoices(); speechSynthesis.addEventListener?.('voiceschanged', loadVoices); }

/**
 * Speak a bot line: its recorded clip (persona + line id → manifest), else the browser's Web Speech voice with the
 * persona's pitch/rate. No-op unless Bot voices is on and sound is on.
 */
export function speakBot(name: string, text: string, persona?: string, line?: string): void {
  if (!prefs.voices) return;
  const snd = sound.settings;
  if (!snd.on || snd.volume <= 0) return;
  const per = persona ?? personaForName(name);
  // recorded clips go through the game's audio graph (master volume / mute already applied there)
  void playClip(per, rawLine(line), prefs.cleanTalk, prefs.voiceVolume * 0.9).then((played) => { if (!played) webSpeech(name, text); });
}

function webSpeech(name: string, text: string): void {
  if (typeof speechSynthesis === 'undefined') return;
  const snd = sound.settings;
  const p = PERSONAS[personaForName(name)];
  const clean = maskMild(text).replace(/\*+/g, ''); // never read the asterisks out; masked words just drop
  const spoken = (prefs.cleanTalk ? clean : text).replace(/[^\p{L}\p{N}\s'?!.,…-]/gu, ' ').trim();
  if (!spoken) return;
  const u = new SpeechSynthesisUtterance(p.caps ? spoken.toLowerCase() : spoken);
  const jitter = (hash(name) % 100) / 100 - 0.5;
  u.pitch = Math.min(2, Math.max(0.1, p.voice.pitch + jitter * 0.2));
  u.rate = Math.min(1.6, Math.max(0.6, p.voice.rate + jitter * 0.1));
  // sits under the game SFX: a bit below the master level
  u.volume = Math.min(1, prefs.voiceVolume * snd.volume * 0.85);
  const pref = voices.find((v) => p.voice.prefer.some((n) => v.name.includes(n)));
  u.voice = pref ?? voices[hash(name) % Math.max(1, voices.length)] ?? null;
  try { if (speechSynthesis.speaking) speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* ignore */ }
}
