/**
 * @vitest-environment happy-dom
 *
 * Story co-op Phase 3, client half (spec §5.1/§5.5/§7/§8):
 *  - the tape carries Dee's rundown panel, selected by PAIR facts:
 *    pair-awareness when one partner knows the stop, pair-first when
 *    neither does, pair-return after attempts — and solo's tape never
 *    renders the panel at all;
 *  - the lobby shows the awareness memory line when the room knows
 *    one of you;
 *  - the panel's reveal is text-only playback (skip completes; seen
 *    panels open whole with a replay);
 *  - the guide plate: present on the table, lifts with her latest
 *    line, dims while she covers a seat;
 *  - a guide chat line maps through the chat hook as a plain
 *    "Dee · guide" entry with NO bot tone — the voice fence at the
 *    client: nothing here can ever voice it.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PAIR_AWARENESS_RUNDOWNS, PAIR_FIRST_RUNDOWNS, PAIR_RETURN_LOSS_RUNDOWNS,
  STORY_STOPS, coopRundownFor, storyRulesForStop,
} from '@spades/bots';
import type { ConnState } from '../src/online/connection';
import { useOnlineChat } from '../src/online/useOnline';
import { StoryRoomInner, GuidePlate } from '../src/story/StoryRoom';
import StoryTape from '../src/story/StoryTape';
import DeeRundownPanel from '../src/story/DeeRundown';
import type { PairContext, StoryProgress } from '../src/story/storyApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});
const settle = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const click = async (node: Element) => { await act(async () => { (node as HTMLElement).click(); }); await settle(10); };
const byTestid = (id: string) => el!.querySelector(`[data-testid="${id}"]`);

const row = (stopId: string, over: Partial<StoryProgress['stops'][number]> = {}) => {
  const s = STORY_STOPS.find((x) => x.id === stopId)!;
  return { stopId, n: s.n, state: 'locked' as const, attempts: 0, clears: 0, firstClearedAt: null, ...over };
};
const pairProgress = (porch: Partial<StoryProgress['stops'][number]> = {}): StoryProgress => ({
  track: 'pair:a:c',
  stops: STORY_STOPS.map((s) => row(s.id, s.id === 'porch' ? { state: 'current', ...porch } : {})),
  currentStop: 1, completed: false, completedAt: null, completionMark: null,
  finds: { eggs: [], feats: [] },
});

function stubFetch(pairCtx: PairContext | null, progress: StoryProgress) {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/api/story/pair-context')) {
      return pairCtx ? ok(pairCtx) : { ok: false, status: 409, json: async () => ({}) };
    }
    if (url.includes('/api/story/progress')) return ok(progress);
    if (url.includes('/api/story/session')) return ok({ ok: true });
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

function fakeCs(storyPhase: string): ConnState {
  const story = {
    track: 'pair:a:c', stopId: 'porch', phase: storyPhase, gameId: 'ABCDE-x-1',
    hostUid: 'a', partnerUid: 'c', ready: [] as string[],
  };
  return {
    status: 'open', you: 'pA', seat: 0, view: null, run: null, chat: [], error: null,
    pending: false, socketGen: 1, statsOff: false, joinFault: null,
    room: {
      code: 'ABCDE', hostId: 'pA', phase: 'lobby',
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

async function renderRoom(cs: ConnState) {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  const conn = { send: () => {} };
  await act(async () => {
    root!.render(createElement(StoryRoomInner, { conn: conn as never, cs, code: 'ABCDE', track: 'pair:a:c', myUid: 'a', onExit: () => {} }));
  });
  await settle();
  await settle();
  return el;
}

const ctxB: PairContext = {
  players: [
    { handle: 'VetPal', knowsStop: true, clearedStop: false, clearedStops: 2 },
    { handle: 'Cee', knowsStop: false, clearedStop: false, clearedStops: 0 },
  ],
  pair: { attempts: 0, clears: 0, doublePending: false },
};

describe('the co-op tape rundown (pair-fact selection)', () => {
  it('case (b): the pair-awareness script for the Porch', async () => {
    stubFetch(ctxB, pairProgress());
    await renderRoom(fakeCs('tape'));
    const panel = byTestid('dee-rundown');
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('aria-label')).toBe(PAIR_AWARENESS_RUNDOWNS['porch']);
    expect(panel!.textContent).toContain('DEE’S RUNDOWN');
  });

  it('no pair context (endpoint pending): the pair-first script', async () => {
    stubFetch(null, pairProgress());
    await renderRoom(fakeCs('tape'));
    const panel = byTestid('dee-rundown');
    expect(panel).toBeTruthy();
    expect(panel!.getAttribute('aria-label')).toBe(PAIR_FIRST_RUNDOWNS['porch']);
  });

  it('a returning pair gets the return script, not the meet', async () => {
    const ctx: PairContext = { players: ctxB.players, pair: { attempts: 2, clears: 0, doublePending: false } };
    stubFetch(ctx, pairProgress({ attempts: 2 }));
    await renderRoom(fakeCs('tape'));
    const panel = byTestid('dee-rundown');
    expect(panel!.getAttribute('aria-label')).toBe(PAIR_RETURN_LOSS_RUNDOWNS['porch']);
  });

  it('solo’s tape never renders the panel', async () => {
    unmount();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    const stop = STORY_STOPS[0]!;
    await act(async () => {
      root!.render(createElement(StoryTape, {
        stop, facts: { attempts: 0, clears: 0, cleared: false }, cta: 'Play', onDone: () => {},
      }));
    });
    await settle();
    expect(byTestid('dee-rundown')).toBeNull();
    expect(byTestid('story-tape')).toBeTruthy();
  });
});

describe('the lobby awareness line', () => {
  it('shows when the room knows one of you (case b), and only then', async () => {
    stubFetch(ctxB, pairProgress());
    await renderRoom(fakeCs('lobby'));
    expect(byTestid('story-room-aware')?.textContent).toContain('They know one of you here.');
    stubFetch(null, pairProgress());
    await renderRoom(fakeCs('lobby'));
    expect(byTestid('story-room-aware')).toBeNull();
  });
});

describe('the rundown panel playback (text-only)', () => {
  const rundown = coopRundownFor('porch', 'a', { attempts: 0, clears: 0, doublePending: false })!;

  it('auto-reveals on first sight; Skip completes it; a seen panel opens whole with a replay', async () => {
    unmount();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(createElement(DeeRundownPanel, { rundown, track: 'pair:a:c' })); });
    await settle(20);
    const textEl = () => el!.querySelector('.dee-rundown-text')!;
    expect(textEl().textContent!.length).toBeLessThan(rundown.text.length); // still revealing
    await click(byTestid('dee-rundown-skip')!);
    expect(textEl().textContent).toBe(rundown.text);
    expect(localStorage.getItem('bwm.rundownSeen.v1')).toContain('pair:a:c|porch|pairFirst');
    // remount: seen → full text immediately, replay offered
    unmount();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(createElement(DeeRundownPanel, { rundown, track: 'pair:a:c' })); });
    await settle(20);
    expect(textEl().textContent).toBe(rundown.text);
    expect(byTestid('dee-rundown-replay')).toBeTruthy();
  });
});

describe('the guide plate', () => {
  const seats = [
    { kind: 'human', playerId: 'pA', name: 'A', connected: true, media: {}, uid: 'a' },
    { kind: 'bot', name: 'Uncle Ray', level: 'novice' },
    { kind: 'human', playerId: 'pC', name: 'Cee', connected: true, media: {}, uid: 'c' },
    { kind: 'bot', name: 'Pat', level: 'novice' },
  ] as never[];

  async function renderPlate(props: Parameters<typeof GuidePlate>[0]) {
    unmount();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(createElement(GuidePlate, props)); });
    await settle(10);
    return el;
  }

  it('sits present and quiet with no line yet', async () => {
    await renderPlate({ chat: [], seats });
    const plate = byTestid('guide-plate')!;
    expect(plate.textContent).toContain('Dee · guide');
    expect(plate.textContent).toContain('Riding along');
    expect(plate.className).not.toContain('speaking');
  });

  it('lifts and shows her latest guide line while she speaks', async () => {
    const line = { id: 7, from: 'guide:dee', name: 'Dee · guide', text: 'Y’all are cooking now.', at: 1 } as never;
    await renderPlate({ chat: [line], seats });
    const plate = byTestid('guide-plate')!;
    expect(plate.className).toContain('speaking');
    expect(plate.textContent).toContain('Y’all are cooking now.');
  });

  it('dims and names the seat she covers', async () => {
    const covered = [
      seats[0],
      seats[1],
      { kind: 'bot', name: 'Dee', level: 'pro', was: 'Cee' },
      seats[3],
    ] as never[];
    await renderPlate({ chat: [], seats: covered });
    const plate = byTestid('guide-plate')!;
    expect(plate.className).toContain('covering');
    expect(plate.textContent).toContain('Covering for Cee');
  });
});

describe('the fence at the client (chat mapping)', () => {
  function ChatHarness({ cs }: { cs: ConnState }) {
    const { msgs } = useOnlineChat(cs, null, ['A', 'Ray', 'Cee', 'Pat'], () => {});
    return createElement('pre', { 'data-testid': 'chat-msgs' }, JSON.stringify(msgs.map((m) => ({ user: m.user, text: m.text, botTone: m.botTone ?? null }))));
  }

  it('a guide line arrives as a plain “Dee · guide” entry — no bot tone, nothing to voice', async () => {
    const cs = fakeCs('game');
    (cs as { chat: unknown[] }).chat = [
      { id: 3, from: 'guide:dee', name: 'Dee · guide', text: 'Steady. One hand at a time.', at: 5 },
    ];
    unmount();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => { root!.render(createElement(ChatHarness, { cs })); });
    await settle();
    const msgs = JSON.parse(byTestid('chat-msgs')!.textContent!) as { user: string; text: string; botTone: string | null }[];
    const guide = msgs.find((m) => m.text.includes('Steady'));
    expect(guide).toBeTruthy();
    expect(guide!.user).toBe('Dee · guide');
    expect(guide!.botTone).toBeNull();
  });
});
