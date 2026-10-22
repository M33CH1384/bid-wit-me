/**
 * @vitest-environment happy-dom
 *
 * Story outro + intro exits (owner report, 2026-10-21, Rec Center loss):
 * "I have no way to exit the screen if I want to aside from starting the
 * game." The loss outro showed only "Retry this stop" under the scene —
 * the scene's Skip did reach the map, but nothing on the screen SAID so,
 * so the outro read as a trap whose only labeled door was the rematch;
 * the intro was the same trap facing forward (tape → scene → table,
 * every labeled control starting the game).
 *
 * The discipline pinned here:
 *  - Every outro carries a labeled "To the map" exit ON THE SCREEN from
 *    first paint — beside Retry on a loss, beside Run it back on the
 *    King's between-legs moment, and AS the primary on a win (a win
 *    terminates at the map). Visible while the outro scene is still on
 *    its first beat, not gated on the scene finishing.
 *  - The intro carries a "Back to map" exit in BOTH steps (tape and
 *    scene) that posts no result, starts no game, consumes no attempt.
 *  - Result integrity: the result posts exactly once (at game over,
 *    before the outro exists); leaving by the new exits neither re-posts
 *    nor loses it, the finished match leaves no Resume on the map, and a
 *    pending King double survives an exit to the map intact.
 *
 * The harness mirrors story-rematch.test.ts: the real Table is a probe,
 * a finished match is driven through the table's own callbacks, and the
 * fetch stub counts result posts.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY_CHARACTERS, STORY_STOPS, storyStopById, type StoryStop } from '@spades/bots';
import { newGame } from '@spades/rules';
import { DEFAULT_SETTINGS } from '../src/settings';
import { storyRulesFor } from '../src/story/storySettings';
import StoryHome from '../src/story/StoryHome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ProbeProps {
  story?: { onGameOver: (won: boolean, facts: unknown) => void };
  onExit?: () => void;
}
const probe = vi.hoisted(() => ({ props: null as ProbeProps | null }));
vi.mock('../src/Table', async () => {
  const React = await import('react');
  return {
    default: function MockTable(props: ProbeProps & { story?: { scene?: { stop: { id: string } } } }) {
      probe.props = props;
      return React.createElement('div', {
        'data-testid': 'mock-table',
        'data-stop': props.story?.scene?.stop.id ?? '',
      });
    },
  };
});

/* ---- fixtures ---- */

const stopRow = (s: StoryStop, over: Record<string, unknown> = {}) => ({
  stopId: s.id, n: s.n, state: 'locked', attempts: 0, clears: 0, firstClearedAt: null, doublePending: false, ...over,
});
const progressOf = (rows: Map<string, Record<string, unknown>>, currentStop: number | null, completed = false) => ({
  track: 'solo',
  stops: STORY_STOPS.map((s) => stopRow(s, rows.get(s.id))),
  currentStop,
  completed,
  completedAt: completed ? 1 : null,
  completionMark: completed ? 'story-solo-complete' : null,
  finds: { eggs: [], feats: [] },
});

/** Porch current, nothing attempted (the intro tests' world). */
const porchFresh = () => progressOf(new Map([['porch', { state: 'current' }]]), 1);
/** The finished-Porch world: attempts recorded, cleared on a win. */
const porchDone = (won: boolean) => progressOf(new Map([
  ['porch', won ? { state: 'cleared', attempts: 1, clears: 1, firstClearedAt: 1 } : { state: 'current', attempts: 1 }],
  ...(won ? [['barbershop', { state: 'current' }]] as [string, Record<string, unknown>][] : []),
]), won ? 2 : 1);
const porchResult = (won: boolean) => ({
  ok: true, replayed: false, stopId: 'porch', won, firstClear: won,
  rewards: won ? { xp: 25, coins: 20 } : { xp: 5, coins: 0 },
  newFinds: [], ...porchDone(won),
});

/** The King's world: stops 1–10 cleared, the King current. */
const kingWorld = (attempts: number, pending: boolean) => progressOf(new Map([
  ...STORY_STOPS.filter((s) => s.id !== 'king').map((s) => [s.id, { state: 'cleared', attempts: 1, clears: 1, firstClearedAt: 1 }] as [string, Record<string, unknown>]),
  ['king', { state: 'current', attempts, doublePending: pending }],
]), 11);
const kingStartedResult = () => ({
  ok: true, replayed: false, stopId: 'king', won: true, firstClear: false,
  rewards: { xp: 0, coins: 0 }, doubleOutcome: 'started', doublePending: true,
  newFinds: [], ...kingWorld(1, true),
});

/* ---- harness ---- */

let root: Root | null = null;
let el: HTMLDivElement | null = null;
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}
afterEach(() => {
  unmount();
  vi.unstubAllGlobals();
  localStorage.clear();
  history.replaceState(null, '', '/');
});

