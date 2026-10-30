/**
 * Bid Wit Me sound engine (Web Audio).
 * - Card/chip foley: Kenney "Casino Audio" + "UI Audio" (CC0), re-encoded to small mono MP3 (plays on Safari/iOS).
 * - Musical cues (turn chime, stingers, jingles, spades-broken sting, whoosh, buzz) and the optional lounge ambience
 *   are synthesized here with oscillators/noise — no extra files.
 * - iOS/Safari only allow audio after a user gesture: the context is created/resumed on the first
 *   touchstart/pointerdown (and a key). visibilitychange and pageshow resume it when the page returns.
 *   An 'interrupted' or closed context is rebuilt. If it stays suspended, the header speaker
 *   shows a needs-tap state; tapping that icon resumes or rebuilds inside the gesture.
 *   (The iPhone silent switch mutes Web Audio; there is no way around that from a web page.)
 * - Settings (on/off, volume, ambience) persist in localStorage.
 */
import { useSyncExternalStore } from 'react';
import { Spatializer, STORY_STOP_AUDIO, irSpec, isVoiceMuted, normalizeCategoryVolumes, pickPanningModel, pickVariant, seatCompensation, seatPoint, sessionRoom, surfaceHz, voiceLineGain, withVoiceMuted, type RoomStyle, type SeatPos, type StoryMood, type VenueEvent } from './spatial';
import { audioElementPool } from './audioPool';
import { RESTORE_HEAL_MS, audioContextAction, cancelActiveSpeech, claimPlaybackSession, recreateDue, settleAudio, soundRestorePending } from './audioSession';

/**
 * decodeAudioData completion runs on the main thread. Decoding every stinger and voice sprite in
 * one turn was a resume hitch, so decodes take a ticket and yield a frame between them.
 */
let decodeChain: Promise<void> = Promise.resolve();
export function decodeAudioBuffer(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  const task = decodeChain.then(() => new Promise<AudioBuffer>((ok, bad) => {
    // Callback form for older Safari. The method also returns a promise; leaving that rejection
    // unhandled surfaces as "Context is closed" / EncodingError when a rebuilt context abandons a decode.
    try {
      void settleAudio(ctx.decodeAudioData(data, ok, bad));
    } catch (err) {
      bad(err instanceof DOMException ? err : new DOMException(String(err)));
    }
  }));
  decodeChain = task.then(
    () => new Promise((resolve) => { setTimeout(resolve, 0); }),
    () => new Promise((resolve) => { setTimeout(resolve, 0); }),
  );
  return task;
}

export type Sfx =
  | 'shuffle' | 'deal' | 'play' | 'tap' | 'sweep' | 'broken' | 'turn' | 'bid' | 'bidSoft'
  | 'cut' | 'made' | 'set' | 'nil' | 'bags' | 'pop' | 'win' | 'lose' | 'flip'
  // hype effects. The sheet siren is a recorded wail (CREDITS.md); the rest are synthesized.
  | 'jokerLittle' | 'jokerBig' | 'nuke' | 'mega' | 'streak1' | 'streak2' | 'streak3' | 'shot' | 'gotShot' | 'shotgun' | 'pump' | 'siren' | 'docSting' | 'wheels' | 'wheelsCar' | 'overcut' | 'overcut3' | 'tornado'
  // 'Run it!': the claimer's cards all slam at once / everyone else's cards hit in a quick cascade
  | 'runSlam' | 'runThud'
  // Versus intro (boxing-style match card on the loading screen): entrances travel
  // in 3D from each side, the collision lands center-front, a stinger marks the
  // tale-of-the-tape reveal, a wide crowd bed sits under the hold, a soft resolve
  // hands off to the table. All synthesized through the spatial pipeline.
  | 'versusWhoosh' | 'versusImpact' | 'versusSting' | 'versusCrowd' | 'versusResolve'
  // chat notifications (synthesized): a DM two-note chime and a soft global-chat blip.
  // Both are UI_SFX, so they sound anywhere in the app, not just at a table.
  | 'dmChime' | 'chatBlip'
  // the white sheet unrolling over a scorecard: soft fabric rustle (synthesized, no sample)
  | 'cloth';

/** SFX that bot voices duck under, and for how long (ms). */
const DUCK_MS: Partial<Record<Sfx, number>> = { runSlam: 700, nuke: 3600, mega: 4400, tornado: 2600, wheelsCar: 3000, jokerBig: 1100, shot: 1200, shotgun: 700, pump: 500, siren: 2700, docSting: 2400, streak2: 1400, streak3: 1800, overcut3: 1000, win: 2000, lose: 1600, set: 1200, nil: 1600 };

export interface SoundSettings { on: boolean; volume: number; ambient: boolean; music: boolean; musicVolume: number; /** the venue's quiet ambient sound bed (Release 7), default on */ venueSound: boolean;
  /** Chat notification sounds (DM chime / global-chat blip). Absent = on. */ chatSounds?: boolean;
  /** Spatial Phase 2 (all optional; defaults reproduce today's sound): per-category volumes, audio quality, spatial on/off, per-player voice mutes. */
  volumes?: import('./spatial').CategoryVolumes; quality?: import('./spatial').AudioQuality; spatial?: boolean; mutedVoices?: Record<string, true>;
  /** RETIRED soundscape pick: until 2026-10-20 the player could override the room's sound
   *  here. The owner killed the picker — each venue has its own signature sounds, set
   *  automatically from the venue — so nothing reads this anymore and load() strips a
   *  saved value, which simply stops affecting playback. Kept on the type only so old
   *  saved JSON still parses. */
  soundscape?: string;
  /** Per-context EXPLICIT sound scene (menus vs in-game) chosen by the player in that context.
   *  Absent = use the context default (menus: none, game: music). Live flags always mirror
   *  the active scene, so this only records deliberate choices — defaults never write it. */
  scenes?: { menu?: SoundScene; game?: SoundScene };
  /** RETIRED menu ambience scenes: Block Party, Front Porch, Beauty Salon, Park
   *  Dominoes and Kitchen-Table Spades Night were menu/settings picks and are
   *  no longer offered or applied at menu level (founder call). load() strips
   *  their legacy flags / menu pick so a saved scene simply stops sounding in
   *  menus. The per-venue soundscape beds (VenueBed, e.g. Grandma's 'kitchen')
   *  are a different system and are untouched: in-venue sound follows the room. */
}

/** Where the player is: menus (setup/home/lobby) or in a game. */
export type SoundContext = 'menu' | 'game';
/** The background scene: music, ambience (lounge and/or venue bed), both, or neither.
 *  Music and ambience are INDEPENDENT (Demetrius 2026-10-19): a room's soundscape
 *  bed plays whether or not music is on. */
export type SoundScene = 'music' | 'ambience' | 'both' | 'none';
const KEY = 'bwm.sound.v1';
const DEFAULTS: SoundSettings = { on: true, volume: 0.7, ambient: false, music: true, musicVolume: 0.5, venueSound: true };

/* Music and ambience are INDEPENDENT (Demetrius 2026-10-19): game music and either
 * ambience bed (the lounge pad or the venue soundscape bed) may all sound together.
 * Each switch only controls its own source; the engine gates below check each source
 * on its own, so a venue bed (e.g. The Pj's street sounds) plays whether music is on
 * or off. */
/** Either ambience source switched on? (venueSound defaults on when unset.) */
export const ambienceOn = (s: SoundSettings): boolean => !!(s.ambient || s.venueSound !== false);
/** Engine gate: music sounds whenever the music switch is on. */
export const wantsMusic = (s: SoundSettings): boolean => !!s.music;
/** Engine gate: ambience sounds whenever an ambience source is on. */
export const wantsAmbience = (s: SoundSettings): boolean => ambienceOn(s);
/** Chat notification sounds: on unless the player turned them off; master sound off silences them too. */
export const chatSoundsOn = (s: SoundSettings): boolean => !!s.on && s.chatSounds !== false;

/** One synthesized tone of a chat notification sound (times in seconds from the start). */
export interface ChatTone { at: number; freq: number; dur: number; type: OscillatorType; gain: number; glideTo?: number }
/**
 * DM notification: a bright two-note bell — F6 (1396.91 Hz) then C7 (2093 Hz), triangle wave with a
 * faint sine shimmer an octave up. Deliberately unlike the turn chime (E6→B6, plain sine, quieter):
 * different pitches, different order of intervals, richer timbre — reads as "you got a message".
 */
export const DM_CHIME_TONES: ChatTone[] = [
  { at: 0, freq: 1396.91, dur: 0.42, type: 'triangle', gain: 0.2 },
  { at: 0, freq: 2793.83, dur: 0.22, type: 'sine', gain: 0.035 },
  { at: 0.13, freq: 2093, dur: 0.55, type: 'triangle', gain: 0.17 },
  { at: 0.13, freq: 4186.01, dur: 0.28, type: 'sine', gain: 0.025 },
];
/**
 * Global-chat notification: one soft, low, short blip — E5 (659.25 Hz) gliding down to D5, plain
 * sine, well under half the DM chime's peak gain and a third of its length.
 */
export const CHAT_BLIP_TONES: ChatTone[] = [
  { at: 0, freq: 659.25, dur: 0.16, type: 'sine', gain: 0.085, glideTo: 587.33 },
];

/** The scene the live switches currently describe. */
export function sceneOf(s: SoundSettings): SoundScene {
  const m = !!s.music, a = ambienceOn(s);
  return m && a ? 'both' : m ? 'music' : a ? 'ambience' : 'none';
}
const SCENE_PATCH: Record<SoundScene, Partial<SoundSettings>> = {
  music: { music: true, ambient: false, venueSound: false },
  ambience: { music: false, ambient: true, venueSound: true },
  both: { music: true, ambient: true, venueSound: true },
  none: { music: false, ambient: false, venueSound: false },
};
/** Context default when the player has not made an explicit choice in that context. */
export const contextDefault = (ctx: SoundContext): SoundScene => (ctx === 'menu' ? 'none' : 'music');
/**
 * The settings a context should run with: the player's explicit choice for that context if
 * they made one, otherwise the context default. Music and ambience are independent, so a
 * recorded 'both' scene applies both switches; defaults never write anything.
 */
export function settingsForContext(s: SoundSettings, ctx: SoundContext): SoundSettings {
  const recorded = s.scenes?.[ctx] ?? contextDefault(ctx);
  // Retired menu scenes: a saved menu 'ambience' choice is no longer applied in
  // menus (menus default to no background scene; an explicit menu music choice
  // still stands). In game, an ambience choice still means the venue's own bed.
  const scene: SoundScene = ctx === 'menu' && recorded === 'ambience' ? 'none' : recorded;
  const patched: SoundSettings = { ...s, ...SCENE_PATCH[scene] };
  return patched;
}
/** venue ambience beds (see venues.ts → bed) */
export type VenueBed = 'none' | 'cookout' | 'mansion' | 'barbershop' | 'basement' | 'rooftop' | 'jazz' | 'casino' | 'beach' | 'kitchen' | 'yacht' | 'street' | 'rec' | 'porch';
export type MusicStatus = 'off' | 'loading' | 'playing' | 'error';

