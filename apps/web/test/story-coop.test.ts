/**
 * @vitest-environment happy-dom
 *
 * Story co-op, client half (spec §1–§2):
 *  - the server's story rules derivation (storyRulesForStop) is exactly the
 *    client's (storyRulesFor over the default settings) at every stop — the
 *    room builds its rules server-side, the solo table client-side, and the
 *    two must never drift;
 *  - the mode gate: once per visit, signed-in + access-cleared, before the
 *    map; Solo lands on the unchanged solo map; Co-op lands on the partner
 *    step; signed-out players never see it (the preview map renders as before);
 *  - "Your runs": a pair run opens that pair's map, with pair-track facts;
 *  - the ?coop=<code> invite landing joins the room server-side and enters it;
 *  - the story room's own phases (StoryRoomInner over a fake connection):
 *    the lobby readies, the tape readies, and the outro posts the witnessed
 *    result exactly once on the pair track.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS, storyRulesForStop } from '@spades/bots';
import type { ConnState } from '../src/online/connection';
import { DEFAULT_SETTINGS } from '../src/settings';
import { storyRulesFor } from '../src/story/storySettings';
import StoryHome from '../src/story/StoryHome';
import { StoryRoomInner } from '../src/story/StoryRoom';
import { badgeFactsOf } from '../src/story/StoryBadges';
import type { StoryProgress } from '../src/story/storyApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (stopId: string, over: Partial<StoryProgress['stops'][number]> = {}) => {
  const s = STORY_STOPS.find((x) => x.id === stopId)!;
  return { stopId, n: s.n, state: 'locked' as const, attempts: 0, clears: 0, firstClearedAt: null, ...over };
};
const progressPayload = (track: string, over: Partial<StoryProgress> = {}): StoryProgress => ({
  track,
  stops: STORY_STOPS.map((s) => row(s.id, s.id === 'porch' ? { state: 'current' } : {})),
  currentStop: 1,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds: { eggs: [], feats: [] },
  ...over,
});
const soloProgress = progressPayload('solo');
const pairProgress = progressPayload('pair:a:c');
/** The solo track AFTER the Porch clear — a player mid-route solo. */
const soloProgressStarted = progressPayload('solo', {
  currentStop: 2,
  stops: STORY_STOPS.map((s) => row(s.id, s.id === 'porch'
    ? { state: 'cleared', attempts: 1, clears: 1, firstClearedAt: 1 }
    : s.id === 'barbershop' ? { state: 'current' } : {})),
});
/** The pair progress AFTER the Porch clear — what a result response carries. */
const pairProgressAfter = progressPayload('pair:a:c', {
  currentStop: 2,
  stops: STORY_STOPS.map((s) => row(s.id, s.id === 'porch'
    ? { state: 'cleared', attempts: 1, clears: 1, firstClearedAt: 1 }
    : s.id === 'barbershop' ? { state: 'current' } : {})),
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
  // The gate's answer is remembered per tab session (story-mode-memory):
  // each test here is its own visit, so the session starts empty.
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});
const settle = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const click = async (node: Element) => { await act(async () => { (node as HTMLElement).click(); }); await settle(10); };
const byTestid = (id: string) => el!.querySelector(`[data-testid="${id}"]`);

