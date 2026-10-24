/**
 * @vitest-environment happy-dom
 *
 * The co-op partner step's composition (owner, 2026-10-24 — "This
 * screen is still trash but I like the next screen that stages the
 * players"): the step meets the gate's and the room lobby's standard.
 *  - the title stands in a hero over a stop backdrop: the Porch for a
 *    player with no pair run (every pair starts there), the focus
 *    run's current stop when a run is further along — and the hero
 *    line is that run's real standing, or nothing while tracks load;
 *  - Dee presents the run: her portrait + the explainer's facts in her
 *    guide's voice (seats across, Dee guides, progress belongs to the
 *    pair, a new partner starts at the Porch) — the wall of text is
 *    gone;
 *  - friend rows carry real faces (uploaded picture or initial), real
 *    presence composed by friendPresenceView (live hub row → fresh
 *    persisted activity → last online), and the pair's real standing
 *    when a run exists with that friend;
 *  - a run row states where the pair stands, stops cleared together
 *    included (sequential unlock makes the count exact);
 *  - the join code is entered on the lobby's dashed ticket.
 * Function is frozen (pinned in story-coop.test.ts): same testids,
 * invite/share/join flows, the run → pair-map door, the solo-toggle
 * rule, and the ?coop= join error surfacing here.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import StoryHome from '../src/story/StoryHome';
import type { StoryProgress, StoryTracks } from '../src/story/storyApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const row = (stopId: string, over: Partial<StoryProgress['stops'][number]> = {}) => {
  const s = STORY_STOPS.find((x) => x.id === stopId)!;
  return { stopId, n: s.n, state: 'locked' as const, attempts: 0, clears: 0, firstClearedAt: null, ...over };
};
const soloProgress: StoryProgress = {
  track: 'solo',
  stops: STORY_STOPS.map((s) => row(s.id, s.id === 'porch' ? { state: 'current' } : {})),
  currentStop: 1, completed: false, completedAt: null, completionMark: null,
  finds: { eggs: [], feats: [] },
};
const pairProgress: StoryProgress = { ...soloProgress, track: 'pair:a:l714' };

const PIC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  url: string;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) { this.url = url; FakeWebSocket.instances.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
}

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
  sessionStorage.clear();
  history.replaceState(null, '', '/');
});
const settle = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
const click = async (node: Element) => { await act(async () => { (node as HTMLElement).click(); }); await settle(10); };
const byTestid = (id: string) => el!.querySelector(`[data-testid="${id}"]`);
const q = (sel: string) => el!.querySelector(sel);

function stubFetch(opts: { tracks: StoryTracks; joinOk?: boolean } = { tracks: { solo: { track: 'solo', currentStop: 1, completed: false }, pairs: [] } }) {
  vi.stubGlobal('fetch', async (input: unknown) => {
    const url = String(input);
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (url.includes('/api/profile/me')) return ok({ dev: false, storyAccess: true, unlocks: [], user: { id: 'a', username: 'A' } });
    if (url.includes('/api/profile/')) {
      const uid = decodeURIComponent(url.split('/api/profile/')[1] ?? '');
      return ok({ user: { id: uid, avatar: uid === 'l714' ? PIC : null, avatarUpdatedAt: 1 } });
    }
    if (url.includes('/api/story/progress')) return ok(url.includes('pair') ? pairProgress : soloProgress);
    if (url.includes('/api/story/tracks')) return ok(opts.tracks);
    if (url.includes('/api/story/room-join')) {
      return opts.joinOk === false
        ? { ok: false, status: 409, json: async () => ({ error: 'This story table is spoken for.' }) }
        : ok({ ok: true, code: 'ABCDE', track: 'pair:a:l714', stopId: 'porch' });
    }
    if (url.includes('/api/social/ticket')) return ok({});
    return { ok: false, status: 404, json: async () => ({}) };
  });
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

/** Feed the social hub's hello: friends + live presence for this test. */
async function deliverHello(friends: unknown[], users: unknown[]) {
  await settle(60);
  const sock = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  expect(sock, 'social socket exists').toBeTruthy();
  const hello = {
    t: 'hello',
    you: { id: 'u:a', name: 'A', guest: false, status: { kind: 'online' } },
    admin: false,
    users,
    global: [],
    friends: { friends, incoming: [], outgoing: [], blocked: [], muted: [] },
    settings: null,
    unread: {},
  };
  await act(async () => { sock!.onmessage?.({ data: JSON.stringify(hello) }); });
  await settle();
}

