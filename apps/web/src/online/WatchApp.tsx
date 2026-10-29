import { useEffect, useMemo, useRef, useState } from 'react';
import { LeagueTicker } from '../social/LeagueTicker';
import { TableConnection, tableInfo } from './connection';
import { serverUrl } from './config';
import { guestSessionId, loadName } from './identity';
import { navigate, watchRoute } from './nav';
import OnlineTable from './OnlineTable';
import ShareWatchButton from './ShareWatch';
import { useConn } from './useOnline';
import './online.css';
import './watch.css';

/**
 * The streaming watch surface: /watch/<CODE> and /watch/<CODE>/broadcast.
 *
 * Watching never walls — a viewer with no account lands IN the watch view as
 * a guest spectator. The connection says hello with `watch: true`, so the
 * server marks the member watch-only: they receive the redacted spectator
 * view and nothing else, they count against the room's ordinary spectator
 * cap, and they can never sit or post chat from this door (the play door —
 * /t/<CODE> — is one tap away and clears the flag). Signed-in viewers on
 * this surface are watch-only too; their full spectator feature set (take a
 * bot seat, chat) lives on the table page, unchanged.
 *
 * The broadcast variant is an OBS browser source: it must run itself with no
 * session, no idle logout, no chat surface, and no controls after load.
 */

type Refusal = 'not-found' | 'spoken-for' | 'full' | 'unreachable';

export default function WatchApp({ path }: { path: string }) {
  const route = watchRoute(path);
  if (!route) return <WatchSlate kind="not-found" code="" broadcast={false} />;
  return <WatchInner code={route.code} broadcast={route.broadcast} />;
}

/** The watcher's display name: the player's saved name, else a Guest label
 *  keyed to this browser's guest id (no account, no profile, no reservation —
 *  the suffix only tells two guests apart in the watchers list). */
function watchName(): string {
  const saved = loadName().trim();
  if (saved) return saved;
  return `Guest-${guestSessionId().slice(-4).toUpperCase()}`;
}

function WatchInner({ code, broadcast }: { code: string; broadcast: boolean }) {
  const [conn] = useState(() => new TableConnection(code, watchName(), { watch: true }));
  const cs = useConn(conn);
  const [missing, setMissing] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // Know a dead code before the socket timeout does (same pre-check the
  // table page runs): no such room → the not-found slate, not a lobby dump.
  useEffect(() => {
    let live = true;
    tableInfo(serverUrl(), code)
      .then((info) => { if (live && !info.exists) { setMissing(true); conn.markMissing(); } })
      .catch(() => { /* the socket's own join watch reports reachability */ });
    return () => { live = false; };
  }, [code, conn]);

  useEffect(() => () => conn.close(), [conn]);

  // Refusals latch from the room's own error codes: the story door
  // (SPOKEN_FOR) and the spectator cap (TABLE_FULL) are terminal at hello —
  // the room closes the socket behind them. Polite full-screen states,
  // never a crash, never a dump into the lobby.
  useEffect(() => {
    if (cs.error?.code === 'SPOKEN_FOR') setRefusal('spoken-for');
    else if (cs.error?.code === 'TABLE_FULL') setRefusal('full');
  }, [cs.error]);

  // Broadcast frame: hide the cursor when it sits idle (OBS sources are
  // loaded once and never touched again).
  useEffect(() => {
    if (!broadcast) return;
    const el = frameRef.current;
    if (!el) return;
    let timer = 0;
    const arm = () => {
      el.classList.remove('cursor-idle');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => el.classList.add('cursor-idle'), 2_500);
    };
    arm();
    window.addEventListener('mousemove', arm);
    return () => { window.removeEventListener('mousemove', arm); window.clearTimeout(timer); };
  }, [broadcast]);

  const room = cs.room;
  const finalScores = useMemo(() => {
    const view = cs.view;
    if (!view || !room) return null;
    const names = room.seats.map((s) => (s.kind === 'empty' ? '—' : s.name));
    if (room.rules.partnerships) {
      return [0, 1].map((side) => ({
        name: [names[side]!, names[side + 2]!].filter((n) => n && n !== '—').join(' & ') || `Side ${side + 1}`,
        score: view.scores[side] ?? 0,
      }));
    }
    return names.map((name, i) => ({ name, score: view.scores[i] ?? 0 }));
  }, [cs.view, room]);

  let body: React.ReactNode;
  if (missing) body = <WatchSlate kind="not-found" code={code} broadcast={broadcast} />;
  else if (refusal) body = <WatchSlate kind={refusal} code={code} broadcast={broadcast} />;
  else if (cs.joinFault) body = <WatchSlate kind="unreachable" code={code} broadcast={broadcast} onRetry={() => conn.retryJoin()} />;
  else if (!room) body = <WatchSlate kind="connecting" code={code} broadcast={broadcast} />;
  else if (room.phase === 'lobby') body = <WatchSlate kind="waiting" code={code} broadcast={broadcast} host={room.seats.find((s) => s.kind === 'human')?.name} />;
  else if (room.phase === 'over') body = <WatchSlate kind="game-over" code={code} broadcast={broadcast} final={finalScores} />;
  else {
    body = (
      <OnlineTable conn={conn} cs={cs} mesh={null} versusPairNote={null}
        watchOnly broadcast={broadcast}
        initialSettings={broadcast ? { quality: 'high', view: 'sitting' } : undefined}
        onLobby={() => navigate(`/t/${code}`)} onMainMenu={() => navigate('/')} />
    );
  }

  // The bar (share + join) belongs to a watchable table only. On a refusal,
  // a dead link, an unreachable server or a finished game there is nothing
  // to share and no table to join — the slate stands alone.
  const showBar = !missing && !refusal && !cs.joinFault && room?.phase !== 'over';

  if (broadcast) {
    return (
      <div className="watch-frame broadcast" ref={frameRef} data-testid="watch-broadcast">
        <div className="watch-stage">{body}</div>
        {/* The league ticker rides the bottom of the frame on real payloads
            only — LeagueTicker renders nothing when it has no lines. */}
        <div className="broadcast-ticker"><LeagueTicker variant="bar" /></div>
      </div>
    );
  }
  return (
    <div className="watch-frame" data-testid="watch-app">
      {showBar && (
        <div className="watch-bar">
          <span className="watch-bar-label">👁 WATCHING · TABLE {code}</span>
          <ShareWatchButton code={code} />
          <button type="button" className="watch-join-btn" data-testid="watch-join-table" onClick={() => navigate(`/t/${code}`)}>JOIN THE TABLE</button>
        </div>
      )}
      <div className="watch-stage">{body}</div>
    </div>
  );
}