interface FetchLog { urls: string[]; resultPosts: { track?: string; gameId?: string; stopId?: string }[] }
function stubFetch(opts: { signedOut?: boolean; joinOk?: boolean; solo?: StoryProgress } = {}): FetchLog {
  const log: FetchLog = { urls: [], resultPosts: [] };
  vi.stubGlobal('fetch', async (input: unknown, init?: { body?: string }) => {
    const url = String(input);
    log.urls.push(url);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/api/profile/me')) return ok({ dev: false, storyAccess: true, unlocks: [], user: { id: 'a', username: 'A' } });
    if (url.includes('/api/story/progress')) {
      if (opts.signedOut) return { ok: false, status: 401, json: async () => ({}) };
      return ok(url.includes('pair') ? pairProgress : (opts.solo ?? soloProgress));
    }
    if (url.includes('/api/story/tracks')) {
      return ok({
        solo: { track: 'solo', currentStop: 1, completed: false },
        pairs: [{ track: 'pair:a:c', partnerUid: 'c', partnerHandle: 'Cee', currentStop: 1, completed: false, lastPlayedAt: 5 }],
      });
    }
    if (url.includes('/api/story/room-join')) {
      return opts.joinOk === false
        ? { ok: false, status: 409, json: async () => ({ error: 'This story table is spoken for.' }) }
        : ok({ ok: true, code: 'ABCDE', track: 'pair:a:c', stopId: 'porch' });
    }
    if (url.includes('/api/story/result')) {
      const body = JSON.parse(init?.body ?? '{}') as { track?: string; gameId?: string; stopId?: string };
      log.resultPosts.push(body);
      return ok({
        ok: true, replayed: false, stopId: body.stopId, won: true, firstClear: true,
        rewards: { xp: 25, coins: 20 }, newFinds: [], doubleOutcome: null, doublePending: false,
        ...pairProgressAfter,
      });
    }
    if (url.includes('/api/story/session')) return ok({ ok: true });
    return { ok: false, status: 404, json: async () => ({}) };
  });
  return log;
}

async function renderStoryHome(search = '') {
  unmount();
  history.replaceState(null, '', `/story${search}`);
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => { root!.render(createElement(StoryHome) as ReactNode); });
  await settle();
  await settle();
  return el;
}

describe('story rules parity (client derivation vs the room\u2019s)', () => {
  it('storyRulesForStop matches storyRulesFor(stop, DEFAULT_SETTINGS) at all 11 stops', () => {
    for (const stop of STORY_STOPS) {
      expect(storyRulesForStop(stop), stop.id).toEqual(storyRulesFor(stop, { ...DEFAULT_SETTINGS }));
    }
  });
});

describe('the mode gate', () => {
  it('shows once, before the map; Solo opens the solo map unchanged', async () => {
    stubFetch();
    await renderStoryHome();
    expect(byTestid('story-mode-gate')).toBeTruthy();
    expect(byTestid('story-map')).toBeNull();
    await click(byTestid('story-gate-solo')!);
    expect(byTestid('story-map')).toBeTruthy();
    expect(byTestid('story-mode-coop')).toBeTruthy(); // the map's own toggle into co-op
    await click(byTestid('story-mode-coop')!);
    expect(byTestid('story-coop-partner')).toBeTruthy();
  });

  it('Co-op opens the partner step; a pair run opens that pair\u2019s map', async () => {
    stubFetch();
    await renderStoryHome();
    await click(byTestid('story-gate-coop')!);
    await settle();
    const run = byTestid('story-coop-run-c');
    expect(run).toBeTruthy();
    expect(run!.textContent).toContain('Cee');
    await click(run!);
    expect(byTestid('story-coop-map')).toBeTruthy();
    expect(byTestid('story-coop-stop-porch')).toBeTruthy();
    expect(byTestid('story-coop-play-porch')).toBeTruthy();
    expect(byTestid('story-coop-play-barbershop')).toBeNull(); // locked on the pair track
  });

  it('the partner step keeps "Run it solo instead" for a player who has NOT started solo — and it still works', async () => {
    stubFetch();
    await renderStoryHome();
    await click(byTestid('story-gate-coop')!);
    await settle();
    expect(byTestid('story-coop-home')).toBeTruthy();
    // the fresh player's escape hatch stands, with the co-op machinery
    // around it intact (invite / share / join-by-code all render)
    expect(byTestid('story-mode-solo')).toBeTruthy();
    expect(byTestid('story-coop-partner')).toBeTruthy();
    expect(byTestid('story-coop-share-start')).toBeTruthy();
    expect(byTestid('story-coop-code')).toBeTruthy();
    expect(byTestid('story-coop-join')).toBeTruthy();
    await click(byTestid('story-mode-solo')!);
    expect(byTestid('story-map')).toBeTruthy();
  });

  it('a player whose solo run is underway (server progress) gets no solo escape hatch on the partner step', async () => {
    stubFetch({ solo: soloProgressStarted });
    await renderStoryHome();
    await click(byTestid('story-gate-coop')!);
    await settle();
    expect(byTestid('story-coop-home')).toBeTruthy();
    // owner, 2026-10-24: "If I've already started a solo story there's
    // no need for this." The button does not render — nothing replaces
    // it — and the partner step itself is untouched.
    expect(byTestid('story-mode-solo')).toBeNull();
    expect(byTestid('story-coop-partner')).toBeTruthy();
    expect(byTestid('story-coop-share-start')).toBeTruthy();
    expect(byTestid('story-coop-code')).toBeTruthy();
    expect(byTestid('story-coop-join')).toBeTruthy();
  });

  it('signed-out players never see the gate — the preview map renders as before', async () => {
    stubFetch({ signedOut: true });
    await renderStoryHome();
    expect(byTestid('story-mode-gate')).toBeNull();
    expect(byTestid('story-signed-out')).toBeTruthy();
    expect(byTestid('story-map')).toBeTruthy();
  });

  it('an invite landing (?coop=) joins server-side and enters the room', async () => {
    const log = stubFetch();
    await renderStoryHome('?coop=ABCDE');
    await settle();
    expect(log.urls.some((u) => u.includes('/api/story/room-join'))).toBe(true);
    expect(byTestid('story-room-connecting')).toBeTruthy();
    expect(byTestid('story-mode-gate')).toBeNull();
  });
});

