import { useCallback, useMemo, useState } from 'react';
import { sideOf } from '@spades/rules';
import Table from '../Table';
import { type Settings, loadSettings, saveSettings } from '../settings';
import type { ConnState, TableConnection } from './connection';
import { MediaBar, SeatMedia } from './Media';
import { localNames, useCountdown, useOnlineChat, useOnlineSource, useVideo } from './useOnline';
import type { VideoMesh } from './video';

/** The 3D table, driven by the server: rotated per-seat view, real chat, video bubbles, turn clock. */
export default function OnlineTable({ conn, cs, mesh, onLobby }: { conn: TableConnection; cs: ConnState; mesh: VideoMesh | null; onLobby: () => void }) {
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

  if (!source || !rot) return <div className="online-wait">Joining the table…</div>;
  const r = room.rules;
  const turnLocal = source.st.turn;

  const seatExtra = (local: number) => {
    const real = rot.R(local);
    const seat = room.seats[real];
    const offline = seat?.kind === 'human' && !seat.connected;
    return (
      <>
        <SeatMedia seat={seat} isMe={local === 0} mesh={mesh} vs={vs} />
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
        onRematch={() => conn.send({ t: 'rematch' })}
        onQuality={(quality) => { const s = { ...settings, quality }; setSettings(s); saveSettings({ ...loadSettings(), quality }); }}
        online={{ source, names, chat, seatExtra, sideLabel, controls: <MediaBar mesh={mesh} vs={vs} seated /> }}
      />
      {cs.status !== 'open' && <div className="conn-banner" role="status">{cs.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</div>}
      {source.st.phase === 'handOver' && cs.you && room.ready.includes(cs.you) && <div className="conn-banner subtle">Waiting for the others{secs !== null ? ` · next hand in ${secs}s` : ''}…</div>}
      {room.phase === 'over' && room.hostId !== cs.you && <div className="conn-banner subtle">Waiting for the host to start a rematch…</div>}
    </>
  );
}
