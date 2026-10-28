/**
 * @vitest-environment happy-dom
 *
 * Wave B §C new scenarios at the LAYER: the eight BUILD-NOW shots fire on
 * their exact real-state conditions through AnimFxLayer's transition
 * diffing — and only there. (Detector edge cases are pinned in
 * animfx-waveb-detect.test.ts; this file pins that the layer wires them.)
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRules, type HandRecord, type PlayerView, type Trick } from '@spades/rules';
import AnimFxLayer from '../src/animfx/AnimFxLayer';
import { fx } from '../src/fx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rules = makeRules('joker');
const view = (o: Partial<PlayerView> = {}): PlayerView => ({
  seat: 0, rules, phase: 'playing', handNo: 1, dealer: 0, turn: 1,
  hand: null, handCounts: [13, 13, 13, 13], bids: [4, 4, 4, 4], revealed: [true, true, true, true],
  exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: [0, 0, 0, 0],
  spadesBroken: false, scores: [0, 0], bags: [0, 0], history: [], result: null,
  failStreak: [], eliminated: [false, false, false, false], bidOptions: null, legal: [],
  ...o,
} as PlayerView);

const side = (o: Partial<HandRecord['sides'][number]> & { side: number }): HandRecord['sides'][number] => ({
  seats: [], contract: 0, contractTricks: 0, tricks: 0, contractMade: null,
  nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0,
  points: 0, totalScore: 0, totalBags: 0, ...o,
});
const rec = (o: Partial<HandRecord>): HandRecord => ({ handNo: 1, dealer: 0, bids: [], tricksWon: [], sides: [], ...o });
const Q = (t: string) => document.querySelector(`[data-testid="${t}"]`);

let root: Root | null = null;
function mount(v: PlayerView) {
  document.body.innerHTML = `
    <div class="badge-layer">${[0, 1, 2, 3].map((s) => `<div class="plate" data-testid="seat-${s}"></div>`).join('')}</div>
    <div class="bug-teams"><div class="bug-team"></div><div class="bug-team"></div></div>`;
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AnimFxLayer, { st: v })));
}
function rerender(v: PlayerView) { act(() => root!.render(createElement(AnimFxLayer, { st: v }))); }
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  fx.setReduce(false);
});

describe('wave B §C — hand-end scenarios', () => {
  it('DOUBLE MOON + SILENT ASSASSIN + the seal mark that stays', () => {
    const moonRec = rec({
      handNo: 1,
      sides: [
        side({ side: 0, seats: [0, 2], nils: [
          { seat: 0, kind: 'blindNil', tricks: 0, made: true, points: 200 },
          { seat: 2, kind: 'nil', tricks: 0, made: true, points: 100 },
        ] }),
        side({ side: 1, seats: [1, 3], contract: 8, tricks: 13, contractMade: true }),
      ],
    });
    mount(view({ phase: 'playing', history: [] }));
    rerender(view({ phase: 'playing', history: [moonRec] }));
    expect(Q('animfx-doublemoon')).not.toBeNull(); // both partners' nils made, one blind
    expect(Q('animfx-assassin')).not.toBeNull(); // seat 0's blind nil, and the talk log is silent
    expect(Q('animfx-nilseal')).not.toBeNull(); // the wave-3 seal bloom still fires
    expect(Q('animfx-sealmark')).not.toBeNull(); // …and now leaves its mark for the hand
  });

  it('TEXTBOOK: an exact make draws the ledger line', () => {
    const exact = rec({
      handNo: 1,
      sides: [
        side({ side: 0, seats: [0, 2], contract: 9, tricks: 9, contractMade: true, bagsAdded: 0 }),
        side({ side: 1, seats: [1, 3], contract: 7, tricks: 4, contractMade: false }),
      ],
    });
    mount(view({ phase: 'playing', history: [] }));
    rerender(view({ phase: 'playing', history: [exact] }));
    expect(Q('animfx-textbook')).not.toBeNull();
  });

  it('NINE LIVES: buried by 400+, now leading — the cell cracks and grows', () => {
    const buried = rec({ handNo: 1, sides: [side({ side: 0, totalScore: -450 }), side({ side: 1, totalScore: 0 })] });
    const risen = rec({ handNo: 2, sides: [side({ side: 0, totalScore: 300, points: 750 }), side({ side: 1, totalScore: 120, points: 120 })] });
    mount(view({ phase: 'playing', handNo: 1, history: [buried] }));
    rerender(view({ phase: 'playing', handNo: 2, history: [buried, risen] }));
    expect(Q('animfx-ninelives')).not.toBeNull();
  });

  it('PAYBACK SERVED COLD: the repaid set drops the cold brick', () => {
    const first = rec({ handNo: 1, sides: [
      side({ side: 0, contract: 8, contractMade: false }),
      side({ side: 1, contract: 8, contractMade: true }),
    ] });
    const repaid = rec({ handNo: 2, sides: [
      side({ side: 0, contract: 8, contractMade: true }),
      side({ side: 1, contract: 8, contractMade: false }),
    ] });
    mount(view({ phase: 'playing', handNo: 1, history: [first] }));
    rerender(view({ phase: 'playing', handNo: 2, history: [first, repaid] }));
    const brick = Q('animfx-setbrick');
    expect(brick).not.toBeNull();
    expect(brick!.classList.contains('cold')).toBe(true);
    expect(Q('animfx-servedcold')).not.toBeNull();
  });

  it('a first-time set is a plain brick — no cold grade, no sub-stamp', () => {
    const plain = rec({ handNo: 1, sides: [
      side({ side: 0, contract: 8, contractMade: false }),
      side({ side: 1, contract: 8, contractMade: true }),
    ] });
    mount(view({ phase: 'playing', history: [] }));
    rerender(view({ phase: 'playing', history: [plain] }));
    const brick = Q('animfx-setbrick');
    expect(brick).not.toBeNull();
    expect(brick!.classList.contains('cold')).toBe(false);
    expect(Q('animfx-servedcold')).toBeNull();
  });
});

describe('wave B §C — in-hand scenarios', () => {
  it('MIRROR BIDS: twin frames light at the close of bidding, out at the first trick', () => {
    mount(view({ phase: 'playing', bids: [6, 5, 4, 5], tricks: [] }));
    expect(document.querySelectorAll('[data-testid="animfx-mirrorframe"]')).toHaveLength(2);
    const t: Trick = { leader: 0, plays: [{ seat: 0, card: 'AH' as never }], winner: 0 };
    rerender(view({ phase: 'playing', bids: [6, 5, 4, 5], tricks: [t], tricksWon: [1, 0, 0, 0] }));
    expect(document.querySelectorAll('[data-testid="animfx-mirrorframe"]')).toHaveLength(0);
  });

  it('THE GUILLOTINE: the cut that kills the contract drops the blade and greys the cell', () => {
    const bids = [7, 4, 6, 3]; // side 0 contract 13, side 1 contract 7
    const plain = (winner: number): Trick => ({ leader: 0, plays: [], winner });
    const nine = [0, 2, 0, 2, 0, 2, 0, 2, 0].map(plain); // side 0 took 9: needs 4, 4 remain — alive
    const cut: Trick = {
      leader: 0, winner: 1,
      plays: [
        { seat: 0, card: '5H' as never }, { seat: 1, card: '3S' as never },
        { seat: 2, card: '9H' as never }, { seat: 3, card: 'KH' as never },
      ],
    };
    mount(view({ phase: 'playing', bids, tricks: [], tricksWon: [0, 0, 0, 0] }));
    rerender(view({ phase: 'playing', bids, tricks: [...nine, cut], tricksWon: [5, 1, 4, 0] }));
    expect(Q('animfx-guillotine')).not.toBeNull();
    expect(document.querySelectorAll('.bug-team')[0]!.classList.contains('animfx-deadcontract')).toBe(true);
  });
});
