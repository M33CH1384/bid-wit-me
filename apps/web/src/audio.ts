/**
 * Bid Wit Me sound engine (Web Audio).
 * - Card/chip foley: Kenney "Casino Audio" + "UI Audio" (CC0), re-encoded to small mono MP3 (plays on Safari/iOS).
 * - Musical cues (turn chime, stingers, jingles, spades-broken sting, whoosh, buzz) and the optional lounge ambience
 *   are synthesized here with oscillators/noise — no extra files.
 * - iOS/Safari only allow audio after a user gesture: the context is created/resumed on the first tap/key.
 *   (The iPhone silent switch mutes Web Audio; there is no way around that from a web page.)
 * - Settings (on/off, volume, ambience) persist in localStorage.
 */
import { useSyncExternalStore } from 'react';

export type Sfx =
  | 'shuffle' | 'deal' | 'play' | 'tap' | 'sweep' | 'broken' | 'turn' | 'bid' | 'bidSoft'
  | 'cut' | 'made' | 'set' | 'nil' | 'bags' | 'pop' | 'win' | 'lose' | 'flip'
  // hype effects (all synthesized): joker rumbles, the Big-over-Little nuke, streaks, shots
  | 'jokerLittle' | 'jokerBig' | 'nuke' | 'streak1' | 'streak2' | 'streak3' | 'shot' | 'gotShot' | 'shotgun' | 'pump' | 'siren' | 'docSting' | 'wheels' | 'wheelsCar' | 'overcut' | 'overcut3' | 'tornado'
  // 'Run it!': the claimer's cards all slam at once / everyone else's cards hit in a quick cascade
  | 'runSlam' | 'runThud';

/** SFX that bot voices duck under, and for how long (ms). */
const DUCK_MS: Partial<Record<Sfx, number>> = { runSlam: 700, nuke: 3600, tornado: 2600, wheelsCar: 3000, jokerBig: 1100, shot: 1200, shotgun: 700, pump: 500, siren: 1800, docSting: 2400, streak2: 1400, streak3: 1800, overcut3: 1000, win: 2000, lose: 1600, set: 1200, nil: 1600 };

export interface SoundSettings { on: boolean; volume: number; ambient: boolean; music: boolean; musicVolume: number; /** the venue's quiet ambient sound bed (Release 7), default on */ venueSound: boolean }
const KEY = 'bwm.sound.v1';
const DEFAULTS: SoundSettings = { on: true, volume: 0.7, ambient: false, music: true, musicVolume: 0.5, venueSound: true };
/** venue ambience beds (see venues.ts → bed) */
export type VenueBed = 'none' | 'cookout' | 'mansion' | 'barbershop' | 'basement' | 'rooftop' | 'jazz' | 'casino' | 'beach' | 'kitchen' | 'yacht';
export type MusicStatus = 'off' | 'loading' | 'playing' | 'error';

export interface Track { file: string; title: string; artist: string; license: string; source: string; /** exact attribution line (CC BY) */ credit?: string }
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
];
/** Exact attribution lines for the CC BY tracks (CREDITS.md + in-game Credits). */
export const CC_BY_LINES = TRACKS.filter((t) => t.credit).map((t) => t.credit!);
export const CC_BY_LINE = CC_BY_LINES[0]!;
const XFADE = 4; // seconds of crossfade between tracks

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

function load(): SoundSettings {
  try { const raw = localStorage.getItem(KEY); if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }; } catch { /* ignore */ }
  return DEFAULTS;
}

const FILES: Record<string, string[]> = {
  shuffle: ['shuffle'], deal: ['deal-1', 'deal-2', 'deal-3'], play: ['play-1', 'play-2', 'play-3'],
  sweep: ['sweep-1', 'sweep-2'], bid: ['bid'], tap: ['tap'], pop: ['pop'],
};

type Ctx = AudioContext;
const AC: typeof AudioContext | undefined = typeof window !== 'undefined'
  ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
  : undefined;

interface Deck { el: HTMLAudioElement; gain: GainNode; track: number | null; ready: Promise<boolean> | null; url: string | null }

