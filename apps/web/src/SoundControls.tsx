import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { sound, useSoundSettings } from './audio';
import { speakerAriaLabel } from './audioSession';
import { requestSettingsSheet } from './settingsSheet';
import { tableIntensity, talkPrefs, useTalkPrefs } from './talkPrefs';
import { TALK_INTENSITY_LABEL } from '@spades/bots';
import { type NukeIntensity, fx, useNukeIntensity, useReduceEffects, useTableNuke } from './fx';
import { setVibration, useVibration } from './haptics';
import { normalizeCategoryVolumes } from './spatial';

const icon = (on: boolean, v: number) => (!on || v === 0 ? '🔇' : v < 0.4 ? '🔈' : v < 0.75 ? '🔉' : '🔊');

export interface Box { left: number; top: number; width: number; height: number }

/**
 * The in-game speaker sits on the scorebug slot. The slot stretches to the full bug height; copying that
 * height made the button a tall hit target over the recap, on top of the team-name Save control.
 * Keep a square no larger than the slot, anchored to the slot's top-right.
 */
export function speakerSlotBox(
  slot: { top: number; right: number; width: number; height: number },
  viewportWidth: number,
  inBug: boolean,
): { top: number; right: number; width: number; height: number } {
  const cap = inBug ? 40 : 46;
  const side = Math.min(cap, slot.width || cap, slot.height || cap);
  return { top: slot.top, right: Math.max(0, viewportWidth - slot.right), width: side, height: side };
}

