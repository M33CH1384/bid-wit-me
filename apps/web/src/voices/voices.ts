/**
 * Recorded bot voices (Kokoro-82M, Apache-2.0). Every persona has a female and a male voice; the bot's NAME picks
 * which (voiceGender in @spades/bots), so a female name never gets a male voice. All of a persona-gender's lines live
 * in ONE audio sprite (/voices/v2/<persona>-<f|m>.(webm|m4a)) with a small JSON of [startMs, durMs] per raw line, so
 * a seated bot costs one fetch and nothing else is downloaded. Lines are matched by their raw (unfilled) template;
 * templated lines have a generic take ("SET! {opp} going backwards" → "Set! Y'all going backwards!"), and the
 * "You bid {bid} for THAT?!" lines have one take per number. Lines without a clip → Web Speech (right gender),
 * which talkPrefs fences off during live play — so at a table they are text-only (prevention pass, 2026-10-21).
 * Opus/WebM where the browser can play it, else AAC/M4A (Safari).
 *
 * PER-CLIP DECODE (2026-11-02, crash round 3's residency conviction): the
 * legacy layer below decodes each sprite WHOLESALE and holds the PCM for
 * the table's life — a typical table ~345 MiB decoded, the worst seated
 * sets 730–770 MiB against an 896 MiB budget, the structural half of the
 * iOS jetsam stack. The per-clip layer (bottom half of this file) keeps
 * only the sprite's COMPRESSED bytes resident (LRU-capped at 96 MiB) and
 * decodes individual lines just ahead of playback into a hard-capped
 * clip cache (112 MiB since the 2026-11-05 starter warm — see
 * VOICE_WARM_BUDGET_BYTES), warmed by the schedulers that know the next
 * lines (scene beats, the rundown, table preload). It ships behind a flag —
 * VOICE_PER_CLIP_DEFAULT, per-device override localStorage
 * 'bwm.voicePerClip' = '0' — with this legacy layer intact and tested,
 * because decode latency on unwarmed lines could not be measured on the
 * owner's hardware from the build sandbox; the owner's ear is the gate.
 * Both layers share the manifest, the clip lookup, the decode helper and
 * the engine calls: same clips, same selection, same mix — only the
 * residency differs.
 */
import { type PersonaId, CONFER_ASK, CONFER_RESP, CONSULT_FREE, INTRO_COMMON, TEXT_ONLY_KINDS, lineById, speakableLines, storyCastForName, storyVoiceKey, voiceFor, voiceGender } from '@spades/bots';
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

/** The sprite key a speaker resolves to (the keyFor above, for callers
 *  that manage residency — Table.tsx seats the cast through it). */
