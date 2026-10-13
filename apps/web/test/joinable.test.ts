import { describe, expect, it } from 'vitest';
import { LIMITS, type RoomInfo, type SeatInfo } from '@spades/protocol';
import { joinableSeats, spectatorsFull } from '../src/online/joinable';

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
