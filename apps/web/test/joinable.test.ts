import { describe, expect, it } from 'vitest';
import { LIMITS, type RoomInfo, type SeatInfo } from '@spades/protocol';
import { joinableSeats, lobbyAutoSitSeat, partnerSeat, spectatorsFull } from '../src/online/joinable';

function room(over: Partial<RoomInfo> & { seats: SeatInfo[] }): RoomInfo {
  return {
    code: 'ABCD', hostId: 'h', phase: 'lobby', rules: { playerCount: over.seats.length } as RoomInfo['rules'],
    botLevel: 'normal', members: [], deadline: null, ready: [], rev: 1, seq: 1, game: 0, now: 0, talkSec: 20,
    private: false, replaceBots: true, takeable: [], spectators: [],
    ...over,
  };
}
const human = (name: string): SeatInfo => ({ kind: 'human', playerId: name, name, connected: true, media: { cam: false, mic: false } });
const bot = (name: string): SeatInfo => ({ kind: 'bot', name, level: 'normal' });

describe('joinable seats', () => {
  it('offers an empty seat or a bot, and never a person', () => {
    const seats = [human('Ace'), { kind: 'empty' as const }, bot('Booker'), human('Dee')];
    expect(joinableSeats(room({ seats }))).toEqual([1, 2]);
  });

  it('during a hand only offers seats the server marks takeable', () => {
    const seats = [human('Ace'), bot('Locked'), bot('Open'), human('Dee')];
    expect(joinableSeats(room({ phase: 'playing', seats, takeable: [2, 3] }))).toEqual([2]);
    expect(joinableSeats(room({ phase: 'playing', seats, takeable: [] }))).toEqual([]);
  });

  it('between games offers empty seats and bots again', () => {
    const seats = [{ kind: 'empty' as const }, human('Ace'), bot('Booker')];
    expect(joinableSeats(room({ phase: 'over', seats }))).toEqual([0, 2]);
  });

  it('leaves tournament seats reserved', () => {
    const seats = [{ kind: 'empty' as const }, bot('Booker')];
    expect(joinableSeats(room({ seats, tournament: { id: 't', match: 'm', autostartAt: null, reserved: [] } }))).toEqual([]);
  });

  it('caps spectators once a game is on', () => {
    const watchers = Array.from({ length: LIMITS.spectators }, (_, i) => ({ playerId: `p${i}`, name: `W${i}` }));
    expect(spectatorsFull(room({ phase: 'playing', seats: [], spectators: watchers }))).toBe(true);
    expect(spectatorsFull(room({ phase: 'playing', seats: [], spectators: watchers.slice(0, 2) }))).toBe(false);
    expect(spectatorsFull(room({ phase: 'lobby', seats: [], spectators: watchers }))).toBe(false);
  });
});

/**
 * Partner-seat pins (owner bundle 2026-11-08, M1): in a partnership room a
 * joining partner belongs ACROSS from the host — beside the host is the
 * opposing side (the 2026-11-06 incident: auto-seating put his partner on
 * the other team and the game scored her as an opponent from hand 1).
 * Cutthroat has no partners: its ordering and auto-sit stay exactly as they were.
 */
describe('partner seat (M1)', () => {
  const partnerRoom = (seats: SeatInfo[], over: Partial<RoomInfo> = {}): RoomInfo => room({
    seats,
    hostId: 'Host',
    rules: { playerCount: 4, partnerships: true } as RoomInfo['rules'],
    ...over,
  });

  it('partnerSeat is across from the host in partnership, null in cutthroat', () => {
    const seats = [human('Host'), { kind: 'empty' as const }, { kind: 'empty' as const }, { kind: 'empty' as const }];
    expect(partnerSeat(partnerRoom(seats))).toBe(2);
    expect(partnerSeat(room({ seats, hostId: 'Host', rules: { playerCount: 4, partnerships: false } as RoomInfo['rules'] }))).toBeNull();
    // host not seated yet (the creator's own first arrival): no preference
    const unseated = [{ kind: 'empty' as const }, { kind: 'empty' as const }, { kind: 'empty' as const }, { kind: 'empty' as const }];
    expect(partnerSeat(partnerRoom(unseated))).toBeNull();
  });

  it('joinableSeats offers the partner seat first in partnership, so invites advertise it', () => {
    const seats = [human('Host'), { kind: 'empty' as const }, { kind: 'empty' as const }, bot('Booker')];
    expect(joinableSeats(partnerRoom(seats))).toEqual([2, 1, 3]);
  });

  it('joinableSeats order is unchanged in cutthroat', () => {
    const seats = [human('Host'), { kind: 'empty' as const }, { kind: 'empty' as const }, bot('Booker')];
    expect(joinableSeats(room({ seats, hostId: 'Host', rules: { playerCount: 4, partnerships: false } as RoomInfo['rules'] }))).toEqual([1, 2, 3]);
  });

  it('auto-sit takes the partner seat when it is empty', () => {
    const seats = [human('Host'), { kind: 'empty' as const }, { kind: 'empty' as const }, { kind: 'empty' as const }];
    expect(lobbyAutoSitSeat(partnerRoom(seats))).toBe(2);
  });

  it('auto-sit falls back to the lowest empty seat when the partner seat is taken', () => {
    const seats = [human('Host'), { kind: 'empty' as const }, human('Partner'), { kind: 'empty' as const }];
    expect(lobbyAutoSitSeat(partnerRoom(seats))).toBe(1);
    const botThere = [human('Host'), { kind: 'empty' as const }, bot('Booker'), { kind: 'empty' as const }];
    expect(lobbyAutoSitSeat(partnerRoom(botThere))).toBe(1);
  });

  it('auto-sit in cutthroat is the lowest empty seat, exactly as before', () => {
    const seats = [human('Host'), { kind: 'empty' as const }, { kind: 'empty' as const }, { kind: 'empty' as const }];
    expect(lobbyAutoSitSeat(room({ seats, hostId: 'Host', rules: { playerCount: 4, partnerships: false } as RoomInfo['rules'] }))).toBe(1);
  });
});