export function spriteKeyFor(persona: PersonaId, name: string): string {
  return keyFor(persona, name);
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
 *
 * Budget re-derived 2026-11-01 (crash-2 lane, owner still crashing to the
 * menu; the residual shape is iOS process death under session memory):
 * 1 GiB let a whole session's worth of casts linger. Measured from the
 * shipped manifests (duration × 24 kHz × 4 B): Dee's lilcuz-f alone is
 * 402.8 MiB — a phone-shaped 256 MiB cap is impossible, her sprite busts
 * it by herself. The largest realistic SEATED sets: a story table at the
 * High-Rise (Dee 402.8 + Velvet 156.4 + the Accountant 169.6) = 728.8 MiB;
 * a regular table's three largest distinct bot sprites = 770.8 MiB. This
 * budget is that ceiling plus ~125 MiB of headroom — about one median
 * sprite (116 MiB) of incidental within-table load (a railbird chiming
 * in, a scene voice) before the cap has to touch anything. The bigger
 * reduction is the table-change eviction below (setSeatedVoiceKeys):
 * non-seated sprites no longer linger across hops at all.
 *
 * (Legacy layer only since 2026-11-02: the per-clip layer's ceilings are
 * VOICE_CLIP_CACHE_BUDGET_BYTES + VOICE_ENCODED_BUDGET_BYTES below.)
 */
export const VOICE_RESIDENCY_BUDGET_BYTES = 896 * 1024 * 1024;

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

/**
 * The current table's seated cast, as sprite keys (set at every table
 * change by setSeatedVoiceKeys). Seated sprites are NEVER evicted — by
 * the budget or by a table change — while they hold the seat: a seated
 * bot's line must never wait on a re-decode of its own sprite. (Eviction
 * at a table change is what ENDS a seat: the old cast's keys leave the
 * set exactly when the new cast's keys enter it.)
 */
const seatedKeys = new Set<string>();
/** Per-key load generation: an eviction bumps it, so a load that was in
 *  flight across the eviction resolves for its waiting caller (the line
 *  still plays) but is not retained as resident. */
const loadGen = new Map<string, number>();

function evictSprite(key: string): void {
  residency.delete(key);
  cache.delete(key);
  loadRetries.delete(key); // an evicted voice starts over clean, not mid-budget
  loadGen.set(key, (loadGen.get(key) ?? 0) + 1);
}

/**
 * A table change (Table.tsx, whenever the seated bot cast changes —
 * new game, venue hop, story stop, a bot filling a seat): the incoming
 * cast becomes the seated set, and every OTHER sprite — last table's
 * cast, railbirds and scene voices from earlier stops — is evicted on
 * the spot instead of lingering in the LRU tail for the whole session
 * (crash-2 lane, 2026-11-01: across successive tables up to the full
 * budget of decoded PCM could linger, on top of the current table's own
 * ~350–770 MiB — the session-accumulation half of the iOS jetsam stack).
 * Eviction drops only cache references: a line already playing holds
 * its buffer and finishes, and an evicted voice refetches (HTTP-cached)
 * and re-decodes on its next line.
 */
function setSeatedVoiceKeysLegacy(keys: readonly string[]): void {
  seatedKeys.clear();
  for (const k of keys) seatedKeys.add(k);
  for (const k of [...residency.keys()]) if (!seatedKeys.has(k)) evictSprite(k);
  // Cached entries with no resident buffer (in-flight or failed loads)
  // get the same treatment: an in-flight load for a departed voice must
  // not re-enter residency when it lands (the generation guard in load).
  for (const k of [...cache.keys()]) if (!seatedKeys.has(k) && !residency.has(k)) evictSprite(k);
}

function enforceResidencyBudget(keepKey: string): void {
  let total = residentVoiceBytes();
  if (total <= VOICE_RESIDENCY_BUDGET_BYTES) return;
  const lru = [...residency.entries()]
    .filter(([k]) => k !== keepKey && !seatedKeys.has(k))
    .sort((a, b) => a[1].used - b[1].used);
  for (const [k, r] of lru) {
    if (total <= VOICE_RESIDENCY_BUDGET_BYTES) break;
    evictSprite(k);
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
    const gen = loadGen.get(key) ?? 0;
    p = (async () => {
      try {
        const meta = await fetch(voiceUrl(`${key}.json`));
        if (!meta.ok) return null;
        const { clips } = (await meta.json()) as { clips: Record<string, [number, number]> };
        const res = await fetch(voiceUrl(`${key}.${format()}`));
        if (!res.ok) return { clips, buf: null };
        const data = await res.arrayBuffer();
        const buf = await decodeSprite(data);
        if (buf) {
          if ((loadGen.get(key) ?? 0) !== gen && !seatedKeys.has(key)) {
            // Evicted (a table change) while this load was in flight:
            // the sprite still returns for its waiting caller — the line
            // plays — but it is NOT retained, and the cache entry goes
            // so the next line starts a fresh, retainable load.
            if (cache.get(key) === p) cache.delete(key);
          } else {
            noteResident(key, buf); enforceResidencyBudget(key);
          }
        }
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
function preloadVoiceLegacy(persona: PersonaId, name: string): void {
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
async function playClipLegacy(persona: PersonaId, name: string, raw: string | undefined, gain: number, bid?: number, seat?: import('../spatial').SeatPos, playerCount = 4, opts?: { crossTalk?: boolean; deferCut?: boolean; key?: string }): Promise<boolean> {
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
async function clipDurationMsLegacy(persona: PersonaId, name: string, raw: string | undefined, bid?: number, key?: string): Promise<number | null> {
  if (!raw) return null;
  const spriteKey = keyFor(persona, name);
  const sp = await load(spriteKey);
  if (sp?.buf) touchResident(spriteKey);
  const at = sp && ((key !== undefined ? sp.clips[`${raw}#${key}`] : bid !== undefined ? sp.clips[`${raw}#${bid}`] : undefined) ?? sp.clips[raw]);
  return at ? at[1] : null;
}

/* =====================================================================
 * PER-CLIP DECODE LAYER (2026-11-02)
 *
 * The legacy layer above decodes whole sprites: Dee's sprite alone is
 * 402.8 MiB of PCM, a typical table ~345 MiB, and decoded voice was the
 * largest single block in the process the crash audit weighed. This
 * layer never holds a decoded sprite. It holds, per sprite:
 *   - the MANIFEST (kilobytes of JSON) — all clipDurationMs ever needs;
 *   - the sprite's COMPRESSED bytes (12–19 MB worst case), LRU-capped;
 * and decodes CLIPS, not sprites: a decode pass decodes the sprite once,
 * slices the wanted lines into their own small buffers (~342 KB at the
 * 3.56 s median), and drops the whole buffer. Decoded clips live in a
 * hard-capped LRU cache; passes are serialized (one decode at a time —
 * the crash audit also fingered parallel whole-corpus decodes in the
 * cold window after a resume) and are triggered ahead of need by the
 * surfaces that know the next lines: scene beats (ScriptPlayer warms
 * the next 8), Dee's rundown, consultation pacing, and the table
 * preload, which warms a starter window while the loading gate is up.
 * A line whose clip is not ready decodes at need through the same pass;
 * a failed pass resolves the line exactly as the legacy layer's failed
 * load does — false, and the caller shows the line as text.
 * ===================================================================== */

/** Which voice layer serves playback. Default ON (the per-clip layer);
 *  the legacy whole-sprite layer remains one flip away — flip the
 *  constant, or set localStorage 'bwm.voicePerClip' to '0' on a device
 *  for an instant A/B — until the owner's ear closes the question. */
export const VOICE_PER_CLIP_DEFAULT = true;
const PER_CLIP_FLAG_KEY = 'bwm.voicePerClip';
export function voicePerClipEnabled(): boolean {
  try {
    const v = localStorage.getItem(PER_CLIP_FLAG_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch { /* storage unavailable: the default rules */ }
  return VOICE_PER_CLIP_DEFAULT;
}

/**
 * The hard ceiling on decoded voice clips held at once. Defense, from
 * the shipped manifests: the median clip is ~2.4 s ≈ 230 KB decoded.
 * The ceiling was 48 MiB when the layer shipped (2026-11-02) — sized
 * for scene beats and a consultation exchange (~60–100 clips). The
 * 2026-11-05 sparse-talk measurement repriced it: a full game at one
 * table draws only ~70 distinct clips (~17 MB), but the preload
 * starter warm (below) pre-slices each seated sprite's rotation set at
 * ~28 MiB per sprite, so a four-sprite table warms to ~110 MiB. At
 * 112 MiB the combined worst case (112 decoded + 96 compressed) is
 * 208 MiB — under a quarter of the legacy 896 MiB budget and below the
 * ~345 MiB a typical table held under whole-sprite residency. A single
 * clip larger than the cap (the longest shipped take is 39.7 s ≈
 * 3.8 MB, so none is) would be admitted alone. Clips are NOT
 * seat-exempt: eviction pressure is the point, and a clip in active
 * use is most-recently-used by construction.
 */
export const VOICE_CLIP_CACHE_BUDGET_BYTES = 112 * 1024 * 1024;
/**
 * The ceiling on resident COMPRESSED sprite bytes. The worst seated set
 * (AAC on Safari) is ~45–50 MB of m4a; 96 MiB holds a full table plus a
 * scene/rail sprite or two without refetching audio on every line,
 * while staying a rounding error next to the decoded residency it
 * replaces. Seated sprites are pinned, as in the legacy layer.
 */
export const VOICE_ENCODED_BUDGET_BYTES = 96 * 1024 * 1024;
/** Clips either side of a wanted clip that a decode pass also slices:
 *  the bake lays a sprite out in coarse family order (chatter, bid
 *  takes, the consultation grid, story lines), so a wanted line's
 *  manifest neighbours are its likeliest next lines. */
const PC_WINDOW = 10;
/** Starter clips warmed per seated sprite by the table preload — the
 *  manifest head is the scene front door (a scene's first beats live
 *  there) and always warms, inside the warm budget below. */
const PC_HEAD_WARM = 12;
/**
 * The starter-warm budget per seated sprite (2026-11-05, the
 * sparse-talk fix). A decode pass costs a whole-sprite decode —
 * measured 6–12 s for a talker's sprite on desktop Chromium, slower on
 * a throttled phone — while a line that waits >1.5 s for its clip is
 * dropped silent. Warming only the head window left the table
 * rotation (which the engine draws near-without-repeat, so most lines
 * are first plays) paying that decode on the critical path: roughly
 * half of a table's lines never sounded. The preload therefore pays
 * ONE pass per seated sprite up front and slices the sprite's
 * table-rotation set into the clip cache: the head window, the
 * consultation's conversational lines, then the generic talk pools in
 * the kind order below (rig-measured delivered share first, big-moment
 * kinds ahead of the tail), whole pools at a time, until this budget
 * is spent. 28 MiB ≈ 120 clips per sprite; a four-sprite table warms
 * to ~110 MiB against the 112 MiB clip ceiling above.
 */
export const VOICE_WARM_BUDGET_BYTES = 28 * 1024 * 1024;
/** Talk kinds in starter-warm priority order (see above). Text-only
 *  kinds never appear here — they render as text by design and are
 *  excluded again at selection time via TEXT_ONLY_KINDS. */
const VOICE_WARM_KIND_ORDER: readonly string[] = [
  'prePlay', 'roast', 'cut', 'setThem', 'win', 'wheels', 'nuke',
  'gotCut', 'overcut', 'made', 'hypePartner', 'slam', 'gotSet',
  'joker', 'badHand', 'runIt', 'gotNuked', 'nilBust', 'blindNil',
  'nilMade', 'boston', 'shotOut', 'matchPoint', 'lose', 'gotRan',
  'partnerBlunder', 'bidTooHigh', 'roastBid', 'bigBid', 'nilBid',
  'streak', 'bags', 'duck', 'slow', 'loudLoser', 'onNotice',
  'rematch', 'newbie', 'reveal',
];
/** The consultation's conversational clips (the number-free lines and
 *  the intro/confer glue) warmed with the rotation set. The numbered
 *  grid takes are deliberately NOT pre-warmed — there are ~21 cells
 *  per template; they warm through play as cells recur. */
const VOICE_WARM_CONSULT_RAWS: readonly string[] = [
  ...Object.values(CONSULT_FREE).flatMap((ls) => [...ls]),
  ...INTRO_COMMON, ...CONFER_ASK, ...CONFER_RESP,
];

interface PcManifest { clips: Record<string, [number, number]>; order: string[] }
const pcManifests = new Map<string, Promise<PcManifest | null>>();
const pcRetries = new Map<string, number>();

const pcBytesMap = new Map<string, { data: ArrayBuffer; used: number }>();
const pcBytesPromises = new Map<string, Promise<ArrayBuffer | null>>();
let pcEncodedTotal = 0;

interface PcClip { buf: AudioBuffer; bytes: number; used: number }
const pcClipsMap = new Map<string, PcClip>();
const pcWholeMap = new Map<string, PcClip>();
let pcClipTotal = 0;
let pcClock = 0;

let pcPasses = 0;
let pcLastPassMs: number | null = null;
let pcClipHits = 0;
let pcClipMisses = 0;

const pcClipId = (key: string, clipKey: string) => `${key}\n${clipKey}`;
const pcIdKey = (id: string) => id.slice(0, id.indexOf('\n'));

/** The manifest key playClip would use for this line — the take
 *  resolution is the legacy layer's, verbatim: a defined key/bid take
 *  that EXISTS wins, else the raw line itself. */
function pcResolveClipKey(clips: Record<string, [number, number]>, raw: string, bid?: number, key?: string): string | null {
  const takeKey = key !== undefined ? `${raw}#${key}` : bid !== undefined ? `${raw}#${bid}` : undefined;
  if (takeKey !== undefined && clips[takeKey]) return takeKey;
  return clips[raw] ? raw : null;
}

/** Manifest only — the small JSON, never the audio. A failed manifest
 *  is evicted once it settles (budgeted, mirroring the legacy heal) so
 *  the next line retries it against a live network/context. */
function pcManifest(key: string): Promise<PcManifest | null> {
  let p = pcManifests.get(key);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(voiceUrl(`${key}.json`));
        if (!res.ok) return null;
        const { clips } = (await res.json()) as { clips: Record<string, [number, number]> };
        return { clips, order: Object.keys(clips) };
      } catch { return null; }
    })();
    pcManifests.set(key, p);
    void p.then((m) => { if (!m && pcManifests.get(key) === p) pcNoteFailure(key); });
  }
  return p;
}

/** A failed manifest/bytes/decode evicts the sprite's cached layers
 *  (budgeted per session, mirroring the legacy LOAD_RETRY_BUDGET heal)
 *  so the next line retries; past the budget the dead entries stay put
 *  rather than re-downloading megabytes on every line. */
function pcNoteFailure(key: string): void {
  const used = pcRetries.get(key) ?? 0;
  if (used >= LOAD_RETRY_BUDGET) return;
  pcRetries.set(key, used + 1);
  pcManifests.delete(key);
  pcDropBytes(key);
}

function pcDropBytes(key: string): void {
  const e = pcBytesMap.get(key);
  if (e) { pcEncodedTotal -= e.data.byteLength; pcBytesMap.delete(key); }
  pcBytesPromises.delete(key);
}

function pcEnforceEncodedBudget(keepKey: string): void {
  if (pcEncodedTotal <= VOICE_ENCODED_BUDGET_BYTES) return;
  const lru = [...pcBytesMap.entries()]
    .filter(([k]) => k !== keepKey && !seatedKeys.has(k))
    .sort((a, b) => a[1].used - b[1].used);
  for (const [k] of lru) {
    if (pcEncodedTotal <= VOICE_ENCODED_BUDGET_BYTES) break;
    pcDropBytes(k);
  }
}

/** The sprite's compressed bytes, fetched once per residency lifetime. */
function pcFetchBytes(key: string): Promise<ArrayBuffer | null> {
  const held = pcBytesMap.get(key);
  if (held) { held.used = ++pcClock; return Promise.resolve(held.data); }
  let p = pcBytesPromises.get(key);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(voiceUrl(`${key}.${format()}`));
        if (!res.ok) return null;
        const data = await res.arrayBuffer();
        pcBytesMap.set(key, { data, used: ++pcClock });
        pcEncodedTotal += data.byteLength;
        pcEnforceEncodedBudget(key);
        publishVoiceProbe();
        return data;
      } catch { return null; }
    })();
    pcBytesPromises.set(key, p);
    void p.then((d) => { if (!d && pcBytesPromises.get(key) === p) pcNoteFailure(key); });
  }
  return p;
}

function pcDropClip(id: string): void {
  const c = pcClipsMap.get(id);
  if (c) { pcClipTotal -= c.bytes; pcClipsMap.delete(id); }
}

function pcDropWhole(key: string): void {
  const w = pcWholeMap.get(key);
  if (w) { pcClipTotal -= w.bytes; pcWholeMap.delete(key); }
}

/** Evict least-recently-used clips (and whole-sprite fallbacks) until
 *  the decoded total fits the cap. `protect` holds the clip ids a pass
 *  just sliced for waiting lines — they are never evicted by their own
 *  pass. Eviction drops only the cache reference; a playing line holds
 *  its buffer and finishes. */
function pcEnforceClipBudget(protect: ReadonlySet<string>): void {
  if (pcClipTotal <= VOICE_CLIP_CACHE_BUDGET_BYTES) return;
  const candidates: { id: string; used: number; whole: boolean }[] = [
    ...[...pcClipsMap.entries()].map(([id, c]) => ({ id, used: c.used, whole: false })),
    ...[...pcWholeMap.entries()].map(([k, c]) => ({ id: k, used: c.used, whole: true })),
  ].sort((a, b) => a.used - b.used);
  for (const cand of candidates) {
    if (pcClipTotal <= VOICE_CLIP_CACHE_BUDGET_BYTES) break;
    if (!cand.whole && protect.has(cand.id)) continue;
    // A whole-sprite fallback stored by THIS pass (its sprite is the
    // protected clips' sprite) is never evicted by its own pass.
    if (cand.whole && [...protect].some((id) => pcIdKey(id) === cand.id)) continue;
    if (cand.whole) pcDropWhole(cand.id); else pcDropClip(cand.id);
  }
}

function pcStoreClip(key: string, clipKey: string, buf: AudioBuffer): void {
  const id = pcClipId(key, clipKey);
  pcDropClip(id);
  const raw = voiceBufferBytes(buf);
  const bytes = Number.isFinite(raw) && raw > 0 ? raw : 0;
  pcClipsMap.set(id, { buf, bytes, used: ++pcClock });
  pcClipTotal += bytes;
}

/** A factory for slice buffers: an offline context where one exists
 *  (the decode already proved the class), else the engine context. */
function makeSliceBuffer(len: number, rate: number): AudioBuffer | null {
  try {
    if (typeof OfflineAudioContext !== 'undefined') {
      const b = new OfflineAudioContext(1, 1, rate).createBuffer(1, len, rate);
      if (b && typeof b.copyToChannel === 'function') return b;
    }
  } catch { /* fall through to the engine context */ }
  try {
    const ctx = sound.audioContext();
    if (ctx && typeof ctx.createBuffer === 'function') {
      const b = ctx.createBuffer(1, len, rate);
      if (b && typeof b.copyToChannel === 'function') return b;
    }
  } catch { /* no buffer factory in this environment */ }
  return null;
}

/** Cut one clip out of a decoded sprite, at the DECODED buffer's own
 *  rate (24 kHz on the offline path). Returns null when the decoded
 *  object cannot be sliced — test doubles and nothing else: production
 *  decodeAudioData always yields channel data — in which case the pass
 *  retains the whole buffer as that sprite's fallback (accounted at
 *  full size) and lines play with their original sprite offsets. */
function sliceClip(decoded: AudioBuffer, at: [number, number]): AudioBuffer | null {
  try {
    const rate = decoded.sampleRate;
    const total = decoded.length;
    if (!rate || !total || typeof decoded.getChannelData !== 'function') return null;
    const src = decoded.getChannelData(0);
    const start = Math.min(total - 1, Math.max(0, Math.floor((at[0] / 1000) * rate)));
    const len = Math.max(1, Math.min(total - start, Math.round((at[1] / 1000) * rate)));
    const out = makeSliceBuffer(len, rate);
    if (!out) return null;
    out.copyToChannel(src.subarray(start, start + len) as Float32Array<ArrayBuffer>, 0);
    return out;
  } catch { return null; }
}

interface PcWaiter { clipKey: string; resolve: (r: { buf: AudioBuffer; whole: boolean } | null) => void }
const pcPendingWants = new Map<string, Set<string>>();
const pcWaiters = new Map<string, PcWaiter[]>();
const pcQueued = new Set<string>();
let pcRunningKey: string | null = null;
let pcChain: Promise<void> = Promise.resolve();

function pcAddWant(key: string, clipKey: string): void {
  let set = pcPendingWants.get(key);
  if (!set) { set = new Set(); pcPendingWants.set(key, set); }
  set.add(clipKey);
}

/** Exact wants: clips a pass must slice AS THEMSELVES, with no ±10
 *  window expansion. The starter warm registers ~120 clips per sprite;
 *  window-expanding those would inflate the pass toward the whole
 *  sprite and blow the warm budget. Fired-line wants (pcAddWant) keep
 *  the window — their neighbours are that line's likeliest followers. */
const pcExactWants = new Map<string, Set<string>>();
function pcAddExactWant(key: string, clipKey: string): void {
  let set = pcExactWants.get(key);
  if (!set) { set = new Set(); pcExactWants.set(key, set); }
  set.add(clipKey);
}

/** Queue a decode pass for a sprite. Passes are SERIALIZED — never two
 *  sprites decoding at once — and a sprite already queued or running
 *  is not queued twice (a running pass re-kicks itself if wants landed
 *  while it worked). */
function pcKickPass(key: string): void {
  if (pcQueued.has(key) || pcRunningKey === key) return;
  pcQueued.add(key);
  pcChain = pcChain.then(async () => {
    pcQueued.delete(key);
    pcRunningKey = key;
    try { await pcRunPass(key); } catch { /* pcRunPass resolves its own waiters; never rethrow */ }
    pcRunningKey = null;
    // Wants that landed while this pass decoded belong to a follow-up
    // pass (a kick during the run no-ops against pcRunningKey, so the
    // chain tail is where the follow-up is armed).
    if ((pcPendingWants.get(key)?.size ?? 0) > 0 || (pcExactWants.get(key)?.size ?? 0) > 0 || (pcWaiters.get(key)?.length ?? 0) > 0) pcKickPass(key);
  });
}

/** Register a want and wait for the pass that slices it. */
function pcAwaitClip(key: string, clipKey: string): Promise<{ buf: AudioBuffer; whole: boolean } | null> {
  return new Promise((resolve) => {
    pcAddWant(key, clipKey);
    let ws = pcWaiters.get(key);
    if (!ws) { ws = []; pcWaiters.set(key, ws); }
    ws.push({ clipKey, resolve });
    pcKickPass(key);
  });
}

async function pcRunPass(key: string): Promise<void> {
  const wants = pcPendingWants.get(key) ?? new Set<string>();
  pcPendingWants.delete(key);
  const exactWants = pcExactWants.get(key) ?? new Set<string>();
  pcExactWants.delete(key);
  const waiters = pcWaiters.get(key) ?? [];
  pcWaiters.delete(key);
  if (!wants.size && !exactWants.size && !waiters.length) return;
  const t0 = performance.now();
  const finish = (failed: boolean) => {
    pcPasses++;
    pcLastPassMs = Math.round(performance.now() - t0);
    if (failed) pcNoteFailure(key);
    for (const w of waiters) {
      const c = pcClipsMap.get(pcClipId(key, w.clipKey));
      if (c) { c.used = ++pcClock; w.resolve({ buf: c.buf, whole: false }); continue; }
      const whole = pcWholeMap.get(key);
      if (whole) { whole.used = ++pcClock; w.resolve({ buf: whole.buf, whole: true }); continue; }
      w.resolve(null);
    }
    publishVoiceProbe();
  };
  const man = await pcManifest(key);
  if (!man) { finish(true); return; }
  // Expand each fired-line want to its manifest neighbourhood (minus
  // what's held); exact wants (the starter warm) slice as themselves.
  const sliceSet = new Set<string>();
  for (const ck of wants) {
    if (pcClipsMap.has(pcClipId(key, ck)) || pcWholeMap.has(key)) continue;
    const ix = man.order.indexOf(ck);
    if (ix < 0) { sliceSet.add(ck); continue; }
    for (let j = Math.max(0, ix - PC_WINDOW); j <= Math.min(man.order.length - 1, ix + PC_WINDOW); j++) {
      const nk = man.order[j]!;
      if (!pcClipsMap.has(pcClipId(key, nk))) sliceSet.add(nk);
    }
  }
  for (const ck of exactWants) {
    if (!pcClipsMap.has(pcClipId(key, ck)) && !pcWholeMap.has(key)) sliceSet.add(ck);
  }
  if (!sliceSet.size) { finish(false); return; }
  const data = await pcFetchBytes(key);
  if (!data) { finish(true); return; }
  let decoded: AudioBuffer | null = null;
  try { decoded = await decodeSprite(data); } catch { decoded = null; }
  if (!decoded) { finish(true); return; }
  // Retention is decided at store time (mirrors the legacy loadGen
  // rule): a sprite evicted mid-pass still serves its waiting callers —
  // the line plays — but nothing it sliced is retained.
  const retain = seatedKeys.has(key) || pcBytesMap.has(key);
  const sliced = new Set<string>();
  let wholeFallback = false;
  for (const ck of sliceSet) {
    const at = man.clips[ck];
    if (!at) continue;
    const buf = sliceClip(decoded, at);
    if (!buf) { wholeFallback = true; break; }
    sliced.add(ck);
    pcStoreClip(key, ck, buf);
  }
  if (wholeFallback) {
    pcDropWhole(key);
    const raw = voiceBufferBytes(decoded);
    const bytes = Number.isFinite(raw) && raw > 0 ? raw : 0;
    pcWholeMap.set(key, { buf: decoded, bytes, used: ++pcClock });
    pcClipTotal += bytes;
  }
  if (retain) pcEnforceClipBudget(new Set([...sliced].map((ck) => pcClipId(key, ck))));
  finish(false);
  if (!retain) {
    // The transient slices served their waiters in finish(); drop them.
    for (const ck of sliced) pcDropClip(pcClipId(key, ck));
    pcDropWhole(key);
  }
}

/** Table change, per-clip layer: a departed sprite loses its manifest,
 *  its compressed bytes and every decoded clip on the spot (the legacy
 *  layer's rule, at per-clip scale). A pass in flight for it still
 *  resolves its waiting callers — see the retention check in pcRunPass. */
function pcEvictNonSeated(): void {
  for (const k of [...pcManifests.keys()]) if (!seatedKeys.has(k)) pcManifests.delete(k);
  for (const k of [...pcBytesMap.keys()]) if (!seatedKeys.has(k)) pcDropBytes(k);
  for (const k of [...pcBytesPromises.keys()]) if (!seatedKeys.has(k)) pcBytesPromises.delete(k);
  for (const id of [...pcClipsMap.keys()]) if (!seatedKeys.has(pcIdKey(id))) pcDropClip(id);
  for (const k of [...pcWholeMap.keys()]) if (!seatedKeys.has(k)) pcDropWhole(k);
  for (const k of [...pcRetries.keys()]) if (!seatedKeys.has(k)) pcRetries.delete(k);
  for (const k of [...pcExactWants.keys()]) if (!seatedKeys.has(k)) pcExactWants.delete(k);
  publishVoiceProbe();
}

/** Play through the per-clip layer: cache hit plays at once; a miss
 *  registers the want and awaits the sprite's pass (the legacy 1.5 s
 *  too-late rule applies from the call, unchanged). */
async function playClipPc(persona: PersonaId, name: string, raw: string | undefined, gain: number, bid?: number, seat?: import('../spatial').SeatPos, playerCount = 4, opts?: { crossTalk?: boolean; deferCut?: boolean; key?: string }): Promise<boolean> {
  if (!raw) return false;
  const t0 = performance.now();
  const key = keyFor(persona, name);
  const man = await pcManifest(key);
  if (!man) return false;
  const clipKey = pcResolveClipKey(man.clips, raw, bid, opts?.key);
  if (!clipKey) return false;
  const at = man.clips[clipKey]!;
  const playWith = (sp: { buf: AudioBuffer }, slice: [number, number]): boolean => {
    if (opts?.crossTalk) return sound.playVoiceCrossTalk(sp.buf, gain, slice, seat, playerCount, name, { defer: !!opts.deferCut });
    return sound.playVoice(sp.buf, gain, slice, seat, playerCount);
  };
  const whole = pcWholeMap.get(key);
  if (whole) { whole.used = ++pcClock; pcClipHits++; return playWith({ buf: whole.buf }, [at[0] / 1000, at[1] / 1000]); }
  const hitClip = pcClipsMap.get(pcClipId(key, clipKey));
  if (hitClip) { hitClip.used = ++pcClock; pcClipHits++; return playWith({ buf: hitClip.buf }, [0, at[1] / 1000]); }
  pcClipMisses++;
  const got = await pcAwaitClip(key, clipKey);
  if (performance.now() - t0 > 1500) return true; // too late to still fit the moment: stay quiet
  if (!got) return false;
  return got.whole
    ? playWith({ buf: got.buf }, [at[0] / 1000, at[1] / 1000])
    : playWith({ buf: got.buf }, [0, at[1] / 1000]);
}

/** clipDurationMs through the per-clip layer: the manifest alone
 *  answers — no audio fetch, no decode (the legacy doc comment always
 *  promised this; the per-clip layer is what makes it true). */
async function clipDurationMsPc(persona: PersonaId, name: string, raw: string | undefined, bid?: number, key?: string): Promise<number | null> {
  if (!raw) return null;
  const spriteKey = keyFor(persona, name);
  const man = await pcManifest(spriteKey);
  if (!man) return null;
  const clipKey = pcResolveClipKey(man.clips, raw, bid, key);
  return clipKey ? man.clips[clipKey]![1] : null;
}

/** The starter warm's clip set for one sprite (see
 *  VOICE_WARM_BUDGET_BYTES): head window first, then the consultation's
 *  conversational lines, then the persona's recordable talk pools in
 *  warm-priority kind order — each line together with every take the
 *  bake recorded for it — until the per-sprite budget is spent.
 *  Text-only kinds are excluded: their lines render as text by design
 *  and warming them would spend budget on clips that never play. */
function pcStarterClips(persona: PersonaId, name: string, man: PcManifest): string[] {
  const inManifest = (k: string) => man.clips[k] !== undefined;
  const bytesOf = (k: string) => (man.clips[k]![1] / 1000) * VOICE_DECODE_RATE * 4;
  const takesByBase = new Map<string, string[]>();
  for (const k of man.order) {
    const hash = k.indexOf('#');
    if (hash < 0) continue;
    const base = k.slice(0, hash);
    const arr = takesByBase.get(base) ?? [];
    arr.push(k);
    takesByBase.set(base, arr);
  }
  const picked: string[] = [];
  const seen = new Set<string>();
  let spent = 0;
  /** Offer one clip to the warm. Returns false only when the budget is
   *  spent (the caller stops); duplicates and absences are free. */
  const offer = (k: string): boolean => {
    if (seen.has(k) || !inManifest(k)) return true;
    const b = bytesOf(k);
    if (spent + b > VOICE_WARM_BUDGET_BYTES) return false;
    seen.add(k);
    picked.push(k);
    spent += b;
    return true;
  };
  for (const ck of man.order.slice(0, PC_HEAD_WARM)) if (!offer(ck)) return picked;
  for (const raw of VOICE_WARM_CONSULT_RAWS) if (!offer(raw)) return picked;
  const byKind = new Map<string, string[]>();
  for (const l of speakableLines(persona, voiceGender(name))) {
    if (TEXT_ONLY_KINDS.includes(l.kind) || l.raw === '…') continue;
    const keys = [l.raw, ...(takesByBase.get(l.raw) ?? [])];
    const arr = byKind.get(l.kind) ?? [];
    arr.push(...keys);
    byKind.set(l.kind, arr);
  }
  for (const kind of VOICE_WARM_KIND_ORDER) {
    for (const ck of byKind.get(kind) ?? []) if (!offer(ck)) return picked;
  }
  return picked;
}

/** Preload through the per-clip layer: fetch the manifest + compressed
 *  bytes in the background and queue ONE starter pass that slices the
 *  sprite's table-rotation set (pcStarterClips) into the clip cache,
 *  so the lines a game actually draws are resident before the first
 *  hand instead of each paying a whole-sprite decode on its moment. */
function preloadVoicePc(persona: PersonaId, name: string): void {
  const key = keyFor(persona, name);
  if (pcBytesMap.has(key)) return;
  const go = () => {
    void (async () => {
      const man = await pcManifest(key);
      if (!man) return;
      await pcFetchBytes(key);
      for (const ck of pcStarterClips(persona, name, man)) pcAddExactWant(key, ck);
      pcKickPass(key);
    })();
  };
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void) => void }).requestIdleCallback;
  if (ric) ric(go); else setTimeout(go, 400);
}

