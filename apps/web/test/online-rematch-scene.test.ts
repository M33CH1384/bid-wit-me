// @vitest-environment happy-dom
/**
 * Online rematch scene regression (owner report 2026-11-03: "When im done
 * an online game and try to rematch the table wont load" — the table sits
 * on "Setting the table..." with live scorebug/plates while the felt
 * never deals).
 *
 * Mechanism: the client GameState online is built by rotateView with
 * `seed: ''` ON PURPOSE (the real seed would reveal the deck), and
 * TableGame published that as the Scene's gameSeed. The persistent
 * Scene (perf fix A) remounts its per-game resource subtree — and with
 * it TableModel's mount-only onReady certification — per gameSeed, so
 * online the key never changed across a room's games: game 2's fresh
 * TableGame waited forever for a tableReady that could only fire on a
 * remount that never came. Offline was immune (st.seed is real there),
 * which is why the offline rematch rig passed.
 *
 * This drives the REAL OnlineTable (real seed plumbing, real rotated
 * source) through game 1 -> over -> rematch game 2 with a Scene double
 * that keeps the real Scene's contract exactly: certifications fire
 * from a subtree keyed by gameSeed, on mount only. Pin: game 2's
 * placeholder lifts (tableReady fires) and the Scene is handed the
 * per-game identity `REMAT:2`.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, makeRules, newGame, pendingTurn, viewFor, type GameState } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import type { RoomInfo, SeatInfo } from '@spades/protocol';

const captured = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('../src/three/Scene', async () => {
  const React = await import('react');
  function TableModelDouble(props: Record<string, unknown>) {
    React.useEffect(() => {
      const p = props as { onTableReady?: () => void; onTableDressed?: () => void; onFirstFrame?: () => void };
      p.onTableDressed?.();
      // The real TableModel certifies ready after a double rAF, on mount only.
      const a = requestAnimationFrame(() => requestAnimationFrame(() => { p.onTableReady?.(); p.onFirstFrame?.(); }));
      return () => cancelAnimationFrame(a);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return React.createElement('div', { 'data-testid': 'scene-live' });
  }
  return {
    default: function Scene(props: Record<string, unknown>) {
      captured.current = props;
      // The real Scene: <Fragment key={props.gameSeed}> wraps the per-game
      // resource subtree (TableModel included); the Canvas persists.
      return React.createElement(React.Fragment, { key: String(props.gameSeed ?? '') }, React.createElement(TableModelDouble, props));
    },
    preloadTableAssets: () => Promise.resolve(),
  };
});
vi.mock('../src/effects/warm', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/effects/warm')>();
  return { ...orig, warmTableEffects: () => Promise.resolve({}) };
});
vi.mock('../src/assetGate', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/assetGate')>();
  return { ...orig, imageSettled: () => Promise.resolve(true), fetchSettled: () => Promise.resolve(true), assetSettled: () => Promise.resolve(true) };
});
vi.mock('../src/decks', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/decks')>();
  return { ...orig, whenDeckArtSettled: () => Promise.resolve({ total: 0, failed: [] as string[] }), whenDeckBackSettled: () => Promise.resolve(true) };
});

import OnlineTable from '../src/online/OnlineTable';
import { useConn } from '../src/online/useOnline';
import type { ConnState, TableConnection } from '../src/online/connection';
import { versusSeenKey } from '../src/VersusIntro';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CODE = 'REMAT';

function advance(st: GameState): GameState {
  if (st.phase === 'handOver') return applyAction(st, { type: 'nextHand' });
  const t = pendingTurn(st);
  if (!t) return st;
  const a = chooseBotAction(viewFor(st, t.seat), 'pro');
  if (!a) return st;
  return applyAction(st, a);
}

const seats: SeatInfo[] = [
  { kind: 'human', playerId: 'p0', name: 'Demetrius', connected: true, media: { cam: false, mic: false }, uid: 'u0' },
  { kind: 'bot', name: 'Imani', level: 'pro' },
  { kind: 'human', playerId: 'p2', name: 'LovleyT714', connected: true, media: { cam: false, mic: false }, uid: 'u2' },
  { kind: 'bot', name: 'Kofi', level: 'pro' },
];

function roomFor(st: GameState, game: number, phase: 'playing' | 'over', seq: number): RoomInfo {
  return {
    code: CODE, phase, game, seq, hostId: 'p0',
    rules: st.rules, seats, ready: [],
    members: [
      { playerId: 'p0', name: 'Demetrius', connected: true, seat: 0 },
      { playerId: 'p2', name: 'LovleyT714', connected: true, seat: 2 },
    ],
    now: Date.now(), deadline: Date.now() + 30_000, turnClockStart: null, turnSec: 30,
    spectators: [], botLevel: 'pro', talkSec: 20, venue: 'classic',
  } as unknown as RoomInfo;
}

function stateFor(st: GameState, game: number, phase: 'playing' | 'over', seq: number): ConnState {
  return {
    status: 'open', you: 'p0', seat: 0, spectator: false,
    room: roomFor(st, game, phase, seq),
    view: viewFor(st, 0),
    chat: [], error: null, pending: false, statsOff: false, joinFault: null,
    socketGen: 1, playGate: 0, run: null,
  } as unknown as ConnState;
}

function makeConn(initial: ConnState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const conn = {
    subscribe: (f: () => void) => { listeners.add(f); return () => listeners.delete(f); },
    getState: () => state,
    send: () => {},
    act: () => false,
    code: CODE,
  } as unknown as TableConnection;
  return {
    conn,
    set(next: ConnState) {
      state = next;
      act(() => { listeners.forEach((f) => f()); });
    },
  };
}

function Harness({ conn }: { conn: TableConnection }) {
  const cs = useConn(conn);
  if (!cs.room || !cs.view) return createElement('div', null, 'wait');
  return createElement(OnlineTable, {
    conn, cs, mesh: null,
    onLobby: () => {}, onMainMenu: () => {},
    initialSettings: { quality: 'low' as const },
  });
}

let root: Root | null = null;
let el: HTMLDivElement | null = null;

beforeEach(() => {
  captured.current = null;
  try {
    sessionStorage.setItem(versusSeenKey(`${CODE}:1`), '1');
    sessionStorage.setItem(versusSeenKey(`${CODE}:2`), '1');
    localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} }));
  } catch { /* storage off */ }
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
  if (!document.fonts?.load) {
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load: () => Promise.resolve([]), ready: Promise.resolve() } });
  }
  const grad = { addColorStop() {} };
  HTMLCanvasElement.prototype.getContext = ((() => new Proxy({}, {
    get(_target, prop) {
      if (prop === 'canvas') return document.createElement('canvas');
      if (prop === 'createRadialGradient' || prop === 'createLinearGradient') return () => grad;
      return () => {};
    },
  })) as unknown) as HTMLCanvasElement['getContext'];
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => { act(() => root?.unmount()); el?.remove(); root = null; el = null; captured.current = null; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, timeoutMs = 9000, stepMs = 40): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await act(async () => { await sleep(stepMs); });
  }
  return fn();
}

