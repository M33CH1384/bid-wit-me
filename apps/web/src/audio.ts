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
  | 'jokerLittle' | 'jokerBig' | 'nuke' | 'streak1' | 'streak2' | 'streak3' | 'shot' | 'gotShot';

export interface SoundSettings { on: boolean; volume: number; ambient: boolean; music: boolean; musicVolume: number }
const KEY = 'bwm.sound.v1';
const DEFAULTS: SoundSettings = { on: true, volume: 0.7, ambient: false, music: false, musicVolume: 0.5 };
export type MusicStatus = 'off' | 'loading' | 'playing' | 'error';

export interface Track { file: string; title: string; artist: string; license: string; source: string }
/** Background playlist (lazy-loaded, 128 kbps MP3). Credits: see CREDITS.md and the in-game Credits screen. */
export const TRACKS: Track[] = [
  { file: 'windows-down', title: 'Windows Down', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/lo-fi-and-chill-collection' },
  { file: 'coins', title: 'Coins', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/gamer-beats-collection' },
  { file: 'final-level', title: 'Final Level', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/gamer-beats-collection' },
  { file: '2-hour-delay', title: '2 Hour Delay', artist: 'Holizna', license: 'CC0', source: 'https://opengameart.org/content/lo-fi-and-chill-collection' },
  { file: 'chillin-hard', title: 'Chillin Hard', artist: 'Kevin MacLeod', license: 'CC BY 4.0', source: 'https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1600028' },
];
export const CC_BY_LINE = '"Chillin Hard" Kevin MacLeod (incompetech.com) Licensed under Creative Commons: By Attribution 4.0 License http://creativecommons.org/licenses/by/4.0/';
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
    merge.connect(bus).connect(c.destination);
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
      this.syncMusic();
    };
    ['pointerdown', 'touchend', 'keydown'].forEach((e) => window.addEventListener(e, unlock, true));
    // iOS suspends the context when the app is backgrounded; resume on return
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.ctx && this.ctx.state !== 'running' && this.unlocked) void this.ctx.resume(); });
  }

  private ensure() {
    if (this.ctx || !AC) return;
    const c = new AC({ latencyHint: 'interactive' });
    this.ctx = c;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.connect(this.master);
    this.ambBus = c.createGain(); this.ambBus.gain.value = 0; this.ambBus.connect(this.master);
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
  private cutHit(t: number, g: number) {
    const c = this.ctx!;
    const s = c.createBufferSource(); s.buffer = this.noise(0.12);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const ng = c.createGain(); ng.gain.setValueAtTime(0.5 * g, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    s.connect(hp).connect(ng).connect(this.sfxBus!); s.start(t); s.stop(t + 0.12);
    this.tone(t, 160, 0.18, 'sine', 0.55 * g, { glideTo: 55, attack: 0.002 });
    this.tone(t + 0.01, 1760, 0.16, 'sawtooth', 0.06 * g, { glideTo: 600, filter: 5000, attack: 0.002 });
    this.tone(t + 0.01, 2349, 0.22, 'square', 0.025 * g, { glideTo: 1175, filter: 6000, attack: 0.002 });
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

  /** Big Joker over Little Joker: crack, boom with sub-bass, long rumble and debris crackle. */
  private nukeBoom(t: number, g: number) {
    const c = this.ctx!;
    const dist = this.shaper(40); const out = c.createGain(); out.gain.value = 0.85 * g;
    dist.connect(out).connect(this.sfxBus!);
    this.burst(t, 0.12, 0.9 * g, 'highpass', 1200); // the crack
    this.tone(t, 80, 2.6, 'sine', 1, { glideTo: 18, attack: 0.004, dest: dist }); // boom
    this.tone(t + 0.02, 36, 3.2, 'sine', 0.8 * g, { attack: 0.05 }); // sub-bass
    this.tone(t, 110, 0.6, 'sawtooth', 0.3, { glideTo: 30, filter: 600, dest: dist });
    this.burst(t, 3.4, 0.85 * g, 'lowpass', 600, { sweepTo: 50 }); // rolling rumble
    this.burst(t + 0.3, 2.6, 0.25 * g, 'bandpass', 900, { q: 0.7, sweepTo: 200 }); // wind
    // debris crackle: dozens of tiny bright clicks, thinning out
    for (let i = 0; i < 70; i++) {
      const dt = 0.25 + Math.pow(Math.random(), 1.6) * 2.6;
      this.burst(t + dt, 0.018 + Math.random() * 0.03, (0.22 - dt * 0.06) * g * (0.5 + Math.random()), 'bandpass', 1800 + Math.random() * 4200, { q: 3 });
    }
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
}

export const sound = new Engine();
sound.installUnlock();
if (typeof window !== 'undefined') (window as unknown as { __bwmSound?: Engine }).__bwmSound = sound;

export function useSoundSettings(): Engine['snapshot'] {
  return useSyncExternalStore(sound.subscribe, sound.getSnapshot, sound.getSnapshot);
}