/**
 * Warm one line's clip ahead of its moment: register the want and kick
 * the sprite's decode pass, fire-and-forget. The schedulers that know
 * upcoming lines call this — ScriptPlayer for the next scene beats,
 * DeeRundown for its single line — so by the time the line's turn
 * arrives its decode is done or under way. Never plays anything, never
 * rejects, and is a no-op on the legacy layer (which warms whole
 * sprites at preload instead).
 */
export function warmClip(persona: PersonaId, name: string, raw: string | undefined, bid?: number, key?: string): void {
  if (!raw || !voicePerClipEnabled()) return;
  const spriteKey = keyFor(persona, name);
  void (async () => {
    try {
      const man = await pcManifest(spriteKey);
      if (!man) return;
      const clipKey = pcResolveClipKey(man.clips, raw, bid, key);
      if (!clipKey) return;
      if (pcClipsMap.has(pcClipId(spriteKey, clipKey)) || pcWholeMap.has(spriteKey)) return;
      pcAddWant(spriteKey, clipKey);
      pcKickPass(spriteKey);
    } catch { /* warming is best-effort by construction */ }
  })();
}

/** Warm a batch of one speaker's upcoming lines (see warmClip). */
export function warmClips(persona: PersonaId, name: string, raws: readonly string[]): void {
  for (const r of raws) warmClip(persona, name, r);
}