export function rectsOverlap(a: Box, b: Box): boolean {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

function VibrationSwitch() {
  const on = useVibration();
  return (
    <label className="sf-row"><span>Vibration</span>
      <button type="button" role="switch" aria-checked={on} aria-label="Vibration" data-testid="vibration-switch" className={`switch ${on ? 'on' : ''}`} onClick={() => setVibration(!on)}><i /></button>
    </label>
  );
}

/** One volume control: name (+ optional on/off switch) and value on a line, a full-width 44px slider under it. */
export function VolumeRow({ label, value, onChange, onRelease, disabled, testId, toggle }: {
  label: string; value: number; onChange: (v: number) => void; onRelease?: () => void; disabled?: boolean; testId?: string;
  toggle?: { on: boolean; set: (on: boolean) => void; label: string; testId?: string };
}) {
  const pct = Math.round(value * 100);
  return (
    <div className={`vol-row ${disabled ? 'off' : ''}`}>
      <div className="vol-head">
        <span className="vol-label">{label}</span>
        <b className="vol-val">{disabled ? 'Off' : pct}</b>
        {toggle && <button type="button" role="switch" aria-checked={toggle.on} aria-label={toggle.label} data-testid={toggle.testId} className={`switch ${toggle.on ? 'on' : ''}`} onClick={() => toggle.set(!toggle.on)}><i /></button>}
      </div>
      <input
        className="vol-slider" type="range" min={0} max={100} step={5} value={pct} aria-label={label} data-testid={testId} disabled={disabled}
        style={{ ['--pct' as string]: `${pct}%` }}
        onChange={(e) => onChange(Number(e.target.value) / 100)} onPointerUp={onRelease}
      />
    </div>
  );
}

/** Spatial controls: spatial toggle, audio quality, category volumes.
 *  Phase 7 adds the human Voice chat volume (playerVoice category, applied once on the voice-chat bus).
 *  There is NO room/soundscape picker (owner, 2026-10-20): each venue has its own signature
 *  sounds, set automatically from the venue — see sessionRoom in spatial.ts.
 *  Audio quality stacks (label line, then the seg full-width) so low / balanced / high
 *  always fit on ONE line at phone width — side-by-side, the seg wrapped 'high' onto a
 *  second row inside its half-width box. */
export function SpatialFields() {
  const s = useSoundSettings();
  const cats = normalizeCategoryVolumes(s.volumes);
  return (
    <>
      <label className="sf-row"><span>Spatial audio</span>
        <button type="button" role="switch" aria-checked={s.spatial !== false} aria-label="Spatial audio" data-testid="spatial-switch" className={`switch ${s.spatial !== false ? 'on' : ''}`} disabled={!s.on} onClick={() => sound.set({ spatial: s.spatial === false })}><i /></button></label>
      <div className="sf-row seg-stack"><span>Audio quality</span>
        <span className="seg" role="radiogroup" aria-label="Audio quality" data-testid="quality-seg">
          {(['low', 'balanced', 'high'] as const).map((q) => <button key={q} type="button" role="radio" aria-label={q} aria-checked={(s.quality ?? 'balanced') === q} className={(s.quality ?? 'balanced') === q ? 'on' : ''} onClick={() => sound.set({ quality: q })}>{q}</button>)}
        </span></div>
      <VolumeRow label="Effects volume" value={cats.sfx} disabled={!s.on} onChange={(v) => sound.set({ volumes: { ...cats, sfx: v } })} />
      <VolumeRow label="Ambience volume" value={cats.ambience} disabled={!s.on} onChange={(v) => sound.set({ volumes: { ...cats, ambience: v } })} />
      <VolumeRow label="Voice chat volume" value={cats.playerVoice} testId="voice-chat-volume" onChange={(v) => sound.set({ volumes: { ...cats, playerVoice: v } })} />
    </>
  );
}

/** Volume / on-off / ambience controls — the Settings sheet's Sound & music group body. */
export function SoundFields({ compact = false }: { compact?: boolean }) {
  const s = useSoundSettings();
  return (
    <div className={`sound-fields ${compact ? 'compact' : ''}`}>
      <label className="sf-row">
        <span>Sound effects</span>
        <button type="button" role="switch" aria-checked={s.on} aria-label="Sound effects" className={`switch ${s.on ? 'on' : ''}`} onClick={() => { sound.set({ on: !s.on }); if (!s.on) setTimeout(() => sound.play('tap'), 30); }}>
          <i />
        </button>
      </label>
      <VolumeRow label="Volume" value={s.volume} disabled={!s.on} onChange={(v) => sound.set({ volume: v })} onRelease={() => sound.play('bid')} />
      <VibrationSwitch />
      <label className="sf-row">
        <span>Venue sounds<small className="sf-note"> · plays with or without music</small></span>
        <button type="button" role="switch" aria-checked={s.venueSound !== false} aria-label="Venue sounds" data-testid="venue-sound-switch" className={`switch ${s.venueSound !== false ? 'on' : ''}`} disabled={!s.on} onClick={() => sound.set({ venueSound: s.venueSound === false })}>
          <i />
        </button>
      </label>
      <label className="sf-row">
        <span>Music{s.music && s.musicStatus === 'loading' ? <small className="sf-note"> · loading…</small> : s.music && s.musicStatus === 'error' ? <small className="sf-note"> · can't load track</small> : null}</span>
        <button type="button" role="switch" aria-checked={s.music} aria-label="Music" className={`switch ${s.music ? 'on' : ''}`} data-testid="music-switch" onClick={() => sound.set({ music: !s.music })}>
          <i />
        </button>
      </label>
      {s.music && (
        <VolumeRow label="Music volume" value={s.musicVolume} onChange={(v) => sound.set({ musicVolume: v })} />
      )}
      {s.music && s.nowPlaying && <p className="hint np-inline">♫ {s.nowPlaying.track.title} — {s.nowPlaying.track.artist}</p>}
      <SpatialFields />
      <BotTalkFields />
      <p className="hint">Menus run no venue-ambience scene. Games default to music; every venue has its own signature sounds, set automatically from the venue you're in, and they play whether music is on or off. Your switch choices here are remembered per kind of screen.</p>
      {!compact && <p className="hint">On iPhone, the silent switch also mutes game sound.</p>}
    </div>
  );
}

/**
 * Always-visible speaker: it renders INTO the screen's .dock-slot (the home top bar,
 * the in-game scorebug) via a portal, so it sits in the header's own flow and can
 * never drift onto a neighbouring button; where a screen has no slot it floats at
 * the top-right corner, and CSS stands it down entirely under modal sheets, the
 * Social panel, the versus/loading hold and the victory screen (design audit D1).
 * Tap: opens the ONE Settings sheet (settingsSheet.ts), landed on the Sound & music
 * group — the speaker has no settings surface of its own anymore (owner, 2026-10-20).
 * The same tap resumes or rebuilds a suspended AudioContext and primes music inside
 * the gesture. Long-press or double-tap: mute everything instantly (again to
 * restore). Shows a muted icon when all is off, a needs-tap ring while the context
 * is suspended, and animated bars while music is playing.
 */
export function SoundDock() {
  const s = useSoundSettings();
  const [flash, setFlash] = useState<string | null>(null);
  const press = useRef<{ timer: number | null; long: boolean; lastTap: number; down: number }>({ timer: null, long: false, lastTap: -Infinity, down: 0 });
  // Sit IN the screen's .dock-slot (next to the gear / scorebug buttons) so the pair lines up and matches.
  // The dock used to park a position:fixed box on the slot's MEASURED viewport rect; that measurement raced
  // the app's own transition transforms (spray / fan / deal) and only re-synced on mutation, resize, scroll or
  // a 1s tick, so the box landed stale — measured overlapping the header's Social/gear buttons by 15–45px at
  // every size in the 2026-10-24 design audit (D1), and floating over the versus/loading layer where the
  // screen renders no slot at all. Rendering into the slot removes the measurement entirely: layout is the
  // header's own, at every size, in both themes. Slot identity is tracked (not geometry) via MutationObserver,
  // with resize + a 1s tick as backstops for late layout (fonts, safe areas).
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const find = () => {
      const next = [...document.querySelectorAll<HTMLElement>('.dock-slot')].find((x) => x.getBoundingClientRect().width > 0) ?? null;
      setSlot((prev) => (prev === next ? prev : next));
    };
    find();
    const mo = new MutationObserver(find);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', find);
    const iv = window.setInterval(find, 1000);
    return () => { mo.disconnect(); window.removeEventListener('resize', find); clearInterval(iv); };
  }, []);
  const inBug = !!slot && slot.classList.contains('bug-btn');
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 1300); return () => clearTimeout(t); }, [flash]);
  const muteAll = () => { const muted = sound.toggleMuteAll(); setFlash(muted ? 'MUTED' : 'SOUND ON'); };
  const allOff = !s.on && !s.music;
  const playing = s.music && s.musicStatus === 'playing';
  const needsTap = s.needsRestore;
  const dock = (
    <div className={`sound-dock${slot ? ' slotted' : ''}${inBug ? ' in-bug' : ''}`}>
      <button
        type="button" className={`dock-btn ${allOff ? 'muted' : ''} ${playing ? 'playing' : ''} ${needsTap ? 'needs-tap' : ''}`}
        aria-label={speakerAriaLabel(needsTap, allOff)} data-testid="sound-button" data-needs-tap={needsTap ? 'true' : 'false'}
        onPointerDown={(e) => {
          // Inside the user gesture: resume or rebuild, and prime the music elements before the sheet opens.
          sound.wake('gesture');
          press.current.long = false;
          press.current.down = e.timeStamp;
          press.current.timer = window.setTimeout(() => { press.current.long = true; muteAll(); }, 500);
        }}
        onPointerUp={(e) => {
          if (press.current.timer) clearTimeout(press.current.timer);
          // a busy main thread can fire the hold timer before a quick tap's pointerup is handled: the event times say it was a tap
          if (press.current.long && e.timeStamp - press.current.down < 420) { sound.toggleMuteAll(); setFlash(null); press.current.long = false; }
        }}
        onPointerLeave={() => { if (press.current.timer) clearTimeout(press.current.timer); }}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (press.current.long) { press.current.long = false; return; }
          const now = performance.now();
          if (now - press.current.lastTap < 320) { press.current.lastTap = -Infinity; muteAll(); return; }
          press.current.lastTap = now;
          // ONE sheet total (owner, 2026-10-20): the speaker opens the same Settings
          // sheet as the gear, landed on the Sound & music group — no second surface.
          requestSettingsSheet('sound');
        }}
      >
        <span className="dock-icon">{allOff ? '🔇' : icon(s.on || s.music, s.on ? s.volume : s.musicVolume)}</span>
        {playing && <span className="np-eq dock-eq" aria-hidden><i /><i /><i /></span>}
      </button>
      {flash && <div className="dock-flash" role="status">{flash}</div>}
    </div>
  );
  // In-slot where the screen provides one; the fixed corner float otherwise (and
  // CSS hides the float — and the dock — under modal/immersive layers, D1).
  return slot ? createPortal(dock, slot) : dock;
}

