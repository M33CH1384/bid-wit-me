import { type ReactNode, useEffect, useRef, useState } from 'react';
import { loserCaption, victoryIdentity } from './victory';
import { createPortal } from 'react-dom';
import type { SeatInfo } from '@spades/protocol';
import type { VideoMesh, VideoState } from './video';
import { sound, useSoundSettings } from '../audio';
import type { SeatPos } from '../spatial';

/** A <video> bound to a MediaStream (iOS: playsInline + muted autoplay; unmuted after the first tap). */
function StreamVideo({ stream, muted, mirror, onFrames, volume = 1 }: { stream: MediaStream; muted: boolean; mirror?: boolean; onFrames?: (on: boolean) => void; volume?: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  // report whether real frames are showing (a connected-but-silent track renders black), so the bubble can show the
  // player's initial until video actually arrives
  useEffect(() => {
    const v = ref.current;
    if (!v || !onFrames) return;
    const check = () => onFrames(v.videoWidth > 0 && v.readyState >= 2 && stream.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted));
    const evs = ['loadeddata', 'playing', 'resize', 'emptied', 'pause'] as const;
    evs.forEach((e) => v.addEventListener(e, check));
    const tracks = stream.getVideoTracks();
    tracks.forEach((t) => { t.addEventListener('mute', check); t.addEventListener('unmute', check); t.addEventListener('ended', check); });
    const iv = window.setInterval(check, 1000);
    check();
    return () => {
      evs.forEach((e) => v.removeEventListener(e, check));
      tracks.forEach((t) => { t.removeEventListener('mute', check); t.removeEventListener('unmute', check); t.removeEventListener('ended', check); });
      clearInterval(iv);
      onFrames(false);
    };
  }, [stream, onFrames]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    v.muted = muted;
    v.play().catch(() => { /* autoplay blocked until a tap; muted retry */ v.muted = true; v.play().catch(() => {}); });
  }, [stream, muted]);
  useEffect(() => { if (ref.current) ref.current.volume = volume; }, [volume]);
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

export function SeatMedia({ seat, isMe, mesh, vs, limited = false, kick, seatPos, playerCount = 4 }: { seat: SeatInfo | undefined; isMe: boolean; mesh: VideoMesh | null; vs: VideoState; limited?: boolean; kick?: KickInfo; seatPos?: SeatPos; playerCount?: number }) {
  const [routed, setRouted] = useState(false);
  useSoundSettings(); // re-render on persisted mute / rebuild emits: mutedVoices is the single mute source
  const vcGen = sound.voiceChatGeneration;
  const [menu, setMenuState] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [frames, setFrames] = useState(false);
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
  const peerMuted = sound.voiceMuted(id); // single source of truth (persisted); the mesh no longer keeps its own mute list
  const muted = peerMuted || vs.needsTap || limited;
  // Phase 7: route this peer's voice through the engine (seat panner -> playerVoice bus).
  // While routed, the <video> element stays muted so the voice is heard exactly once.
  useEffect(() => {
    if (!stream || vs.needsTap || !hasLive(stream, 'audio')) { setRouted(false); return; }
    const ok = sound.attachVoiceChat(id, stream, seatPos, playerCount, { muted: peerMuted || limited, ducked: vs.ducked?.includes(id) });
    setRouted(ok);
    return () => { sound.detachVoiceChat(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream, seatPos, playerCount, vs.needsTap, vcGen]);
  useEffect(() => { if (routed) sound.updateVoiceChat(id, { muted: peerMuted || limited, ducked: vs.ducked?.includes(id) }); }, [routed, id, peerMuted, limited, vs.ducked]);
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
        <div className={`vb-clip ${frames ? '' : 'no-frames'}`}>{stream && <StreamVideo stream={stream} muted={routed ? true : muted} onFrames={setFrames} volume={vs.ducked?.includes(id) ? 0.4 : 1} />}</div>
        {(!camOn || hidden) && <span className="vb-icon">{hidden ? '🙈' : '🎙'}</span>}
        {/* camera on but no frames yet (connecting / stalled): their initial, never a black circle */}
        {camOn && !hidden && !frames && <span className="vb-icon initial" data-testid={`vb-initial-${id}`}>{seat.name.trim().charAt(0).toUpperCase() || '?'}</span>}
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
      {hasMedia && <button type="button" onClick={() => { sound.setVoiceMuted(id, !peerMuted); setMenu(false); }}>{peerMuted ? 'Unmute' : 'Mute'}</button>}
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
      {vs.error && <MediaErrorToast message={vs.error} onClose={() => mesh.clearError()} />}
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

/** Camera / mic problem: a proper toast (title, guidance, dismiss) instead of a scrap of text by the button. */
function MediaErrorToast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    const t = window.setTimeout(onClose, 15000);
    return () => { window.removeEventListener('keydown', key); clearTimeout(t); };
  }, [message, onClose]);
  const [first, ...rest] = message.split(/(?<=\.)\s/);
  return createPortal(
    <div className="media-toast glass" role="alert" data-testid="media-error">
      <span className="mt-icon" aria-hidden>📷</span>
      <div className="mt-text"><b>{first}</b>{rest.length > 0 && <span>{rest.join(' ')}</span>}</div>
      <button type="button" className="mt-x" aria-label="Dismiss" onClick={onClose}>✕</button>
    </div>,
    document.body,
  );
}