/* =====================================================================
 * RESIDENCY PROBE + PUBLIC SURFACE
 * The dispatchers below are the module's public contract (Table.tsx,
 * talkPrefs.ts): signatures identical to the legacy layer's, routed by
 * the flag. voiceResidencySnapshot mirrors the figure-residency probe
 * pattern and is published on window.__bwmVoiceResidency whenever the
 * per-clip residency changes, so a device session can be read live:
 * decoded clip bytes against their hard cap, compressed bytes against
 * theirs, pass count and the last pass's duration.
 * ===================================================================== */

export interface VoiceResidencySnapshot {
  layer: 'per-clip' | 'legacy';
  /** Decoded clip bytes currently held (per-clip layer). */
  clipBytes: number;
  clipBudgetBytes: number;
  clipCount: number;
  wholeSprites: number;
  /** Compressed sprite bytes currently held (per-clip layer). */
  encodedBytes: number;
  encodedBudgetBytes: number;
  encodedSprites: number;
  passes: number;
  lastPassMs: number | null;
  clipHits: number;
  clipMisses: number;
  /** The legacy layer's decoded residency, for the flagged-off A/B. */
  legacyResidentBytes: number;
  legacyBudgetBytes: number;
}

/** Total decoded clip PCM currently held by the per-clip cache. */
export function residentClipBytes(): number { return pcClipTotal; }
/** Clip ids (`spriteKey\nclipKey`) currently held by the per-clip cache. */
export function residentClipIds(): string[] { return [...pcClipsMap.keys()]; }
/** Total compressed sprite bytes currently held by the per-clip layer. */
export function residentEncodedBytes(): number { return pcEncodedTotal; }