let npShown = false; // once per page load, ever
/** "Now playing": shown quietly ONCE, when a game starts (never in the lobby), auto-dismissed after ~2s. */
export function NowPlaying() {
  const s = useSoundSettings();
  const [show, setShow] = useState<null | { title: string; key: number }>(null);
  useEffect(() => {
    if (npShown || !s.music || !s.nowPlaying || Date.now() - s.nowPlaying.at > 3000) return;
    if (document.querySelector('[data-testid="lobby"]')) return; // never over the lobby / dock
    npShown = true;
    setShow({ title: s.nowPlaying.track.title, key: s.nowPlaying.at });
    const t = setTimeout(() => setShow(null), 2000);
    return () => clearTimeout(t);
  }, [s.nowPlaying, s.music]);
  if (!show) return null;
  return (
    <div className="now-playing quiet" key={show.key} role="status" data-testid="now-playing">
      <span className="np-title">♫ {show.title}</span>
    </div>
  );
}

/** Chat sounds: a DM chime anywhere in the app, a soft blip in chat while you read. Lives in the Settings sheet's Sound & music group. */
export function ChatSoundsRow() {
  const s = useSoundSettings();
  return (
    <label className="sf-row"><span>Chat sounds<small className="sf-note"> · DM ding anywhere, chat blip while you read</small></span>
      <button type="button" role="switch" aria-checked={s.chatSounds !== false} aria-label="Chat sounds" data-testid="chat-sounds-switch" className={`switch ${s.chatSounds !== false ? 'on' : ''}`} onClick={() => { const on = s.chatSounds === false; sound.set({ chatSounds: on }); if (on) setTimeout(() => sound.play('dmChime'), 30); }}><i /></button></label>
  );
}