const settle = async (ms = 25) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const click = async (node: Element) => {
  await act(async () => { (node as HTMLElement).click(); });
  await settle(10);
};
const byTestid = (id: string) => el!.querySelector(`[data-testid="${id}"]`);

function stubSessionStorage() {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  } as Storage;
}

function seedSave(stop: StoryStop, attemptsAtStart: number) {
  const state = newGame(storyRulesFor(stop, { ...DEFAULT_SETTINGS }), 'save-seed');
  const [a, b] = stop.pair.map((id) => STORY_CHARACTERS[id]!.name);
  const save = {
    v: 1,
    savedAt: Date.now(),
    seed: 'save-seed',
    settings: { ...DEFAULT_SETTINGS },
    state,
    chat: [],
    names: ['You', a, 'Dee', b],
    teamNames: [null, `${a} & ${b}`],
    nuke: 'full',
    story: {
      stopId: stop.id,
      track: 'solo',
      attemptsAtStart,
      clearsAtStart: 0,
      session: { fired: [], memory: [], satDown: true, railFired: 0, lastRailHand: 0 },
    },
  };
  localStorage.setItem('bwm.storySave.v1', JSON.stringify(save));
}

/** Mount StoryHome against a fetch stub; before() serves progress until
 *  the result posts, after() from then on. `seed` runs after the storage
 *  wipe, before the render (a saved match must survive into the mount).
 *  Returns the post counter. */
async function mount(before: () => unknown, after: () => unknown, result: () => unknown, seed?: () => void) {
  unmount();
  localStorage.clear();
  seed?.();
  stubSessionStorage();
  history.replaceState(null, '', '/story');
  const counter = { posts: 0 };
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: true, storyAccess: true, unlocks: [] }) };
    if (url.includes('/api/story/result')) { counter.posts += 1; return { ok: true, status: 200, json: async () => result() }; }
    if (url.includes('/api/story/progress')) return { ok: true, status: 200, json: async () => (counter.posts ? after() : before()) };
    throw new Error(`no network in tests: ${url}`);
  });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(StoryHome) as ReactNode); });
  await settle();
  await settle();
  /* co-op mode gate: these suites walk the solo run — pass the gate as a solo player would */
  const gate = el!.querySelector('[data-testid="story-gate-solo"]');
  if (gate) await click(gate);
  return counter;
}

/** Resume the seeded match, finish it through the table callbacks, and
 *  take the host exit into the outro — the owner's exact path. */
async function finishResumed(stop: StoryStop, won: boolean) {
  const resumeBtn = byTestid(`story-resume-${stop.id}`);
  expect(resumeBtn, `map offers Resume for the saved ${stop.id} match`).toBeTruthy();
  await click(resumeBtn!);
  expect(byTestid('mock-table'), 'resumed table mounted').toBeTruthy();
  await act(async () => { probe.props!.story!.onGameOver(won, {}); });
  await settle();
  await act(async () => { probe.props!.onExit!(); });
  await settle(10);
  expect(byTestid('story-script'), 'the outro scene is up').toBeTruthy();
}

/* ---- the outro exits ---- */

