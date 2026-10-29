/**
 * @vitest-environment happy-dom
 *
 * Streaming package (owner, 2026-10-29): watch routes, watch links, share
 * buttons, the broadcast bug — and the REDACTION PIN: the broadcast surface
 * consumes ONLY the spectator view. The pin renders the real OnlineTable in
 * broadcast mode from a fabricated spectator connection state that ALSO
 * carries the seated players' real views smuggled alongside (as a buggy or
 * malicious payload might), and asserts no unplayed card face from any
 * seated hand appears anywhere in the rendered output — while a card that
 * has legitimately been played to the trick DOES show.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAction, makeRules, newGame, pendingTurn, spectatorView, viewFor, type GameState, type PlayerView } from '@spades/rules';
import { chooseBotAction } from '@spades/bots';
import type { RoomInfo } from '@spades/protocol';

const sceneProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('../src/three/Scene', async () => {
  const React = await import('react');
  return {
    default: function Scene(props: Record<string, unknown>) {
      // Capture what the table hands the scene to paint — for a spectator
      // that IS the rendered output (the fans and trick live in WebGL).
      sceneProps.current = props;
      // The real scene reports its lifecycle; the deal gate waits on it.
      React.useEffect(() => {
        const p = props as { onTableReady?: () => void; onFirstFrame?: () => void; onTableDressed?: () => void };
        p.onTableReady?.();
        p.onFirstFrame?.();
        p.onTableDressed?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      React.useEffect(() => {
        const p = props as { onDealDone?: (h: number) => void; handNo: number };
        const t = setTimeout(() => p.onDealDone?.(p.handNo), 60);
        return () => clearTimeout(t);
      }, [props.handNo, props.dealEpoch]); // eslint-disable-line react-hooks/exhaustive-deps
      return React.createElement('div', { 'data-testid': 'scene-live' });
    },
    preloadTableAssets: () => Promise.resolve(),
  };
});

// The effects warmer loads real images/audio in production; here it settles
// at once so the loader lifts on the (mocked) scene's word.
vi.mock('../src/effects/warm', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/effects/warm')>();
  return { ...orig, warmTableEffects: () => Promise.resolve({}) };
});

// The loader's asset gate waits on real file loads in production; here its
// loads settle at once (the misdeal-fan pattern) so the table mounts.
vi.mock('../src/assetGate', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/assetGate')>();
  return { ...orig, imageSettled: () => Promise.resolve(true), fetchSettled: () => Promise.resolve(true), assetSettled: () => Promise.resolve(true) };
});
vi.mock('../src/decks', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/decks')>();
  return { ...orig, whenDeckArtSettled: () => Promise.resolve({ total: 0, failed: [] as string[] }), whenDeckBackSettled: () => Promise.resolve(true) };
});

import { isWatchPath, watchRoute } from '../src/online/nav';
import { watchLink } from '../src/online/config';
import BroadcastOverlay from '../src/online/BroadcastOverlay';
import ShareWatchButton from '../src/online/ShareWatch';
import OnlineTable from '../src/online/OnlineTable';
import { WatchSlate } from '../src/online/WatchApp';
import type { ConnState, TableConnection } from '../src/online/connection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});
const render = (el: React.ReactElement) => act(() => { root!.render(el); });

describe('watch routes + links', () => {
  it('parses /watch/<CODE> and the broadcast variant', () => {
    expect(watchRoute('/watch/ABCDE')).toEqual({ code: 'ABCDE', broadcast: false });
    expect(watchRoute('/watch/abcde')).toEqual({ code: 'ABCDE', broadcast: false });
    expect(watchRoute('/watch/ABCDE/broadcast')).toEqual({ code: 'ABCDE', broadcast: true });
    expect(watchRoute('/watch/ABCDE/broadcast/')).toEqual({ code: 'ABCDE', broadcast: true });
    expect(isWatchPath('/watch/XYZ12')).toBe(true);
  });

  it('rejects non-watch paths and junk codes', () => {
    for (const p of ['/t/ABCDE', '/online', '/watch', '/watch/', '/watch/AB', '/watch/ABCDE/extra', '/watch/AB CD']) {
      expect(watchRoute(p), p).toBeNull();
      expect(isWatchPath(p), p).toBe(false);
    }
  });

  it('builds watch links on the app origin', () => {
    expect(watchLink('abcde')).toBe(`${location.origin}/watch/ABCDE`);
    expect(watchLink('ABCDE', true)).toBe(`${location.origin}/watch/ABCDE/broadcast`);
  });
});

describe('broadcast bug', () => {
  it('shows live marker, sides, scores, bags, hand and mode — and nothing it was not given', () => {
    const poison = { seatedHands: [['AS', 'KS'], ['QH', 'JH']], debugView: { hand: ['AS', 'KS', 'QH'] } };
    render(createElement(BroadcastOverlay, {
      code: 'ABCDE', handNo: 3, mode: 'joker', playerCount: 4,
      sides: [
        { name: 'ALPHA + CHARLIE', score: 212, bags: 4 },
        { name: 'BRAVO + DELTA', score: 187, bags: 9 },
      ],
      watchers: 2,
      ...poison,
    } as never));
    const bug = host!.querySelector('[data-testid="broadcast-bug"]')!;
    expect(bug).toBeTruthy();
    const text = bug.textContent ?? '';
    expect(text).toContain('LIVE');
    expect(text).toContain('TABLE ABCDE');
    expect(text).toContain('ALPHA + CHARLIE');
    expect(text).toContain('212');
    expect(text).toContain('HAND 3');
    expect(text).toContain('Joker Spades');
    // the poisoned payload rode along in props; none of it may surface
    expect(text).not.toContain('A♠');
    expect(text).not.toContain('K♠');
    expect(text).not.toContain('Q♥');
    // bags read as the league bug shows them
    expect(text).toContain('4B');
  });
});

describe('share watch button', () => {
  it('does not exist for story rooms', () => {
    render(createElement(ShareWatchButton, { code: 'ABCDE', story: true }));
    expect(host!.querySelector('[data-testid="share-watch"]')).toBeNull();
    expect(host!.textContent).toBe('');
  });

  it('copies the watch link when native share is unavailable', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: (t: string) => { written.push(t); return Promise.resolve(); } }, configurable: true });
    render(createElement(ShareWatchButton, { code: 'abcde' }));
    const btn = host!.querySelector<HTMLButtonElement>('[data-testid="share-watch"]')!;
    expect(btn).toBeTruthy();
    await act(async () => { btn.click(); });
    expect(written).toHaveLength(1);
    expect(written[0]).toContain(`${location.origin}/watch/ABCDE`);
    expect(host!.textContent).toContain('WATCH LINK COPIED ✓');
  });
});

describe('watch slates', () => {
  it('renders each refusal as a polite full-screen state', () => {
    for (const [kind, title] of [
      ['not-found', 'That table isn’t running'],
      ['spoken-for', 'This table is spoken for'],
      ['full', 'Watching is full right now'],
      ['waiting', 'Waiting for the game to start'],
      ['game-over', 'Game over'],
    ] as const) {
      render(createElement(WatchSlate, { kind, code: 'ABCDE', broadcast: false }));
      expect(host!.querySelector(`[data-testid="watch-${kind}"]`), kind).toBeTruthy();
      expect(host!.textContent).toContain(title);
    }
  });
});

/* ---------------- the redaction pin: broadcast OnlineTable ---------------- */

