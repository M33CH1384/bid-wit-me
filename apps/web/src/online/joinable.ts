import { LIMITS, type RoomInfo } from '@spades/protocol';

type SeatRoom = Pick<RoomInfo, 'phase' | 'seats' | 'rules' | 'takeable' | 'tournament'>;

/**
 * Seats a newcomer may take. Never a human.
 * Lobby and between games: empty seats first, then a bot's seat.
 * During a hand: only seats the server marks takeable (a bot, including a seat a person already left).
 * Tournament seats stay reserved for the entrants.
 */
export function joinableSeats(room: SeatRoom): number[] {
  if (room.tournament) return [];
  const seats = room.seats.slice(0, room.rules.playerCount);
  if (room.phase === 'playing') return (room.takeable ?? []).filter((i) => seats[i]?.kind === 'bot');
  const empty: number[] = [];
  const bots: number[] = [];
  seats.forEach((s, i) => {
    if (s.kind === 'empty') empty.push(i);
    else if (s.kind === 'bot') bots.push(i);
  });
  return [...empty, ...bots];
}

/** Spectators are capped once a game is on. The lobby has no watcher list. */
export function spectatorsFull(room: Pick<RoomInfo, 'phase' | 'spectators'>): boolean {
  if (room.phase === 'lobby') return false;
  return (room.spectators?.length ?? 0) >= LIMITS.spectators;
}