export function voiceResidencySnapshot(): VoiceResidencySnapshot {
  return {
    layer: voicePerClipEnabled() ? 'per-clip' : 'legacy',
    clipBytes: pcClipTotal,
    clipBudgetBytes: VOICE_CLIP_CACHE_BUDGET_BYTES,
    clipCount: pcClipsMap.size,
    wholeSprites: pcWholeMap.size,
    encodedBytes: pcEncodedTotal,
    encodedBudgetBytes: VOICE_ENCODED_BUDGET_BYTES,
    encodedSprites: pcBytesMap.size,
    passes: pcPasses,
    lastPassMs: pcLastPassMs,
    clipHits: pcClipHits,
    clipMisses: pcClipMisses,
    legacyResidentBytes: residentVoiceBytes(),
    legacyBudgetBytes: VOICE_RESIDENCY_BUDGET_BYTES,
  };
}

export function publishVoiceProbe(): void {
  try {
    if (typeof window !== 'undefined') {
      (window as unknown as Record<string, unknown>).__bwmVoiceResidency = voiceResidencySnapshot();
    }
  } catch { /* probe publication is never load-bearing */ }
}

/**
 * A table change (see setSeatedVoiceKeysLegacy for the full story):
 * the dispatcher updates the shared seated set through the legacy body
 * — which also runs the legacy layer's evictions — and then applies
 * the same rule to the per-clip layer's manifests, bytes and clips.
 */
