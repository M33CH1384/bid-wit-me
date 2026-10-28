/**
 * @vitest-environment happy-dom
 *
 * Finale headline (owner, 2026-10-21, from Barbershop play): "When shot
 * twice at the barbershop I don't get the white sheet that slides in —
 * it's not giving 'I lost the game' — doesn't convey any real message by
 * itself."
 *
 * Diagnosis these tests pin against: the firing chain itself was sound —
 * engine shotOut result → shotCovers sheet → Table's decided-recap hold →
 * Intermission → the stop's finale SetCover — which is why everything here
 * drives the REAL engine to the ending and mounts the REAL recap sequence
 * (each hand's recap in turn, unmounting between, the shotMarks store
 * persisting exactly as it does in Table). Direct-render tests of a
 * fabricated decided state are what let the third-set routing gap ship;
 * they are not sufficient evidence for this chain.
 *
 * What was actually wrong: the finale's end state carried no words. A
 * fresh Barbershop finale ends as a draped cape and one tilted 25px word
 * (CLOSED); the fresh end state doesn't even carry the animation's name
 * tag (static/reduced only). The fix is the headline layer: words keyed
 * to the ending fact (finaleHeadlineFor), rendered in every mode as part
 * of the end state, plus a bounded wait so a finale cover can never be
 * starved by its in-view gate.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { act } from 'react';
import { type GameState, applyAction, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction, STORY_STOPS } from '@spades/bots';
import { Intermission } from '../src/Intermission';
import { SetCover } from '../src/animfx/SetCover';
import { finaleHeadlineFor } from '../src/setAnims';
import { storyRulesFor } from '../src/story/storySettings';
import { normalizeSettings } from '../src/settings';
import { clearTeamHoles } from '../src/shotMarks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type IOCallback = (entries: { isIntersecting: boolean }[]) => void;
let ioCallbacks: IOCallback[] = [];
let ioReports = true;
class FakeIO {
  constructor(cb: IOCallback) { ioCallbacks.push(cb); }
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIO;
function fireIO() { act(() => { if (ioReports) for (const cb of ioCallbacks) cb([{ isIntersecting: true }]); }); }

const stop = STORY_STOPS.find((s) => s.id === 'barbershop')!;
const rules = storyRulesFor(stop, normalizeSettings({}));
const NAMES = ['You', 'Mr. Coleman', 'Dee', 'June'];

/**
 * Drive a real Barbershop game (real engine, real bots) in which `rigSide`
 * is set on the hands in `rigHands` — its seats overbid to 9 a man while
 * every card is still played by the bots — until the game ends with
 * `endReason`. Returns every handOver state (for the recap walk) and the
 * final decided state.
 */
function playRigged(seed: string, rigSide: 0 | 1, rigHands: ReadonlySet<number>, endReason: string): { states: GameState[]; final: GameState } | null {
  let st = newGame(rules, seed);
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

/**
 * A game that ends on the very first hand: the books hand bids itself, so
 * no bid rigging applies — the skill skew alone (rig side novice, the
 * other pro) decides who falls short of the first-hand minimum of 4.
 * Plays only until hand 1 scores, so the seed scan stays cheap.
 */
function playHand1(seed: string, rigSide: 0 | 1): GameState | null {
  let st = newGame(rules, seed);
  for (let g = 0; g < 500 && st.phase !== 'gameOver'; g++) {
    if (st.phase === 'handOver') return null; // hand 1 scored and the game went on
    const t = pendingTurn(st);
    if (!t) return null;
    const rigged = rigSide === 0 ? t.seat === 0 || t.seat === 2 : t.seat === 1 || t.seat === 3;
    const a = chooseBotAction(viewFor(st, t.seat), rigged ? 'novice' : 'pro');
    if (!a) return null;
    st = applyAction(st, a);
  }
  if (st.phase !== 'gameOver' || st.history.length !== 1) return null;
  if (st.result?.endReason !== 'shotOut' || !st.result.shotOut?.includes(rigSide)) return null;
  return st;
}

function findHand1ShotOut(rigSide: 0 | 1): { states: GameState[]; final: GameState } | null {
  for (let i = 0; i < 300; i++) {
    const final = playHand1(`finale-headline-hand1-${rigSide}-${i}`, rigSide);
    if (final) return { states: [], final };
  }
  return null;
}

const recapEl = (st: GameState) => createElement(Intermission, {
  st, names: NAMES, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
  onReady: () => {}, onScorePad: () => {}, onChat: () => {}, onLeave: () => {},
  setAnimCtx: { storyStopId: 'barbershop', venueId: 'barbershop', setting: 'auto' },
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(st: GameState) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(recapEl(st)));
  return host;
}
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
}
afterEach(() => { unmount(); ioCallbacks = []; ioReports = true; vi.useRealTimers(); });

