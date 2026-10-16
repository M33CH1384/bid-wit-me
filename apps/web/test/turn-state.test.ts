import { describe, expect, it } from 'vitest';
import { actingSeat, seatMark } from '../src/turnState';

const open = { turn: 0, phase: 'playing', pause: false, dealing: false, locked: false, covered: false };

describe('acting seat', () => {
  it('is the seat to act only while the table is waiting on them', () => {
    expect(actingSeat(open)).toBe(0);
    expect(actingSeat({ ...open, turn: 2 })).toBe(2);
    expect(actingSeat({ ...open, phase: 'bidding', turn: 3 })).toBe(3);
    expect(actingSeat({ ...open, phase: 'exchange', turn: 1 })).toBe(1);
  });

  it('marks nobody while a deal, a held trick, or a show is in the way', () => {
    expect(actingSeat({ ...open, dealing: true })).toBeNull();
    expect(actingSeat({ ...open, pause: true })).toBeNull();
    expect(actingSeat({ ...open, covered: true })).toBeNull();
    expect(actingSeat({ ...open, phase: 'handOver' })).toBeNull();
    expect(actingSeat({ ...open, phase: 'gameOver' })).toBeNull();
    expect(actingSeat({ ...open, turn: null })).toBeNull();
  });

  it('keeps the seat marked while a move is in flight so the table does not look empty', () => {
    expect(actingSeat({ ...open, locked: true })).toBe(0);
    expect(actingSeat({ ...open, locked: true, turn: 2 })).toBe(2);
  });
});

describe('seat badges', () => {
  it('gives YOUR TURN only to the viewer, and only with a legal card', () => {
    expect(seatMark(0, 0, 'playing', true, false, 3)).toBe('your-turn');
    expect(seatMark(0, 0, 'playing', true, false, 0)).toBeNull();
    expect(seatMark(0, 0, 'playing', true, true, 3)).toBe('to-play');
    expect(seatMark(2, 0, 'playing', true, false, 3)).toBeNull();
  });

  it('never marks the viewer and another seat at once', () => {
    for (const actor of [0, 1, 2, 3, null]) {
      const marks = [0, 1, 2, 3].map((seat) => seatMark(actor, seat, 'playing', seat === 0, false, 2));
      expect(marks.filter(Boolean)).toHaveLength(actor === null ? 0 : 1);
      if (actor === 0) expect(marks[0]).toBe('your-turn');
      if (actor !== null && actor !== 0) expect(marks[actor]).toBe('to-play');
    }
  });

  it('uses bidding copy on a bid and stays quiet for the viewer during an exchange', () => {
    expect(seatMark(0, 0, 'bidding', true, false, 0)).toBe('your-bid');
    expect(seatMark(1, 1, 'bidding', false, false, 0)).toBe('bidding');
    expect(seatMark(0, 0, 'exchange', true, false, 0)).toBeNull();
    expect(seatMark(1, 1, 'exchange', false, false, 0)).toBe('to-play');
  });
});