/** "Reduce effects": keeps the hype sounds + pop-ups, drops camera shake, flashes and the shockwave. */
export function ReduceEffectsRow() {
  const on = useReduceEffects();
  return (
    <label className="sf-row">
      <span>Reduce effects<small className="sf-note"> · no shake / flash, calm nuke (your device's Reduce motion only drops the shake)</small></span>
      <button type="button" role="switch" aria-checked={on} aria-label="Reduce effects" data-testid="reduce-fx" className={`switch ${on ? 'on' : ''}`} onClick={() => fx.setReduce(!on)}><i /></button>
    </label>
  );
}

/** Offline table setting "Nuke intensity" (saved locally): Full Nuke / Classic / Off. Online the host sets it in the lobby. Reduce effects forces Off for you. */
export function NukeIntensityRow() {
  const v = useNukeIntensity();
  const reduced = useReduceEffects();
  const opts: [NukeIntensity, string][] = [['full', 'Full Nuke'], ['classic', 'Classic'], ['off', 'Off']];
  return (
    <div className="sf-row nuke-row">
      <span>Nuke intensity<small className="sf-note"> · {reduced ? 'Off while Reduce effects is on' : v === 'full' ? 'blast + everything blown away' : v === 'classic' ? 'cinematic blast only' : 'banner + boom'}</small></span>
      <div className="seg" role="radiogroup" aria-label="Nuke intensity" data-testid="nuke-intensity">
        {opts.map(([k, l]) => <button key={k} type="button" role="radio" aria-label={l} aria-checked={v === k} className={v === k ? 'on' : ''} disabled={reduced} onClick={() => fx.setNuke(k)}>{l}</button>)}
      </div>
    </div>
  );
}

/** In a game: the table's nuke level, read-only (online the host sets it; offline it's fixed when the game starts). */
export function TableNukeInfo({ short = false }: { short?: boolean }) {
  const t = useTableNuke();
  const reduced = useReduceEffects();
  if (!t) return null;
  const label = t === 'full' ? 'Full Nuke' : t === 'classic' ? 'Classic' : 'Off';
  return (
    <div className="sf-row nuke-row" data-testid="table-nuke-info">
      <span>Nuke intensity{short ? (reduced ? <small className="sf-note"> · off for you</small> : null) : <small className="sf-note"> · 🔒 Locked for this game{reduced ? ' · Off for you (Reduce effects)' : ''}</small>}</span>
      <b className="sf-val">{label}</b>
    </div>
  );
}

/** Per-player bot talk controls (local; work even when the host has trash talk on): voices, voice volume, hide text; the table's intensity (read-only). */
export function BotTalkFields() {
  const t = useTalkPrefs();
  // recorded clips need Web Audio; Web Speech covers lines without a clip
  const voiceOk = typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window || 'speechSynthesis' in window);
  return (
    <div className="bot-talk-fields" data-testid="bot-talk-fields">
      <label className="sf-row">
        <span>Bot voices{!voiceOk && <small className="sf-note"> · not supported here</small>}</span>
        <button type="button" role="switch" aria-checked={t.voices} aria-label="Bot voices" data-testid="bot-voices" className={`switch ${t.voices ? 'on' : ''}`} disabled={!voiceOk} onClick={() => talkPrefs.set({ voices: !t.voices })}><i /></button>
      </label>
      {t.voices && (
        <VolumeRow label="Bot voice volume" value={t.voiceVolume} testId="bot-voice-volume" onChange={(v) => talkPrefs.set({ voiceVolume: v })} />
      )}
      {t.voices && (
        <label className="sf-row">
          <span>AI voice lines<small className="sf-note"> · big moments, when the table has them</small></span>
          <button type="button" role="switch" aria-checked={t.aiVoices} aria-label="AI voice lines" data-testid="ai-voices" className={`switch ${t.aiVoices ? 'on' : ''}`} onClick={() => talkPrefs.set({ aiVoices: !t.aiVoices })}><i /></button>
        </label>
      )}
      <label className="sf-row">
        <span>Hide bot trash talk<small className="sf-note"> · in your chat</small></span>
        <button type="button" role="switch" aria-checked={t.hideBotTalk} aria-label="Hide bot trash talk" data-testid="hide-bot-talk" className={`switch ${t.hideBotTalk ? 'on' : ''}`} onClick={() => talkPrefs.set({ hideBotTalk: !t.hideBotTalk })}><i /></button>
      </label>
      <div className="sf-row" data-testid="talk-intensity-info">
        <span>Trash talk<small className="sf-note"> · set for the table{tableIntensity() === 'family' ? ' · mild cursing masked' : ''}</small></span>
        <b className="sf-val">{TALK_INTENSITY_LABEL[tableIntensity()]}</b>
      </div>
    </div>
  );
}

