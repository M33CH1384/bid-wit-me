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
import AnimFxLayer, { buildSpotlightShade, SPOT_PEAK, SPOT_PEAK_MINE } from '../src/animfx/AnimFxLayer';
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
let layerProps: { online?: boolean; names?: string[] } = {};
function mount(v: PlayerView, opts: { online?: boolean; names?: string[] } = {}) {
  layerProps = opts;
  document.body.innerHTML = `
    <div class="badge-layer">${[0, 1, 2, 3].map((s) => `<div class="plate" data-testid="seat-${s}"></div>`).join('')}</div>
    <div class="bug-teams"><div class="bug-team"></div><div class="bug-team"></div></div>`;
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AnimFxLayer, { st: v, ...layerProps })));
  return host;
}
function rerender(v: PlayerView) { act(() => root!.render(createElement(AnimFxLayer, { st: v, ...layerProps }))); }

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

  it('wave 2: a board bid lights every card edge and slams the bidder plate', () => {
    (window as unknown as { __bwmLayout: unknown }).__bwmLayout = { slots: [0, 1, 2, 3].map((i) => ({ x: i * 90, y: 200, w: 60, h: 84 })) };
    mount(view({ phase: 'bidding', bids: [null, null, null, null] }));
    rerender(view({ phase: 'bidding', bids: ['books', null, null, null] }));
    expect(document.querySelectorAll('.animfx-boardedge').length).toBe(4);
    expect(document.querySelector('[data-testid="seat-0"]')!.classList.contains('animfx-slam')).toBe(true);
    delete (window as unknown as { __bwmLayout?: unknown }).__bwmLayout;
  });

  it('wave 2: the set cracks the set side chip and the shooters stomp', () => {
    const setRec: HandRecord = {
      handNo: 1, dealer: 0, bids: [6, 3, 5, 4], tricksWon: [4, 3, 3, 3],
      sides: [
        { side: 0, seats: [0, 2], contract: 11, contractTricks: 7, tricks: 7, contractMade: false, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: -110, totalScore: -110, totalBags: 0 },
        { side: 1, seats: [1, 3], contract: 7, contractTricks: 6, tricks: 6, contractMade: true, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 0, points: 70, totalScore: 70, totalBags: 0 },
      ],
    };
    mount(view({ phase: 'playing' }));
    rerender(view({ phase: 'handOver', history: [setRec] }));
    expect(document.querySelector('[data-testid="animfx-setbrick"]')).not.toBeNull();
    expect(document.querySelectorAll('.bug-team')[1]!.classList.contains('animfx-stomp')).toBe(true);
    // both partners bid real and side 1 made it: the sync beam fires too
    expect(document.querySelector('[data-testid="animfx-syncbeam"]')).not.toBeNull();
  });

  it('wave 2: first book stamps once per match; a misdeal swirls the cards back', () => {
    const t1 = { leader: 0, plays: [{ seat: 2, card: 'AS' }], winner: 2 } as unknown as PlayerView['tricks'][number];
    mount(view({ phase: 'playing', tricks: [] }));
    rerender(view({ phase: 'playing', tricks: [t1] }));
    expect(document.querySelectorAll('[data-testid="animfx-firstbook"]').length).toBe(1);
    rerender(view({ phase: 'playing', tricks: [t1], misdealReveal: { seat: 1 } as never }));
    expect(document.querySelector('[data-testid="animfx-misdeal"]')).not.toBeNull();
  });

  it('wave 2: no UPSET without real ratings; PAYBACK stamps off the winner profile h2h', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ vsYou: { games: 3, wins: 2, losses: 1 } }) })) as never;
    try {
      mount(view({ phase: 'playing' }), { online: true, names: ['Me', 'Wendy', 'Part', 'Foe'] });
      rerender(view({ phase: 'gameOver', result: { winners: [1] } as never }));
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(document.querySelector('[data-testid="animfx-upset"]')).toBeNull(); // no presence ratings in the store: nothing invented
      expect(document.querySelector('[data-testid="animfx-payback"]')).not.toBeNull(); // winner's vsYou: viewer leads the matchup 2-1
      expect(document.querySelector('[data-testid="animfx-ripple"]')).not.toBeNull(); // the winning book beat
    } finally {
      globalThis.fetch = realFetch;
    }
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

/**
 * Nil spotlight rebalance (owner, 2026-10-21: the wave-1 cut "makes it hard
 * to see anything"). The readability contract, pinned as numbers: the shade
 * peak is capped (never the old 0.55 blackout), the essential zones are
 * punched fully clear, and the viewer-bidder case is the lightest of all.
 */