/**
 * Online victory screen. The headline is the winning TEAM's name ("SHOT CALLERS WIN", team gold), with the winning
 * players' full names under it; in Cutthroat the winning player's full name is the headline. A winner with live video
 * gets the big gold-framed video spotlight; a bot or a winner with the camera off gets a modest gold-framed name card
 * (avatar + FULL NAME), so on a ~390x844 phone the score and buttons fit without scrolling. Losers are small tiles.
 * Video here is muted: every player's voice keeps coming from their seat bubble (losers ducked while this is up, so
 * the winners' audio leads).
 */
export interface SpotPlayer { key: string; name: string; seat: SeatInfo | undefined; isMe: boolean }
export function VictorySpotlight({ winners, losers, title, sub, mesh, vs }: { winners: SpotPlayer[]; losers: SpotPlayer[]; title: string; sub?: string; mesh: VideoMesh | null; vs: VideoState }) {
  const loserIds = losers.flatMap((p) => (p.seat?.kind === 'human' && !p.isMe ? [p.seat.playerId] : []));
  const key = loserIds.join(',');
  useEffect(() => {
    if (!mesh) return;
    mesh.setLimited([]); // all mics open after the game, partner mute or not
    mesh.setDucked(loserIds);
    return () => mesh.setDucked([]);
  }, [mesh, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = winners.map((p) => ({ p, stream: liveStream(p, mesh, vs), id: victoryIdentity(p.seat, p.name) }));
  const anyVideo = shown.some((x) => x.stream);
  const label = (p: SpotPlayer, name: string) => (p.isMe && name !== 'You' ? `${name} (you)` : name);
  const lost = loserCaption(losers.length);
  return (
    <div className={`victory-spot n${winners.length}${anyVideo ? ' has-video' : ' no-video'}`} data-testid="victory-spot">
      <div className="vs-headline">
        <h3 className="vs-title" data-testid="vs-title">{title}</h3>
        {sub && <div className="vs-sub" data-testid="vs-sub">{sub}</div>}
      </div>
      <div className="vs-winners" style={{ ['--n' as string]: winners.length }}>
        {shown.map(({ p, stream, id }) => stream ? (
          <figure key={p.key} className="vs-tile win video" data-testid={`vs-win-${p.key}`}>
            <div className="vs-frame">{stream}</div>
            <figcaption>{label(p, id.name)}{id.bot && <small className="vs-bot" data-testid={`vs-bot-${p.key}`}>BOT</small>}</figcaption>
          </figure>
        ) : (
          // no live video: a compact name card, the full name the star (not a giant empty tile with an initial)
          <figure key={p.key} className="vs-tile win card" data-testid={`vs-win-${p.key}`}>
            <div className="vs-card" data-testid={`vs-avatar-${p.key}`}>
              <span className="vs-initial" aria-hidden>{id.name.trim().charAt(0).toUpperCase() || '?'}</span>
              <b className="vs-name" data-testid={`vs-name-${p.key}`}>{label(p, id.name)}</b>
              {id.bot && <small className="vs-bot" data-testid={`vs-bot-${p.key}`}>BOT</small>}
            </div>
          </figure>
        ))}
      </div>
      {lost && (
        <div className="vs-losers quiet" aria-label="Losing players" data-testid="vs-losers">
          <p className="vs-lost" data-testid="vs-lost">{lost}</p>
          <div className="vs-loser-row" style={{ ['--n' as string]: losers.length }}>
            {losers.map((p) => {
              const id = victoryIdentity(p.seat, p.name);
              return (
                <figure key={p.key} className="vs-tile lose quiet" data-testid={`vs-lose-${p.key}`}>
                  <div className="vs-frame">{liveStream(p, mesh, vs) ?? <Avatar p={p} name={id.name} bot={id.bot} />}</div>
                  <figcaption>{id.name}{id.bot && <small className="vs-bot" data-testid={`vs-bot-${p.key}`}>BOT</small>}</figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Avatar({ p, name, bot }: { p: SpotPlayer; name: string; bot: boolean }) {
  return <div className="vs-avatar" data-testid={`vs-avatar-${p.key}`}><span>{name.trim().charAt(0).toUpperCase() || '?'}</span>{bot && <small className="vs-bot">BOT</small>}</div>;
}

/** the player's live camera as a muted video element, or null (bot, camera off, not connected, hidden) */
function liveStream(p: SpotPlayer, mesh: VideoMesh | null, vs: VideoState): ReactNode | null {
  const seat = p.seat;
  if (!seat || seat.kind !== 'human' || !mesh) return null;
  if (p.isMe) return vs.cam && vs.local ? <StreamVideo stream={vs.local} muted mirror /> : null;
  const stream = vs.remote[seat.playerId];
  const live = seat.media.cam && seat.connected && !vs.hidden.includes(seat.playerId) && hasLive(stream, 'video');
  return live && stream ? <StreamVideo stream={stream} muted /> : null;
}
