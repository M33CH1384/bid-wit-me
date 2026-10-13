/**
 * Release 10: spectators.
 *  - Watching: a slim "Watching" header (who's watching, Leave). A seat someone left, was kicked from, or
 *    went AFK on is a compact bottom banner — "Take <name>'s seat" plus dismiss — clear of the trick and the
 *    trump bar. If you just left a seat, only that seat is offered. First come first served.
 *  - Playing: a "👁 N" chip listing who's watching, with this player's own "Hide spectator chat" switch.
 */
import { useState } from 'react';
import type { RoomInfo, SeatInfo } from '@spades/protocol';
import type { ConnState } from './connection';

/**
 * Seats a person actually left. A host option that lets spectators replace any bot
 * does not put every bot in this banner — only the freed seat, and only yours if you just left it.
 */
export function freedOffers(seats: SeatInfo[], takeable: readonly number[], previous: number | null): number[] {
  const open = takeable.filter((i) => seats[i]?.kind === 'bot' && seats[i].vacated);
  if (previous !== null && open.includes(previous)) return [previous];
  return open;
}

export function SpectatorOverlay({ room, cs, spectator, names, hideChat, onHideChat, onTake, onLeave, retake = null }: {
  room: RoomInfo; cs: ConnState; spectator: boolean; names: string[]; hideChat: boolean;
  onHideChat: (on: boolean) => void; onTake: (seat: number) => void; onLeave?: () => void;
  /** The seat this watcher just gave up, so the banner offers that one back. */
  retake?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState<string | null>(null);
  const watchers = room.spectators ?? [];
  const offers = freedOffers(room.seats, room.takeable ?? [], retake);
  const offerKey = offers.join(',');
  void names;
  if (spectator) {
    const showOffer = offers.length > 0 && cs.status === 'open' && closed !== offerKey;
    return (
      <>
        <div className="spec-dock" data-testid="spectator-bar">
          <div className="spec-banner glass slant" role="status" data-testid="watching-header">
            <span className="spec-eye" aria-hidden>👁</span>
            <b>Watching</b>
            <small>{room.tournament ? 'Tournament match · watch only' : `${watchers.length} watching`}</small>
            {onLeave && <button type="button" className="link" data-testid="spectator-leave" onClick={onLeave}>Leave</button>}
          </div>
        </div>
        {showOffer && (
          <div className="spec-take spec-take-banner glass slant" role="region" aria-label="A seat is open" data-testid="take-seat-prompt">
            {offers.map((seat) => {
              const s = room.seats[seat];
              const label = s && s.kind !== 'empty' ? s.name : `Seat ${seat + 1}`;
              return <button type="button" key={seat} className="primary" data-testid={`take-seat-${seat}`} onClick={() => onTake(seat)}>Take {label}'s seat</button>;
            })}
            <button type="button" className="spec-take-x" data-testid="take-seat-dismiss" aria-label="Dismiss" onClick={() => setClosed(offerKey)}>✕</button>
          </div>
        )}
      </>
    );
  }
  if (!watchers.length) return null;
  return (
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
  );
}
