import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The crash reporter (src/telemetry.ts) runs in the browser at boot; here it
 * runs against stubbed globals so the payload, dedupe, caps, transport
 * fallback, never-throw rule, and the unclean-exit witness are all pinned.
 */

type Listener = (ev: never) => void;

function makeBrowser() {
  const winListeners = new Map<string, Listener[]>();
  const docListeners = new Map<string, Listener[]>();
  const store = new Map<string, string>();
  const beacon = vi.fn((_url: string, _body: Blob) => true);
  const fetcher = vi.fn(async (_url: string, _init: unknown) => ({ ok: true }));
  const addTo = (map: Map<string, Listener[]>) => (type: string, f: Listener) => {
    map.set(type, [...(map.get(type) ?? []), f]);
  };
  const win = {
    addEventListener: addTo(winListeners),
    innerWidth: 932, innerHeight: 430, devicePixelRatio: 3,
  };
  const doc = { addEventListener: addTo(docListeners), visibilityState: 'visible' };
  const nav = { userAgent: 'crash-test-agent', platform: 'iPhone', sendBeacon: beacon };
  const loc = { pathname: '/t/ABCD' };
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = win;
  g.document = doc;
  g.location = loc;
  g.localStorage = storage;
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  g.fetch = fetcher;
  const fire = (type: string, ev: unknown) => {
    for (const f of winListeners.get(type) ?? []) (f as (e: unknown) => void)(ev);
  };
  return { beacon, fetcher, fire, store, nav, winListeners };
}

async function freshTelemetry() {
  vi.resetModules();
  return import('../src/telemetry');
}

async function beaconPayloads(beacon: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const call of beacon.mock.calls) {
    const blob = call[1] as Blob;
    out.push(JSON.parse(await blob.text()) as Record<string, unknown>);
  }
  return out;
}

describe('crash telemetry', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  let b: ReturnType<typeof makeBrowser>;
  beforeEach(() => { b = makeBrowser(); });

  it('installs window handlers and reports an error with context + crumbs', async () => {
    const t = await freshTelemetry();
    t.installCrashTelemetry();
    b.fire('error', { error: new Error('boom at the table'), filename: 'Table.js', lineno: 7, colno: 3 });
    expect(b.beacon).toHaveBeenCalledTimes(1);
    expect(b.beacon.mock.calls[0]![0]).toBe('/api/crashes');
    const [p] = await beaconPayloads(b.beacon);
    expect(p!.kind).toBe('error');
    expect(p!.message).toBe('boom at the table');
    expect(p!.route).toBe('/t/ABCD');
    expect(p!.build).toBeDefined();
    expect((p!.context as Record<string, unknown>).table).toBe('ABCD');
    const crumbs = p!.crumbs as { label: string }[];
    expect(crumbs.some((c) => c.label === 'boot')).toBe(true);
    expect(crumbs.some((c) => c.label === 'report')).toBe(true);
  });

  it('reports unhandled rejections', async () => {
    const t = await freshTelemetry();
    t.installCrashTelemetry();
    b.fire('unhandledrejection', { reason: new Error('socket died laughing') });
    const [p] = await beaconPayloads(b.beacon);
    expect(p!.kind).toBe('rejection');
    expect(p!.message).toBe('socket died laughing');
  });

  it('dedupes the same kind+message for a minute', async () => {
    const t = await freshTelemetry();
    t.installCrashTelemetry();
    t.reportCrash('error', new Error('same crash'));
    vi.advanceTimersByTime(10_000);
    t.reportCrash('error', new Error('same crash'));
    expect(b.beacon).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    t.reportCrash('error', new Error('same crash'));
    expect(b.beacon).toHaveBeenCalledTimes(2);
  });

  it('caps sends per session', async () => {
    const t = await freshTelemetry();
    t.installCrashTelemetry();
    for (let i = 0; i < 15; i++) {
      t.reportCrash('error', new Error(`crash ${i}`));
      vi.advanceTimersByTime(3_500);
    }
    expect(b.beacon).toHaveBeenCalledTimes(12);
  });

  it('falls back to fetch keepalive when sendBeacon declines, and never throws when both fail', async () => {
    const t = await freshTelemetry();
    t.installCrashTelemetry();
    b.nav.sendBeacon = vi.fn(() => false) as never;
    t.reportCrash('boundary', new Error('route blew up'));
    expect(b.fetcher).toHaveBeenCalledTimes(1);
    expect((b.fetcher.mock.calls[0]![1] as { keepalive: boolean }).keepalive).toBe(true);
    b.nav.sendBeacon = vi.fn(() => { throw new Error('beacon exploded'); }) as never;
    b.fetcher.mockImplementation(async () => { throw new Error('network gone'); });
    expect(() => t.reportCrash('error', new Error('double failure'))).not.toThrow();
  });

  it('keeps the breadcrumb ring capped and ordered', async () => {
    const t = await freshTelemetry();
    for (let i = 0; i < 55; i++) t.noteCrumb('tick', String(i));
    const crumbs = t.getCrashCrumbs();
    expect(crumbs.length).toBe(40);
    expect(crumbs[crumbs.length - 1]!.detail).toBe('54');
  });

  it('witnesses a previous session that died at a table', async () => {
    b.store.set('bwm.crash.watch', JSON.stringify({ atTable: true, route: '/t/ABCD', build: 'oldsha', ts: Date.now(), suspendedClean: false }));
    const t = await freshTelemetry();
    t.installCrashTelemetry();
    const payloads = await beaconPayloads(b.beacon);
    expect(payloads.length).toBe(1);
    expect(payloads[0]!.kind).toBe('unclean-exit');
    expect((payloads[0]!.extra as Record<string, unknown>).prevRoute).toBe('/t/ABCD');
  });

  it('stays silent when the previous session left cleanly', async () => {
    b.store.set('bwm.crash.watch', JSON.stringify({ atTable: true, route: '/t/ABCD', build: 'oldsha', ts: Date.now(), suspendedClean: true }));
    const t = await freshTelemetry();
    t.installCrashTelemetry();
    expect(b.beacon).not.toHaveBeenCalled();
  });

  it('scene mount marks the session at-table for the witness', async () => {
    const t = await freshTelemetry();
    t.installCrashTelemetry();
    t.noteCrumb('scene-mount', 'classic high');
    const watch = JSON.parse(b.store.get('bwm.crash.watch')!) as { atTable: boolean };
    expect(watch.atTable).toBe(true);
    t.noteCrumb('scene-unmount');
    const watch2 = JSON.parse(b.store.get('bwm.crash.watch')!) as { atTable: boolean };
    expect(watch2.atTable).toBe(false);
  });
});
