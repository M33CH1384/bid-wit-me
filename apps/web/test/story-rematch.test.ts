/**
 * @vitest-environment happy-dom
 *
 * Story rematch + story win exits (owner reports, 2026-10-21):
 *
 *  1. "I just hit rematch in story mode and it took me to a different
 *     venue." The leak was the /rewards screen: leaving a finished story
 *     table stashed NO story identity, so its Rematch button fell back to
 *     '/?autostart=1' — a generic game built from the player's SAVED
 *     settings (his venue there is not the stop's). The chain is now:
 *     Table stashes storyStopId → RewardsPage routes a story Rematch to
 *     /story?rematch=<stopId> → StoryHome consumes it once and starts that
 *     stop from the story snapshot (storySettingsFor: the stop's venue,
 *     twist, house deck, team names, fresh attempt context).
 *
 *  2. "After winning a story mode match it should take you back to the
 *     'map'." A story WIN now leaves the victory modal only through the
 *     story outro (reward line, unlock notices, badges, outro scene),
 *     whose CTA ends at the map: the modal's primary action is "To the
 *     map", its ✕ routes the same way, and the generic exits (Play
 *     again — Rematch / Back to home / Change mode) are not rendered for
 *     a story win. A story LOSS keeps the stock exits as designed.
 *
 * The other rematch affordances (in-table Play again, outro Retry this
 * stop) already route through StoryHome.startGame — pinned so they can't
 * drift. Result integrity: Table fires story.onGameOver exactly once per
 * game (storyFired ref) and StoryHome posts it from exactly one place
 * under the per-seed gameId the server dedupes on.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS, storyStopById } from '@spades/bots';
import { newGame } from '@spades/rules';
import { computeRewards } from '../src/GameOverRewards';
import { loadRewards, rematchPathFor, stashRewards, type RewardsPayload } from '../src/RewardsPage';
import { deckForStop } from '../src/decks';
import { DEFAULT_SETTINGS } from '../src/settings';
import { storyRulesFor } from '../src/story/storySettings';
import StoryHome, { storyRematchStopId } from '../src/story/StoryHome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface ProbeProps {
  settings: { venue: string; deck: string };
  story?: {
    names: string[];
    onGameOver: (won: boolean, facts: unknown) => void;
    scene?: { stop: { id: string } };
    saveCtx?: { attemptsAtStart: number };
  };
  onExit?: () => void;
}

/* The real Table is a 3D/WebGL surface; StoryHome's rematch consumption is
 * what's under test, so Table is replaced by a probe that reports the
 * props StoryHome hands it (and lets the test drive its callbacks). */
const probe = vi.hoisted(() => ({ props: null as ProbeProps | null }));
vi.mock('../src/Table', async () => {
  const React = await import('react');
  return {
    default: function MockTable(props: ProbeProps) {
      probe.props = props;
      return React.createElement('div', {
        'data-testid': 'mock-table',
        'data-venue': props.settings.venue,
        'data-deck': props.settings.deck,
        'data-stop': props.story?.scene?.stop.id ?? '',
        'data-attempts': String(props.story?.saveCtx?.attemptsAtStart ?? ''),
        'data-names': (props.story?.names ?? []).join(','),
      });
    },
  };
});

const data = () => computeRewards(null, null, { won: true, headline: 'VICTORY!', sub: '5 hands played', kind: 'team' });

describe('rewards rematch routing', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    (globalThis as Record<string, unknown>).sessionStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => store.clear(),
    } as Storage;
  });
  afterEach(() => { delete (globalThis as Record<string, unknown>).sessionStorage; });

  it('a story payload rematches its own stop, not an autostart game', () => {
    const p: RewardsPayload = { data: data(), online: false, homePath: '/', storyStopId: 'porch' };
    expect(rematchPathFor(p)).toBe('/story?rematch=porch');
  });

  it('non-story payloads keep the long-standing rematch targets', () => {
    expect(rematchPathFor({ data: data(), online: false, homePath: '/' })).toBe('/?autostart=1');
    expect(rematchPathFor({ data: data(), online: true, homePath: '/' })).toBe('/online');
  });

  it('storyStopId round-trips through the stash; older stashes load without one', () => {
    stashRewards({ data: data(), online: false, homePath: '/', storyStopId: 'the-pjs' });
    expect(loadRewards()!.storyStopId).toBe('the-pjs');
    stashRewards({ data: data(), online: false, homePath: '/' });
    expect(loadRewards()!.storyStopId).toBeUndefined();
    expect(rematchPathFor(loadRewards()!)).toBe('/?autostart=1');
  });
});

describe('story rematch directive parsing', () => {
  it('accepts a real stop id and rejects everything else', () => {
    expect(storyRematchStopId('?rematch=porch')).toBe('porch');
    expect(storyRematchStopId('?rematch=king')).toBe('king');
    expect(storyRematchStopId('?rematch=not-a-stop')).toBeNull();
    expect(storyRematchStopId('?rematch=')).toBeNull();
    expect(storyRematchStopId('')).toBeNull();
    expect(storyRematchStopId('?autostart=1')).toBeNull();
  });
});