/** Walk the game's earlier recaps like Table does, then mount the decided
 *  one and lift its gates (entrance + in-view). Returns the decided DOM. */
function walkToDecided(run: { states: GameState[]; final: GameState }) {
  clearTeamHoles(); // once, as at game start — Table never clears mid-game
  for (const st of run.states) {
    mount(st);
    act(() => { vi.advanceTimersByTime(600); });
    fireIO();
    unmount();
    ioCallbacks = [];
  }
  const h = mount(run.final);
  act(() => { vi.advanceTimersByTime(600); });
  fireIO();
  act(() => { vi.advanceTimersByTime(50); });
  return h;
}

describe('the headline copy: keyed to the ending fact, correct from both seats', () => {
  it('shotOut names the losing side and closes the game', () => {
    expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'You & Dee', mine: true }))
      .toEqual({ headline: 'SHOT OUT', sub: 'Shot with the game on the line — game over.' });
    expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'Mr. Coleman & June', mine: false }))
      .toEqual({ headline: 'SHOT OUT', sub: 'Mr. Coleman & June got shot — game over.' });
  });
  it('shotOut on hand 1 reads as a first-hand ending, not a game-on-the-line one (owner, 2026-10-23)', () => {
    expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'You & Dee', mine: true, handNo: 1 }))
      .toEqual({ headline: '1ST ROUND TKO', sub: 'Set on the very first hand — over before it ever got started.' });
    expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'Mr. Coleman & June', mine: false, handNo: 1 }))
      .toEqual({ headline: '1ST ROUND TKO', sub: 'Mr. Coleman & June got shot on the first hand — game over.' });
  });
  it('the ending names ride the path fact (owner, 2026-10-28): back-to-back is SHOT BACK 2 BACK, sticky keeps SHOT OUT', () => {
    for (const handNo of [2, 3, 9]) {
      expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'You & Dee', mine: true, handNo, shotPath: 'back-to-back' }))
        .toEqual({ headline: 'SHOT BACK 2 BACK', sub: 'Shot with the game on the line — game over.' });
      expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'Mr. Coleman & June', mine: false, handNo, shotPath: 'back-to-back' }))
        .toEqual({ headline: 'SHOT BACK 2 BACK', sub: 'Mr. Coleman & June got shot — game over.' });
      expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'You & Dee', mine: true, handNo, shotPath: 'sticky' }))
        .toEqual({ headline: 'SHOT OUT', sub: 'Shot with the game on the line — game over.' });
      expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'Mr. Coleman & June', mine: false, handNo, shotPath: 'sticky' }))
        .toEqual({ headline: 'SHOT OUT', sub: 'Mr. Coleman & June got shot — game over.' });
    }
    expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'You & Dee', mine: true, handNo: 1, shotPath: 'first-hand' }))
      .toEqual({ headline: '1ST ROUND TKO', sub: 'Set on the very first hand — over before it ever got started.' });
  });
  it('shotOut on any later hand keeps the game-on-the-line copy byte-for-byte', () => {
    for (const handNo of [2, 3, 9]) {
      expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'You & Dee', mine: true, handNo }))
        .toEqual({ headline: 'SHOT OUT', sub: 'Shot with the game on the line — game over.' });
      expect(finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'Mr. Coleman & June', mine: false, handNo }))
        .toEqual({ headline: 'SHOT OUT', sub: 'Mr. Coleman & June got shot — game over.' });
    }
  });
  it('the hand fact never leaks into the other endings', () => {
    expect(finaleHeadlineFor({ endReason: 'third-set', decided: true, sideName: 'You & Dee', mine: true, handNo: 1 }))
      .toEqual({ headline: '3 THE HARD WAY', sub: 'Your third set of the game — game over.' });
    expect(finaleHeadlineFor({ endReason: 'shotOut', decided: false, sideName: 'Sven', mine: false, handNo: 1 }))
      .toEqual({ headline: 'OUT', sub: 'Sven is out of the game.' });
  });
  it('third-set carries the rule’s own callout and the side’s third set', () => {
    expect(finaleHeadlineFor({ endReason: 'third-set', decided: true, sideName: 'You & Dee', mine: true }))
      .toEqual({ headline: '3 THE HARD WAY', sub: 'Your third set of the game — game over.' });
    expect(finaleHeadlineFor({ endReason: 'third-set', decided: true, sideName: 'Mr. Coleman & June', mine: false }))
      .toEqual({ headline: '3 THE HARD WAY', sub: 'Mr. Coleman & June’s third set — game over.' });
  });
  it('a mid-game sheet (Cutthroat elimination) says OUT, not a match result', () => {
    expect(finaleHeadlineFor({ endReason: undefined, decided: false, sideName: 'Sven', mine: false }))
      .toEqual({ headline: 'OUT', sub: 'Sven is out of the game.' });
    expect(finaleHeadlineFor({ endReason: undefined, decided: false, sideName: 'You', mine: true }))
      .toEqual({ headline: 'OUT', sub: 'You’re out of the game.' });
  });
});

