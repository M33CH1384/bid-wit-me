/**
 * @vitest-environment happy-dom
 *
 * A spectator's redacted view (no hand, no legal plays, no bid options) is pushed
 * through a full hand into the scored recap. The live table stays mounted under
 * that recap. Neither step may enter a maximum-update-depth loop.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { applyAction, makeRules, newGame, pendingTurn, spectatorView, viewFor, type GameState, type PlayerView } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import type { RoomInfo } from '@spades/protocol';
import Table from '../src/Table';

vi.mock('../src/three/Scene', async () => {
  const React = await import('react');
  return {
    default: function Scene() {
      return React.createElement('div', { 'data-testid': 'scene-live' });
    },
    preloadTableAssets: () => Promise.resolve(),
  };
});

import { DEFAULT_SETTINGS } from '../src/settings';
import { useConn, useOnlineSource } from '../src/online/useOnline';
import type { ConnState, TableConnection } from '../src/online/connection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function advance(st: GameState): GameState {
  if (st.phase === 'handOver') return applyAction(st, { type: 'nextHand' });
  const t = pendingTurn(st);
  if (!t) return st;
  const a = chooseBotAction(viewFor(st, t.seat), 'pro');
  if (!a) return st;
  return applyAction(st, a);
}

function toPhase(st: GameState, phase: GameState['phase']): GameState {
  for (let i = 0; i < 20000 && st.phase !== phase && st.phase !== 'gameOver'; i++) st = advance(st);
  return st;
}

function roomFor(st: GameState, seq: number): RoomInfo {
  const n = st.rules.playerCount;
  const names = ['Dee', 'Ray', 'Kim', 'Jo'];
  return {
    code: 'WATCH1', phase: 'playing', game: 1, seq, hostId: 'p0',
    rules: st.rules,
    seats: Array.from({ length: n }, (_, i) => ({ kind: 'bot' as const, name: names[i] ?? `P${i}`, level: 'pro' as const })),
    ready: [], now: 1_000_000, deadline: 1_000_000 + 20_000,
    spectators: [{ playerId: 'spec', name: 'Wes' }],
    botLevel: 'pro', talkSec: 20,
  } as unknown as RoomInfo;
}

function makeConn(initial: ConnState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const conn = {
    subscribe: (f: () => void) => { listeners.add(f); return () => listeners.delete(f); },
    getState: () => state,
    send: () => {},
    act: () => false,
    code: 'WATCH1',
  } as unknown as TableConnection;
  return {
    conn,
    set(next: ConnState) {
      state = next;
      act(() => { listeners.forEach((f) => f()); });
    },
  };
}

/** Mirrors the socket: history is null on the wire when it did not grow. */
function watch(st: GameState, seq: number, prev?: PlayerView | null): ConnState {
  let view: PlayerView | null = spectatorView(st, 0);
  if (prev && view && prev.history.length === view.history.length) view = { ...view, history: null as unknown as PlayerView['history'] };
  if (view && view.history === null) view = { ...view, history: prev?.history ?? [] };
  return {
    status: 'open', you: 'spec', room: roomFor(st, seq), seat: null, view, chat: [], error: null, pending: false, spectator: true, statsOff: false, joinFault: null,
  };
}

function StableProbe({ conn, tick }: { conn: TableConnection; tick: { n: number } }) {
  tick.n++;
  const cs = useConn(conn);
  const source = useOnlineSource(cs, conn);
  if (tick.n > 80) throw new Error(`render depth ${tick.n} phase=${cs.view?.phase ?? 'none'}`);
  if (!source || !cs.room) return createElement('div', null, 'wait');
  const names = ['Dee', 'Ray', 'Kim', 'Jo'].slice(0, source.st.rules.playerCount);
  return createElement(Table, {
    rules: source.st.rules,
    seed: 'watch-seed',
    settings: { ...DEFAULT_SETTINGS, quality: 'low', speed: 'turbo' },
    onExit: () => {},
    onRematch: () => {},
    onQuality: () => {},
    online: {
      source,
      names,
      chat: { msgs: [], push: () => {} },
      seatExtra: () => null,
      sideLabel: (s: number) => names[s] ?? '?',
      spectator: true,
      botSeats: names.map((_, i) => i),
      venue: 'classic' as const,
      talk: { secs: 20, ready: { mine: false, count: 0, of: 1 }, tile: () => null },
    },
  });
}

let root: Root | null = null;
let el: HTMLDivElement | null = null;
const logs: string[] = [];
let restoreError: typeof console.error | null = null;

beforeEach(() => {
  logs.length = 0;
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  if (!document.fonts?.load) {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => Promise.resolve([]) } });
  }
  const grad = { addColorStop() {} };
  HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, {
    get(_target, prop) {
      if (prop === 'canvas') return document.createElement('canvas');
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => grad;
      return () => {};
    },
  })) as unknown as HTMLCanvasElement['getContext'];
  restoreError = console.error;
  console.error = (...args: unknown[]) => {
    const text = args.map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : String(a))).join(' ');
    logs.push(text);
    if (!/185|Maximum update depth/.test(text)) restoreError!(...args);
  };
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});

afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  root = null;
  el = null;
  if (restoreError) console.error = restoreError;
});

async function untilRecap() {
  const start = Date.now();
  while (Date.now() - start < 7000) {
    if (document.querySelector('[data-testid="table-talk"]')) return;
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
  }
}

describe('spectator update depth', () => {
  it('does not loop from a full hand into the scored recap, with the live table still mounted', async () => {
    const rules = makeRules('joker', { targetScore: 500, firstHandBidsItself: true, shotOut: false, firstHandMin: null });
    let st = newGame(rules, 'watch-loop');
    const tick = { n: 0 };
    const bag = makeConn(watch(st, 1));
    act(() => { root!.render(createElement(StableProbe, { conn: bag.conn, tick })); });

    let prev = bag.conn.getState().view;
    let seq = 2;
    // A few tricks in, still live, then the scored hand. History is elided on the wire when it did not grow.
    for (let i = 0; i < 12 && st.phase === 'playing'; i++) st = advance(st);
    expect(st.phase).toBe('playing');
    expect(spectatorView(st, 0).hand).toBeNull();
    tick.n = 0;
    bag.set(watch(st, seq++, prev));
    prev = bag.conn.getState().view;
    st = toPhase(st, 'handOver');
    expect(st.phase).toBe('handOver');
    expect(st.history.length).toBeGreaterThan(0);
    tick.n = 0;
    bag.set(watch(st, seq++, prev));

    expect(st.history.length).toBeGreaterThan(0);
    await untilRecap();
    expect(document.querySelector('[data-testid="table-talk"]'), 'scored recap').toBeTruthy();
    expect(document.body.textContent).toContain('RECAP');
    expect(document.querySelector('.table-screen'), 'live table under the recap').toBeTruthy();
    expect(document.querySelector('[data-testid="scene-live"]'), 'live scene under the recap').toBeTruthy();
    const loop = logs.find((l) => l.includes('185') || l.includes('Maximum update depth'));
    expect(loop, logs.slice(-4).join('\n')).toBeUndefined();
    expect(tick.n).toBeLessThan(80);
  });
});
