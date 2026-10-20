/**
 * @vitest-environment happy-dom
 *
 * Notifications OFF-state regression (owner report 2026-10-20: "I don't have
 * an option to turn notifications on"). The expanded Account → Notifications
 * dropdown showed only the blurb: the Enable button was clipped out of view
 * by the flex-shrink trap pinned in account-notif-css.test.ts, and in the
 * denied state the section rendered a button that could only fail. These
 * renders pin the usable surface of every state against a mocked push layer:
 *   OFF (permission default, no subscription) → a tappable, enabled
 *     "Enable notifications" button that runs the real enable flow and flips
 *     the section to ON;
 *   denied → plain guidance text INSTEAD of the dead button;
 *   ON (granted + subscribed) → the per-type switches, Send test, and
 *     Turn off on this device all render and work.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pushState = vi.hoisted(() => ({
  perm: 'default' as 'default' | 'granted' | 'denied',
  subscribed: false,
  enableCalls: 0,
  disableCalls: 0,
  testCalls: 0,
}));

vi.mock('../src/push/push', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/push/push')>();
  return {
    ...actual,
    pushSupported: () => true,
    permissionState: async () => pushState.perm,
    hasSubscription: async () => pushState.subscribed,
    enablePush: async () => {
      pushState.enableCalls += 1;
      pushState.perm = 'granted';
      pushState.subscribed = true;
      return null;
    },
    disablePush: async () => {
      pushState.disableCalls += 1;
      pushState.subscribed = false;
    },
    loadPrefs: async () =>
      Object.fromEntries(actual.NOTIF_TYPES.map(({ type }) => [type, true])) as Record<string, boolean>,
    savePref: async () => undefined,
    sendTestPush: async () => {
      pushState.testCalls += 1;
      return null;
    },
  };
});

const { NotificationsSection } = await import('../src/account/AccountUI');
const { NOTIF_TYPES } = await import('../src/push/push');

let root: Root | null = null;
let el: HTMLDivElement | null = null;

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

async function renderSection() {
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
  await act(async () => {
    root!.render(createElement(NotificationsSection));
  });
  await flush();
  await flush();
  return el;
}

const byId = (c: HTMLElement, tid: string) =>
  c.querySelector(`[data-testid="${tid}"]`) as HTMLElement | null;

async function tap(node: HTMLElement) {
  await act(async () => {
    node.click();
  });
  await flush();
  await flush();
}

beforeEach(() => {
  pushState.perm = 'default';
  pushState.subscribed = false;
  pushState.enableCalls = 0;
  pushState.disableCalls = 0;
  pushState.testCalls = 0;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
});

describe('Account notifications section states', () => {
  it('OFF state renders an enabled, tappable turn-on control that flips the section ON', async () => {
    const c = await renderSection();
    const toggle = byId(c, 'push-dropdown-toggle')!;
    expect(toggle.textContent).toContain('Off');
    await tap(toggle);

    const enable = byId(c, 'push-enable') as HTMLButtonElement | null;
    expect(enable, 'OFF state must offer a turn-on control').not.toBeNull();
    expect(enable!.tagName).toBe('BUTTON');
    expect(enable!.disabled).toBe(false);
    expect(enable!.textContent).toContain('Enable notifications');

    await tap(enable!);
    expect(pushState.enableCalls).toBe(1);
    // the section now reads ON with the preference switches in place of the button
    expect(byId(c, 'push-enable')).toBeNull();
    expect(byId(c, 'push-prefs')).not.toBeNull();
    expect(byId(c, 'push-dropdown-toggle')!.textContent).toContain('On');
  });

  it('denied state shows guidance text instead of a dead enable button', async () => {
    pushState.perm = 'denied';
    const c = await renderSection();
    await tap(byId(c, 'push-dropdown-toggle')!);
    expect(byId(c, 'push-enable')).toBeNull();
    const body = byId(c, 'push-dropdown')!;
    expect(body.textContent).toContain('blocked for this site');
    expect(body.textContent).toContain('browser settings');
  });

  it('ON state renders every per-type switch plus Send test and Turn off', async () => {
    pushState.perm = 'granted';
    pushState.subscribed = true;
    const c = await renderSection();
    await tap(byId(c, 'push-dropdown-toggle')!);

    expect(byId(c, 'push-prefs')).not.toBeNull();
    const rows = c.querySelectorAll('[data-testid^="push-pref-"]');
    expect(rows.length).toBe(NOTIF_TYPES.length);
    for (const row of rows) expect(row.getAttribute('role')).toBe('switch');

    const test = byId(c, 'push-test') as HTMLButtonElement | null;
    const off = byId(c, 'push-disable') as HTMLButtonElement | null;
    expect(test).not.toBeNull();
    expect(off).not.toBeNull();
    await tap(test!);
    expect(pushState.testCalls).toBe(1);

    await tap(off!);
    expect(pushState.disableCalls).toBe(1);
    // turning off returns the section to the OFF surface with its enable button
    expect(byId(c, 'push-prefs')).toBeNull();
    expect(byId(c, 'push-enable')).not.toBeNull();
  });
});