const placeholderGone = () => document.querySelector('.table-placeholder')?.classList.contains('gone') ?? false;
const settingNote = () => document.querySelector('.tp-note')?.textContent ?? null;

describe('online rematch: the second game in a room loads', () => {
  it('game 2 gets its own scene identity and its tableReady certification', async () => {
    const rules = makeRules('joker', { targetScore: 100 });
    let g1 = newGame(rules, 'srv-game-1');
    const bag = makeConn(stateFor(g1, 1, 'playing', 1));
    act(() => { root!.render(createElement(Harness, { conn: bag.conn })); });

    // Game 1 loads: the scene certifies and the placeholder lifts.
    expect(await until(placeholderGone), 'game 1 placeholder lifts').toBe(true);
    expect(captured.current?.gameSeed, 'game 1 scene identity').toBe(`${CODE}:1`);

    // Play game 1 out on the "server", push the over state, then the rematch.
    for (let i = 0; i < 20000 && g1.phase !== 'gameOver'; i++) g1 = advance(g1);
    expect(g1.phase).toBe('gameOver');
    bag.set(stateFor(g1, 1, 'over', 2));
    await act(async () => { await sleep(150); });

    const g2 = newGame(rules, 'srv-game-2');
    bag.set(stateFor(g2, 2, 'playing', 3));

    // The rematch's fresh TableGame starts uncertified again...
    expect(placeholderGone(), 'game 2 starts back on the placeholder').toBe(false);
    // ...and its own certification must arrive: the placeholder lifts and
    // "Setting the table..." clears. Before the fix gameSeed stayed '' for
    // both games, the scene subtree never remounted, and this never came.
    expect(await until(placeholderGone), 'game 2 placeholder lifts after rematch').toBe(true);
    expect(settingNote()).toBeNull();
    expect(captured.current?.gameSeed, 'game 2 scene identity').toBe(`${CODE}:2`);
  }, 30000);
});
