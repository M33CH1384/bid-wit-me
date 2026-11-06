/**
 * @vitest-environment happy-dom
 *
 * LayerGuard (crash hardening, 2026-11-06): a render throw in a globally
 * mounted layer (Social, the ticker, a transition layer) must not
 * unmount the app. Before the guard, every one of those layers sat
 * outside the routed tree's RouteGuard, so one throw = white screen.
 */
import { createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LayerGuard } from '../src/LayerGuard';

// Telemetry is stubbed: the guard must REPORT the failure (asserted
// below), but a unit test must not fire real crash sends at a dev API.
const reportCrashSpy = vi.hoisted(() => vi.fn());
vi.mock('../src/telemetry', () => ({ reportCrash: reportCrashSpy }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: { root: Root; host: HTMLElement }[] = [];
function mount(node: ReturnType<typeof createElement>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  roots.push({ root, host });
  act(() => { root.render(node); });
  return host;
}

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); reportCrashSpy.mockClear(); });
afterEach(() => {
  for (const { root, host } of roots) { act(() => root.unmount()); host.remove(); }
  roots = [];
  vi.restoreAllMocks();
});

function Boom(): never { throw new Error('layer exploded'); }

describe('LayerGuard containment', () => {
  it('a throwing layer renders its fallback and the rest of the app survives', () => {
    const host = mount(createElement('div', null,
      createElement(LayerGuard, { name: 'broken', fallback: createElement('p', { 'data-testid': 'fb' }, 'layer unavailable') },
        createElement(Boom)),
      createElement('p', { 'data-testid': 'sibling' }, 'game still here'),
    ));
    expect(host.querySelector('[data-testid="fb"]')?.textContent).toBe('layer unavailable');
    expect(host.querySelector('[data-testid="sibling"]')?.textContent).toBe('game still here');
    // and the failure is reported through the boundary telemetry kind
    expect(reportCrashSpy).toHaveBeenCalledWith('boundary', expect.any(Error), expect.objectContaining({ layer: 'broken' }));
  });

  it('default fallback is nothing: the layer vanishes, the app lives', () => {
    const host = mount(createElement('div', null,
      createElement(LayerGuard, { name: 'quiet' }, createElement(Boom)),
      createElement('p', { 'data-testid': 'sibling' }, 'alive'),
    ));
    expect(host.querySelector('[data-testid="sibling"]')?.textContent).toBe('alive');
  });

  it('retry remounts the subtree fresh', () => {
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('first mount only');
      return createElement('p', { 'data-testid': 'flaky' }, 'recovered');
    }
    let retryFn: (() => void) | null = null;
    const host = mount(createElement(LayerGuard, {
      name: 'flaky',
      fallback: (retry: () => void) => { retryFn = retry; return createElement('p', { 'data-testid': 'fb' }, 'down'); },
    }, createElement(Flaky)));
    expect(host.querySelector('[data-testid="fb"]')).not.toBeNull();
    shouldThrow = false;
    act(() => { retryFn!(); });
    expect(host.querySelector('[data-testid="flaky"]')?.textContent).toBe('recovered');
  });

  it('state inside the guard survives an unrelated sibling update', () => {
    let bump: (() => void) | null = null;
    function Counter() {
      const [n, setN] = useState(0);
      bump = () => setN(n + 1);
      return createElement('p', { 'data-testid': 'n' }, String(n));
    }
    const host = mount(createElement(LayerGuard, { name: 'ok' }, createElement(Counter)));
    act(() => { bump!(); });
    expect(host.querySelector('[data-testid="n"]')?.textContent).toBe('1');
  });
});

describe('main.tsx wiring (source pins)', () => {
  // (repo-root-relative path: under happy-dom import.meta.url is not a
  // file URL — the escape-close.test.ts pattern)
  const main = readFileSync('apps/web/src/main.tsx', 'utf8');

  it('Social and the ticker mount inside guards, not bare', () => {
    expect(main).toContain('name="social"');
    expect(main).toContain('<SocialRoot />');
    expect(main).toContain('name="ticker"');
    expect(main).toContain('<LeagueTickerRoot />');
    // every global layer after the routed tree is guarded: at least as
    // many guards as the layers that used to sit outside RouteGuard
    expect((main.match(/<LayerGuard/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it('the whole Root renders inside the app-level guard', () => {
    expect(main).toContain('AppGuard');
    expect(main).toMatch(/<AppGuard>[\s\S]*<Root \/>/);
  });
});
