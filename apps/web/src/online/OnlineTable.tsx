import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sideOf } from '@spades/rules';
import Table from '../Table';
import { type Settings, loadSettings, saveSettings } from '../settings';
import type { ConnState, TableConnection } from './connection';
import { MediaBar, SeatMedia, TalkTile } from './Media';
import { MusicLinkCard } from './HostMusic';
import { localNames, useCountdown, useOnlineChat, useOnlineSource, useVideo } from './useOnline';
import type { VideoMesh } from './video';

/** The 3D table, driven by the server: rotated per-seat view, real chat, video bubbles, turn clock. */
export default function OnlineTable({ conn, cs, mesh, onLobby, onMainMenu }: { conn: TableConnection; cs: ConnState; mesh: VideoMesh | null; onLobby: () => void; onMainMenu?: () => void }) {
  const source = useOnlineSource(cs, conn);
  const vs = useVideo(mesh);
  const [settings, setSettings] = useState<Settings>(() => ({ ...loadSettings(), speed: 'normal' }));
  const room = cs.room!;
  const rot = source?.rot ?? null;
  const names = useMemo(() => (rot ? localNames(room, rot) : []), [room, rot]);
  const send = useCallback((text: string) => conn.send({ t: 'chat', text }), [conn]);
  const chat = useOnlineChat(cs, source?.st ?? null, names, send);
  const skew = room.now - Date.now();
  const secs = useCountdown(room.deadline ? room.deadline - skew : null);

  // Voice anti-cheat: during bidding and trick play my mic isn't sent to my partner and theirs isn't played here.
  // Opponents can still hear each other (trash talk is part of the game); everyone's open in the lobby,
  // between hands (Table Talk) and after the game.
  const gp = source?.st.phase;
  const partnerId = (() => {
    if (!rot || !room.rules.partnerships || cs.seat === null) return null;
    const s = room.seats[(cs.seat + 2) % room.rules.playerCount];
    return s?.kind === 'human' ? s.playerId : null;
  })();
  const limitedNow = room.phase === 'playing' && (gp === 'bidding' || gp === 'exchange' || gp === 'playing') && !!partnerId;
  useEffect(() => { mesh?.setLimited(limitedNow && partnerId ? [partnerId] : []); }, [mesh, limitedNow, partnerId]);
  useEffect(() => () => mesh?.setLimited([]), [mesh]);
  const prevPhase = useRef(gp);
  const [talkOver, setTalkOver] = useState(false);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = gp;
    if (was === 'handOver' && gp && gp !== 'handOver' && gp !== 'gameOver' && partnerId) {
      setTalkOver(true);
      const t = setTimeout(() => setTalkOver(false), 3000);
      return () => clearTimeout(t);
    }
  }, [gp, partnerId]);

  if (!source || !rot) return <div className="online-wait">Joining the table…</div>;
  const r = room.rules;
  const turnLocal = source.st.turn;

  const seatExtra = (local: number) => {
    const real = rot.R(local);
    const seat = room.seats[real];
    const offline = seat?.kind === 'human' && !seat.connected;
    return (
      <>
        <SeatMedia seat={seat} isMe={local === 0} mesh={mesh} vs={vs} limited={!!seat && seat.kind === 'human' && vs.limited.includes(seat.playerId)} />
        {offline && <span className="chip bad seat-offline">OFFLINE</span>}
        {turnLocal === local && secs !== null && secs <= 15 && !source.pause && <span className={`turn-clock ${secs <= 5 ? 'hot' : ''}`} data-testid={`clock-${local}`}>{secs}s</span>}
      </>
    );
  };
  const sideLabel = (side: number) => {
    const seats = Array.from({ length: rot.n }, (_, i) => i).filter((i) => sideOf(i, r) === side);
    return seats.map((i) => names[i]!.toUpperCase()).join(' + ');
  };

  return (
    <>
      <Table
        key={`${room.code}:${room.game}`}
        rules={r}
        seed={`${room.code}:${room.game}`}
        settings={settings}
        onExit={onLobby}
        onMainMenu={onMainMenu}
        onRematch={() => conn.send({ t: 'rematch' })}
        onQuality={(quality) => { const s = { ...settings, quality }; setSettings(s); saveSettings({ ...loadSettings(), quality }); }}
        online={{
          source, names, chat, seatExtra, sideLabel,
          controls: <MediaBar mesh={mesh} vs={vs} seated limited={limitedNow} />,
          talk: {
            secs,
            ready: { mine: !!cs.you && room.ready.includes(cs.you), count: room.ready.length, of: room.seats.filter((x) => x.kind === 'human' && x.connected).length },
            tile: (local) => <TalkTile seat={room.seats[rot.R(local)]} isMe={local === 0} mesh={mesh} vs={vs} />,
          },
        }}
      />
      {cs.status !== 'open' && <div className="conn-banner" role="status">{cs.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</div>}
      {talkOver && <div className="talk-over-toast" role="status" data-testid="talk-over">Table talk over — partners muted 🤐</div>}
      {room.music?.mode === 'link' && source.st.phase !== 'handOver' && <div className="music-card-dock"><MusicLinkCard music={room.music} compact /></div>}
      {room.phase === 'over' && room.hostId !== cs.you && <div className="conn-banner subtle">Waiting for the host to start a rematch…</div>}
    </>
  );
}
