/**
 * @vitest-environment happy-dom
 *
 * VICTORY PRESENTATION GATES (owner report, 2026-10-28: "when this
 * screen loads in landscape I never get to see the animation").
 *
 * The defect, pinned so it cannot come back: the victory celebration's
 * clock used to start on the RESULT STATE's arrival, not on the result
 * surface's presentation. AnimFxLayer fired Victory Confetti (2.3 s)
 * and the Photo Finish tape (3 s) the moment `st.result` landed — but
 * the result state lands while the finished trick is still in its hold
 * (finishedTrickHoldMs: 1,150 ms plain, TRICK_HOLD + up to 4,000 ms of
 * nuke allowance, ~5.35 s for a Run-It ending), and no result surface
 * may present until that hold releases (scoreOpened / showResults /
 * showRecap all require !pause). The whole celebration elapsed over
 * the table before the sheet existed. The /rewards screen compounded
 * it: it had no confetti at all, and its reveal gate (mount + two
 * frames) spent the rows' count-ups while the rows sat BELOW THE FOLD
 * of the short landscape viewport (the card is ~600 px tall there,
 * the Postgame Report ahead of the rows) — scrolling down found only
 * final numbers. Portrait fits the card whole, which is why only
 * landscape lost the show.
 *
 * The fix these tests pin:
 *  - the celebration lives on the PRESENTING surfaces (the decided
 *    Intermission recap, Table's game-over modal / victory screen,
 *    /rewards), gated on their presented states — here, Intermission's
 *    `presented` flip and the rewards reveal gate;
 *  - the AnimFx layer no longer fires confetti/photo-finish shots on
 *    the result transition at all;
 *  - the rewards rows hold for an IN-VIEW gate on top of the reveal
 *    gate (the set covers' sc-wait discipline), so in landscape they
 *    play when the player actually reaches them;
 *  - a tap clears the celebration early; losers get no rain.
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type GameState, type PlayerView, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission } from '../src/Intermission';
import AnimFxLayer from '../src/animfx/AnimFxLayer';
import GameOverRewards, { computeRewards, type RewardsData, type RewardsProfile } from '../src/GameOverRewards';
import { fx } from '../src/fx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------ fixtures */

const NAMES = ['You', 'Hana', 'Mei', 'Jamal'];

/** Play a bot game to the first handOver, then stamp a decided result
 *  on it: side 0 wins 505–500 — a 5-point margin, inside the
 *  photo-finish band (≤10), with the real final scores on the result. */
function decidedState(): GameState {
  const rules = makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, 'victory-presented');
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return {
    ...st,
    phase: 'gameOver',
    result: { endReason: 'target', finalScores: [505, 500], placements: [1, 2], winners: [0] },
  };
}

/* ------------------------------------------------------- raf + mounting */

let rafQ: { id: number; cb: FrameRequestCallback }[] = [];
let rafSeq = 0;

function pumpFrame(ts: number) {
  const q = rafQ;
  rafQ = [];
  act(() => { for (const f of q) f.cb(ts); });
}

let container: HTMLDivElement;
let root: Root;

function mountEl(el: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(el); });
}

beforeEach(() => {
  rafQ = [];
  rafSeq = 0;
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++rafSeq;
    rafQ.push({ id, cb });
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { rafQ = rafQ.filter((f) => f.id !== id); });
});

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  fx.setReduce(false);
});

const confetti = () => container.querySelector('[data-testid="recapfx-confetti"]');
const tape = () => container.querySelector('[data-testid="recapfx-photofinish"]');

/* -------------------------------------------------- Intermission gate */