class Engine {
  settings: SoundSettings = load();
  private listeners = new Set<() => void>();
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambBus: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private ambTimer: number | null = null;
  private ambNodes: AudioNode[] = [];
  private lastAt = new Map<Sfx, number>();
  unlocked = false;
  /** cue counter (exposed for automated checks) */
  played: Record<string, number> = {};

  /* ---------- settings store ---------- */
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get = () => this.settings;
  get state(): string { return this.ctx?.state ?? 'none'; }
  get loaded(): number { return this.buffers.size; }
  set(patch: Partial<SoundSettings>) {
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    this.settings = { ...this.settings, ...patch, volume: clamp(patch.volume ?? this.settings.volume), musicVolume: clamp(patch.musicVolume ?? this.settings.musicVolume) };
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
    if (!this.allMuted) {
      this.beforeMute = { on: this.settings.on, music: this.settings.music, ambient: this.settings.ambient };
      this.set({ on: false, music: false, ambient: false });
      return true;
    }
    const b = this.beforeMute ?? { on: true, music: false, ambient: this.settings.ambient };
    this.beforeMute = null;
    this.set({ on: b.on || !b.music, music: b.music, ambient: b.ambient });
    return false;
  }
  private emit() { this.snapshot = { ...this.settings, musicStatus: this.musicStatus, nowPlaying: this.nowPlaying }; this.listeners.forEach((f) => f()); }
  snapshot: SoundSettings & { musicStatus: MusicStatus; nowPlaying: { track: Track; at: number } | null } = { ...this.settings, musicStatus: 'off', nowPlaying: null };
  getSnapshot = () => this.snapshot;

  /* ---------- music: shuffled playlist with crossfade + gentle mid/side widening ---------- */
  musicStatus: MusicStatus = 'off';
  nowPlaying: { track: Track; at: number } | null = null;
  private decks: Deck[] = [];
  private active = 0;
  private bag: number[] = [];
  private lastTrack: number | null = null;
  private musicBus: GainNode | null = null;
  /** ducking stages (the nuke's tinnitus moment): music and regular SFX dip, the nuke itself rides on nukeBus */
  private musicDuck: GainNode | null = null;
  private sfxDuck: GainNode | null = null;
  private nukeBus: GainNode | null = null;
  private fading = false;

  /** Mono-compatible widening: M/S with the side (above 150 Hz) boosted and slowly "breathing". L+R is unchanged. */
  private buildMusicChain(): GainNode {
    const c = this.ctx!;
    const input = c.createGain();
    const split = c.createChannelSplitter(2);
    input.connect(split);
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
    return input;
  }

