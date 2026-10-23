/**
 * Recorded bot voices (Kokoro-82M, Apache-2.0). Every persona has a female and a male voice; the bot's NAME picks
 * which (voiceGender in @spades/bots), so a female name never gets a male voice. All of a persona-gender's lines live
 * in ONE audio sprite (/voices/v2/<persona>-<f|m>.(webm|m4a)) with a small JSON of [startMs, durMs] per raw line, so
 * a seated bot costs one fetch and nothing else is downloaded. Lines are matched by their raw (unfilled) template;
 * templated lines have a generic take ("SET! {opp} going backwards" → "Set! Y'all going backwards!"), and the
 * "You bid {bid} for THAT?!" lines have one take per number. Lines without a clip → Web Speech (right gender),
 * which talkPrefs fences off during live play — so at a table they are text-only (prevention pass, 2026-10-21).
 * Opus/WebM where the browser can play it, else AAC/M4A (Safari).
 */
import { type PersonaId, lineById, storyCastForName, storyVoiceKey, voiceFor } from '@spades/bots';
import { decodeAudioBuffer, sound } from '../audio';
import { audioElementPool } from '../audioPool';
import { VERSION } from '../version';

/**
 * The sprite key for a speaker. Story characters resolve by CHARACTER
 * (storyVoice.ts): the card's gender is authoritative and the cast persona
 * may be recast (American register) — never the generic name-table hash
 * that sent Pat to the male sprite. Normal bots resolve exactly as before.
 */
function keyFor(persona: PersonaId, name: string): string {
  const cast = storyCastForName(name);
  // Only the character's own voice calls (card or cast persona) take the
  // story key; a same-named normal bot probed with another persona keeps
  // the classic voiceFor resolution.
  return cast && (persona === cast.persona || persona === cast.cardPersona)
    ? storyVoiceKey(cast.characterId)
    : voiceFor(persona, name).key;
}

let ext: 'webm' | 'm4a' | null = null;
function format(): 'webm' | 'm4a' {
  if (ext) return ext;
  // One pooled element, released immediately. A throwaway <audio> stays in iOS's media pool and
  // later music/voice elements fail with no error.
  const a = audioElementPool().acquire();
  try {
    // Safari can say "maybe" for WebM/Opus but fail in decodeAudioData: only trust it off WebKit-only browsers
    const webkitOnly = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox|FxiOS|CriOS/.test(navigator.userAgent);
    ext = !webkitOnly && a?.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'm4a';
  } catch { ext = 'm4a'; }
  finally { if (a) audioElementPool().release(a); }
  return ext;
}

interface Sprite { clips: Record<string, [number, number]>; buf: AudioBuffer | null }
/** sprite key ("og-f") → its clip map + decoded audio (or the pending fetch) */
const cache = new Map<string, Promise<Sprite | null>>();
export const VOICE_BASE = '/voices/v2';
/**
 * Build token carried on EVERY sprite URL (manifest and audio
 * alike): `v<APP_VERSION>-<build sha>`, from version.ts — the
 * same stamp the app shows in More options. Sprite files are replaced
 * IN PLACE under stable paths by each voice assembly, and nothing set
 * a Cache-Control for them, so a device's heuristic HTTP cache could
 * hold a manifest from one build and pair it with audio from another:
 * offsets moved in the 2026-10-22 voice re-bake, and old keys sliced
 * the new audio at the old offsets — segments of the previous takes,
 * the owner's "robot voice" on a fully current bundle (force-close
 * does not purge the HTTP cache; only a new URL does). With the token,
 * the first load after a deploy fetches a matched pair under URLs no
 * earlier build ever used, and no later build can cross-pair them:
 * the sha moves with every commit, which is every deploy.
 */
export const VOICE_BUILD_TOKEN = `v${VERSION.version}-${VERSION.sha}`;
/** The sprite URL for a file under VOICE_BASE, build-tokened. */
export const voiceUrl = (file: string) => `${VOICE_BASE}/${file}?v=${VOICE_BUILD_TOKEN}`;
/**
 * The sprite masters are 24 kHz (the voice index's sampleRate). Decoding
 * them on the engine's context — 44.1/48 kHz on iPhones — resamples every
 * buffer UP to the context rate: the decoded PCM doubles while carrying
 * not one sample of extra fidelity. Sprites therefore decode on a
 * throwaway OfflineAudioContext at their native rate; playback resamples
 * exactly, the way the masters were made. (Owner crash, 2026-10-23:
 * decoded size is the session's memory story — see the residency cap.)
 */