export function setSeatedVoiceKeys(keys: readonly string[]): void {
  setSeatedVoiceKeysLegacy(keys);
  pcEvictNonSeated();
  publishVoiceProbe();
}

/** A bot sat down: warm its voice in the background (only seated bots are ever fetched). */
export function preloadVoice(persona: PersonaId, name: string): void {
  if (voicePerClipEnabled()) preloadVoicePc(persona, name);
  else preloadVoiceLegacy(persona, name);
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
  const played = voicePerClipEnabled()
    ? await playClipPc(persona, name, raw, gain, bid, seat, playerCount, opts)
    : await playClipLegacy(persona, name, raw, gain, bid, seat, playerCount, opts);
  publishVoiceProbe();
  return played;
}

/**
 * The recorded duration (ms) of the clip playClip would play for this
 * line, or null when there is none. Same sprite, same lookup — the
 * manifest JSON alone answers (the audio needn't have decoded), so a
 * caller can pace itself against a line's voice without playing
 * anything or forking the speech path. The story scene player paces
 * its typewriter reveal against this (talkPrefs.spokenClipDurationMs).
 * On the per-clip layer the promise is kept literally: the manifest is
 * all that is ever fetched here.
 */
export async function clipDurationMs(persona: PersonaId, name: string, raw: string | undefined, bid?: number, key?: string): Promise<number | null> {
  return voicePerClipEnabled()
    ? clipDurationMsPc(persona, name, raw, bid, key)
    : clipDurationMsLegacy(persona, name, raw, bid, key);
}