export interface Track { file: string; title: string; artist: string; license: string; source: string; /** exact attribution line (CC BY) */ credit?: string; /** story-score tracks: excluded from the general shuffle, reached only via the story mood (setStoryStop) */ storyOnly?: boolean; /** the menu theme: excluded from the general shuffle, reached only in menu context (pickNext) */ menuOnly?: boolean }
/** Background playlist (lazy-loaded, 128 kbps MP3). Credits: see CREDITS.md and the in-game Credits screen. */
export const TRACKS: Track[] = [
  { file: 'windows-down', title: 'Windows Down', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/lo-fi-and-chill-collection' },
  { file: 'coins', title: 'Coins', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/gamer-beats-collection' },
  { file: 'final-level', title: 'Final Level', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/gamer-beats-collection' },
  { file: '2-hour-delay', title: '2 Hour Delay', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/lo-fi-and-chill-collection' },
  { file: 'chillin-hard', title: 'Chillin Hard', artist: 'Kevin MacLeod', license: 'CC BY 4.0', source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600028', credit: '"Chillin Hard" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/' },
  { file: 'snow-drift', title: 'Snow Drift', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/lo-fi-and-chill-collection' },
  { file: 'glad-to-be-stuck-inside', title: 'Glad To Be Stuck Inside', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/lo-fi-and-chill-collection' },
  { file: 'pretty-little-lies', title: 'Pretty Little Lies', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/lo-fi-and-chill-collection' },
  { file: 'sunset-drive', title: 'Sunset Drive', artist: 'Tokyo Music Walker', license: 'CC BY 3.0', source: 'https://www.chosic.com/download-audio/59619/', credit: 'Sunset Drive by Tokyo Music Walker | https://soundcloud.com/user-356546060 Music promoted by https://www.chosic.com/free-music/all/ Creative Commons CC BY 3.0 https://creativecommons.org/licenses/by/3.0/' },
  { file: 'slowly', title: 'Slowly', artist: 'Tokyo Music Walker', license: 'CC BY 3.0', source: 'https://www.chosic.com/download-audio/59620/', credit: 'Slowly by Tokyo Music Walker | https://soundcloud.com/user-356546060 Music promoted by https://www.chosic.com/free-music/all/ Creative Commons CC BY 3.0 https://creativecommons.org/licenses/by/3.0/' },
  { file: 'memories-of-spring', title: 'Memories of Spring', artist: 'Tokyo Music Walker', license: 'CC BY 3.0', source: 'https://www.chosic.com/download-audio/45504/', credit: 'Memories of Spring by Tokyo Music Walker | https://soundcloud.com/user-356546060 Music promoted by https://www.chosic.com/free-music/all/ Creative Commons CC BY 3.0 https://creativecommons.org/licenses/by/3.0/' },
  { file: 'nighttime-stroll', title: 'Nighttime Stroll', artist: 'Artificial.Music', license: 'CC BY 3.0', source: 'https://www.chosic.com/download-audio/45334/', credit: 'Nighttime Stroll by Artificial.Music | https://soundcloud.com/artificial-music/ Music promoted by https://www.chosic.com/free-music/all/ Creative Commons CC BY 3.0 https://creativecommons.org/licenses/by/3.0/' },
  { file: 'late-at-night', title: 'Late at Night', artist: 'Sakura Girl', license: 'CC BY 3.0', source: 'https://www.chosic.com/download-audio/53612/', credit: 'Late at Night by Sakura Girl | https://soundcloud.com/sakuragirl_official Music promoted by https://www.chosic.com/free-music/all/ Creative Commons CC BY 3.0 https://creativecommons.org/licenses/by/3.0/' },
  { file: 'city', title: 'CITY (Lo-Fi Lounge Chill Hip Hop)', artist: 'Alex-Productions', license: 'CC BY 3.0', source: 'https://www.chosic.com/download-audio/30028/', credit: 'Lo-Fi Lounge Chill Hip Hop CITY by Alex-Productions | https://onsound.eu/ Music promoted by https://www.chosic.com/free-music/all/ Creative Commons CC BY 3.0 https://creativecommons.org/licenses/by/3.0/' },
  { file: 'new-hip-hop-beat', title: 'New Hip Hop Beat', artist: 'Vandalorum (Primal Light)', license: 'CC BY 4.0', source: 'https://opengameart.org/content/hiphop-old-school-chill-themes', credit: '"New Hip Hop Beat" by Vandalorum (Primal Light), https://opengameart.org/content/hiphop-old-school-chill-themes, licensed under CC BY 4.0 https://creativecommons.org/licenses/by/4.0/' },
  { file: 'pyro-flow', title: 'Pyro Flow', artist: 'Kevin MacLeod', license: 'CC BY 4.0', source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500039', credit: '"Pyro Flow" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/' },
  { file: 'slow-grind', title: 'Slow Grind', artist: 'Ron Gelinas Chillout Lounge', license: 'CC BY 3.0', source: 'https://www.chosic.com/download-audio/27292/', credit: 'Slow Grind by Ron Gelinas Chillout Lounge | https://soundcloud.com/atmospheric-music-portal Creative Commons Attribution 3.0 Unported License https://creativecommons.org/licenses/by/3.0/deed.en_US Music promoted by https://www.chosic.com/free-music/all/' },
  { file: 'marty-gots-a-plan', title: 'Marty Gots a Plan', artist: 'Kevin MacLeod', license: 'CC BY 4.0', source: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Marty%20Gots%20a%20Plan.mp3', credit: '"Marty Gots a Plan" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/' },
  // The game's own score (Story Mode pass, 2026-10-21): composed and rendered for Bid Wit Me —
  // original music, no samples, not CC material, so no attribution line. Story-only: the general
  // shuffle never picks them; story stops reach them via setStoryStop → storyMood.
  { file: 'story-theme', title: 'Riding Shotgun (Story Theme)', artist: 'Bid Wit Me', license: 'Original', source: '', storyOnly: true },
  { file: 'story-theme-sparse', title: 'Riding Shotgun — Slow (Sparse Theme)', artist: 'Bid Wit Me', license: 'Original', source: '', storyOnly: true },
  { file: 'story-danger', title: 'The Corner (Danger Bed)', artist: 'Bid Wit Me', license: 'Original', source: '', storyOnly: true },
  { file: 'story-king', title: 'The King of the Block', artist: 'Bid Wit Me', license: 'Original', source: '', storyOnly: true },
  // Sound sample (2026-10-23): the film-mix pilot. The Porch stop's own score
  // (storyOnly, reached via the 'porch' mood); Come On In is the menu theme (menuOnly,
  // reached only in menu context). Same in-house pipeline as the story score — original
  // compositions, synthesized and rendered for Bid Wit Me, no samples. Appended last so
  // every existing track index (host-music stamps) keeps its meaning.
  // Porch score revision (2026-10-23, owner ear verdict): the sample take "Porchlight"
  // (68 BPM, brushes only) read corny/sleepy — replaced in this same slot/file by
  // Porch Party, an upbeat old-school R&B groove (100 BPM, backbeat, walking bass)
  // from the same renderer. The film mix and its reactivity are unchanged.
  { file: 'porch-theme', title: 'Porch Party (Porch Theme)', artist: 'Bid Wit Me', license: 'Original', source: '', storyOnly: true },
  { file: 'menu-soul', title: 'Come On In (Menu Theme)', artist: 'Bid Wit Me', license: 'Original', source: '', menuOnly: true },
  // The Pj's rotation (owner, 2026-10-30): mid-to-late-90s rap instrumentals for the
  // night-street venue — Ketsa's soul-chop boom bap (CC BY 4.0, via Free Music Archive)
  // and HoliznaCC0's Busted Jazz (CC0). The venue pin in spatial.ts closes The Pj's to
  // these four, played at random; appended last so every existing track index (the
  // host-music stamps) keeps its meaning.
  { file: 'soul-epic', title: 'Soul Epic', artist: 'Ketsa', license: 'CC BY 4.0', source: 'https://freemusicarchive.org/music/Ketsa/cc-by-free-to-use-for-anything/soul-epic/', credit: '"Soul Epic" by Ketsa, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), via Free Music Archive.' },
  { file: 'overreach', title: 'Overreach', artist: 'Ketsa', license: 'CC BY 4.0', source: 'https://freemusicarchive.org/music/Ketsa/cc-by-free-to-use-for-anything/overreach/', credit: '"Overreach" by Ketsa, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), via Free Music Archive.' },
  { file: 'no-quit', title: 'No Quit', artist: 'Ketsa', license: 'CC BY 4.0', source: 'https://freemusicarchive.org/music/Ketsa/cc-by-free-to-use-for-anything/no-quit/', credit: '"No Quit" by Ketsa, CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), via Free Music Archive.' },
  { file: 'busted-jazz', title: 'Busted Jazz', artist: 'HoliznaCC0', license: 'CC0', source: 'https://freemusicarchive.org/music/holiznacc0/lo-fi-and-chill/busted-jazz/' },
  // Speakeasy Lounge rotation (owner picks, 2026-10-30): four Kevin MacLeod
  // noir/jazz tracks that play ONLY at the Speakeasy (the venue pin is a closed
  // list — see ROOM_STYLES in spatial.ts), exactly like The Pj's rotation above.
  // Spy Glass and Night on the Docks were banked from The Pj's audition; Dances
  // and Dames and Covert Affair were auditioned fresh for this venue.
  { file: 'spy-glass', title: 'Spy Glass', artist: 'Kevin MacLeod', license: 'CC BY 4.0', source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1500058', credit: '"Spy Glass" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/' },
  { file: 'night-on-the-docks-sax', title: 'Night on the Docks - Sax', artist: 'Kevin MacLeod', license: 'CC BY 4.0', source: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Night%20on%20the%20Docks%20-%20Sax.mp3', credit: '"Night on the Docks - Sax" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/' },
  { file: 'dances-and-dames', title: 'Dances and Dames', artist: 'Kevin MacLeod', license: 'CC BY 4.0', source: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Dances%20and%20Dames.mp3', credit: '"Dances and Dames" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/' },
  { file: 'covert-affair', title: 'Covert Affair', artist: 'Kevin MacLeod', license: 'CC BY 4.0', source: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Covert%20Affair.mp3', credit: '"Covert Affair" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/' },
];
/** Story mood → the score track that carries it (spatial.ts STORY_STOP_AUDIO picks the mood per stop). */
export const STORY_TRACK_FILE: Record<'theme' | 'sparse' | 'danger' | 'king' | 'porch', string> = { theme: 'story-theme', sparse: 'story-theme-sparse', danger: 'story-danger', king: 'story-king', porch: 'porch-theme' };
/** The story signature motif (D–F–A–C over Dm): the same four notes open the theme track and
 *  this sting; played at scene-in / stop clear / unlock so story mode sounds like one production. */
export const STORY_MOTIF_HZ = [587.33, 698.46, 880, 1046.5];

/* ---------- The film mix (sound sample, 2026-10-23) ----------
 * The Porch pilot for the sound revamp: the mix is mixed like a scene, not a playlist.
 * The SCORE (the music deck playing 'porch-theme') runs through a treatment stage in the
 * music chain (lowpass + gain); the BED is three layers on their own gain stages — room
 * tone / close human sounds / the outside world (buildBed 'porch'). A FilmTargets value
 * says where every stage sits; the engine rides the stages toward it. Values are
 * multipliers on each layer's built-in level (1 = as built). */
/** One film-mix state: score filter cutoff (Hz), score gain, and the three bed layers. */
export interface FilmTargets { scoreHz: number; scoreGain: number; tone: number; human: number; world: number }
/** Treatment fully open: every surface that is not the Porch sits here, byte-identical. */
export const FILM_NEUTRAL: FilmTargets = { scoreHz: 18000, scoreGain: 1, tone: 1, human: 1, world: 1 };
/** Bidding: the score thins to a dark whisper — the room carries the decision, not the music. */
export const FILM_BIDDING: FilmTargets = { scoreHz: 720, scoreGain: 0.38, tone: 1, human: 1.15, world: 0.9 };
/** A set lands: the score drops a register and ducks while the room reacts, then breathes back. */
export const FILM_SET_DIP: FilmTargets = { scoreHz: 380, scoreGain: 0.3, tone: 1, human: 1.6, world: 0.55 };
/** The nuke / mega: everything ducks — score, tone, people, street — under the blast. */
export const FILM_BLAST: FilmTargets = { scoreHz: 300, scoreGain: 0.25, tone: 0.2, human: 0.25, world: 0.15 };
/** The resting mix for a game phase at the Porch. Only bidding reshapes the scene; every
 *  other phase (playing, handOver, gameOver, scenes) breathes at the full mix. */
export function filmTargets(phase: string): FilmTargets { return phase === 'bidding' ? FILM_BIDDING : FILM_NEUTRAL; }
/** Exact attribution lines for the CC BY tracks (CREDITS.md + in-game Credits). */
export const CC_BY_LINES = TRACKS.filter((t) => t.credit).map((t) => t.credit!);
export const CC_BY_LINE = CC_BY_LINES[0]!;
const XFADE = 4; // seconds of crossfade between tracks
/** Dropout watchdog cadence: how often the engine verifies its stems are
 *  actually sounding (see watchdogTick). */
const WATCHDOG_MS = 2000;
/** A deck fetch that never settles (a connection silently reaped while the
 *  page was backgrounded) must fail like any other load error, not wedge the
 *  crossfade state machine forever. Generous enough for a slow network. */
const MUSIC_FETCH_TIMEOUT_MS = 20000;
/** Analyser RMS below this while a deck verifiably plays = digital silence:
 *  the graph is up, every flag says playing, and nothing is sounding. */
const OUTPUT_SILENCE_EPS = 0.0005;

/** Indices of the tracks the general shuffle may play — every track except the storyOnly score and the menuOnly menu theme. */
export function generalPool(): number[] { return TRACKS.map((t, i) => i).filter((i) => !TRACKS[i]!.storyOnly && !TRACKS[i]!.menuOnly); }

/** Shuffle order with no immediate repeat across bag boundaries. */
export function nextShuffle(prev: number | null, bag: number[], count: number, rnd = Math.random): { pick: number; bag: number[] } {
  let b = bag.slice();
  if (!b.length) {
    b = Array.from({ length: count }, (_, i) => i);
    for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [b[i], b[j]] = [b[j]!, b[i]!]; }
    if (count > 1 && b[0] === prev) b.push(b.shift()!);
  }
  const pick = b.shift()!;
  return { pick, bag: b };
}

/* ---------- cross-talk: two voices may share a moment ---------- */
/**
 * The recorded-voice channel was strictly serial: a new line cut the line
 * that was playing, every time. At a story table, where scripted beats and
 * chime-ins arrive on fixed 1.4–1.7 s staggers, anyone whose clip ran long
 * was cut mid-sentence by the next arrival. The owner's ask (the Porch,
 * 2026-10-22): "if Pat says something, Unc can start before she finishes
 * and they both continue at times." So a conversational line may START
 * over the tail of a different speaker's line: at most two voices at
 * once, the first ducked ≈ −6 dB while overlapped and restored if it
 * outlives the second. This pure function is the whole policy — who may
 * overlap whom, and how often — so the bounds pin in tests without an
 * AudioContext; the engine's startVoice only applies the plan. It began
 * as a story-surfaces opt-in; the owner widened it the same day ("I just
 * want the dry moments gone and for the game to feel live like a party")
 * — every conversational caller now opts in, and regular-table chatter
 * additionally DEFERS rather than cutting when the plan says replace
 * (see VOICE_DEFER_MAX_WAIT_S). Callers that never opt in (announcement-
 * class playback through playVoice) keep the serial behaviour exactly.
 */
/** A playing line may be talked over only while this much of it (seconds) is left — the overlap is its tail, never its body. */
export const VOICE_MAX_OVERLAP_REMAINING_S = 3;
/** Deeper than this into the tail, an overlap is the natural read (people answer as a line lands). */
export const VOICE_TAIL_S = 1.2;
/** The ducked line's gain multiplier while overlapped: 0.5 ≈ −6 dB. */
export const VOICE_DUCK_FACTOR = 0.5;

export interface ActiveVoiceInfo { speaker: string | null; remainingS: number; elapsedS: number }
export type VoiceArrivalPlan = { kind: 'play' } | { kind: 'replace' } | { kind: 'overlap'; keepIndex: number };

/**
 * Decide what an arriving cross-talk-eligible line does to the voices
 * already playing. `roll` is the caller's die (0..1) so the choice varies
 * like people do instead of landing metronomically; most arrivals still
 * play solo (an empty room, a same-speaker cut, or a lost roll all leave
 * exactly one voice talking).
 */
export function planVoiceArrival(active: ActiveVoiceInfo[], speaker: string, roll: number): VoiceArrivalPlan {
  if (!active.length) return { kind: 'play' };
  // Never overlap a speaker with their own next line: it cuts, as always.
  if (active.some((a) => a.speaker !== null && a.speaker === speaker)) return { kind: 'replace' };
  const newest = active[active.length - 1]!;
  // Only over the tail: little left, and the line genuinely under way (two
  // arrivals in the same breath are a cut, not a chord). With two voices
  // already up, an approved overlap keeps the newest and lets the oldest
  // go — the count never reaches three.
  if (newest.elapsedS >= 0.4 && newest.remainingS <= VOICE_MAX_OVERLAP_REMAINING_S) {
    const p = newest.remainingS <= VOICE_TAIL_S ? 0.85 : 0.5;
    if (roll < p) return { kind: 'overlap', keepIndex: active.length - 1 };
  }
  return { kind: 'replace' };
}

/**
 * Deferral bound for no-cut chatter (owner, bot games 2026-10-22: lines
 * "cut off mid sentence" at regular tables too): when the plan says
 * replace but the caller is deferrable chatter, the arrival WAITS for
 * the room to clear instead of cutting the playing line — but only
 * while the wait is short. A line that would land more than this many
 * seconds after its moment is stale (the trick it answered is gone), so
 * it drops: chat text already showed it, the voice just never starts.
 * The bound matches the overlap tail window: a line with more than this
 * left is all body, no tail — the same line the overlap policy refuses
 * to talk over is the line a waiter refuses to outwait.
 */
export const VOICE_DEFER_MAX_WAIT_S = 3;

/** How long (seconds) until the room is empty: the last live line's end. */
export function voiceRoomWaitS(active: ActiveVoiceInfo[]): number {
  return active.reduce((max, a) => Math.max(max, a.remainingS), 0);
}

/** One live recorded-voice line in the engine (see the voice section of SoundEngine). */
interface VoiceSlot {
  src: AudioBufferSourceNode;
  gain: GainNode;
  speaker: string | null;
  /** The gain the line started at (post category volume); a duck returns here. */
  baseGain: number;
  startedAt: number;
  endsAt: number;
  /** The slot this line ducked when it overlapped in (restored when this line ends). */
  ducked: VoiceSlot | null;
  /** The slot currently ducking this one — the identity guard on the restore. */
  duckedBy: VoiceSlot | null;
}

function load(): SoundSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = { ...DEFAULTS, ...JSON.parse(raw) } as SoundSettings & Record<string, unknown>;
      // Retired menu ambience scenes (see SoundSettings note): strip their
      // flags and any recorded menu scene pick, so a saved preference for one
      // falls back gracefully — menus get no background scene (or the player's
      // explicit menu music choice), in-venue sound still follows the room.
      for (const k of ['kitchenTable', 'blockParty', 'frontPorch', 'beautySalon', 'parkDominoes', 'menuAmbience']) delete saved[k];
      // Retired soundscape pick (see SoundSettings note): a saved room override simply
      // stops affecting playback — the venue's signature sounds now decide, always.
      delete saved['soundscape'];
      if (saved.scenes && (saved.scenes as { menu?: string }).menu === 'ambience') saved.scenes = { ...(saved.scenes as object), menu: undefined };
      return settingsForContext(saved as SoundSettings, 'menu');
    }
  } catch { /* ignore */ }
  return settingsForContext(DEFAULTS, 'menu');
}

const FILES: Record<string, string[]> = {
  shuffle: ['shuffle'], deal: ['deal-1', 'deal-2', 'deal-3'], play: ['play-1', 'play-2', 'play-3'],
  sweep: ['sweep-1', 'sweep-2'], bid: ['bid'], tap: ['tap'], pop: ['pop'],
  // RIP-sheet wail. Same fetch/decode path as the card foley, so warmEffects has it before the first sheet.
  siren: ['siren'],
  // Spray-paint transition: a real can's rattle-ball shake + aerosol hiss (CREDITS.md).
  // Same fetch/decode path, so warmEffects has both decoded before the first spray.
  'spray-shake': ['spray-shake'], 'spray-hiss': ['spray-hiss'],
};
/** Total one-shot SFX buffers a complete load() decodes (the watchdog's readiness bar). */
const SFX_COUNT = Object.values(FILES).reduce((n, a) => n + a.length, 0);

type Ctx = AudioContext;
const AC: typeof AudioContext | undefined = typeof window !== 'undefined'
  ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  : undefined;

interface Deck { el: HTMLAudioElement; gain: GainNode; track: number | null; ready: Promise<boolean> | null; url: string | null; loading?: boolean }

/* ---------- The Pj's recorded night street (owner, 2026-10-30) ----------
 * The street bed is a real recording now: a 64 s seamless loop of CC0 city
 * recordings (SSE Library — CREDITS.md), with distant voices and car pass-bys
 * from the same sessions as scheduled one-shot events over it. */
const PJS_BED_URL = '/audio/ambience/pjs-night-street.mp3';
const PJS_EVENT_URLS = {
  voice: ['/audio/ambience/pjs-event-voice-1.mp3', '/audio/ambience/pjs-event-voice-2.mp3', '/audio/ambience/pjs-event-voice-3.mp3'],
  car: ['/audio/ambience/pjs-event-car-1.mp3', '/audio/ambience/pjs-event-car-2.mp3', '/audio/ambience/pjs-event-car-3.mp3'],
} as const;
/** Car variant weights (far / CLOSE / medium-far): the close pass is the loud one —
 *  the owner density has it at roughly one pick in four. */
const PJS_CAR_WEIGHTS: readonly number[] = [0.375, 0.25, 0.375];
/** Event staging gain: the bed file is the −16 LUFS master; the event clips keep
 *  their premaster staging, so they play through this gain to hold the approved
 *  demo balance (the loudnorm raised the bed +7.42 dB over its premaster — measured
 *  RMS on the shipped files). The ratios inside the files (voices under the bed,
 *  cars over it by variant) are the design; this only re-aligns the two masters. */
const PJS_EVENT_GAIN = 2.35;
/** The bed's MP3 loop trim, from the shipped file's own LAME offsets: 1105 samples
 *  of encoder delay at 44.1 kHz ahead of exactly 64.000 s of content (47 samples of
 *  end padding behind it). Applied in the time domain so it holds at any context
 *  sample rate; trimming there reproduces the sample's measured seam (wrap step
 *  0.043, below the material's own frame-step noise). */
const PJS_BED_LEAD_S = 1105 / 44100;
const PJS_BED_SECONDS = 64;
/** The Speakeasy's recorded bed (owner sample pick, 2026-10-30): a 64.000 s
 *  seamless loop of lounge recordings (SSE Library — CREDITS.md): café walla,
 *  men's murmur kept unintelligible under an 850 Hz low-pass, dishes and saloon
 *  chatter, with Kevin MacLeod's "George Street Shuffle" low-passed at 420 Hz
 *  baked in as the band through the wall. Glass clinks, a laugh swell and the
 *  wooden front door ride over it as scheduled one-shot events. */
const SPK_BED_URL = '/audio/ambience/speakeasy-bed.mp3';
const SPK_EVENT_URLS = {
  glass: ['/audio/ambience/speakeasy-event-glass.mp3'],
  laugh: ['/audio/ambience/speakeasy-event-laugh.mp3'],
  door: ['/audio/ambience/speakeasy-event-door.mp3'],
} as const;
/** Event staging gain, same construction as PJS_EVENT_GAIN: the bed file is the
 *  −16 LUFS master; the event clips keep their premaster staging, so they play
 *  through this gain to hold the approved demo balance (the loudnorm raised the
 *  bed +7.84 dB over its premaster — measured RMS on the shipped files). */
const SPK_EVENT_GAIN = 2.46;
/** The bed's MP3 loop trim, from the shipped file's own measured offsets: 1105
 *  samples of encoder delay at 44.1 kHz ahead of exactly 64.000 s of content
 *  (1199 samples of end padding behind it) — same encoder settings as The Pj's
 *  bed. Cross-checked: a gapless-aware decode lands exactly 64.000 s at lag 0
 *  against the premaster, and the sample's measured seam step (0.0046) sits far
 *  below the material's own frame-step noise (p99 0.0538). */
const SPK_BED_LEAD_S = 1105 / 44100;
const SPK_BED_SECONDS = 64;
/** Trim a decoded MP3 loop to its true content — [encoder delay][content][padding]
 *  → content only — so buffer looping is seamless. Returns the buffer untouched
 *  when it is already the content length (a gapless-aware decoder) or too short. */
function trimLoopBuffer(ctx: AudioContext, buf: AudioBuffer, leadS: number, seconds: number): AudioBuffer {
  const start = Math.round(leadS * buf.sampleRate);
  const len = Math.round(seconds * buf.sampleRate);
  if (start <= 0 || buf.length < start + len) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(start, start + len), ch);
  return out;
}

class Engine {
  settings: SoundSettings = load();
  private listeners = new Set<() => void>();
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  /** Recorded-ambience decode cache (the Pj's street bed + its event one-shots),
   *  keyed to the live context: a rebuild invalidates it — the files re-decode
   *  from the HTTP cache — instead of float-copying a 64 s stereo bed through
   *  the sfx buffer map's heal path. In-flight decodes are keyed by context
   *  too, so a rebuild mid-decode never hands the new bed a dead promise. */
  private ambCache: { ctx: Ctx; map: Map<string, AudioBuffer> } | null = null;
  private ambLoading = new Map<string, { ctx: Ctx; p: Promise<AudioBuffer | null> }>();
  /** Live spray-transition hiss (looping source + its gain) while a cover runs. */
  private sprayNodes: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** Noise the shot, sheet, and tornado build on first play. Keyed by duration in milliseconds. */
  private noiseBank = new Map<number, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private ambTimer: number | null = null;
  private ambNodes: AudioNode[] = [];
  private lastAt = new Map<Sfx, number>();
  unlocked = false;
  /**
   * Automated checks (Playwright): pretend iOS reported this AudioContext.state.
   * 'interrupted' / 'closed' rebuild the context. A stuck 'suspended' leaves the header speaker in its needs-tap state.
   * Null uses the real state.
   */
  testState: string | null = null;
  needsRestore = false;
  private unlockInstalled = false;
  private recreating = false;
  private wakeGen = 0;
  /** Last context rebuild (performance.now ms): rebuilds are rate-limited while an interruption persists. */
  private lastRecreateAt = 0;
  /** Self-heal retry timer: runs only while a restore is pending (see publishRestore). */
  private healTimer: number | null = null;
  /** Dropout watchdog: verifies stems against ground truth while sound is
   *  wanted (see watchdogTick). Runs for the life of the first unlock. */
  private watchdogTimer: number | null = null;
  /** Output meter on the master bus (master → analyser → compressor). The
   *  only witness that can catch a graph that reads 'running' but is silent. */
  private analyser: AnalyserNode | null = null;
  /** One-shot post-wake silence verification (see armVerify). */
  private verifyTimer: number | null = null;
  private silenceTicks = 0;
  private stemMissTicks = 0;
  private deckStallTicks = 0;
  private lastDeckPos = -1;
  private lastSfxRetryAt = 0;
  private lastErrorRetryAt = 0;
  private loadGen = 0;
  /** cue counter (exposed for automated checks) */
  played: Record<string, number> = {};
  /** Game sounds refused because no table was on screen (test probe). */
  blocked: Record<string, number> = {};

  /* ---------- settings store ---------- */
  /** Current context (boots in menus). Explicit toggle choices are remembered per context. */
  private context: SoundContext = 'menu';
  /** False while applying a context scene or mute-all, so programmatic changes are not
   *  mistaken for an explicit per-context choice. */
  private captureScene = true;
  get soundContext(): SoundContext { return this.context; }
  /**
   * Enter a context (menus or a game): run its explicit saved scene, or the context default
   * (menus: no background scene; game: music on / ambience off). Applying a default does
   * NOT record an explicit choice, so defaults keep working until the player picks in person.
   */
  enterContext(ctx: SoundContext) {
    this.context = ctx;
    // Leaving the table for the menus clears the venue audio identity with it: the last
    // venue's music pin / lean must not bleed into menu music (the bed already stops via
    // the table's own cleanup). The next table applies its identity fresh.
    if (ctx === 'menu') { this.roomStyle = null; this.leanArmed = false; }
    if (ctx === 'menu') { this.storyMood = null; this.storyBedOverride = null; this.refreshFilm(); } // story score never bleeds into menus either
    const t = settingsForContext(this.settings, ctx);
    this.captureScene = false;
    try { this.set({ music: t.music, ambient: t.ambient, venueSound: t.venueSound }); } finally { this.captureScene = true; }
    this.emit();
    // The context IS a music identity (menus own the menu theme; a table owns its
    // room's). A track carried over from the previous context must not play out
    // its remaining minutes here — reconcile the decks against the new identity.
    this.queueContextRetarget();
  }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get = () => this.settings;
  get state(): string { return this.ctx?.state ?? 'none'; }
  get loaded(): number { return this.buffers.size; }
  set(patch: Partial<SoundSettings>) {
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const next: SoundSettings = { ...this.settings, ...patch, volume: clamp(patch.volume ?? this.settings.volume), musicVolume: clamp(patch.musicVolume ?? this.settings.musicVolume) };
    // Music and ambience are independent (Demetrius 2026-10-19): each switch only
    // controls its own source, so no reconciliation is needed here.
    // A deliberate toggle in this context is that context's explicit choice: remember the
    // resulting scene for this context only (the other context keeps its own choice/default).
    if (this.captureScene && !('scenes' in patch) && ('music' in patch || 'ambient' in patch || 'venueSound' in patch)) {
      const sc: SoundScene = sceneOf(next);
      this.settings = { ...next, scenes: { ...next.scenes, [this.context]: sc } };
    } else {
      this.settings = next;
    }
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    this.applyGain();
    this.syncAmbient();
    this.syncVenue();
    this.syncMusic();
    this.emit();
  }
  /** Everything off at once (long-press / double-tap on the speaker); calling again restores what was on. */
  private beforeMute: Pick<SoundSettings, 'on' | 'music' | 'ambient'> | null = null;
  get allMuted(): boolean { return !this.settings.on && !this.settings.music; }
  toggleMuteAll(): boolean {
    this.captureScene = false;
    try {
      if (!this.allMuted) {
        this.beforeMute = { on: this.settings.on, music: this.settings.music, ambient: this.settings.ambient };
        this.set({ on: false, music: false, ambient: false });
        return true;
      }
      const b = this.beforeMute ?? { on: true, music: false, ambient: this.settings.ambient };
      this.beforeMute = null;
      this.set({ on: b.on || !b.music, music: b.music, ambient: b.ambient });
      return false;
    } finally { this.captureScene = true; }
  }
  private emit() { this.snapshot = { ...this.settings, musicStatus: this.musicStatus, nowPlaying: this.nowPlaying, needsRestore: this.needsRestore, soundContext: this.context }; this.listeners.forEach((f) => f()); }
  snapshot: SoundSettings & { musicStatus: MusicStatus; nowPlaying: { track: Track; at: number } | null; needsRestore: boolean; soundContext: SoundContext } = { ...this.settings, musicStatus: 'off', nowPlaying: null, needsRestore: false, soundContext: 'menu' };
  getSnapshot = () => this.snapshot;

  /* ---------- music: shuffled playlist with crossfade + gentle mid/side widening ---------- */
  musicStatus: MusicStatus = 'off';
  /** Phase 6 tension layer: a synthesized pad under the music decks, gain from the game's tension. */
  private tensionGain: GainNode | null = null;
  private tensionOsc: OscillatorNode[] = [];
  tensionLevel = 0;
  setMusicTension(v: number) {
    const lvl = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    this.tensionLevel = lvl;
    if (typeof window !== 'undefined') (window as unknown as { __bwmTension?: unknown }).__bwmTension = { level: lvl, audible: !!(this.ctx && this.tensionGain) };
    this.applyTension();
  }
  private applyTension() {
    const c = this.ctx; if (!c || !this.musicBus) return;
    const want = this.settings.music && this.musicStatus === 'playing' ? Math.pow(this.tensionLevel, 1.6) * 0.13 : 0;
    if (want > 0 && !this.tensionGain) {
      try {
        const g = c.createGain(); g.gain.value = 0;
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
        const o1 = c.createOscillator(); o1.type = 'sine'; o1.frequency.value = 110;
        const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 164.8;
        const o3 = c.createOscillator(); o3.type = 'triangle'; o3.frequency.value = 220.5;
        const g3 = c.createGain(); g3.gain.value = 0.35;
        o1.connect(f); o2.connect(f); o3.connect(g3); g3.connect(f); f.connect(g); g.connect(this.musicBus);
        o1.start(); o2.start(); o3.start();
        this.tensionGain = g; this.tensionOsc = [o1, o2, o3];
      } catch { return; }
    }
    if (this.tensionGain) this.tensionGain.gain.setTargetAtTime(want, c.currentTime, 1.4);
  }
  /** Music switched off: the tension pad must die NOW (no 1.4s linger) — fast ramp, stop + free the oscillators. */
  private stopTensionPad() {
    const c = this.ctx, g = this.tensionGain, oscs = this.tensionOsc;
    this.tensionGain = null; this.tensionOsc = [];
    if (typeof window !== 'undefined') (window as unknown as { __bwmTension?: unknown }).__bwmTension = { level: this.tensionLevel, audible: false };
    if (!c || !g) return;
    try {
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setTargetAtTime(0, c.currentTime, 0.05);
      window.setTimeout(() => { for (const o of oscs) { try { o.stop(); } catch { /* already stopped */ } } try { g.disconnect(); } catch { /* gone */ } }, 350);
    } catch { /* context closed */ }
  }
  nowPlaying: { track: Track; at: number } | null = null;
  private decks: Deck[] = [];
  private active = 0;
  /** shuffle bag of POSITIONS in the general pool (see generalPool) */
  private bag: number[] = [];
  private poolPos: number | null = null;
  private lastTrack: number | null = null;
  /** Story score state (setStoryStop): the active stop's mood + its bed override, if any. */
  storyMood: StoryMood | null = null;
  private storyBedOverride: VenueBed | null = null;
  private themeTurn = false;
  /** Film mix state (sound sample): the score-treatment stage in the music chain, the
   *  Porch bed's layer gains, and the last phase Table reported. All inert — treatment
   *  open, layers at unity — unless storyMood === 'porch'. */
  private filmFilter: BiquadFilterNode | null = null;
  private filmGain: GainNode | null = null;
  private filmLayers: { tone: GainNode; human: GainNode; world: GainNode } | null = null;
  private filmPhase = 'playing';
  private filmSeq = 0;
  private filmTimer: number | null = null;
  /** the current venue's music lean is armed: the next pick is one of its signature tracks */
  private leanArmed = false;
  private musicBus: GainNode | null = null;
  /** ducking stages (the nuke's tinnitus moment): music and regular SFX dip, the nuke itself rides on nukeBus */
  private musicDuck: GainNode | null = null;
  private sfxDuck: GainNode | null = null;
  private nukeBus: GainNode | null = null;
  private fading = false;
  /** One crossfade at a time: a second advance (an 'ended' racing the fade) would flip back and play two tracks. */
  private advancing = false;
  /** Context-retarget coalescing (see queueContextRetarget): a burst of identity
   *  mutations in one synchronous commit collapses into a single reconciliation,
   *  and a reconciliation that finds a crossfade in flight defers on this timer
   *  instead of fighting it. */
  private retargetQueued = false;
  private retargetTimer: number | null = null;
  /** Test probe: decks actually audible right now (not paused, gain up). Must never exceed 2, and is 1 outside a crossfade. */
  playingDeckCount(): number { return this.decks.filter((d) => d.url && !d.el.paused && d.gain.gain.value > 0.01 && !this.deckDead(d)).length; }

  /** Mono-compatible widening: M/S with the side (above 150 Hz) boosted and slowly "breathing". L+R is unchanged. */
  private buildMusicChain(): GainNode {
    const c = this.ctx!;
    const input = c.createGain();
    // Film mix score-treatment stage (sound sample): every deck runs through this
    // lowpass + gain before the widening chain. The film controller rides it at the
    // Porch; everywhere else it sits fully open (18 kHz / unity), so no other surface's
    // sound changes. Rebuilt with the chain on a context rebuild — applyFilmMix at the
    // end of this method re-applies the current film state to the fresh nodes.
    this.filmFilter = c.createBiquadFilter(); this.filmFilter.type = 'lowpass'; this.filmFilter.frequency.value = 18000; this.filmFilter.Q.value = 0.4;
    this.filmGain = c.createGain();
    input.connect(this.filmFilter).connect(this.filmGain);
    const split = c.createChannelSplitter(2);
    this.filmGain.connect(split);
    const mid = c.createGain(); const side = c.createGain();
    const lM = c.createGain(); lM.gain.value = 0.5; const rM = c.createGain(); rM.gain.value = 0.5;
    const lS = c.createGain(); lS.gain.value = 0.5; const rS = c.createGain(); rS.gain.value = -0.5;
    split.connect(lM, 0); split.connect(rM, 1); split.connect(lS, 0); split.connect(rS, 1);
    lM.connect(mid); rM.connect(mid); lS.connect(side); rS.connect(side);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 150; // keep the low end centred
    const width = c.createGain(); width.gain.value = 1.35;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.045; const lfoAmt = c.createGain(); lfoAmt.gain.value = 0.15;
    lfo.connect(lfoAmt).connect(width.gain); lfo.start();
    side.connect(hp).connect(width);
    const negSide = c.createGain(); negSide.gain.value = -1; width.connect(negSide);
    const merge = c.createChannelMerger(2);
    const outL = c.createGain(); const outR = c.createGain();
    mid.connect(outL); width.connect(outL); mid.connect(outR); negSide.connect(outR);
    outL.connect(merge, 0, 0); outR.connect(merge, 0, 1);
    const bus = c.createGain();
    this.musicDuck = c.createGain();
    merge.connect(bus).connect(this.musicDuck).connect(c.destination);
    this.musicBus = bus;
    this.applyFilmMix();
    return input;
  }

  private ensureDecks() {
    if (this.decks.length || !this.ctx) return;
    const pool = audioElementPool();
    const a = pool.acquire();
    const b = pool.acquire();
    if (!a || !b) {
      if (a) pool.release(a);
      if (b) pool.release(b);
      return;
    }
    const chain = this.buildMusicChain();
    for (const el of [a, b]) {
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      this.ctx.createMediaElementSource(el).connect(gain).connect(chain);
      const deck: Deck = { el, gain, track: null, ready: null, url: null };
      el.addEventListener('timeupdate', () => this.onTime(deck));
      el.addEventListener('ended', () => { if (deck.url && this.decks[this.active] === deck && !this.fading) { this.fading = true; void this.advance(); } });
      el.addEventListener('playing', () => { if (deck.url && this.decks[this.active] === deck && this.musicStatus !== 'playing') { this.musicStatus = 'playing'; this.emit(); this.applyTension(); } });
      // A media error on the sounding deck (decode failure, resource torn
      // down by the OS) used to be invisible: no listener, no reload, the
      // status kept reading 'playing'. Reconcile — syncMusic reloads a dead
      // deck instead of play()ing its corpse.
      el.addEventListener('error', () => { if (this.decks[this.active] === deck && wantsMusic(this.settings)) this.syncMusic(); });
      this.decks.push(deck);
    }
  }

  /** Music elements are bound to this context. Free their decoder slots; a new context gets new elements. */
  private releaseDecks() {
    this.advancing = false;
    const pool = audioElementPool();
    for (const d of this.decks) {
      if (d.url) { try { URL.revokeObjectURL(d.url); } catch { /* already revoked */ } d.url = null; }
      pool.retire(d.el);
    }
    this.decks = [];
    this.fading = false;
    this.active = 0;
  }

  /** iOS: an <audio> element must first be played inside a user gesture; prime both decks with a silent blip. */
  private primeDecks() {
    for (const d of this.decks) {
      if (d.url) continue;
      d.el.src = '/assets/sfx/tap.mp3';
      void d.el.play().then(() => d.el.pause()).catch(() => undefined);
    }
  }

  /**
   * Fetch the whole track and play it from a blob: URL — seeking/looping never depends on the host's HTTP Range
   * support (Safari needs ranges for streamed media), and the next track is fully buffered before its crossfade.
   */
  private loadDeck(deckIdx: number, track: number): Promise<boolean> {
    const d = this.decks[deckIdx]!;
    d.track = track;
    d.loading = true;
    d.ready = (async () => {
      // The fetch is timeout-guarded: a connection silently reaped while the
      // page was backgrounded can leave a fetch pending FOREVER, and an
      // unsettled ready latches advance()'s advancing/fading flags — the
      // playing track ends, its 'ended' is suppressed by the latched fade,
      // and the music dies with every status still reading 'playing'
      // (reproduced 2026-10-30). A timeout turns the hang into the ordinary
      // load-failure path, which retries other tracks and recovers.
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const killer = ctl ? window.setTimeout(() => ctl.abort(), MUSIC_FETCH_TIMEOUT_MS) : null;
      try {
        const res = await fetch(`/audio/music/${TRACKS[track]!.file}.mp3`, ctl ? { signal: ctl.signal } : undefined);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (d.track !== track) return false;
        if (d.url) URL.revokeObjectURL(d.url);
        d.url = URL.createObjectURL(blob);
        d.el.src = d.url;
        d.el.load();
        return true;
      } catch {
        return false;
      } finally {
        if (killer !== null) window.clearTimeout(killer);
        d.loading = false;
      }
    })();
    return d.ready;
  }

  /**
   * Does a loaded track BELONG to the music identity in force right now? This
   * mirrors pickNext()'s precedence exactly — whatever the picker could return
   * in the current state is in-context; anything else is a carry-over from a
   * previous context (a menu theme sounding at a table, a venue track riding
   * into the menus, a foreign look-ahead parked inside The Pj's closed
   * rotation). The two must never disagree: if pickNext can return it here,
   * it belongs here.
   */
  private trackInContext(track: number | null): boolean {
    if (track === null) return true; // nothing loaded: the next pick is made fresh, in-context
    const file = TRACKS[track]?.file;
    if (!file) return false;
    // Story moods that pin a single score track (pickNext's first branch).
    if (this.storyMood === 'danger' || this.storyMood === 'king' || this.storyMood === 'sparse' || this.storyMood === 'porch') {
      return file === STORY_TRACK_FILE[this.storyMood];
    }
    // The theme mood alternates its track with the fall-through rotation below.
    if (this.storyMood === 'theme' && file === STORY_TRACK_FILE.theme) return true;
    // A venue pin is a closed set (single track, or The Pj's rotation list):
    // while it stands, only its own tracks belong — the pool is never reached.
    const music = this.roomStyle?.music;
    if (music?.pin) {
      const files = Array.isArray(music.pin) ? music.pin : [music.pin];
      if (files.some((f) => TRACKS.some((t) => t.file === f))) return files.includes(file);
    }
    // Menus have one signature: the menu theme, and nothing else.
    if (this.context === 'menu') return file === 'menu-soul';
    // Everywhere else the general shuffle is the identity, plus the venue's
    // own signature (lean) tracks, which pickNext can also return here.
    if (generalPool().includes(track)) return true;
    if (music && music.lean.includes(file)) return true;
    return false;
  }

  private pickNext(): number {
    // Story score first (Story Mode pass): a story stop's mood outranks the venue identity —
    // danger stops loop the danger bed, the King loops his arrangement, and everywhere else in
    // story mode the theme alternates with the normal rotation so the mode has a signature
    // sound without playing one track to death.
    if (this.storyMood === 'danger' || this.storyMood === 'king' || this.storyMood === 'sparse' || this.storyMood === 'porch') {
      const idx = TRACKS.findIndex((t) => t.file === STORY_TRACK_FILE[this.storyMood!]);
      if (idx >= 0) return idx;
    }
    if (this.storyMood === 'theme') {
      this.themeTurn = !this.themeTurn;
      if (this.themeTurn) {
        const idx = TRACKS.findIndex((t) => t.file === STORY_TRACK_FILE.theme);
        if (idx >= 0 && idx !== this.lastTrack) { this.lastTrack = idx; return idx; }
      }
    }
    // Venue audio identity (spatial.ts ROOM_STYLES — the one definition of how a venue
    // sounds): a venue may PIN its music — the pin lives in the identity, not a hardcoded
    // venue check here. A single-file pin plays that track every pick (Phase 4: The Pj's
    // always played "Marty Gots a Plan", Demetrius 2026-10-19). A pin LIST is a closed
    // rotation: the picks stay inside the venue's own tracks, at random with no immediate
    // repeat, and the general pool below is never reached (owner, 2026-10-30: The Pj's
    // four tracks "play randomly in the venue" — the single-track eternity was the defect).
    const music = this.roomStyle?.music;
    if (music?.pin) {
      const files = Array.isArray(music.pin) ? music.pin : [music.pin];
      const idxs = files.map((f) => TRACKS.findIndex((t) => t.file === f)).filter((i) => i >= 0);
      if (idxs.length) {
        const fresh = idxs.filter((i) => i !== this.lastTrack);
        const from = fresh.length ? fresh : idxs;
        const pick = from[Math.floor(Math.random() * from.length)]!;
        this.lastTrack = pick;
        return pick;
      }
    }
    // …or LEAN: the first pick after a venue is applied comes from its signature tracks,
    // so walking into a venue sounds like that venue; the global shuffle resumes after.
    if (this.leanArmed && music && music.lean.length) {
      this.leanArmed = false;
      const idxs = music.lean.map((f) => TRACKS.findIndex((t) => t.file === f)).filter((i) => i >= 0 && i !== this.lastTrack);
      if (idxs.length) { const pick = idxs[Math.floor(Math.random() * idxs.length)]!; this.lastTrack = pick; return pick; }
    }
    // Menu theme (sound sample, 2026-10-23): menus have ONE signature — the original soul
    // instrumental — instead of a draw from the general pool. Only menu context reaches
    // this branch; at a table the context is 'game', and the track is menuOnly so the
    // shuffle below can never pick it either. Like the looping story moods, returning the
    // same index every pick makes the decks crossfade the track into itself.
    if (this.context === 'menu') {
      const idx = TRACKS.findIndex((t) => t.file === 'menu-soul');
      if (idx >= 0) return idx;
    }
    // General shuffle — over the general pool only: story-score tracks are storyOnly and
    // never drift into menus or normal games. The bag holds positions in the pool.
    const pool = generalPool();
    const { pick, bag } = nextShuffle(this.poolPos, this.bag, pool.length);
    this.bag = bag; this.poolPos = pick;
    const idx = pool[pick]!;
    this.lastTrack = idx;
    return idx;
  }

  /** Crossfade to the pre-loaded deck, then queue the following track on the deck that just faded out. */
  private async advance() {
    if (this.advancing) return; // a crossfade is already running: never start a second one
    if (!this.ctx || !this.settings.music) { this.fading = false; return; }
    this.advancing = true;
    const c = this.ctx;
    const fromIdx = this.active, toIdx = 1 - this.active;
    const from = this.decks[fromIdx]!, to = this.decks[toIdx]!;
    if (to.track === null || !to.ready) this.loadDeck(toIdx, this.pickNext());
    let ok = await to.ready!;
    for (let tries = 0; !ok && tries < TRACKS.length; tries++) ok = await this.loadDeck(toIdx, this.pickNext());
    if (!ok || !this.settings.music) { this.musicStatus = 'error'; this.fading = false; this.advancing = false; this.emit(); return; }
    const now = c.currentTime;
    to.gain.gain.cancelScheduledValues(now); to.gain.gain.setValueAtTime(0.0001, now); to.gain.gain.linearRampToValueAtTime(1, now + XFADE);
    from.gain.gain.cancelScheduledValues(now); from.gain.gain.setValueAtTime(Math.max(0.0001, from.gain.gain.value), now); from.gain.gain.linearRampToValueAtTime(0.0001, now + XFADE);
    to.el.currentTime = 0;
    void to.el.play().catch(() => undefined);
    this.active = toIdx;
    this.announce(to.track!);
    window.setTimeout(() => {
      from.el.pause();
      from.track = null; from.ready = null;
      this.fading = false;
      this.advancing = false;
      if (this.settings.music) this.loadDeck(fromIdx, this.pickNext()); // look-ahead
    }, XFADE * 1000 + 150);
  }

  private onTime(deck: Deck) {
    if (!deck.url || this.decks[this.active] !== deck || this.fading || !this.settings.music) return;
    const left = deck.el.duration - deck.el.currentTime;
    if (Number.isFinite(left) && left <= XFADE + 0.25) { this.fading = true; void this.advance(); }
  }

  private announce(track: number) {
    this.nowPlaying = { track: TRACKS[track]!, at: Date.now() };
    this.emit();
  }

  private syncMusic() {
    if (!this.unlocked) return;
    this.ensure();
    if (!this.ctx) return;
    if (!wantsMusic(this.settings)) {
      this.stopTensionPad();
      if (this.decks.length) {
        for (const d of this.decks) { d.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25); }
        window.setTimeout(() => { if (!wantsMusic(this.settings)) this.decks.forEach((d) => d.el.pause()); }, 1200);
      }
      if (this.musicStatus !== 'off') { this.musicStatus = 'off'; this.emit(); }
      return;
    }
    this.ensureDecks();
    if (!this.decks.length || !this.musicBus) return;
    this.musicBus.gain.setTargetAtTime(this.settings.musicVolume ** 1.6 * 0.85, this.ctx.currentTime, 0.1);
    const cur = this.decks[this.active]!;
    if (cur.track !== null && !this.deckLoading(cur) && (this.deckDead(cur) || !cur.url)) {
      // The sounding deck lost its resource (OS media teardown, dead blob,
      // decode error) or a previous start failed outright. play() on such an
      // element flips paused=false with no data behind it — a phantom
      // 'playing' that IS the dropout bug wearing a healthy status. Reload
      // the track for real instead of re-asserting the lie.
      void this.restartDeck(this.active);
      return;
    }
    if (this.deckLoading(cur)) {
      // A start / restart / crossfade load owns this deck right now; its
      // completion plays it or reports the error. Syncing here could only
      // play() an element with no source yet — the phantom again.
      return;
    }
    if (cur.track === null) {
      // first start happens inside the user's tap: prime both decks for iOS, then fetch + play
      this.primeDecks();
      this.musicStatus = 'loading'; this.emit();
      const startIdx = this.active;
      void (async () => {
        let ok = await this.loadDeck(startIdx, this.pickNext());
        for (let tries = 0; !ok && tries < TRACKS.length; tries++) ok = await this.loadDeck(startIdx, this.pickNext());
        if (!this.ctx || !this.settings.music || this.active !== startIdx) return;
        if (!ok) { this.musicStatus = 'error'; this.emit(); return; }
        const t = this.ctx.currentTime;
        cur.gain.gain.cancelScheduledValues(t); cur.gain.gain.setValueAtTime(0.0001, t); cur.gain.gain.linearRampToValueAtTime(1, t + 1.5);
        void cur.el.play().catch(() => undefined);
        this.announce(cur.track!);
        // look-ahead: fetch the next track while this one plays
        window.setTimeout(() => { if (this.settings.music && this.decks[1 - this.active]!.track === null) this.loadDeck(1 - this.active, this.pickNext()); }, 5000);
      })();
    } else if (cur.el.paused) {
      cur.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
      void cur.el.play().catch(() => undefined);
      this.musicStatus = 'playing'; this.emit(); this.applyTension();
    } else {
      cur.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
    }
  }

  /** A deck is DEAD when it holds a track and a fetched blob URL, but the
   *  element's resource is gone: an error is latched, the src was stripped,
   *  or the element reports it has no source. Ground truth from the element
   *  itself — the flags (track, musicStatus) cannot see this state, which is
   *  why the 2026-10-30 dropout survived every earlier heal: they all
   *  reconciled flags, never elements. */
  private deckDead(d: Deck): boolean {
    if (d.track === null || !d.url) return false; // nothing loaded yet — not dead, just unready
    if (d.el.error) return true;
    if (!d.el.src) return true;
    if (d.el.networkState === 3) return true; // NETWORK_NO_SOURCE
    return false;
  }

  private deckLoading(d: Deck): boolean { return d.loading === true; }

  /** Reload the active deck's track from scratch and play it. The recovery
   *  for a dead deck, wherever the death is noticed (sync, watchdog, error
   *  event). Never runs mid-crossfade: advance() owns the decks then, and
   *  its own timeout-guarded loads settle the fade one way or the other. */
  private async restartDeck(idx: number) {
    if (this.advancing) return;
    const d = this.decks[idx];
    if (!d || d.track === null || this.deckLoading(d)) return;
    this.musicStatus = 'loading'; this.emit();
    let ok = await this.loadDeck(idx, d.track);
    for (let tries = 0; !ok && tries < 3; tries++) ok = await this.loadDeck(idx, this.pickNext());
    if (!this.ctx || !wantsMusic(this.settings) || this.active !== idx) return;
    if (!ok) { this.musicStatus = 'error'; this.emit(); return; }
    const t = this.ctx.currentTime;
    d.gain.gain.cancelScheduledValues(t);
    d.gain.gain.setValueAtTime(Math.max(0.0001, d.gain.gain.value), t);
    d.gain.gain.linearRampToValueAtTime(1, t + 0.8);
    d.el.currentTime = 0;
    void d.el.play().catch(() => undefined);
    this.musicStatus = 'playing'; this.emit(); this.applyTension();
  }

  /* ---------- unlock, and bring sound back after iOS interrupts it ---------- */
  private liveState(c: AudioContext | null): string {
    return this.testState ?? c?.state ?? 'none';
  }

  installUnlock() {
    if (typeof window === 'undefined' || this.unlockInstalled) return;
    this.unlockInstalled = true;
    const gesture = () => this.wake('gesture');
    const show = () => this.wake('show');
    // touchstart and pointerdown both count as the first gesture on iOS. keydown covers desktop.
    window.addEventListener('pointerdown', gesture, true);
    window.addEventListener('touchstart', gesture, true);
    window.addEventListener('keydown', gesture, true);
    // iOS only grants audio on touchend / pointerup / click. A drag-to-play never makes a click, so listen there too.
    window.addEventListener('touchend', gesture, true);
    window.addEventListener('pointerup', gesture, true);
    window.addEventListener('click', gesture, true);
    // backgrounding suspends the context; pageshow also fires when iOS restores the page from bfcache
    document.addEventListener('visibilitychange', () => { if (!document.hidden) show(); });
    window.addEventListener('pageshow', show);
  }

  /** Re-run every stem's sync (lounge pad, venue bed, music). All three are idempotent:
   *  a stem that is already sounding early-returns, a torn-down one rebuilds. */
  private resyncAll() {
    this.syncAmbient();
    this.syncVenue();
    this.syncMusic();
  }

  /**
   * Resume, or rebuild, the context. Called inside the gesture (touch/pointer) and when the page
   * is shown again. `resume()` is invoked synchronously so iOS still counts it as the user gesture.
   */
  wake(kind: 'gesture' | 'show') {
    // Re-assert the playback-session claim on every wake: an iOS interruption can
    // renegotiate the session while the game was down (prevention pass — the claim
    // lives in claimPlaybackSession, feature-detected, silent where unsupported).
    this.claimSession();
    // Every wake also arms the outcome verification: the syncs below reconcile
    // flags, and ~1s later armVerify checks the graph is actually SOUNDING —
    // if a deck verifiably plays into digital silence, the wake escalates to
    // a rebuild. This is what makes the speaker button a guaranteed recovery
    // instead of a hopeful one (2026-10-30: "most times it never comes back").
    this.startWatchdog();
    this.armVerify();
    if (kind === 'show' && !this.unlocked) return;
    if (kind === 'gesture' && this.unlocked && this.liveState(this.ctx) === 'running') {
      if (this.needsRestore) this.publishRestore();
      // Still re-run the syncs: on cold start the first gesture may not have
      // started music (context not ready), and this is the retry path.
      // Demetrius 2026-10-19: music must resume on first tap after swipe-kill.
      this.resyncAll();
      return;
    }
    if (kind === 'gesture') this.unlocked = true;
    this.ensure();
    const c = this.ctx;
    if (!c) { this.publishRestore(); return; }
    const action = audioContextAction(this.liveState(c));
    if (action === 'recreate' && !this.recreating && recreateDue(this.lastRecreateAt, performance.now())) {
      this.testState = null;
      this.lastRecreateAt = performance.now();
      this.recreating = true;
      try { this.recreateContext(); } finally { this.recreating = false; }
    }
    const gen = ++this.wakeGen;
    // play() has to happen in this turn. Waiting for the resume promise drops the iOS gesture.
    // Run the syncs on 'show' too: if iOS backgrounded the page the beds were torn down by
    // recreateContext(), and rebuilding the graph now means the next tap (or a granted resume)
    // restores sound immediately instead of needing the audio options. Demetrius 2026-10-19.
    if (kind === 'gesture' || kind === 'show') {
      if (kind === 'gesture' && this.ctx) this.blip(this.ctx);
      this.resyncAll();
    }
    // Start resume() now, inside the gesture. A simulated stuck state must not actually resume,
    // or the test hook could never leave the speaker in its needs-tap state. Publish that state
    // in this same turn: the resume promise settles later, and a rejection must not skip the update.
    const resumePromise = this.testState == null ? settleAudio(this.ctx?.resume()) : Promise.resolve();
    this.publishRestore();
    void resumePromise.then(() => {
      if (gen !== this.wakeGen) return;
      if (this.liveState(this.ctx) === 'running') this.resyncAll();
      this.publishRestore();
    });
  }

  private blip(c: AudioContext) {
    try {
      const b = c.createBuffer(1, 1, 22050); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
    } catch { /* context not runnable yet */ }
  }

  private publishRestore() {
    const next = soundRestorePending(this.liveState(this.ctx), this.unlocked, !!(this.settings.on || this.settings.music));
    if (next !== this.needsRestore) {
      this.needsRestore = next;
      this.emit();
    }
    this.syncHealTimer();
  }

  /**
   * While a restore is pending, retry recovery on a timer instead of waiting for the player's
   * next tap. iOS ends most interruptions by itself (a call ends, a speech utterance finishes),
   * but the context does not resume itself — and a rebuild torn down by recreateContext() only
   * sounds again once a sync runs. The retry drives wake('show'): rebuild if the state still
   * demands it (rate-limited), resume, and re-sync every stem. It stops the moment the context
   * is running again. Demetrius 2026-10-21: sound "goes out and comes back when it feels like
   * it" — the return must not depend on an arbitrary tap.
   */
  private syncHealTimer() {
    if (typeof window === 'undefined') return;
    if (this.needsRestore && this.healTimer === null) {
      this.healTimer = window.setInterval(() => {
        if (!this.needsRestore) { this.syncHealTimer(); return; }
        this.wake('show');
      }, RESTORE_HEAL_MS);
    } else if (!this.needsRestore && this.healTimer !== null) {
      window.clearInterval(this.healTimer);
      this.healTimer = null;
    }
  }

  /* ---------- the dropout watchdog: verify outcomes, not flags ----------
   * Every earlier heal reconciled STATE: context state, playing flags, sync
   * coverage. The 2026-10-30 recurrence lived entirely in the gap between
   * state and outcome — elements paused or resource-dead under a 'playing'
   * status, a crossfade latched on a fetch that would never settle, and a
   * graph rendering into silence with the context reporting 'running'.
   * None of those move ctx.state, so the restore heal never fired and the
   * speaker tap (the same flag syncs) could not revive them. The watchdog
   * checks ground truths on a slow tick while sound is wanted:
   *   - a deck whose element lost its resource → reload it (restartDeck);
   *   - music wanted, decks built, nothing verifiably playing → re-sync;
   *   - a playing element whose position froze → reload it;
   *   - a bed claiming to play with no live nodes → rebuild the beds;
   *   - an incomplete SFX set → retry the loader (spaced);
   *   - a verifiably playing deck heard as digital silence at the master
   *     meter, three ticks running → rebuild the context (the only cure
   *     for a dead output path, and the escalation the tap also uses).
   */
  private startWatchdog() {
    if (typeof window === 'undefined' || this.watchdogTimer !== null) return;
    this.watchdogTimer = window.setInterval(() => this.watchdogTick(), WATCHDOG_MS);
  }

  private outputRms(): number {
    if (!this.analyser) return -1;
    try {
      const buf = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(buf);
      let acc = 0;
      for (let i = 0; i < buf.length; i++) acc += buf[i]! * buf[i]!;
      return Math.sqrt(acc / buf.length);
    } catch { return -1; }
  }

  /** True when every witness says sound should be audible — context running,
   *  master up, a deck verifiably playing — yet the master meter hears
   *  digital silence. The signature of a dead output path (iOS interruption
   *  residue, audio-route change), invisible to every state check. */
  private outputDead(): boolean {
    if (!this.analyser || !this.ctx || !this.unlocked) return false;
    if (this.liveState(this.ctx) !== 'running') return false;
    if (!this.master || this.master.gain.value <= 0.01) return false; // muted / film hold: silence is intended
    if (this.advancing || this.fading) return false; // a crossfade owns the decks; its loads are timeout-guarded
    if (!wantsMusic(this.settings) || this.playingDeckCount() === 0) return false;
    const rms = this.outputRms();
    return rms >= 0 && rms < OUTPUT_SILENCE_EPS;
  }

  /** Rebuild the context through the same rate limit as the interruption
   *  paths, then re-publish restore state (a rebuild that lands suspended
   *  hands over to the needs-tap + heal-timer machinery, honestly). */
  private escalateGraph() {
    if (this.recreating || !recreateDue(this.lastRecreateAt, performance.now())) return;
    this.lastRecreateAt = performance.now();
    this.recreating = true;
    try { this.recreateContext(); } finally { this.recreating = false; }
    this.publishRestore();
  }

  /** After a wake, verify the outcome once the syncs have had a moment to
   *  land: two silence readings ~0.8s apart with a deck claiming output
   *  escalate to a rebuild. Armed on every wake; the claim gates make it a
   *  no-op whenever sound is off, muted, held for a film, or honestly loud. */
  private armVerify() {
    if (typeof window === 'undefined' || this.verifyTimer !== null) return;
    this.verifyTimer = window.setTimeout(() => {
      this.verifyTimer = null;
      if (!this.outputDead()) return;
      window.setTimeout(() => { if (this.outputDead()) this.escalateGraph(); }, 800);
    }, 800);
  }

  private watchdogTick() {
    if (!this.unlocked || !this.ctx) return;
    if (this.liveState(this.ctx) !== 'running') { this.silenceTicks = 0; this.stemMissTicks = 0; this.deckStallTicks = 0; return; }
    const now = performance.now();
    // SFX readiness: a load that finished with holes gets a spaced retry.
    if (this.buffers.size < SFX_COUNT && !this.loading && now - this.lastSfxRetryAt > 15000) {
      this.lastSfxRetryAt = now;
      this.load();
    }
    if (wantsMusic(this.settings) && this.decks.length) {
      const cur = this.decks[this.active]!;
      if (this.musicStatus === 'error' && now - this.lastErrorRetryAt > 10000) {
        this.lastErrorRetryAt = now;
        this.syncMusic();
      } else if (this.deckDead(cur) && !this.deckLoading(cur)) {
        void this.restartDeck(this.active);
        this.stemMissTicks = 0;
      } else if (!this.advancing && !this.fading && cur.track !== null && !this.deckLoading(cur) && this.playingDeckCount() === 0) {
        // Wanted, built, loaded — and nothing is playing (the element was
        // paused under us, or a play() was dropped). Two ticks of hysteresis
        // so a crossfade gap never trips it.
        if (++this.stemMissTicks >= 2) { this.stemMissTicks = 0; this.syncMusic(); }
      } else this.stemMissTicks = 0;
      // A playing element whose position froze mid-track is sounding
      // nothing; reload it. (Near the end the crossfade owns the deck.)
      if (!cur.el.paused && cur.url && Number.isFinite(cur.el.duration) && cur.el.currentTime < cur.el.duration - XFADE - 0.5) {
        if (this.lastDeckPos === cur.el.currentTime) {
          if (++this.deckStallTicks >= 2) { this.deckStallTicks = 0; void this.restartDeck(this.active); }
        } else this.deckStallTicks = 0;
        this.lastDeckPos = cur.el.currentTime;
      } else { this.deckStallTicks = 0; this.lastDeckPos = -1; }
      // The graph itself: claims are healthy, the meter hears nothing.
      if (this.outputDead()) {
        if (++this.silenceTicks >= 3) { this.silenceTicks = 0; this.escalateGraph(); }
      } else this.silenceTicks = 0;
    } else { this.stemMissTicks = 0; this.silenceTicks = 0; this.deckStallTicks = 0; this.lastDeckPos = -1; }
    // Beds: a bed that claims to be playing must own live nodes.
    if (this.venuePlaying !== 'none' && this.venueNodes.length === 0) {
      this.stopBeds(); this.syncVenue(); this.syncAmbient();
    } else if (this.ambTimer !== null && this.ambNodes.length === 0) {
      this.stopBeds(); this.syncAmbient(); this.syncVenue();
    }
  }

  private watchContext(c: AudioContext) {
    c.onstatechange = () => {
      if (c !== this.ctx || !this.unlocked || this.recreating) return;
      if (audioContextAction(this.liveState(c)) === 'recreate' && recreateDue(this.lastRecreateAt, performance.now())) {
        this.testState = null;
        this.lastRecreateAt = performance.now();
        this.recreating = true;
        try { this.recreateContext(); } finally { this.recreating = false; }
      }
      // A context that returns to 'running' on its own (an interruption ended, a rebuild's
      // resume landed) must bring back the stems recreateContext() tore down — the music
      // decks were released and both beds stopped, and without this re-sync they stayed
      // silent until the player's next tap happened to fire wake().
      if (this.liveState(c) === 'running') this.resyncAll();
      this.publishRestore();
    };
  }

  /** Build a new context. Interrupted and closed ones cannot be resumed. Buffers are copied across. */
  private recreateContext() {
    const saved = this.copyBuffers();
    this.stopVoice();
    this.releaseDecks();
    this.stopBeds();
    this.sprayNodes = null; // the old hiss nodes die with the old context
    const old = this.ctx;
    this.ctx = null;
    this.master = this.sfxBus = this.sfxDuck = this.nukeBus = this.ambBus = this.venueBus = this.voiceDuck = this.voiceChatBus = this.voiceChatOut = this.musicBus = this.musicDuck = null; this.voiceChatNodes.clear(); // regs kept: re-routed below
    this.analyser = null; // ensure() builds the new context's meter
    this.loading = null;
    this.loadGen++;
    if (old && old.state !== 'closed') void settleAudio(old.close());
    const next = this.ensure({ skipLoad: true });
    if (!next) return;
    if (saved.length) this.restoreBuffers(saved);
    // ALWAYS re-run the loader, not just when nothing survived: an SFX
    // fetch in flight when the old context died has its result discarded
    // by the generation guard, and a partial buffer copy kept the old
    // `size === 0` condition from ever refetching the missing names —
    // those effects stayed silent for the rest of the session (a hole in
    // the 2026-10-21 heal, found in the 2026-10-22 recurrence audit).
    // load() skips names the copy already restored.
    this.load();
    this.voiceChatGeneration++;
    this.rerouteVoiceChat();
    // The rebuild itself restores the stems: until now they only came
    // back if a LATER statechange or wake() happened to re-sync — a
    // rebuild landing on an already-'running' context (the watcher's
    // 'closed' path) or racing the 'interrupted' report left music,
    // beds, and tension down until the next tap. The heal contract is
    // "the rebuild re-syncs", unconditionally.
    this.resyncAll();
    this.emit();
    if (next.state !== 'running') void settleAudio(next.resume());
  }

  private copyBuffers(): { key: string; rate: number; channels: Float32Array[] }[] {
    const out: { key: string; rate: number; channels: Float32Array[] }[] = [];
    for (const [key, buf] of this.buffers) {
      try {
        const channels: Float32Array[] = [];
        for (let i = 0; i < buf.numberOfChannels; i++) channels.push(new Float32Array(buf.getChannelData(i)));
        out.push({ key, rate: buf.sampleRate, channels });
      } catch { /* closed context: the samples are gone, re-decode */ }
    }
    this.buffers = new Map();
    return out;
  }

  private restoreBuffers(saved: { key: string; rate: number; channels: Float32Array[] }[]) {
    const c = this.ctx;
    if (!c) return;
    for (const s of saved) {
      const frames = s.channels[0]?.length ?? 0;
      if (!frames || !s.channels.length) continue;
      try {
        const buf = c.createBuffer(s.channels.length, frames, s.rate || c.sampleRate);
        s.channels.forEach((data, i) => buf.copyToChannel(data, i));
        this.buffers.set(s.key, buf);
      } catch { /* re-fetch below */ }
    }
  }

  private stopBeds() {
    if (this.ambTimer !== null) { window.clearInterval(this.ambTimer); this.ambTimer = null; }
    this.filmLayers = null;
    this.ambNodes = [];
    this.venueTimers.forEach((t) => window.clearTimeout(t));
    this.venueTimers = [];
    const nodes = this.venueNodes; this.venueNodes = [];
    nodes.forEach((n) => { try { n.stop(); } catch { /* dead context */ } });
    this.venuePlaying = 'none';
  }

  /* ---------- recorded bot voices (see voices/voices.ts) ---------- */
  private voiceDuck: GainNode | null = null;
  /** Phase 7: human WebRTC voice chat bus. The playerVoice category is applied ONLY here. */
  private voiceChatBus: GainNode | null = null;
  private voiceChatNodes = new Map<string, { src: AudioNode; gain: GainNode; stream: MediaStream; release?: () => void }>();
  /** Registrations survive a context rebuild (nodes do not): recreateContext re-routes these. */
  private voiceChatRegs = new Map<string, { stream: MediaStream; seat?: SeatPos; playerCount: number; ducked?: boolean }>();
  /** Independent voice-chat output: NOT through master, so game-sound-off / master 0 never silences chat. */
  private voiceChatOut: GainNode | null = null;
  voiceChatGeneration = 0;
  voiceChatProbe: { id: string; seat: string; muted: boolean; model: string }[] = [];
  /** Live recorded-voice slots, oldest first: one in serial play, two while a cross-talk overlap runs. */
  private voiceSlots: VoiceSlot[] = [];
  /**
   * One deferrable chatter line waiting for the room to clear rather
   * than cutting in (regular tables): it starts the moment the last
   * live slot ends, and only if that moment is still its deadline —
   * past it, the line is stale and silently discarded. A second waiter
   * is never queued: it drops on arrival instead. Cleared by stopVoice
   * (leaving the table, voices off, an announcement taking the room).
   */
  private deferredVoice: { buf: AudioBuffer; gain: number; slice?: [number, number]; seat?: SeatPos; playerCount: number; speaker: string; deadline: number } | null = null;
  /** The (possibly still locked) context, for decoding voice clips ahead of time. */
  audioContext(): AudioContext | null { this.ensure(); return this.ctx; }
  /** Play one bot line (cuts off the previous one, like one person talking). Silent when sound is off / not unlocked yet. */
  /** play a voice clip (optionally a [offsetSec, durationSec] slice of a sprite) */
  playVoice(buf: AudioBuffer, gain: number, slice?: [number, number], seat?: SeatPos, playerCount = 4): boolean {
    return this.startVoice(buf, gain, slice, seat, playerCount, null);
  }
  /**
   * Cross-talk entry (the policy is planVoiceArrival, above): a
   * conversational line may start over the tail of a DIFFERENT
   * speaker's line — both continue briefly, the first ducked ≈ −6 dB —
   * instead of cutting it. With `opts.defer` (regular-table chatter), an
   * arrival the plan would replace instead WAITS for the room when the
   * wait is short (VOICE_DEFER_MAX_WAIT_S), or drops when it isn't: a
   * playing line is never cut mid-sentence by chatter. Without it
   * (story surfaces — their beats are duration-paced upstream, so a
   * replace there is the designed handoff), a same-speaker line, a
   * third arrival, or a lost roll still cuts in alone, exactly as the
   * serial channel behaves. Returns false only when the line neither
   * started nor is waiting (dropped, or the channel is unavailable).
   */
  playVoiceCrossTalk(buf: AudioBuffer, gain: number, slice: [number, number], seat: SeatPos | undefined, playerCount: number, speaker: string, opts?: { defer?: boolean }): boolean {
    return this.startVoice(buf, gain, slice, seat, playerCount, { speaker, roll: Math.random(), defer: opts?.defer });
  }
  private startVoice(buf: AudioBuffer, gain: number, slice: [number, number] | undefined, seat: SeatPos | undefined, playerCount: number, cross: { speaker: string; roll: number; defer?: boolean } | null): boolean {
    if (!this.settings.on || !this.unlocked) return false;
    if (!this.atTable) { this.blocked.voice = (this.blocked.voice ?? 0) + 1; return false; }
    this.ensure();
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.voiceDuck) return false;
    const now = c.currentTime;
    let ducked: VoiceSlot | null = null;
    if (cross) {
      // Slots past their end are finished, onended or not — they don't hold the room.
      const live = this.voiceSlots.filter((s) => s.endsAt > now);
      const infos = live.map((s) => ({ speaker: s.speaker, remainingS: s.endsAt - now, elapsedS: now - s.startedAt }));
      const plan = planVoiceArrival(infos, cross.speaker, cross.roll);
      if (plan.kind === 'overlap') {
        const keep = live[plan.keepIndex]!;
        for (const s of [...this.voiceSlots]) if (s !== keep) this.stopSlot(s);
        keep.gain.gain.setTargetAtTime(keep.baseGain * VOICE_DUCK_FACTOR, now, 0.06);
        ducked = keep;
      } else if (plan.kind === 'replace') {
        if (cross.defer && live.length) {
          // No mid-sentence cuts for deferrable chatter: wait for the
          // room instead of replacing the playing line — while the wait
          // is short and nobody is already waiting. Past the bound (or
          // behind another waiter) the line drops: its moment is gone
          // either way, and cutting is the one outcome that's banned.
          const waitS = voiceRoomWaitS(infos);
          if (this.deferredVoice || waitS > VOICE_DEFER_MAX_WAIT_S) return false;
          this.deferredVoice = { buf, gain, slice, seat, playerCount, speaker: cross.speaker, deadline: now + waitS };
          return true;
        }
        this.stopVoice();
      }
      // 'play': the room is empty — nothing to cut or duck.
    } else this.stopVoice();
    const src = c.createBufferSource(); src.buffer = buf;
    // Category volume applied once, here (voiceLineGain); callers pass only their own gain.
    const g = c.createGain(); g.gain.value = voiceLineGain(gain, this.settings.volumes);
    const slot: VoiceSlot = { src, gain: g, speaker: cross?.speaker ?? null, baseGain: g.gain.value, startedAt: now, endsAt: now + (slice ? slice[1] : buf.duration), ducked, duckedBy: null };
    if (ducked) ducked.duckedBy = slot;
    let release: (() => void) | undefined;
    if (seat && this.settings.spatial !== false) {
      // Voices: direction ONLY — full distance compensation, so a far character is never quieter.
      const sp = this.ensureSpatializer();
      sp.applyListener(c as never, { pos: [this.listenerPoint.x, this.listenerPoint.y, this.listenerPoint.z], look: [this.listenerLook.x, this.listenerLook.y, this.listenerLook.z] });
      const panner = sp.seatPanner(c as never, seat, playerCount);
      if (panner) {
        const comp = c.createGain(); comp.gain.value = seatCompensation(this.listenerPoint, seat, playerCount);
        comp.connect(panner as unknown as AudioNode); (panner as unknown as AudioNode).connect(this.voiceDuck);
        src.connect(g).connect(comp);
        this.voiceProbe = { seat, gain: comp.gain.value, model: (panner as unknown as { panningModel: string }).panningModel };
        if (typeof window !== 'undefined') (window as unknown as { __bwmVoice?: unknown }).__bwmVoice = this.voiceProbe;
        release = () => sp.release();
      } else src.connect(g).connect(this.voiceDuck);
    } else src.connect(g).connect(this.voiceDuck);
    src.onended = () => {
      release?.();
      const ix = this.voiceSlots.indexOf(slot); if (ix >= 0) this.voiceSlots.splice(ix, 1);
      // If this line was talking over another, hand the ducked line its
      // level back — but only when it is still up and still ducked by us
      // (a later line may have taken over the duck in the meantime).
      const d = slot.ducked;
      if (d && d.duckedBy === slot && this.voiceSlots.includes(d)) {
        d.duckedBy = null;
        try { d.gain.gain.setTargetAtTime(d.baseGain, c.currentTime, 0.09); } catch { /* context rebuilt */ }
      }
      // The room is empty: a deferred chatter line (regular tables)
      // takes it now, if its moment hasn't passed while it waited.
      if (!this.voiceSlots.length) this.startDeferredVoice();
    };
    if (slice) src.start(0, slice[0], slice[1]); else src.start();
    this.voiceSlots.push(slot);
    this.played.voice = (this.played.voice ?? 0) + 1;
    return true;
  }
  /* ---------- Phase 7: human WebRTC voice chat, spatialised per seat ---------- */
  /**
   * Route one peer's remote stream: MediaStreamSource -> per-peer gain -> seat panner -> voice-chat bus.
   * Per-peer gain carries ONLY mute/duck (never the category): playerVoice is applied once, on the bus.
   * Returns false when Web Audio routing is unavailable (caller keeps the <video> element audible).
   */
  attachVoiceChat(id: string, stream: MediaStream, seat?: SeatPos, playerCount = 4, opts?: { muted?: boolean; ducked?: boolean }): boolean {
    this.voiceChatRegs.set(id, { stream, seat, playerCount, ducked: opts?.ducked });
    const cur = this.voiceChatNodes.get(id);
    if (cur?.stream === stream) { this.updateVoiceChat(id, opts); return true; }
    this.detachVoiceChat(id);
    if (!stream.getAudioTracks().length) return false;
    this.ensure();
    const c = this.ctx;
    if (!c || !this.voiceChatBus || typeof c.createMediaStreamSource !== 'function') return false;
    try {
      const src = c.createMediaStreamSource(stream);
      const g = c.createGain(); g.gain.value = (opts?.muted ?? this.voiceMuted(id)) ? 0 : opts?.ducked ? 0.4 : 1;
      let release: (() => void) | undefined; let model = 'stereo';
      if (seat && this.settings.spatial !== false) {
        const sp = this.ensureSpatializer();
        sp.applyListener(c as never, { pos: [this.listenerPoint.x, this.listenerPoint.y, this.listenerPoint.z], look: [this.listenerLook.x, this.listenerLook.y, this.listenerLook.z] });
        const panner = sp.seatPanner(c as never, seat, playerCount);
        if (panner) {
          const comp = c.createGain(); comp.gain.value = seatCompensation(this.listenerPoint, seat, playerCount);
          comp.connect(panner as unknown as AudioNode); (panner as unknown as AudioNode).connect(this.voiceChatBus);
          g.connect(comp); model = (panner as unknown as { panningModel: string }).panningModel; release = () => sp.release();
        } else g.connect(this.voiceChatBus);
      } else g.connect(this.voiceChatBus);
      src.connect(g);
      this.voiceChatNodes.set(id, { src, gain: g, stream, release });
      this.voiceChatProbe = [...this.voiceChatNodes.keys()].map((k) => ({ id: k, seat: seat ?? 'centre', muted: !!opts?.muted, model }));
      if (typeof window !== 'undefined') (window as unknown as { __bwmVoiceChat?: unknown }).__bwmVoiceChat = this.voiceChatProbe;
      return true;
    } catch { return false; }
  }
  updateVoiceChat(id: string, opts?: { muted?: boolean; ducked?: boolean }): void {
    const reg = this.voiceChatRegs.get(id);
    if (reg && opts?.ducked !== undefined) reg.ducked = opts.ducked;
    const n = this.voiceChatNodes.get(id); if (!n || !this.ctx) return;
    const muted = opts?.muted ?? this.voiceMuted(id);
    n.gain.gain.setTargetAtTime(muted ? 0 : opts?.ducked ? 0.4 : 1, this.ctx.currentTime, 0.05);
  }
  /** After a context rebuild: rebuild every registered peer's chain on the new context. */
  private rerouteVoiceChat(): void {
    for (const [id, reg] of [...this.voiceChatRegs]) {
      this.voiceChatNodes.delete(id);
      this.attachVoiceChat(id, reg.stream, reg.seat, reg.playerCount, { muted: this.voiceMuted(id), ducked: reg.ducked });
    }
  }
  voiceChatRouted(id: string): boolean { return this.voiceChatNodes.has(id); }
  detachVoiceChat(id: string): void {
    this.voiceChatRegs.delete(id);
    const n = this.voiceChatNodes.get(id); if (!n) return;
    this.voiceChatNodes.delete(id);
    try { n.src.disconnect(); } catch { /* gone */ }
    try { n.gain.disconnect(); } catch { /* gone */ }
    n.release?.();
    this.voiceChatProbe = this.voiceChatProbe.filter((x) => x.id !== id);
    if (typeof window !== 'undefined') (window as unknown as { __bwmVoiceChat?: unknown }).__bwmVoiceChat = this.voiceChatProbe;
  }
  detachAllVoiceChat(): void { for (const id of [...this.voiceChatNodes.keys()]) this.detachVoiceChat(id); }

  /* ---------- table gate: game sound only while a game is on screen ---------- */
  /** True while the table screen is mounted. Off it, only the settings previews (tap, bid) can sound. */
  atTable = false;
  enterTable() { this.atTable = true; }
  /** Leaving the table: refuse game sound, and cut everything already scheduled (delayed deal ticks, stingers, voice, wind). */
  leaveTable() {
    this.atTable = false;
    this.stopVoice();
    this.stopTornado();
    // Only stop speech that is actually speaking: an idle cancel() still pokes the iOS
    // audio session (prevention pass — see cancelActiveSpeech), and with the fallback
    // fenced during live play there is never an utterance to stop here.
    cancelActiveSpeech(typeof speechSynthesis !== 'undefined' ? speechSynthesis : undefined);
    const c = this.ctx, old = this.sfxBus, duck = this.sfxDuck;
    if (c && old && duck) {
      // every scheduled node hangs off the sfx bus: detach it and start a fresh one
      try { old.disconnect(); } catch { /* */ }
      this.sfxBus = c.createGain(); this.sfxBus.connect(duck);
    }
    if (c && this.nukeBus && this.master) {
      try { this.nukeBus.disconnect(); } catch { /* */ }
      this.nukeBus = c.createGain(); this.nukeBus.connect(this.master);
    }
    this.applyGain();
  }
  /** Settings previews that may sound on Home. Chat notifications live here too: a DM must
   *  ding no matter where in the app you are, not only at a table. */
  private static readonly UI_SFX: ReadonlySet<string> = new Set(['tap', 'bid', 'dmChime', 'chatBlip']);
  /** Cut every live voice line (one in serial play, two while a cross-talk overlap runs). */
  stopVoice() {
    const slots = this.voiceSlots; this.voiceSlots = [];
    this.deferredVoice = null; // a waiting line never survives the room being cleared
    for (const s of slots) this.fadeStopSlot(s);
  }
  /**
   * Start the deferred chatter line now that the room has cleared —
   * unless its deadline passed while the room stayed busy (an overlap
   * outlived it), in which case the stale line is silently discarded.
   */
  private startDeferredVoice(): void {
    const dv = this.deferredVoice;
    if (!dv) return;
    this.deferredVoice = null;
    const c = this.ctx;
    if (!c || c.currentTime > dv.deadline + 0.25) return;
    this.startVoice(dv.buf, dv.gain, dv.slice, dv.seat, dv.playerCount, { speaker: dv.speaker, roll: Math.random(), defer: true });
  }
  /** Remove one slot from the room and fade it out (cross-talk keeps the rest). */
  private stopSlot(slot: VoiceSlot) {
    const ix = this.voiceSlots.indexOf(slot);
    if (ix >= 0) this.voiceSlots.splice(ix, 1);
    this.fadeStopSlot(slot);
  }
  private fadeStopSlot(slot: VoiceSlot) {
    if (!this.ctx) return;
    slot.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    try { slot.src.stop(this.ctx.currentTime + 0.12); } catch { /* already stopped */ }
  }
  /** Big moments (nuke, Wheels, tornado, SHOT!…): voices dip under them, then come back. */
  private duckVoice(ms: number, t: number) {
    const d = this.voiceDuck, c = this.ctx;
    if (!d || !c) return;
    d.gain.cancelScheduledValues(c.currentTime);
    d.gain.setTargetAtTime(0.28, t, 0.05);
    d.gain.setTargetAtTime(1, t + ms / 1000, 0.25);
  }

  /** Claim the iOS playback session (Audio Session API, iOS 17+) for the game's audio. */
  private claimSession(): void {
    claimPlaybackSession(typeof navigator !== 'undefined' ? (navigator as { audioSession?: { type: string } }) : undefined);
  }

  private ensure(opts?: { skipLoad?: boolean }): AudioContext | null {
    if (this.ctx || !AC) return this.ctx;
    const c = new AC({ latencyHint: 'interactive' });
    this.ctx = c;
    // A fresh context (first build, or a rebuild via recreateContext) re-claims the
    // playback session alongside it — the claim is per-session, not per-context,
    // but asserting it here keeps the two from ever drifting apart.
    this.claimSession();
    this.watchContext(c);
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    // The output meter sits on the master bus: master → analyser → comp →
    // destination. It changes nothing audible; it is the watchdog's witness
    // for a graph that reports 'running' while outputting silence.
    try {
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 2048;
      this.master.connect(this.analyser).connect(comp).connect(c.destination);
    } catch { this.analyser = null; this.master.connect(comp).connect(c.destination); }
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = normalizeCategoryVolumes(this.settings.volumes).sfx; this.sfxDuck = c.createGain(); this.sfxBus.connect(this.sfxDuck).connect(this.master);
    this.nukeBus = c.createGain(); this.nukeBus.connect(this.master);
    this.ambBus = c.createGain(); this.ambBus.gain.value = 0; this.ambBus.connect(this.master);
    this.venueBus = c.createGain(); this.venueBus.gain.value = 0; this.venueBus.connect(this.master);
    // Room convolver (Phase 4): a generated impulse (no audio assets) whose length/wet match the room.
    try {
      this.convolver = c.createConvolver();
      this.convWet = c.createGain(); this.convWet.gain.value = 0;
      this.venueBus.connect(this.convWet); this.convWet.connect(this.convolver); this.convolver.connect(this.master);
      if (this.roomStyle) { const spec = irSpec(this.roomStyle); this.convolver.buffer = this.makeIR(spec.seconds); this.convWet.gain.value = spec.wet; }
    } catch { this.convolver = null; this.convWet = null; }
    this.voiceDuck = c.createGain(); this.voiceDuck.connect(this.master);
    this.voiceChatBus = c.createGain(); this.voiceChatBus.gain.value = normalizeCategoryVolumes(this.settings.volumes).playerVoice;
    this.voiceChatOut = c.createGain(); this.voiceChatOut.gain.value = 1; this.voiceChatBus.connect(this.voiceChatOut); this.voiceChatOut.connect(c.destination);
    this.applyGain();
    if (!opts?.skipLoad) this.load();
    return c;
  }

  /** Held while a story film (Dee's Rundown video) plays with sound: the
   *  master bus rests at 0 and returns when released. Not persisted — a
   *  reload never inherits it — and nothing else about the engine moves. */
  private videoHold = false;
  holdForVideo(on: boolean) {
    if (this.videoHold === on) return;
    this.videoHold = on;
    this.applyGain();
  }
  get videoHeld(): boolean { return this.videoHold; }
  private applyGain() {
    if (!this.master || !this.ctx) return;
    const v = this.settings.on ? this.settings.volume ** 1.6 : 0; // perceptual curve
    this.master.gain.setTargetAtTime(this.videoHold ? 0 : v, this.ctx.currentTime, 0.03);
    // Category volumes apply LIVE (Phase 8): moving a slider mid-game updates the running buses,
    // including a venue bed that is already playing (syncVenue alone would early-return).
    const cats = normalizeCategoryVolumes(this.settings.volumes);
    if (this.sfxBus) this.sfxBus.gain.setTargetAtTime(cats.sfx, this.ctx.currentTime, 0.05);
    if (this.venueBus && this.venuePlaying !== 'none') this.venueBus.gain.setTargetAtTime(0.38 * cats.ambience, this.ctx.currentTime, 0.1);
    if (this.voiceChatBus) this.voiceChatBus.gain.setTargetAtTime(cats.playerVoice, this.ctx.currentTime, 0.05); // independent of settings.on / master volume, by design
  }

  private load() {
    if (this.loading || !this.ctx) return this.loading;
    const c = this.ctx;
    const gen = this.loadGen;
    // Names a context rebuild already restored from the old context's
    // samples are skipped: a reload completes the set, it does not
    // re-download what survived (recreateContext relies on this).
    const names = Object.values(FILES).flat().filter((n) => !this.buffers.has(n));
    const p = Promise.all(names.map(async (n) => {
      try {
        const res = await fetch(`/assets/sfx/${n}.mp3`);
        const data = await res.arrayBuffer();
        const buf = await decodeAudioBuffer(c, data); // callback form for older Safari, one buffer per turn
        if (gen !== this.loadGen || this.ctx !== c) return; // a rebuilt context owns the new buffers
        this.buffers.set(n, buf);
      } catch { /* missing sound is not fatal */ }
    })).then(() => undefined);
    this.loading = p;
    // Clear the in-flight marker when the load settles: leaving it set made
    // load() a once-per-context no-op, so one failed SFX fetch at first load
    // silenced that effect for the whole session with no retry path. The
    // watchdog's readiness check re-runs load() when the set is incomplete.
    void p.then(() => { if (this.loading === p) this.loading = null; });
    return p;
  }

  /* ---------- playback ---------- */
  /** Card landing scaled by slam intensity 0..1: a soft tap for a gentle drop, a punchy smack + table thud for a flick. */
  /** Phase 3 test probe: every spatialised gameplay one-shot (seat + world point + model). */
  spatialProbe: { event: string; seat: string; x: number; y: number; z: number; model: string; gain?: number }[] = [];
  private lastVariant = new Map<string, number>();
  private spatializer: Spatializer | null = null;
  /** Listener pose, slaved to the camera by the scene (Sitting hears a closer table than Standing). */
  private listenerPoint = { x: 0, y: 4.5, z: 3.75 };
  private listenerLook = { x: 0, y: 0, z: 0.38 };
  setSpatialListener(pos: readonly number[], look: readonly number[]) {
    this.listenerPoint = { x: pos[0]!, y: pos[1]!, z: pos[2]! };
    this.listenerLook = { x: look[0]!, y: look[1]!, z: look[2]! };
    if (this.ctx && this.spatializer) this.spatializer.applyListener(this.ctx as never, { pos, look });
  }
  private spatializerKey = '';
  /** Route a one-shot through a seat panner (Phase 3). Spatial off / no seat / cap hit = the plain
   *  sfx bus, exactly Phase 2 behaviour. Trigger timing is untouched: this only chooses the node
   *  the already-scheduled source connects to (#169). */
  private routeSfx(event: string, seat?: SeatPos, playerCount = 4): { node: AudioNode; release?: () => void } {
    const bus = this.sfxBus!;
    if (!seat || this.settings.spatial === false || !this.ctx) return { node: bus };
    const sp = this.ensureSpatializer();
    sp.applyListener(this.ctx as never, { pos: [this.listenerPoint.x, this.listenerPoint.y, this.listenerPoint.z], look: [this.listenerLook.x, this.listenerLook.y, this.listenerLook.z] });
    const panner = sp.seatPanner(this.ctx as never, seat, playerCount);
    if (!panner) return { node: bus };
    (panner as unknown as AudioNode).connect(bus);
    // Distance compensation: far seats get a level boost (capped) so their slams keep their punch.
    const comp = seatCompensation(this.listenerPoint, seat, playerCount);
    const compNode = this.ctx.createGain(); compNode.gain.value = comp;
    compNode.connect(panner as unknown as AudioNode);
    const pt = seatPoint(seat, playerCount);
    this.spatialProbe.push({ event, seat, ...pt, model: this.spatializerModel, gain: comp });
    if (this.spatialProbe.length > 64) this.spatialProbe.shift();
    return { node: compNode, release: () => sp.release() };
  }

  private spatializerModel: 'HRTF' | 'equalpower' = 'equalpower';
  private ensureSpatializer(): Spatializer {
    const quality = this.settings.quality ?? 'balanced';
    const isPhone = typeof window !== 'undefined' && Math.min(window.innerWidth || 999, window.innerHeight || 999) < 600;
    const model = pickPanningModel(typeof PannerNode !== 'undefined', isPhone);
    this.spatializerModel = model;
    const key = `${quality}:${model}`;
    if (!this.spatializer || this.spatializerKey !== key) { this.spatializer = new Spatializer(quality, true, model); this.spatializerKey = key; }
    return this.spatializer;
  }
  /** Phase 5 probe: last spatialised voice (seat, compensation gain, model). */
  voiceProbe: { seat: string; gain: number; model: string } | null = null;

  cardSmack(intensity: number, seat?: SeatPos, playerCount = 4) {
    if (!this.settings.on || !this.unlocked || !this.atTable) return;
    this.ensure();
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const s = smackSound(intensity);
    this.played.play = (this.played.play ?? 0) + 1;
    this.played.smack = (this.played.smack ?? 0) + 1;
    this.lastSmack = s;
    const t = c.currentTime;
    this.sample('play', t, s.gain, s.rate, undefined, seat, playerCount);
    if (s.thud > 0) this.thud(t + 0.005, s.thud); // thud stays centred: it is the table, not the seat
  }
  lastSmack: SmackSound | null = null;

  play(name: Sfx, opts: { delay?: number; gain?: number; dur?: number; seat?: SeatPos; playerCount?: number; versusSide?: -1 | 0 | 1 } = {}) {
    if (!this.settings.on || !this.unlocked) return;
    if ((name === 'dmChime' || name === 'chatBlip') && this.settings.chatSounds === false) return;
    if (!this.atTable && !Engine.UI_SFX.has(name)) { this.blocked[name] = (this.blocked[name] ?? 0) + 1; return; }
    this.ensure();
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const now = performance.now();
    const minGap = name === 'deal' ? 22 : name === 'play' ? 50 : 90;
    if (now - (this.lastAt.get(name) ?? -1e9) < minGap && !opts.delay) return;
    this.lastAt.set(name, now);
    this.played[name] = (this.played[name] ?? 0) + 1;
    const t = c.currentTime + (opts.delay ?? 0);
    const g = opts.gain ?? 1;
    const duck = DUCK_MS[name];
    if (duck) this.duckVoice(duck, t);
    // Film mix reactions (Porch pilot): a set drops the score a register while the room
    // reacts; the nuke / mega ducks EVERYTHING — bed layers included, not just the music
    // bus the booms already ride. filmDip no-ops unless the Porch mix is live.
    if (name === 'set') this.filmDip(FILM_SET_DIP, 2600);
    else if (name === 'nuke') this.filmDip(FILM_BLAST, DUCK_MS.nuke ?? 3600);
    else if (name === 'mega') this.filmDip(FILM_BLAST, DUCK_MS.mega ?? 4400);
    switch (name) {
      case 'shuffle': return this.sample('shuffle', t, 0.75 * g, 1, Math.max(0.3, opts.dur ?? 1.6));
      case 'deal': return this.sample('deal', t, 0.26 * g, 1.2 + Math.random() * 0.25, 0.3, opts.seat, opts.playerCount);
      case 'play': return this.sample('play', t, 0.9 * g, 0.95 + Math.random() * 0.12, undefined, opts.seat, opts.playerCount);
      case 'tap': return this.sample('tap', t, 0.5 * g, 1.1);
      case 'flip': this.sample('deal', t, 0.32 * g, 1.55); this.sample('deal', t + 0.07, 0.22 * g, 1.75); return this.whoosh(t, 0.06 * g);
      case 'sweep': this.sample('sweep', t, 0.55 * g, 1.05, undefined, opts.seat, opts.playerCount); return this.whoosh(t, 0.18 * g);
      case 'bid': return this.sample('bid', t, 0.9 * g, 1);
      case 'bidSoft': return this.sample('bid', t, 0.35 * g, 1.15);
      case 'pop': return this.sample('pop', t, 0.45 * g, 1.2);
      case 'turn': return this.chime(t, g);
      case 'cut': return this.cutHit(t, g);
      case 'broken': this.cutHit(t, g * 0.8); return this.brokenSting(t + 0.06, g);
      case 'made': return this.arp(t, [523.25, 659.25, 783.99, 1046.5], 0.075, 'triangle', 0.22 * g, 0.5);
      case 'nil': return this.fanfare(t, g);
      case 'set': return this.sadTrombone(t, g);
      case 'bags': return this.buzz(t, g);
      case 'win': return this.winJingle(t, g);
      case 'lose': return this.loseJingle(t, g);
      case 'jokerLittle': return this.thud(t, g);
      case 'jokerBig': return this.quake(t, g);
      case 'nuke': return this.nukeBoom(t, g);
      case 'mega': return this.megaBoom(t, g);
      case 'streak1': return this.streakHit(t, g, 1);
      case 'streak2': return this.streakHit(t, g, 2);
      case 'streak3': return this.streakHit(t, g, 3);
      case 'shot': return this.slam(t, g);
      case 'gotShot': return this.sting(t, g);
      case 'shotgun': return this.shotgunBoom(t, g);
      case 'pump': return this.shotgunPump(t, g);
      case 'siren': return this.siren(t, g);
      case 'cloth': return this.clothRustle(t, g);
      case 'versusWhoosh': return this.versusWhoosh(t, g, opts.versusSide ?? -1);
      case 'versusImpact': return this.versusImpact(t, g);
      case 'versusSting': return this.versusSting(t, g);
      case 'versusCrowd': return this.versusCrowd(t, g);
      case 'versusResolve': return this.versusResolve(t, g);
      case 'dmChime': return this.chatTones(t, g, DM_CHIME_TONES);
      case 'chatBlip': return this.chatTones(t, g, CHAT_BLIP_TONES);
      case 'docSting': return this.docSting(t, g);
      // wheels: a quick rising two-step + hit (short, not a fanfare)
      case 'wheelsCar': return this.peelOut(t, g);
      case 'overcut': return this.overcutSlam(t, g, 2);
      case 'overcut3': return this.overcutSlam(t, g, 3);
      case 'tornado': return this.tornado(t, g);
      case 'runSlam': this.overcutSlam(t, g * 1.05, 3); this.thud(t, g * 0.9); return this.quake(t + 0.03, g * 0.8); // heavy slow-mo impact + bass hit
      case 'runThud': for (let i = 0; i < 4; i++) this.thud(t + i * 0.055, g * (0.42 - i * 0.07)); return;
      case 'wheels': this.arp(t, [392, 523.25, 783.99], 0.06, 'square', 0.12 * g, 0.22); return this.streakHit(t + 0.16, 0.8 * g, 1);
    }
  }

  private sample(key: string, t: number, gain: number, rate = 1, maxDur?: number, seat?: SeatPos, playerCount = 4) {
    const c = this.ctx!; const list = FILES[key]!;
    const vi = pickVariant(list.length, this.lastVariant.get(key) ?? -1);
    this.lastVariant.set(key, vi);
    const buf = this.buffers.get(list[vi]!);
    if (!buf) return;
    const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = gain;
    const route = this.routeSfx(key, seat, playerCount);
    // Card-surface character (Phase 4): felt is softer, glass/wood slap brighter — card sounds only.
    if (this.roomStyle && (key === 'play' || key === 'deal' || key === 'sweep')) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = surfaceHz(this.roomStyle);
      src.connect(g).connect(f).connect(route.node);
    } else src.connect(g).connect(route.node);
    if (route.release) src.onended = () => route.release!();
    src.start(t);
    if (maxDur) { g.gain.setValueAtTime(gain, t + Math.max(0, maxDur - 0.18)); g.gain.linearRampToValueAtTime(0.0001, t + maxDur); src.stop(t + maxDur + 0.05); }
  }

  private tone(t: number, freq: number, dur: number, type: OscillatorType, gain: number, opts: { attack?: number; glideTo?: number; filter?: number; dest?: AudioNode } = {}) {
    const c = this.ctx!;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (opts.glideTo) o.frequency.exponentialRampToValueAtTime(opts.glideTo, t + dur);
    const g = c.createGain();
    const a = opts.attack ?? 0.008;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (opts.filter) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.filter; node.connect(f); node = f; }
    node.connect(g).connect(opts.dest ?? this.sfxBus!);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /**
   * Decode the sfx buffers (card foley and the sheet siren) and fill the noise bank.
   * Safe before a gesture: a blocked context just skips. The returned promise is the
   * same load the context started, so the loading screen can wait until the siren is decoded.
   */
  warmEffects(): Promise<void> | undefined {
    try {
      const c = this.ensure();
      if (!c || c.state === 'closed') return;
      for (const dur of EFFECT_NOISE_SECONDS) this.noise(dur);
      this.shaper(12);
      return this.load() ?? Promise.resolve();
    } catch { /* autoplay policy: the next gesture still builds them */ }
  }

  private noise(dur: number): AudioBuffer {
    const c = this.ctx!;
    const key = Math.round(dur * 1000);
    const hit = this.noiseBank.get(key);
    if (hit && hit.sampleRate === c.sampleRate) return hit;
    const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBank.set(key, b);
    return b;
  }

  private whoosh(t: number, gain: number) {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noise(0.5);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.22); f.frequency.exponentialRampToValueAtTime(900, t + 0.45);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.12); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
    s.connect(f).connect(g).connect(this.sfxBus!); s.start(t); s.stop(t + 0.5);
  }

  /** Fabric unfurl: band-swept noise with three soft rustle swells, ~0.62s to match the roll. */
  private clothRustle(t: number, g: number) {
    const c = this.ctx!;
    const dur = 0.62;
    const s = c.createBufferSource(); s.buffer = this.noise(1); s.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.75;
    f.frequency.setValueAtTime(820, t);
    f.frequency.exponentialRampToValueAtTime(2400, t + dur * 0.55);
    f.frequency.exponentialRampToValueAtTime(680, t + dur);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.11 * g, t + 0.07); // first unfurl
    gn.gain.exponentialRampToValueAtTime(0.05 * g, t + 0.22);
    gn.gain.exponentialRampToValueAtTime(0.09 * g, t + 0.36); // second ripple
    gn.gain.exponentialRampToValueAtTime(0.035 * g, t + 0.5);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur); // settle
    s.connect(f).connect(gn).connect(this.sfxBus!); s.start(t); s.stop(t + dur + 0.05);
  }

  private chime(t: number, g: number) {
    this.tone(t, 1318.5, 0.5, 'sine', 0.16 * g);
    this.tone(t + 0.09, 1975.5, 0.65, 'sine', 0.12 * g);
    this.tone(t, 2637, 0.25, 'sine', 0.03 * g);
  }

  /** Chat notification sounds: play a tone spec (DM_CHIME_TONES / CHAT_BLIP_TONES) on the sfx bus. */
  private chatTones(t: number, g: number, tones: ChatTone[]) {
    for (const n of tones) this.tone(t + n.at, n.freq, n.dur, n.type, n.gain * g, n.glideTo ? { glideTo: n.glideTo } : {});
  }

  private arp(t: number, notes: number[], step: number, type: OscillatorType, gain: number, tail: number) {
    notes.forEach((f, i) => this.tone(t + i * step, f, tail, type, gain, { filter: 4000 }));
  }

  /** Trump-in "cut": a sharp snap + low punch + a quick metallic downward swipe. */
  /**
   * Trump-in "cut" (picked from 3 rendered candidates, see scripts/sound-lab/cut-candidates.mjs): a card slap with a
   * bright, short transient + a low punch, topped by a quick blade "shing" (inharmonic partials gliding down 3 %).
   * ~120 ms, little energy above 6 kHz, so it's crisp without being harsh.
   */
  private cutHit(t: number, g: number) {
    this.burst(t, 0.012, 0.8 * g, 'highpass', 1100);
    this.burst(t, 0.04, 0.35 * g, 'lowpass', 1400);
    this.tone(t, 170, 0.1, 'sine', 0.65 * g, { glideTo: 65, attack: 0.001 });
    this.shing(t + 0.006, 0.75 * g, 1, 0.22);
  }

  /** Blade "shing": a rising band-passed swipe + metallic partials (k scales the pitch: lower = heavier). */
  private shing(t: number, g: number, k = 1, len = 0.32) {
    this.burst(t, 0.06, 0.35 * g, 'bandpass', 1500 * k, { q: 1.4, sweepTo: 6000 * k });
    ([[2093, 0.16], [3136 * 1.01, 0.11], [4699, 0.07], [5587, 0.04]] as const).forEach(([f, a], i) =>
      this.tone(t + 0.012, f * k, len * (1 - i * 0.15), 'sine', a * g, { glideTo: f * k * 0.97, attack: 0.002 }));
  }

  private brokenSting(t: number, g: number) {
    // low "brass" stab: detuned saws through a closing low-pass + a felt thump
    for (const f of [146.83, 220, 293.66, 349.23]) {
      this.tone(t, f, 0.7, 'sawtooth', 0.07 * g, { filter: 1400, attack: 0.02 });
      this.tone(t, f * 1.006, 0.7, 'sawtooth', 0.05 * g, { filter: 1100, attack: 0.02 });
    }
    this.tone(t, 90, 0.25, 'sine', 0.4 * g, { glideTo: 45 });
    this.tone(t + 0.16, 587.33, 0.5, 'triangle', 0.08 * g);
  }

  private fanfare(t: number, g: number) {
    const n = [523.25, 659.25, 783.99, 1046.5];
    n.forEach((f, i) => { this.tone(t + i * 0.07, f, 0.22, 'square', 0.06 * g, { filter: 3000 }); this.tone(t + i * 0.07, f, 0.3, 'triangle', 0.12 * g); });
    for (const f of [523.25, 659.25, 783.99, 1046.5]) this.tone(t + 0.32, f, 0.9, 'sawtooth', 0.045 * g, { filter: 2600, attack: 0.03 });
    this.tone(t + 0.32, 2093, 0.9, 'sine', 0.05 * g);
  }

  private sadTrombone(t: number, g: number) {
    const n = [392, 370, 349.23];
    n.forEach((f, i) => this.tone(t + i * 0.2, f, 0.22, 'sawtooth', 0.11 * g, { filter: 900, attack: 0.03 }));
    this.tone(t + 0.6, 329.63, 0.75, 'sawtooth', 0.12 * g, { filter: 800, attack: 0.03, glideTo: 311 });
  }

  private buzz(t: number, g: number) {
    this.tone(t, 110, 0.38, 'square', 0.09 * g, { filter: 700 });
    this.tone(t, 116.5, 0.38, 'square', 0.07 * g, { filter: 700 });
  }

  private winJingle(t: number, g: number) {
    const mel = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    mel.forEach((f, i) => this.tone(t + i * 0.11, f, 0.3, 'triangle', 0.18 * g));
    for (const f of [261.63, 329.63, 392, 523.25]) this.tone(t + 0.66, f, 1.4, 'sawtooth', 0.04 * g, { filter: 2200, attack: 0.04 });
    this.tone(t + 0.66, 1318.5, 1.2, 'sine', 0.08 * g);
  }

  private loseJingle(t: number, g: number) {
    const mel = [493.88, 440, 392, 329.63];
    mel.forEach((f, i) => this.tone(t + i * 0.22, f, 0.4, 'triangle', 0.16 * g));
    for (const f of [164.81, 196, 246.94]) this.tone(t + 0.88, f, 1.4, 'sawtooth', 0.04 * g, { filter: 900, attack: 0.05 });
  }

  /* ---------- hype effects (synthesized) ---------- */
  private shaper(amount: number): WaveShaperNode {
    const c = this.ctx!;
    const ws = c.createWaveShaper();
    const n = 1024; const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
    ws.curve = curve; ws.oversample = '2x';
    return ws;
  }

  /** a noise burst through a filter, with an exponential decay */
  private burst(t: number, dur: number, gain: number, type: BiquadFilterType, freq: number, opts: { q?: number; sweepTo?: number; dest?: AudioNode } = {}) {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noise(dur + 0.05);
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); if (opts.q) f.Q.value = opts.q;
    if (opts.sweepTo) f.frequency.exponentialRampToValueAtTime(opts.sweepTo, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(opts.dest ?? this.sfxBus!); s.start(t); s.stop(t + dur + 0.05);
  }

  /** Little Joker: a hard, jarring thud (distorted low punch + knock). */
  private thud(t: number, g: number) {
    const c = this.ctx!;
    const dist = this.shaper(18); const out = c.createGain(); out.gain.value = 0.55 * g;
    dist.connect(out).connect(this.sfxBus!);
    this.tone(t, 95, 0.38, 'sine', 0.9, { glideTo: 38, attack: 0.002, dest: dist });
    this.tone(t, 190, 0.12, 'triangle', 0.4, { glideTo: 70, attack: 0.002, dest: dist });
    this.burst(t, 0.16, 0.55 * g, 'lowpass', 900, { sweepTo: 120 });
    this.burst(t, 0.05, 0.35 * g, 'highpass', 2500);
  }

  /** Big Joker: deeper, longer, louder quake (sub drop + rattling rumble + dissonant low stab). */
  private quake(t: number, g: number) {
    const c = this.ctx!;
    const dist = this.shaper(30); const out = c.createGain(); out.gain.value = 0.75 * g;
    dist.connect(out).connect(this.sfxBus!);
    this.tone(t, 70, 1.25, 'sine', 1, { glideTo: 26, attack: 0.003, dest: dist });
    this.tone(t, 55, 0.9, 'sawtooth', 0.35, { glideTo: 30, filter: 400, attack: 0.005, dest: dist });
    this.tone(t, 58.3, 0.9, 'sawtooth', 0.3, { glideTo: 31, filter: 400, attack: 0.005, dest: dist });
    // the rattle: low noise, amplitude-modulated ~11 Hz
    const s = c.createBufferSource(); s.buffer = this.noise(1.6);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(260, t); lp.frequency.exponentialRampToValueAtTime(70, t + 1.5);
    const am = c.createGain(); am.gain.value = 0.5;
    const lfo = c.createOscillator(); lfo.frequency.value = 11; const lfoG = c.createGain(); lfoG.gain.value = 0.5;
    lfo.connect(lfoG).connect(am.gain);
    const env = c.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(0.9 * g, t + 0.04); env.gain.exponentialRampToValueAtTime(0.0001, t + 1.55);
    s.connect(lp).connect(am).connect(env).connect(this.sfxBus!); s.start(t); s.stop(t + 1.6); lfo.start(t); lfo.stop(t + 1.6);
    this.burst(t, 0.08, 0.5 * g, 'highpass', 1800);
  }

  /**
   * Big Joker over Little Joker (synced with the 3D nuke): a held-breath beat with a faint inward hiss, then at +0.3 s a
   * layered sub-bass boom (sine sweep + noise through a soft clipper), a delayed crack, a long rolling rumble tail with
   * debris crackle, and a short ringing "tinnitus" tone while the music and the other SFX duck for about a second.
   */
  private nukeBoom(t0: number, g: number) {
    const c = this.ctx!;
    const bus = this.nukeBus ?? this.sfxBus!;
    const t = t0 + 0.3;
    this.burst(t0, 0.32, 0.12 * g, 'bandpass', 400, { q: 0.8, sweepTo: 3200, dest: bus }); // inward hiss / suck-in
    const dist = this.shaper(30); const out = c.createGain(); out.gain.value = 0.9 * g; dist.connect(out).connect(bus);
    this.tone(t, 95, 2.8, 'sine', 1, { glideTo: 20, attack: 0.003, dest: dist }); // boom sweep
    this.tone(t, 48, 3.4, 'sine', 0.9 * g, { glideTo: 28, attack: 0.02, dest: bus }); // sub-bass body
    this.tone(t, 140, 0.5, 'sawtooth', 0.35, { glideTo: 32, filter: 500, dest: dist }); // chest punch
    this.burst(t, 0.5, 0.9 * g, 'lowpass', 1400, { sweepTo: 120, dest: bus }); // blast noise
    this.burst(t + 0.13, 0.16, 0.95 * g, 'highpass', 1500, { dest: bus }); // delayed crack
    this.burst(t + 0.15, 0.3, 0.5 * g, 'bandpass', 3200, { q: 0.7, sweepTo: 900, dest: bus });
    this.burst(t + 0.2, 4.2, 0.8 * g, 'lowpass', 420, { sweepTo: 38, dest: bus }); // rolling rumble tail
    this.burst(t + 0.5, 3.0, 0.22 * g, 'bandpass', 700, { q: 0.6, sweepTo: 160, dest: bus }); // wind
    for (let i = 0; i < 60; i++) { // debris crackle, thinning out
      const dt = 0.35 + Math.pow(Math.random(), 1.6) * 2.8;
      this.burst(t + dt, 0.018 + Math.random() * 0.03, Math.max(0.02, 0.2 - dt * 0.05) * g * (0.5 + Math.random()), 'bandpass', 1800 + Math.random() * 4200, { q: 3, dest: bus });
    }
    // tinnitus ring: a thin high sine with a slight beat, swelling in after the boom and fading out
    [6100, 6113].forEach((f) => {
      const o = c.createOscillator(); o.frequency.value = f;
      const e = c.createGain(); e.gain.setValueAtTime(0.0001, t + 0.15); e.gain.exponentialRampToValueAtTime(0.035 * g, t + 0.35); e.gain.setValueAtTime(0.035 * g, t + 1.0); e.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
      o.connect(e).connect(bus); o.start(t + 0.15); o.stop(t + 2.2);
    });
    // duck the music and the other SFX for ~1 s, then recover
    for (const d of [this.musicDuck, this.sfxDuck]) {
      if (!d) continue;
      d.gain.cancelScheduledValues(t0);
      d.gain.setValueAtTime(d.gain.value, t0);
      d.gain.setTargetAtTime(0.12, t + 0.05, 0.05);
      d.gain.setTargetAtTime(1, t + 1.2, 0.35);
    }
  }

  /**
   * ☢☢ MEGA boom (a Run it! with both Jokers): the nuke's whole stack, then a SECOND, deeper
   * detonation ~1.15 s after the first flash — timed to the visual's second shockwave — with a
   * longer rumble tail, a fresh round of debris, and the table's crowd "ohhh" over it.
   * Same synthesized vocabulary as the nuke (no new samples), just stacked one tier higher.
   */
  private megaBoom(t0: number, g: number) {
    this.nukeBoom(t0, g);
    const c = this.ctx!;
    const bus = this.nukeBus ?? this.sfxBus!;
    const t = t0 + 0.3 + 1.15; // the second stage (the first flash is at t0 + 0.3, like the nuke)
    const dist = this.shaper(36); const out = c.createGain(); out.gain.value = 0.9 * g; dist.connect(out).connect(bus);
    this.tone(t, 80, 3.4, 'sine', 1, { glideTo: 17, attack: 0.003, dest: dist }); // second boom sweep, deeper
    this.tone(t, 40, 4.2, 'sine', 0.95 * g, { glideTo: 24, attack: 0.02, dest: bus }); // sub-bass body
    this.tone(t, 120, 0.6, 'sawtooth', 0.4, { glideTo: 28, filter: 450, dest: dist }); // chest punch
    this.burst(t, 0.6, 0.95 * g, 'lowpass', 1600, { sweepTo: 100, dest: bus }); // second blast noise
    this.burst(t + 0.12, 0.18, 0.95 * g, 'highpass', 1400, { dest: bus }); // second crack
    this.burst(t + 0.25, 5.0, 0.85 * g, 'lowpass', 380, { sweepTo: 34, dest: bus }); // longer rolling rumble
    for (let i = 0; i < 44; i++) { // debris crackle, second round
      const dt = 0.3 + Math.pow(Math.random(), 1.6) * 3.4;
      this.burst(t + dt, 0.018 + Math.random() * 0.03, Math.max(0.02, 0.2 - dt * 0.04) * g * (0.5 + Math.random()), 'bandpass', 1600 + Math.random() * 4200, { q: 3, dest: bus });
    }
    this.crowdOh(t + 0.35, 0.9 * g); // the table loses it at the second blast
    // duck the music and the other SFX again for the second hit, then recover
    for (const d of [this.musicDuck, this.sfxDuck]) {
      if (!d) continue;
      d.gain.cancelScheduledValues(t);
      d.gain.setValueAtTime(d.gain.value, t);
      d.gain.setTargetAtTime(0.1, t + 0.05, 0.05);
      d.gain.setTargetAtTime(1, t + 1.4, 0.4);
    }
  }

  /** Over-cut: a heavier slam than a cut (deep punch + wood knock + gritty crack) and a short rising sting. */
  private overcutSlam(t: number, g0: number, lvl = 2) {
    const g = g0 * (lvl >= 3 ? 1.25 : 1);
    const dist = this.shaper(lvl >= 3 ? 40 : 25); const out = this.ctx!.createGain(); out.gain.value = 0.8 * g; dist.connect(out).connect(this.sfxBus!);
    this.tone(t, 120, 0.32, 'sine', 1, { glideTo: 38, attack: 0.002, dest: dist }); // deep punch
    this.tone(t, 240, 0.09, 'triangle', 0.5, { glideTo: 110, attack: 0.001, dest: dist }); // knock
    this.burst(t, 0.07, 0.6 * g, 'bandpass', 2600, { q: 0.9 }); // crack
    this.burst(t, 0.18, 0.25 * g, 'lowpass', 500, { sweepTo: 120 }); // body
    this.shing(t + 0.005, 0.55 * g, 0.82); // the blade, lower and darker than a cut
    // sting: two quick rising minor stabs
    [[311.13, 0.09], [369.99, 0.16]].forEach(([f, d]) => {
      this.tone(t + d, f, 0.32, 'sawtooth', 0.09 * g, { filter: 2400, attack: 0.006 });
      this.tone(t + d, f * 1.5, 0.32, 'sawtooth', 0.06 * g, { filter: 2400, attack: 0.006 });
    });
    if (lvl >= 3) {
      // layered: a pitched-up second slam + a brighter third stab, then the crowd "ohhh"
      this.tone(t + 0.05, 180, 0.25, 'sine', 0.6 * g, { glideTo: 60, attack: 0.002 });
      this.shing(t + 0.05, 0.5 * g, 1.25, 0.3);
      this.tone(t + 0.24, 466.16, 0.45, 'sawtooth', 0.09 * g, { filter: 3000, attack: 0.006 });
      this.tone(t + 0.24, 699.24, 0.45, 'sawtooth', 0.07 * g, { filter: 3000, attack: 0.006 });
      this.crowdOh(t + 0.18, 0.9 * g0);
    }
  }

  /** Synthesised crowd "ohhh": a dozen detuned voices through "o" vowel formants, swelling then falling in pitch. */
  private crowdOh(t: number, g: number) {
    const c = this.ctx!;
    const f1 = c.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 480; f1.Q.value = 3;
    const f2 = c.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 820; f2.Q.value = 4;
    const env = c.createGain(); env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(0.5 * g, t + 0.22); env.gain.setValueAtTime(0.5 * g, t + 0.55); env.gain.exponentialRampToValueAtTime(0.0001, t + 1.25);
    const mix = c.createGain(); mix.gain.value = 1;
    mix.connect(f1).connect(env); mix.connect(f2).connect(env); env.connect(this.sfxBus!);
    for (let i = 0; i < 12; i++) {
      const o = c.createOscillator(); o.type = 'sawtooth';
      const f = 130 + Math.random() * 190; const s = t + Math.random() * 0.08;
      o.frequency.setValueAtTime(f * 1.04, s); o.frequency.exponentialRampToValueAtTime(f * 0.86, t + 1.2);
      const vib = c.createOscillator(); vib.frequency.value = 4 + Math.random() * 2; const vg = c.createGain(); vg.gain.value = f * 0.012; vib.connect(vg).connect(o.frequency);
      const og = c.createGain(); og.gain.value = 0.12;
      o.connect(og).connect(mix); o.start(s); o.stop(t + 1.3); vib.start(s); vib.stop(t + 1.3);
    }
    this.burst(t, 1.1, 0.06 * g, 'bandpass', 1200, { q: 0.5 }); // breath / room
  }

  /**
   * Wheels celebration: a deep sports-car engine revs (two blips + a bigger third), tyres squeal as it launches,
   * then the engine pulls away into the distance (falling pitch + volume, closing low-pass). Synthesised:
   * stacked saw / square oscillators on one RPM curve → overdrive → RPM-tracking low-pass, with a firing-rate
   * growl (amplitude LFO). Loud and punchy on purpose (it's a celebration).
   */
  private peelOut(t: number, g: number) {
    const c = this.ctx!;
    const END = 3.3;
    // RPM curve, as the engine's firing frequency (Hz): idle → rev → drop → rev → drop → big rev → launch → away
    const rpm: [number, number][] = [[0, 38], [0.16, 120], [0.36, 50], [0.5, 135], [0.7, 52], [0.82, 160], [0.95, 92], [1.5, 185], [1.95, 205], [2.6, 150], [END, 120]];
    const vol: [number, number][] = [[0, 0.35], [0.16, 1], [0.36, 0.5], [0.5, 1], [0.7, 0.5], [0.82, 1], [0.95, 0.85], [1.5, 1], [1.95, 0.75], [2.6, 0.3], [END, 0.0001]];
    const curve = (p: AudioParam, pts: [number, number][], k = 1, floor = 0.0001) => {
      p.setValueAtTime(Math.max(floor, pts[0]![1] * k), t);
      for (let i = 1; i < pts.length; i++) p.exponentialRampToValueAtTime(Math.max(floor, pts[i]![1] * k), t + pts[i]![0]);
    };
    const drive = this.shaper(60);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    curve(lp.frequency, rpm.map(([x, f], i) => [x, f * (i >= 8 ? 7 - (i - 8) * 1.5 : 9)] as [number, number]), 1, 60);
    const growl = c.createGain(); growl.gain.value = 0.65;
    const amp = c.createGain(); curve(amp.gain, vol, 1.1 * g);
    drive.connect(lp).connect(growl).connect(amp).connect(this.sfxBus!);
    const oscs: OscillatorNode[] = [];
    const add = (type: OscillatorType, mult: number, level: number, detune = 0) => {
      const o = c.createOscillator(); o.type = type; o.detune.value = detune;
      curve(o.frequency, rpm, mult, 10);
      const og = c.createGain(); og.gain.value = level;
      o.connect(og).connect(drive); oscs.push(o);
    };
    add('sawtooth', 1, 0.5); add('sawtooth', 1, 0.35, 14); add('square', 0.5, 0.45); add('sawtooth', 2, 0.18, -8); add('sine', 0.25, 0.6);
    // firing-rate growl: amplitude wobble at ~ RPM / 2
    const lfo = c.createOscillator(); lfo.type = 'square'; curve(lfo.frequency, rpm, 0.5, 5);
    const lfoG = c.createGain(); lfoG.gain.value = 0.35; lfo.connect(lfoG).connect(growl.gain); oscs.push(lfo);
    oscs.forEach((o) => { o.start(t); o.stop(t + END + 0.05); });
    // exhaust pops / crackle on each lift-off
    for (const at of [0.37, 0.71, 0.97]) for (let i = 0; i < 4; i++) this.burst(t + at + i * 0.045 + Math.random() * 0.02, 0.03, 0.28 * g, 'bandpass', 500 + Math.random() * 500, { q: 2 });
    // launch thump
    this.tone(t + 0.95, 70, 0.4, 'sine', 0.7 * g, { glideTo: 40, attack: 0.004 });
    // tyre squeal: narrow band noise + a wobbling sine pair, 0.95 → 1.9 s
    const sq = c.createBufferSource(); sq.buffer = this.noise(1.1);
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 9; bp.frequency.value = 2700;
    const wob = c.createOscillator(); wob.frequency.value = 9; const wobG = c.createGain(); wobG.gain.value = 220; wob.connect(wobG).connect(bp.frequency);
    const sg = c.createGain(); sg.gain.setValueAtTime(0.0001, t + 0.95); sg.gain.exponentialRampToValueAtTime(0.75 * g, t + 1.02); sg.gain.setValueAtTime(0.75 * g, t + 1.55); sg.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    sq.connect(bp).connect(sg).connect(this.sfxBus!); sq.start(t + 0.95); sq.stop(t + 2.05); wob.start(t + 0.95); wob.stop(t + 2.05);
    for (const [f, d] of [[2950, 0], [3420, 7]] as const) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.detune.value = d;
      const w = c.createOscillator(); w.frequency.value = 11; const wg = c.createGain(); wg.gain.value = 90; w.connect(wg).connect(o.frequency);
      const og = c.createGain(); og.gain.setValueAtTime(0.0001, t + 0.97); og.gain.exponentialRampToValueAtTime(0.09 * g, t + 1.05); og.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
      o.connect(og).connect(this.sfxBus!); o.start(t + 0.97); o.stop(t + 2); w.start(t + 0.97); w.stop(t + 2);
    }
  }

  private tornadoOut: GainNode | null = null;
  /**
   * 'Run it!' tornado (~2.6 s): a howling wind (resonant band-passed noise whose pitch rises and wobbles as the
   * funnel spins up, over a low rumble), whooshes as cards get pulled in, and a big gust when everything is flung away.
   */
  private tornado(t: number, g: number) {
    const c = this.ctx!;
    const END = 2.6;
    const out = c.createGain();
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.9 * g, t + 0.5);
    out.gain.setValueAtTime(0.9 * g, t + 1.9); out.gain.exponentialRampToValueAtTime(0.0001, t + END);
    out.connect(this.sfxBus!);
    this.tornadoOut = out;
    for (const [f0, f1, q, lvl] of [[320, 950, 7, 0.55], [520, 1500, 10, 0.3]] as const) {
      const src = c.createBufferSource(); src.buffer = this.noise(END + 0.1);
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
      bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + 1.6); bp.frequency.exponentialRampToValueAtTime(f0 * 1.3, t + END);
      const lfo = c.createOscillator(); lfo.frequency.value = 2.3 + q * 0.1; const lg = c.createGain(); lg.gain.value = f0 * 0.25; lfo.connect(lg).connect(bp.frequency);
      const gg = c.createGain(); gg.gain.value = lvl;
      src.connect(bp).connect(gg).connect(out); src.start(t); src.stop(t + END + 0.05); lfo.start(t); lfo.stop(t + END + 0.05);
    }
    const rum = c.createBufferSource(); rum.buffer = this.noise(END + 0.1);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const rg = c.createGain(); rg.gain.value = 0.9;
    rum.connect(lp).connect(rg).connect(out); rum.start(t); rum.stop(t + END + 0.05);
    for (const at of [0.35, 0.7, 1.0, 1.3]) this.burst(t + at, 0.35, 0.16 * g, 'bandpass', 600, { q: 1.2, sweepTo: 2600, dest: out });
    this.burst(t + 1.85, 0.7, 0.35 * g, 'bandpass', 2400, { q: 0.8, sweepTo: 300, dest: out }); // the fling
  }
  /** Skip: fade the wind out now. */
  stopTornado() {
    const o = this.tornadoOut, c = this.ctx;
    if (!o || !c) return;
    o.gain.cancelScheduledValues(c.currentTime); o.gain.setTargetAtTime(0.0001, c.currentTime, 0.08);
    this.tornadoOut = null;
  }

  /** Streak stingers that escalate: 1 = HEAT CHECK, 2 = ON FIRE, 3 = UNSTOPPABLE. */
  private streakHit(t: number, g: number, lvl: number) {
    // riser
    this.burst(t, 0.35 + lvl * 0.15, 0.16 * g, 'bandpass', 400, { q: 1.5, sweepTo: 3500 + lvl * 1500 });
    const at = t + 0.3 + lvl * 0.12;
    const root = [392, 440, 523.25][lvl - 1]!;
    const chord = [1, 1.25, 1.5, 2].map((k) => root * k);
    chord.forEach((f, i) => { this.tone(at + i * 0.045, f, 0.5 + lvl * 0.2, 'sawtooth', (0.05 + lvl * 0.015) * g, { filter: 2500 + lvl * 800, attack: 0.01 }); });
    this.tone(at, root / 2, 0.6, 'square', 0.08 * g, { filter: 800 });
    this.tone(at, 90, 0.3, 'sine', (0.3 + lvl * 0.15) * g, { glideTo: 45, attack: 0.002 });
    if (lvl >= 2) this.burst(at, 0.9, 0.12 * g, 'bandpass', 900, { q: 0.6, sweepTo: 5000 }); // flame whoosh
    if (lvl >= 3) {
      this.burst(at, 1.6, 0.18 * g, 'highpass', 6000); // crash cymbal
      [root * 2, root * 2.5, root * 3, root * 4].forEach((f, i) => this.tone(at + 0.18 + i * 0.07, f, 0.5, 'triangle', 0.08 * g));
    }
  }

  /** "SHOT!": slam impact — punch, crack, metallic ring, brass stab. */
  private slam(t: number, g: number) {
    const c = this.ctx!;
    const dist = this.shaper(12); const out = c.createGain(); out.gain.value = 0.6 * g;
    dist.connect(out).connect(this.sfxBus!);
    this.tone(t, 140, 0.4, 'sine', 1, { glideTo: 40, attack: 0.002, dest: dist });
    this.burst(t, 0.2, 0.7 * g, 'highpass', 1500);
    this.tone(t + 0.01, 1180, 0.8, 'square', 0.04 * g, { filter: 5000 });
    this.tone(t + 0.01, 1590, 0.7, 'square', 0.03 * g, { filter: 5000 });
    for (const f of [146.83, 207.65, 293.66]) this.tone(t + 0.04, f, 0.6, 'sawtooth', 0.08 * g, { filter: 1600, attack: 0.01 });
  }

  /**
   * RIP sheet: recorded Whelen police wail (CREDITS.md), already trimmed and faded.
   * 0.32 sits under shotgunBoom (boom 0.95, muzzle crack 0.72) and the 120 ms rise
   * lets that crack lead, so the shot stays on top. The file is in FILES and decoded
   * by warmEffects. Goes out the sfx bus, so mute and the volume slider apply.
   */
  private siren(t: number, g: number) {
    const buf = this.buffers.get('siren');
    if (!buf || g <= 0) return;
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    const peak = 0.32 * g;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.12);
    src.connect(gain).connect(this.sfxBus!);
    src.start(t);
  }

  /**
   * Spray-paint screen transition (owner, 2026-10-23: "add sound to it —
   * not no cheesy sounds, let's get authentic"): REAL recorded cans, both
   * CC0 Freesound foley (CREDITS.md) — a rattle-ball shake and a close-nozzle
   * aerosol hiss cut as a seamless 2 s loop. Driven by spraySound.ts off the
   * spray controller's phase events, never by hard-coded picture timings.
   * Sync map: on a fresh cover the shake leads (the tagger shakes, then
   * sprays) and the hiss starts as the shake's strikes end; on a snap-back
   * re-cover there is no second shake, the hiss just resumes. Everything
   * rides the sfx bus, so the SFX volume and mute govern it, modest under
   * any music. Silent when sound is off, before the first gesture unlock,
   * or while the context is suspended — the picture never waits on sound.
   */
  spraySoundStart(fresh: boolean, hissDelayS = 0): void {
    if (!this.settings.on || !this.unlocked) return;
    this.ensure();
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.sfxBus) return;
    this.spraySoundStop(0.04); // one can at a time: a re-cover restarts clean
    const t = c.currentTime;
    if (fresh) {
      const shake = this.buffers.get('spray-shake');
      if (shake) {
        const src = c.createBufferSource(); src.buffer = shake;
        const g = c.createGain(); g.gain.value = 0.9;
        src.connect(g).connect(this.sfxBus);
        src.start(t);
        this.played.sprayShake = (this.played.sprayShake ?? 0) + 1;
      }
    }
    const hissBuf = this.buffers.get('spray-hiss');
    if (!hissBuf) return;
    const src = c.createBufferSource(); src.buffer = hissBuf; src.loop = true;
    const g = c.createGain();
    const t0 = t + Math.max(0, hissDelayS);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.07);
    src.connect(g).connect(this.sfxBus);
    src.start(t0);
    this.sprayNodes = { src, gain: g };
    this.played.sprayHiss = (this.played.sprayHiss ?? 0) + 1;
  }

  /** Stop the spray hiss with a short exponential decay (the bloom swallows
   *  it as the cover completes) or a near-cut (the spray was cancelled —
   *  no orphaned hiss over the next screen). Safe when nothing is playing,
   *  and when the hiss is still only scheduled (a cancel inside the shake's
   *  lead): a stop time before the start time means it never sounds. */
  spraySoundStop(fadeS = 0.15): void {
    const nodes = this.sprayNodes;
    this.sprayNodes = null;
    if (!nodes || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const fade = Math.max(0.03, fadeS);
      const g = nodes.gain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(Math.max(g.value, 0.0001), t);
      g.exponentialRampToValueAtTime(0.0001, t + fade);
      nodes.src.stop(t + fade + 0.05);
    } catch { /* context already rebuilt: the old nodes died with it */ }
  }

  /**
   * Cop drive-by system (Demetrius 2026-10-19): positional gunfire + siren on the
   * venue (ambience) bus. Gunfire comes from a random direction each time;
   * the siren pans across as the cruiser "drives by". Variants rotate via
   * pickVariant so it never sounds the same twice in a row.
   */
  private lastGunfireVariant = -1;
  private lastSirenVariant = -1;

  /** One-shot panner at an azimuth (degrees, 0 = ahead) and distance (meters). */
  private drivebyPanner(azimuthDeg: number, distanceM: number): PannerNode | null {
    const c = this.ctx;
    if (!c || typeof PannerNode === 'undefined') return null;
    const p = c.createPanner();
    p.panningModel = this.spatializerModel ?? 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 2.2;
    p.rolloffFactor = 0.7;
    const az = (azimuthDeg * Math.PI) / 180;
    p.positionX.value = Math.sin(az) * distanceM;
    p.positionY.value = 1.5;
    p.positionZ.value = -Math.cos(az) * distanceM;
    return p;
  }

  /**
   * Calm drive-by (animation package, 2026-10-20): a car just passes — a soft
   * tyre/engine swell panning across, no gunfire, and a 'pj-headlights' event
   * so the UI can sweep the headlights across the fence in time with it.
   */
  private headlightPass(t: number) {
    const c = this.ctx!;
    const B = this.venueBus!;
    const pan = this.drivebyPanner(-55, 13);
    if (pan) {
      pan.connect(B);
      pan.positionX.setValueAtTime(-11, t);
      pan.positionX.linearRampToValueAtTime(11, t + 4.4);
      window.setTimeout(() => { try { pan.disconnect(); } catch { /* already gone */ } }, (t - c.currentTime + 6) * 1000);
    }
    const out = pan ?? B;
    const src = c.createBufferSource();
    src.buffer = this.noise(5);
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(320, t); f.frequency.linearRampToValueAtTime(520, t + 2.2); f.frequency.linearRampToValueAtTime(300, t + 4.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4.6);
    src.connect(f).connect(g).connect(out);
    src.start(t); src.stop(t + 4.8);
    window.dispatchEvent(new CustomEvent('pj-headlights'));
  }

  /** 4 gunfire variants: 0 = close pistol, 1 = distant pop, 2 = alley echo, 3 = heavy rifle. */
  private drivebyGunshot(t: number, variant: number, pan: PannerNode | null, dest: AudioNode) {
    const out = pan ?? dest;
    switch (variant) {
      case 0: // close pistol: sharp crack + deep thump
        this.vBurst(t, 0.09, 'highpass', 1800, 0.5, out);
        this.tone(t, 150, 0.15, 'sine', 0.4, { glideTo: 50, dest: out });
        break;
      case 1: // distant pop: filtered, softer, mostly low end
        this.vBurst(t, 0.12, 'lowpass', 900, 0.3, out);
        this.tone(t, 110, 0.2, 'sine', 0.3, { glideTo: 45, dest: out });
        break;
      case 2: // alley echo: crack + two delayed reflections
        this.vBurst(t, 0.08, 'highpass', 2000, 0.45, out);
        this.tone(t, 140, 0.12, 'sine', 0.35, { glideTo: 55, dest: out });
        this.vBurst(t + 0.18, 0.06, 'highpass', 1600, 0.18, out);
        this.vBurst(t + 0.34, 0.05, 'highpass', 1400, 0.1, out);
        break;
      default: // heavy rifle: lower crack, longer body
        this.vBurst(t, 0.14, 'highpass', 1200, 0.5, out);
        this.tone(t, 95, 0.28, 'sine', 0.45, { glideTo: 38, dest: out });
        this.tone(t + 0.01, 800, 0.1, 'square', 0.06, { filter: 3000, dest: out });
        break;
    }
  }

  /** 3 siren variants: 0 = recorded Whelen wail (CC0), 1 = synth yelp, 2 = synth hi-lo. */
  private drivebySirenVariant(t: number, variant: number, pan: PannerNode | null, dest: AudioNode, gain: number) {
    const out = pan ?? dest;
    if (variant === 0) {
      const buf = this.buffers.get('siren');
      if (!buf || !this.ctx) return;
      const c = this.ctx;
      const src = c.createBufferSource();
      src.buffer = buf;
      const g = c.createGain();
      const peak = 0.32 * gain;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(peak, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
      src.connect(g).connect(out);
      src.start(t);
    } else if (variant === 1) {
      // yelp: rapid wail oscillation, ~3 cycles over 2.5s
      for (let i = 0; i < 3; i++) {
        this.tone(t + i * 0.85, 700, 0.8, 'triangle', 0.12 * gain, { glideTo: 1400, dest: out });
        this.tone(t + i * 0.85 + 0.42, 1400, 0.8, 'triangle', 0.12 * gain, { glideTo: 700, dest: out });
      }
    } else {
      // hi-lo: European two-tone, alternating 660/880 Hz
      for (let i = 0; i < 6; i++) {
        const f = i % 2 === 0 ? 660 : 880;
        this.tone(t + i * 0.45, f, 0.42, 'triangle', 0.14 * gain, { dest: out });
      }
    }
  }

  /**
   * Cop drive-by siren (legacy single-shot helper, kept for the SFX path).
   * The bed event now uses drivebySirenVariant with positional panning.
   */
  private drivebySiren(t: number, g: number) {
    const buf = this.buffers.get('siren');
    if (!buf || g <= 0 || !this.venueBus) return;
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = buf;
    const gain = c.createGain();
    const peak = 0.3 * g;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 2.7);
    src.connect(gain).connect(this.venueBus);
    src.start(t);
  }

  /* ---------- Versus intro cues (boxing match card) ----------
   * Layered synthesis through the spatial pipeline, same recipe family as the
   * cop drive-by: HRTF panners in the shared world space (azimuth/distance,
   * y = 1.5) when Spatial audio is on, plain StereoPanner positions when it is
   * off — never a missing sound. Everything lands on the sfx bus, so the SFX
   * channel volume and mute-all apply. Test probe: versusProbe. */
  versusProbe: { cue: string; mode: 'spatial' | 'stereo' | 'bus'; from: number; to: number }[] = [];

  /**
   * Route a versus cue. `azimuthDeg`/`distanceM` place it (0 = dead ahead);
   * `travelTo` ramps the position over `travelSec` (entrances flying to center).
   * Returns the node the cue's layers connect into.
   */
  private versusRoute(cue: string, azimuthDeg: number, distanceM: number, travelTo?: { azimuthDeg: number; distanceM: number; travelSec: number }): AudioNode {
    const c = this.ctx!;
    const bus = this.sfxBus!;
    const push = (mode: 'spatial' | 'stereo' | 'bus') => {
      this.versusProbe.push({ cue, mode, from: azimuthDeg, to: travelTo?.azimuthDeg ?? azimuthDeg });
      if (this.versusProbe.length > 32) this.versusProbe.shift();
    };
    if (this.settings.spatial !== false && typeof PannerNode !== 'undefined') {
      const p = c.createPanner();
      p.panningModel = this.spatializerModel ?? 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 2.2;
      p.rolloffFactor = 0.7;
      const at = (azDeg: number, distM: number) => {
        const az = (azDeg * Math.PI) / 180;
        return { x: Math.sin(az) * distM, z: -Math.cos(az) * distM };
      };
      const from = at(azimuthDeg, distanceM);
      const t = c.currentTime;
      p.positionX.setValueAtTime(from.x, t);
      p.positionY.setValueAtTime(1.5, t);
      p.positionZ.setValueAtTime(from.z, t);
      if (travelTo) {
        const dest = at(travelTo.azimuthDeg, travelTo.distanceM);
        p.positionX.linearRampToValueAtTime(dest.x, t + travelTo.travelSec);
        p.positionZ.linearRampToValueAtTime(dest.z, t + travelTo.travelSec);
      }
      p.connect(bus);
      push('spatial');
      return p;
    }
    if (typeof StereoPannerNode !== 'undefined') {
      const p = c.createStereoPanner();
      const t = c.currentTime;
      p.pan.setValueAtTime(Math.max(-0.85, Math.min(0.85, azimuthDeg / 70)), t);
      if (travelTo) p.pan.linearRampToValueAtTime(Math.max(-0.85, Math.min(0.85, travelTo.azimuthDeg / 70)), t + travelTo.travelSec);
      p.connect(bus);
      push('stereo');
      return p;
    }
    push('bus');
    return bus;
  }

  /** Entrance: a filtered noise sweep that TRAVELS from the side's edge to center as the pics fly in. */
  private versusWhoosh(t: number, g: number, side: -1 | 0 | 1) {
    const c = this.ctx!;
    const out = this.versusRoute('whoosh', side * 58, 9.5, { azimuthDeg: side * 6, distanceM: 3.0, travelSec: 0.95 });
    const s = c.createBufferSource(); s.buffer = this.noise(1.2);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.1;
    f.frequency.setValueAtTime(420, t); f.frequency.exponentialRampToValueAtTime(2500, t + 0.55); f.frequency.exponentialRampToValueAtTime(800, t + 0.95);
    const gn = c.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(0.34 * g, t + 0.5);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    s.connect(f).connect(gn).connect(out); s.start(t); s.stop(t + 1.05);
    // a low air-push under the sweep so it has body, not just hiss
    this.tone(t, 170, 0.9, 'sine', 0.07 * g, { glideTo: 82, dest: out });
  }

  /** The collision: crack + chest thump + sub drop + two room reflections, center-front with depth. */
  private versusImpact(t: number, g: number) {
    const out = this.versusRoute('impact', 0, 2.4);
    this.vBurst(t, 0.09, 'highpass', 1700, 0.5 * g, out);                    // the crack
    this.vBurst(t, 0.16, 'lowpass', 620, 0.4 * g, out);                     // body of the hit
    this.tone(t, 155, 0.5, 'sine', 0.5 * g, { glideTo: 42, dest: out });    // chest thump dropping to sub
    this.tone(t, 92, 0.22, 'square', 0.1 * g, { filter: 640, dest: out });  // knock
    this.vBurst(t + 0.09, 0.07, 'lowpass', 900, 0.15 * g, out);             // room reflection 1
    this.vBurst(t + 0.18, 0.06, 'lowpass', 680, 0.08 * g, out);             // room reflection 2
    this.thud(t + 0.01, 0.7 * g);                                           // the table itself takes it too (centered)
  }

  /** Tale-of-the-tape stinger: a close, present announcer-desk hit as the card lands. */
  private versusSting(t: number, g: number) {
    const out = this.versusRoute('sting', 0, 1.6);
    this.tone(t, 196, 0.5, 'sawtooth', 0.13 * g, { filter: 2300, dest: out });
    this.tone(t + 0.02, 293.66, 0.46, 'sawtooth', 0.1 * g, { filter: 2300, dest: out });
    this.tone(t + 0.02, 587.33, 0.4, 'triangle', 0.09 * g, { dest: out });
    this.tone(t, 98, 0.3, 'sine', 0.2 * g, { glideTo: 58, dest: out });
    this.vBurst(t, 0.05, 'highpass', 3200, 0.12 * g, out); // snap on the attack
  }

  /** Crowd bed under the readable hold: wide, low, tasteful — two enveloping noise washes. */
  private versusCrowd(t: number, g: number) {
    const c = this.ctx!;
    for (const az of [-68, 68]) {
      const out = this.versusRoute('crowd', az, 11);
      const s = c.createBufferSource(); s.buffer = this.noise(3.2); s.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.55; f.frequency.value = az < 0 ? 480 : 540;
      const gn = c.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.exponentialRampToValueAtTime(0.05 * g, t + 0.9);
      gn.gain.setValueAtTime(0.05 * g, t + 1.9);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
      s.connect(f).connect(gn).connect(out); s.start(t); s.stop(t + 3.1);
    }
  }

  /** Soft resolve as the card hands off to the table: two warm notes, close and centered. */
  private versusResolve(t: number, g: number) {
    const out = this.versusRoute('resolve', 0, 1.8);
    this.tone(t, 523.25, 0.5, 'triangle', 0.08 * g, { attack: 0.02, dest: out });
    this.tone(t + 0.09, 783.99, 0.65, 'triangle', 0.07 * g, { attack: 0.02, dest: out });
  }

  /**
   * White-sheet moment: a slow D-minor pad and one camera shutter.
   * Original synthesis, no sampled recording, no third-party license.
   * Not based on any show theme.
   * Goes out the sfx bus, so mute and the volume slider apply.
   */
  private docSting(t: number, g: number) {
    this.tone(t, 73.42, 2.2, 'sine', 0.16 * g, { attack: 0.45, filter: 420 });
    this.tone(t, 110, 2.15, 'triangle', 0.07 * g, { attack: 0.55, filter: 700 });
    this.tone(t + 0.08, 174.61, 2.0, 'sine', 0.05 * g, { attack: 0.6, filter: 900 });
    this.tone(t + 0.7, 349.23, 1.3, 'triangle', 0.03 * g, { attack: 0.35, filter: 1200 });
    this.burst(t + 0.18, 0.035, 0.5 * g, 'highpass', 4200, { q: 0.7 });
    this.burst(t + 0.22, 0.018, 0.18 * g, 'highpass', 6800);
  }

  /**
   * Shotgun pump / rack. Original synthesis in this engine (no sampled recording, no third-party license):
   * a release click, the slide scrape, and the forward lock. Routed through the sfx bus, so mute and volume apply.
   */
  private shotgunPump(t: number, g: number) {
    this.burst(t, 0.035, 0.42 * g, 'highpass', 2200);
    this.tone(t, 180, 0.04, 'square', 0.05 * g, { filter: 2400, attack: 0.001 });
    this.burst(t + 0.05, 0.16, 0.5 * g, 'bandpass', 1100, { q: 0.8, sweepTo: 380 });
    this.burst(t + 0.2, 0.045, 0.62 * g, 'highpass', 1600);
    this.tone(t + 0.2, 120, 0.07, 'triangle', 0.14 * g, { filter: 700, attack: 0.001 });
  }

  /** Scorecard shotgun: a low boom, a muzzle crack, and a short pellet hiss. Goes out the sfx bus, so mute and volume apply. */
  private shotgunBoom(t: number, g: number) {
    this.tone(t, 68, 0.46, 'sine', 0.95 * g, { glideTo: 28, attack: 0.001 });
    this.tone(t, 108, 0.2, 'triangle', 0.32 * g, { glideTo: 40, attack: 0.001 });
    this.burst(t, 0.18, 0.9 * g, 'lowpass', 200, { sweepTo: 48 });
    this.burst(t, 0.07, 0.72 * g, 'highpass', 1700);
    this.burst(t + 0.02, 0.26, 0.32 * g, 'bandpass', 1300, { q: 0.55, sweepTo: 420 });
  }

  /** "GOT SHOT": a soft descending sting. */
  private sting(t: number, g: number) {
    this.tone(t, 523.25, 0.35, 'triangle', 0.12 * g, { filter: 1800 });
    this.tone(t + 0.18, 415.3, 0.5, 'triangle', 0.12 * g, { filter: 1500 });
    this.tone(t + 0.18, 207.65, 0.6, 'sine', 0.1 * g);
  }

  /* ---------- optional lounge ambience (synth pad + room tone), off by default ---------- */
  private syncAmbient() {
    const want = this.settings.on && this.settings.ambient && wantsAmbience(this.settings) && this.unlocked;
    if (!this.ctx || !this.ambBus) return;
    const c = this.ctx;
    this.ambBus.gain.setTargetAtTime(want ? 0.5 * normalizeCategoryVolumes(this.settings.volumes).ambience : 0, c.currentTime, 0.6);
    if (want && this.ambTimer === null) {
      // room tone: brown-ish noise, heavily low-passed
      const src = c.createBufferSource(); src.buffer = this.noise(4); src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
      const g = c.createGain(); g.gain.value = 0.05;
      src.connect(f).connect(g).connect(this.ambBus); src.start();
      this.ambNodes.push(src);
      // slow jazz-lounge pad: Dm9 → G13 → Cmaj9 → A7(b9), 4 s each
      const chords = [[146.83, 174.61, 220, 261.63, 329.63], [98, 174.61, 246.94, 329.63, 349.23], [130.81, 164.81, 246.94, 293.66, 392], [110, 196, 233.08, 277.18, 329.63]];
      let i = 0;
      const tick = () => {
        const t = c.currentTime + 0.05;
        for (const fr of chords[i % chords.length]!) {
          this.tone(t, fr, 4.4, 'sine', 0.035, { attack: 0.9, dest: this.ambBus! });
          this.tone(t, fr * 2.003, 4.0, 'triangle', 0.008, { attack: 1.2, filter: 1200, dest: this.ambBus! });
        }
        // a soft walking bass note
        this.tone(t, chords[i % chords.length]![0]! / 2, 1.6, 'sine', 0.06, { attack: 0.03, dest: this.ambBus! });
        i++;
      };
      tick();
      this.ambTimer = window.setInterval(tick, 4000);
    } else if (!want && this.ambTimer !== null) {
      window.clearInterval(this.ambTimer); this.ambTimer = null;
      const nodes = this.ambNodes; this.ambNodes = [];
      window.setTimeout(() => nodes.forEach((nd) => { try { (nd as AudioBufferSourceNode).stop(); } catch { /* */ } }), 1500);
    }
  }

  /* ---------- venue ambience (Release 7): quiet procedural beds, one per venue (all generated here: no recordings) ---------- */
  private venueBus: GainNode | null = null;
  private venueBedId: VenueBed = 'none';
  private venuePlaying: VenueBed = 'none';
  private venueNodes: { stop: () => void }[] = [];
  private venueTimers: number[] = [];
  /** which bed is running (exposed for checks) */
  get venueBedNow(): VenueBed { return this.venuePlaying; }
  private convolver: ConvolverNode | null = null;
  private convWet: GainNode | null = null;
  /** The unified session room (Phase 4): seen venue = heard soundscape = loading-screen name. */
  roomStyle: RoomStyle | null = null;
  /** Pick this game's room and apply its whole character: ambience bed + convolver IR + card surface.
   *  The bed starts through setVenueBed/syncVenue, which only sounds once unlocked — on iPhone the
   *  first tap's wake() re-runs syncVenue, so the fade begins at first unlock, never before it can. */
  applySoundscape(seed: string, onlineVenue?: string, visualVenue?: string, lockedVenues = false): RoomStyle {
    const style = sessionRoom({ visualVenue, seed, onlineVenue, lockedVenues });
    this.roomStyle = style;
    this.leanArmed = style.music.lean.length > 0; // the venue's signature track opens the session
    if (this.convolver && this.ctx) {
      const spec = irSpec(style);
      try { this.convolver.buffer = this.makeIR(spec.seconds); } catch { /* keep previous IR */ }
      if (this.convWet) this.convWet.gain.setTargetAtTime(spec.wet, this.ctx.currentTime, 0.4);
    }
    if (typeof window !== 'undefined') (window as unknown as { __bwmRoom?: unknown }).__bwmRoom = { name: style.name, venue: style.venue, bed: style.bed, reverb: style.reverb, surface: style.surface, unlocked: this.unlocked };
    this.setVenueBed(style.bed);
    // The venue's music identity changed with its bed: reconcile the decks
    // against it (a carried-over track crossfades out now; the venue's own
    // pick — its pin rotation, or its armed lean — opens the session).
    this.queueContextRetarget();
    return style;
  }
  private makeIR(seconds: number): AudioBuffer {
    const c = this.ctx!; const rate = c.sampleRate; const len = Math.max(1, Math.floor(rate * seconds));
    const buf = c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    return buf;
  }
  /** Per-player local voice mute (persisted in sound settings; that seat's card SFX are unaffected). */
  setVoiceMuted(playerId: string, mute: boolean) {
    this.settings = { ...this.settings, mutedVoices: withVoiceMuted(this.settings.mutedVoices, playerId, mute) };
    this.updateVoiceChat(playerId, { muted: mute });
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    this.emit();
  }
  voiceMuted(playerId: string): boolean { return isVoiceMuted(this.settings.mutedVoices, playerId); }
  setVenueBed(id: VenueBed) { this.venueBedId = id; this.syncVenue(); }
  /**
   * STORY MODE AUDIO API (the scene/story UI calls exactly this; Story Audio Pass 2026-10-21):
   * entering a stop applies its whole audio identity from spatial.ts STORY_STOP_AUDIO — the
   * score mood (theme / danger / king) and, where the stop's venue has no bed of its own
   * (the Rec Center plays in the silent Classic Studio), a bed override (the gym 'rec' bed).
   * Pass null when leaving story mode; enterContext('menu') also clears both. The venue bed
   * itself still comes from applySoundscape — the override only fills a silent venue.
   * Call it BEFORE the first scene line: the bed fades in under the scene and the score
   * crossfades promptly (queueContextRetarget), so the first 60 seconds land as one production.
   */
  /* ---------- The film mix (Porch pilot, sound sample 2026-10-23) ---------- */
  /** The film mix is live only while the Porch identity is: its mood drives the score
   *  treatment, its bed supplies the layers. Everywhere else the treatment stays open. */
  private filmActive(): boolean { return this.storyMood === 'porch'; }

  /** Table's phase feed (Table.tsx, alongside setMusicTension): bidding thins the Porch
   *  score; every other phase rests at the full mix. The phase is stored always —
   *  arriving at the Porch mid-bidding lands already thinned — and is inaudible
   *  anywhere the film mix is not live. */
  setFilmPhase(phase: string) {
    if (phase === this.filmPhase) return;
    this.filmPhase = phase;
    this.refreshFilm(0.9);
  }

  /** Re-apply the resting film state for the current mood + phase (neutral off-Porch). */
  private refreshFilm(tau = 0.6) { this.applyFilm(this.filmActive() ? filmTargets(this.filmPhase) : FILM_NEUTRAL, tau); }

  /** Ride every film stage toward a target state. Missing stages (no context yet, bed
   *  not built) are skipped; the state re-applies when the chain / bed is (re)built. */
  private applyFilm(tg: FilmTargets, tau: number) {
    const c = this.ctx; if (!c) return;
    const now = c.currentTime;
    if (this.filmFilter) this.filmFilter.frequency.setTargetAtTime(tg.scoreHz, now, tau);
    if (this.filmGain) this.filmGain.gain.setTargetAtTime(tg.scoreGain, now, tau);
    if (this.filmLayers) {
      this.filmLayers.tone.gain.setTargetAtTime(tg.tone, now, tau);
      this.filmLayers.human.gain.setTargetAtTime(tg.human, now, tau);
      this.filmLayers.world.gain.setTargetAtTime(tg.world, now, tau);
    }
  }

  /** Instant-set variant for a freshly built music chain (no ramp from stale defaults). */
  private applyFilmMix() {
    const c = this.ctx; if (!c) return;
    const tg = this.filmActive() ? filmTargets(this.filmPhase) : FILM_NEUTRAL;
    if (this.filmFilter) this.filmFilter.frequency.setValueAtTime(tg.scoreHz, c.currentTime);
    if (this.filmGain) this.filmGain.gain.setValueAtTime(tg.scoreGain, c.currentTime);
  }

  /** A momentary film move (a set lands, the blast): dive to the target, hold, then
   *  breathe back to the resting state for whatever phase is current by then. A newer
   *  move supersedes an older one's recovery. */
  private filmDip(tg: FilmTargets, holdMs: number) {
    if (!this.filmActive()) return;
    const seq = ++this.filmSeq;
    this.applyFilm(tg, 0.22);
    if (this.filmTimer !== null) window.clearTimeout(this.filmTimer);
    this.filmTimer = window.setTimeout(() => { this.filmTimer = null; if (this.filmSeq === seq) this.refreshFilm(1.2); }, holdMs);
  }

  setStoryStop(stopId: string | null) {
    const def = stopId ? STORY_STOP_AUDIO[stopId] : undefined;
    const mood: StoryMood | null = def?.mood ?? null;
    const bed: VenueBed | null = def?.bed ?? null;
    const moodChanged = mood !== this.storyMood;
    this.storyMood = mood;
    if (bed !== this.storyBedOverride) { this.storyBedOverride = bed; this.syncVenue(); }
    if (moodChanged) this.queueContextRetarget();
    this.refreshFilm();
    if (typeof window !== 'undefined') (window as unknown as { __bwmStoryAudio?: unknown }).__bwmStoryAudio = { stop: stopId, mood, bed };
  }
  /**
   * The music identity changed — a context switch (enterContext), a new venue
   * (applySoundscape), or a story mood change (setStoryStop). Identity
   * mutations arrive in synchronous bursts: a table unmount fires
   * enterContext('menu') and the next table's mount fires enterContext('game')
   * + applySoundscape + setStoryStop inside the same commit. Coalesce the
   * burst on a microtask so the decks reconcile ONCE, against the final
   * identity — a table hop must not detour through the menu theme on its way
   * to the new room.
   */
  private queueContextRetarget() {
    if (this.retargetQueued) return;
    this.retargetQueued = true;
    queueMicrotask(() => { this.retargetQueued = false; this.retargetToContext(); });
  }

  /**
   * Bring the decks in line with the identity now in force (owner report,
   * 2026-10-30: music playing in the menu kept playing in the game until the
   * track changed on its own). The decks otherwise choose tracks only at load
   * moments — first start, look-ahead, crossfade — so without this, a track
   * chosen under the old identity plays to its natural end in the new one,
   * and the look-ahead parked on the standby deck plays after it: the menu
   * theme could sound at a table for two full tracks, and a foreign track
   * could play inside The Pj's closed rotation. The story pass already knew
   * this move for mood changes (the old retargetMusic); it is the same lag
   * on every identity change, so the reconciliation is shared.
   *
   * In-context tracks are never touched: a sounding track that belongs here
   * plays on, and a standby loaded with an in-context pick stays loaded. A
   * foreign standby is cleared so the next advance loads a fresh pick; a
   * foreign SOUNDING track crossfades out now through advance() — the
   * engine's own path (XFADE, announce → the SoundDock title follows).
   */
  private retargetToContext() {
    if (!this.ctx || !this.decks.length || !wantsMusic(this.settings)) return;
    const cur = this.decks[this.active]!;
    if (this.advancing || this.deckLoading(cur)) {
      // A crossfade (or a first-start load) owns the decks, aimed under the
      // identity in force when it began. Never fight it — re-check when it
      // lands; the identity is read fresh then, so a burst of switches
      // settles on the last one and the decks cannot wedge.
      if (this.retargetTimer === null) {
        this.retargetTimer = window.setTimeout(() => { this.retargetTimer = null; this.retargetToContext(); }, XFADE * 1000 + 250);
      }
      return;
    }
    const other = this.decks[1 - this.active]!;
    if (!this.trackInContext(other.track)) {
      try { other.el.pause(); } catch { /* not playing */ }
      other.track = null; other.ready = null;
    }
    if (cur.track !== null && !cur.el.paused && !this.trackInContext(cur.track)) void this.advance();
  }
  /**
   * The story signature sting: the theme's motif (STORY_MOTIF_HZ) as a short cue.
   * kind 'scene' = the four notes plain (scene-in); 'clear' = notes + a warm fifth bloom
   * (stop cleared); 'unlock' = notes rising one more step (an unlockable / egg found).
   * Synthesized on the SFX bus like every other cue; story UI calls it, normal games never do.
   */
  storySting(kind: 'scene' | 'clear' | 'unlock' = 'scene') {
    if (!this.settings.on || !this.unlocked) return;
    this.ensure();
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const t = c.currentTime + 0.03;
    const notes = kind === 'unlock' ? [...STORY_MOTIF_HZ, 1318.5] : STORY_MOTIF_HZ;
    this.arp(t, notes, 0.11, 'triangle', 0.16, 0.7);
    this.tone(t, 146.83, 1.4, 'sine', 0.10, { attack: 0.05 }); // the D under it all
    if (kind === 'clear') { this.tone(t + 0.44, 220, 1.6, 'sine', 0.08, { attack: 0.08 }); this.tone(t + 0.44, 293.66, 1.6, 'sine', 0.06, { attack: 0.08 }); }
  }
  private syncVenue() {
    const bedId = this.storyBedOverride ?? this.venueBedId;
    const want = this.settings.on && this.settings.venueSound !== false && wantsAmbience(this.settings) && this.unlocked && bedId !== 'none' ? bedId : 'none';
    if (want === this.venuePlaying) return;
    // stop what's playing (fade), then build the new bed
    if (this.venuePlaying !== 'none') {
      this.venueTimers.forEach((t) => window.clearInterval(t)); this.venueTimers = [];
      const nodes = this.venueNodes; this.venueNodes = [];
      if (this.ctx && this.venueBus) this.venueBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      window.setTimeout(() => nodes.forEach((n) => n.stop()), 1600);
    }
    this.venuePlaying = want;
    if (typeof window !== 'undefined' && want !== 'none') (window as unknown as { __bwmRoomPlaying?: unknown }).__bwmRoomPlaying = { bed: want, at: performance.now() };
    if (want === 'none' || !this.ctx || !this.venueBus) return;
    const c = this.ctx; const bus = this.venueBus;
    window.setTimeout(() => { if (this.venuePlaying === want) { bus.gain.cancelScheduledValues(c.currentTime); bus.gain.setTargetAtTime(0.38 * normalizeCategoryVolumes(this.settings.volumes).ambience, c.currentTime, 1.2); } }, this.venueNodes.length ? 0 : 50);
    this.buildBed(want);
  }
  /** filtered noise with a slow swell (crowd murmur, wind, waves, room tone) */
  private vNoise(type: BiquadFilterType, freq: number, q: number, gain: number, lfoRate = 0, lfoDepth = 0, dest?: AudioNode, sink?: { stop: () => void }[]) {
    const c = this.ctx!;
    const src = c.createBufferSource(); src.buffer = this.noise(4); src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(dest ?? this.venueBus!); src.start();
    const stops = [() => { try { src.stop(); } catch { /* */ } }];
    if (lfoRate > 0) {
      const lfo = c.createOscillator(); lfo.frequency.value = lfoRate;
      const d = c.createGain(); d.gain.value = gain * lfoDepth;
      lfo.connect(d).connect(g.gain); lfo.start();
      stops.push(() => { try { lfo.stop(); } catch { /* */ } });
    }
    (sink ?? this.venueNodes).push({ stop: () => stops.forEach((x) => x()) });
  }
  /** electrical hum (neon, fluorescent tubes, fridge) */
  private vHum(freq: number, gain: number) {
    const c = this.ctx!;
    for (const [m, k] of [[1, 1], [2, 0.5], [3, 0.2]] as const) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq * m;
      const g = c.createGain(); g.gain.value = gain * k;
      o.connect(g).connect(this.venueBus!); o.start();
      this.venueNodes.push({ stop: () => { try { o.stop(); } catch { /* */ } } });
    }
  }
  /** a sound every few seconds (random gap in [min, max] s) */
  private vEvery(min: number, max: number, fn: (t: number) => void, live?: () => boolean, timers?: number[]) {
    const bed = this.venuePlaying;
    const isLive = live ?? (() => this.venuePlaying === bed);
    const sink = timers ?? this.venueTimers;
    const loop = () => {
      if (!isLive()) return;
      if (this.ctx && this.ctx.state === 'running') fn(this.ctx.currentTime + 0.05);
      const id = window.setTimeout(loop, (min + Math.random() * (max - min)) * 1000);
      sink.push(id);
    };
    const id = window.setTimeout(loop, (min * 0.5 + Math.random() * max * 0.5) * 1000);
    sink.push(id);
  }
  private vBurst(t: number, dur: number, type: BiquadFilterType, freq: number, gain: number, dest?: AudioNode) {
    const c = this.ctx!;
    const src = c.createBufferSource(); src.buffer = this.noise(Math.max(0.05, dur));
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.01, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest ?? this.venueBus!); src.start(t); src.stop(t + dur + 0.05);
  }
  /** Fetch + decode one recorded-ambience file into the ambience cache. A load that
   *  outlives its context (a heal rebuilt it mid-flight) caches nothing and reports
   *  null — the next bed build retries from the HTTP cache. */
  private loadAmbience(key: string, url: string): Promise<AudioBuffer | null> {
    const c = this.ctx;
    if (!c) return Promise.resolve(null);
    if (!this.ambCache || this.ambCache.ctx !== c) this.ambCache = { ctx: c, map: new Map() };
    const cache = this.ambCache.map;
    const hit = cache.get(key);
    if (hit) return Promise.resolve(hit);
    const pending = this.ambLoading.get(key);
    if (pending && pending.ctx === c) return pending.p;
    const entry: { ctx: Ctx; p: Promise<AudioBuffer | null> } = { ctx: c, p: Promise.resolve(null) };
    entry.p = (async (): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const buf = await decodeAudioBuffer(c, await res.arrayBuffer());
        if (this.ctx !== c) return null;
        cache.set(key, buf);
        return buf;
      } catch { return null; }
      finally { if (this.ambLoading.get(key) === entry) this.ambLoading.delete(key); }
    })();
    this.ambLoading.set(key, entry);
    return entry.p;
  }

  /** Start the recorded street bed for THIS bed build: decode (cached), trim the
   *  MP3's encoder delay so the 64 s loop is sample-exact, and loop it through the
   *  venue bus. The decode is async; if the bed was stopped or rebuilt meanwhile,
   *  the captured venue-node sink no longer matches and nothing starts. The event
   *  one-shots lazy-load alongside (they never gate the table) and the scheduler
   *  starts now — it simply skips any variant whose buffer has not landed yet. */
  private startStreetBed() {
    const sink = this.venueNodes;
    const bed = this.venuePlaying;
    void this.loadAmbience('pjs-bed', PJS_BED_URL).then((raw) => {
      if (!raw || this.venueNodes !== sink || this.venuePlaying !== bed || !this.ctx || !this.venueBus) return;
      const src = this.ctx.createBufferSource();
      src.buffer = trimLoopBuffer(this.ctx, raw, PJS_BED_LEAD_S, PJS_BED_SECONDS);
      src.loop = true;
      src.connect(this.venueBus);
      src.start();
      sink.push({ stop: () => { try { src.stop(); } catch { /* already stopped */ } } });
    });
    for (const url of [...PJS_EVENT_URLS.voice, ...PJS_EVENT_URLS.car]) void this.loadAmbience(url, url);
    this.scheduleStreetEvents();
  }

  /** Distant life over the recorded bed: two independent randomized timers —
   *  voices every 30–60 s, car pass-bys every 25–60 s (owner densities,
   *  2026-10-30) — sharing one busy gate, so an event never talks over another.
   *  Variants rotate without immediate repeats; the close car pass is weighted
   *  rarer (~1-in-4). The timers live in venueTimers, so leaving the venue
   *  silences the street, and the first pass comes a half-interval in, once
   *  the table has settled. */
  private scheduleStreetEvents() {
    const bed = this.venuePlaying;
    let busyUntil = 0; // ctx-time until which a playing event owns the street
    let lastVoice = -1;
    let lastCar = -1;
    const pickFresh = (count: number, last: number): number => {
      if (last < 0 || count < 2) return Math.floor(Math.random() * count);
      const v = Math.floor(Math.random() * (count - 1));
      return v >= last ? v + 1 : v;
    };
    const pickCar = (): number => {
      const cand = PJS_CAR_WEIGHTS.map((w, i) => ({ w, i })).filter((x) => x.i !== lastCar);
      let roll = Math.random() * cand.reduce((s, x) => s + x.w, 0);
      for (const x of cand) { roll -= x.w; if (roll <= 0) return x.i; }
      return cand[cand.length - 1]!.i;
    };
    const play = (url: string): number => {
      const buf = this.ambCache?.ctx === this.ctx ? this.ambCache.map.get(url) : undefined;
      const c = this.ctx; const B = this.venueBus;
      if (!buf || !c || !B) return 0;
      const src = c.createBufferSource(); src.buffer = buf;
      const g = c.createGain(); g.gain.value = PJS_EVENT_GAIN;
      src.connect(g).connect(B);
      src.start();
      return buf.duration;
    };
    const arm = (kind: 'voice' | 'car', min: number, max: number, first = false) => {
      const span = (max - min) * (first ? 0.6 : 1);
      const delay = min * (first ? 0.6 : 1) + Math.random() * span;
      const id = window.setTimeout(() => {
        if (this.venuePlaying !== bed) return;
        if (this.ctx && this.ctx.state === 'running' && this.ctx.currentTime >= busyUntil) {
          const now = this.ctx.currentTime;
          if (kind === 'voice') {
            lastVoice = pickFresh(PJS_EVENT_URLS.voice.length, lastVoice);
            const d = play(PJS_EVENT_URLS.voice[lastVoice]!);
            if (d) busyUntil = now + d + 1;
          } else {
            lastCar = pickCar();
            const d = play(PJS_EVENT_URLS.car[lastCar]!);
            if (d) busyUntil = now + d + 1;
          }
        }
        arm(kind, min, max);
      }, delay * 1000);
      this.venueTimers.push(id);
    };
    arm('voice', 30, 60, true);
    arm('car', 25, 60, true);
  }

  /** Start the recorded lounge bed for THIS bed build — same construction as
   *  the street bed (decode cached, trim the MP3's encoder delay so the 64 s
   *  loop is sample-exact, loop through the venue bus), with one difference
   *  the watchdog forces: its bed check keys on venueNodes being non-empty,
   *  and The Pj's street survives the async decode only because its kept grill
   *  sizzle registers a node synchronously. The Speakeasy has no synth layer
   *  left to do that, so a silent pass-through gain registers in the sink the
   *  moment the build starts and the decoded loop routes through it — the
   *  sink is never empty from t=0, and the gain is unity, so the recorded mix
   *  is untouched. The event one-shots lazy-load alongside (they never gate
   *  the table) and the scheduler starts now — it simply skips any event whose
   *  buffer has not landed yet. */
  private startSpeakeasyBed() {
    const sink = this.venueNodes;
    const bed = this.venuePlaying;
    let through: GainNode | null = null;
    if (this.ctx && this.venueBus) {
      through = this.ctx.createGain();
      through.connect(this.venueBus);
      const node = through;
      sink.push({ stop: () => { try { node.disconnect(); } catch { /* already gone */ } } });
    }
    void this.loadAmbience('spk-bed', SPK_BED_URL).then((raw) => {
      if (!raw || this.venueNodes !== sink || this.venuePlaying !== bed || !this.ctx || !this.venueBus) return;
      const src = this.ctx.createBufferSource();
      src.buffer = trimLoopBuffer(this.ctx, raw, SPK_BED_LEAD_S, SPK_BED_SECONDS);
      src.loop = true;
      src.connect(through ?? this.venueBus);
      src.start();
      sink.push({ stop: () => { try { src.stop(); } catch { /* already stopped */ } } });
    });
    for (const url of [...SPK_EVENT_URLS.glass, ...SPK_EVENT_URLS.laugh, ...SPK_EVENT_URLS.door]) void this.loadAmbience(url, url);
    this.scheduleSpeakeasyEvents();
  }

  /** Lounge life over the recorded bed: three independent randomized timers —
   *  glass clinks every 25–50 s, a laugh swell every 45–90 s, the wooden door
   *  every 90–180 s (owner densities, 2026-10-30) — sharing one busy gate, so
   *  an event never talks over another (the street pattern). Each kind has a
   *  single recording, so there is no variant to rotate; the spacing itself is
   *  the variety. The timers live in venueTimers, so leaving the venue
   *  silences the lounge, and the first fire comes a half-interval in, once
   *  the table has settled. */
  private scheduleSpeakeasyEvents() {
    const bed = this.venuePlaying;
    let busyUntil = 0; // ctx-time until which a playing event owns the lounge
    const play = (url: string): number => {
      const buf = this.ambCache?.ctx === this.ctx ? this.ambCache.map.get(url) : undefined;
      const c = this.ctx; const B = this.venueBus;
      if (!buf || !c || !B) return 0;
      const src = c.createBufferSource(); src.buffer = buf;
      const g = c.createGain(); g.gain.value = SPK_EVENT_GAIN;
      src.connect(g).connect(B);
      src.start();
      return buf.duration;
    };
    const arm = (kind: 'glass' | 'laugh' | 'door', min: number, max: number, first = false) => {
      const span = (max - min) * (first ? 0.6 : 1);
      const delay = min * (first ? 0.6 : 1) + Math.random() * span;
      const id = window.setTimeout(() => {
        if (this.venuePlaying !== bed) return;
        if (this.ctx && this.ctx.state === 'running' && this.ctx.currentTime >= busyUntil) {
          const now = this.ctx.currentTime;
          const d = play(SPK_EVENT_URLS[kind][0]!);
          if (d) busyUntil = now + d + 1;
        }
        arm(kind, min, max);
      }, delay * 1000);
      this.venueTimers.push(id);
    };
    arm('glass', 25, 50, true);
    arm('laugh', 45, 90, true);
    arm('door', 90, 180, true);
  }

  private buildBed(bed: VenueBed) {
    this.filmLayers = null; // only the 'porch' case below repopulates these
    const B = this.venueBus!;
    const murmur = (k: number) => { this.vNoise('bandpass', 520, 0.7, 0.05 * k, 0.21, 0.5); this.vNoise('bandpass', 900, 1.2, 0.02 * k, 0.13, 0.6); };
    const room = (k: number) => this.vNoise('lowpass', 260, 0.5, 0.05 * k);
    const crackle = (min: number, max: number, k = 1) => this.vEvery(min, max, (t) => { for (let i = 0; i < 3; i++) this.vBurst(t + Math.random() * 0.25, 0.012, 'highpass', 2500, 0.05 * k); });
    switch (bed) {
      case 'cookout':
        murmur(0.8); this.vNoise('highpass', 3500, 0.5, 0.008, 0.4, 0.6); // grill sizzle
        this.vEvery(1.5, 4, (t) => { for (let i = 0; i < 3; i++) this.tone(t + i * 0.07, 4600, 0.04, 'sine', 0.012, { dest: B }); }); // crickets
        crackle(0.6, 1.8, 0.7);
        // Story Audio Pass: the yard is alive — kids a yard over (bright little arcs of noise,
        // never words), a screen door slapping now and then, the cooler lid and ice.
        this.vEvery(16, 38, (t) => { const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) this.tone(t + i * (0.14 + Math.random() * 0.1), 1250 + Math.random() * 750, 0.1, 'sine', 0.006, { dest: B }); });
        this.vEvery(34, 80, (t) => { this.tone(t, 300, 0.28, 'sine', 0.008, { glideTo: 620, dest: B }); this.vBurst(t + 0.3, 0.05, 'lowpass', 500, 0.05); }); // screen door creak + slap
        this.vEvery(11, 26, (t) => { for (let i = 0; i < 3; i++) this.vBurst(t + Math.random() * 0.3, 0.02, 'bandpass', 3400 + Math.random() * 900, 0.02); }); // ice settling in the cooler
        break;
      case 'mansion':
        room(0.8);
        this.vEvery(6, 9, (t) => { const ch = [[392, 493.88, 587.33], [349.23, 440, 523.25], [329.63, 415.3, 493.88]][Math.floor(Math.random() * 3)]!; ch.forEach((f, i) => this.tone(t + i * 0.35, f, 3.2, 'sine', 0.012, { attack: 0.6, dest: B })); }); // distant piano-ish
        // Story Audio Pass (the High-Rise stop lives here): money-quiet — ice in a glass,
        // a far-off elevator chime, the fireplace working under the piano.
        crackle(1.4, 3.4, 0.35);
        this.vEvery(13, 29, (t) => { for (let i = 0; i < 2; i++) this.vBurst(t + Math.random() * 0.22, 0.018, 'bandpass', 3600 + Math.random() * 800, 0.022); }); // ice in glasses
        this.vEvery(47, 95, (t) => { this.tone(t, 1318.5, 0.7, 'sine', 0.006, { dest: B }); this.tone(t + 0.28, 987.77, 0.9, 'sine', 0.005, { dest: B }); }); // elevator ding, two floors away
        break;
      case 'barbershop':
        murmur(0.7); this.vHum(120, 0.004);
        this.vEvery(9, 18, (t) => this.tone(t, 118, 1.4, 'sawtooth', 0.01, { attack: 0.08, filter: 900, dest: B })); // clippers
        // Story Audio Pass: the shop works around the game — scissors between cuts, the door
        // bell when somebody comes in off the street, a razor strop's slow leather swipes.
        this.vEvery(6, 15, (t) => { for (let i = 0; i < 2; i++) this.vBurst(t + i * 0.13, 0.016, 'highpass', 4200, 0.035); }); // scissors snip-snip
        this.vEvery(41, 90, (t) => { this.tone(t, 1567.98, 0.32, 'triangle', 0.012, { dest: B }); this.tone(t + 0.16, 2093, 0.42, 'triangle', 0.01, { dest: B }); }); // door bell
        this.vEvery(19, 40, (t) => { for (let i = 0; i < 3; i++) this.vBurst(t + i * 0.4, 0.3, 'bandpass', 700 + i * 130, 0.014); }); // strop swipes
        break;
      case 'basement':
        this.vHum(120, 0.006); murmur(0.6); room(0.6);
        this.vEvery(7, 14, (t) => { for (let i = 0; i < 5; i++) this.tone(t + i * 0.09, 220 + Math.random() * 120, 0.06, 'sine', 0.012, { dest: B }); }); // coffee percolator
        // Story Audio Pass: a hymn through the wall from the sanctuary upstairs — slow organ
        // chords, felt more than heard — and folding chairs shifting on the linoleum.
        this.vEvery(13, 21, (t) => { const hymn = [[174.61, 220, 261.63], [146.83, 220, 293.66], [130.81, 196, 261.63], [164.81, 220, 329.63]]; const ch = hymn[Math.floor(Math.random() * hymn.length)]!; ch.forEach((f) => { this.tone(t, f, 5.2, 'sine', 0.009, { attack: 1.1, dest: B }); this.tone(t, f * 2, 5.2, 'sine', 0.003, { attack: 1.1, dest: B }); }); });
        this.vEvery(17, 36, (t) => this.vBurst(t, 0.22, 'lowpass', 420, 0.028)); // a chair scrape
        break;
      case 'rooftop':
        this.vNoise('lowpass', 520, 0.6, 0.06, 0.07, 0.7); // wind
        this.vNoise('lowpass', 140, 0.5, 0.06, 0.05, 0.3); // traffic rumble
        this.vEvery(14, 32, (t) => { this.tone(t, 392, 0.35, 'sawtooth', 0.008, { filter: 600, dest: B }); this.tone(t + 0.45, 349.23, 0.5, 'sawtooth', 0.008, { filter: 600, dest: B }); }); // distant horn
        // Story Audio Pass: gusts that lean on the mic a little, a wind chime two roofs over,
        // and the city breathing far below (a siren that never gets close).
        this.vNoise('bandpass', 300, 0.6, 0.02, 0.045, 0.9); // gust layer
        this.vEvery(15, 34, (t) => { const penta = [1318.5, 1567.98, 1760, 2093, 2349.3]; const n = 2 + Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) this.tone(t + i * (0.2 + Math.random() * 0.22), penta[Math.floor(Math.random() * penta.length)]!, 0.8, 'sine', 0.004, { dest: B }); }); // wind chime
        this.vEvery(38, 85, (t) => { this.tone(t, 622, 1.1, 'sine', 0.004, { glideTo: 830, dest: B }); this.tone(t + 1.2, 622, 1.1, 'sine', 0.0035, { glideTo: 830, dest: B }); }); // far siren
        break;
      case 'jazz': {
        // The Speakeasy's bed is a RECORDING now (owner sample pick, 2026-10-30),
        // replacing the old synthesized stand-in (a sine-chord loop faking a band,
        // room tone, crackle, glass bursts and a murmur wash): a seamless 64 s
        // lounge loop — café walla, low-passed murmur, dishes, saloon chatter —
        // with "George Street Shuffle" low-passed into it as the band through
        // the wall. Story Audio Pass: the Corner stop plays here — its glasses
        // and low talk are in the recording, and the glass/laugh/door one-shot
        // events ride over it on their own timers (startSpeakeasyBed).
        this.startSpeakeasyBed();
        break;
      }
      case 'casino':
        murmur(1);
        this.vEvery(2, 6, (t) => { const base = [1046.5, 1174.66, 1318.5, 1567.98]; for (let i = 0; i < 4; i++) this.tone(t + i * 0.09, base[Math.floor(Math.random() * 4)]!, 0.25, 'triangle', 0.008, { dest: B }); }); // slots
        // Story Audio Pass (the Legends' Table plays here): a payout somewhere behind you,
        // chips being stacked between hands at the next table.
        this.vEvery(23, 55, (t) => { const seq = [1567.98, 1318.5, 1567.98, 2093, 1567.98, 2637]; seq.forEach((f, i) => this.tone(t + i * 0.11, f, 0.22, 'triangle', 0.007, { dest: B })); }); // slot payout arpeggio
        this.vEvery(8, 19, (t) => { for (let i = 0; i < 4; i++) this.vBurst(t + i * 0.07, 0.014, 'bandpass', 2100 + Math.random() * 500, 0.02); }); // chips clicking
        break;
      case 'beach':
        this.vNoise('lowpass', 700, 0.4, 0.07, 0.085, 0.85); // waves
        this.vNoise('lowpass', 400, 0.5, 0.03, 0.05, 0.5); // breeze
        this.vEvery(12, 26, (t) => this.tone(t, 1700, 0.45, 'sine', 0.007, { glideTo: 1150, dest: B })); // gull
        crackle(0.8, 2.2, 0.5); // torches
        break;
      case 'kitchen':
        room(0.6); this.vHum(60, 0.006);
        this.vEvery(1, 1, (t) => this.vBurst(t, 0.015, 'bandpass', 2600, 0.04)); // the clock
        // Story Audio Pass (the Porch stop lives in Grandma's Kitchen): the house breathes —
        // somebody's TV murmuring two rooms off, a dish set down, and the screen door to the
        // porch, where the game actually is, working on its hinge.
        this.vEvery(7, 16, (t) => { for (let i = 0; i < 2; i++) this.vBurst(t + Math.random() * 0.3, 0.02, 'bandpass', 2900 + Math.random() * 700, 0.024); }); // dishes / silverware
        this.vEvery(29, 65, (t) => { this.tone(t, 280, 0.3, 'sine', 0.007, { glideTo: 560, dest: B }); this.vBurst(t + 0.32, 0.05, 'lowpass', 480, 0.045); }); // screen door creak + slap
        this.vEvery(21, 47, (t) => { for (let i = 0; i < 3; i++) this.tone(t + i * 0.07, 4400, 0.04, 'sine', 0.009, { dest: B }); }); // sparrows outside the window
        break;
      case 'rec':
        // The Rec Center (Story stop 3) — a gym that never fully empties: ball on hardwood,
        // shoes on the court, a buzzer's ghost. Reached only via the story bed override
        // (STORY_STOP_AUDIO) since the stop's venue (Classic Studio) is silent by design.
        murmur(0.9); room(1.1); this.vHum(120, 0.005);
        this.vNoise('bandpass', 800, 0.4, 0.025, 0.11, 0.5); // hall air, big-room wash
        this.vEvery(5, 13, (t) => { this.tone(t, 95, 0.16, 'sine', 0.05, { glideTo: 55, dest: B }); this.tone(t + 0.42, 95, 0.14, 'sine', 0.035, { glideTo: 58, dest: B }); this.tone(t + 0.78, 95, 0.12, 'sine', 0.022, { glideTo: 60, dest: B }); }); // basketball dribble, slowing
        this.vEvery(4, 11, (t) => this.tone(t, 1050 + Math.random() * 300, 0.07, 'sine', 0.006, { glideTo: 1500 + Math.random() * 400, dest: B })); // shoe squeak
        this.vEvery(55, 110, (t) => { this.tone(t, 233, 0.5, 'square', 0.006, { filter: 900, dest: B }); }); // a buzzer, court over
        break;
      case 'porch': {
        // THE PORCH as a film mix (sound sample, 2026-10-23) — the bed half of the pilot
        // (the score half is 'porch-theme' on the music deck, treated by the film stage).
        // Three layers on their own gain stages so the film controller can ride them
        // independently; each layer's sources keep their own levels, the layer gain is a
        // pure multiplier starting at unity. Reached only via the story bed override —
        // a regular Grandma's Kitchen game never builds this bed.
        const c = this.ctx!;
        const mkLayer = (): GainNode => {
          const g = c.createGain(); g.gain.value = 1; g.connect(B);
          this.venueNodes.push({ stop: () => { try { g.disconnect(); } catch { /* dead context */ } } });
          return g;
        };
        const toneLayer = mkLayer(); const humanLayer = mkLayer(); const worldLayer = mkLayer();
        this.filmLayers = { tone: toneLayer, human: humanLayer, world: worldLayer };
        // 1 · ROOM TONE — the porch's own air: night settling on boards, a low warm body
        // breathing slow underneath everything.
        this.vNoise('lowpass', 240, 0.5, 0.055, 0.07, 0.45, toneLayer);
        this.vNoise('bandpass', 480, 0.6, 0.016, 0.045, 0.5, toneLayer);
        // 2 · CLOSE HUMAN SOUNDS — the family just off the table: a low murmur that never
        // resolves into words, ice settling in glasses, a chair shifting on the boards,
        // and the screen door working on its hinge behind the game.
        this.vNoise('bandpass', 520, 0.7, 0.05 * 0.55, 0.21, 0.5, humanLayer);
        this.vNoise('bandpass', 900, 1.2, 0.02 * 0.55, 0.13, 0.6, humanLayer);
        this.vEvery(9, 22, (t) => { for (let i = 0; i < 3; i++) this.vBurst(t + Math.random() * 0.3, 0.02, 'bandpass', 3200 + Math.random() * 900, 0.026, humanLayer); }); // ice in glasses
        this.vEvery(14, 30, (t) => { this.vBurst(t, 0.07, 'lowpass', 300, 0.05, humanLayer); this.vBurst(t + 0.09, 0.05, 'lowpass', 420, 0.035, humanLayer); }); // a chair shifts, a foot finds the boards
        this.vEvery(36, 85, (t) => { this.tone(t, 280, 0.3, 'sine', 0.008, { glideTo: 560, dest: humanLayer }); this.vBurst(t + 0.32, 0.05, 'lowpass', 480, 0.05, humanLayer); }); // screen door creak + slap
        // 3 · THE OUTSIDE WORLD — evening on the block: crickets in the yard, the street
        // breathing far off, and every long while a dog two yards down has an opinion.
        this.vNoise('lowpass', 140, 0.5, 0.035, 0.05, 0.3, worldLayer); // distant traffic body
        this.vEvery(1.5, 4, (t) => { for (let i = 0; i < 3; i++) this.tone(t + i * 0.07, 4600, 0.04, 'sine', 0.011, { dest: worldLayer }); }); // crickets
        this.vEvery(47, 110, (t) => { for (let i = 0; i < 2; i++) this.tone(t + i * 0.5, 210 + Math.random() * 60, 0.16, 'sine', 0.006, { glideTo: 150, dest: worldLayer }); }); // a dog, two yards down
        // A fresh Porch bed lands at the mix the current phase calls for (arriving
        // mid-bidding should already be thinned).
        this.refreshFilm(1.2);
        break;
      }
      case 'yacht':
        this.vNoise('bandpass', 420, 0.8, 0.06, 0.3, 0.7); // water lapping on the hull
        this.vNoise('lowpass', 500, 0.6, 0.035, 0.06, 0.6); // sea breeze
        this.vEvery(10, 22, (t) => this.tone(t, 90, 0.9, 'triangle', 0.01, { glideTo: 70, filter: 300, dest: B })); // a creak
        this.vEvery(16, 30, (t) => this.tone(t, 1800, 0.4, 'sine', 0.006, { glideTo: 1200, dest: B })); // gull
        break;
      case 'street': {
        // Ambient events come from the venue's audio identity (spatial.ts): only The Pj's
        // carries 'driveby' + 'headlights'. A bare bed start with no room applied keeps the
        // legacy set, so the street bed always sounds like The Pj's.
        const streetEvents: readonly VenueEvent[] = this.roomStyle?.bed === 'street' ? this.roomStyle.events : ['driveby', 'headlights'];
        // The recorded night street (owner, 2026-10-30 — the Pj's audio fix): a 64 s
        // seamless loop of real city recordings (CC0 SSE Library — CREDITS.md) is the
        // bed now. It retires the synth layers it replaces — the filtered-noise traffic
        // rumble, the sine crickets, the toy two-tone "distant siren", and the synth
        // bass-car thumps below: the recording carries the real street, and real
        // pass-bys (a car rolls past slow with the bass up — the close variant) plus
        // distant voices ride over it as scheduled events (startStreetBed). The grill
        // sizzle stays: it is the table's own sound, not the street's.
        this.vNoise('highpass', 3500, 0.5, 0.006, 0.35, 0.5); // grill sizzle
        this.startStreetBed();
        // Cop drive-by: semi-auto gunfire barrage, then a siren wail fading as the cruiser passes (Demetrius 2026-10-19)
        // Variants rotate (never the same twice); gunfire is positioned in 3D, siren pans across.
        if (streetEvents.includes('driveby')) this.vEvery(180, 420, (t) => {
          const B = this.venueBus!;
          // Gunfire from a random direction (not where the player is looking)
          const gunAz = 40 + Math.random() * 280; // 40°–320°: off to the side/behind
          const gunDist = 8 + Math.random() * 12; // 8–20m away
          const gunPan = this.drivebyPanner(gunAz, gunDist);
          if (gunPan) gunPan.connect(B);
          const gv = pickVariant(4, this.lastGunfireVariant);
          this.lastGunfireVariant = gv;
          // Gunfire: 8-12 semi-auto shots, 0.28-0.46s apart (3-4 seconds total)
          const shots = 8 + Math.floor(Math.random() * 5);
          for (let i = 0; i < shots; i++) {
            const st = t + i * (0.28 + Math.random() * 0.18);
            this.drivebyGunshot(st, gv, gunPan, B);
          }
          // Siren drive-by after a 1-2s pause: pans across as the cruiser passes
          const sirenT = t + 4.5 + Math.random() * 1.5;
          const sv = pickVariant(3, this.lastSirenVariant);
          this.lastSirenVariant = sv;
          const c = this.ctx!;
          const sirenPan = this.drivebyPanner(-60, 12);
          if (sirenPan) {
            sirenPan.connect(B);
            // Sweep left → right over 6s (the drive-by), then release
            const px = sirenPan.positionX;
            px.setValueAtTime(-12, sirenT);
            px.linearRampToValueAtTime(12, sirenT + 6);
            window.setTimeout(() => { try { sirenPan.disconnect(); } catch { /* already gone */ } }, (sirenT - c.currentTime + 8) * 1000);
          }
          // Two wails: full volume as it passes, quieter as it recedes
          this.drivebySirenVariant(sirenT, sv, sirenPan, B, 0.9);
          this.drivebySirenVariant(sirenT + 3.1, sv, sirenPan, B, 0.4);
          // Tell the UI to flash the cop lights
          window.dispatchEvent(new CustomEvent('pj-driveby'));
        });
        // Calm drive-by: headlights sweep the fence, no gunfire — rarer and softer than the barrage above
        if (streetEvents.includes('headlights')) this.vEvery(300, 620, (t) => this.headlightPass(t));
        break;
      }
      default:
    }
  }
}

/** Durations (seconds) the gunshot, shotgun, and tornado wind fill on first play. */
export const EFFECT_NOISE_SECONDS = [0.085, 0.095, 0.12, 0.21, 0.23, 0.25, 0.31, 0.4, 0.75, 2.7];

/** Pure mapping, tested: intensity → card-hit gain, pitch and table thud. Master volume / mute apply on top. */
export interface SmackSound { gain: number; rate: number; thud: number }
export function smackSound(intensity: number): SmackSound {
  const i = Number.isFinite(intensity) ? Math.max(0, Math.min(1, intensity)) : 0.3;
  return {
    gain: 0.35 + 0.95 * i, // soft tap 0.35 → full smack 1.3 (default play is 0.9)
    rate: 1.12 - 0.27 * i, // a harder hit sounds lower and fuller
    thud: i < 0.4 ? 0 : 0.25 + 0.55 * ((i - 0.4) / 0.6),
  };
}

export const sound = new Engine();
sound.installUnlock();
if (typeof window !== 'undefined') (window as unknown as { __bwmSound?: Engine }).__bwmSound = sound;

export function useSoundSettings(): Engine['snapshot'] {
  return useSyncExternalStore(sound.subscribe, sound.getSnapshot, sound.getSnapshot);
}