export const VOICE_DECODE_RATE = 24000;
/**
 * The residency cap on decoded voice PCM (owner crash recurrence,
 * 2026-10-23 — "randomly crashing… back to the solo/co-op menu",
 * mid-hand, story mode only). The measured shape of the bug: a story
 * table's seated voices are ~7,100–7,650 s of sprite audio (Dee's
 * lilcuz-f alone is 4,400 s — she carries the story, consultation,
 * rundown and co-op corpora in one sprite). Decoded whole-file at the
 * engine rate that is ≈1.4 GB of Float32 PCM, and the cache NEVER let
 * a buffer go: every stop's cast, every railbird who chimed in, every
 * scene voice stayed resident for the whole visit, so a long story
 * session marched past the iOS web-content memory limit until the
 * system killed the process — mid-hand, at random, and the relaunch
 * opened a fresh session (no stored gate answer) on the Solo/Co-op
 * gate. Decoded at the native rate the same table is ≈0.7 GB; this cap
 * then bounds what accumulates BEYOND the current table: buffers are
 * evicted least-recently-used once decoded voice PCM passes 1 GiB
 * (≈11,180 s at 24 kHz — any seated table plus its stop's scene and
 * rail voices fit; last stop's cast does not linger into this one).
 * Eviction drops only the cache's reference: a line already playing
 * holds its own and finishes, and an evicted voice simply refetches
 * (HTTP-cached) and re-decodes on its next line.
 */
export const VOICE_RESIDENCY_BUDGET_BYTES = 1024 * 1024 * 1024;

/** Decoded size of a buffer: Float32 samples are the Web Audio currency. */
export function voiceBufferBytes(buf: AudioBuffer): number {
  return buf.length * buf.numberOfChannels * 4;
}

const residency = new Map<string, { bytes: number; used: number }>();
let residencyClock = 0;

function noteResident(key: string, buf: AudioBuffer): void {
  if (typeof buf.length !== 'number' || !(buf.length > 0)) return;
  residency.set(key, { bytes: voiceBufferBytes(buf), used: ++residencyClock });
}

function touchResident(key: string): void {
  const r = residency.get(key);
  if (r) r.used = ++residencyClock;
}

/** Total decoded voice PCM currently held by the sprite cache. */
export function residentVoiceBytes(): number {
  let t = 0;
  for (const r of residency.values()) t += r.bytes;
  return t;
}

/** Sprite keys whose decoded buffers are currently held. */
export function residentVoiceKeys(): string[] {
  return [...residency.keys()];
}

function enforceResidencyBudget(keepKey: string): void {
  let total = residentVoiceBytes();
  if (total <= VOICE_RESIDENCY_BUDGET_BYTES) return;
  const lru = [...residency.entries()]
    .filter(([k]) => k !== keepKey)
    .sort((a, b) => a[1].used - b[1].used);
  for (const [k, r] of lru) {
    if (total <= VOICE_RESIDENCY_BUDGET_BYTES) break;
    residency.delete(k);
    cache.delete(k);
    loadRetries.delete(k); // an evicted voice starts over clean, not mid-budget
    total -= r.bytes;
  }
}

/**
 * Decode one sprite's audio at its native 24 kHz (see VOICE_DECODE_RATE).
 * The offline context is also immune to the engine context's rebuilds:
 * an iOS interruption mid-decode no longer poisons the load (the heal
 * below still covers failures — a rejected offline decode resolves the
 * load with no buffer and the entry is evicted for a later retry).
 * Where OfflineAudioContext does not exist, decode on the engine
 * context exactly as before.
 */
async function decodeSprite(data: ArrayBuffer): Promise<AudioBuffer | null> {
  const ctx = sound.audioContext();
  if (!ctx) return null;
  if (typeof OfflineAudioContext !== 'undefined') {
    try {
      const off = new OfflineAudioContext(1, 1, VOICE_DECODE_RATE);
      return await decodeAudioBuffer(off as unknown as AudioContext, data);
    } catch { /* constructor refused: fall through to the engine context */ }
  }
  return decodeAudioBuffer(ctx, data);
}
/**
 * How many times a failed sprite load may be retried per session. A failure
 * is evicted from the cache so the NEXT play retries it (see load()); past
 * the budget the dead entry stays put — a device that genuinely cannot
 * decode the format must not re-download megabytes on every line.
 */
