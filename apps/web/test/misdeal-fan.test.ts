/**
 * @vitest-environment happy-dom
 *
 * The misdeal fan ruling (owner, 2026-10-21): "I shouldn't have cards until they are
 * dealt to me as per the usual deal."
 *
 * The redeal state swap is atomic: the new hand exists in state from the first frame of
 * the announcement. The first redeal pass let the local fan render that new hand face-up
 * as it glided into the pile — the player saw their next hand before it was dealt. These
 * tests pin the invariant at the real Table boundary (Scene is mocked, its props are the
 * fan's marching orders; the accessible hand group is the fan's DOM face):
 *
 *  - through the gather beat, every fan surface holds the THROWN-IN hand (the caller's own
 *    cards for the caller; the viewer's own cards for any other viewer) — never a card of
 *    the redealt hand qua redealt hand;
 *  - the deal beat hands the fan the new hand WITH the deal flight running (dealFlight),
 *    so its appearance is the flight's doing, including on a hand with no intro;
 *  - under reduced motion the announcement still holds the thrown-in hand, and the new
 *    hand appears only when the announcement ends — dealt, never early.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { applyAction, cardLabel, isTrump, makeRules, newGame, sortHand, viewFor, type Card, type GameState, type PlayerView } from '@spades/rules';
import type { RoomInfo } from '@spades/protocol';
import { MISDEAL_DEAL_SPEED, heldHandForThrowIn, misdealDealMs, misdealFanHand } from '../src/misdeal';
import { handDealsIn } from '../src/three/dealFlight';
import { dealTimeline, dealtSlotCount, seatDealDelay } from '../src/three/dealTimeline';

const captured = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('../src/three/Scene', async () => {
  const React = await import('react');
  return {
    default: function Scene(props: Record<string, unknown>) {
      captured.current = props;
      // The real scene reports its lifecycle; the deal gate and the deal clock wait on it.
      React.useEffect(() => {
        const p = props as {
          onTableReady?: () => void; onFirstFrame?: () => void; onTableDressed?: () => void;
        };
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

// The effects warmer loads real images/audio in production; here it settles at once so the
// loader lifts on the (mocked) scene's word, as it does once assets are warm.
vi.mock('../src/effects/warm', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/effects/warm')>();
  return { ...orig, warmTableEffects: () => Promise.resolve({}) };
});

import Table from '../src/Table';
import { DEFAULT_SETTINGS } from '../src/settings';
import { versusSeenKey } from '../src/VersusIntro';
import { useConn, useOnlineSource } from '../src/online/useOnline';
import type { ConnState, TableConnection } from '../src/online/connection';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rules = makeRules('joker', { firstHandBidsItself: false });

/** A seed where `seat` is dealt no trump (so it may call a misdeal) and its redealt hand differs. */
function callableGame(seat: number): { st: GameState; next: GameState } {
  for (let i = 0; i < 500; i++) {
    const st = newGame(rules, `misdeal-fan-${seat}-${i}`);
    if (st.phase !== 'bidding' || st.hands[seat]!.some((c) => isTrump(c, rules))) continue;
    const next = applyAction(st, { type: 'misdeal', seat });
    const before = new Set(st.hands[seat]!);
    if (next.hands[seat]!.some((c) => !before.has(c))) return { st, next };
  }
  throw new Error('no callable deal found');
}

/** A fresh offline game would hold the deal behind the versus intro; the fan tests are not about it. */
const skipVersus = (seed: string) => { try { sessionStorage.setItem(versusSeenKey(seed), '1'); } catch { /* storage off */ } };

const fanIds = (): string[] => [...document.querySelectorAll('[data-testid="hand"] button')].map((b) => (b.getAttribute('data-testid') ?? '').replace(/^card-/, ''));
const feltLabels = (): string[] => [...document.querySelectorAll('[data-testid="felt-hand"] button')].map((b) => b.textContent ?? '');
const sceneHand = (): string[] => ((captured.current?.myHand as string[] | null) ?? []).slice();
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

let root: Root | null = null;
let el: HTMLDivElement | null = null;

