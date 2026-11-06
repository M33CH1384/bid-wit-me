/**
 * @vitest-environment happy-dom
 *
 * Option C — the ending showcase as its own beat (owner, 2026-11-05:
 * "C — Showcase only, then results").
 *
 * The complaint this answers: a game ENDED by a set (shotOut / third-set)
 * still stopped at the between-hands HAND RECAP — ordinary furniture, a
 * "SEE FINAL RESULTS" button — so winning didn't feel like winning, and
 * the knockout moment shared a screen with the bookkeeping. His words:
 * "If the game is over we don't need to go to the between hands screen
 * at all."
 *
 * The shape now: a set ending presents ONLY the finale showcase — the
 * knocked side's finale cover card(s), exactly the cards the decided
 * recap rendered (same components, classes, animations, durations),
 * plus the 3 THE HARD WAY flash for a third-set ending — in a bare
 * `.tt-showcase` stage with NO recap furniture, then AUTO-ADVANCES to
 * the results surface when the show completes. A tap on the backdrop
 * advances sooner. No button press is ever required (the old
 * shotRecapAck Continue gate is gone). Review the tricks, the one door
 * that lived only on the recap, is carried onto both results surfaces.
 *
 * Like the finale suites, everything here drives the REAL engine to the
 * ending (Barbershop story games for shotOut / third-set; a Rec Center
 * game for the both-sides-shot-out case) and mounts the REAL recap
 * sequence — fabricated decided states are what let routing gaps ship.
 * The story fixtures double as the story pin: story tables mount the
 * same Intermission through the same Table gate, so a story set ending
 * takes the same beat on its way to the story results/outro path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { type GameState, applyAction, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction, STORY_STOPS } from '@spades/bots';
import { Intermission, ENDING_BEAT_COVER_MS, ENDING_BEAT_HOLD_MS, FINALE_FLASH_DELAY_MS, endingBeatMs } from '../src/Intermission';
import { storyRulesFor } from '../src/story/storySettings';
import { normalizeSettings } from '../src/settings';
import { clearTeamHoles } from '../src/shotMarks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type IOCallback = (entries: { isIntersecting: boolean }[]) => void;
let ioCallbacks: IOCallback[] = [];
class FakeIO {
  constructor(cb: IOCallback) { ioCallbacks.push(cb); }
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
function fireIO() { act(() => { for (const cb of ioCallbacks) cb([{ isIntersecting: true }]); }); }

/* ---------- fixtures: real Barbershop story games (as the headline suite) ---------- */

const barberStop = STORY_STOPS.find((s) => s.id === 'barbershop')!;
const barberRules = storyRulesFor(barberStop, normalizeSettings({}));
const BARBER_NAMES = ['You', 'Mr. Coleman', 'Dee', 'June'];

/** Drive a real Barbershop game in which `rigSide` is set on `rigHands`
 *  (its seats overbid to 9) until the game ends with `endReason`. */
function playRigged(seed: string, rigSide: 0 | 1, rigHands: ReadonlySet<number>, endReason: string): { states: GameState[]; final: GameState } | null {
  let st = newGame(barberRules, seed);
  const states: GameState[] = [];
  for (let g = 0; g < 200000 && st.phase !== 'gameOver'; g++) {
    if (st.phase === 'handOver') { states.push(st); st = applyAction(st, { type: 'nextHand' }); continue; }
    const t = pendingTurn(st);
    if (!t) break;
    const rigged = (rigSide === 0 ? t.seat === 0 || t.seat === 2 : t.seat === 1 || t.seat === 3) && rigHands.has(st.handNo);
    if (rigged && t.kind === 'bid') {
      try { st = applyAction(st, { type: 'bid', seat: t.seat, bid: 9 }); continue; }
      catch { /* fall through to the bot's bid */ }
    }
    const a = chooseBotAction(viewFor(st, t.seat), rigged || (rigSide === 0 ? t.seat === 0 || t.seat === 2 : t.seat === 1 || t.seat === 3) ? 'novice' : 'pro');
    if (!a) break;
    st = applyAction(st, a);
  }
  if (st.phase !== 'gameOver' || st.result?.endReason !== endReason) return null;
  if (!st.result.shotOut?.includes(rigSide)) return null;
  return { states, final: st };
}

function findGame(rigSide: 0 | 1, rigHands: ReadonlySet<number>, endReason: string) {
  for (let i = 0; i < 60; i++) {
    const run = playRigged(`finale-headline-${endReason}-${rigSide}-${i}`, rigSide, rigHands, endReason);
    if (run) return run;
  }
  return null;
}

/* ---------- fixture: a Rec Center game where BOTH sides are shot out ---------- */

