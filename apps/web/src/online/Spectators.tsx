/**
 * Release 10: spectators.
 *  - Watching: a slim "WATCHING" banner (who's watching, Leave) and, when a seat opens up mid-game (a player left /
 *    was kicked, or a bot seat while the host lets spectators replace bots), a "Take seat" prompt. First come first
 *    served: the server seats whoever asks first and the rest see the seat close.
 *  - Playing: a "👁 N" chip listing who's watching, with this player's own "Hide spectator chat" switch.
 */
import { useState } from 'react';
import type { RoomInfo } from '@spades/protocol';
import type { ConnState } from './connection';
import ShareWatchButton from './ShareWatch';

export function SpectatorOverlay({ room, cs, spectator, names, hideChat, onHideChat, onTake, onLeave }: {
  room: RoomInfo; cs: ConnState; spectator: boolean; names: string[]; hideChat: boolean;
  onHideChat: (on: boolean) => void; onTake: (seat: number) => void; onLeave?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const watchers = room.spectators ?? [];
  const takeable = room.takeable ?? [];
  void names;
  if (spectator) {
    return (
      <div className="spec-dock" data-testid="spectator-bar">
        <div className="spec-banner glass slant" role="status">
          <span className="spec-eye" aria-hidden>👁</span>
          <b>WATCHING</b>
          <small>{room.tournament ? 'Tournament match · watch only' : `${watchers.length} watching`}</small>
          {onLeave && <button type="button" className="link" data-testid="spectator-leave" onClick={onLeave}>Leave</button>}
        </div>
        {takeable.length > 0 && cs.status === 'open' && (
          <div className="spec-take glass slant" role="dialog" aria-label="A seat is open" data-testid="take-seat-prompt">
            <div className="spec-take-title">SEAT OPEN</div>
            <p>Jump in: you take over that seat's cards and score right where they are.</p>
            <div className="spec-take-row">
              {takeable.map((seat) => {
                const s = room.seats[seat];
                const label = s && s.kind !== 'empty' ? s.name : `Seat ${seat + 1}`;
                return <button type="button" key={seat} className="primary" data-testid={`take-seat-${seat}`} onClick={() => onTake(seat)}>Take {label}'s seat</button>;
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
  // Seated players: the watch-link share sits with the watchers chip — one tap
  // puts the link in anyone's hands, watchers or not. Story rooms allow no
  // spectators at all: ShareWatchButton renders nothing for them.
  return (
    <div className="spec-tools">
      <ShareWatchButton code={room.code} story={!!room.story} />
      {watchers.length > 0 && (
        <div className="spec-chip-wrap">
          <button type="button" className="spec-chip" data-testid="watchers-chip" aria-expanded={open} onClick={() => setOpen(!open)} title="Spectators">
            👁 {watchers.length}
          </button>
          {open && (
            <div className="spec-pop glass slant" data-testid="watchers-pop">
              <div className="panel-title">WATCHING ({watchers.length})</div>
              <ul>{watchers.map((w) => <li key={w.playerId}>{w.name}</li>)}</ul>
              <label className="row"><span className="row-label">Hide spectator chat<small>only for you</small></span><span className="row-control">
                <button type="button" data-testid="hide-spec-chat" className={`toggle ${hideChat ? 'on' : ''}`} role="switch" aria-checked={hideChat} aria-label="Hide spectator chat" onClick={() => onHideChat(!hideChat)}><span /></button>
              </span></label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
