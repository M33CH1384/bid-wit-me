/**
 * Per-player (local) bot-talk preferences + bot voices (Web Speech API).
 * - botTalk: offline table setting "Bot trash talk" (online the host decides; default on)
 * - trash-talk intensity is a TABLE setting (offline: More options; online: the host), see setTableIntensity()
 * - hideBotTalk: hide bot lines from your chat (default off)
 * - voices / voiceVolume: bot voices (default on: recorded clips; Web Speech for lines without one, fenced off during live play) at this volume
 *   (× master volume; silent when sound is off)
 */
import { useSyncExternalStore } from 'react';
import { PERSONAS, type PersonaId, type TalkIntensity, applyPronunciation, maskMild, personaForName, storyCastForName, voiceGender } from '@spades/bots';
import { sound } from './audio';
import { cancelActiveSpeech } from './audioSession';
import { clipDurationMs, playClip, rawLine } from './voices/voices';

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
    if (!prefs.voices) { sound.stopVoice(); cancelActiveSpeech(typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined); }
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
 * Story-mode voice scope (one-timbre pass, Demetrius 2026-10-21): true while a
 * story surface is live — set by ScriptPlayer (intro/outro scenes) and by
 * Table for story games, cleared when they unmount. While it is on, a story
 * character's lines resolve ONLY through their cast recording path
 * (storyVoiceKey sprites): catalog table talk is text-only for story seats,
 * and webSpeech refuses story characters outright (see the fence there).
 * Normal games never set it, so nothing outside story mode changes.
 */
let storyScope = false;
export function setStoryVoiceScope(on: boolean): void { storyScope = on; }
export function storyVoiceScope(): boolean { return storyScope; }

/**
 * Speak a bot line: its recorded clip (persona + line id → manifest), else the browser's Web Speech voice with the
 * persona's pitch/rate. No-op unless Bot voices is on and sound is on. The Web Speech fallback is fenced off
 * during live play (see webSpeech), so at a table a line without a clip is text-only.
 */
export function speakBot(name: string, text: string, persona?: string, line?: string, bid?: number, seat?: import('./spatial').SeatPos, playerCount = 4): void {
  if (!prefs.voices) return;
  const snd = sound.settings;
  if (!snd.on || snd.volume <= 0) return;
  const per = (persona && persona in PERSONAS ? persona : personaForName(name)) as PersonaId;
  // recorded clips go through the game's audio graph (master volume / mute already applied there)
  if (sound.voiceMuted(name)) return; // per-player mute: the chat text still shows, the voice stays silent
  // Story lines (scene player, story table channel, rail) arrive with no
  // catalog line id: their recorded clips are keyed by the line text itself
  // in the character's cast sprite (storyVoice.ts — the story bake). Hand
  // playClip the text as the raw key, but only for a story character called
  // with its own cast/card persona — the same guard keyFor applies in
  // voices.ts, so a same-named normal bot is never rerouted.
  const cast = storyCastForName(name);
  // One-timbre rule (2026-10-21): in story mode, a catalog line id means
  // generic persona talk — for a story character it renders TEXT ONLY (the
  // chat/dialogue line is already on screen). The cast sprite also holds
  // generic clips keyed by template, and serving one here would give the
  // character a second, persona-baked voice next to their cast recordings —
  // in the worst case a literally different singer (Ray's generic clips are
  // am_fenrir; his cast lines are am_onyx). Text-keyed story lines (no id)
  // fall through to the cast lookup below, unchanged.
  if (cast && storyScope && line) return;
  const raw = rawLine(line) ?? (cast && (per === cast.persona || per === cast.cardPersona) ? text : undefined);
  // Cross-talk (owner, the Porch 2026-10-22: "if Pat says something,
  // Unc can start before she finishes"; widened to every table the same
  // day: "feel live like a party"): a conversational line may start over
  // the tail of another speaker's line instead of cutting it — the
  // engine decides per arrival (planVoiceArrival in audio.ts: max two
  // voices, the first ducked). Every line that reaches here is chatter —
  // scene beats, rail lines, table talk, end-of-hand banter. The `bid`
  // argument only picks a numbered take of a commentary template ("You
  // bid {bid} for THAT?!"), banter included; it is not an announcement,
  // and no announcement-class line flows through speakBot (bids and big
  // moments are SFX).
  // The scopes differ on what a non-overlap arrival may do. On story
  // surfaces the schedulers pace beats by real clip duration, so a
  // replace is the designed handoff and stands (deferCut off — story
  // behaviour is unchanged). At regular tables arrivals are unscheduled
  // event talk, and a replace was a mid-sentence cut of a playing line
  // (owner: bot lines "cut off mid sentence"): deferCut makes the
  // arrival wait for the room on short waits, or drop — never cut.
  void playClip(per, name, raw, prefs.voiceVolume * 0.9, bid, seat, playerCount, { crossTalk: true, deferCut: !storyScope }).then((played) => { if (!played) webSpeech(name, text, per); });
}

