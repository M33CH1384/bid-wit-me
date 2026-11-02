/**
 * @vitest-environment happy-dom
 *
 * PLATE WIDTH (owner, 2026-11-01): "The fire shouldn't extend beyond the
 * plate here they should have the same width." The streak fire's box IS
 * the streaking seat's plate box — same width, same left/right edges —
 * at every tier, for the smolder too, and for the extinguish puff that
 * rides the same canvas. The 2026-10-30 step-up grew the box 30 px a
 * side so the shader halo could spill onto the felt; at the west seat
 * that read as a flame band stretching past the plate in both
 * directions. These pins stub each plate's rect (different widths per
 * seat, so a fixed or widest-box regression cannot hide) and read the
 * rendered container's inline geometry.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRules, type PlayerView } from '@spades/rules';
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

const wt = (winner: number) => ({
  leader: 0, plays: [{ seat: winner, card: 'AS' }], winner,
}) as unknown as PlayerView['tricks'][number];

/* one plate width per seat, all different — the fire must track the
 * streaking seat's OWN plate, never a fixed box */
const RECTS = [
  { left: 8, top: 420, width: 150, height: 54 },   // seat 0 (south)
  { left: 20, top: 200, width: 132, height: 52 },  // seat 1 (west)
  { left: 105, top: 96, width: 180, height: 52 },  // seat 2 (north)
  { left: 240, top: 200, width: 132, height: 52 }, // seat 3 (east)
];

let root: Root | null = null;
function mount(v: PlayerView) {
  document.body.innerHTML = `
    <div class="badge-layer">${[0, 1, 2, 3].map((s) => `<div class="plate" data-testid="seat-${s}"></div>`).join('')}</div>
    <div class="bug-teams"><div class="bug-team"></div><div class="bug-team"></div></div>`;
  document.querySelectorAll('.plate').forEach((el, i) => {
    const r = RECTS[i]!;
    (el as HTMLElement).getBoundingClientRect = () => ({
      left: r.left, top: r.top, width: r.width, height: r.height,
      right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}),
    }) as DOMRect;
  });
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

const fireBox = () => document.querySelector<HTMLElement>('.animfx-platefire');

describe('streak fire width == plate width (owner, 2026-11-01)', () => {
  it('a tier-1 fire at the north seat takes the plate box exactly — and the puff keeps it', () => {
    mount(view({ tricks: [wt(2), wt(2), wt(2)] }));
    expect(document.querySelector('[data-testid="animfx-firering"]')).not.toBeNull();
    const box = fireBox();
    expect(box).not.toBeNull();
    // the owner's sentence: same width, same edges (plate: left 105, w 180)
    expect(box!.style.width).toBe('180px');
    expect(box!.style.left).toBe('105px');
    // vertical untouched by the width fix: T1 rise = 38 + 1*12 = 50
    expect(box!.style.top).toBe('46px');      // plate top 96 − 50
    expect(box!.style.height).toBe('130px');  // 52 + 50 + 12 (padB) + 16 (glowPadB)
    // the streak breaks: the extinguish puff rides the same box
    rerender(view({ tricks: [wt(2), wt(2), wt(2), wt(0)] }));
    expect(document.querySelector('[data-testid="animfx-extinguish"]')).not.toBeNull();
    const puff = fireBox();
    expect(puff).not.toBeNull();
    expect(puff!.style.width).toBe('180px');
    expect(puff!.style.left).toBe('105px');
  });

  it('a smolder at the west seat is plate-bounded too', () => {
    mount(view({ tricks: [wt(1), wt(1)] }));
    expect(document.querySelector('[data-testid="animfx-smolder"]')).not.toBeNull();
    const box = fireBox();
    expect(box).not.toBeNull();
    expect(box!.style.width).toBe('132px');   // west plate: left 20, w 132
    expect(box!.style.left).toBe('20px');
    expect(box!.style.top).toBe('178px');     // plate top 200 − smolder rise 22
    expect(box!.style.height).toBe('102px');  // 52 + 22 + 12 + 16
  });

  it('a tier-4 fire — the widest flame — still matches its plate at the east seat', () => {
    mount(view({ tricks: [wt(3), wt(3), wt(3), wt(3), wt(3), wt(3), wt(3)] }));
    expect(document.querySelector('[data-testid="animfx-firering"]')).not.toBeNull();
    const box = fireBox();
    expect(box).not.toBeNull();
    expect(box!.style.width).toBe('132px');   // east plate: left 240, w 132
    expect(box!.style.left).toBe('240px');
    expect(box!.style.top).toBe('114px');     // plate top 200 − T4 rise (38 + 4*12 = 86)
    expect(box!.style.height).toBe('166px');  // 52 + 86 + 12 + 16
  });
});
