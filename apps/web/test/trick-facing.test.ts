import { describe, expect, it } from 'vitest';
import { opponentFan, pileSpot, trickSpot } from '../src/three/layout';
import { faceUpPlayFrom, frontNormalY, restingFacing, trickPlayFrom } from '../src/three/trickFacing';

describe('bot trick cards settle face-up', () => {
  const seats = ['left', 'top', 'right'] as const;

  it('rests on the trick face after the flight, even if the slerp left the fan quaternion', () => {
    for (const seat of seats) {
      const fan = opponentFan(seat, 4, 2, 8);
      const trick = trickSpot(seat, 4, 1, 0);
      expect(frontNormalY(fan.q)).toBeLessThan(0);
      expect(frontNormalY(trick.q)).toBeGreaterThan(0.5);
      // Landed, but the mesh is still holding the face-down fan. That is the bug.
      const rested = restingFacing(fan.q, trick.q, true);
      expect(frontNormalY(rested)).toBeGreaterThan(0.5);
      expect(rested).toEqual(trick.q);
      // Still in the air: don't snap it yet.
      expect(restingFacing(fan.q, trick.q, false)).toBe(fan.q);
    }
  });

  it('launches a bot card face-up once, then a rebuild rests on the trick spot', () => {
    const fan = opponentFan('top', 4, 1, 7);
    const first = trickPlayFrom({ firstShow: true, fan });
    expect(first).toBeDefined();
    expect(frontNormalY(first!.q)).toBeGreaterThan(0);
    expect(frontNormalY(faceUpPlayFrom(fan).q)).toBeGreaterThan(0);
    // Canvas rebuild / the play is already on screen: no face-down fan launch.
    expect(trickPlayFrom({ firstShow: false, fan })).toBeUndefined();
    const slot = trickSpot('bottom', 4, 0, 0);
    expect(trickPlayFrom({ firstShow: false, humanSlot: slot, fan })).toBe(slot);
  });

  it('keeps every other seat face-up across two tricks, and a rebuild does not relaunch them', () => {
    const handNo = 3;
    const shown = new Set<string>();
    const tricks = [
      [
        { card: 'QH', seat: 'left' as const },
        { card: 'JD', seat: 'top' as const },
        { card: '2C', seat: 'right' as const },
        { card: 'AS', seat: 'bottom' as const },
      ],
      [
        { card: '10H', seat: 'left' as const },
        { card: '9D', seat: 'top' as const },
        { card: '8C', seat: 'right' as const },
        { card: 'KS', seat: 'bottom' as const },
      ],
    ];
    for (const trick of tricks) {
      trick.forEach((pl, order) => {
        const playKey = `${handNo}-${pl.card}`;
        // A new card id is a first show. Trick 1's keys must not swallow trick 2.
        expect(shown.has(playKey)).toBe(false);
        if (pl.seat === 'bottom') {
          const slot = trickSpot('bottom', 4, order, 0);
          const from = trickPlayFrom({ firstShow: true, humanSlot: slot });
          expect(from).toBe(slot);
          expect(frontNormalY(from!.q)).toBeGreaterThan(0.5);
        } else {
          const fan = opponentFan(pl.seat, 4, 1, 6);
          expect(frontNormalY(fan.q)).toBeLessThan(0);
          const from = trickPlayFrom({ firstShow: true, fan });
          expect(from).toBeDefined();
          expect(frontNormalY(from!.q)).toBeGreaterThan(0);
          const spot = trickSpot(pl.seat, 4, order, 0);
          const rested = restingFacing(fan.q, spot.q, true);
          expect(frontNormalY(rested)).toBeGreaterThan(0.5);
          expect(rested).toEqual(spot.q);
        }
        shown.add(playKey);
        // Already on the table, or the canvas rebuilt: do not launch from the face-down fan.
        if (pl.seat !== 'bottom') {
          const fan = opponentFan(pl.seat, 4, 1, 6);
          expect(trickPlayFrom({ firstShow: !shown.has(playKey), fan })).toBeUndefined();
        }
      });
    }
  });

  it('turns a Run it! slam that is still on the fan quaternion face-up, and leaves a book pile face-down', () => {
    const fan = opponentFan('top', 4, 0, 4);
    // The claimer's slam row uses the face-up bottom trick spot.
    const slam = trickSpot('bottom', 4, 0, 0);
    expect(frontNormalY(fan.q)).toBeLessThan(0);
    expect(frontNormalY(slam.q)).toBeGreaterThan(0.5);
    const rested = restingFacing(fan.q, slam.q, true);
    expect(rested).toEqual(slam.q);
    expect(frontNormalY(rested)).toBeGreaterThan(0.5);
    // A slam that already finished face-up is left on that pose.
    expect(restingFacing(slam.q, slam.q, true)).toEqual(slam.q);
    const pile = pileSpot('bottom', 4, 0, 0, 0);
    expect(frontNormalY(pile.q)).toBeLessThan(0);
    expect(restingFacing(fan.q, pile.q, true)).toEqual(fan.q);
  });

  it('keeps every other seat face-up across a full hand of 13 tricks', () => {
    const handNo = 1;
    const shown = new Set<string>();
    const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
    const deck = ['S', 'H', 'D', 'C'].flatMap((suit) => ranks.map((rank) => `${rank}${suit}`));
    const order = ['left', 'top', 'right', 'bottom'] as const;
    for (let trickNo = 0; trickNo < 13; trickNo++) {
      order.forEach((seat, i) => {
        const card = deck[trickNo * 4 + i]!;
        const playKey = `${handNo}-${card}`;
        // Earlier tricks stay in the shown set. A new card is still a first show.
        expect(shown.has(playKey)).toBe(false);
        if (seat === 'bottom') {
          const slot = trickSpot('bottom', 4, i, 0);
          const from = trickPlayFrom({ firstShow: true, humanSlot: slot });
          expect(from).toBe(slot);
          expect(frontNormalY(from!.q)).toBeGreaterThan(0.5);
        } else {
          const fan = opponentFan(seat, 4, Math.max(0, 12 - trickNo), 13 - trickNo);
          expect(frontNormalY(fan.q)).toBeLessThan(0);
          const from = trickPlayFrom({ firstShow: true, fan });
          expect(from).toBeDefined();
          expect(frontNormalY(from!.q)).toBeGreaterThan(0);
          const spot = trickSpot(seat, 4, i, 0);
          const rested = restingFacing(fan.q, spot.q, true);
          expect(frontNormalY(rested)).toBeGreaterThan(0.5);
          expect(rested).toEqual(spot.q);
          expect(trickPlayFrom({ firstShow: false, fan })).toBeUndefined();
        }
        shown.add(playKey);
      });
    }
    expect(shown.size).toBe(52);
  });
});
