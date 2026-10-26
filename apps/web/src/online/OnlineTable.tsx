import { winHeadline } from '../headline';
import { signalTableReady } from '../transitions';
import { fetchWagerList } from '../social/wagerApi';
import { fx } from '../fx';
import { victoryHeadline, victoryIdentity } from './victory';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sideOf } from '@spades/rules';
import { TurnCountdown } from '../TurnRing';
import Table from '../Table';
import { TableLoading, type LoadingSeat } from '../TableLoading';
import { platePersona, railCastForAttempt, STORY_STOPS } from '@spades/bots';
import { SEAT_COLORS } from '../overlay';
import { type Settings, loadSettings, saveSettings } from '../settings';
import type { ConnState, TableConnection } from './connection';
import { type KickInfo, MediaBar, SeatMedia, TalkTile, VictorySpotlight } from './Media';
import { MusicLinkCard } from './HostMusic';
import { clientDeadline, loadHideSpectatorChat, localNames, saveHideSpectatorChat, useCountdown, useOnlineChat, useOnlineSource, useVideo } from './useOnline';
import { dealerFromServer } from '../dealerName';
import { localSeatOfServerTurn } from '../turnState';
import { SpectatorOverlay } from './Spectators';
import { orientRun } from '../runPlayback';
import type { VideoMesh } from './video';