beforeEach(() => {
  captured.current = null;
  try { localStorage.setItem('bwm.tips', JSON.stringify({ on: false, asked: true, counts: {} })); } catch { /* storage off */ }
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

afterEach(() => {
  act(() => root?.unmount());
  el?.remove();
  root = null;
  el = null;
  captured.current = null;
});

/** Poll with real timers until `fn` holds (Table's sequence beats are wall-clock). */
async function until(fn: () => boolean, timeoutMs = 6000, stepMs = 30): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await act(async () => { await new Promise((r) => setTimeout(r, stepMs)); });
  }
  return fn();
}

/**
 * The announcement's dwell (owner, 2026-10-25): the redeal sequence completing
 * underneath must NOT clear the shown cards — the presentation holds for its
 * 8s floor — and a tap on the panel clears it at any moment.
 */
function expectRevealHeldThenDismissed() {
  expect(document.querySelector('[data-testid="misdeal-reveal"]'), 'announcement holds past the sequence').toBeTruthy();
  act(() => { (document.querySelector('.misdeal-panel') as HTMLElement).click(); });
  expect(document.querySelector('[data-testid="misdeal-reveal"]'), 'a tap cleared the announcement').toBeNull();
}

describe('misdeal fan helpers', () => {
  it('a thrown-in snapshot is only valid for the hand it was taken from', () => {
    const snap = { handNo: 3, cards: ['AS', 'KD'] };
    expect(heldHandForThrowIn(snap, 3)).toEqual(['AS', 'KD']);
    expect(heldHandForThrowIn(snap, 4)).toBeNull();
    expect(heldHandForThrowIn(null, 3)).toBeNull();
  });

  it('during the gather the fan holds the thrown-in hand — or nothing — never the redealt hand', () => {
    const held = ['2C', '3D'];
    const live = ['AS', 'KD'];
    expect(misdealFanHand(false, held, live)).toBe(live);
    expect(misdealFanHand(true, held, live)).toBe(held);
    expect(misdealFanHand(true, null, live)).toEqual([]);
    expect(misdealFanHand(true, null, null)).toBeNull();
    expect(misdealFanHand(false, null, null)).toBeNull();
  });
});

describe('the redeal deals out one card at a time, on the normal deal’s timeline', () => {
  it('stages the local fan’s arrival per card — never as a block, never all at once', () => {
    // The gate Scene applies to the local fan (Scene.tsx, the fanCards loop): a card deals
    // in only while a flight flag AND `dealing` are up. A fresh hand raises the flag through
    // the intro; the redeal raises it through Table's dealFlight (phase 'deal'). Same gate,
    // same item builder — the redeal's flight IS the normal deal's flight.
    expect(handDealsIn({ intro: true, dealing: true, flip: false })).toBe(true);
    expect(handDealsIn({ intro: false, dealing: true, flip: false }), 'no flight flag, no deal-in (the pre-fix resumed redeal)').toBe(false);
    expect(handDealsIn({ intro: true, dealing: false, flip: false })).toBe(false);

    // Table runs the redeal at the table speed × MISDEAL_DEAL_SPEED (passed as the scene's
    // animK for the deal beat), and Scene derives every card's beat from the shared
    // dealTimeline: shuffle first, then one card per step, clockwise from the dealer's left.
    const k = 1;
    const players = 4;
    const dealer = 1;
    const human = 0;
    const tl = dealTimeline(k * MISDEAL_DEAL_SPEED, players);
    const delays = Array.from({ length: 13 }, (_, slot) => seatDealDelay(tl, players, slot, human, dealer));
    expect(delays[0]!, 'nothing is dealt during the shuffle').toBeGreaterThanOrEqual(tl.shuffle);
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!, `slot ${i} leaves the deck after slot ${i - 1}`).toBeGreaterThan(delays[i - 1]!);
    }
    // Mid-flight the fan holds SOME of the hand and is still waiting on the rest: at the
    // sixth card's beat exactly six have left the deck — not zero, not thirteen.
    expect(dealtSlotCount(0, tl, players, human, dealer, 13)).toBe(0);
    expect(dealtSlotCount(delays[5]! - 0.001, tl, players, human, dealer, 13)).toBe(5);
    expect(dealtSlotCount(delays[5]!, tl, players, human, dealer, 13)).toBe(6);
    expect(dealtSlotCount(delays[12]!, tl, players, human, dealer, 13)).toBe(13);
    // Table's deal window covers the whole flight, so the last card lands before the
    // sequence clears and bidding opens — no card is cut off mid-flight.
    expect(misdealDealMs(k, players, 52)).toBeGreaterThanOrEqual(tl.total * 1000);
  });
});