/**
 * Duration (ms) of the recorded clip the matching speakBot call will
 * play, or null when that call is text-only — voices or sound off, the
 * speaker muted, the one-timbre story fence above, or simply no clip
 * recorded for the line. The guards and the raw-key resolution mirror
 * speakBot's exactly (kept in step deliberately), and the number itself
 * comes from the same manifest entry playClip plays — a lookup, never
 * a second playback path. The story scene player paces its typewriter
 * reveal against it so the words land as they're heard (owner,
 * 2026-10-21: the typing finished long before the voice did).
 */
export async function spokenClipDurationMs(name: string, text: string, persona?: string, line?: string, bid?: number): Promise<number | null> {
  if (!prefs.voices) return null;
  const snd = sound.settings;
  if (!snd.on || snd.volume <= 0) return null;
  if (sound.voiceMuted(name)) return null;
  const per = (persona && persona in PERSONAS ? persona : personaForName(name)) as PersonaId;
  const cast = storyCastForName(name);
  if (cast && storyScope && line) return null;
  const raw = rawLine(line) ?? (cast && (per === cast.persona || per === cast.cardPersona) ? text : undefined);
  return clipDurationMs(per, name, raw, bid);
}

/**
 * The Web Speech voice for a bot line: the SAME persona the recorded clip would have used
 * (character consistency — the fallback must never be a different character than the clip).
 * The persona's preferred system voices (PERSONAS[id].voice.prefer) are tried in order,
 * filtered to the name's gender; if none is on this device, the name-stable gender pick
 * (browserVoiceFor) stands. Deterministic per (persona, name): a character sounds like
 * itself on every line, at every venue, on every visit.
 */
export function personaVoiceFor(persona: PersonaId, name: string, list: Pick<SpeechSynthesisVoice, 'name' | 'lang'>[]): SpeechSynthesisVoice | null {
  // Story characters resolve by CHARACTER (storyVoice.ts): the card's
  // gender, American voices only — the name-hash pick that landed Uncle
  // Ray on an en-GB voice ("old Englishman") can never happen to a story
  // seat. Normal bots take the path below, unchanged.
  const cast = storyCastForName(name);
  // The cast branch fires only for the character's OWN voice calls (the
  // persona the caller passes is the character's card or cast persona).
  // A same-named normal bot probed with a different persona — e.g. the
  // gambler preference test using 'Queenie' as a female name — keeps the
  // normal resolution below, byte-for-byte.
  if (cast && (persona === cast.persona || persona === cast.cardPersona)) {
    const us = list.filter((v) => !v.lang || /^en[-_]us/i.test(v.lang));
    const fits = us.filter((v) => voiceNameFitsGender(v.name, cast.gender));
    for (const want of PERSONAS[cast.persona]?.voice.prefer ?? []) {
      const hit = fits.find((v) => v.name.toLowerCase().includes(want.toLowerCase()));
      if (hit) return hit as SpeechSynthesisVoice;
    }
    if (fits.length) return fits[hash(name) % fits.length] as SpeechSynthesisVoice;
    return null; // no American voice of the right gender: the default beats a British or wrong-gender one
  }
  const g = voiceGender(name);
  for (const want of PERSONAS[persona]?.voice.prefer ?? []) {
    const hit = list.find((v) => v.name.toLowerCase().includes(want.toLowerCase()) && voiceNameFitsGender(v.name, g));
    if (hit) return hit as SpeechSynthesisVoice;
  }
  return browserVoiceFor(name, list);
}

/** Does a system voice's name read as the wanted gender? (Mirrors browserVoiceFor's filter.) */
function voiceNameFitsGender(voiceName: string, g: 'f' | 'm'): boolean {
  return g === 'f' ? FEMALE.test(voiceName) && !MALE.test(voiceName.replace(/google us english/i, '')) : MALE.test(voiceName) && !FEMALE.test(voiceName);
}

/**
 * Whether the Web Speech fallback is fenced off right now (prevention pass,
 * Demetrius 2026-10-21). The fence is exactly the live-play presence the audio
 * engine already tracks: `sound.atTable` is set by every Table mount (offline,
 * online and story tables all mount the same Table) and by story-scene
 * mounting (StoryHome's SceneAudio), and cleared when they leave. Off the
 * table the fence releases — it is presence-keyed, not a global kill switch.
 */
export function speechFallbackFenced(): boolean { return sound.atTable; }