describe('decided recap: the celebration is gated on presented', () => {
  const recapEl = (st: GameState, mySide = 0) => createElement(Intermission, {
    st, names: NAMES, mySide, secs: null, online: false, unread: 0, chatOpen: false,
    onReady: () => undefined, onScorePad: () => undefined, onChat: () => undefined,
    setAnimCtx: { storyStopId: null, venueId: 'grandma', setting: 'auto' },
  });

  it('nothing fires at mount; confetti + tape arrive with the presented flip', () => {
    mountEl(recapEl(decidedState()));
    // the result is already in the state at mount — the old layer fired
    // here. The presenting surface must not.
    expect(confetti()).toBeNull();
    expect(tape()).toBeNull();
    act(() => { vi.advanceTimersByTime(349); });
    expect(confetti()).toBeNull();
    act(() => { vi.advanceTimersByTime(1); }); // the 350 ms presented flip
    expect(confetti()).not.toBeNull();
    expect(tape()).not.toBeNull();
    // the tape is the in-recap variant, riding the sheet (visible band)
    expect(tape()!.classList.contains('in-recap')).toBe(true);
    // and it prints the REAL final scores from the result
    expect(tape()!.textContent).toContain('505');
    expect(tape()!.textContent).toContain('500');
  });

  it('a tap on the backdrop clears the celebration early', () => {
    mountEl(recapEl(decidedState()));
    act(() => { vi.advanceTimersByTime(350); });
    expect(confetti()).not.toBeNull();
    const backdrop = container.querySelector('[data-testid="table-talk"]')!;
    act(() => {
      backdrop.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(confetti()).toBeNull();
    expect(tape()).toBeNull();
  });

  it('losers get no rain (the tape still prints the finish)', () => {
    mountEl(recapEl(decidedState(), 1));
    act(() => { vi.advanceTimersByTime(350); });
    expect(confetti()).toBeNull();
    expect(tape()).not.toBeNull();
  });

  it('a plain hand recap (not decided) never celebrates', () => {
    const st = decidedState();
    mountEl(recapEl({ ...st, phase: 'handOver', result: null }));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(confetti()).toBeNull();
    expect(tape()).toBeNull();
  });
});

/* ---------------------------------------------------- the layer itself */

describe('AnimFxLayer: no celebration shots on the result transition', () => {
  it('a result landing in the state fires neither confetti nor photo finish', () => {
    const rules = makeRules('joker');
    const view = (o: Partial<PlayerView> = {}): PlayerView => ({
      seat: 0, rules, phase: 'playing', handNo: 1, dealer: 0, turn: 1,
      hand: null, handCounts: [13, 13, 13, 13], bids: [4, 4, 4, 4], revealed: [true, true, true, true],
      exchange: [], trick: { leader: 0, plays: [], winner: null }, tricks: [], tricksWon: [0, 0, 0, 0],
      spadesBroken: false, scores: [0, 0], bags: [0, 0], history: [], result: null,
      failStreak: [], eliminated: [false, false, false, false], bidOptions: null, legal: [],
      ...o,
    } as PlayerView);
    mountEl(createElement(AnimFxLayer, { st: view() }));
    const result = { endReason: 'target', finalScores: [505, 500], placements: [1, 2], winners: [0] } as PlayerView['result'];
    act(() => { root.render(createElement(AnimFxLayer, { st: view({ phase: 'gameOver', result }) })); });
    // photo-finish margin AND a viewer win: the old layer fired both here
    expect(container.querySelector('[data-testid="animfx-confetti"]')).toBeNull();
    expect(container.querySelector('[data-testid="animfx-photofinish"]')).toBeNull();
    expect(confetti()).toBeNull();
    expect(tape()).toBeNull();
  });
});

/* ------------------------------------------------------- rewards screen */

function profile(over: Partial<RewardsProfile> = {}): RewardsProfile {
  return {
    level: { level: 8, xp: 1000, title: 'Prospect', xpForNext: 300, xpIntoLevel: 83 },
    coins: { balance: 1250 },
    rank: { team: { elo: 1000 }, cutthroat: { elo: 1000 } },
    achievements: [],
    challenges: { daily: [], weekly: [] },
    ...over,
  };
}

function rewardsData(): RewardsData {
  const after = profile({
    level: { level: 8, xp: 1050, title: 'Prospect', xpForNext: 300, xpIntoLevel: 133 },
    coins: { balance: 1400 },
    rank: { team: { elo: 1012 }, cutthroat: { elo: 1000 } },
  });
  return computeRewards(profile(), after, { won: true, headline: 'VICTORY!', sub: '5 hands played', kind: 'team' });
}

const xpNum = () => [...container.querySelectorAll('.rw-row .rw-num')].map((n) => n.textContent ?? '');

/** Stub the rows' viewport geometry: `top` is the rows' rect top. */
function stubRowsTop(top: number) {
  const orig = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const r = orig.call(this);
    if (this.classList?.contains('rw-rows')) return { ...r, top, bottom: top + 200, y: top, height: 200 } as DOMRect;
    return r;
  });
  Object.defineProperty(window, 'innerHeight', { value: 390, configurable: true });
}

function mountRewards(data: RewardsData) {
  mountEl(createElement(GameOverRewards, {
    data,
    onHome: () => undefined,
    onRematch: () => undefined,
    onProfile: () => undefined,
    onOpenTables: () => undefined,
  }));
}

/** Open the reveal gate (the two painted frames useRewardsReveal waits for). */
function openGate() {
  pumpFrame(0);
  pumpFrame(16);
  expect(container.querySelector('.rewards-page')!.classList.contains('rw-play')).toBe(true);
}

function finishTweens() {
  act(() => { vi.advanceTimersByTime(2000); });
  let ts = 100;
  for (let i = 0; i < 14; i++) { pumpFrame(ts); ts += 100; }
}

describe('rewards screen: celebration + the landscape in-view row gate', () => {
  it('a win rains confetti once the page is presented; a tap clears it', () => {
    stubRowsTop(100); // portrait geometry: rows in view
    mountRewards(rewardsData());
    expect(confetti()).toBeNull(); // not at mount
    openGate();
    expect(confetti()).not.toBeNull();
    const page = container.querySelector('.rewards-page')!;
    act(() => { page.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true })); });
    expect(confetti()).toBeNull();
  });

  it('a loss gets no confetti', () => {
    stubRowsTop(100);
    const d = rewardsData();
    mountRewards({ ...d, won: false, headline: 'GAME OVER' });
    openGate();
    expect(confetti()).toBeNull();
  });

  it('LANDSCAPE: rows below the fold hold their count-ups until scrolled into view', () => {
    stubRowsTop(720); // rows start 720px down a 390px-tall viewport
    mountRewards(rewardsData());
    openGate();
    finishTweens();
    // the reveal gate opened and time ran — but the rows never entered
    // the viewport, so their show has NOT been spent
    expect(container.querySelector('.rewards-page')!.classList.contains('rw-rows-play')).toBe(false);
    expect(xpNum()).toEqual(['+0', '+0', '▲ 0']);
    // the player scrolls: the rows reach the viewport and play, in view
    stubRowsTop(120);
    act(() => { window.dispatchEvent(new window.Event('scroll')); });
    expect(container.querySelector('.rewards-page')!.classList.contains('rw-rows-play')).toBe(true);
    finishTweens();
    expect(xpNum()).toEqual(['+50', '+150', '▲ 12']);
  });

  it('PORTRAIT control: rows in view at load play with the reveal, as before', () => {
    stubRowsTop(100);
    mountRewards(rewardsData());
    openGate();
    expect(container.querySelector('.rewards-page')!.classList.contains('rw-rows-play')).toBe(true);
    finishTweens();
    expect(xpNum()).toEqual(['+50', '+150', '▲ 12']);
  });
});