/* ---------------------------------------------------------- the story room */

function fakeCs(over: Partial<ConnState> & { storyPhase: string; roomPhase?: string; gameId?: string }): ConnState {
  const story = {
    track: 'pair:a:c', stopId: 'porch', phase: over.storyPhase, gameId: over.gameId ?? 'ABCDE-x-1',
    hostUid: 'a', partnerUid: 'c', ready: [] as string[],
  };
  return {
    status: 'open', you: 'pA', seat: 0, view: null, run: null, chat: [], error: null,
    pending: false, socketGen: 1, statsOff: false, joinFault: null,
    room: {
      code: 'ABCDE', hostId: 'pA', phase: (over.roomPhase ?? 'lobby') as 'lobby' | 'playing' | 'over',
      rules: storyRulesForStop(STORY_STOPS[0]!), botLevel: 'novice',
      seats: [
        { kind: 'human', playerId: 'pA', name: 'A', connected: true, media: {}, uid: 'a' },
        { kind: 'bot', name: 'Uncle Ray', level: 'novice' },
        { kind: 'human', playerId: 'pC', name: 'Cee', connected: true, media: {}, uid: 'c' },
        { kind: 'bot', name: 'Pat', level: 'novice' },
      ],
      members: [], deadline: null, turnClockStart: null, ready: [], rev: 1, seq: 0, game: 1,
      story,
    },
  } as unknown as ConnState;
}

async function renderRoom(cs: ConnState, send: (m: unknown) => void) {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  const conn = { send: send as never };
  await act(async () => {
    root!.render(createElement(StoryRoomInner, { conn, cs, code: 'ABCDE', track: 'pair:a:c', myUid: 'a', onExit: () => {} }));
  });
  await settle();
  return el;
}

