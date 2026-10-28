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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeRules, type HandRecord, type PlayerView } from '@spades/rules';
import AnimFxLayer, { buildSpotlightShade, paintSpotlightShade, SPOT_PEAK, SPOT_PEAK_MINE } from '../src/animfx/AnimFxLayer';
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
let layerProps: { online?: boolean; names?: string[]; resultPresented?: boolean } = {};
function mount(v: PlayerView, opts: { online?: boolean; names?: string[]; resultPresented?: boolean } = {}) {
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
/** Flip the host's presented signal without changing the game state. */
function rerenderPresented(v: PlayerView) { layerProps = { ...layerProps, resultPresented: true }; rerender(v); }

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
  fx.setReduce(false);
  uninstallRasterCanvas();
});

/* ------------------------------------------- software canvas rasterizer --
 * happy-dom's canvas paints NOTHING — its getContext('2d') returns null —
 * so DOM-level pins can never say what a screen actually shows. That blind
 * spot is how the SVG-mask spotlight shipped green and rendered un-punched
 * on iOS WebKit. These tests instead run the REAL painter
 * (paintSpotlightShade) against a faithful software implementation of the
 * Canvas2D ops it uses — radial gradients interpolated in premultiplied
 * space, source-over, destination-out — and assert actual PIXELS.
 *
 * The painter only ever uses concentric radial gradients, fillRect,
 * clearRect, setTransform and the two composite ops; the fake implements
 * exactly those, per the canvas spec's math. */
type Premul = [number, number, number, number]; // premultiplied rgba, 0..1

function parsePremul(color: string): Premul {
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(color);
  if (!m) throw new Error(`rasterizer: unparseable color "${color}"`);
  const a = m[4] === undefined ? 1 : Number(m[4]);
  return [(Number(m[1]) / 255) * a, (Number(m[2]) / 255) * a, (Number(m[3]) / 255) * a, a];
}

class FakeGradient {
  readonly stops: { offset: number; c: Premul }[] = [];
  constructor(
    readonly x0: number, readonly y0: number, readonly r0: number,
    readonly x1: number, readonly y1: number, readonly r1: number,
  ) {}
  addColorStop(offset: number, color: string): void {
    this.stops.push({ offset, c: parsePremul(color) });
    this.stops.sort((p, q) => p.offset - q.offset);
  }
  /** premultiplied color at a CSS-space point */
  at(x: number, y: number): Premul {
    const d = Math.hypot(x - this.x0, y - this.y0);
    let t = this.r1 > this.r0 ? (d - this.r0) / (this.r1 - this.r0) : 1;
    t = Math.min(1, Math.max(0, t));
    const s = this.stops;
    if (!s.length) return [0, 0, 0, 0];
    if (t <= s[0]!.offset) return s[0]!.c;
    for (let i = 1; i < s.length; i++) {
      if (t <= s[i]!.offset) {
        const a = s[i - 1]!, b = s[i]!;
        const span = b.offset - a.offset;
        const f = span === 0 ? 0 : (t - a.offset) / span;
        return [0, 1, 2, 3].map((k) => a.c[k]! + (b.c[k]! - a.c[k]!) * f) as Premul;
      }
    }
    return s[s.length - 1]!.c;
  }
}

interface PaintOp { kind: 'fillRect' | 'clearRect'; comp: string; x: number; y: number; w: number; h: number; gradient: FakeGradient | null }