/** The 3D table, driven by the server: rotated per-seat view, real chat, video bubbles, turn clock. */
export default function OnlineTable({ conn, cs, mesh, onLobby, onMainMenu, versusPairNote }: { conn: TableConnection; cs: ConnState; mesh: VideoMesh | null; onLobby: () => void; onMainMenu?: () => void; /** story co-op: the pair's narrative versus headline for this stop (StoryRoom computes it from the pair context) */ versusPairNote?: string | null }) {
  const source = useOnlineSource(cs, conn);
  const vs = useVideo(mesh);
  const [settings, setSettings] = useState<Settings>(() => ({ ...loadSettings(), speed: 'normal' }));
  const room = cs.room!;
  const rot = source?.rot ?? null;
  // Watching (no seat): every plate, including the bottom one, is the occupant — a person or a bot — never "You".
  const spectator = !!cs.spectator && cs.seat === null;
  const names = useMemo(() => (rot ? localNames(room, rot, spectator) : []), [room, rot, spectator]);
  // Taking seats on the join hold (owner, 2026-10-23): the first state is
  // still drawing, but the room roster is already known — present the real
  // occupants in local seat order (empty seats have nobody to seat).
  const joinSeats: LoadingSeat[] | undefined = useMemo(() => {
    if (!rot || !names.length) return undefined;
    const seats: LoadingSeat[] = [];
    for (let L = 0; L < rot.n; L++) {
      const s = room.seats[rot.R(L)];
      if (!s || s.kind === 'empty') continue;
      seats.push({
        name: names[L] ?? s.name,
        tag: s.kind === 'bot' ? platePersona(s.name) : null,
        uid: s.kind === 'human' ? (s.uid ?? null) : null,
        bot: s.kind === 'bot',
        you: L === 0 && !spectator,
        color: SEAT_COLORS[L] ?? '#ddd',
      });
    }
    return seats.length ? seats : undefined;
  }, [rot, names, room.seats, spectator]);
  const send = useCallback((text: string) => conn.send({ t: 'chat', text }), [conn]);
  const sendReact = useCallback((id: number, emoji: string) => conn.send({ t: 'react', id, emoji }), [conn]);
  // Engine dealer seat (unrotated view) and its current occupant. The chip and the popup both use this.
  const dealer = useMemo(() => {
    if (!cs.view) return null;
    const n = room.rules.playerCount;
    const occupants = room.seats.slice(0, n).map((s) => (
      !s || s.kind === 'empty' ? { name: '', kind: 'empty' as const } : { name: s.name, kind: s.kind }
    ));
    return dealerFromServer({
      serverDealer: cs.view.dealer,
      occupants,
      viewerSeat: spectator || cs.seat === null ? null : cs.seat,
    });
  }, [cs.view, room.seats, room.rules.playerCount, spectator, cs.seat]);
  const dealerName = dealer?.name ?? '';
  const [hideSpec, setHideSpec] = useState(loadHideSpectatorChat);
  // Big Bank pot for THIS table, read off its wager row (the versus tape shows a
  // Pot line only when the client actually knows it). Non-wager tables never fetch.
  const [pot, setPot] = useState<number | null>(null);
  const roomCode = room.code;
  const isWagerTable = !!room.challenge;
  useEffect(() => {
    if (!isWagerTable) return;
    let alive = true;
    fetchWagerList()
      .then((list) => {
        if (!alive) return;
        const row = list.challenges.find((c) => c.tableCode === roomCode && (c.status === 'live' || c.status === 'scheduled'));
        setPot(row ? row.pot : null);
      })
      .catch(() => { /* unknown pot: the tape just omits the line */ });
    return () => { alive = false; };
  }, [isWagerTable, roomCode]);
  const chat = useOnlineChat(cs, source?.st ?? null, names, send, hideSpec && !spectator, dealerName, sendReact);
  // One absolute client time for this server snapshot. Rebuilding it from Date.now()
  // on every render froze the number at whatever the last state said (a stuck "12s"
  // while the server clock kept running).
  const clockAt = useMemo(
    () => clientDeadline(room.deadline, room.now, Date.now()),
    [room.deadline, room.now],
  );
  const secs = useCountdown(clockAt);
  // Local epochs of the server turn window for the countdown ring. Memoized per
  // server snapshot like clockAt above (recomputing on every render would slide the
  // window forward and the ring would never drain). The ring itself ticks on rAF.
  const turnStart = useMemo(
    () => (room.turnClockStart != null ? clientDeadline(room.turnClockStart, room.now, Date.now()) : null),
    [room.turnClockStart, room.now],
  );
  const turnDeadline = useMemo(
    () => (room.turnClockStart != null && room.deadline != null ? clientDeadline(room.deadline, room.now, Date.now()) : null),
    [room.turnClockStart, room.deadline, room.now],
  );
  const socketGen = cs.socketGen;
  // A new socket has to say again whether the table is drawn. The server holds the clock until then.
  const onInteractive = useCallback((on: boolean) => conn.send({ t: 'interactive', on }), [conn, socketGen]);

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

  const drawn = !!source && !!rot;
  // The Deal (transitions.ts): this surface drawing IS the online
  // table's readiness — signal it (a no-op unless a deal covers).
  useEffect(() => { if (drawn) signalTableReady(); }, [drawn]);
  useEffect(() => { if (!drawn) conn.send({ t: 'interactive', on: false }); }, [drawn, conn, socketGen]);
  if (!drawn || !source || !rot) return <TableLoading progress={0.24} seats={joinSeats} reducedMotion={fx.osReducedMotion} />;
  const r = room.rules;
  const turnLocal = localSeatOfServerTurn(cs.view?.turn ?? null, spectator || cs.seat === null ? null : cs.seat, r.playerCount);
  const onClock = turnDeadline != null && turnStart != null && (gp === 'bidding' || gp === 'playing' || gp === 'exchange');

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
        <SeatMedia seat={seat} seatPos={(rot.n === 4 ? ['bottom', 'left', 'top', 'right'] : ['bottom', 'left', 'right'])[local] as import('../spatial').SeatPos} playerCount={rot.n} isMe={local === 0 && !spectator} mesh={mesh} vs={vs} limited={!!seat && seat.kind === 'human' && vs.limited.includes(seat.playerId)} kick={kickFor(real)} />
        {offline && <span className="chip bad seat-offline">OFFLINE</span>}
        {turnLocal === local && secs !== null && !source.pause && <span className={`turn-clock ${secs <= 5 ? 'hot' : ''}`} data-testid={`clock-${local}`} data-turn-sec={room.turnSec ?? ''}>{secs}s</span>}
        {onClock && turnLocal === local && turnStart != null && turnDeadline != null && <TurnCountdown start={turnStart} deadline={turnDeadline} mine={local === 0 && !spectator} />}
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
  const seriesMine = cs.seat === null ? 0 : sideOf(cs.seat, r);

  return (
    <>
      {/* Seat is not part of the key. A spectator frame used to remount the 3D table and hold
          the full-screen "Shuffling the deck…" loader for several seconds. */}
      <Table
        key={`${room.code}:${room.game}`}
        rules={r}
        seed={`${room.code}:${room.game}`}
        settings={settings}
        onExit={onLobby}
        onMainMenu={onMainMenu}
        onRematch={() => conn.send({ t: 'rematch' })}
        onQuality={(quality) => { const s = { ...settings, quality }; setSettings(s); saveSettings({ ...loadSettings(), quality }); }}
        onView={(view) => { const s = { ...settings, view }; setSettings(s); saveSettings({ ...loadSettings(), view }); }}
        onTurnUp={(turnUp) => { const s = { ...settings, turnUp }; setSettings(s); saveSettings({ ...loadSettings(), turnUp }); }}
        online={{
          source, names, chat, seatExtra, sideLabel, teamNames, botSeats, talkIntensity: room.talkIntensity,
          setTeamName: cs.seat !== null && r.partnerships ? (name) => conn.send({ t: 'teamName', name }) : undefined,
          series: { series: room.series ?? null, mine: seriesMine },
          setLearning: (on) => conn.send({ t: 'learning', on }),
          onInteractive,
          // Pre-deal setup window, skew-corrected onto the client clock like the turn deadline.
          dealAt: room.dealAt != null ? clientDeadline(room.dealAt, room.now, Date.now()) : null,
          pot,
          venue: room.venueNow ?? (room.venue && room.venue !== 'random' ? room.venue : 'classic'),
          // uid per local seat, so name plates can show each human's uploaded picture
          seatUid: (local) => { const s = room.seats[rot.R(local)]; return s?.kind === 'human' ? s.uid : undefined },
          // The King's finale cutthroat (story co-op, Phase 4): the revolver
          // stays on the felt by his seat (server seat 1) for the whole game.
          kingGunSeat: room.story?.stopId === 'king' && room.story.phase === 'finale-game' ? rot.L(1) : null,
          // The King's rail + seated figures in co-op (owner, 2026-10-26):
          // at the King stop the whole neighborhood stands around the 3D
          // table (railCastForAttempt deals the full pool at the King for
          // any attempt — the identical cast the pair's scene channel
          // derives), and the King + Ringer bot seats (server seats 1/3,
          // the stop's pair) render as seated figures. Human seats keep
          // their photo plates; Dee-as-guide is not seated. Both hold
          // through the finale cutthroat (stopId stays 'king').
          kingRailCast: room.story?.stopId === 'king' ? railCastForAttempt('king', 1) : undefined,
          seatedFigures: room.story?.stopId === 'king'
            ? localSeats.map((L) => {
                const srv = rot.R(L);
                if ((srv === 1 || srv === 3) && room.seats[srv]?.kind === 'bot') {
                  return STORY_STOPS.find((s) => s.id === 'king')!.pair[srv === 1 ? 0 : 1];
                }
                return null;
              })
            : undefined,
          versusPairNote: versusPairNote ?? null,
          victory: (winners, losers, title, sub) => {
            const sp = (L: number) => {
              const seat = room.seats[rot.R(L)];
              const id = victoryIdentity(seat, names[L] ?? '?');
              // your own card shows your display name ("Demetrius (you)"), not just "You"
              const own = L === 0 && !spectator && seat?.kind === 'human' && seat.name.trim() ? seat.name.trim() : undefined;
              return { key: String(rot.R(L)), name: own ?? id.name, seat, isMe: L === 0 && !spectator };
            };
            const win = winners.map(sp);
            const lose = losers.map(sp);
            // No team name: the headline is the people (a replaced human, not the bot who finished).
            // A named team ("Shot Callers win") is not the seats' display names, so it stays.
            const seatHeadline = winHeadline(winners.map((L) => names[L] ?? '?'), r.partnerships);
            const nextTitle = victoryHeadline(r.partnerships, title, seatHeadline, win);
            const who = r.partnerships ? win.map((p) => p.name).join(' & ') : undefined;
            const nextSub = who && !nextTitle.toLowerCase().startsWith(who.toLowerCase()) ? who : sub;
            return <VictorySpotlight winners={win} losers={lose} title={nextTitle} sub={nextSub} mesh={mesh} vs={vs} />;
          },
          controls: spectator ? undefined : <MediaBar mesh={mesh} vs={vs} seated limited={limitedNow} />,
          spectator,
          dealerName,
          dealerSeat: dealer?.localSeat,
          serverTurn: cs.view?.turn ?? null,
          viewerSeat: spectator || cs.seat === null ? null : cs.seat,
          run: cs.run ? orientRun(cs.run, spectator ? null : cs.seat, rot.n) : null,
          overlay: <SpectatorOverlay room={room} cs={cs} spectator={spectator} names={names} hideChat={hideSpec}
            onHideChat={(on) => { setHideSpec(on); saveHideSpectatorChat(on); }}
            onTake={(seat) => conn.send({ t: 'sit', seat })} onLeave={onMainMenu} />,
          talk: {
            secs,
            ready: { mine: !!cs.you && room.ready.includes(cs.you), count: room.ready.length, of: room.seats.filter((x) => x.kind === 'human' && x.connected).length },
            tile: (local) => <TalkTile seat={room.seats[rot.R(local)]} isMe={local === 0 && !spectator} mesh={mesh} vs={vs} />,
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
