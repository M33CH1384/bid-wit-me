// @vitest-environment happy-dom
/**
 * The misdeal deal gate (owner, 2026-10-29): "Please make sure the cards are
 * fully dealt before this window shows."
 *
 * Before the gate, the offer's start waited on the scene's deal report: it
 * showed at ~5.5 s with an on-time report, ~9.8 s with a late one, and ~13.9 s
 * when the scene never reported — released in that last case by useGame's
 * forced flow fallback, a wall clock that knows nothing about the deal. The
 * gate replaces that with state: the offer shows only when the deal is
 * COMPLETE — every seat holds its full dealt hand (`dealComplete`) and the
 * human's own hand is fully present in their view (`misdealDealGate`) — plus
 * the source's own deal clock (`dealSettled`: the local deal timeline offline,
 * the intro window online). The fallback still keeps bots and input moving;
 * it can no longer release the offer, and a lost scene report can no longer
 * strand it.
 *
 * Pins, at the real Table boundary with a Scene that NEVER reports the deal
 * (the harness mirrors misdeal-button-visible.test.ts):
 *  1. A partially-dealt state (the human eligible, another seat one card
 *     short) never shows the offer — no matter how long the table waits.
 *  2. The same state completed shows it.
 *  3. A fresh deal with the human first to bid: the offer debuts FLOATING —
 *     the deal clock released it — and only rides into the bid panel later,
 *     when the flow fallback ends the deal for bidding. (A fallback-released
 *     offer would debut already inside the panel.)
 *  4. At slow speed the offer is still absent mid-deal — a viewport flip
 *     during the deal does not release it — and arrives once the deal is in.
 * The predicate itself is pinned in the rules suite (deal-complete.test.ts)
 * and in the unit block below.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { isTrump, makeRules, newGame, viewFor, type GameState } from '@spades/rules';
import { misdealDealGate } from '../src/misdeal';

const captured = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('../src/three/Scene', async () => {
  const React = await import('react');
  return {
    default: function Scene(props: Record<string, unknown>) {
      captured.current = props;
      React.useEffect(() => {
        const p = props as { onTableReady?: () => void; onFirstFrame?: () => void; onTableDressed?: () => void };
        p.onTableReady?.();
        p.onFirstFrame?.();
        p.onTableDressed?.();
        // The stalled canvas: onDealDone is NEVER called for this hand.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return React.createElement('div', { 'data-testid': 'scene-live' });
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

import Table from '../src/Table';
import { DEFAULT_SETTINGS } from '../src/settings';
import { versusSeenKey } from '../src/VersusIntro';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rules = makeRules('joker', { firstHandBidsItself: false }); // hand 1 bids (no books hand) so the window exists

/** A fresh game (scanning seeds) where seat 0 — the human — was dealt no trump at all. */
function callableGame(scan: string): GameState {
  for (let i = 0; i < 20000; i++) {
    const st = newGame(rules, `${scan}-${i}`);
    if (st.phase === 'bidding' && !st.hands[0]!.some((c) => isTrump(c, st.rules))) return st;
  }
  throw new Error('no spade-less deal found');
}

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
afterEach(() => { act(() => root?.unmount()); el?.remove(); root = null; el = null; captured.current = null; });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(fn: () => boolean, timeoutMs = 30000, stepMs = 40): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await act(async () => { await sleep(stepMs); });
  }
  return fn();
}

const misdealEl = () => document.querySelector('[data-testid="misdeal"]');

function renderFresh(seed: string, speed: 'turbo' | 'slow') {
  return act(async () => {
    root!.render(createElement(Table, {
      rules, seed,
      settings: { ...DEFAULT_SETTINGS, quality: 'low', speed },
      onExit: () => {}, onRematch: () => {}, onQuality: () => {},
    }));
  });
}

function renderResume(st: GameState) {
  const settings = { ...DEFAULT_SETTINGS, quality: 'low' as const, speed: 'fast' as const };
  return act(async () => {
    root!.render(createElement(Table, {
      rules, seed: String(st.seed), settings,
      onExit: () => {}, onRematch: () => {}, onQuality: () => {},
      resume: { v: 1 as const, savedAt: Date.now(), seed: String(st.seed), settings, state: st, chat: [], names: ['You', 'Ray', 'Kim', 'Jo'] },
    }));
  });
}