class FakeCtx2D {
  readonly ops: PaintOp[] = [];
  px: Float32Array;
  scale = 1;
  fillStyle: string | FakeGradient = '#000000';
  globalCompositeOperation = 'source-over';
  constructor(public w: number, public h: number) { this.px = new Float32Array(w * h * 4); }
  setTransform(a: number): void { this.scale = a; }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.ops.push({ kind: 'clearRect', comp: this.globalCompositeOperation, x, y, w, h, gradient: null });
    const [x0, y0, x1, y1] = this.region(x, y, w, h);
    for (let j = y0; j < y1; j++) for (let i = x0; i < x1; i++) {
      const idx = (j * this.w + i) * 4;
      this.px[idx] = 0; this.px[idx + 1] = 0; this.px[idx + 2] = 0; this.px[idx + 3] = 0;
    }
  }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number): FakeGradient {
    return new FakeGradient(x0, y0, r0, x1, y1, r1);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const g = typeof this.fillStyle === 'string' ? null : this.fillStyle;
    const solid: Premul | null = typeof this.fillStyle === 'string' ? parsePremul(this.fillStyle) : null;
    this.ops.push({ kind: 'fillRect', comp: this.globalCompositeOperation, x, y, w, h, gradient: g });
    const erase = this.globalCompositeOperation === 'destination-out';
    const [x0, y0, x1, y1] = this.region(x, y, w, h);
    for (let j = y0; j < y1; j++) {
      for (let i = x0; i < x1; i++) {
        const src = g ? g.at((i + 0.5) / this.scale, (j + 0.5) / this.scale) : solid!;
        if (src[3] === 0) continue; // a fully transparent source changes nothing, in either composite mode
        const idx = (j * this.w + i) * 4;
        const keep = 1 - src[3];
        if (erase) {
          this.px[idx] = this.px[idx]! * keep;
          this.px[idx + 1] = this.px[idx + 1]! * keep;
          this.px[idx + 2] = this.px[idx + 2]! * keep;
          this.px[idx + 3] = this.px[idx + 3]! * keep;
        } else {
          this.px[idx] = src[0] + this.px[idx]! * keep;
          this.px[idx + 1] = src[1] + this.px[idx + 1]! * keep;
          this.px[idx + 2] = src[2] + this.px[idx + 2]! * keep;
          this.px[idx + 3] = src[3] + this.px[idx + 3]! * keep;
        }
      }
    }
  }
  private region(x: number, y: number, w: number, h: number): [number, number, number, number] {
    const s = this.scale;
    return [
      Math.max(0, Math.floor(x * s)), Math.max(0, Math.floor(y * s)),
      Math.min(this.w, Math.ceil((x + w) * s)), Math.min(this.h, Math.ceil((y + h) * s)),
    ];
  }
  /** alpha (0..1) of the device pixel at (x, y) */
  alphaAt(x: number, y: number): number {
    return this.px[(Math.floor(y) * this.w + Math.floor(x)) * 4 + 3]!;
  }
}

const rasterByCanvas = new WeakMap<HTMLCanvasElement, FakeCtx2D>();
let realGetContext: HTMLCanvasElement['getContext'] | null = null;
function installRasterCanvas(): void {
  realGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string) {
    if (type !== '2d') return null;
    let fake = rasterByCanvas.get(this);
    if (!fake) {
      fake = new FakeCtx2D(this.width || 300, this.height || 150);
      rasterByCanvas.set(this, fake);
    } else if (fake.w !== this.width || fake.h !== this.height) {
      // a real canvas clears its bitmap when its size is (re)assigned
      fake = new FakeCtx2D(this.width, this.height);
      rasterByCanvas.set(this, fake);
    }
    return fake;
  } as HTMLCanvasElement['getContext'];
}
function uninstallRasterCanvas(): void {
  if (realGetContext) HTMLCanvasElement.prototype.getContext = realGetContext;
  realGetContext = null;
}
beforeEach(() => { installRasterCanvas(); });

/** the vignette's alpha at a CSS point, computed from the DESIGN numbers —
 * centre (50%, 42%), radius 78% of the normalized diagonal, stops: clear to
 * 55%, 40% of peak at 80%, peak at the rim. Written independently of the
 * painter so the pixel pins check the painter instead of mirroring it. */
