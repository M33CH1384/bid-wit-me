/**
 * @vitest-environment happy-dom
 *
 * Recap presentation gates — the DOM timing half (see
 * recap-present.test.ts for the full story and the CSS/SSR pins).
 *
 * A fresh set cover must not start before the recap is actually
 * presented: the backdrop flips to `presented` only when its fade-up
 * entrance completes (~350ms), and each cover separately waits
 * (`.sc-wait` / `data-wait`) until its own card is observed in view.
 * Both holds are independent — the animation runs only when both have
 * lifted — and a card that never enters view means the animation has
 * not played (it plays on arrival instead of in secret).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { type GameState, applyAction, makeRules, newGame, pendingTurn, viewFor } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import { Intermission } from '../src/Intermission';
import { clearTeamHoles } from '../src/shotMarks';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* fixtures (same construction as set-anims.test.ts) */
function toHandOver(): GameState {
  const rules = makeRules('joker', { targetScore: 500 });
  let st = newGame(rules, 'recap-present-dom');
  for (let g = 0; g < 8000 && st.phase !== 'handOver' && st.phase !== 'gameOver'; g++) {
    const t = pendingTurn(st);
    if (!t) break;
    st = applyAction(st, chooseBotAction(viewFor(st, t.seat), 'pro')!);
  }
  return st;
}

function stamp(st: GameState, sideShots: number[][]): GameState {
  const last = st.history.at(-1)!;
  const history = sideShots.map((shotSides, i) => ({
    ...last,
    handNo: i + 1,
    bids: last.bids.map(() => 4),
    sides: last.sides.map((s) => ({
      ...s,
      contract: 4,
      contractMade: shotSides.includes(s.side) ? false as const : true,
      contractTricks: shotSides.includes(s.side) ? 1 : 4,
    })),
  }));
  return { ...st, rules: { ...st.rules, shotOut: true }, result: null, history, handNo: history.length, phase: 'handOver' };
}

const NAMES = ['You', 'Hana', 'Mei', 'Jamal'];
const recapEl = (st: GameState) => createElement(Intermission, {
  st, names: NAMES, mySide: 0, secs: null, online: false, unread: 0, chatOpen: false,
  onReady: () => {}, onScorePad: () => {}, onChat: () => {},
  setAnimCtx: { storyStopId: 'porch', venueId: 'grandma', setting: 'auto' },
});

type IOCallback = (entries: { isIntersecting: boolean }[]) => void;
let ioCallbacks: IOCallback[] = [];
class FakeIO {
  constructor(cb: IOCallback) { ioCallbacks.push(cb); }
  observe() {}
  unobserve() {}
  disconnect() {}
}

let root: Root | null = null;

function mount(st: GameState) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(recapEl(st)));
  return host;
}

describe('the gates lift: presented (entrance) and in-view', () => {
  beforeEach(() => {
    clearTeamHoles();
    localStorage.clear();
    ioCallbacks = [];
    vi.stubGlobal('IntersectionObserver', FakeIO);
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 401, json: async () => ({}) }));
    vi.useFakeTimers();
  });
  afterEach(() => {
    if (root) act(() => root!.unmount());
    root = null;
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('a fresh cover holds until BOTH the sheet is presented and its card is in view', async () => {
    const el = mount(stamp(toHandOver(), [[], [1]]));
    const cover = el.querySelector('[data-testid="recap-setanim-1"]')!;
    const backdrop = el.querySelector('[data-testid="table-talk"]')!;
    expect(cover).toBeTruthy();
    expect(cover.getAttribute('data-wait')).toBe('yes');
    expect(backdrop.getAttribute('data-presented')).toBe('no');

    // the card enters view BEFORE the entrance completes: the cover lifts
    // its own wait, but the sheet is still unpresented (CSS holds it)
    await act(async () => { for (const cb of ioCallbacks) cb([{ isIntersecting: true }]); });
    expect(cover.getAttribute('data-wait')).toBeNull();
    expect(backdrop.getAttribute('data-presented')).toBe('no');

    // entrance completes (~350ms fade-up): presented flips
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(backdrop.getAttribute('data-presented')).toBe('yes');
    expect(backdrop.className).toContain('presented');
  });

  it('a cover whose card never enters view stays waiting (it has not played)', async () => {
    const el = mount(stamp(toHandOver(), [[], [1]]));
    const cover = el.querySelector('[data-testid="recap-setanim-1"]')!;
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(el.querySelector('[data-testid="table-talk"]')!.getAttribute('data-presented')).toBe('yes');
    expect(cover.getAttribute('data-wait')).toBe('yes');
    // and when it finally does enter view, the wait lifts and it plays
    await act(async () => { for (const cb of ioCallbacks) cb([{ isIntersecting: true }]); });
    expect(cover.getAttribute('data-wait')).toBeNull();
  });
});
