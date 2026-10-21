/**
 * @vitest-environment happy-dom
 *
 * Animation package layer (owner, 2026-10-20): mounting behavior against a
 * fabricated seat view + the DOM chrome it anchors to (plates, scorebug).
 * Pins: the nil spotlight + blind-nil moonlight render from live state,
 * eliminated plates take the persistent dead look, match point marks the
 * scorebug, a Boston record fires the broom — and Reduce effects calms the
 * dramatic one-shots while the state looks stay.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRules, type HandRecord, type PlayerView } from '@spades/rules';
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

const bostonRec: HandRecord = {
  handNo: 1, dealer: 0, bids: [6, 3, 5, 4], tricksWon: [7, 0, 6, 0],
  sides: [
    { side: 0, seats: [0, 2], contract: 11, contractTricks: 13, tricks: 13, contractMade: true, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: 130, totalScore: 130, totalBags: 0 },
    { side: 1, seats: [1, 3], contract: 7, contractTricks: 0, tricks: 0, contractMade: false, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: -70, totalScore: -70, totalBags: 0 },
  ],
};

let root: Root | null = null;
function mount(v: PlayerView) {
  document.body.innerHTML = `
    <div class="badge-layer">${[0, 1, 2, 3].map((s) => `<div class="plate" data-testid="seat-${s}"></div>`).join('')}</div>
    <div class="bug-teams"><div class="bug-team"></div><div class="bug-team"></div></div>`;
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AnimFxLayer, { st: v })));
  return host;
}
function rerender(v: PlayerView) { act(() => root!.render(createElement(AnimFxLayer, { st: v }))); }

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  fx.setReduce(false);
});

describe('animfx layer', () => {
  it('nil spotlight lights the nil seat while the nil is live, and dies with it', () => {
    mount(view({ bids: [4, 'nil', 4, 4] }));
    expect(document.querySelector('[data-testid="animfx-spotlight"]')).not.toBeNull();
    expect(document.querySelector('.animfx-spotring')).not.toBeNull();
    rerender(view({ bids: [4, 'nil', 4, 4], tricksWon: [0, 1, 0, 0] }));
    expect(document.querySelector('[data-testid="animfx-spotlight"]')).toBeNull();
  });

  it('blind nil seats wear the moonlight ring', () => {
    mount(view({ bids: ['blindNil', 4, 4, 4] }));
    expect(document.querySelector('.animfx-moonring')).not.toBeNull();
  });

  it('an eliminated seat plate takes the persistent dead look', () => {
    mount(view({ eliminated: [false, true, false, false] }));
    expect(document.querySelector('[data-testid="seat-1"]')!.classList.contains('animfx-dead')).toBe(true);
    expect(document.querySelector('[data-testid="seat-0"]')!.classList.contains('animfx-dead')).toBe(false);
  });

  it('match point marks the leading bug team within 100 of the target', () => {
    mount(view({ scores: [430, 120] }));
    const teams = document.querySelectorAll('.bug-team');
    expect(teams[0]!.classList.contains('animfx-mp')).toBe(true);
    expect(teams[1]!.classList.contains('animfx-mp')).toBe(false);
  });

  it('a Boston record fires the broom during the collection window', () => {
    mount(view({ phase: 'playing' }));
    expect(document.querySelector('[data-testid="animfx-broom"]')).toBeNull();
    rerender(view({ phase: 'handOver', history: [bostonRec] }));
    expect(document.querySelector('[data-testid="animfx-broom"]')).not.toBeNull();
  });

  it('Reduce effects: no broom, but the dead look and match-point outline stay', () => {
    fx.setReduce(true);
    mount(view({ phase: 'playing', scores: [430, 120], eliminated: [false, true, false, false] }));
    rerender(view({ phase: 'handOver', history: [bostonRec], scores: [430, 120], eliminated: [false, true, false, false] }));
    expect(document.querySelector('[data-testid="animfx-broom"]')).toBeNull();
    expect(document.querySelector('[data-testid="seat-1"]')!.classList.contains('animfx-dead')).toBe(true);
    expect(document.querySelectorAll('.bug-team')[0]!.classList.contains('animfx-mp-still')).toBe(true);
  });
});