/**
 * The retired Sound sheet's two quick actions, now at the top of the Settings
 * sheet's Sound & music group (owner consolidation, 2026-10-20): mute the bot
 * voices, or mute everything, without hunting through the individual switches.
 * These were the old sheet's only controls that didn't already live in Settings.
 */
export function SoundQuickActions() {
  const s = useSoundSettings();
  const t = useTalkPrefs();
  const allOff = !s.on && !s.music;
  return (
    <div className="sheet-actions">
      <button type="button" className={`mute-all bot-mute big ${t.voices ? '' : 'off'}`} data-testid="bot-voice-quick" aria-pressed={!t.voices} onClick={() => talkPrefs.set({ voices: !t.voices })}>🤖 {t.voices ? 'Mute bots' : 'Bots muted'}</button>
      <button type="button" className="mute-all big" data-testid="mute-all" onClick={() => sound.toggleMuteAll()}>{allOff ? '🔊 Unmute' : '🔇 Mute all'}</button>
    </div>
  );
}

/** Offline table setting: bots talk trash (online the host decides in the lobby). */
export function BotTrashTalkRow() {
  const t = useTalkPrefs();
  return (
    <label className="sf-row">
      <span>Bot trash talk<small className="sf-note"> · offline games; online the host decides</small></span>
      <button type="button" role="switch" aria-checked={t.botTalk} aria-label="Bot trash talk" data-testid="bot-trash-talk" className={`switch ${t.botTalk ? 'on' : ''}`} onClick={() => talkPrefs.set({ botTalk: !t.botTalk })}><i /></button>
    </label>
  );
}
