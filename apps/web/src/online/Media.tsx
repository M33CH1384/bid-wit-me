import { useEffect, useRef, useState } from 'react';
import type { SeatInfo } from '@spades/protocol';
import type { VideoMesh, VideoState } from './video';

/** A <video> bound to a MediaStream (iOS: playsInline + muted autoplay; unmuted after the first tap). */
function StreamVideo({ stream, muted, mirror }: { stream: MediaStream; muted: boolean; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    v.muted = muted;
    v.play().catch(() => { /* autoplay blocked until a tap; muted retry */ v.muted = true; v.play().catch(() => {}); });
  }, [stream, muted]);
  return <video ref={ref} className={mirror ? 'mirror' : ''} autoPlay playsInline muted={muted} />;
}

function hasLive(stream: MediaStream | undefined, kind: 'video' | 'audio'): boolean {
  return !!stream && stream.getTracks().some((t) => t.kind === kind && t.readyState === 'live' && !t.muted);
}

/**
 * Video bubble for a seat's name plate. Self: small mirrored preview. Others: their camera when it's on;
 * tap for mute / hide (local only).
 */
export function SeatMedia({ seat, isMe, mesh, vs }: { seat: SeatInfo | undefined; isMe: boolean; mesh: VideoMesh | null; vs: VideoState }) {
  const [menu, setMenu] = useState(false);
  if (!seat || seat.kind !== 'human' || !mesh) return null;
  if (isMe) {
    if (!vs.cam || !vs.local) return null;
    return (
      <div className="vbubble self" data-testid="self-video">
        <StreamVideo stream={vs.local} muted mirror />
      </div>
    );
  }
  const id = seat.playerId;
  const stream = vs.remote[id];
  const camOn = seat.media.cam;
  const hidden = vs.hidden.includes(id);
  const muted = vs.muted.includes(id) || vs.needsTap;
  if (!camOn && !seat.media.mic) return null;
  const live = hasLive(stream, 'video');
  return (
    <div className={`vbubble ${camOn && !hidden ? '' : 'audio-only'}`} data-testid={`video-${id}`} data-live={live ? 'true' : 'false'}>
      {stream && <StreamVideo stream={stream} muted={muted} />}
      {(!camOn || hidden) && <span className="vb-icon">{hidden ? '🙈' : '🎙'}</span>}
      {camOn && !hidden && !live && <span className="vb-icon wait">…</span>}
      <button type="button" className="vb-hit" aria-label={`Video options for ${seat.name}`} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }} />
      {seat.media.mic && muted && <span className="vb-badge" title="Muted on your side">🔇</span>}
      {menu && (
        <div className="vb-menu glass" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => { mesh.toggleMuted(id); setMenu(false); }}>{vs.muted.includes(id) ? 'Unmute' : 'Mute'}</button>
          {camOn && <button type="button" onClick={() => { mesh.toggleHidden(id); setMenu(false); }}>{hidden ? 'Show video' : 'Hide video'}</button>}
        </div>
      )}
    </div>
  );
}

/** Camera + mic toggles (off by default; permission is only requested when turned on). */
export function MediaBar({ mesh, vs, seated }: { mesh: VideoMesh | null; vs: VideoState; seated: boolean }) {
  if (!mesh || !seated) return null;
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  return (
    <div className="av-bar" role="group" aria-label="Camera and microphone">
      <button type="button" className={`av-btn ${vs.cam ? 'on' : ''}`} disabled={!supported || vs.busy} aria-pressed={vs.cam} aria-label={vs.cam ? 'Turn camera off' : 'Turn camera on'} onClick={() => void mesh.setCam(!vs.cam)}>
        {vs.cam ? '📹' : '📷'}<small>{vs.cam ? 'ON' : 'CAM'}</small>
      </button>
      <button type="button" className={`av-btn ${vs.mic ? 'on' : ''}`} disabled={!supported || vs.busy} aria-pressed={vs.mic} aria-label={vs.mic ? 'Mute microphone' : 'Turn microphone on'} onClick={() => void mesh.setMic(!vs.mic)}>
        {vs.mic ? '🎙' : '🔇'}<small>{vs.mic ? 'ON' : 'MIC'}</small>
      </button>
      {vs.needsTap && Object.keys(vs.remote).length > 0 && <span className="av-hint">Tap anywhere for sound</span>}
      {vs.error && <span className="av-err" role="alert">{vs.error}</span>}
    </div>
  );
}