const SLATE_COPY: Record<string, { title: string; sub: string }> = {
  'connecting': { title: 'Taking you to the table…', sub: 'Connecting to the watch view.' },
  'not-found': { title: 'That table isn’t running', sub: 'The code may be mistyped, or the table has already closed. Ask the host for a fresh watch link.' },
  'spoken-for': { title: 'This table is spoken for', sub: 'Some tables seat only the players running them — there’s no watch view for this one.' },
  'full': { title: 'Watching is full right now', sub: 'This table has all the watchers it can hold. Try again in a bit — seats at the table come first.' },
  'unreachable': { title: 'Can’t reach the game server', sub: 'The watch view couldn’t connect. Check your connection and try again.' },
  'waiting': { title: 'Waiting for the game to start', sub: 'The table is set up and the players are gathering. The watch view opens on its own when the first hand is dealt.' },
  'game-over': { title: 'Game over', sub: 'That’s the final score. Thanks for watching.' },
};

export function WatchSlate({ kind, code, broadcast, watchers, host, final, onRetry }: {
  kind: Refusal | 'connecting' | 'waiting' | 'game-over';
  code: string;
  broadcast: boolean;
  watchers?: number;
  host?: string;
  final?: { name: string; score: number }[] | null;
  onRetry?: () => void;
}) {
  const copy = SLATE_COPY[kind]!;
  return (
    <div className={`watch-slate ${broadcast ? 'broadcast' : ''}`} data-testid={`watch-${kind}`}>
      <div className="watch-slate-card">
        <div className="watch-slate-brand">BID WIT ME</div>
        <h1>{copy.title}</h1>
        <p>{copy.sub}</p>
        {kind === 'waiting' && (
          <p className="watch-slate-meta">
            {host ? <>Hosted by <b>{host}</b> · </> : null}Table {code}{watchers !== undefined ? <> · 👁 {watchers} watching</> : null}
          </p>
        )}
        {kind === 'game-over' && final && final.length > 0 && (
          <div className="watch-final">
            {final.map((s, i) => (
              <div key={i} className="watch-final-row"><span>{s.name}</span><b>{s.score}</b></div>
            ))}
          </div>
        )}
        {!broadcast && onRetry && <button type="button" className="watch-slate-btn" onClick={onRetry}>TRY AGAIN</button>}
        {!broadcast && kind !== 'connecting' && (
          <button type="button" className="watch-slate-btn ghost" onClick={() => navigate('/')}>BACK TO THE LOBBY</button>
        )}
      </div>
    </div>
  );
}