describe('misdealDealGate — the predicate', () => {
  it('a fully dealt, seen hand passes; anything short fails', () => {
    const st = callableGame('gate-unit');
    expect(misdealDealGate(st, viewFor(st, 0))).toBe(true);

    // Another seat one card short: the human's own hand is untouched, the
    // engine still calls the human eligible — the gate must not.
    const short = { ...st, hands: st.hands.map((h, s) => (s === 2 ? h.slice(1) : h)) };
    expect(viewFor(short, 0).canMisdeal).toBe(true);
    expect(misdealDealGate(short, viewFor(short, 0))).toBe(false);

    // The human's own hand short fails too.
    const ownShort = { ...st, hands: st.hands.map((h, s) => (s === 0 ? h.slice(1) : h)) };
    expect(misdealDealGate(ownShort, viewFor(ownShort, 0))).toBe(false);

    // Unseen (Blind Nil peek): the view carries no hand at all — fails.
    const unseen = { ...st, revealed: st.revealed.map((r, s) => (s === 0 ? false : r)) };
    expect(viewFor(unseen, 0).hand).toBeNull();
    expect(misdealDealGate(unseen, viewFor(unseen, 0))).toBe(false);
  });
});

describe('the offer at the real Table (scene never reports)', () => {
  it('a partially-dealt state never shows the offer; the completed state does', async () => {
    const st = callableGame('gate-partial');
    const partial = { ...st, hands: st.hands.map((h, s) => (s === 2 ? h.slice(1) : h)) };
    await renderResume(partial);
    // Long past every deal clock and any fallback: still shut.
    await act(async () => { await sleep(2500); });
    expect(misdealEl(), 'no offer over a partially-dealt hand').toBeNull();

    // Remount on the completed deal (a live Table keeps its resumed state, so
    // the completed state gets a fresh mount, as a relaunched app would).
    act(() => root!.unmount());
    el!.remove();
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await renderResume(st);
    expect(await until(() => !!misdealEl(), 8000), 'offer once the deal is complete').toBe(true);
  }, 30000);

  it('a fresh deal lands the offer on the deal clock, ahead of the flow the fallback controls', async () => {
    // Dealer 3 puts the HUMAN first to bid: the bid panel then opens the very
    // moment flow `dealing` ends — which, with the scene never reporting, only
    // the forced fallback can end. So the two release paths leave different
    // fingerprints: a fallback-released offer debuts already inside the bid
    // panel, while a deal-clock offer debuts floating and only rides into the
    // panel later, when the flow catches up. No wall-clock bounds involved.
    let st: GameState | null = null;
    for (let i = 0; i < 20000 && !st; i++) {
      const g = newGame(rules, `gate-first-${i}`);
      if (g.phase === 'bidding' && g.dealer === 3 && !g.hands[0]!.some((c) => isTrump(c, g.rules))) st = g;
    }
    expect(st, 'a spade-less deal with the human first to bid').toBeTruthy();
    try { sessionStorage.setItem(versusSeenKey(String(st!.seed)), '1'); } catch { /* storage off */ }
    await renderFresh(String(st!.seed), 'turbo');
    expect(await until(() => !!misdealEl(), 20000), 'offer arrives with a silent scene').toBe(true);
    expect(misdealEl()!.closest('.bid-panel'), 'offer debuts floating — the deal clock released it, not the fallback').toBeNull();
    expect(await until(() => !!misdealEl()?.closest('.bid-panel'), 20000), 'offer rides into the panel once the flow lands').toBe(true);
  }, 60000);

  it('at slow speed the offer waits out the deal — a mid-deal flip does not release it', async () => {
    const st = callableGame('gate-slow');
    await renderFresh(String(st.seed), 'slow');
    // Slow timeline (k clamps at 1.5) runs ~4.1s: mid-deal, no offer.
    await act(async () => { await sleep(2000); });
    expect(misdealEl(), 'no offer mid-deal').toBeNull();
    // Flip portrait → landscape mid-deal; the offer must stay shut.
    await act(async () => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 932 });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 430 });
      window.dispatchEvent(new Event('resize'));
    });
    await act(async () => { await sleep(1200); });
    expect(misdealEl(), 'a flip during the deal releases nothing').toBeNull();
    // And once the deal is in, it arrives — bounded, no deadlock.
    expect(await until(() => !!misdealEl(), 12000), 'offer after the slow deal completes').toBe(true);
  }, 40000);
});