describe('StoryRoomInner phases', () => {
  it('the lobby shows the pair seated across and readies on tap', async () => {
    stubFetch();
    const sent: unknown[] = [];
    await renderRoom(fakeCs({ storyPhase: 'lobby' }), (m) => sent.push(m));
    expect(byTestid('story-room-lobby')).toBeTruthy();
    expect(byTestid('story-room-seats')!.textContent).toContain('Uncle Ray');
    expect(byTestid('story-room-seats')!.textContent).toContain('Cee');
    await click(byTestid('story-room-ready')!);
    expect(sent).toContainEqual({ t: 'storyReady' });
    // the host's stop pick rides the same message
    await click(byTestid('story-room-stop-porch')!);
    expect(sent).toContainEqual({ t: 'storyReady', stopId: 'porch' });
  });

  it('the tape readies into the scene step', async () => {
    stubFetch();
    const sent: unknown[] = [];
    await renderRoom(fakeCs({ storyPhase: 'tape' }), (m) => sent.push(m));
    expect(byTestid('story-room-tape')).toBeTruthy();
    expect(byTestid('story-tape')).toBeTruthy();
    // The rundown panel adds its own transport button inside the tape
    // (Phase 3) — the CTA is the actions row's button specifically.
    const cta = el!.querySelector('[data-testid="story-tape-done"]');
    expect(cta).toBeTruthy();
    await click(cta!);
    expect(sent).toContainEqual({ t: 'storyReady' });
  });

  it('the outro posts the witnessed result once, on the pair track, and shows equal credit', async () => {
    const log = stubFetch();
    const cs = fakeCs({ storyPhase: 'outro', roomPhase: 'over', gameId: 'ABCDE-x-1' });
    (cs as { view: unknown }).view = { result: { winners: [0, 2] } };
    await renderRoom(cs, () => {});
    await settle();
    expect(log.resultPosts.length).toBe(1);
    expect(log.resultPosts[0]).toMatchObject({ track: 'pair:a:c', gameId: 'ABCDE-x-1', stopId: 'porch' });
    expect(byTestid('story-room-reward-line')!.textContent).toContain('+25 XP');
    expect(byTestid('story-room-reward-line')!.textContent).toContain('partner banks the same');
    // the next stop is offered; the run-back stays armed
    expect(byTestid('story-room-next')).toBeTruthy();
    expect(byTestid('story-room-runback')).toBeTruthy();
  });
});

/* ------------------------------------------- the King finale (Phase 4) */

function finaleCs(over: { phase: string; finale?: unknown; gameId?: string }): ConnState {
  const cs = fakeCs({ storyPhase: over.phase, gameId: over.gameId ?? 'ABCDE-x-2' });
  const story = (cs.room as { story: Record<string, unknown> }).story;
  story.stopId = 'king';
  if (over.finale !== undefined) story.finale = over.finale;
  (cs.room as { seats: unknown }).seats = [
    { kind: 'human', playerId: 'pA', name: 'A', connected: true, media: {}, uid: 'a' },
    { kind: 'bot', name: 'King', level: 'legendary' },
    { kind: 'human', playerId: 'pC', name: 'Cee', connected: true, media: {}, uid: 'c' },
    { kind: 'bot', name: 'Ringer', level: 'legendary' },
  ];
  return cs;
}

