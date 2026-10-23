/**
 * @vitest-environment happy-dom
 *
 * STORY ACCESS REFRESH (owner report, 2026-10-23): "When I log in story
 * mode says coming soon but if I close the app and reopen it's available."
 *
 * Root cause: the story-access flag rides fetchVenueUnlocks() — a
 * module-level cache of /api/profile/me that was never invalidated. The
 * start screen's first read (signed out → 401 → null, i.e. locked) was
 * served for the page's whole lifetime, and the in-page sign-ins
 * (passkey sign-in / register) only updated the account store, whose
 * payload carries no storyAccess at all. A restart re-fetched with the
 * session cookie, so it converged — the interactive paths never did.
 *
 * The fix pinned here: the account store invalidates the venue/profile
 * cache at its set() choke point on every identity change, and the story
 * surfaces (Setup row, StoryHome, VenueSelect) re-read on identity
 * change, failing closed (unknown = locked) while the fresh flag loads.
 *
 * One file, one narrative — the module cache is shared by design, so the
 * sign-in story is told sequentially, the same split as story-lock.test.ts.
 */
import { createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { STORY_STOPS } from '@spades/bots';
import Setup from '../src/Setup';
import StoryHome from '../src/story/StoryHome';
import { VenueSelect } from '../src/VenueSelect';
import { DEFAULT_SETTINGS } from '../src/settings';
import { account, clearFirstSignIn, loadAccount, passkeyRegister, passkeySignIn, signOut, type AccountUser } from '../src/account/api';
import { fetchStoryAccess, type StoryProgress } from '../src/story/storyApi';
import { fetchVenueUnlocks } from '../src/venues';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(async () => ({ id: 'cred-1' })),
  startRegistration: vi.fn(async () => ({ id: 'cred-1' })),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTITLED: AccountUser = { id: 'u-entitled', username: 'M33CH', needsUsername: false, suggestion: null, createdAt: 1, progressImported: false, avatar: null, identities: [], passkeys: [] };
const PLAIN: AccountUser = { id: 'u-plain', username: 'Regular', needsUsername: false, suggestion: null, createdAt: 2, progressImported: false, avatar: null, identities: [], passkeys: [] };

type StopRow = StoryProgress['stops'][number];
const row = (stopId: string, over: Partial<StopRow> = {}): StopRow => {
  const s = STORY_STOPS.find((x) => x.id === stopId)!;
  return { stopId, n: s.n, state: 'locked', attempts: 0, clears: 0, firstClearedAt: null, ...over };
};
const progressPayload: StoryProgress = {
  track: 'solo',
  stops: STORY_STOPS.map((s) => row(s.id, s.id === 'porch' ? { state: 'current' } : {})),
  currentStop: 1,
  completed: false,
  completedAt: null,
  completionMark: null,
  finds: { eggs: [], feats: [] },
};

function jsonRes(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => body,
  } as unknown as Response;
}

/** The session cookie, as the server sees it. Verify/logout move it. */
let currentUser: AccountUser | null = null;
let signInUser: AccountUser = ENTITLED;
let registerUser: AccountUser = PLAIN;
let profileCalls = 0;

beforeAll(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/api/auth/config')) return jsonRes({ providers: ['google'], passkeys: true, accounts: true });
    if (url.includes('/api/auth/me')) return jsonRes({ user: currentUser });
    if (url.includes('/api/auth/logout')) { currentUser = null; return jsonRes({ ok: true }); }
    if (url.includes('/api/auth/progress')) return jsonRes({ progress: {} });
    if (url.includes('/passkey/login/options')) return jsonRes({ flow: 'f-1', options: {} });
    if (url.includes('/passkey/login/verify')) { currentUser = signInUser; return jsonRes({ user: signInUser }); }
    if (url.includes('/passkey/register/options')) return jsonRes({ flow: 'f-2', options: {} });
    if (url.includes('/passkey/register/verify')) { currentUser = registerUser; return jsonRes({ user: registerUser, outcome: 'new' }); }
    if (url.includes('/api/profile/me')) {
      profileCalls++;
      if (!currentUser) return jsonRes({}, 401);
      // the entitled account also holds the After Dark unlock item, so the
      // venue picker's lock state rides the same profile read.
      return jsonRes({ dev: false, storyAccess: currentUser.id === ENTITLED.id, unlocks: currentUser.id === ENTITLED.id ? [{ itemId: 'after-dark' }] : [] });
    }
    if (url.includes('/api/story/progress')) {
      if (!currentUser) return jsonRes({}, 401);
      return jsonRes(progressPayload);
    }
    if (url.includes('/api/story/session')) return jsonRes({ ok: true });
    return jsonRes({}, 404);
  });
});

const roots: Array<{ root: Root; el: HTMLDivElement }> = [];
async function flush(times = 4) {
  for (let i = 0; i < times; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}
async function mount(node: ReactNode) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push({ root, el });
  await act(async () => { root.render(node); });
  await flush();
  return el;
}
afterAll(() => {
  while (roots.length) { const { root, el } = roots.pop()!; act(() => root.unmount()); el.remove(); }
  vi.unstubAllGlobals();
});

const setupProps = {
  settings: DEFAULT_SETTINGS,
  onChange: () => {},
  tips: { on: false, asked: true },
  onTips: () => {},
  onStart: () => {},
};
const pjsOption = (el: HTMLElement) => [...el.querySelectorAll('option')].find((o) => o.textContent?.includes("Pj's"));

let setupEl: HTMLElement;
let storyEl: HTMLElement;
let venueEl: HTMLElement;

