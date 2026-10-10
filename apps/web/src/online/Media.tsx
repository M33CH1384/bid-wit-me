import { type ReactNode, useEffect, useRef, useState } from 'react';
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
/** Kick controls for another player's bubble menu: the host kicks (after a confirm); anyone else votes. */
export interface KickInfo { host: boolean; votes: number; need: number; voted: boolean; onKick: () => void }

/** Only one bubble menu is open at a time: opening one closes the others. */
const MENU_EVT = 'bwm-vbmenu';

export function SeatMedia({ seat, isMe, mesh, vs, limited = false, kick }: { seat: SeatInfo | undefined; isMe: boolean; mesh: VideoMesh | null; vs: VideoState; limited?: boolean; kick?: KickInfo }) {
  const [menu, setMenuState] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const myId = seat?.kind === 'human' ? seat.playerId : '';
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent<string>).detail !== myId) { setMenuState(false); setConfirm(false); } };
    window.addEventListener(MENU_EVT, on);
    return () => window.removeEventListener(MENU_EVT, on);
  }, [myId]);
  const setMenu = (v: boolean) => {
    if (v) window.dispatchEvent(new CustomEvent(MENU_EVT, { detail: myId }));
    setMenuState(v);
    if (!v) setConfirm(false);
  };
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
  const offline = !seat.connected;
  const stream = vs.remote[id];
  const camOn = seat.media.cam && !offline;
  const micOn = seat.media.mic && !offline;
  const hidden = vs.hidden.includes(id);
  const muted = vs.muted.includes(id) || vs.needsTap || limited;
  const hasMedia = camOn || micOn;
  // no camera/mic (or offline): no "…" bubble — just their initial (with the OFFLINE badge on the plate), still
  // clickable when there's a kick option
  if (!hasMedia && !kick) return null;
  const live = hasLive(stream, 'video');
  const kickItems = kick && (confirm ? (
    <div className="vb-confirm" data-testid={`kick-confirm-${id}`}>
      <span>Kick {seat.name}? A bot takes their seat and they can't rejoin this game.</span>
      <div className="vb-confirm-row">
        <button type="button" className="danger" data-testid={`kick-yes-${id}`} onClick={() => { kick.onKick(); setMenu(false); }}>Kick</button>
        <button type="button" onClick={() => setConfirm(false)}>Cancel</button>
      </div>
    </div>
  ) : kick.host ? (
    <button type="button" className="danger" data-testid={`kick-${id}`} onClick={() => setConfirm(true)}>Kick…</button>
  ) : (
    <button type="button" className={kick.voted ? 'voted' : 'danger'} data-testid={`vote-kick-${id}`} onClick={() => { kick.onKick(); setMenu(false); }}>
      {kick.voted ? 'Take back kick vote' : 'Vote to kick'}{kick.votes > 0 && <small> {kick.votes}/{kick.need}</small>}
    </button>
  ));
  return (
    <>
    {hasMedia ? (
      <div className={`vbubble ${camOn && !hidden ? '' : 'audio-only'}`} data-testid={`video-${id}`} data-live={live ? 'true' : 'false'}>
        {/* the clip layer keeps video circular everywhere (Safari ignores overflow+radius on <video> without its own layer) */}
        <div className="vb-clip">{stream && <StreamVideo stream={stream} muted={muted} />}</div>
        {(!camOn || hidden) && <span className="vb-icon">{hidden ? '🙈' : '🎙'}</span>}
        {camOn && !hidden && !live && <span className="vb-icon wait">…</span>}
        <button type="button" className="vb-hit" aria-label={`Options for ${seat.name}`} aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }} />
        {micOn && limited ? <span className="vb-badge limited" title="Partners can't hear each other during bids and play">🤐</span>
          : micOn && muted && <span className="vb-badge" title="Muted on your side">🔇</span>}
      </div>
    ) : (
      <button type="button" className={`vb-initial ${offline ? 'offline' : ''}`} data-testid={`initial-${id}`} aria-label={`Options for ${seat.name}`} aria-expanded={menu} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}>
        <span>{seat.name.trim().charAt(0).toUpperCase() || '?'}</span>
      </button>
    )}
    {menu && <VbMenu onClose={() => setMenu(false)} label={`Options for ${seat.name}`}>
      {hasMedia && <button type="button" onClick={() => { mesh.toggleMuted(id); setMenu(false); }}>{vs.muted.includes(id) ? 'Unmute' : 'Mute'}</button>}
      {camOn && <button type="button" onClick={() => { mesh.toggleHidden(id); setMenu(false); }}>{hidden ? 'Show video' : 'Hide video'}</button>}
      {kickItems}
    </VbMenu>}
    </>
  );
}

/** Camera + mic toggles (off by default; permission is only requested when turned on). */
export function MediaBar({ mesh, vs, seated, limited = false }: { mesh: VideoMesh | null; vs: VideoState; seated: boolean; limited?: boolean }) {
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
      {limited && vs.mic && <span className="mic-limited" data-testid="mic-limited" title="Your partner can't hear you during bids and play (opponents can). Mics open between hands.">MIC LIMITED</span>}
      {vs.needsTap && Object.keys(vs.remote).length > 0 && <span className="av-hint">Tap anywhere for sound</span>}
      {vs.error && <span className="av-err" role="alert">{vs.error}</span>}
    </div>
  );
}

/** Offline tables: the same CAM / MIC buttons, disabled, so it's clear where they live. */
export function OfflineMediaBar() {
  const tip = 'Camera & mic are for online tables. Play Online to use them';
  return (
    <div className="av-bar offline" role="group" aria-label="Camera and microphone (online tables only)" title={tip} data-testid="av-offline">
      <button type="button" className="av-btn" disabled aria-disabled="true" aria-label={`Camera — ${tip}`} title={tip}>📷<small>CAM</small></button>
      <button type="button" className="av-btn" disabled aria-disabled="true" aria-label={`Microphone — ${tip}`} title={tip}>🔇<small>MIC</small></button>
    </div>
  );
}

/** Table Talk: the enlarged "everyone on cam" tile — live video when the camera's on, otherwise an avatar. */
export function TalkTile({ seat, isMe, mesh, vs }: { seat: SeatInfo | undefined; isMe: boolean; mesh: VideoMesh | null; vs: VideoState }) {
  const name = seat && seat.kind !== 'empty' ? seat.name : '?';
  const avatar = <div className="tt-avatar"><span>{name.slice(0, 1).toUpperCase()}</span></div>;
  if (!seat || seat.kind !== 'human' || !mesh) return <>{avatar}{seat?.kind === 'bot' && <span className="tt-tag">BOT</span>}</>;
  if (isMe) return vs.cam && vs.local ? <StreamVideo stream={vs.local} muted mirror /> : avatar;
  const stream = vs.remote[seat.playerId];
  const live = seat.media.cam && !vs.hidden.includes(seat.playerId) && hasLive(stream, 'video');
  // video only here (muted): the seat's own bubble keeps playing the audio
  return <>{live && stream ? <StreamVideo stream={stream} muted /> : avatar}{seat.media.mic && <span className="tt-tag mic">🎙</span>}</>;
}

/** Small popover beside a video bubble (above the plates); closes on outside click / tap or Esc. */
function VbMenu({ children, onClose, label }: { children: ReactNode; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.('.vb-hit, .vb-initial')) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key); };
  }, [onClose]);
  return <div ref={ref} className="vb-menu glass" role="menu" aria-label={label} onClick={(e) => e.stopPropagation()}>{children}</div>;
}