describe('story outro exits — a labeled way to the map from first paint', () => {
  it('LOSS: "To the map" stands beside Retry while the scene is still on its first beat — and leaving posts nothing twice', async () => {
    const porch = storyStopById('porch')!;
    const counter = await mount(
      () => progressOf(new Map([['porch', { state: 'current' }]]), 1),
      () => porchDone(false),
      () => porchResult(false),
      () => seedSave(porch, 0),
    );
    await finishResumed(porch, false);
    // mid-scene: the scene player is on its first beat (Next, not the CTA)
    expect(byTestid('story-script-next'), 'outro scene still playing').toBeTruthy();
    const retry = byTestid('story-retry');
    expect(retry, 'Retry this stop').toBeTruthy();
    expect(retry!.textContent).toContain('Retry this stop');
    const exit = byTestid('story-outro-map');
    expect(exit, 'the labeled map exit').toBeTruthy();
    expect(exit!.textContent).toContain('To the map');
    expect(exit!.className).toContain('ghost'); // the quiet secondary beside the primary
    expect(counter.posts).toBe(1); // the result posted at game over, before the outro
    await click(exit!);
    expect(byTestid('story-map'), 'the exit lands on the map').toBeTruthy();
    expect(counter.posts).toBe(1); // leaving re-posts nothing
    expect(byTestid('story-resume-porch'), 'the finished match leaves no Resume behind').toBeNull();
    expect(sessionStorage.getItem('bwm.rewards.v1')).toBeNull(); // and no /rewards detour
  });

  it('WIN: "To the map" is the outro\'s own primary from first paint — no Retry on a win', async () => {
    const porch = storyStopById('porch')!;
    const counter = await mount(
      () => progressOf(new Map([['porch', { state: 'current' }]]), 1),
      () => porchDone(true),
      () => porchResult(true),
      () => seedSave(porch, 0),
    );
    await finishResumed(porch, true);
    expect(byTestid('story-script-next'), 'outro scene still playing').toBeTruthy();
    const exit = byTestid('story-outro-map');
    expect(exit, 'the win\'s map exit').toBeTruthy();
    expect(exit!.textContent).toContain('To the map');
    expect(exit!.className).toContain('primary'); // a win terminates at the map: the exit IS the primary
    expect(byTestid('story-retry'), 'no Retry on a win').toBeNull();
    await click(exit!);
    expect(byTestid('story-map'), 'the exit lands on the map').toBeTruthy();
    expect(counter.posts).toBe(1);
    expect(byTestid('story-stop-porch')!.textContent).toContain('CLEARED');
  });

  it('KING double started: Run it back keeps its primary, "To the map" beside it — and the pending double survives the exit', async () => {
    const king = storyStopById('king')!;
    const counter = await mount(() => kingWorld(0, false), () => kingWorld(1, true), () => kingStartedResult(), () => seedSave(king, 0));
    await finishResumed(king, true);
    expect(byTestid('story-double-line'), 'the between-legs accounting line').toBeTruthy();
    const runback = byTestid('story-double-runback');
    expect(runback, 'Run it back — leg 2').toBeTruthy();
    expect(runback!.textContent).toContain('Run it back');
    const exit = byTestid('story-outro-map');
    expect(exit, 'the labeled map exit').toBeTruthy();
    expect(exit!.textContent).toContain('To the map');
    await click(exit!);
    expect(byTestid('story-map'), 'the exit lands on the map').toBeTruthy();
    expect(counter.posts).toBe(1);
    // the double is still live on the map: pending words, the finish entry
    expect(byTestid('story-double-pending')!.textContent)
      .toBe('You beat him once — double or nothing: one more win takes the crown.');
    expect(byTestid('story-play-king')!.textContent).toBe('Finish the double');
  });

  it('KING double started: Run it back still starts leg 2 at the King\'s table', async () => {
    const king = storyStopById('king')!;
    await mount(() => kingWorld(0, false), () => kingWorld(1, true), () => kingStartedResult(), () => seedSave(king, 0));
    await finishResumed(king, true);
    await click(byTestid('story-double-runback')!);
    const table = byTestid('mock-table');
    expect(table, 'leg 2 starts').toBeTruthy();
    expect(table!.getAttribute('data-stop')).toBe('king');
  });
});

/* ---- the intro exit ---- */

describe('story intro exit — a way back that starts nothing', () => {
  it('both intro steps carry "Back to map"; using it posts nothing, starts nothing, consumes nothing', async () => {
    const counter = await mount(() => porchFresh(), () => porchFresh(), () => porchResult(false));
    const play = byTestid('story-play-porch');
    expect(play, 'the Porch card offers Play').toBeTruthy();
    await click(play!);
    // tape step: the exit stands under the tape
    expect(byTestid('story-tape'), 'the intro tape step').toBeTruthy();
    const exitAtTape = byTestid('story-intro-map');
    expect(exitAtTape, 'Back to map on the tape step').toBeTruthy();
    expect(exitAtTape!.textContent).toContain('Back to map');
    // forward into the scene step: the exit is still there
    await click(byTestid('story-tape-done')!); // "Play the scene"
    expect(byTestid('story-script'), 'the intro scene step').toBeTruthy();
    const exitAtScene = byTestid('story-intro-map');
    expect(exitAtScene, 'Back to map on the scene step').toBeTruthy();
    await click(exitAtScene!);
    expect(byTestid('story-map'), 'the exit lands back on the map').toBeTruthy();
    expect(byTestid('mock-table'), 'no game was started').toBeNull();
    expect(counter.posts).toBe(0); // no result posted, no attempt consumed
  });

  it('the tape-step exit alone: leaving before the scene starts nothing either', async () => {
    const counter = await mount(() => porchFresh(), () => porchFresh(), () => porchResult(false));
    await click(byTestid('story-play-porch')!);
    await click(byTestid('story-intro-map')!);
    expect(byTestid('story-map')).toBeTruthy();
    expect(byTestid('mock-table')).toBeNull();
    expect(counter.posts).toBe(0);
  });

  it('the forward path is unchanged: the scene\'s Skip still goes to the table', async () => {
    await mount(() => porchFresh(), () => porchFresh(), () => porchResult(false));
    await click(byTestid('story-play-porch')!);
    await click(byTestid('story-tape-done')!);
    await click(byTestid('story-script-skip')!);
    const table = byTestid('mock-table');
    expect(table, 'Skip still starts the game').toBeTruthy();
    expect(table!.getAttribute('data-stop')).toBe('porch');
  });
});