  private ensureDecks() {
    if (this.decks.length || !this.ctx) return;
    const chain = this.buildMusicChain();
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      this.ctx.createMediaElementSource(el).connect(gain).connect(chain);
      const deck: Deck = { el, gain, track: null, ready: null, url: null };
      el.addEventListener('timeupdate', () => this.onTime(deck));
      el.addEventListener('ended', () => { if (deck.url && this.decks[this.active] === deck) { this.fading = true; this.advance(); } });
      el.addEventListener('playing', () => { if (deck.url && this.decks[this.active] === deck && this.musicStatus !== 'playing') { this.musicStatus = 'playing'; this.emit(); } });
      this.decks.push(deck);
    }
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
    d.ready = (async () => {
      try {
        const res = await fetch(`/audio/music/${TRACKS[track]!.file}.mp3`);
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
      }
    })();
    return d.ready;
  }

  private pickNext(): number {
    const { pick, bag } = nextShuffle(this.lastTrack, this.bag, TRACKS.length);
    this.bag = bag; this.lastTrack = pick;
    return pick;
  }

  /** Crossfade to the pre-loaded deck, then queue the following track on the deck that just faded out. */
  private async advance() {
    if (!this.ctx || !this.settings.music) { this.fading = false; return; }
    const c = this.ctx;
    const fromIdx = this.active, toIdx = 1 - this.active;
    const from = this.decks[fromIdx]!, to = this.decks[toIdx]!;
    if (to.track === null || !to.ready) this.loadDeck(toIdx, this.pickNext());
    let ok = await to.ready!;
    for (let tries = 0; !ok && tries < TRACKS.length; tries++) ok = await this.loadDeck(toIdx, this.pickNext());
    if (!ok || !this.settings.music) { this.musicStatus = 'error'; this.fading = false; this.emit(); return; }
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
    if (!this.settings.music) {
      if (this.decks.length) {
        for (const d of this.decks) { d.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25); }
        window.setTimeout(() => { if (!this.settings.music) this.decks.forEach((d) => d.el.pause()); }, 1200);
      }
      if (this.musicStatus !== 'off') { this.musicStatus = 'off'; this.emit(); }
      return;
    }
    this.ensureDecks();
    this.musicBus!.gain.setTargetAtTime(this.settings.musicVolume ** 1.6 * 0.85, this.ctx.currentTime, 0.1);
    const cur = this.decks[this.active]!;
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
      this.musicStatus = 'playing'; this.emit();
    } else {
      cur.gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.3);
    }
  }

  /* ---------- unlock on first gesture (iOS) ---------- */
  installUnlock() {
    if (typeof window === 'undefined') return;
    // stays installed: iOS can 'interrupt' the context (calls, Siri, backgrounding) — any later tap resumes it
    const unlock = () => {
      if (this.unlocked && this.ctx?.state === 'running') return;
      this.ensure();
      const c = this.ctx;
      if (!c) return;
      if (c.state !== 'running') void c.resume();
      // play one silent frame — required by older iOS to fully unlock
      const b = c.createBuffer(1, 1, 22050); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
      this.unlocked = true;
      this.syncAmbient();
      this.syncVenue();
      this.syncMusic();
    };
    ['pointerdown', 'touchend', 'keydown'].forEach((e) => window.addEventListener(e, unlock, true));
    // iOS suspends the context when the app is backgrounded; resume on return
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.ctx && this.ctx.state !== 'running' && this.unlocked) void this.ctx.resume(); });
  }

  /* ---------- recorded bot voices (see voices/voices.ts) ---------- */
  private voiceDuck: GainNode | null = null;
  private voiceSrc: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  /** The (possibly still locked) context, for decoding voice clips ahead of time. */
  audioContext(): AudioContext | null { this.ensure(); return this.ctx; }
  /** Play one bot line (cuts off the previous one, like one person talking). Silent when sound is off / not unlocked yet. */
  /** play a voice clip (optionally a [offsetSec, durationSec] slice of a sprite) */
  playVoice(buf: AudioBuffer, gain: number, slice?: [number, number]): boolean {
    if (!this.settings.on || !this.unlocked) return false;
    this.ensure();
    const c = this.ctx;
    if (!c || c.state !== 'running' || !this.voiceDuck) return false;
    this.stopVoice();
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g).connect(this.voiceDuck);
    src.onended = () => { if (this.voiceSrc?.src === src) this.voiceSrc = null; };
    if (slice) src.start(0, slice[0], slice[1]); else src.start();
    this.voiceSrc = { src, gain: g };
    this.played.voice = (this.played.voice ?? 0) + 1;
    return true;
  }
  stopVoice() {
    const v = this.voiceSrc; this.voiceSrc = null;
    if (!v || !this.ctx) return;
    v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    try { v.src.stop(this.ctx.currentTime + 0.12); } catch { /* already stopped */ }
  }
  /** Big moments (nuke, Wheels, tornado, SHOT!…): voices dip under them, then come back. */
  private duckVoice(ms: number, t: number) {
    const d = this.voiceDuck, c = this.ctx;
    if (!d || !c) return;
    d.gain.cancelScheduledValues(c.currentTime);
    d.gain.setTargetAtTime(0.28, t, 0.05);
    d.gain.setTargetAtTime(1, t + ms / 1000, 0.25);
  }

  private ensure() {
    if (this.ctx || !AC) return;
    const c = new AC({ latencyHint: 'interactive' });
    this.ctx = c;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxDuck = c.createGain(); this.sfxBus.connect(this.sfxDuck).connect(this.master);
    this.nukeBus = c.createGain(); this.nukeBus.connect(this.master);
    this.ambBus = c.createGain(); this.ambBus.gain.value = 0; this.ambBus.connect(this.master);
    this.venueBus = c.createGain(); this.venueBus.gain.value = 0; this.venueBus.connect(this.master);
    this.voiceDuck = c.createGain(); this.voiceDuck.connect(this.master);
    this.applyGain();
    this.load();
  }

  private applyGain() {
    if (!this.master || !this.ctx) return;
    const v = this.settings.on ? this.settings.volume ** 1.6 : 0; // perceptual curve
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
  }

  private load() {
    if (this.loading || !this.ctx) return this.loading;
    const c = this.ctx;
    const names = Object.values(FILES).flat();
    this.loading = Promise.all(names.map(async (n) => {
      try {
        const res = await fetch(`/assets/sfx/${n}.mp3`);
        const data = await res.arrayBuffer();
        const buf = await new Promise<AudioBuffer>((ok, bad) => c.decodeAudioData(data, ok, bad)); // callback form for older Safari
        this.buffers.set(n, buf);
      } catch { /* missing sound is not fatal */ }
    })).then(() => undefined);
    return this.loading;
  }

  /* ---------- playback ---------- */
  play(name: Sfx, opts: { delay?: number; gain?: number; dur?: number } = {}) {
    if (!this.settings.on || !this.unlocked) return;
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
    switch (name) {
      case 'shuffle': return this.sample('shuffle', t, 0.75 * g, 1, Math.max(0.3, opts.dur ?? 1.6));
      case 'deal': return this.sample('deal', t, 0.26 * g, 1.2 + Math.random() * 0.25, 0.3);
      case 'play': return this.sample('play', t, 0.9 * g, 0.95 + Math.random() * 0.12);
      case 'tap': return this.sample('tap', t, 0.5 * g, 1.1);
      case 'flip': this.sample('deal', t, 0.32 * g, 1.55); this.sample('deal', t + 0.07, 0.22 * g, 1.75); return this.whoosh(t, 0.06 * g);
      case 'sweep': this.sample('sweep', t, 0.55 * g, 1.05); return this.whoosh(t, 0.18 * g);
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
      case 'streak1': return this.streakHit(t, g, 1);
      case 'streak2': return this.streakHit(t, g, 2);
      case 'streak3': return this.streakHit(t, g, 3);
      case 'shot': return this.slam(t, g);
      case 'gotShot': return this.sting(t, g);
      case 'shotgun': return this.shotgunBoom(t, g);
      case 'pump': return this.shotgunPump(t, g);
      case 'siren': return this.siren(t, g);
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

  private sample(key: string, t: number, gain: number, rate = 1, maxDur?: number) {
    const c = this.ctx!; const list = FILES[key]!;
    const buf = this.buffers.get(list[Math.floor(Math.random() * list.length)]!);
    if (!buf) return;
    const src = c.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(g).connect(this.sfxBus!);
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

  private noise(dur: number): AudioBuffer {
    const c = this.ctx!;
    const b = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
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

  private chime(t: number, g: number) {
    this.tone(t, 1318.5, 0.5, 'sine', 0.16 * g);
    this.tone(t + 0.09, 1975.5, 0.65, 'sine', 0.12 * g);
    this.tone(t, 2637, 0.25, 'sine', 0.03 * g);
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
   * White-sheet moment: a two-tone police yelp. Original synthesis, no sampled recording, no third-party license.
   * Goes out the sfx bus, so mute and the volume slider apply.
   */
  private siren(t: number, g: number) {
    const c = this.ctx!;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(640, t);
    for (let i = 0; i < 4; i++) {
      const at = t + i * 0.42;
      o.frequency.exponentialRampToValueAtTime(920, at + 0.16);
      o.frequency.exponentialRampToValueAtTime(640, at + 0.42);
    }
    const filter = c.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1400;
    filter.Q.value = 0.8;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2 * g, t + 0.03);
    gain.gain.setValueAtTime(0.2 * g, t + 1.5);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.72);
    o.connect(filter).connect(gain).connect(this.sfxBus!);
    o.start(t);
    o.stop(t + 1.8);
    this.tone(t, 320, 1.68, 'sine', 0.08 * g, { attack: 0.03 });
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
    const want = this.settings.on && this.settings.ambient && this.unlocked;
    if (!this.ctx || !this.ambBus) return;
    const c = this.ctx;
    this.ambBus.gain.setTargetAtTime(want ? 0.5 : 0, c.currentTime, 0.6);
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
  setVenueBed(id: VenueBed) { this.venueBedId = id; this.syncVenue(); }
  private syncVenue() {
    const want = this.settings.on && this.settings.venueSound !== false && this.unlocked && this.venueBedId !== 'none' ? this.venueBedId : 'none';
    if (want === this.venuePlaying) return;
    // stop what's playing (fade), then build the new bed
    if (this.venuePlaying !== 'none') {
      this.venueTimers.forEach((t) => window.clearInterval(t)); this.venueTimers = [];
      const nodes = this.venueNodes; this.venueNodes = [];
      if (this.ctx && this.venueBus) this.venueBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      window.setTimeout(() => nodes.forEach((n) => n.stop()), 1600);
    }
    this.venuePlaying = want;
    if (want === 'none' || !this.ctx || !this.venueBus) return;
    const c = this.ctx; const bus = this.venueBus;
    window.setTimeout(() => { if (this.venuePlaying === want) { bus.gain.cancelScheduledValues(c.currentTime); bus.gain.setTargetAtTime(0.38, c.currentTime, 1.2); } }, this.venueNodes.length ? 0 : 50);
    this.buildBed(want);
  }
  /** filtered noise with a slow swell (crowd murmur, wind, waves, room tone) */
  private vNoise(type: BiquadFilterType, freq: number, q: number, gain: number, lfoRate = 0, lfoDepth = 0) {
    const c = this.ctx!;
    const src = c.createBufferSource(); src.buffer = this.noise(4); src.loop = true;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(f).connect(g).connect(this.venueBus!); src.start();
    const stops = [() => { try { src.stop(); } catch { /* */ } }];
    if (lfoRate > 0) {
      const lfo = c.createOscillator(); lfo.frequency.value = lfoRate;
      const d = c.createGain(); d.gain.value = gain * lfoDepth;
      lfo.connect(d).connect(g.gain); lfo.start();
      stops.push(() => { try { lfo.stop(); } catch { /* */ } });
    }
    this.venueNodes.push({ stop: () => stops.forEach((x) => x()) });
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
  private vEvery(min: number, max: number, fn: (t: number) => void) {
    const bed = this.venuePlaying;
    const loop = () => {
      if (this.venuePlaying !== bed) return;
      if (this.ctx && this.ctx.state === 'running') fn(this.ctx.currentTime + 0.05);
      const id = window.setTimeout(loop, (min + Math.random() * (max - min)) * 1000);
      this.venueTimers.push(id);
    };
    const id = window.setTimeout(loop, (min * 0.5 + Math.random() * max * 0.5) * 1000);
    this.venueTimers.push(id);
  }
  private vBurst(t: number, dur: number, type: BiquadFilterType, freq: number, gain: number) {
    const c = this.ctx!;
    const src = c.createBufferSource(); src.buffer = this.noise(Math.max(0.05, dur));
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.01, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.venueBus!); src.start(t); src.stop(t + dur + 0.05);
  }
  private buildBed(bed: VenueBed) {
    const B = this.venueBus!;
    const murmur = (k: number) => { this.vNoise('bandpass', 520, 0.7, 0.05 * k, 0.21, 0.5); this.vNoise('bandpass', 900, 1.2, 0.02 * k, 0.13, 0.6); };
    const room = (k: number) => this.vNoise('lowpass', 260, 0.5, 0.05 * k);
    const crackle = (min: number, max: number, k = 1) => this.vEvery(min, max, (t) => { for (let i = 0; i < 3; i++) this.vBurst(t + Math.random() * 0.25, 0.012, 'highpass', 2500, 0.05 * k); });
    switch (bed) {
      case 'cookout':
        murmur(0.8); this.vNoise('highpass', 3500, 0.5, 0.008, 0.4, 0.6); // grill sizzle
        this.vEvery(1.5, 4, (t) => { for (let i = 0; i < 3; i++) this.tone(t + i * 0.07, 4600, 0.04, 'sine', 0.012, { dest: B }); }); // crickets
        crackle(0.6, 1.8, 0.7);
        break;
      case 'mansion':
        room(0.8);
        this.vEvery(6, 9, (t) => { const ch = [[392, 493.88, 587.33], [349.23, 440, 523.25], [329.63, 415.3, 493.88]][Math.floor(Math.random() * 3)]!; ch.forEach((f, i) => this.tone(t + i * 0.35, f, 3.2, 'sine', 0.012, { attack: 0.6, dest: B })); }); // distant piano-ish
        break;
      case 'barbershop':
        murmur(0.7); this.vHum(120, 0.004);
        this.vEvery(9, 18, (t) => this.tone(t, 118, 1.4, 'sawtooth', 0.01, { attack: 0.08, filter: 900, dest: B })); // clippers
        break;
      case 'basement':
        this.vHum(120, 0.006); murmur(0.6); room(0.6);
        this.vEvery(7, 14, (t) => { for (let i = 0; i < 5; i++) this.tone(t + i * 0.09, 220 + Math.random() * 120, 0.06, 'sine', 0.012, { dest: B }); }); // coffee percolator
        break;
      case 'rooftop':
        this.vNoise('lowpass', 520, 0.6, 0.06, 0.07, 0.7); // wind
        this.vNoise('lowpass', 140, 0.5, 0.06, 0.05, 0.3); // traffic rumble
        this.vEvery(14, 32, (t) => { this.tone(t, 392, 0.35, 'sawtooth', 0.008, { filter: 600, dest: B }); this.tone(t + 0.45, 349.23, 0.5, 'sawtooth', 0.008, { filter: 600, dest: B }); }); // distant horn
        break;
      case 'jazz': {
        room(0.7); crackle(0.4, 1.3, 0.5);
        const chords = [[146.83, 174.61, 220, 261.63], [98, 174.61, 246.94, 329.63], [130.81, 164.81, 246.94, 293.66], [110, 196, 233.08, 277.18]];
        let i = 0;
        this.vEvery(4, 4, (t) => { const ch = chords[i++ % 4]!; ch.forEach((f) => this.tone(t, f, 4.2, 'sine', 0.014, { attack: 0.8, dest: B })); this.tone(t, ch[0]! / 2, 1.4, 'sine', 0.03, { dest: B }); this.tone(t + 2, ch[0]! / 2 * 1.5, 1.2, 'sine', 0.022, { dest: B }); });
        break;
      }
      case 'casino':
        murmur(1);
        this.vEvery(2, 6, (t) => { const base = [1046.5, 1174.66, 1318.5, 1567.98]; for (let i = 0; i < 4; i++) this.tone(t + i * 0.09, base[Math.floor(Math.random() * 4)]!, 0.25, 'triangle', 0.008, { dest: B }); }); // slots
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
        break;
      case 'yacht':
        this.vNoise('bandpass', 420, 0.8, 0.06, 0.3, 0.7); // water lapping on the hull
        this.vNoise('lowpass', 500, 0.6, 0.035, 0.06, 0.6); // sea breeze
        this.vEvery(10, 22, (t) => this.tone(t, 90, 0.9, 'triangle', 0.01, { glideTo: 70, filter: 300, dest: B })); // a creak
        this.vEvery(16, 30, (t) => this.tone(t, 1800, 0.4, 'sine', 0.006, { glideTo: 1200, dest: B })); // gull
        break;
      default:
    }
  }
}

export const sound = new Engine();
sound.installUnlock();
if (typeof window !== 'undefined') (window as unknown as { __bwmSound?: Engine }).__bwmSound = sound;

export function useSoundSettings(): Engine['snapshot'] {
  return useSyncExternalStore(sound.subscribe, sound.getSnapshot, sound.getSnapshot);
}
