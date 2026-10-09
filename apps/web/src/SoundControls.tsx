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