describe('misdeal fan at the real Table (offline caller)', () => {
  it('holds the thrown-in hand through the gather, then deals the new hand on the flight', async () => {
    const { st, next } = callableGame(0);
    const oldHand = sortHand(st.hands[0]!, rules);
    const newHand = next.hands[0]!;
    skipVersus(String(st.seed));
    act(() => {
      root!.render(createElement(Table, {
        rules, seed: st.seed,
        settings: { ...DEFAULT_SETTINGS, quality: 'low', speed: 'turbo' },
        onExit: () => {}, onRematch: () => {}, onQuality: () => {},
      }));
    });
    expect(await until(() => !!document.querySelector('[data-testid="misdeal"]')), 'misdeal offered').toBe(true);
    expect(sorted(fanIds()), 'fan before the call is the dealt hand').toEqual(sorted(oldHand));

    act(() => { (document.querySelector('[data-testid="misdeal"]') as HTMLElement).click(); });

    // Gather beat (~1.2s): the announcement is up and every fan surface holds the thrown-in hand.
    expect(document.querySelector('[data-testid="misdeal-reveal"]'), 'announcement up').toBeTruthy();
    expect(captured.current?.gatherHands, 'hands gather').toBe(true);
    expect(sceneHand(), '3D fan holds the thrown-in hand').toEqual(oldHand);
    expect(fanIds(), 'accessible fan holds the thrown-in hand').toEqual(oldHand);
    expect(sorted(sceneHand())).not.toEqual(sorted(newHand));

    // Deal beat: the fan is handed the new hand WITH its deal flight running (flight flag
    // and dealing together — the exact pair Scene's per-card deal-in gate requires).
    let sawFlight = false;
    const dealt = await until(() => {
      if (captured.current?.dealFlight === true && captured.current?.dealing === true && captured.current?.gatherHands === false) sawFlight = true;
      return sawFlight;
    }, 6000);
    expect(sawFlight, 'the redeal dealt out on the deal flight').toBe(true);
    expect(dealt, 'sequence completed').toBe(true);
    expect(sorted(sceneHand()), 'fan after the deal is the redealt hand').toEqual(sorted(newHand));
    expect(sorted(fanIds()), 'accessible fan after the deal is the redealt hand').toEqual(sorted(newHand));
    expectRevealHeldThenDismissed();
  }, 30_000);

  it('reduced motion: the announcement still holds the thrown-in hand; the new hand appears dealt, never early', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (q: string) => ({
        matches: q.includes('prefers-reduced-motion'), media: q, onchange: null,
        addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      const { st, next } = callableGame(0);
      const oldHand = sortHand(st.hands[0]!, rules);
      skipVersus(String(st.seed));
      act(() => {
        root!.render(createElement(Table, {
          rules, seed: st.seed,
          settings: { ...DEFAULT_SETTINGS, quality: 'low', speed: 'turbo' },
          onExit: () => {}, onRematch: () => {}, onQuality: () => {},
        }));
      });
      expect(await until(() => !!document.querySelector('[data-testid="misdeal"]')), 'misdeal offered').toBe(true);
      act(() => { (document.querySelector('[data-testid="misdeal"]') as HTMLElement).click(); });
      // Announcement window (600ms snap): no glide, and the fan still holds the thrown-in hand.
      expect(document.querySelector('[data-testid="misdeal-reveal"]'), 'announcement up').toBeTruthy();
      expect(captured.current?.gatherHands, 'no gather glide under reduced motion').toBe(false);
      expect(captured.current?.dealFlight ?? false, 'no deal flight under reduced motion').toBe(false);
      expect(sceneHand(), 'fan holds the thrown-in hand through the announcement').toEqual(oldHand);
      expect(fanIds()).toEqual(oldHand);
      // Then the hand appears dealt — the swap lands with the announcement beat's
      // end, not before. The announcement itself now HOLDS past the swap (8s
      // dwell, owner 2026-10-25) until tapped away.
      expect(await until(() => sorted(sceneHand()).join(' ') === sorted(next.hands[0]!).join(' ')), 'the swap landed').toBe(true);
      expect(sorted(sceneHand()), 'the dealt hand appears with the swap').toEqual(sorted(next.hands[0]!));
      expect(sorted(fanIds())).toEqual(sorted(next.hands[0]!));
      expectRevealHeldThenDismissed();
    } finally {
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: (q: string) => ({
          matches: false, media: q, onchange: null,
          addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {},
          dispatchEvent: () => false,
        }),
      });
    }
  }, 30_000);

  it('the announcement clears ITSELF only at the 8s floor — never with the sequence', async () => {
    const { st } = callableGame(0);
    skipVersus(String(st.seed));
    act(() => {
      root!.render(createElement(Table, {
        rules, seed: st.seed,
        settings: { ...DEFAULT_SETTINGS, quality: 'low', speed: 'turbo' },
        onExit: () => {}, onRematch: () => {}, onQuality: () => {},
      }));
    });
    expect(await until(() => !!document.querySelector('[data-testid="misdeal"]')), 'misdeal offered').toBe(true);
    const t0 = Date.now();
    act(() => { (document.querySelector('[data-testid="misdeal"]') as HTMLElement).click(); });
    expect(document.querySelector('[data-testid="misdeal-reveal"]'), 'announcement up').toBeTruthy();
    // No tap: the panel must still be up well past the ~3s sequence…
    expect(await until(() => !document.querySelector('[data-testid="misdeal-reveal"]'), 12_000), 'announcement auto-cleared').toBe(true);
    const heldMs = Date.now() - t0;
    // …and the clear must not land before the 8s floor (500ms harness slack).
    expect(heldMs, `announcement held ${heldMs}ms`).toBeGreaterThanOrEqual(7500);
  }, 30_000);
});

