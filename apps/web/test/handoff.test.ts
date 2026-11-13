/**
 * Web half of the app-shell sign-in handoff (owner decision 2026-11-10).
 * Pins the pure pieces in src/account/handoff.ts + handoffPage.ts: shell
 * detection, the code's shapes (deep link + human-typed), the pending marker
 * that lets the sign-in sheet offer the typed-code box, and the mint page's
 * state machine — including that a signed-out visitor is asked to sign in,
 * never to create an account.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  SHELL_UA_MARKER, appReturnLink, formatHandoffCode, handoffCodeFromSearch, inAppShell,
  mintPageUrl, noteHandoffPending, handoffPending, clearHandoffPending, stripHandoffCode,
} from '../src/account/handoff';
import { startHandoffPage } from '../src/account/handoffPage';

const SHELL_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 BidWitMeApp';
const SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
  } as unknown as Storage;
}

describe('shell detection', () => {
  it('the marker is the exact string the native config appends', () => {
    expect(SHELL_UA_MARKER).toBe('BidWitMeApp');
  });
  it('only the app shell UA counts as the shell', () => {
    expect(inAppShell(SHELL_UA)).toBe(true);
    expect(inAppShell(SAFARI_UA)).toBe(false);
    expect(inAppShell(DESKTOP_UA)).toBe(false);
    expect(inAppShell('')).toBe(false);
  });
});

describe('code shapes', () => {
  it('the mint page lives on the game origin (where the passkey works)', () => {
    expect(mintPageUrl('https://bid-wit-me.pages.dev')).toBe('https://bid-wit-me.pages.dev/auth/handoff');
  });
  it('the return link is the custom scheme with the code (no entitlement needed)', () => {
    expect(appReturnLink('AbC123xYz_-9')).toBe('bidwitme://auth?code=AbC123xYz_-9');
  });
  it('codes print in groups of four for the type-it-in fallback', () => {
    expect(formatHandoffCode('AbC123xYz9')).toBe('AbC1 23xY z9');
    expect(formatHandoffCode('AbC1 23xY')).toBe('AbC1 23xY'); // already grouped: unchanged
  });
  it('the deep-link code is read from ?handoff= and only there', () => {
    expect(handoffCodeFromSearch('?handoff=AbC123')).toBe('AbC123');
    expect(handoffCodeFromSearch('?signin=ok')).toBe(null);
    expect(handoffCodeFromSearch('?handoff=')).toBe(null);
    expect(handoffCodeFromSearch('')).toBe(null);
  });
  it('stripping the code keeps the rest of the query intact', () => {
    expect(stripHandoffCode('?handoff=AbC123&x=1')).toBe('?x=1');
    expect(stripHandoffCode('?handoff=AbC123')).toBe('');
    expect(stripHandoffCode('?x=1')).toBe('?x=1');
  });
});

describe('pending marker (the sheet offers the typed-code box only while a handoff is in flight)', () => {
  it('fresh for ten minutes, then gone', () => {
    const s = fakeStorage();
    const t0 = 1_800_000_000_000;
    noteHandoffPending(t0, s);
    expect(handoffPending(t0 + 1_000, s)).toBe(true);
    expect(handoffPending(t0 + 10 * 60_000 - 1, s)).toBe(true);
    expect(handoffPending(t0 + 10 * 60_000 + 1, s)).toBe(false);
  });
  it('clearing retires it at once; junk in storage reads as no handoff', () => {
    const s = fakeStorage();
    noteHandoffPending(1_800_000_000_000, s);
    clearHandoffPending(s);
    expect(handoffPending(1_800_000_000_000, s)).toBe(false);
    s.setItem('bwm.handoffPending', 'not-a-number');
    expect(handoffPending(1_800_000_000_000, s)).toBe(false);
  });
  it('no storage at all (private mode) degrades to "not pending", never a throw', () => {
    expect(() => noteHandoffPending(1, null)).not.toThrow();
    expect(handoffPending(1, null)).toBe(false);
    expect(() => clearHandoffPending(null)).not.toThrow();
  });
});

describe('mint page state machine (handoffPage.ts)', () => {
  function fetchAs(me: unknown, mint: unknown) {
    return vi.fn(async (path: string) => {
      if (path === '/api/auth/me') return { json: async () => ({ user: me }) } as Response;
      if (path === '/api/auth/handoff/mint') return { json: async () => mint, ok: !(mint as { ok?: boolean }).ok === false } as unknown as Response;
      throw new Error(`unexpected fetch ${path}`);
    });
  }
  it('signed out → asked to sign in first (never to create an account)', async () => {
    const f = fetchAs(null, null);
    expect(await startHandoffPage(f as never)).toEqual({ phase: 'need-signin' });
    expect(f.mock.calls.map((c) => c[0])).toEqual(['/api/auth/me']); // no mint attempted
  });
  it('signed in → a fresh code, its return link and its printable form', async () => {
    const f = fetchAs({ id: 'u1' }, { ok: true, code: 'AbC123xYz9zz', expiresAt: 123 });
    const s = await startHandoffPage(f as never);
    expect(s).toEqual({ phase: 'ready', code: 'AbC123xYz9zz', link: 'bidwitme://auth?code=AbC123xYz9zz', pretty: 'AbC1 23xY z9zz', expiresAt: 123 });
  });
  it('a failed mint surfaces as an error state, not a dead page', async () => {
    const f = fetchAs({ id: 'u1' }, { ok: false, error: 'Sign in first.' });
    expect(await startHandoffPage(f as never)).toEqual({ phase: 'error', message: 'Sign in first.' });
  });
  it('a network failure reads as signed-out (the safe direction: ask for sign-in)', async () => {
    const f = vi.fn(async () => { throw new Error('offline'); });
    expect(await startHandoffPage(f as never)).toEqual({ phase: 'need-signin' });
  });
});