function expectedVignetteAlpha(cx: number, cy: number, peak: number, w: number, h: number): number {
  const t = Math.min(1, Math.hypot(cx - w / 2, cy - h * 0.42) / (0.78 * (Math.hypot(w, h) / Math.SQRT2)));
  if (t <= 0.55) return 0;
  if (t <= 0.8) return peak * 0.4 * ((t - 0.55) / 0.25);
  return peak * (0.4 + 0.6 * ((t - 0.8) / 0.2));
}

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

  it('wave 2: no UPSET without real ratings; PAYBACK stamps off the winner profile h2h — on the PRESENTED edge', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ vsYou: { games: 3, wins: 2, losses: 1 } }) })) as never;
    try {
      mount(view({ phase: 'playing' }), { online: true, names: ['Me', 'Wendy', 'Part', 'Foe'] });
      const over = view({ phase: 'gameOver', result: { winners: [1] } as never });
      rerender(over);
      await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
      expect(document.querySelector('[data-testid="animfx-upset"]')).toBeNull(); // no presence ratings in the store: nothing invented
      // 2026-10-28: the stamp is QUEUED, not fired — the result state has
      // landed but no result surface has presented yet (the finished-trick
      // hold is still running), and a stamp fired now would spend its
      // whole life before the victory screen exists
      expect(document.querySelector('[data-testid="animfx-payback"]')).toBeNull();
      expect(document.querySelector('[data-testid="animfx-ripple"]')).not.toBeNull(); // the winning book beat is a table moment: unchanged
      rerenderPresented(over);
      expect(document.querySelector('[data-testid="animfx-payback"]')).not.toBeNull(); // winner's vsYou: viewer leads the matchup 2-1
      expect(document.querySelector('[data-testid="animfx-upset"]')).toBeNull(); // still nothing invented
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

describe('nil spotlight shade — mounted pixels', () => {
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

  const spotCanvas = () => document.querySelector<HTMLCanvasElement>('[data-testid="animfx-spotlight"]');
  const spotCtx = () => spotCanvas()!.getContext('2d') as unknown as FakeCtx2D;
  /** the alpha the design says a CSS point should carry, sampled at its pixel centre */
  const designAlpha = (x: number, y: number, peak: number) =>
    expectedVignetteAlpha(x + 0.5, y + 0.5, peak, window.innerWidth, window.innerHeight);

  afterEach(() => { delete (window as unknown as { __bwmLayout?: unknown }).__bwmLayout; });

  it('the spotlight is a painted CANVAS — no SVG, no <mask> anywhere (the iOS WebKit failure class is gone)', () => {
    mountGeo(view({ bids: [4, 'nil', 4, 4] }));
    expect(spotCanvas()).not.toBeNull();
    expect(spotCanvas()!.tagName).toBe('CANVAS');
    expect(document.querySelector('[data-testid="animfx"] svg')).toBeNull();
    expect(document.querySelector('mask')).toBeNull();
  });

  it('paints the capped vignette with the zones ACTUALLY clear — sampled pixels, not structure', () => {
    mountGeo(view({ bids: [4, 'nil', 4, 4] }));
    const ctx = spotCtx();
    // the guaranteed zones carry ZERO shade at their centres
    expect(ctx.alphaAt(155, 705)).toBe(0); // viewer's hand bbox centre
    expect(ctx.alphaAt(200, 350)).toBe(0); // whole trick area centre
    expect(ctx.alphaAt(195, 76)).toBe(0); // scorebug centre
    // outside every hole the vignette is present, at exactly the designed level
    expect(ctx.alphaAt(1000, 740)).toBeCloseTo(designAlpha(1000, 740, SPOT_PEAK), 2);
    const corner = ctx.alphaAt(window.innerWidth - 1, window.innerHeight - 1);
    expect(corner).toBeCloseTo(designAlpha(window.innerWidth - 1, window.innerHeight - 1, SPOT_PEAK), 2);
    expect(corner).toBeLessThanOrEqual(SPOT_PEAK);
    expect(document.body.innerHTML).not.toContain('0.55');
    expect(document.querySelector('[data-testid="animfx-spotpool"]')).not.toBeNull();
  });

  it('the viewer’s own nil gets the lightest shade', () => {
    mountGeo(view({ bids: ['nil', 4, 4, 4] }));
    const ctx = spotCtx();
    const corner = ctx.alphaAt(window.innerWidth - 1, window.innerHeight - 1);
    expect(corner).toBeCloseTo(designAlpha(window.innerWidth - 1, window.innerHeight - 1, SPOT_PEAK_MINE), 2);
    expect(corner).toBeLessThanOrEqual(SPOT_PEAK_MINE);
  });

  it('reduce effects: the shade halves and the light pool holds still', () => {
    fx.setReduce(true);
    mountGeo(view({ bids: [4, 'nil', 4, 4] }));
    const ctx = spotCtx();
    const corner = ctx.alphaAt(window.innerWidth - 1, window.innerHeight - 1);
    expect(corner).toBeCloseTo(designAlpha(window.innerWidth - 1, window.innerHeight - 1, SPOT_PEAK / 2), 2);
    expect(document.querySelector('[data-testid="animfx-spotpool"]')!.classList.contains('calm')).toBe(true);
  });
});

/**
 * The painter itself, run against the software rasterizer at phone
 * geometry. This is the test that would have caught the iOS regression:
 * it samples the pixels a screen would show — a zone the vignette truly
 * darkens, punched back to zero; a feather band at half strength; the far
 * corner at exactly the cap.
 */
describe('nil spotlight shade — raster (paintSpotlightShade)', () => {
  const GEO = {
    seats: [{ plate: { x: 100, y: 100, w: 120, h: 60 }, slot: { x: 150, y: 300, w: 62, h: 88 } }],
    trick: { x: 80, y: 260, w: 240, h: 160 }, hand: { x: 30, y: 620, w: 240, h: 150 }, scorebug: { x: 8, y: 44, w: 374, h: 64 },
  };
  const paint = (spec: ReturnType<typeof buildSpotlightShade>, w: number, h: number, dpr = 1) => {
    const ctx = new FakeCtx2D(Math.round(w * dpr), Math.round(h * dpr));
    paintSpotlightShade(ctx as unknown as CanvasRenderingContext2D, spec, w, h, dpr);
    return ctx;
  };

  it('punches a clear zone out of a region the vignette genuinely shades — and feathers back to it', () => {
    const W = 390, H = 844; // the owner's phone class
    const holed = paint(buildSpotlightShade({ ...GEO, mine: false, reduced: false }), W, H);
    const bare = paint(buildSpotlightShade({ seats: [], trick: null, hand: null, scorebug: null, mine: false, reduced: false }), W, H);
    // without holes the vignette really does cover the hand centre…
    expect(bare.alphaAt(150, 695)).toBeGreaterThan(0.05);
    // …with holes punched it is EXACTLY clear — hand, trick, scorebug alike
    expect(holed.alphaAt(150, 695)).toBe(0);
    expect(holed.alphaAt(200, 340)).toBe(0);
    expect(holed.alphaAt(195, 76)).toBe(0);
    // halfway across the hand hole's feather band (r 136 + feather 46/2 from
    // its centre) the shade is back to roughly half the bare vignette there
    const ratio = holed.alphaAt(55, 822) / bare.alphaAt(55, 822);
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.65);
  });

  it('far corners reach exactly the cap — the viewer-bidder cap, halved under reduce — and only there', () => {
    const empty = { seats: [], trick: null, hand: null, scorebug: null };
    const tall = paint(buildSpotlightShade({ ...empty, mine: false, reduced: false }), 100, 400);
    expect(tall.alphaAt(99, 399)).toBeCloseTo(SPOT_PEAK, 3); // bottom corner: the cap, exactly
    expect(tall.alphaAt(50, 168)).toBe(0); // the gradient centre stays clear
    expect(tall.alphaAt(0, 0)).toBeLessThan(SPOT_PEAK); // nearer corners stay under it
    const mine = paint(buildSpotlightShade({ ...empty, mine: true, reduced: false }), 100, 400);
    expect(mine.alphaAt(99, 399)).toBeCloseTo(SPOT_PEAK_MINE, 3);
    const reduced = paint(buildSpotlightShade({ ...empty, mine: false, reduced: true }), 100, 400);
    expect(reduced.alphaAt(99, 399)).toBeCloseTo(SPOT_PEAK / 2, 3);
  });

  it('paints at device-pixel scale: dpr 2 doubles the buffer, the css-space picture is unchanged', () => {
    const spec = buildSpotlightShade({ ...GEO, mine: false, reduced: false });
    const ctx = paint(spec, 390, 844, 2);
    expect([ctx.w, ctx.h]).toEqual([780, 1688]);
    expect(ctx.alphaAt(300, 1390)).toBe(0); // the hand centre, in device pixels
    expect(ctx.alphaAt(779, 1687)).toBeCloseTo(
      expectedVignetteAlpha(779.5 / 2, 1687.5 / 2, SPOT_PEAK, 390, 844), 2);
  });

  it('the mechanism: source-over vignette, then one destination-out erase per hole at r → r+feather', () => {
    const spec = buildSpotlightShade({ ...GEO, mine: false, reduced: false });
    const ctx = paint(spec, 390, 844);
    const fills = ctx.ops.filter((o) => o.kind === 'fillRect');
    expect(fills[0]!.comp).toBe('source-over');
    expect(fills[0]!.gradient!.stops.map((s) => s.offset)).toEqual([0, 0.55, 0.8, 1]);
    expect(Math.max(...fills[0]!.gradient!.stops.map((s) => s.c[3]))).toBeCloseTo(spec.peak);
    const erases = fills.slice(1);
    expect(erases).toHaveLength(spec.holes.length);
    erases.forEach((op, i) => {
      const hole = spec.holes[i]!;
      expect(op.comp).toBe('destination-out');
      expect([op.gradient!.x0, op.gradient!.y0]).toEqual([hole.cx, hole.cy]);
      expect(op.gradient!.r0).toBe(hole.r);
      expect(op.gradient!.r1).toBe(hole.r + hole.feather);
      expect(Math.max(...op.gradient!.stops.map((s) => s.c[3]))).toBe(1); // fully opaque at the core: the punch is total
    });
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

  it('HIGH CONTRACT RING REMOVED (owner 2026-10-23): no center ring renders, however hot the contracts run', () => {
    mount(view({ bids: [5, 6, 5, 6] }));
    expect(Q('animfx-hotring')).toBeNull();
    rerender(view({ bids: [8, 7, 8, 7] }));
    expect(Q('animfx-hotring')).toBeNull();
    expect(document.querySelector('.animfx-hotring')).toBeNull();
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

  it('PHOTO FINISH + CONFETTI: the layer fires neither on the result state (2026-10-28 presented-gate fix)', () => {
    // The Wave B swap fired both from here, on the result STATE's arrival —
    // while the finished trick was still in its hold and no result surface
    // could present, so their whole 2.3 s / 3 s life elapsed unseen (the
    // owner's landscape report). They now live on the presenting surfaces,
    // gated on presentation — pinned in victory-presented.test.ts (the
    // decided recap tapes with BOTH real final scores, 505–500 there, and
    // rains for the winner only). This test pins the layer's half: even a
    // 9-point viewer win produces no layer shot, before or after the
    // presented signal.
    mount(view({ phase: 'playing' }));
    const over = view({ phase: 'gameOver', result: { winners: [0], finalScores: [500, 491] } as unknown as PlayerView['result'] });
    rerender(over);
    expect(Q('animfx-photofinish')).toBeNull();
    expect(Q('animfx-confetti')).toBeNull();
    rerenderPresented(over);
    expect(Q('animfx-photofinish')).toBeNull();
    expect(Q('animfx-confetti')).toBeNull();
  });

  it('a blowout loss gets neither the stamp nor the confetti', () => {
    mount(view({ phase: 'playing' }));
    rerender(view({ phase: 'gameOver', result: { winners: [1], finalScores: [320, 500] } as unknown as PlayerView['result'] }));
    expect(Q('animfx-photofinish')).toBeNull();
    expect(Q('animfx-confetti')).toBeNull();
  });

  it('reduced motion: the layer still fires neither — the still pose lives on the surfaces', () => {
    // The calm read moved with the celebration: the presenting surfaces
    // render VictoryConfetti with still=true under reduce (the renderer's
    // still pose is pinned in recapfx's model tests; the surfaces' gates
    // in victory-presented.test.ts). The layer fires nothing either way.
    fx.setReduce(true);
    mount(view({ phase: 'playing' }));
    rerender(view({ phase: 'gameOver', result: { winners: [0], finalScores: [500, 499] } as unknown as PlayerView['result'] }));
    expect(Q('animfx-confetti')).toBeNull();
    expect(Q('animfx-photofinish')).toBeNull();
  });
});

function remount() {
  // the module afterEach only unmounts the LAST root — multi-mount
  // scenarios unmount the previous one explicitly before mounting again
  if (root) act(() => root!.unmount());
  root = null;
  document.body.innerHTML = '';
}

/* ================= Run It tornado ladder (owner program, 2026-10-28) ================= */

describe('tornado ladder layer', () => {
  it('the chip ticks per claim with pips = level, a partner claim ticks the SIDE ladder, and fx.tornado picks up the stamp', () => {
    const rt = (winner: number) => ({
      leader: 0, plays: [{ seat: winner, card: 'AS', run: true }], winner,
    }) as unknown as PlayerView['tricks'][number];
    const chips = () => document.querySelectorAll('[data-testid="animfx-tornchip"]');
    try {
      mount(view({ phase: 'playing', tricks: [] }));
      expect(chips()).toHaveLength(0); // nothing claimed yet: no chip, no level
      // seat 2 claims the side's first Run It of the match
      rerender(view({ phase: 'playing', tricks: [rt(2)] }));
      expect(chips()).toHaveLength(1);
      const first = chips()[0]!;
      expect(first.textContent).toContain('Level 1 · Dust Devil');
      expect(first.querySelectorAll('.tornchip-pip.lit')).toHaveLength(1);
      expect(first.querySelectorAll('.tornchip-pip')).toHaveLength(5);
      // the stamp is waiting on the fx bus for Table's tornado assignment
      fx.tornado = { start: performance.now(), reduced: false };
      expect(fx.tornado).toMatchObject({ level: 1, side: 0, seat: 2 });
      fx.tornado = null;
      // the PARTNER (seat 0, same side) claims in hand 2: the side's ladder ticks to rung 2
      rerender(view({ phase: 'playing', handNo: 2, tricks: [rt(0)] }));
      const all = chips();
      const second = all[all.length - 1]!;
      expect(second.textContent).toContain('Level 2 · Twister');
      expect(second.querySelectorAll('.tornchip-pip.lit')).toHaveLength(2);
      fx.tornado = { start: performance.now(), reduced: false };
      expect(fx.tornado).toMatchObject({ level: 2, side: 0, seat: 0 });
    } finally {
      fx.tornado = null;
      fx.clearTornadoClaim();
    }
  });
});