describe('nil spotlight shade — composition', () => {
  const zone = { x: 100, y: 100, w: 120, h: 60 };

  it('caps the vignette peak: gentle for others, lightest for the viewer-bidder, halved under reduce', () => {
    const base = { seats: [{ plate: zone, slot: null }], trick: null, hand: null, scorebug: null };
    expect(buildSpotlightShade({ ...base, mine: false, reduced: false }).peak).toBe(SPOT_PEAK);
    expect(SPOT_PEAK).toBe(0.3);
    expect(SPOT_PEAK).toBeLessThanOrEqual(0.35);
    expect(buildSpotlightShade({ ...base, mine: true, reduced: false }).peak).toBe(SPOT_PEAK_MINE);
    expect(SPOT_PEAK_MINE).toBeLessThan(SPOT_PEAK);
    expect(buildSpotlightShade({ ...base, mine: false, reduced: true }).peak).toBeCloseTo(SPOT_PEAK / 2);
  });

  it('punches a clear hole for every guaranteed zone: plate, slot, trick, hand, scorebug', () => {
    const spec = buildSpotlightShade({
      seats: [{ plate: { x: 100, y: 100, w: 120, h: 60 }, slot: { x: 150, y: 300, w: 62, h: 88 } }],
      trick: { x: 80, y: 260, w: 240, h: 160 }, hand: { x: 30, y: 620, w: 240, h: 150 }, scorebug: { x: 8, y: 44, w: 374, h: 64 },
      mine: false, reduced: false,
    });
    const centers = spec.holes.map((h) => [h.cx, h.cy]);
    expect(centers).toContainEqual([160, 130]); // bidder plate
    expect(centers).toContainEqual([181, 344]); // bidder slot
    expect(centers).toContainEqual([200, 340]); // whole trick area
    expect(centers).toContainEqual([150, 695]); // viewer's hand
    expect(centers).toContainEqual([195, 76]); // scorebug
    expect(spec.holes).toHaveLength(5);
  });

  it('omits zones that were never measured — no invented clearance', () => {
    const spec = buildSpotlightShade({ seats: [{ plate: zone, slot: null }], trick: null, hand: null, scorebug: null, mine: false, reduced: false });
    expect(spec.holes).toHaveLength(1);
  });

  it('the light pool sits between the bidder plate and their slot', () => {
    const spec = buildSpotlightShade({
      seats: [{ plate: { x: 100, y: 100, w: 120, h: 60 }, slot: { x: 150, y: 300, w: 62, h: 88 } }],
      trick: null, hand: null, scorebug: null, mine: false, reduced: false,
    });
    expect(spec.pools).toEqual([{ cx: 170.5, cy: 237, r: 195 }]);
  });
});

describe('nil spotlight shade — mounted geometry', () => {
  const rect = (x: number, y: number, w: number, h: number) => ({
    left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, x, y, toJSON: () => ({}),
  }) as DOMRect;

  function mountGeo(v: PlayerView) {
    document.body.innerHTML = `
      <header class="scorebug"></header>
      <div class="badge-layer">${[0, 1, 2, 3].map((s) => `<div class="plate" data-testid="seat-${s}"></div>`).join('')}</div>
      <div class="bug-teams"><div class="bug-team"></div><div class="bug-team"></div></div>`;
    document.querySelectorAll('.plate').forEach((el, i) => { (el as HTMLElement).getBoundingClientRect = () => rect(40 + i * 90, 130, 80, 50); });
    (document.querySelector('.scorebug') as HTMLElement).getBoundingClientRect = () => rect(8, 44, 374, 64);
    (window as unknown as { __bwmLayout: unknown }).__bwmLayout = {
      slots: [0, 1, 2, 3].map((i) => ({ x: 60 + i * 80, y: 300, w: 62, h: 88 })),
      trick: [{ x: 100, y: 280, w: 200, h: 140 }],
      hand: [{ x: 40, y: 640, w: 90, h: 130 }, { x: 180, y: 640, w: 90, h: 130 }],
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(AnimFxLayer, { st: v })));
    return host;
  }

  const vigPeak = () => {
    const svg = document.querySelector('[data-testid="animfx-spotlight"]')!;
    const vig = Array.from(svg.querySelectorAll('radialGradient')).find((g) => (g.getAttribute('id') ?? '').endsWith('-vig'))!;
    return Math.max(...Array.from(vig.querySelectorAll('stop')).map((s) => Number(s.getAttribute('stop-opacity'))));
  };

  afterEach(() => { delete (window as unknown as { __bwmLayout?: unknown }).__bwmLayout; });

  it('renders the capped vignette with clear holes over the hand, trick and scorebug — never the old 0.55 blackout', () => {
    mountGeo(view({ bids: [4, 'nil', 4, 4] }));
    const svg = document.querySelector('[data-testid="animfx-spotlight"]')!;
    expect(svg).not.toBeNull();
    expect(vigPeak()).toBe(SPOT_PEAK);
    expect(document.body.innerHTML).not.toContain('0.55');
    const circles = Array.from(svg.querySelectorAll('mask circle')).map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
    expect(circles).toContainEqual([155, 705]); // viewer's hand bbox centre
    expect(circles).toContainEqual([200, 350]); // whole trick area centre
    expect(circles).toContainEqual([195, 76]); // scorebug centre
    expect(document.querySelector('[data-testid="animfx-spotpool"]')).not.toBeNull();
  });

  it('the viewer’s own nil gets the lightest shade', () => {
    mountGeo(view({ bids: ['nil', 4, 4, 4] }));
    expect(vigPeak()).toBe(SPOT_PEAK_MINE);
  });

  it('reduce effects: the shade halves and the light pool holds still', () => {
    fx.setReduce(true);
    mountGeo(view({ bids: [4, 'nil', 4, 4] }));
    expect(vigPeak()).toBeCloseTo(SPOT_PEAK / 2);
    expect(document.querySelector('[data-testid="animfx-spotpool"]')!.classList.contains('calm')).toBe(true);
  });
});