describe('the headline in the cover itself (SSR pins)', () => {
  const hl = finaleHeadlineFor({ endReason: 'shotOut', decided: true, sideName: 'You & Dee', mine: true });
  it('renders in the end state: static and reduced carry it without any animation', () => {
    for (const props of [{ mode: 'static' as const, reduced: false }, { mode: 'fresh' as const, reduced: true }]) {
      const html = renderToStaticMarkup(createElement(SetCover, { animId: 'barbershop', tier: 'finale', side: 0, finaleHeadline: hl, ...props }));
      expect(html).toContain('data-testid="recap-finale-headline-0"');
      expect(html).toContain('SHOT OUT');
      expect(html).toContain('game over.');
    }
  });
  it('never renders on a regular tier, and never without a headline', () => {
    const reg = renderToStaticMarkup(createElement(SetCover, { animId: 'barbershop', tier: 'regular', mode: 'fresh', reduced: false, side: 0, finaleHeadline: hl }));
    expect(reg).not.toContain('recap-finale-headline');
    const bare = renderToStaticMarkup(createElement(SetCover, { animId: 'barbershop', tier: 'finale', mode: 'static', reduced: false, side: 0 }));
    expect(bare).not.toContain('recap-finale-headline');
  });
});

describe('through the real story flow: a Barbershop game ending in shotOut', () => {
  it('viewer shot twice (consecutive sets): decided recap + finale cover + SHOT BACK 2 BACK headline on his card', () => {
    vi.useFakeTimers();
    const run = findGame(0, new Set([2, 3]), 'shotOut');
    expect(run, 'a consecutive-set shotOut game for the viewer').not.toBeNull();
    const h = walkToDecided(run!);
    const cover = h.querySelector('[data-testid="recap-setanim-0"]');
    expect(cover?.getAttribute('data-anim')).toBe('barbershop');
    expect(cover?.getAttribute('data-tier')).toBe('finale');
    expect(cover?.getAttribute('data-mode')).toBe('fresh');
    expect(cover?.getAttribute('data-wait')).toBeNull(); // gates lifted — it played
    const headline = h.querySelector('[data-testid="recap-finale-headline-0"]');
    expect(headline?.textContent).toContain('SHOT BACK 2 BACK');
    expect(headline?.textContent).toContain('game over.');
    // the winners' card carries no finale and no headline
    expect(h.querySelector('[data-testid="recap-setanim-1"]')).toBeNull();
    expect(h.querySelector('[data-testid="recap-finale-headline-1"]')).toBeNull();
  }, 300000);

  it('mirror: Coleman & June shot out — the headline names THEM on their card', () => {
    vi.useFakeTimers();
    const run = findGame(1, new Set([2, 3]), 'shotOut');
    expect(run, 'a consecutive-set shotOut game for the opponents').not.toBeNull();
    const h = walkToDecided(run!);
    const cover = h.querySelector('[data-testid="recap-setanim-1"]');
    expect(cover?.getAttribute('data-tier')).toBe('finale');
    const headline = h.querySelector('[data-testid="recap-finale-headline-1"]');
    expect(headline?.textContent).toContain('SHOT BACK 2 BACK');
    expect(headline?.textContent).toContain('got shot — game over.');
    expect(headline?.textContent).toContain('Coleman');
    expect(h.querySelector('[data-testid="recap-finale-headline-0"]')).toBeNull();
  }, 300000);

  it('third set (sets on 2, 4, 5 — the rule’s precedence over shotOut): the card keeps 3 THE HARD WAY after the flash', () => {
    vi.useFakeTimers();
    const run = findGame(0, new Set([2, 4, 5]), 'third-set');
    expect(run, 'a third-set game for the viewer').not.toBeNull();
    const h = walkToDecided(run!);
    expect(h.querySelector('[data-testid="hardway-flash"]')).not.toBeNull(); // the flash still leads
    const cover = h.querySelector('[data-testid="recap-setanim-0"]');
    expect(cover?.getAttribute('data-tier')).toBe('finale');
    const headline = h.querySelector('[data-testid="recap-finale-headline-0"]');
    expect(headline?.textContent).toContain('3 THE HARD WAY');
    expect(headline?.textContent).toContain('third set');
    expect(headline?.textContent).toContain('game over.');
  }, 300000);
});

