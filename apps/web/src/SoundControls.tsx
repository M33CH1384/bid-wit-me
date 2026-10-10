import { useEffect, useRef, useState } from 'react';
import { sound, useSoundSettings } from './audio';

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
  const press = useRef<{ timer: number | null; long: boolean; lastTap: number }>({ timer: null, long: false, lastTap: -Infinity });
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
        onPointerDown={() => {
          press.current.long = false;
          press.current.timer = window.setTimeout(() => { press.current.long = true; muteAll(); }, 500);
        }}
        onPointerUp={() => { if (press.current.timer) clearTimeout(press.current.timer); }}
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
          <div className="pop-head"><span className="panel-title">SOUND</span><button type="button" className="mute-all" data-testid="mute-all" onClick={muteAll}>{allOff ? 'Unmute' : 'Mute all'}</button></div>
          <SoundFields compact />
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