function webSpeech(name: string, text: string, persona: PersonaId = personaForName(name)): void {
  if (typeof speechSynthesis === 'undefined' || !sound.atTable) return; // never talk behind Home
  // PREVENTION (Demetrius 2026-10-21): at a live table or story scene the game
  // never touches the speech engine — no utterance AND no cancel() (this
  // return sits above the cancel() below on purpose: the contact itself is
  // the problem). On iOS an utterance seizes the system audio session, and
  // when it ends the game's AudioContext can be left 'interrupted' — music,
  // beds and voices all share that context, so every fallback line stuttered
  // the whole table. A bot/story line with no recorded clip now renders as
  // TEXT ONLY: the chat/dialogue channel already shows every line, and the
  // robot voice it replaces is one the owner rejected outright ("robot
  // voice", "these voices suck"). Every speakBot call site in the app is a
  // live-play surface (Table, the online table via Table, ScriptPlayer), so
  // in practice the fallback never sounds during a game at all. The heal in
  // audio.ts is untouched — it remains the net for interruptions the game did
  // NOT cause (a phone call, Siri); this fence removes the self-inflicted ones.
  if (speechFallbackFenced()) return;
  // Story characters NEVER take the robot (identity fence, 2026-10-21): a
  // cast name resolved on its own cast/card persona — or any cast name while
  // story scope is on — is cast-recording-or-text only, whatever seam the
  // call arrived through (table unmount, scene swap, a presence flag dropped
  // mid-transition). The presence fence above covers live play; this one
  // makes story mode robot-proof by identity rather than by timing. In a
  // normal game nothing audible changes: live play is presence-fenced for
  // everyone already, and the game never talks behind Home.
  const castGate = storyCastForName(name);
  if (castGate && (storyScope || persona === castGate.persona || persona === castGate.cardPersona)) return;
  const snd = sound.settings;
  // A story character speaks as its CAST persona (storyVoice.ts) — the same
  // family the recorded key resolves — never its card persona's house voice
  // when the two differ (Uncle Ray is cast storyteller, not comedian).
  const p = PERSONAS[storyCastForName(name)?.persona ?? persona];
  const clean = maskMild(text).replace(/\*+/g, ''); // never read the asterisks out; masked words just drop
  // Pronunciation: the shared dictionary (packages/bots/src/pronounce.ts) — the same respellings the
  // recorded bake uses, so a line sounds the same on both paths. It used to be a hand-coded mm-hm fix
  // here, and only on the family branch (Demetrius: mm-hm spelled out, "chile" as chee-lay, 2026-10-21).
  const spoken = (intensity === 'family' ? applyPronunciation(clean) : applyPronunciation(text)).replace(/[^\p{L}\p{N}\s'?!.,…-]/gu, ' ').trim();
  if (!spoken) return;
  const u = new SpeechSynthesisUtterance(p.caps ? spoken.toLowerCase() : spoken);
  const jitter = (hash(name) % 100) / 100 - 0.5;
  // Story characters: gender + register come from the cast (storyVoice.ts),
  // not the name hash — Pat's storyteller drawl stays a woman's drawl.
  const cast = storyCastForName(name);
  const female = cast ? cast.gender === 'f' : voiceGender(name) === 'f';
  u.pitch = Math.min(2, Math.max(0.1, p.voice.pitch * (female ? 1.12 : 0.92) * (cast?.pitch ?? 1) + jitter * 0.2));
  u.rate = Math.min(1.6, Math.max(0.6, (p.voice.rate + jitter * 0.1) * (cast?.rate ?? 1)));
  // sits under the game SFX: a bit below the master level
  u.volume = Math.min(1, prefs.voiceVolume * snd.volume * 0.85);
  u.voice = personaVoiceFor(persona, name, voices);
  // iOS: an utterance seizes the system audio session, and when it ends the game's
  // AudioContext can be left 'interrupted'/'suspended' — music, beds and voices all
  // share that context, so the whole game goes quiet. Drive the engine's recovery the
  // moment the utterance finishes or fails instead of leaving the return to the
  // player's next tap. (The engine's heal retry covers utterances whose end event
  // iOS drops after a cancel().) Demetrius 2026-10-21.
  const recover = () => { try { sound.wake('show'); } catch { /* ignore */ } };
  u.onend = recover;
  u.onerror = recover;
  try { cancelActiveSpeech(speechSynthesis); speechSynthesis.speak(u); } catch { /* ignore */ }
}

/** Known system / browser voice names by gender (macOS, iOS, Windows, Chrome, Android). */
const FEMALE = /\b(samantha|victoria|karen|moira|tessa|serena|fiona|allison|ava|susan|zira|hazel|catherine|kate|nicky|joanna|salli|kimberly|kendra|ivy|emma|amy|aria|jenny|michelle|libby|sonia|natasha|female|woman|google uk english female|google us english)\b/i;
const MALE = /\b(daniel|alex|fred|aaron|arthur|ralph|bruce|tom|oliver|gordon|lee|rishi|david|mark|george|james|guy|ryan|christopher|eric|brian|matthew|joey|justin|male|man|google uk english male)\b/i;
/** The browser fallback voice for a bot: same gender as the name (never a male voice for a female name), stable per name. */
export function browserVoiceFor(name: string, list: Pick<SpeechSynthesisVoice, 'name'>[]): SpeechSynthesisVoice | null {
  const g = voiceGender(name);
  const ok = list.filter((v) => voiceNameFitsGender(v.name, g));
  // no voice of the right gender known on this device: the default voice beats a wrong-gender one (pitch hints the rest)
  return (ok[hash(name) % Math.max(1, ok.length)] as SpeechSynthesisVoice | undefined) ?? null;
}
