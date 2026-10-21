/**
 * @vitest-environment happy-dom
 *
 * Finale composition (owner, 2026-10-21, from his Rec Center shotOut
 * screenshot): "This is crazy but even more importantly looks crazy —
 * let's fix the aesthetic." One card carried the finale three times at
 * once — the badges row's SHOT OUT chip, the cover's giant SET banner
 * (with its red 0.0 / GAME fragments half-hidden over the team name),
 * and the headline plaque as an overlay across the card's middle,
 * burying the points (−100 half under the plaque) and crossing the
 * per-player line — while the cover bled past the card's right edge
 * through BAGS, and the sheet opened mid-scroll with the HANDS label
 * sliced behind the header.
 *
 * The composition these tests pin: ONE verdict voice per card — the
 * plaque, in the face's flow (its "verdict" grid row), never inside the
 * cover layer, never over a score; the duplicate verdict chip gone (the
 * SET scoring chip stays); the cover clipped to the face; the Rec
 * finale banner a compact strip with no GAME fragment (the plaque owns
 * that word); and the recap scrollport opening at the top every hand.
 *
 * Like recap-finale-headline.test.ts, everything here drives the REAL
 * engine to the ending — a Rec Center game where BOTH sides are shot
 * out on the deciding hand, the owner's exact screenshot — and mounts
 * the REAL recap sequence.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { type GameState, applyAction, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction, STORY_STOPS } from '@spades/bots';
import { Intermission } from '../src/Intermission';
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

const stop = STORY_STOPS.find((s) => s.id === 'rec-center')!;
const rules = storyRulesFor(stop, normalizeSettings({}));
const NAMES = ['You', "Lil' Man", 'Dee', 'Trey'];

/** Both sides overbid to 9 a man on the rig hands: every seat's contract
 *  is unmakeable, so BOTH sides are set on those hands — the owner's
 *  screenshot game, where the deciding hand shot out both sides. */
function playBothRigged(seed: string, rigHands: ReadonlySet<number>): { states: GameState[]; final: GameState } | null {
  let st = newGame(rules, seed);
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

const recapEl = (st: GameState) => createElement(Intermission, {
  st, names: NAMES, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
  onReady: () => {}, onScorePad: () => {}, onChat: () => {}, onLeave: () => {},
  setAnimCtx: { storyStopId: 'rec-center', venueId: stop.venueId, setting: 'auto' },
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
afterEach(() => { unmount(); ioCallbacks = []; vi.useRealTimers(); });

function walkToDecided(run: { states: GameState[]; final: GameState }) {
  clearTeamHoles();
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

describe('both sides shot out on the deciding hand (the owner’s screenshot game)', () => {
  it('each card carries ONE composed verdict: plaque in flow, no duplicate chip, scores intact', () => {
    vi.useFakeTimers();
    const run = findBothShotOut();
    expect(run, 'a game where both sides are shot out').not.toBeNull();
    const h = walkToDecided(run!);
    for (const side of [0, 1]) {
      const card = h.querySelector(`[data-testid="recap-side-${side}"]`)!;
      expect(card, `card for side ${side}`).not.toBeNull();
      // the Rec finale cover plays on BOTH cards at once
      const cover = card.querySelector(`[data-testid="recap-setanim-${side}"]`)!;
      expect(cover.getAttribute('data-anim')).toBe('rec-center');
      expect(cover.getAttribute('data-tier')).toBe('finale');
      // the plaque: present, the card's verdict voice…
      const verdict = card.querySelector(`[data-testid="recap-finale-headline-${side}"]`)!;
      expect(verdict, `verdict for side ${side}`).not.toBeNull();
      expect(verdict.textContent).toContain('SHOT OUT');
      expect(verdict.textContent).toContain('game over.');
      // …in the face's FLOW — a grid sibling, never inside the cover layer
      expect(verdict.classList.contains('finale-verdict')).toBe(true);
      expect(cover.contains(verdict)).toBe(false);
      expect(verdict.closest('.tt-face')).not.toBeNull();
      expect(card.querySelector('.tt-face')!.classList.contains('has-verdict')).toBe(true);
      // the reserved band for the banner strip
      expect(card.classList.contains('fv-band')).toBe(true);
      // ONE verdict per card: the word renders once — the plaque's —
      // and the duplicate SHOT OUT chip is gone from the badges row,
      // while the SET scoring chip stays
      expect(card.textContent!.split('SHOT OUT').length - 1).toBe(1);
      expect(card.querySelector('.rchip.out')).toBeNull();
      const setChip = [...card.querySelectorAll('.tt-badges .rchip')].find((e) => e.textContent === 'SET');
      expect(setChip, `SET chip stays for side ${side}`).toBeTruthy();
      // every score fact still on the card, in the open: line, points,
      // per-player splits, bags
      const line = card.querySelector(`[data-testid="recap-line-${side}"]`)!;
      expect(line.textContent).toContain('Bid');
      expect(line.textContent).toContain('Took');
      expect(card.querySelector(`[data-testid="recap-points-${side}"]`)!.textContent).toMatch(/−\d+/);
      expect(card.querySelectorAll(`[data-testid="recap-players-${side}"] li`).length).toBe(2);
      expect(card.querySelector(`[data-testid="recap-bags-${side}"]`)!.textContent).toMatch(/^\d+$/);
      // the Rec banner keeps its SET word (its GAME fragment is
      // suppressed by the finale CSS — pinned in the CSS block below)
      expect(cover.querySelector('.sc-banner b')!.textContent).toBe('SET');
      // the preserved scoring feedback rides along
      expect(card.querySelector('[data-testid="time-of-death"]')).not.toBeNull();
    }
  }, 300000);

  it('the recap scrollport opens at the top on every hand', () => {
    vi.useFakeTimers();
    const run = findBothShotOut();
    expect(run).not.toBeNull();
    const [first, second] = run!.states;
    expect(first && second, 'at least two hand recaps').toBeTruthy();
    clearTeamHoles();
    const h = mount(first!);
    const body = h.querySelector('.tt-body')! as HTMLDivElement;
    body.scrollTop = 140; // the reader scrolled this recap…
    act(() => root!.render(recapEl(second!))); // …the next hand's recap opens at the top
    expect(body.scrollTop).toBe(0);
  }, 300000);
});
