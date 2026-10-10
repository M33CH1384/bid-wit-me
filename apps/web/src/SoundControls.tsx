import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { sound, useSoundSettings } from './audio';
import { HostMusicFields } from './online/HostMusic';
import { talkPrefs, useTalkPrefs } from './talkPrefs';
import { type NukeIntensity, fx, useNukeIntensity, useReduceEffects } from './fx';

const icon = (on: boolean, v: number) => (!on || v === 0 ? '🔇' : v < 0.4 ? '🔈' : v < 0.75 ? '🔉' : '🔊');

/** Volume / on-off / ambience controls (shared by the setup screen and the scorebug popover). */
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
      <label className="sf-row">
        <span>Volume</span>
        <input
          type="range" min={0} max={100} step={5} value={Math.round(s.volume * 100)} aria-label="Volume" disabled={!s.on}
          onChange={(e) => sound.set({ volume: Number(e.target.value) / 100 })}
          onPointerUp={() => sound.play('bid')}
        />
        <b className="sf-val">{Math.round(s.volume * 100)}</b>
      </label>
      <label className="sf-row">
        <span>Lounge ambience</span>
        <button type="button" role="switch" aria-checked={s.ambient} aria-label="Lounge ambience" className={`switch ${s.ambient ? 'on' : ''}`} disabled={!s.on} onClick={() => sound.set({ ambient: !s.ambient })}>
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
        <label className="sf-row">
          <span>Music volume</span>
          <input type="range" min={0} max={100} step={5} value={Math.round(s.musicVolume * 100)} aria-label="Music volume" onChange={(e) => sound.set({ musicVolume: Number(e.target.value) / 100 })} />
          <b className="sf-val">{Math.round(s.musicVolume * 100)}</b>
        </label>
      )}
      {s.music && s.nowPlaying && <p className="hint np-inline">♫ {s.nowPlaying.track.title} — {s.nowPlaying.track.artist}</p>}
      <BotTalkFields />
      {!compact && <p className="hint">On iPhone, the silent switch also mutes game sound.</p>}
    </div>
  );
}

/**
 * Always-visible speaker (every screen, top-right corner, safe-area aware). Tap: popover with music + SFX controls.
 * Long-press or double-tap: mute everything instantly (again to restore). Shows a muted icon when all is off and
 * animated bars while music is playing.
 */
export function SoundDock() {
  const s = useSoundSettings();
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const press = useRef<{ timer: number | null; long: boolean; lastTap: number; down: number }>({ timer: null, long: false, lastTap: -Infinity, down: 0 });
  // sit exactly on the screen's .dock-slot (next to the gear / scorebug buttons) so the pair lines up and matches
  useLayoutEffect(() => {
    let raf = 0;
    const sync = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const slot = [...document.querySelectorAll<HTMLElement>('.dock-slot')].find((x) => x.getBoundingClientRect().width > 0);
      // in the scorebug, the slot takes its neighbour's width so the whole cluster is one size
      let nb = slot?.classList.contains('bug-btn') ? (slot.previousElementSibling as HTMLElement | null) : null;
      while (nb && nb.getBoundingClientRect().width === 0) nb = nb.previousElementSibling as HTMLElement | null;
      if (slot && nb) { const nw = `${nb.getBoundingClientRect().width}px`; if (nb.getBoundingClientRect().width > 0 && slot.style.getPropertyValue('width') !== nw) slot.style.setProperty('width', nw, 'important'); }
      const r = slot?.getBoundingClientRect();
      if (!slot || !r) { el.classList.remove('slotted', 'in-bug'); return; }
      el.classList.add('slotted');
      el.classList.toggle('in-bug', slot.classList.contains('bug-btn'));
      const v = { '--dock-top': `${r.top}px`, '--dock-right': `${window.innerWidth - r.right}px`, '--dock-w': `${r.width}px`, '--dock-h': `${r.height}px` };
      for (const [k, x] of Object.entries(v)) if (el.style.getPropertyValue(k) !== x) el.style.setProperty(k, x);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(sync); };
    sync();
    const mo = new MutationObserver(kick);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', kick);
    const iv = window.setInterval(kick, 1000); // late layout shifts (fonts, safe areas)
    return () => { mo.disconnect(); window.removeEventListener('resize', kick); clearInterval(iv); if (raf) cancelAnimationFrame(raf); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 1300); return () => clearTimeout(t); }, [flash]);
  const muteAll = () => { const muted = sound.toggleMuteAll(); setOpen(false); setFlash(muted ? 'MUTED' : 'SOUND ON'); };
  const allOff = !s.on && !s.music;
  const playing = s.music && s.musicStatus === 'playing';
  return (
    <div className={`sound-dock ${open ? 'open' : ''}`} ref={ref}>
      <button
        type="button" className={`dock-btn ${allOff ? 'muted' : ''} ${playing ? 'playing' : ''}`}
        aria-label={allOff ? 'Sound (muted) — hold to unmute' : 'Sound settings — hold to mute all'} aria-expanded={open} data-testid="sound-button"
        onPointerDown={(e) => {
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
          setOpen((o) => !o);
        }}
      >
        <span className="dock-icon">{allOff ? '🔇' : icon(s.on || s.music, s.on ? s.volume : s.musicVolume)}</span>
        {playing && <span className="np-eq dock-eq" aria-hidden><i /><i /><i /></span>}
      </button>
      {flash && <div className="dock-flash" role="status">{flash}</div>}
      {open && (
        <div className="sound-pop glass slant" role="dialog" aria-label="Sound">
          <div className="pop-head"><span className="panel-title">SOUND</span><BotVoiceQuickMute /><button type="button" className="mute-all" data-testid="mute-all" onClick={muteAll}>{allOff ? 'Unmute' : 'Mute all'}</button></div>
          <SoundFields compact />
          <ReduceEffectsRow />
          <HostMusicFields />
        </div>
      )}
    </div>
  );
}

