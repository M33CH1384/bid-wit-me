import { describe, expect, it } from 'vitest';
import { actingSeat, localSeatOfServerTurn, seatMark, turnView } from '../src/turnState';

const open = { turn: 0, phase: 'playing', pause: false, dealing: false, locked: false, covered: false };

describe('acting seat', () => {
  it('is the seat to act only while the table is waiting on them', () => {
    expect(actingSeat(open)).toBe(0);
    expect(actingSeat({ ...open, turn: 2 })).toBe(2);
    expect(actingSeat({ ...open, phase: 'bidding', turn: 3 })).toBe(3);
    expect(actingSeat({ ...open, phase: 'exchange', turn: 1 })).toBe(1);
  });

  it('marks nobody while a deal, a held trick, a locked move, or a show is in the way', () => {
    expect(actingSeat({ ...open, dealing: true })).toBeNull();
    expect(actingSeat({ ...open, pause: true })).toBeNull();
    expect(actingSeat({ ...open, locked: true })).toBeNull();
    expect(actingSeat({ ...open, covered: true })).toBeNull();
    expect(actingSeat({ ...open, phase: 'handOver' })).toBeNull();
    expect(actingSeat({ ...open, phase: 'gameOver' })).toBeNull();
    expect(actingSeat({ ...open, turn: null })).toBeNull();
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

  it('names YOUR TURN and TO PLAY from the server turn, one seat at a time', () => {
    for (const turn of [0, 1, 2, 3]) {
      const view = turnView({ ...open, turn, viewerSeat: 0, spectating: false, legalCount: 3, selected: false });
      expect(view.actor).toBe(turn);
      expect(view.badge?.seat).toBe(turn);
      expect(view.badge?.text).toBe(turn === 0 ? 'YOUR TURN' : 'TO PLAY');
      expect(view.badge?.testId).toBe(turn === 0 ? 'your-turn' : `to-play-${turn}`);
    }
    const quiet = turnView({ ...open, turn: 1, dealing: true, viewerSeat: 0, spectating: false, legalCount: 3, selected: false });
    expect(quiet.actor).toBeNull();
    expect(quiet.badge).toBeNull();
    const held = turnView({ ...open, turn: 0, viewerSeat: 0, spectating: false, legalCount: 0, selected: true });
    expect(held.actor).toBe(0);
    expect(held.badge).toBeNull();
  });

  it('shifts the server seat into the bottom-seat frame once', () => {
    expect(localSeatOfServerTurn(2, 1, 4)).toBe(1);
    expect(localSeatOfServerTurn(1, 1, 4)).toBe(0);
    expect(localSeatOfServerTurn(0, null, 4)).toBe(0);
    expect(localSeatOfServerTurn(null, 2, 4)).toBeNull();
    const local = localSeatOfServerTurn(2, 1, 4)!;
    const view = turnView({ ...open, turn: local, viewerSeat: 0, spectating: false, legalCount: 2, selected: false });
    expect(view.badge).toEqual({ seat: 1, mark: 'to-play', text: 'TO PLAY', testId: 'to-play-1' });
  });

  it('uses bidding copy on a bid and stays quiet for the viewer during an exchange', () => {
    expect(seatMark(0, 0, 'bidding', true, false, 0)).toBe('your-bid');
    expect(seatMark(1, 1, 'bidding', false, false, 0)).toBe('bidding');
    expect(seatMark(0, 0, 'exchange', true, false, 0)).toBeNull();
    expect(seatMark(1, 1, 'exchange', false, false, 0)).toBe('to-play');
  });
});
