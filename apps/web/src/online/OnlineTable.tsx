import { fx } from '../fx';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sideOf } from '@spades/rules';
import Table from '../Table';
import { type Settings, loadSettings, saveSettings } from '../settings';
import type { ConnState, TableConnection } from './connection';
import { type KickInfo, MediaBar, SeatMedia, TalkTile, VictorySpotlight } from './Media';
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

  // Voice anti-cheat (host option): during TRICK PLAY my mic isn't sent to my partner and theirs isn't played here.
  // Partners may talk books during bidding (vaguely: "I got about 3"), so mics stay open while bidding, between hands
  // (Table Talk), in the lobby and after the game. Opponents always hear each other (trash talk is part of the game).
  const gp = source?.st.phase;
  const partnerId = (() => {
    if (!rot || !room.rules.partnerships || cs.seat === null) return null;
    const s = room.seats[(cs.seat + 2) % room.rules.playerCount];
    return s?.kind === 'human' ? s.playerId : null;
  })();
  // host option (off by default): with it off there's no limiting, no MIC LIMITED badge and no 'partners muted' toast
  // the table's nuke level (host setting) drives everyone's nuke; Reduce effects still forces the calm one locally
  useEffect(() => { fx.tableNuke = room.nukeIntensity ?? 'full'; return () => { fx.tableNuke = null; }; }, [room.nukeIntensity]);
  // muted from the moment the first card is led until the hand is over
  const led = gp === 'playing' && !!source && (source.st.tricks.length > 0 || source.st.trick.plays.length > 0);
  const limitedNow = !!room.partnerMicMute && room.phase === 'playing' && led && !!partnerId;
  useEffect(() => { mesh?.setLimited(limitedNow && partnerId ? [partnerId] : []); }, [mesh, limitedNow, partnerId]);
  useEffect(() => () => mesh?.setLimited([]), [mesh]);
  const wasLimited = useRef(limitedNow);
  const [talkOver, setTalkOver] = useState(false);
  useEffect(() => {
    const was = wasLimited.current;
    wasLimited.current = limitedNow;
    // 'partners muted' fires when the first card is led (not when bidding starts)
    if (!was && limitedNow) {
      setTalkOver(true);
      const t = setTimeout(() => setTalkOver(false), 3000);
      return () => clearTimeout(t);
    }
  }, [limitedNow]);

  if (!source || !rot) return <div className="online-wait">Joining the table…</div>;
  const r = room.rules;
  const turnLocal = source.st.turn;

  // host: Kick (with confirm); seated non-hosts: Vote to kick (majority of the other humans)
  const kickFor = (real: number): KickInfo | undefined => {
    const seat = room.seats[real];
    if (!seat || seat.kind !== 'human' || real === cs.seat || cs.seat === null) return undefined;
    const v = room.votes?.find((x) => x.target === seat.playerId);
    return { host: room.hostId === cs.you, votes: v?.by.length ?? 0, need: v?.need ?? 0, voted: !!cs.you && !!v?.by.includes(cs.you), onKick: () => conn.send({ t: 'kick', seat: real }) };
  };
  const seatExtra = (local: number) => {
    const real = rot.R(local);
    const seat = room.seats[real];
    const offline = seat?.kind === 'human' && !seat.connected;
    return (
      <>
        <SeatMedia seat={seat} isMe={local === 0} mesh={mesh} vs={vs} limited={!!seat && seat.kind === 'human' && vs.limited.includes(seat.playerId)} kick={kickFor(real)} />
        {offline && <span className="chip bad seat-offline">OFFLINE</span>}
        {turnLocal === local && secs !== null && secs <= 15 && !source.pause && <span className={`turn-clock ${secs <= 5 ? 'hot' : ''}`} data-testid={`clock-${local}`}>{secs}s</span>}
      </>
    );
  };
  const sideLabel = (side: number) => {
    const seats = Array.from({ length: rot.n }, (_, i) => i).filter((i) => sideOf(i, r) === side);
    return seats.map((i) => names[i]!.toUpperCase()).join(' + ');
  };
  // server sides → local sides (local seat 0 is me)
  const teamNames = r.partnerships ? [0, 1].map((L) => room.teamNames?.[sideOf(rot.R(L), r)] ?? null) : undefined;
  const localSeats = Array.from({ length: rot.n }, (_, i) => i);
  const botSeats = localSeats.filter((L) => room.seats[rot.R(L)]?.kind === 'bot');
  const revealed = localSeats.filter((L) => (room.revealed ?? []).includes(rot.R(L)));
  const seriesMine = cs.seat === null ? 0 : sideOf(cs.seat, r);

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
          source, names, chat, seatExtra, sideLabel, teamNames, botSeats, revealed, talkIntensity: room.talkIntensity,
          setTeamName: cs.seat !== null && r.partnerships ? (name) => conn.send({ t: 'teamName', name }) : undefined,
          series: { series: room.series ?? null, mine: seriesMine },
          setLearning: (on) => conn.send({ t: 'learning', on }),
          venue: room.venueNow ?? (room.venue && room.venue !== 'random' ? room.venue : 'classic'),
          victory: (winners, losers, title, sub) => {
            const sp = (L: number) => {
              const seat = room.seats[rot.R(L)];
              // your own card shows your display name ("Demetrius (you)"), not just "You"
              const own = L === 0 && seat && 'name' in seat && typeof seat.name === 'string' && seat.name.trim() ? seat.name.trim() : undefined;
              return { key: String(rot.R(L)), name: own ?? names[L] ?? '?', seat, isMe: L === 0 };
            };
            return <VictorySpotlight winners={winners.map(sp)} losers={losers.map(sp)} title={title} sub={sub} mesh={mesh} vs={vs} />;
          },
          controls: <MediaBar mesh={mesh} vs={vs} seated limited={limitedNow} />,
          talk: {
            secs,
            ready: { mine: !!cs.you && room.ready.includes(cs.you), count: room.ready.length, of: room.seats.filter((x) => x.kind === 'human' && x.connected).length },
            tile: (local) => <TalkTile seat={room.seats[rot.R(local)]} isMe={local === 0} mesh={mesh} vs={vs} />,
          },
        }}
      />
      {cs.status !== 'open' && <div className="conn-banner" role="status">{cs.status === 'reconnecting' ? 'Reconnecting…' : 'Connecting…'}</div>}
      {talkOver && <div className="talk-over-toast" role="status" data-testid="talk-over">First card's down — partner mics muted 🤐</div>}
      {room.music?.mode === 'link' && source.st.phase !== 'handOver' && <div className="music-card-dock"><MusicLinkCard music={room.music} compact /></div>}
      {room.phase === 'over' && room.hostId !== cs.you && <div className="conn-banner subtle">Waiting for the host to start a rematch…</div>}
    </>
  );
}