/** Speaker icon for the scorebug; opens a small glass popover with the sound controls. */
export default function SoundButton() {
  const s = useSoundSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="sound-btn-wrap" ref={ref}>
      <button type="button" className="bug-btn" aria-label="Sound settings" aria-expanded={open} data-testid="sound-button" onClick={() => setOpen((o) => !o)}>
        {icon(s.on, s.volume)}
      </button>
      {open && (
        <div className="sound-pop glass slant" role="dialog" aria-label="Sound">
          <div className="panel-title">SOUND</div>
          <SoundFields compact />
        </div>
      )}
    </div>
  );
}

/** "Now playing" ticker: slides in for a few seconds whenever a track starts. */
export function NowPlaying() {
  const s = useSoundSettings();
  const [show, setShow] = useState<null | { title: string; artist: string; key: number }>(null);
  useEffect(() => {
    if (!s.music || !s.nowPlaying || Date.now() - s.nowPlaying.at > 3000) return;
    setShow({ title: s.nowPlaying.track.title, artist: s.nowPlaying.track.artist, key: s.nowPlaying.at });
    const t = setTimeout(() => setShow(null), 6500);
    return () => clearTimeout(t);
  }, [s.nowPlaying, s.music]);
  if (!show) return null;
  return (
    <div className="now-playing glass slant" key={show.key} role="status" data-testid="now-playing">
      <span className="np-eq" aria-hidden><i /><i /><i /></span>
      <span className="np-label">NOW PLAYING</span>
      <span className="np-title">{show.title}</span>
      <span className="np-by">by {show.artist}</span>
    </div>
  );
}

/** "Reduce effects": keeps the hype sounds + pop-ups, drops camera shake, flashes and the shockwave. */
export function ReduceEffectsRow() {
  const on = useReduceEffects();
  return (
    <label className="sf-row">
      <span>Reduce effects<small className="sf-note"> · no shake / flash</small></span>
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
        {opts.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={v === k} className={v === k ? 'on' : ''} disabled={reduced} onClick={() => fx.setNuke(k)}>{l}</button>)}
      </div>
    </div>
  );
}

/** Per-player bot talk controls (local; work even when the host has trash talk on): voices, voice volume, hide text, clean talk. */
export function BotTalkFields() {
  const t = useTalkPrefs();
  const voiceOk = typeof window !== 'undefined' && 'speechSynthesis' in window;
  return (
    <div className="bot-talk-fields" data-testid="bot-talk-fields">
      <label className="sf-row">
        <span>Bot voices{!voiceOk && <small className="sf-note"> · not supported here</small>}</span>
        <button type="button" role="switch" aria-checked={t.voices} aria-label="Bot voices" data-testid="bot-voices" className={`switch ${t.voices ? 'on' : ''}`} disabled={!voiceOk} onClick={() => talkPrefs.set({ voices: !t.voices })}><i /></button>
      </label>
      {t.voices && (
        <label className="sf-row">
          <span>Bot voice volume</span>
          <input type="range" min={0} max={100} step={5} value={Math.round(t.voiceVolume * 100)} aria-label="Bot voice volume" data-testid="bot-voice-volume" onChange={(e) => talkPrefs.set({ voiceVolume: Number(e.target.value) / 100 })} />
          <b className="sf-val">{Math.round(t.voiceVolume * 100)}</b>
        </label>
      )}
      <label className="sf-row">
        <span>Hide bot trash talk<small className="sf-note"> · in your chat</small></span>
        <button type="button" role="switch" aria-checked={t.hideBotTalk} aria-label="Hide bot trash talk" data-testid="hide-bot-talk" className={`switch ${t.hideBotTalk ? 'on' : ''}`} onClick={() => talkPrefs.set({ hideBotTalk: !t.hideBotTalk })}><i /></button>
      </label>
      <label className="sf-row">
        <span>Clean talk<small className="sf-note"> · masks mild cursing</small></span>
        <button type="button" role="switch" aria-checked={t.cleanTalk} aria-label="Clean talk" data-testid="clean-talk" className={`switch ${t.cleanTalk ? 'on' : ''}`} onClick={() => talkPrefs.set({ cleanTalk: !t.cleanTalk })}><i /></button>
      </label>
    </div>
  );
}

/** Quick mute for bot voices in the sound dock popover. */
export function BotVoiceQuickMute() {
  const t = useTalkPrefs();
  return (
    <button type="button" className={`mute-all bot-mute ${t.voices ? '' : 'off'}`} data-testid="bot-voice-quick" aria-pressed={!t.voices} title={t.voices ? 'Mute bot voices' : 'Bot voices are off (tap to turn on)'} onClick={() => talkPrefs.set({ voices: !t.voices })}>
      🤖 {t.voices ? 'Mute bots' : 'Bots muted'}
    </button>
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
