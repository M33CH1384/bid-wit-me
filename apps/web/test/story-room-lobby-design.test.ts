/**
 * @vitest-environment happy-dom
 *
 * The co-op room lobby's composition (owner, 2026-10-24 — "This screen
 * needs work"): the waiting room meets the story gate's standard.
 *  - the stop's own backdrop sits in a hero over the header, with the
 *    sound dock's slot inside it (the audited frame finding: the dock
 *    was slotted correctly; its playing ring read as a broken partial
 *    frame only because the glass fill had the flat void behind it);
 *  - the invite code is a ticket, not a form field;
 *  - the four seats are composed as the table they'll play at, from
 *    the viewer's chair (own seat near, partner across, the stop's
 *    pair on the sides) with real faces — the player's uploaded
 *    picture, the pair's cast portraits, a dashed open medallion for
 *    the partner's unfilled seat;
 *  - the route replaces the lock-pill wall: locked stops are thread
 *    nodes, never buttons; only unlocked stops render as chips, and
 *    only for the host (selection is the host's, as before);
 *  - presence is legible: ready ticks ride the seats' own uids from
 *    the room's ready list.
 * Function is frozen: same ready/stop messages on the wire (pinned in
 * story-coop.test.ts), same testids, same awareness line.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import type { ConnState } from '../src/online/connection';
import { StoryRoomInner } from '../src/story/StoryRoom';
import type { StoryProgress } from '../src/story/storyApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (stopId: string, over: Partial<StoryProgress['stops'][number]> = {}) => {
  const s = STORY_STOPS.find((x) => x.id === stopId)!;
  return { stopId, n: s.n, state: 'locked' as const, attempts: 0, clears: 0, firstClearedAt: null, ...over };
};
const progressPayload = (over: Partial<StoryProgress> = {}): StoryProgress => ({
  track: 'pair:a:c',
  stops: STORY_STOPS.map((s) => row(s.id, s.id === 'porch' ? { state: 'current' } : {})),
  currentStop: 1,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds: { eggs: [], feats: [] },
  ...over,
});
const clearedRow = { state: 'cleared' as const, attempts: 2, clears: 1, firstClearedAt: 1 };
const veteranProgress = progressPayload({
  currentStop: 4,
  stops: STORY_STOPS.map((s) => row(s.id,
    s.id === 'porch' || s.id === 'barbershop' || s.id === 'rec-center' ? clearedRow
      : s.id === 'cookout' ? { state: 'current' } : {})),
});
const completeProgress = progressPayload({
  currentStop: null,
  completed: true,
  completedAt: 9,
  stops: STORY_STOPS.map((s) => row(s.id, clearedRow)),
});

type Seat = NonNullable<ConnState['room']>['seats'][number];
const human = (playerId: string, name: string, uid: string): Seat =>
  ({ kind: 'human', playerId, name, connected: true, media: {}, uid }) as Seat;
const bot = (name: string): Seat => ({ kind: 'bot', name, level: 'novice' }) as Seat;

function fakeCs(over: {
  stopId?: string; partnerUid?: string | null; seats?: Seat[]; ready?: string[]; seat?: number;
} = {}): ConnState {
  const story = {
    track: 'pair:a:c', stopId: over.stopId ?? 'porch', phase: 'lobby', gameId: 'ABCDE-x-1',
    hostUid: 'a', partnerUid: over.partnerUid === undefined ? 'c' : over.partnerUid,
    ready: over.ready ?? [],
  };
  return {
    status: 'open', you: 'pA', seat: over.seat ?? 0, view: null, run: null, chat: [], error: null,
    pending: false, socketGen: 1, statsOff: false, joinFault: null,
    room: {
      code: 'ABCDE', hostId: 'pA', phase: 'lobby', rules: null, botLevel: 'novice',
      seats: over.seats ?? [human('pA', 'M33CH', 'a'), bot('Uncle Ray'), human('pC', 'Cee', 'c'), bot('Pat')],
      members: [], deadline: null, turnClockStart: null, ready: [], rev: 1, seq: 0, game: 1,
      story,
    },
  } as unknown as ConnState;
}

function stubFetch(progress: StoryProgress) {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/api/story/progress')) return ok(progress);
    if (url.includes('/api/story/pair-context')) return ok({ players: [], pair: { attempts: 0, clears: 0, doublePending: false } });
    if (url.includes('/api/profile/')) return ok({ user: { avatar: null, avatarUpdatedAt: null } });
    return ok({});
  });
}

let root: Root | null = null;
let el: HTMLDivElement | null = null;
function unmount() {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
}
afterEach(() => { unmount(); vi.unstubAllGlobals(); localStorage.clear(); });
const settle = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const byTestid = (id: string) => el!.querySelector(`[data-testid="${id}"]`);
const seatCells = () => [...el!.querySelectorAll('.story-room-seat')];
const cellWith = (text: string) => seatCells().find((c) => c.textContent?.includes(text));

async function renderRoom(cs: ConnState, myUid = 'a') {
  unmount();
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  const conn = { send: () => {} };
  await act(async () => {
    root!.render(createElement(StoryRoomInner, { conn: conn as never, cs, code: 'ABCDE', track: 'pair:a:c', myUid, onExit: () => {} }));
  });
  await settle();
  return el;
}

describe('the lobby composition', () => {
  it('host waiting alone: hero with the Porch behind the header, the table, one open seat, no lock wall', async () => {
    stubFetch(progressPayload());
    await renderRoom(fakeCs({
      partnerUid: null,
      seats: [human('pA', 'M33CH', 'a'), bot('Uncle Ray'), { kind: 'empty' } as Seat, bot('Pat')],
    }));
    // the hero: the stop's own backdrop, the dock slot inside it
    const hero = el!.querySelector('.story-room-hero');
    expect(hero).toBeTruthy();
    expect(hero!.querySelector('.story-hero-bg')!.getAttribute('style')).toContain('/assets/story/venues/porch.jpg');
    expect(hero!.querySelector('.dock-slot')).toBeTruthy();
    expect(hero!.textContent).toContain('The Porch');
    // the code as a ticket
    expect(byTestid('story-room-code')!.textContent).toBe('ABCDE');
    expect(byTestid('story-room-copy')).toBeTruthy();
    // the table: faces and names, partner's seat open
    const seats = byTestid('story-room-seats')!;
    expect(seats.textContent).toContain('M33CH');
    expect(seats.textContent).toContain('Uncle Ray');
    expect(seats.textContent).toContain('Pat');
    expect(seats.textContent).toContain('Your partner');
    expect(seats.textContent).toContain('Share the code to fill the seat');
    expect(el!.querySelectorAll('.story-room-seat-open')).toHaveLength(1);
    expect(seats.querySelector('[data-testid="story-face-uncleRay"]')).toBeTruthy();
    expect(seats.querySelector('[data-testid="story-face-pat"]')).toBeTruthy();
    // from the host's chair: partner across, pair on the sides
    expect(cellWith('M33CH')!.classList.contains('pos-bottom')).toBe(true);
    expect(cellWith('Your partner')!.classList.contains('pos-top')).toBe(true);
    expect(cellWith('Uncle Ray')!.classList.contains('pos-left')).toBe(true);
    expect(cellWith('Pat')!.classList.contains('pos-right')).toBe(true);
    // waiting line, and the lock wall is dead: one chip, eleven nodes
    expect(byTestid('story-room-waiting')).toBeTruthy();
    expect(el!.querySelectorAll('.story-room-stoprow .btn')).toHaveLength(1);
    expect(byTestid('story-room-stop-porch')).toBeTruthy();
    expect(byTestid('story-room-stop-barbershop')).toBeNull();
    expect(el!.querySelectorAll('.story-room-stops .story-gate-node')).toHaveLength(11);
    // the screenshot's state: a partner is bound but hasn't arrived —
    // the seat says they're on their way in, and the waiting note rests
    stubFetch(progressPayload());
    await renderRoom(fakeCs({
      seats: [human('pA', 'M33CH', 'a'), bot('Uncle Ray'), { kind: 'empty' } as Seat, bot('Pat')],
    }));
    expect(byTestid('story-room-seats')!.textContent).toContain('On their way in');
    expect(el!.querySelectorAll('.story-room-seat-open')).toHaveLength(1);
    expect(byTestid('story-room-waiting')).toBeNull();
  });

  it('partner joined: the seat fills, ready ticks ride the seats, the waiting note is gone', async () => {
    stubFetch(progressPayload());
    await renderRoom(fakeCs({ ready: ['a', 'c'] }));
    expect(el!.querySelector('.story-room-seat-open')).toBeNull();
    expect(byTestid('story-room-seats')!.textContent).toContain('Cee');
    expect(byTestid('story-room-waiting')).toBeNull();
    expect(el!.querySelectorAll('.story-room-seat-ready')).toHaveLength(2);
    // from the partner's chair the same table turns: host across, self near,
    // and no stop chips — choosing stays the host's — but the route shows
    await renderRoom(fakeCs({ seat: 2 }), 'c');
    expect(cellWith('Cee')!.classList.contains('pos-bottom')).toBe(true);
    expect(cellWith('M33CH')!.classList.contains('pos-top')).toBe(true);
    expect(el!.querySelector('.story-room-stoprow')).toBeNull();
    expect(el!.querySelectorAll('.story-room-stops .story-gate-node')).toHaveLength(11);
  });

  it('a veteran pair: the thread runs deep, only the unlocked stops are chips', async () => {
    stubFetch(veteranProgress);
    await renderRoom(fakeCs({
      stopId: 'cookout',
      seats: [human('pA', 'M33CH', 'a'), bot('Keisha'), human('pC', 'Cee', 'c'), bot('Teisha')],
    }));
    const hero = el!.querySelector('.story-room-hero');
    expect(hero!.querySelector('.story-hero-bg')!.getAttribute('style')).toContain('/assets/story/venues/cookout.jpg');
    const seats = byTestid('story-room-seats')!;
    expect(seats.querySelector('[data-testid="story-face-keisha"]')).toBeTruthy();
    expect(seats.querySelector('[data-testid="story-face-teisha"]')).toBeTruthy();
    const nodes = [...el!.querySelectorAll('.story-room-stops .story-gate-node')];
    expect(nodes).toHaveLength(11);
    expect(nodes.filter((n) => n.classList.contains('state-cleared'))).toHaveLength(3);
    expect(nodes.filter((n) => n.classList.contains('state-current'))).toHaveLength(1);
    expect(nodes[3]!.classList.contains('is-here')).toBe(true);
    // the four unlocked stops are chips; the locked road ahead is not buttons
    for (const id of ['porch', 'barbershop', 'rec-center', 'cookout']) {
      expect(byTestid(`story-room-stop-${id}`)).toBeTruthy();
    }
    expect(byTestid('story-room-stop-corner')).toBeNull();
    expect(el!.querySelector('.story-room-route-line')!.textContent).toContain('3 of 11 stops cleared together');
    expect(el!.querySelector('.story-room-route-line')!.textContent).toContain('The Cookout');
  });

  it('a route-complete pair: the whole thread is cleared and every stop is a replay chip', async () => {
    stubFetch(completeProgress);
    await renderRoom(fakeCs({
      stopId: 'king',
      seats: [human('pA', 'M33CH', 'a'), bot('The King'), human('pC', 'Cee', 'c'), bot('The Ringer')],
    }));
    const nodes = [...el!.querySelectorAll('.story-room-stops .story-gate-node')];
    expect(nodes).toHaveLength(11);
    expect(nodes.filter((n) => n.classList.contains('state-cleared'))).toHaveLength(11);
    expect(nodes[10]!.classList.contains('is-here')).toBe(true);
    expect(nodes[10]!.classList.contains('is-king')).toBe(true);
    expect(el!.querySelectorAll('.story-room-stoprow .btn')).toHaveLength(11);
    expect(el!.querySelector('.story-room-route-line')!.textContent).toContain('Route complete — you made it out, together.');
  });
});

describe('the composition CSS', () => {
  const css = readFileSync('apps/web/src/story/story.css', 'utf8');
  it('the shell is a column and the actions rest at the bottom of it', () => {
    expect(css).toMatch(/\.story-room-shell \{[^}]*display: flex; flex-direction: column/);
    expect(css).toMatch(/\.story-room-shell \.story-room-actions \{[^}]*margin-top: auto/);
  });
  it('the seats are a table grid and the room hero carries the stop art height', () => {
    expect(css).toMatch(/\.story-room-table \{[^}]*grid-template-areas: '\. top \.'/);
    expect(css).toMatch(/\.story-room-hero \{[^}]*min-height: 172px/);
  });
  it('the chosen stop rings the thread node, and the avatar circle clips on the element itself', () => {
    expect(css).toMatch(/\.story-gate-node\.is-here \{[^}]*outline: 2px solid #f5f4ff/);
    expect(css).toMatch(/\.story-room-av \{[^}]*border-radius: 50%; overflow: hidden/);
  });
});