async function toPartnerStep() {
  await click(byTestid('story-gate-coop')!);
  await settle();
  expect(byTestid('story-coop-partner')).toBeTruthy();
}

describe('the partner step, composed', () => {
  it('fresh player (the owner\u2019s screenshot state): Porch hero, Dee presents, faced friends, ticket join', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    stubFetch();
    await renderStoryHome();
    await toPartnerStep();
    await deliverHello(
      [{ id: 'u:jah', name: 'jahdini' }, { id: 'u:l714', name: 'LovleyT714' }],
      [],
    );

    // hero: the Porch (no pair runs), with the honest no-runs line
    const heroBg = q('[data-testid="story-coop-home"] .story-hero-bg') as HTMLElement | null;
    expect(heroBg).toBeTruthy();
    expect(heroBg!.style.backgroundImage).toContain('/assets/story/venues/porch.jpg');
    expect(byTestid('story-coop-hero-line')!.textContent).toContain('No pair runs yet');

    // Dee presents the run — her face, her name line, the explainer's
    // facts in her voice; the old wall-of-text lede is gone
    const dee = byTestid('story-coop-dee');
    expect(dee).toBeTruthy();
    expect(dee!.querySelector('[data-testid="story-face-dee"]')).toBeTruthy();
    expect(dee!.textContent).toContain('Dee · your guide');
    expect(dee!.textContent).toContain('seats across from each other');
    expect(dee!.textContent).toContain('earn as a pair');
    expect(dee!.textContent).toContain('start together at the Porch');
    expect(q('.story-coop-lede')).toBeNull();

    // no runs yet → no runs section; the machinery is all present
    expect(q('.story-coop-runs')).toBeNull();
    expect(byTestid('story-coop-share-start')).toBeTruthy();
    expect(byTestid('story-coop-code')).toBeTruthy();
    expect(byTestid('story-coop-join')).toBeTruthy();
    // the join form sits on the lobby's ticket
    expect(byTestid('story-coop-code')!.closest('.story-coop-ticket')).toBeTruthy();

    // friend rows: faces + honest presence (no stamps anywhere → Offline)
    const jahRow = byTestid('story-coop-invite-u:jah')!.closest('.story-coop-friend')!;
    expect(jahRow.querySelector('.story-coop-av')).toBeTruthy();
    expect(jahRow.querySelector('.story-coop-av')!.textContent).toBe('J');
    expect(byTestid('story-coop-presence-u:jah')!.textContent).toBe('Offline');
    expect(byTestid('story-coop-friend-run-u:jah')).toBeNull();
    expect(byTestid('story-coop-friend-run-u:l714')).toBeNull();

    // fresh solo → the escape hatch stands (the shipped rule, unregressed)
    expect(byTestid('story-mode-solo')).toBeTruthy();
  });

  it('a run in progress: hero stands at the run\u2019s stop, rows carry standing and live presence', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    stubFetch({
      tracks: {
        solo: { track: 'solo', currentStop: 1, completed: false },
        pairs: [
          { track: 'pair:a:l714', partnerUid: 'l714', partnerHandle: 'LovleyT714', currentStop: 7, completed: false, lastPlayedAt: 99 },
          { track: 'pair:a:c', partnerUid: 'c', partnerHandle: 'Cee', currentStop: 1, completed: false, lastPlayedAt: 5 },
        ],
      },
    });
    await renderStoryHome();
    await toPartnerStep();
    await deliverHello(
      [
        { id: 'u:l714', name: 'LovleyT714' },
        { id: 'u:jah', name: 'jahdini', presence: { activity: 'story-coop', at: Date.now() } },
      ],
      [{ id: 'u:l714', name: 'LovleyT714', guest: false, status: { kind: 'online' }, at: Date.now() }],
    );

    // hero: the focus run's stop (the Rooftop), its standing as the line
    const heroBg = q('[data-testid="story-coop-home"] .story-hero-bg') as HTMLElement | null;
    expect(heroBg!.style.backgroundImage).toContain('/assets/story/venues/rooftop.jpg');
    expect(byTestid('story-coop-hero-line')!.textContent).toContain('LovleyT714');
    expect(byTestid('story-coop-hero-line')!.textContent).toContain('The Rooftop');

    // run rows: faces, and facts with the cleared-together count
    const run = byTestid('story-coop-run-l714')!;
    expect(run.querySelector('.story-coop-av')).toBeTruthy();
    expect(run.textContent).toContain('With LovleyT714');
    expect(run.textContent).toContain('At stop 7 — The Rooftop');
    expect(run.textContent).toContain('6 of 11 cleared together');
    expect(byTestid('story-coop-run-c')!.textContent).toContain('where the run starts');

    // friend rows: LovleyT714 is live-online with her picture and the
    // pair's standing; jahdini's fresh persisted activity reads as
    // story co-op — neither state is invented
    const l714Row = byTestid('story-coop-invite-u:l714')!.closest('.story-coop-friend')!;
    expect(l714Row.querySelector('.story-coop-av img')).toBeTruthy();
    expect(l714Row.querySelector('.story-coop-dot')).toBeTruthy();
    expect(byTestid('story-coop-presence-u:l714')!.textContent).toBe('Online');
    expect(byTestid('story-coop-friend-run-u:l714')!.textContent).toContain('Running together — at The Rooftop');
    expect(byTestid('story-coop-presence-u:jah')!.textContent).toBe('Story mode · Co-op');
    expect(byTestid('story-coop-friend-run-u:jah')).toBeNull();

    // the run door still opens the pair map (function frozen)
    await click(run);
    expect(byTestid('story-coop-map')).toBeTruthy();
  });

  it('a failed ?coop= join still surfaces its error on this screen', async () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    stubFetch({ tracks: { solo: { track: 'solo', currentStop: 1, completed: false }, pairs: [] }, joinOk: false });
    await renderStoryHome('?coop=XXXXX');
    await settle();
    expect(byTestid('story-coop-partner')).toBeTruthy();
    const err = byTestid('story-coop-error');
    expect(err).toBeTruthy();
    expect(err!.textContent).toContain('This story table is spoken for.');
  });
});

