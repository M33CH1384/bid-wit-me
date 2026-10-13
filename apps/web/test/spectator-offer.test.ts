import { describe, expect, it } from 'vitest';
import type { RoomInfo, SeatInfo } from '@spades/protocol';
import { makeRules } from '@spades/rules';
import { freedOffers } from '../src/online/Spectators';
import { localNames } from '../src/online/useOnline';
import { rotation } from '../src/online/rotate';

const bot = (name: string, vacated = false): SeatInfo => ({ kind: 'bot', name, level: 'pro', ...(vacated ? { vacated: true } : {}) });

describe('freed seat offer', () => {
  const seats: SeatInfo[] = [bot('Peaches', true), bot('Sven'), bot('Nova', true), bot('Aaliyah')];

  it('offers only seats a person left, and only your own if you just left it', () => {
    expect(freedOffers(seats, [0, 1, 2, 3], null)).toEqual([0, 2]);
    expect(freedOffers(seats, [0, 1, 2, 3], 2)).toEqual([2]);
    expect(freedOffers(seats, [1, 3], null)).toEqual([]);
    expect(freedOffers(seats, [1, 3], 1)).toEqual([]);
  });
});

describe('spectator names', () => {
  it('does not call the anchor seat You, and uses the bot now sitting there', () => {
    const rot = rotation(makeRules('joker'), 0);
    const room = { seats: [bot('Peaches'), bot('Sven'), bot('Nova'), bot('Aaliyah')] } as RoomInfo;
    expect(localNames(room, rot)[0]).toBe('You');
    expect(localNames(room, rot, true)).toEqual(['Peaches', 'Sven', 'Nova', 'Aaliyah']);
  });
});