describe('the King finale in the room (Phase 4)', () => {
  it('the proposal scene plays with the gun already down, then both answers ride storyFinale', async () => {
    stubFetch();
    const sent: unknown[] = [];
    const fin = { short: false, choices: [] as { uid: string; choice: string }[] };
    await renderRoom(finaleCs({ phase: 'finale', finale: fin }), (m) => sent.push(m));
    expect(byTestid('story-room-finale')).toBeTruthy();
    expect(byTestid('story-script')).toBeTruthy();
    // canon: the revolver is on the felt from the first beat (the prop strip is down)
    const gun = byTestid('story-king-gun');
    expect(gun).toBeTruthy();
    expect(gun!.className).toContain('down');
    expect(el!.textContent).toContain('The second game is usually the first one, played again.');
    // skip the scene → the choice card, with the price stated plainly
    await click(byTestid('story-script-skip')!);
    expect(byTestid('story-finale-choice')).toBeTruthy();
    expect(byTestid('story-finale-choice')!.textContent).toContain('+550 XP, +440 coins');
    expect(byTestid('story-finale-choice')!.textContent).toContain('+275 XP, +220 coins');
    await click(byTestid('story-finale-cutthroat')!);
    expect(sent).toContainEqual({ t: 'storyFinale', choice: 'cutthroat' });
    await click(byTestid('story-finale-bank')!);
    expect(sent).toContainEqual({ t: 'storyFinale', choice: 'bank' });
  });

  it('the standings line shows both answers — disagreement reads as parked, not lost', async () => {
    stubFetch();
    const fin = { short: true, choices: [{ uid: 'a', choice: 'cutthroat' }, { uid: 'c', choice: 'bank' }] };
    await renderRoom(finaleCs({ phase: 'finale', finale: fin }), () => {});
    await click(byTestid('story-script-skip')!);
    const standings = byTestid('story-finale-standings')!;
    expect(standings.textContent).toContain('You chose the cutthroat.');
    expect(standings.textContent).toContain('Your partner chose banking the clear.');
    expect(standings.textContent).toContain('Nothing is lost while you decide.');
  });

  it('the short form is two beats: the price with the gun, and Dee’s reminder', async () => {
    stubFetch();
    const fin = { short: true, choices: [] };
    await renderRoom(finaleCs({ phase: 'finale', finale: fin }), () => {});
    expect(byTestid('story-script')!.textContent).toContain('Take it outright and the double pays');
    expect(byTestid('story-king-gun')!.className).toContain('down');
  });

  it('the outro of a declined finale banks the clear and says so', async () => {
    // a result stub whose post resolves the finale as 'declined'
    const posts: { gameId?: string }[] = [];
    vi.stubGlobal('fetch', async (input: unknown, init?: { body?: string }) => {
      const url = String(input);
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (url.includes('/api/story/result')) {
        const body = JSON.parse(init?.body ?? '{}') as { gameId?: string };
        posts.push(body);
        return ok({
          ok: true, replayed: false, stopId: 'king', won: true, firstClear: true,
          rewards: { xp: 275, coins: 220 }, newFinds: [], doubleOutcome: 'cleared', doublePending: false,
          finale: 'declined', completed: true, track: 'pair:a:c', currentStop: null, completedAt: 1,
          completionMark: 'story-pair-complete', finds: { eggs: [], feats: [] },
          stops: STORY_STOPS.map((s) => ({ stopId: s.id, n: s.n, state: 'cleared', attempts: 1, clears: 1, firstClearedAt: 1 })),
        });
      }
      if (url.includes('/api/story/progress')) return ok(pairProgress);
      if (url.includes('/api/story/session')) return ok({ ok: true });
      return { ok: false, status: 404, json: async () => ({}) };
    });
    const cs = finaleCs({ phase: 'outro', gameId: 'ABCDE-x-2-decline' });
    (cs as { view: unknown }).view = { result: { winners: [0] } };
    await renderRoom(cs, () => {});
    await settle();
    expect(posts.length).toBe(1);
    expect(posts[0]!.gameId).toBe('ABCDE-x-2-decline'); // the decline's own id, from the room descriptor
    expect(byTestid('story-room-reward-line')!.textContent).toContain('+275 XP');
    expect(byTestid('story-room-finale-note')!.textContent).toContain('Took the clear and walked');
  });
});

describe('badgeFactsOf union (Phase 4, §3.9)', () => {
  const stopRow = (stopId: string, attempts: number, clears: number) => ({ stopId, attempts, clears });
  it('a solo-only player’s facts pass through unchanged', () => {
    const p = { stops: [stopRow('porch', 2, 1)], finds: { eggs: ['porch-radio'], feats: [] }, completed: false };
    expect(badgeFactsOf(p)).toEqual(p);
    expect(badgeFactsOf(null)).toEqual({ stops: [], finds: { eggs: [], feats: [] }, completed: false });
  });

  it('a pair clear earns for a player who never cleared it solo; finds and completion union', () => {
    const p = {
      stops: [stopRow('porch', 1, 1), stopRow('corner', 2, 0)],
      finds: { eggs: ['porch-radio'], feats: [] },
      completed: false,
      anyTrack: {
        stops: [stopRow('porch', 3, 2), stopRow('corner', 5, 1), stopRow('king', 4, 1)],
        finds: { eggs: ['porch-radio'], feats: ['corner-keepsake'] },
        completed: true,
      },
    };
    const f = badgeFactsOf(p);
    expect(f.stops.find((s) => s.stopId === 'corner')).toMatchObject({ attempts: 5, clears: 1 }); // cleared anywhere
    expect(f.stops.find((s) => s.stopId === 'king')).toMatchObject({ clears: 1 }); // stops only in the union join too
    expect(f.finds).toEqual({ eggs: ['porch-radio'], feats: ['corner-keepsake'] });
    expect(f.completed).toBe(true);
  });
});
