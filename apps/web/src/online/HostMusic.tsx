import { useEffect, useRef, useState } from 'react';
import { type HostMusic as HostMusicState, isMusicLink } from '@spades/protocol';
import { TRACKS } from '../audio';
import { hostMusic, useHostMusic } from '../hostMusic';
import type { ConnState, TableConnection } from './connection';
import { useVideo } from './useOnline';
import type { VideoMesh } from './video';

/** "Now playing" card for a shared Spotify / Apple Music link — tap to open in your own app. */
export function MusicLinkCard({ music, compact = false }: { music: HostMusicState | null | undefined; compact?: boolean }) {
  if (!music || music.mode !== 'link') return null;
  const svc = /apple\.com/.test(music.url) ? 'Apple Music' : 'Spotify';
  return (
    <a className={`music-card glass ${compact ? 'compact' : ''}`} href={music.url} target="_blank" rel="noopener noreferrer" data-testid="music-card">
      <span className="mc-icon">♫</span>
      <span className="mc-text"><small>HOST IS PLAYING</small><b>{music.title || 'Tap to listen'}</b></span>
      <span className="mc-open">Open in {svc} ↗</span>
    </a>
  );
}

/** Plays the host's streamed audio (third WebRTC transceiver) at this player's Host music volume. */
export function HostStreamAudio({ stream, blocked }: { stream: MediaStream | undefined; blocked: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const { volume } = useHostMusic();
  useEffect(() => {
    const a = ref.current;
    if (!a || !stream) return;
    if (a.srcObject !== stream) a.srcObject = stream;
    a.muted = blocked;
    void a.play().catch(() => {});
  }, [stream, blocked]);
  useEffect(() => { if (ref.current) ref.current.volume = volume; }, [volume]);
  return stream ? <audio ref={ref} autoPlay data-testid="host-stream-audio" /> : null;
}

/** Host music controls (sound popover): everyone gets the volume; the host picks a beat, shares a link or streams. */
export function HostMusicFields() {
  const hm = useHostMusic();
  const room = hm.room;
  const [tab, setTab] = useState<'beat' | 'link' | 'stream'>(() => (room?.music?.mode === 'link' ? 'link' : room?.music?.mode === 'stream' ? 'stream' : 'beat'));
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  if (!room) return null;
  const m = room.music;
  const active = m && m.mode !== 'off';
  const label = !active ? 'Off' : m.mode === 'beat' ? `♫ ${TRACKS[m.track % TRACKS.length]!.title}` : m.mode === 'link' ? `Link: ${m.title || 'now playing'}` : `Streaming: ${m.title || 'host audio'}`;
  return (
    <div className="host-music" data-testid="host-music">
      <div className="sf-row hm-head"><span>Host music</span><small className="sf-note">{label}{hm.status === 'blocked' ? ' · tap ▶' : ''}</small></div>
      <label className="sf-row">
        <span>Host music volume</span>
        <input type="range" min={0} max={100} step={5} value={Math.round(hm.volume * 100)} aria-label="Host music volume" data-testid="host-music-volume" onChange={(e) => hostMusic.setVolume(Number(e.target.value) / 100)} />
        <b className="sf-val">{Math.round(hm.volume * 100)}</b>
      </label>
      {hm.status === 'blocked' && <button type="button" className="hm-btn" onClick={() => hostMusic.resume()}>▶ Play host music</button>}
      {m?.mode === 'link' && <MusicLinkCard music={m} compact />}
      {room.isHost && (
        <div className="hm-host">
          <div className="hm-tabs" role="tablist">
            {(['beat', 'link', 'stream'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'beat' ? 'Beats' : t === 'link' ? 'Spotify / Apple' : 'Stream'}</button>)}
          </div>
          {tab === 'beat' && (
            <div className="hm-beats">
              {TRACKS.map((t, i) => (
                <button key={t.file} type="button" data-testid={`hm-beat-${i}`} className={m?.mode === 'beat' && m.track === i ? 'on' : ''} onClick={() => hostMusic.pickBeat(i)}>{t.title}</button>
              ))}
              <p className="hint">Plays in sync for the whole table.</p>
            </div>
          )}
          {tab === 'link' && (
            <form className="hm-link" onSubmit={(e) => { e.preventDefault(); if (!isMusicLink(url.trim())) { setErr('Paste an open.spotify.com or music.apple.com link'); return; } setErr(null); hostMusic.shareLink(url.trim(), title.trim()); }}>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://open.spotify.com/…" aria-label="Spotify or Apple Music link" inputMode="url" />
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song — Artist (optional)" aria-label="Song title" maxLength={120} />
              <button type="submit" className="hm-btn">Share with the table</button>
              {err && <small className="sf-note">{err}</small>}
              <p className="hint">Everyone gets a tappable card; each player listens in their own app.</p>
            </form>
          )}
          {tab === 'stream' && (
            <div className="hm-stream">
              {hostMusic.canStreamDevice && <button type="button" className="hm-btn" onClick={() => { setErr(null); hostMusic.streamDevice().catch((e) => setErr(String(e?.message ?? e))); }}>Share tab / device audio</button>}
              <button type="button" className="hm-btn" onClick={() => fileRef.current?.click()}>Stream an audio file</button>
              <input ref={fileRef} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) hostMusic.streamFile(f).catch((x) => setErr(String(x?.message ?? x))); e.target.value = ''; }} />
              {hm.source && <p className="hint">Streaming “{hm.source.title}”</p>}
              {err && <small className="sf-note">{err}</small>}
              <p className="hint disclaimer">Only stream music you have the rights to share. You're responsible for what you play to the table.</p>
            </div>
          )}
          {active && <button type="button" className="hm-btn off" data-testid="hm-off" onClick={() => hostMusic.off()}>Stop host music</button>}
        </div>
      )}
    </div>
  );
}

/** Keeps the host-music store in sync with the room (lobby + table) and plays a host's stream for everyone. */
export function HostMusicBridge({ conn, cs, mesh }: { conn: TableConnection; cs: ConnState; mesh: VideoMesh | null }) {
  const vs = useVideo(mesh);
  const room = cs.room;
  const isHost = !!room && room.hostId === cs.you;
  const music = room?.music ?? null;
  const skew = room ? room.now - Date.now() : 0;
  const key = JSON.stringify(music);
  useEffect(() => {
    if (!room) return;
    hostMusic.setRoom({ isHost, music, send: (m) => conn.send({ t: 'music', music: m }), setTrack: (t) => mesh?.setMusicTrack(t) }, skew);
  }, [key, isHost, conn, mesh, !!room]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => hostMusic.setRoom(null), []);
  const streamer = music?.mode === 'stream' && music.by !== cs.you ? music.by : null;
  return streamer ? <HostStreamAudio stream={vs.music[streamer]} blocked={vs.needsTap} /> : null;
}