/* ---- StoryHome consuming the directive ---- */

const progressPayload = (porchAttempts: number) => ({
  track: 'solo',
  stops: STORY_STOPS.map((s) => ({
    stopId: s.id,
    n: s.n,
    state: s.n === 1 ? 'current' : 'locked',
    attempts: s.id === 'porch' ? porchAttempts : 0,
    clears: 0,
    firstClearedAt: null,
  })),
  currentStop: 1,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds: { eggs: [], feats: [] },
});

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

async function renderStoryHome(search: string, progressStatus: number) {
  unmount();
  localStorage.clear();
  // The owner's own saved settings point at a DIFFERENT venue — the exact
  // setup that made the old rematch land somewhere else.
  localStorage.setItem('spades.settings.v2', JSON.stringify({ venue: 'yacht' }));
  history.replaceState(null, '', `/story${search}`);
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: true, storyAccess: true, unlocks: [] }) };
    if (url.includes('/api/story/progress')) {
      return progressStatus === 200
        ? { ok: true, status: 200, json: async () => progressPayload(1) }
        : { ok: false, status: progressStatus, json: async () => ({}) };
    }
    throw new Error(`no network in tests: ${url}`);
  });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  const node: ReactNode = createElement(StoryHome);
  await act(async () => { root!.render(node); });
  // let the dev + progress fetches settle and the directive effect fire
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  /* co-op mode gate: pass it as a solo player would */
  const gate = el.querySelector('[data-testid="story-gate-solo"]');
  if (gate) {
    await act(async () => { (gate as HTMLElement).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
  return el;
}

describe('StoryHome rematch consumption', () => {
  it('?rematch=porch starts the Porch from the story snapshot — not the saved settings', async () => {
    const c = await renderStoryHome('?rematch=porch', 200);
    const table = c.querySelector('[data-testid="mock-table"]');
    expect(table).toBeTruthy();
    // the stop's venue (the Porch plays at 'grandma'), never the saved 'yacht'
    expect(table!.getAttribute('data-venue')).toBe('grandma');
    expect(table!.getAttribute('data-stop')).toBe('porch');
    // the stop's house deck rides the snapshot
    expect(table!.getAttribute('data-deck')).toBe(deckForStop('porch')!.id);
    // attempt context already counts the finished match (attempts = 1)
    expect(table!.getAttribute('data-attempts')).toBe('1');
    expect(table!.getAttribute('data-names')).toBe('You,Uncle Ray,Dee,Pat');
    // the directive is consumed: the param is stripped so it can't re-fire
    expect(location.search).toBe('');
    expect(c.querySelector('[data-testid="story-map"]')).toBeNull();
  });

  it('an unknown stop id is not a directive — the map renders', async () => {
    const c = await renderStoryHome('?rematch=not-a-stop', 200);
    expect(c.querySelector('[data-testid="mock-table"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
  });

  it('no directive — the map renders (normal story entry unchanged)', async () => {
    const c = await renderStoryHome('', 200);
    expect(c.querySelector('[data-testid="mock-table"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
  });

  it('signed out — the directive cannot start a phantom game', async () => {
    const c = await renderStoryHome('?rematch=porch', 401);
    expect(c.querySelector('[data-testid="mock-table"]')).toBeNull();
    expect(c.querySelector('[data-testid="story-map"]')).toBeTruthy();
  });
});

/* ---- the outro a finished story match must reach (never /rewards) ---- */

const resultFixture = (won: boolean) => ({
  ok: true,
  replayed: false,
  stopId: 'porch',
  won,
  firstClear: won,
  rewards: won ? { xp: 25, coins: 20 } : { xp: 5, coins: 0 },
  newFinds: [],
  track: 'solo',
  stops: STORY_STOPS.map((s) => ({
    stopId: s.id,
    n: s.n,
    state: s.id === 'porch' ? (won ? 'cleared' : 'current') : s.n === 2 && won ? 'current' : 'locked',
    attempts: s.id === 'porch' ? 1 : 0,
    clears: s.id === 'porch' && won ? 1 : 0,
    firstClearedAt: null,
  })),
  currentStop: won ? 2 : 1,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds: { eggs: [], feats: [] },
});

function seedPorchSave() {
  const porch = storyStopById('porch')!;
  const state = newGame(storyRulesFor(porch, { ...DEFAULT_SETTINGS }), 'save-seed');
  const save = {
    v: 1,
    savedAt: Date.now(),
    seed: 'save-seed',
    settings: { ...DEFAULT_SETTINGS },
    state,
    chat: [],
    names: ['You', 'Uncle Ray', 'Dee', 'Pat'],
    teamNames: [null, 'Uncle Ray & Pat'],
    nuke: 'full',
    story: {
      stopId: 'porch',
      track: 'solo',
      attemptsAtStart: 0,
      clearsAtStart: 0,
      session: { fired: [], memory: [], satDown: true, railFired: 0, lastRailHand: 0 },
    },
  };
  localStorage.setItem('bwm.storySave.v1', JSON.stringify(save));
}

/** Render StoryHome with a Porch match in progress, resume it, finish it
 *  (won or lost) through the table's own callbacks, then take the host
 *  exit — the exact path every game-over modal exit now routes through. */
async function finishResumedPorch(won: boolean) {
  unmount();
  localStorage.clear();
  // happy-dom ships no sessionStorage in this setup: install the same
  // Map-backed stub the rewards tests use, so a /rewards stash (the
  // detour) would be observable if any story exit still made one.
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  } as Storage;
  seedPorchSave();
  history.replaceState(null, '', '/story');
  let posted = false;
  vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
    const url = String(input);
    if (url.includes('/api/profile/me')) return { ok: true, status: 200, json: async () => ({ dev: true, storyAccess: true, unlocks: [] }) };
    if (url.includes('/api/story/result')) { posted = true; return { ok: true, status: 200, json: async () => resultFixture(won) }; }
    // like the real server: once the result is recorded, progress shows it
    if (url.includes('/api/story/progress')) return { ok: true, status: 200, json: async () => (posted ? resultFixture(won) : progressPayload(0)) };
    throw new Error(`no network in tests: ${url} ${init?.method ?? ''}`);
  });
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(StoryHome)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  /* co-op mode gate: pass it as a solo player would */
  const gate = el.querySelector('[data-testid="story-gate-solo"]');
  if (gate) {
    await act(async () => { (gate as HTMLElement).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  }
  const resumeBtn = el.querySelector<HTMLButtonElement>('[data-testid="story-resume-porch"]');
  expect(resumeBtn, 'map offers Resume for the saved Porch match').toBeTruthy();
  await act(async () => { resumeBtn!.click(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  expect(el.querySelector('[data-testid="mock-table"]'), 'resumed table mounted').toBeTruthy();
  expect(probe.props?.story).toBeTruthy();
  await act(async () => { probe.props!.story!.onGameOver(won, {}); });
  // let the result post settle into StoryHome (lastResult + progress)
  await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
  await act(async () => { probe.props!.onExit!(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return el;
}

describe('finished story match → outro, never /rewards', () => {
  it('a first-clear WIN shows the reward line, both unlock notices and the badge strip', async () => {
    const c = await finishResumedPorch(true);
    expect(c.querySelector('[data-testid="mock-table"]')).toBeNull(); // table left behind
    const reward = c.querySelector('[data-testid="story-reward-line"]');
    expect(reward, 'outro reward line').toBeTruthy();
    expect(reward!.textContent).toContain('First clear!');
    expect(reward!.textContent).toContain('+25 XP');
    const deck = c.querySelector('[data-testid="story-deck-notice"]');
    expect(deck, 'deck unlock notice').toBeTruthy();
    expect(deck!.textContent).toContain(`New deck unlocked: ${deckForStop('porch')!.name}`);
    const anim = c.querySelector('[data-testid="story-setanim-notice"]');
    expect(anim, 'set-animation unlock notice').toBeTruthy();
    expect(anim!.textContent).toContain('New set animation unlocked:');
    // the badge strip: the win's badges lit, the rest counted
    expect(c.textContent).toContain('Porch Graduate');
    expect(c.textContent).toMatch(/\d+ of 13/);
    // zero /rewards detour: nothing stashed, no navigation away
    expect(sessionStorage.getItem('bwm.rewards.v1')).toBeNull();
    expect(location.pathname).toBe('/story');
    // and the outro scene's own exit (Skip = its onDone) ends at the map
    const skip = c.querySelector<HTMLButtonElement>('[data-testid="story-script-skip"]');
    expect(skip, 'outro scene Skip').toBeTruthy();
    await act(async () => { skip!.click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(c.querySelector('[data-testid="story-map"]'), 'the win terminates at the story map').toBeTruthy();
    // the cleared stop shows cleared on the map, the next stop unlocked
    expect(c.querySelector('[data-testid="story-stop-porch"]')?.textContent).toContain('CLEARED');
  });

  it('a LOSS shows the outro-lose with its free Retry — and the consolation the server paid', async () => {
    const c = await finishResumedPorch(false);
    expect(c.querySelector('[data-testid="mock-table"]')).toBeNull();
    const reward = c.querySelector('[data-testid="story-reward-line"]');
    expect(reward).toBeTruthy();
    expect(reward!.textContent).toContain('+5 XP');
    expect(reward!.textContent).toContain('seeing it through');
    expect(reward!.textContent).not.toContain('No rewards on a loss');
    const retry = c.querySelector('[data-testid="story-retry"]');
    expect(retry, 'outro Retry this stop').toBeTruthy();
    expect(retry!.textContent).toContain('Retry this stop');
    expect(sessionStorage.getItem('bwm.rewards.v1')).toBeNull();
    expect(location.pathname).toBe('/story');
  });
});