describe('composition pins (story.css)', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../src/story/story.css'), 'utf8');
  const rule = (sel: string) => [...css.matchAll(new RegExp(`\\${sel}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[1]).join(';');

  it('the shell is a column and the share section rests in the bottom zone (no void)', () => {
    expect(rule('.story-coop-shell')).toContain('flex-direction: column');
    expect(rule('.story-coop-share')).toContain('margin-top: auto');
    expect(rule('.story-coop')).toContain('flex: 1');
  });

  it('the hero matches the gate/lobby measure: tall, content settled low, art graded', () => {
    expect(rule('.story-coop-hero')).toContain('min-height: 172px');
    expect(rule('.story-coop-hero')).toContain('justify-content: flex-end');
    expect(css).toMatch(/\.story-coop-hero \.story-hero-bg\s*\{\s*opacity: 0\.55;/);
  });

  it('row faces clip on the element itself (the 2026-10-24 avatar lesson)', () => {
    expect(rule('.story-coop-av')).toContain('border-radius: 50%');
    expect(rule('.story-coop-av')).toContain('overflow: hidden');
  });

  it('the join ticket is the lobby\u2019s dashed gold ticket', () => {
    expect(rule('.story-coop-ticket')).toContain('border: 1px dashed rgba(232, 200, 90, 0.55)');
    expect(rule('.story-coop-ticket')).toContain('border-radius: 14px');
  });
});