describe('misdeal fan at the real Table (offline, resumed hand — no intro)', () => {
  it('the felt fan holds the thrown-in hand, and the redeal still flies in (dealFlight without an intro)', async () => {
    const { st, next } = callableGame(0);
    const settings = { ...DEFAULT_SETTINGS, quality: 'low' as const, speed: 'turbo' as const };
    const oldHand = sortHand(st.hands[0]!, rules);
    const oldLabels = oldHand.map((c) => cardLabel(c as Card));
    const newLabels = sortHand(next.hands[0]!, rules).map((c) => cardLabel(c as Card));
    act(() => {
      root!.render(createElement(Table, {
        rules, seed: st.seed, settings,
        resume: { v: 1, savedAt: Date.now(), seed: String(st.seed), settings, state: st, chat: [], names: ['You', 'Ray', 'Kim', 'Jo'] },
        onExit: () => {}, onRematch: () => {}, onQuality: () => {},
      }));
    });
    // A resumed hand has no intro: the flat felt fan stands in until the 3D hand is live
    // (the mocked scene never reports it live), and it shows the dealt hand.
    expect(await until(() => !!document.querySelector('[data-testid="misdeal"]')), 'misdeal offered').toBe(true);
    expect(feltLabels(), 'felt fan shows the dealt hand').toEqual(oldLabels);
    expect(captured.current?.intro).toBeFalsy();

    act(() => { (document.querySelector('[data-testid="misdeal"]') as HTMLElement).click(); });

    expect(document.querySelector('[data-testid="misdeal-reveal"]'), 'announcement up').toBeTruthy();
    expect(captured.current?.gatherHands, 'hands gather').toBe(true);
    expect(sceneHand(), '3D fan holds the thrown-in hand').toEqual(oldHand);
    expect(feltLabels(), 'felt fan holds the thrown-in hand').toEqual(oldLabels);

    // No intro exists on a resumed hand — the redeal's flight is dealFlight's doing alone.
    let sawFlight = false;
    const done = await until(() => {
      if (captured.current?.dealFlight === true && captured.current?.gatherHands === false) sawFlight = true;
      return sawFlight;
    }, 6000);
    expect(sawFlight, 'the redeal flew in despite no intro').toBe(true);
    expect(done, 'sequence completed').toBe(true);
    expect(sorted(sceneHand()), '3D fan after the deal is the redealt hand').toEqual(sorted(next.hands[0]!));
    expect(feltLabels(), 'felt fan after the deal is the redealt hand').toEqual(newLabels);
    expectRevealHeldThenDismissed();
  }, 30_000);
});

/* ------------------------------------------------------------ online, another seat calls */