const LOAD_RETRY_BUDGET = 3;
const loadRetries = new Map<string, number>();
function load(key: string): Promise<Sprite | null> {
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      try {
        const meta = await fetch(voiceUrl(`${key}.json`));
        if (!meta.ok) return null;
        const { clips } = (await meta.json()) as { clips: Record<string, [number, number]> };
        const res = await fetch(voiceUrl(`${key}.${format()}`));
        if (!res.ok) return { clips, buf: null };
        const data = await res.arrayBuffer();
        const buf = await decodeSprite(data);
        if (buf) { noteResident(key, buf); enforceResidencyBudget(key); }
        return { clips, buf };
      } catch { return null; }
    })();
    cache.set(key, p);
    // A FAILED load must not be a life sentence (owner's intermittent-silence
    // recurrence, 2026-10-22): sprites are megabytes now, so a fetch+decode
    // takes seconds on a phone — long enough for an iOS interruption to
    // rebuild the AudioContext mid-decode. decodeAudioData on the dying
    // context rejects, the catch above caches `null` (or an undecodable
    // buf:null), and until now that dead entry was served for the REST OF
    // THE SESSION: that voice — sometimes every voice loaded in the window —
    // stayed silent while music and effects (which the engine re-syncs on
    // rebuild) came back. The heal now covers the cache too: a load that
    // resolved with no playable buffer is evicted once it settles, so the
    // next line retries against the live context. Successful loads are
    // never evicted.
    void p.then((sp) => {
      if (sp?.buf) return;
      if (cache.get(key) !== p) return;
      const used = loadRetries.get(key) ?? 0;
      if (used >= LOAD_RETRY_BUDGET) return;
      loadRetries.set(key, used + 1);
      cache.delete(key);
    });
  }
  return p;
}

/** Raw line for a server/offline line id, if this build knows it. */
export function rawLine(lineId: string | undefined): string | undefined { return lineId ? lineById(lineId) : undefined; }

/** A bot sat down: fetch + decode its persona-gender sprite in the background (only seated bots are ever fetched). */
export function preloadVoice(persona: PersonaId, name: string): void {
  const key = keyFor(persona, name);
  if (cache.has(key)) return;
  const go = () => { void load(key); };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (ric) ric(go); else setTimeout(go, 400);
}

/**
 * Play the recorded clip for this line. Resolves true when a clip played (or is playing), false when there's no clip
 * (the caller falls back to Web Speech). A sprite that isn't decoded yet still plays if it arrives within 1.5 s.
 * `opts.crossTalk` (set by speakBot on every surface): the clip may start over the tail of a different
 * speaker's line instead of cutting it — the engine's planVoiceArrival decides, per arrival.
 * `opts.deferCut` (regular-table chatter, also set by speakBot): when the plan would replace the
 * playing line, this clip instead waits for the room (short waits) or drops — never a mid-sentence cut.
 */
export async function playClip(persona: PersonaId, name: string, raw: string | undefined, gain: number, bid?: number, seat?: import('../spatial').SeatPos, playerCount = 4, opts?: { crossTalk?: boolean; deferCut?: boolean; key?: string }): Promise<boolean> {
  if (!raw) return false;
  const t0 = performance.now();
  const key = keyFor(persona, name);
  const sp = await load(key);
  if (sp?.buf) touchResident(key);
  // `opts.key` is a string take suffix (consultation grid "3.1", settle
  // "T7") — the string-keyed sibling of the numeric `bid` take.
  const at = sp && ((opts?.key !== undefined ? sp.clips[`${raw}#${opts.key}`] : bid !== undefined ? sp.clips[`${raw}#${bid}`] : undefined) ?? sp.clips[raw]);
  if (!sp?.buf || !at) return false;
  if (performance.now() - t0 > 1500) return true; // too late to still fit the moment: stay quiet
  // The engine's word is final and is now REPORTED, not swallowed: startVoice
  // refuses (returns false) off a table surface, while the context is not
  // running, or when a deferral drops the line. Until 2026-10-22 this wrapper
  // returned true unconditionally, so a refused line looked "played" to every
  // caller — on the story meet-them screen (no table surface mounted) Dee's
  // Rundown paced its text reveal by the clip's real duration while the clip
  // itself was refused at the gate: words moving, no sound. Callers that pace
  // or fall back (speakBot, the Rundown panel) need the truth.
  if (opts?.crossTalk) return sound.playVoiceCrossTalk(sp.buf, gain, [at[0] / 1000, at[1] / 1000], seat, playerCount, name, { defer: !!opts.deferCut });
  return sound.playVoice(sp.buf, gain, [at[0] / 1000, at[1] / 1000], seat, playerCount);
}

/**
 * The recorded duration (ms) of the clip playClip would play for this
 * line, or null when there is none. Same sprite, same lookup — the
 * manifest JSON alone answers (the audio needn't have decoded), so a
 * caller can pace itself against a line's voice without playing
 * anything or forking the speech path. The story scene player paces
 * its typewriter reveal against this (talkPrefs.spokenClipDurationMs).
 */
export async function clipDurationMs(persona: PersonaId, name: string, raw: string | undefined, bid?: number, key?: string): Promise<number | null> {
  if (!raw) return null;
  const spriteKey = keyFor(persona, name);
  const sp = await load(spriteKey);
  if (sp?.buf) touchResident(spriteKey);
  const at = sp && ((key !== undefined ? sp.clips[`${raw}#${key}`] : bid !== undefined ? sp.clips[`${raw}#${bid}`] : undefined) ?? sp.clips[raw]);
  return at ? at[1] : null;
}