describe('through the real story flow: a Barbershop game shot out on HAND 1 (owner, 2026-10-23)', () => {
  it('viewer set on the books hand: the cover says first hand, never game on the line', () => {
    vi.useFakeTimers();
    const run = findHand1ShotOut(0);
    expect(run, 'a hand-1 shotOut game for the viewer').not.toBeNull();
    const h = walkToDecided(run!);
    const cover = h.querySelector('[data-testid="recap-setanim-0"]');
    expect(cover?.getAttribute('data-anim')).toBe('barbershop');
    expect(cover?.getAttribute('data-tier')).toBe('finale');
    const headline = h.querySelector('[data-testid="recap-finale-headline-0"]');
    expect(headline?.textContent).toContain('1ST ROUND TKO');
    expect(headline?.textContent).toContain('Set on the very first hand — over before it ever got started.');
    expect(headline?.textContent).not.toContain('game on the line');
    // the card's own time-of-death tag agrees: it all happened on hand 1
    expect(h.querySelector('[data-testid="time-of-death"]')?.textContent).toContain('Hand 1');
    expect(h.querySelector('[data-testid="recap-finale-headline-1"]')).toBeNull();
  }, 300000);

  it('mirror: Coleman & June shot on hand 1 — their card says first hand too', () => {
    vi.useFakeTimers();
    const run = findHand1ShotOut(1);
    expect(run, 'a hand-1 shotOut game for the opponents').not.toBeNull();
    const h = walkToDecided(run!);
    const headline = h.querySelector('[data-testid="recap-finale-headline-1"]');
    expect(headline?.textContent).toContain('1ST ROUND TKO');
    expect(headline?.textContent).toContain('Coleman');
    expect(headline?.textContent).toContain('got shot on the first hand — game over.');
    expect(headline?.textContent).not.toContain('game on the line');
    expect(h.querySelector('[data-testid="recap-finale-headline-0"]')).toBeNull();
  }, 300000);
});

describe('the bounded wait: a finale can never be gate-starved', () => {
  it('lifts the in-view wait on the fallback when the observer never reports; a regular cover keeps waiting', () => {
    vi.useFakeTimers();
    ioReports = false; // the observer exists but never calls back
    const run = findGame(0, new Set([2, 3]), 'shotOut');
    expect(run).not.toBeNull();
    clearTeamHoles();
    // the hand-2 recap first (regular tier for the viewer's first set)
    const h2 = mount(run!.states.at(-1)!);
    act(() => { vi.advanceTimersByTime(600); });
    const reg = h2.querySelector('[data-testid="recap-setanim-0"]');
    expect(reg?.getAttribute('data-tier')).toBe('regular');
    expect(reg?.getAttribute('data-wait')).toBe('yes'); // still waiting — no fallback on regulars
    unmount();
    ioCallbacks = [];
    // the decided recap: finale waits, then the fallback lifts it
    const h = mount(run!.final);
    const cover = () => h.querySelector('[data-testid="recap-setanim-0"]');
    expect(cover()?.getAttribute('data-wait')).toBe('yes');
    act(() => { vi.advanceTimersByTime(2600); });
    expect(cover()?.getAttribute('data-wait')).toBeNull();
    // and the headline is in the end state regardless of how the cover started
    expect(h.querySelector('[data-testid="recap-finale-headline-0"]')?.textContent).toContain('SHOT BACK 2 BACK');
  }, 300000);
});