const recStop = STORY_STOPS.find((s) => s.id === 'rec-center')!;
const recRules = storyRulesFor(recStop, normalizeSettings({}));
const REC_NAMES = ['You', 'Big Mike', 'Dee', 'Hana'];

function playBothRigged(seed: string, rigHands: ReadonlySet<number>): { states: GameState[]; final: GameState } | null {
  let st = newGame(recRules, seed);
  const states: GameState[] = [];
  for (let g = 0; g < 200000 && st.phase !== 'gameOver'; g++) {
    if (st.phase === 'handOver') { states.push(st); st = applyAction(st, { type: 'nextHand' }); continue; }
    const t = pendingTurn(st);
    if (!t) break;
    if (rigHands.has(st.handNo) && t.kind === 'bid') {
      try { st = applyAction(st, { type: 'bid', seat: t.seat, bid: 9 }); continue; }
      catch { /* fall through to the bot's bid */ }
    }
    const a = chooseBotAction(viewFor(st, t.seat), 'novice');
    if (!a) break;
    st = applyAction(st, a);
  }
  if (st.phase !== 'gameOver' || st.result?.endReason !== 'shotOut') return null;
  const out = st.result.shotOut ?? [];
  if (!out.includes(0) || !out.includes(1)) return null;
  return { states, final: st };
}

function findBothShotOut() {
  for (let i = 0; i < 200; i++) {
    const run = playBothRigged(`finale-compose-both-${i}`, new Set([2, 3]));
    if (run) return run;
  }
  return null;
}

/* ---------- mounting (the recap sequence, as Table drives it) ---------- */

const elFor = (ctx: { storyStopId: string; venueId: string }, names: string[]) =>
  (st: GameState, onReady: () => void = () => {}) => createElement(Intermission, {
    st, names, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
    onReady, onScorePad: () => {}, onChat: () => {}, onLeave: () => {},
    setAnimCtx: { storyStopId: ctx.storyStopId, venueId: ctx.venueId, setting: 'auto' },
  });
const barberEl = elFor({ storyStopId: 'barbershop', venueId: 'barbershop' }, BARBER_NAMES);
const recEl = elFor({ storyStopId: 'rec-center', venueId: recStop.venueId }, REC_NAMES);

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(el: ReturnType<typeof barberEl>) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
}
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
}
afterEach(() => { unmount(); ioCallbacks = []; vi.useRealTimers(); });

/** Walk the game's earlier recaps like Table does, then mount the decided
 *  one and lift its gates (entrance + in-view). Returns the decided DOM. */
function walkToDecided(run: { states: GameState[]; final: GameState }, el: typeof barberEl = barberEl, onReady: () => void = () => {}) {
  clearTeamHoles();
  for (const st of run.states) {
    mount(el(st));
    act(() => { vi.advanceTimersByTime(600); });
    fireIO();
    unmount();
    ioCallbacks = [];
  }
  const h = mount(el(run.final, onReady));
  act(() => { vi.advanceTimersByTime(600); });
  fireIO();
  act(() => { vi.advanceTimersByTime(50); });
  return h;
}

/** Walk the earlier recaps, then mount the decided one WITHOUT advancing
 *  time — the timing tests step the clock themselves. */
function mountDecided(run: { states: GameState[]; final: GameState }, onReady: () => void) {
  clearTeamHoles();
  for (const st of run.states) {
    mount(barberEl(st));
    act(() => { vi.advanceTimersByTime(600); });
    fireIO();
    unmount();
    ioCallbacks = [];
  }
  return mount(barberEl(run.final, onReady));
}

const FURNITURE_TEXT = ['TOP SCORES', 'See final results', 'HAND RECAP'];

function expectNoFurniture(h: HTMLElement) {
  expect(h.querySelector('[data-testid="ending-showcase"]'), 'the bare showcase stage').not.toBeNull();
  expect(h.querySelector('[data-testid="recap-top-scores"]'), 'no top-scores table').toBeNull();
  expect(h.querySelector('[data-testid="recap-strip"]'), 'no hands strip').toBeNull();
  expect(h.querySelector('[data-testid="talk-ready"]'), 'no Continue / See-final-results button').toBeNull();
  expect(h.querySelector('[data-testid="recap-leave"]'), 'no Leave button').toBeNull();
  expect(h.querySelector('[data-testid="recap-chat"]'), 'no chat button').toBeNull();
  expect(h.querySelector('.tt-callouts'), 'no callout ribbons').toBeNull();
  expect(h.querySelector('.tt-head'), 'no recap header').toBeNull();
  expect(h.querySelector('.tt-foot'), 'no recap footer').toBeNull();
  for (const t of FURNITURE_TEXT) expect(h.textContent).not.toContain(t);
  const backdrop = h.querySelector('[data-testid="table-talk"]')!;
  expect(backdrop.getAttribute('data-showcase')).toBe('yes');
}

