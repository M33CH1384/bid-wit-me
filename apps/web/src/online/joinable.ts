import { LIMITS, type RoomInfo } from '@spades/protocol';

type SeatRoom = Pick<RoomInfo, 'phase' | 'seats' | 'rules' | 'takeable' | 'tournament' | 'hostId'>;

/**
 * The partner seat: across from the host (partnership only). A joining
 * partner belongs there — the seat BESIDE the host is the opposing side
 * (owner incident 2026-11-06: his partner was auto-seated beside him and
 * scored as his opponent from hand 1). Null when there is no partner seat
 * to prefer: cutthroat, or the host is not seated yet.
 */
export function partnerSeat(room: SeatRoom): number | null {
  if (!room.rules.partnerships) return null;
  const seats = room.seats.slice(0, room.rules.playerCount);
  const host = seats.findIndex((s) => s.kind === 'human' && s.playerId === room.hostId);
  if (host < 0) return null;
  return (host + 2) % room.rules.playerCount;
}

/**
 * Seats a newcomer may take. Never a human.
 * Lobby and between games: empty seats first, then a bot's seat — with the
 * partner seat (across from the host) offered first in partnership, so the
 * invites/presence flow advertises the seat a friend should take.
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
  const partner = partnerSeat(room);
  const ordered = partner !== null && empty.includes(partner) ? [partner, ...empty.filter((i) => i !== partner)] : empty;
  return [...ordered, ...bots];
}

/**
 * The seat the first-arrival auto-sit takes in the lobby: the partner seat
 * across from the host when it is empty, else the lowest empty seat.
 * Cutthroat has no partners — plain lowest-empty, exactly as before.
 */
export function lobbyAutoSitSeat(room: SeatRoom): number {
  const seats = room.seats.slice(0, room.rules.playerCount);
  const partner = partnerSeat(room);
  if (partner !== null && seats[partner]?.kind === 'empty') return partner;
  return seats.findIndex((s) => s.kind === 'empty');
}

/** Spectators are capped once a game is on. The lobby has no watcher list. */
export function spectatorsFull(room: Pick<RoomInfo, 'phase' | 'spectators'>): boolean {
  if (room.phase === 'lobby') return false;
  return (room.spectators?.length ?? 0) >= LIMITS.spectators;
}