function advance(st: GameState): GameState {
  const t = pendingTurn(st);
  if (!t) return st;
  const a = chooseBotAction(viewFor(st, t.seat), 'pro');
  return a ? applyAction(st, a) : st;
}

function roomFor(st: GameState): RoomInfo {
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta'];
  return {
    code: 'ABCDE', phase: 'playing', game: 1, seq: 1, hostId: 'p0',
    rules: st.rules,
    seats: names.map((name, i) => ({ kind: i % 2 === 0 ? 'human' as const : 'bot' as const, name, connected: true, level: 'pro' as const })),
    ready: [], now: 1_000_000, deadline: null,
    spectators: [{ playerId: 'spec', name: 'Guest-AB12' }],
    botLevel: 'pro', talkSec: 20,
  } as unknown as RoomInfo;
}

describe('REDACTION PIN — broadcast table', () => {
  it('renders only the spectator view: no unplayed seated card face appears, played cards do', async () => {
    let st = newGame(makeRules('joker'), 'broadcast-pin-seed');
    // drive the game into the playing phase with cards already on the table
    for (let i = 0; i < 400 && st.phase === 'bidding'; i++) st = advance(st);
    expect(st.phase).toBe('playing');
    for (let i = 0; i < 400 && st.trick.plays.length < 2; i++) st = advance(st);
    expect(st.trick.plays.length).toBeGreaterThanOrEqual(2);

    const played = new Set<string>();
    for (const p of st.trick.plays) played.add(p.card);
    for (const t of st.tricks) for (const p of t.plays) played.add(p.card);
    // marker cards: still sitting in seated hands, never played — the exact
    // data a seated payload would leak and a spectator payload never carries.
    // (Jokers excluded: the public trump ladder names them at every table.)
    const markers = st.hands.flat().filter((c) => !played.has(c) && c !== 'BJ' && c !== 'LJ');
    expect(markers.length).toBeGreaterThan(30);

    const specView = spectatorView(st, 0);
    expect(specView.hand).toBeNull();
    const cs = {
      status: 'open', you: 'spec', room: roomFor(st), seat: null, view: specView, run: null,
      chat: [], error: null, pending: false, playGate: 0, socketGen: 0, statsOff: false, joinFault: null,
      spectator: true,
      // the smuggle: the seated players' full views ride along on the state
      // object, exactly where a careless component could read them from
      seatedViews: [0, 1, 2, 3].map((s) => viewFor(st, s)),
    } as unknown as ConnState;
    const conn = {
      code: 'ABCDE', send: () => {}, act: () => false,
      subscribe: () => () => {}, getState: () => cs,
    } as unknown as TableConnection;

    render(createElement(OnlineTable, {
      conn, cs, mesh: null, onLobby: () => {}, onMainMenu: () => {},
      watchOnly: true, broadcast: true,
      initialSettings: { quality: 'low', view: 'sitting' },
    }));
    // Poll with real timers until the scene holds the live trick (Table's
    // loader and deal beats are wall-clock; the mocks settle loads at once).
    const until = async (fn: () => boolean, timeoutMs = 15_000): Promise<boolean> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (fn()) return true;
        await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      }
      return fn();
    };
    const trickShown = () => {
      const t = sceneProps.current?.shownTrick as { card: string }[] | undefined;
      return !!t && t.length >= 2;
    };
    expect(await until(trickShown), 'the scene holds the live trick').toBe(true);

    // the broadcast bug is up, with the real sides and scores
    const bug = host!.querySelector('[data-testid="broadcast-bug"]');
    expect(bug).toBeTruthy();
    expect(bug!.textContent).toContain('LIVE');
    expect(bug!.textContent).toContain('ALPHA');
    // no chat surface at all in the broadcast frame
    expect(host!.querySelector('.chat-input')).toBeNull();
    expect(host!.querySelector('[data-testid="chat-readonly"]')).toBeNull();
    expect(host!.querySelector('.ctl-rail')).toBeNull();
    expect(host!.querySelector('.chat-ticker')).toBeNull();

    // THE PIN. Everything the broadcast surface holds or paints is in the
    // scene props + the DOM. Control first: the legitimately played cards
    // ARE there (the surface is real, not blanked)…
    const held = JSON.stringify(sceneProps.current) + host!.innerHTML;
    for (const c of played) expect(held, `played card ${c} should be held`).toContain(`"${c}"`);
    // …the spectator's fan is counts, never cards…
    expect(sceneProps.current?.myHand ?? null).toBeNull();
    expect(sceneProps.current?.handCounts).toEqual(st.hands.map((h) => h.length));
    // …and not one unplayed seated card appears anywhere in what the
    // component holds or renders — the smuggled seated views included.
    for (const m of markers) {
      expect(held.includes(`"${m}"`), `marker ${m} leaked into the broadcast surface`).toBe(false);
    }
  }, 30_000);
});