/* ---------- the beat, per ending kind ---------- */

describe('Option C: a shotOut ending is the showcase alone, then results', () => {
  it('shotOut WIN (they got shot): only THEIR finale card, no furniture, no flash', () => {
    vi.useFakeTimers();
    const run = findGame(1, new Set([2, 3]), 'shotOut');
    expect(run, 'a shotOut game for the opponents').not.toBeNull();
    const h = walkToDecided(run!);
    expectNoFurniture(h);
    // the knocked side's card — the same card the decided recap rendered
    const card = h.querySelector('[data-testid="recap-side-1"]')!;
    expect(card, 'the knocked side’s card').not.toBeNull();
    const cover = card.querySelector('[data-testid="recap-setanim-1"]')!;
    expect(cover.getAttribute('data-anim')).toBe('barbershop');
    expect(cover.getAttribute('data-tier')).toBe('finale');
    expect(card.querySelector('[data-testid="recap-finale-headline-1"]')?.textContent).toContain('SHOT BACK 2 BACK');
    expect(card.querySelector('[data-testid="time-of-death"]'), 'time of death rides the card').not.toBeNull();
    // the winners' ordinary card is furniture for this beat — it is not here
    expect(h.querySelector('[data-testid="recap-side-0"]')).toBeNull();
    // the flash belongs to third-set only
    expect(h.querySelector('[data-testid="hardway-flash"]')).toBeNull();
    // no confetti / photo tape on the beat — both already live on results
    expect(h.querySelector('[data-testid="recapfx-photofinish"]')).toBeNull();
    expect(h.querySelector('[data-testid="recapfx-confetti"]')).toBeNull();
  }, 300000);

  it('shotOut LOSS (we got shot): only OUR finale card', () => {
    vi.useFakeTimers();
    const run = findGame(0, new Set([2, 3]), 'shotOut');
    expect(run, 'a shotOut game for the viewer').not.toBeNull();
    const h = walkToDecided(run!);
    expectNoFurniture(h);
    const card = h.querySelector('[data-testid="recap-side-0"]')!;
    expect(card).not.toBeNull();
    expect(card.querySelector('[data-testid="recap-setanim-0"]')?.getAttribute('data-tier')).toBe('finale');
    expect(card.querySelector('[data-testid="recap-finale-headline-0"]')?.textContent).toContain('SHOT BACK 2 BACK');
    expect(h.querySelector('[data-testid="recap-side-1"]')).toBeNull();
  }, 300000);

  it('both sides shot out: BOTH finale cards play the beat together', () => {
    vi.useFakeTimers();
    const run = findBothShotOut();
    expect(run, 'a game where both sides are shot out').not.toBeNull();
    const h = walkToDecided(run!, recEl);
    expectNoFurniture(h);
    for (const side of [0, 1]) {
      const card = h.querySelector(`[data-testid="recap-side-${side}"]`)!;
      expect(card, `finale card for side ${side}`).not.toBeNull();
      const cover = card.querySelector(`[data-testid="recap-setanim-${side}"]`)!;
      expect(cover.getAttribute('data-anim')).toBe('rec-center');
      expect(cover.getAttribute('data-tier')).toBe('finale');
    }
  }, 300000);

  it('third-set WIN: the flash leads, the finale rides its 2300ms delay, headline holds', () => {
    vi.useFakeTimers();
    const run = findGame(1, new Set([2, 4, 5]), 'third-set');
    expect(run, 'a third-set game for the opponents').not.toBeNull();
    const h = walkToDecided(run!);
    expectNoFurniture(h);
    expect(h.querySelector('[data-testid="hardway-flash"]'), 'the 3 THE HARD WAY flash').not.toBeNull();
    const card = h.querySelector('[data-testid="recap-side-1"]')!;
    expect(card).not.toBeNull();
    const cover = card.querySelector('[data-testid="recap-setanim-1"]')!;
    expect(cover.getAttribute('data-tier')).toBe('finale');
    expect((cover as HTMLElement).style.getPropertyValue('--sc-delay')).toBe('2300ms');
    expect(card.querySelector('[data-testid="recap-finale-headline-1"]')?.textContent).toContain('3 THE HARD WAY');
    expect(h.querySelector('[data-testid="recap-side-0"]')).toBeNull();
  }, 300000);
});

/* ---------- the advance: timed by the show itself, tappable, never gated ---------- */