describe('story access refresh after interactive sign-in (sequential narrative)', () => {
  it('the pre-auth profile read is cached — and it says locked', async () => {
    await loadAccount(true); // baseline: resolved, signed out
    expect(account.get().user).toBeNull();
    expect(await fetchStoryAccess()).toBeNull(); // signed-out 401 → null (locked)
    expect(await fetchVenueUnlocks()).toBeNull();
    expect(profileCalls).toBe(1); // the second read was served from the cache
  });

  it('surfaces mounted signed out show the lock (the owner’s symptom)', async () => {
    setupEl = await mount(createElement(Setup, setupProps));
    expect(setupEl.querySelector('[data-testid="story-mode-locked"]')).toBeTruthy();
    expect(setupEl.querySelector('[data-testid="story-mode"]')).toBeNull();

    storyEl = await mount(createElement(StoryHome));
    expect(storyEl.querySelector('[data-testid="story-locked"]')).toBeTruthy();

    venueEl = await mount(createElement(VenueSelect, { value: 'classic', onChange: () => {}, testId: 'venue-pin' }));
    // No venue assertion here: with no profile at all the picker's state is
    // null, which it renders as open (the roll + server gates are what keep
    // a signed-out player out of The Pj's — pre-existing design). The
    // picker's stale-state pin is the PLAIN segment below.
  });

  it('passkey sign-in converges the SAME mounted surfaces — no reload, no remount', async () => {
    signInUser = ENTITLED;
    await act(async () => { await passkeySignIn(); });
    await flush(6);

    expect(account.get().user?.id).toBe(ENTITLED.id);
    // Home row: locked row gone, the player row in its place.
    expect(setupEl.querySelector('[data-testid="story-mode-locked"]')).toBeNull();
    expect(setupEl.querySelector('[data-testid="story-mode"]')).toBeTruthy();
    // /story: the lock screen gives way to the mode gate, then the map.
    expect(storyEl.querySelector('[data-testid="story-locked"]')).toBeNull();
    const gate = storyEl.querySelector('[data-testid="story-gate-solo"]');
    if (gate) { await act(async () => { (gate as HTMLElement).click(); }); await flush(); }
    expect(storyEl.querySelector('[data-testid="story-map"]')).toBeTruthy();
    expect(storyEl.querySelector('[data-testid="story-signed-out"]')).toBeNull();
    // Venue picker: the same profile read now carries the unlock.
    expect(pjsOption(venueEl)?.hasAttribute('disabled')).toBe(false);
    // And the flag itself now reads the server's truth — via a FRESH fetch,
    // not the poisoned cache (the call count moved past the pre-auth read).
    expect(await fetchStoryAccess()).toBe(true);
    expect(profileCalls).toBeGreaterThan(1);
  });

  it('sign-out converges back to locked on the same mounted surfaces', async () => {
    await act(async () => { await signOut(); });
    await flush(6);
    expect(account.get().user).toBeNull();
    expect(setupEl.querySelector('[data-testid="story-mode-locked"]')).toBeTruthy();
    expect(setupEl.querySelector('[data-testid="story-mode"]')).toBeNull();
    expect(await fetchStoryAccess()).toBeNull();
  });

  it('a non-entitled account registering in-page stays locked — on a FRESH read, not the stale one', async () => {
    registerUser = PLAIN;
    const callsBefore = profileCalls;
    await act(async () => { await passkeyRegister('Regular'); });
    await flush(6);
    expect(account.get().user?.id).toBe(PLAIN.id);
    expect(setupEl.querySelector('[data-testid="story-mode-locked"]')).toBeTruthy();
    // storyAccess is a real false from the server for this account — proof
    // the read re-happened for the new identity (the stale signed-out read
    // was null, and null would also render locked; the distinction is the
    // fresh profile fetch and the false value itself).
    expect(await fetchStoryAccess()).toBe(false);
    expect(profileCalls).toBeGreaterThan(callsBefore);
    // The venue picker (mounted since the signed-out segment, through the
    // entitled session) must show THIS account's lock state — a profile
    // with no After Dark item disables The Pj's. Had it kept the entitled
    // account's read, the option would still be enabled here.
    expect(pjsOption(venueEl)?.hasAttribute('disabled')).toBe(true);
    await act(async () => { await signOut(); });
    await flush();
  });

  it('an OAuth return converges too — even from a cache the signed-out page already poisoned', async () => {
    // In production the OAuth return is a fresh page load; this is the
    // stricter in-page form: the venue cache currently holds the signed-out
    // read, and the interactive completion must still converge.
    expect(await fetchStoryAccess()).toBeNull(); // poisoned cache in place
    currentUser = ENTITLED; // the provider callback set the session cookie
    history.replaceState(null, '', '/?signin=ok');
    await loadAccount(true);
    expect(account.get().user?.id).toBe(ENTITLED.id);
    expect(account.get().firstSignIn?.id).toBe(ENTITLED.id); // interactive, not a restore
    expect(await fetchStoryAccess()).toBe(true);
    clearFirstSignIn(); // the entry flow consumes the marker
    await act(async () => { await signOut(); });
    await flush();
  });

  it('the restore path is unchanged: a cold load with a live session reads the truth first try', async () => {
    currentUser = ENTITLED; // the cookie a reopened app presents
    history.replaceState(null, '', '/'); // no ?signin= — a silent restore
    await loadAccount(true);
    expect(account.get().user?.id).toBe(ENTITLED.id);
    expect(account.get().firstSignIn).toBeNull(); // restore never raises the marker
    const freshSetup = await mount(createElement(Setup, setupProps));
    expect(freshSetup.querySelector('[data-testid="story-mode-locked"]')).toBeNull();
    expect(freshSetup.querySelector('[data-testid="story-mode"]')).toBeTruthy();
    expect(await fetchStoryAccess()).toBe(true);
  });
});