/* ================= wave 3 (owner addendum 2, 2026-10-21) ================= */

describe('wave 3 layer', () => {
  const Q = (t: string) => document.querySelector(`[data-testid="${t}"]`);

  it('THE SAVE: a gold beam snaps saver → bidder when the partner covers a standing nil card', () => {
    const saveTrick = {
      leader: 3,
      plays: [
        { seat: 3, card: 'KH' }, { seat: 0, card: 'AH' }, { seat: 1, card: '4H' }, { seat: 2, card: '3S' },
      ],
      winner: 2,
    } as unknown as PlayerView['tricks'][number];
    mount(view({ bids: ['nil', 4, 5, 4] }));
    rerender(view({ bids: ['nil', 4, 5, 4], tricks: [saveTrick], tricksWon: [0, 0, 1, 0] }));
    expect(Q('animfx-savebeam')).not.toBeNull();
    // a plain trick with no nil at risk never draws the thread
    remount();
    mount(view({ bids: [5, 4, 5, 4] }));
    rerender(view({ bids: [5, 4, 5, 4], tricks: [saveTrick], tricksWon: [0, 0, 1, 0] }));
    expect(Q('animfx-savebeam')).toBeNull();
  });

  it('NIL, BUSTED: the plate cracks on the exact render the nil takes its first trick', () => {
    mount(view({ bids: [4, 'nil', 4, 4] }));
    expect(Q('animfx-spotlight')).not.toBeNull();
    rerender(view({ bids: [4, 'nil', 4, 4], tricksWon: [0, 1, 0, 0] }));
    expect(Q('animfx-crack')).not.toBeNull();
    expect(Q('animfx-spotlight')).toBeNull();
  });

  it('NIL, SEALED: a made nil blooms at hand end', () => {
    const sealRec = {
      handNo: 1, dealer: 0, bids: [4, 'nil', 4, 4], tricksWon: [5, 0, 4, 4],
      sides: [
        { side: 0, seats: [0, 2], contract: 8, contractTricks: 8, tricks: 9, contractMade: false, nils: [{ seat: 1, kind: 'nil', tricks: 0, made: true, points: 100 }], bagsAdded: 1, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 80, points: 10, totalScore: 10, totalBags: 1 },
        { side: 1, seats: [1, 3], contract: 8, contractTricks: 8, tricks: 4, contractMade: false, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 40, points: 140, totalScore: 140, totalBags: 0 },
      ],
    } as unknown as HandRecord;
    mount(view({ phase: 'playing', bids: [4, 'nil', 4, 4] }));
    rerender(view({ phase: 'handOver', bids: [4, 'nil', 4, 4], history: [sealRec] }));
    expect(Q('animfx-nilseal')).not.toBeNull();
  });

  it('SPADES BROKEN: the ember fires on the first spade, once — and a resume past it stays silent', () => {
    const spadeTrick = {
      leader: 0, plays: [{ seat: 0, card: '5H' }, { seat: 1, card: '3S' }], winner: 1,
    } as unknown as PlayerView['tricks'][number];
    mount(view({ phase: 'playing' }));
    rerender(view({ phase: 'playing', tricks: [spadeTrick], tricksWon: [0, 1, 0, 0] }));
    expect(Q('animfx-ember')).not.toBeNull();
    remount();
    // first observed view already contains a spade → seeded silently, no replay
    mount(view({ phase: 'playing', tricks: [spadeTrick], tricksWon: [0, 1, 0, 0] }));
    rerender(view({ phase: 'playing', tricks: [spadeTrick], tricksWon: [0, 1, 0, 0], trick: { leader: 2, plays: [{ seat: 2, card: '9H' }], winner: null } as unknown as PlayerView['trick'] }));
    expect(Q('animfx-ember')).toBeNull();
  });

  it('ON FIRE: the rim lives while the streak lives and dies with it', () => {
    const wt = (winner: number) => ({
      leader: 0, plays: [{ seat: winner, card: 'AS' }], winner,
    }) as unknown as PlayerView['tricks'][number];
    mount(view({ tricks: [wt(2), wt(2), wt(2)] }));
    expect(Q('animfx-firering')).not.toBeNull();
    rerender(view({ tricks: [wt(2), wt(2), wt(2), wt(0)] }));
    expect(Q('animfx-firering')).toBeNull();
  });

  it('STREAK HEAT + BAG BRINK: the scorebug cell carries both while they hold', () => {
    const hand = (handNo: number, p0: number, p1: number) => ({
      handNo, dealer: 0, bids: [4, 4, 4, 4], tricksWon: [4, 3, 3, 3],
      sides: [
        { side: 0, seats: [0, 2], contract: 8, contractTricks: 7, tricks: 7, contractMade: false, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 70, points: p0, totalScore: p0, totalBags: 0 },
        { side: 1, seats: [1, 3], contract: 8, contractTricks: 6, tricks: 6, contractMade: false, nils: [], bagsAdded: 0, bagPenaltyCount: 0, bagPenaltyPoints: 0, bookPoints: 60, points: p1, totalScore: p1, totalBags: 0 },
      ],
    }) as unknown as HandRecord;
    mount(view({ history: [hand(1, 80, -40), hand(2, 60, 10), hand(3, 90, -90)], bags: [8, 3] }));
    expect(Q('animfx-cellheat')).not.toBeNull();
    expect(Q('animfx-cellbrink')).not.toBeNull();
    // two straight hand wins is not heat; 7 bags is not the brink
    rerender(view({ history: [hand(1, 80, -40), hand(2, 60, 10)], bags: [7, 3] }));
    expect(Q('animfx-cellheat')).toBeNull();
    expect(Q('animfx-cellbrink')).toBeNull();
  });

  it('HIGH CONTRACT: the center ring holds while both sides carry >= 6', () => {
    mount(view({ bids: [5, 6, 5, 6] }));
    expect(Q('animfx-hotring')).not.toBeNull();
    rerender(view({ bids: [5, 2, 5, 2] }));
    expect(Q('animfx-hotring')).toBeNull();
  });

  it('DOWN TO THE WIRE: entering the final trick one book short pulses the table edges', () => {
    const dt = (i: number) => ({
      leader: 0, plays: [{ seat: i % 4, card: '9H' }], winner: i % 4,
    }) as unknown as PlayerView['tricks'][number];
    mount(view({ bids: [5, 4, 4, 3], tricks: [], tricksWon: [0, 0, 0, 0] }));
    rerender(view({
      bids: [5, 4, 4, 3],
      tricks: Array.from({ length: 12 }, (_, i) => dt(i)),
      tricksWon: [5, 2, 3, 2],
    }));
    expect(Q('animfx-wire')).not.toBeNull();
  });

  it('PHOTO FINISH + CONFETTI: a 9-point win stamps and rains 24 gold spades for the viewer', () => {
    mount(view({ phase: 'playing' }));
    rerender(view({ phase: 'gameOver', result: { winners: [0], finalScores: [500, 491] } as unknown as PlayerView['result'] }));
    expect(Q('animfx-photofinish')).not.toBeNull();
    const cf = Q('animfx-confetti');
    expect(cf).not.toBeNull();
    expect(cf!.querySelectorAll('.cf-piece')).toHaveLength(24);
  });

  it('a blowout loss gets neither the stamp nor the confetti', () => {
    mount(view({ phase: 'playing' }));
    rerender(view({ phase: 'gameOver', result: { winners: [1], finalScores: [320, 500] } as unknown as PlayerView['result'] }));
    expect(Q('animfx-photofinish')).toBeNull();
    expect(Q('animfx-confetti')).toBeNull();
  });

  it('reduced motion: confetti collapses to a few static spades; the photo stamp still lands', () => {
    fx.setReduce(true);
    mount(view({ phase: 'playing' }));
    rerender(view({ phase: 'gameOver', result: { winners: [0], finalScores: [500, 499] } as unknown as PlayerView['result'] }));
    const cf = Q('animfx-confetti');
    expect(cf).not.toBeNull();
    expect(cf!.classList.contains('still')).toBe(true);
    expect(cf!.querySelectorAll('.cf-piece')).toHaveLength(8);
    expect(Q('animfx-photofinish')).not.toBeNull();
  });
});

function remount() {
  // the module afterEach only unmounts the LAST root — multi-mount
  // scenarios unmount the previous one explicitly before mounting again
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
}