describe('the beat’s advance', () => {
  it('the beat math is the show’s own: cover window + hold, flash delay only for third-set', () => {
    expect(FINALE_FLASH_DELAY_MS).toBe(2300); // the pre-existing third-set finale delay
    expect(ENDING_BEAT_COVER_MS).toBe(5000); // ≥ the longest finale cover (rooftop 4.7s)
    expect(ENDING_BEAT_HOLD_MS).toBe(1000);
    expect(endingBeatMs(false)).toBe(6000);
    expect(endingBeatMs(true)).toBe(8300);
  });

  it('shotOut: results arrive on their own when the show completes — no press', () => {
    vi.useFakeTimers();
    const run = findGame(1, new Set([2, 3]), 'shotOut');
    expect(run).not.toBeNull();
    const onReady = vi.fn();
    mountDecided(run!, onReady);
    // the presented gate lifts at 350ms; the beat clock starts there.
    // (Stepped at the gate boundary: in a browser the render that lifts
    // the gate interleaves with the clock; one giant fake-timer leap
    // would start the beat clock at the leap's end instead.)
    act(() => { vi.advanceTimersByTime(349); });
    expect(onReady).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); }); // presented
    fireIO();
    act(() => { vi.advanceTimersByTime(endingBeatMs(false) - 1); });
    expect(onReady).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onReady).toHaveBeenCalledTimes(1);
    // and never twice, however long the surface sits
    act(() => { vi.advanceTimersByTime(60000); });
    expect(onReady).toHaveBeenCalledTimes(1);
  }, 300000);

  it('third-set: the flash delay is inside the beat — no early cut', () => {
    vi.useFakeTimers();
    const run = findGame(1, new Set([2, 4, 5]), 'third-set');
    expect(run).not.toBeNull();
    const onReady = vi.fn();
    mountDecided(run!, onReady);
    act(() => { vi.advanceTimersByTime(350); }); // presented; the beat clock starts
    act(() => { vi.advanceTimersByTime(endingBeatMs(false)); });
    expect(onReady).not.toHaveBeenCalled(); // a shotOut-length beat would have cut by now
    act(() => { vi.advanceTimersByTime(FINALE_FLASH_DELAY_MS - 1); });
    expect(onReady).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(onReady).toHaveBeenCalledTimes(1);
  }, 300000);

  it('a tap on the backdrop clears the beat sooner — exactly once', () => {
    vi.useFakeTimers();
    const run = findGame(1, new Set([2, 3]), 'shotOut');
    expect(run).not.toBeNull();
    const onReady = vi.fn();
    const h = mountDecided(run!, onReady);
    act(() => { vi.advanceTimersByTime(400); }); // presented, show underway
    expect(onReady).not.toHaveBeenCalled();
    const backdrop = h.querySelector('[data-testid="table-talk"]')!;
    act(() => { backdrop.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, cancelable: true })); });
    expect(onReady).toHaveBeenCalledTimes(1);
    act(() => { vi.advanceTimersByTime(60000); }); // the timer must not fire a second advance
    expect(onReady).toHaveBeenCalledTimes(1);
  }, 300000);

  it('a mid-hand recap never auto-advances — its Continue button is the only way through', () => {
    vi.useFakeTimers();
    const run = findGame(1, new Set([2, 3]), 'shotOut');
    expect(run).not.toBeNull();
    const onReady = vi.fn();
    clearTeamHoles();
    mount(barberEl(run!.states[0]!, onReady));
    act(() => { vi.advanceTimersByTime(120000); });
    expect(onReady).not.toHaveBeenCalled();
  }, 300000);
});

/* ---------- what did NOT change ---------- */

describe('the flows Option C leaves alone', () => {
  it('a mid-hand recap renders its full furniture, byte for byte the old surface', () => {
    const run = findGame(1, new Set([2, 3]), 'shotOut');
    expect(run).not.toBeNull();
    const html = renderToStaticMarkup(barberEl(run!.states[0]!));
    expect(html).toContain('data-testid="recap-top-scores"');
    expect(html).toContain('data-testid="talk-ready"');
    expect(html).toContain('Continue to hand');
    expect(html).toContain('data-showcase="no"');
    expect(html).not.toContain('ending-showcase');
  }, 300000);

  it('a decided TARGET ending is not a showcase — the component keeps its decided recap (Table never routes one here)', () => {
    const run = findGame(1, new Set([2, 3]), 'shotOut');
    expect(run).not.toBeNull();
    const targetFinal: GameState = {
      ...run!.final,
      result: { ...run!.final.result!, endReason: 'target', shotOut: [] },
    };
    const html = renderToStaticMarkup(barberEl(targetFinal));
    expect(html).not.toContain('ending-showcase');
    expect(html).toContain('See final results');
  }, 300000);
});