function roomFor(st: GameState, seq: number): RoomInfo {
  const n = st.rules.playerCount;
  const names = ['You', 'Ray', 'Kim', 'Jo'];
  return {
    code: 'FANV1', phase: 'playing', game: 1, seq, hostId: 'p0',
    rules: st.rules,
    seats: Array.from({ length: n }, (_, i) => ({ kind: 'bot' as const, name: names[i] ?? `P${i}`, level: 'pro' as const })),
    ready: [], now: 1_000_000, deadline: 1_000_000 + 20_000,
    spectators: [], botLevel: 'pro', talkSec: 20,
  } as unknown as RoomInfo;
}

function watch(st: GameState, seq: number): ConnState {
  return {
    status: 'open', you: 'p0', room: roomFor(st, seq), seat: 0, view: viewFor(st, 0),
    chat: [], error: null, pending: false, spectator: false, statsOff: false, joinFault: null,
  } as ConnState;
}

function makeConn(initial: ConnState) {
  let state = initial;
  const listeners = new Set<() => void>();
  const conn = {
    subscribe: (f: () => void) => { listeners.add(f); return () => listeners.delete(f); },
    getState: () => state,
    send: () => {},
    act: () => false,
    code: 'FANV1',
  } as unknown as TableConnection;
  return {
    conn,
    set(next: ConnState) {
      state = next;
      act(() => { listeners.forEach((f) => f()); });
    },
  };
}

function PlayerProbe({ conn }: { conn: TableConnection }) {
  const cs = useConn(conn);
  const source = useOnlineSource(cs, conn);
  if (!source || !cs.room) return createElement('div', null, 'wait');
  const names = ['You', 'Ray', 'Kim', 'Jo'].slice(0, source.st.rules.playerCount);
  return createElement(Table, {
    rules: source.st.rules,
    seed: 'fan-view-seed',
    settings: { ...DEFAULT_SETTINGS, quality: 'low', speed: 'turbo' },
    onExit: () => {}, onRematch: () => {}, onQuality: () => {},
    online: {
      source,
      names,
      chat: { msgs: [], push: () => {} },
      seatExtra: () => null,
      sideLabel: (s: number) => names[s] ?? '?',
      spectator: false,
      botSeats: [1, 2, 3],
      venue: 'classic' as const,
      talk: { secs: 20, ready: { mine: false, count: 0, of: 1 }, tile: () => null },
    },
  });
}

describe('misdeal fan at the real Table (online, another seat calls)', () => {
  it("the viewer's fan holds the viewer's own thrown-in hand, not the redealt one", async () => {
    const { st, next } = callableGame(2);
    const myOld = sortHand(viewFor(st, 0).hand!, rules);
    const myNew = viewFor(next, 0).hand!;
    const bag = makeConn(watch(st, 1));
    act(() => { root!.render(createElement(PlayerProbe, { conn: bag.conn })); });
    expect(await until(() => captured.current !== null && sorted(fanIds()).length === 13), 'table up with my hand').toBe(true);
    expect(sorted(fanIds())).toEqual(sorted(myOld));

    bag.set(watch(next, 2));

    // Gather: my fan is MY thrown-in hand (seat 2's reveal is the announcement's business).
    expect(await until(() => captured.current?.gatherHands === true), 'gather started').toBe(true);
    expect(document.querySelector('[data-testid="misdeal-reveal"]'), 'announcement up').toBeTruthy();
    expect(sceneHand(), '3D fan holds my thrown-in hand').toEqual(myOld);
    expect(fanIds(), 'accessible fan holds my thrown-in hand').toEqual(myOld);
    expect(sorted(sceneHand())).not.toEqual(sorted(myNew));

    let sawFlight = false;
    const done = await until(() => {
      if (captured.current?.dealFlight === true && captured.current?.dealing === true) sawFlight = true;
      return sawFlight;
    }, 9000);
    expect(sawFlight, 'the redeal dealt out on the deal flight').toBe(true);
    expect(done, 'sequence completed').toBe(true);
    expect(sorted(sceneHand()), 'fan after the deal is my redealt hand').toEqual(sorted(myNew));
    expect(sorted(fanIds())).toEqual(sorted(myNew));
    expectRevealHeldThenDismissed();
  }, 30_000);
});
