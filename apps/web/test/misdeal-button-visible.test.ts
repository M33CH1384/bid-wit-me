/**
 * @vitest-environment happy-dom
 *
 * Misdeal button visibility under a stalled frame clock (owner, 2026-10-29:
 * "I didn't get a misdeal option"). Proven mechanism (production build, real
 * browser): the button mounted on time in both placements with a healthy box,
 * but its computed opacity sat at 0 — the entrance animation it rode
 * (`runit-in`, from opacity 0 / scale .4) never advanced because the document
 * animation timeline was frozen by the table-load / rotation frame stall, the
 * exact moment the offer appears. Every other control on the bid panel — the
 * bid grid he successfully used — carries no such animation. Bidding is the
 * decline, so a button that only becomes visible once frames flow freely is a
 * button that effectively never existed.
 *
 * The fix: no entrance animation on the call at all; the in-panel pulse
 * animates box-shadow only. These pins hold that line two ways:
 *  1. CSS source: the animations named by the .misdeal-btn / .misdeal-in-panel
 *     rules may not animate opacity or transform (a re-added runit-in fails).
 *  2. Real Table: with the Scene NEVER reporting the deal (the stalled-canvas
 *     case), the offer still arrives — since the 2026-10-29 deal gate it rides
 *     the local deal clock plus state-proven completion, not the flow fallback —
 *     survives a viewport flip and another seat's bid, and closes only on the
 *     human's own bid — the rule itself unchanged.
 *
 * Sibling sweep (2026-10-29, same defect class): the Run It! call rode the very
 * same runit-in; the misdeal reveal's dwell is a wall-clock setTimeout, so a
 * frozen rz-in first frame would have the announcement dismissed before it was
 * ever painted; the Run zoom overlay shared rz-in against the fixed show clock;
 * the reveal/zoom cards and the claim bubble rode opacity-0 first frames; and
 * the spectator take-a-seat card rode spec-in into a seat someone else can
 * claim. The pins below hold the sweep: the calls and the announcement overlays
 * paint outright, the announcement content animations (rz-card / rz-bubble)
 * animate transform only, and no animation named by any of these surfaces may
 * take its element transparent in any frame.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { isTrump, makeRules, newGame, type GameState } from '@spades/rules';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const stylesCss = read('../src/styles.css');

/** The stylesheet with every @keyframes block removed (brace-matched), so the
 *  flat rule regex below cannot desync on keyframe nesting. */
function withoutKeyframes(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const k = css.indexOf('@keyframes', i);
    if (k < 0) { out += css.slice(i); break; }
    out += css.slice(i, k);
    let depth = 0;
    let j = css.indexOf('{', k);
    const start = j;
    for (; j < css.length; j++) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}' && --depth === 0) { j++; break; }
    }
    if (start < 0 || depth !== 0) throw new Error('unterminated @keyframes');
    i = j;
  }
  return out;
}

/** The declaration blocks of every rule whose selector list includes `sel` exactly. */
function ruleBlocks(css: string, sel: string): string[] {
  const flat = withoutKeyframes(css).replace(/\/\*[\s\S]*?\*\//g, ' ');
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(flat))) {
    const selectors = m[1]!.split(',').map((s) => s.trim());
    if (selectors.includes(sel)) out.push(m[2]!);
  }
  return out;
}

/** The body of `@keyframes name { ... }` (brace-matched). */
function keyframesBody(css: string, name: string): string {
  const i = css.indexOf(`@keyframes ${name}`);
  if (i < 0) throw new Error(`no @keyframes ${name}`);
  let depth = 0;
  const start = css.indexOf('{', i);
  for (let j = start; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) return css.slice(start, j + 1);
  }
  throw new Error(`unterminated @keyframes ${name}`);
}

/** Animation names referenced by a rule block's `animation` shorthand. */
function animationNames(block: string): string[] {
  const names: string[] = [];
  for (const decl of block.split(';')) {
    const t = decl.trim();
    if (!t.startsWith('animation:')) continue;
    for (const part of t.slice('animation:'.length).split(',')) {
      const token = part.trim().split(/\s+/).find((w) => /^[a-zA-Z][\w-]*$/.test(w) && !/^(cubic-bezier|ease|ease-in|ease-out|ease-in-out|linear|infinite|both|forwards|backwards|none|normal|reverse|alternate|running|paused)$/.test(w));
      if (token && !/^[\d.]+m?s$/.test(token)) names.push(token);
    }
  }
  return names;
}

describe('the call never rides an opacity/transform animation', () => {
  it('.misdeal-btn and .misdeal-in-panel animations animate neither opacity nor transform', () => {
    const blocks = [...ruleBlocks(stylesCss, '.misdeal-btn'), ...ruleBlocks(stylesCss, '.misdeal-in-panel')];
    expect(blocks.length).toBeGreaterThanOrEqual(3); // base rule + the duplicated in-panel rules
    const seen = new Set<string>();
    for (const b of blocks) for (const n of animationNames(b)) seen.add(n);
    // the in-panel attention pulse survives — and it is box-shadow only
    expect(seen.has('misdeal-pulse')).toBe(true);
    expect(keyframesBody(stylesCss, 'misdeal-pulse')).not.toMatch(/opacity|transform/);
    for (const n of seen) {
      const body = keyframesBody(stylesCss, n);
      expect(body, `@keyframes ${n} must not gate the call's visibility or geometry`).not.toMatch(/opacity\s*:|transform\s*:/);
    }
    // and the base rule paints the pill outright (no opacity declaration to hide behind)
    expect(ruleBlocks(stylesCss, '.misdeal-btn').join(' ')).not.toMatch(/opacity\s*:/);
  });
});

describe('the sibling sweep: no call or announcement rides a transparent frame', () => {
  const onlineCss = read('../src/online/online.css');

  /** Animation names named by every rule for `sel` in `css`. */
  function namesFor(css: string, sel: string): Set<string> {
    const blocks = ruleBlocks(css, sel);
    expect(blocks.length, `${sel} must have at least one rule`).toBeGreaterThanOrEqual(1);
    const names = new Set<string>();
    for (const b of blocks) for (const n of animationNames(b)) names.add(n);
    return names;
  }

  /** No frame of `@keyframes name` in `css` may set opacity below 1. */
  function expectNeverTransparent(css: string, name: string, sel: string) {
    const body = keyframesBody(css, name);
    for (const m of body.matchAll(/opacity\s*:\s*([0-9.]+)/g)) {
      expect(Number(m[1]!), `@keyframes ${name} on ${sel} must never take it transparent`).toBeGreaterThanOrEqual(1);
    }
  }

  it('.run-it-btn paints outright — the pulses survive, the hiding entrance is gone', () => {
    const base = namesFor(stylesCss, '.run-it-btn');
    expect(base.has('runit-in')).toBe(false);
    expect(base.has('runit-glow')).toBe(true); // the glow pulse is the look — it stays
    const attn = namesFor(stylesCss, '.run-it-btn.attention');
    expect(attn.has('runit-in')).toBe(false);
    expect(attn.has('runit-attn')).toBe(true);
    for (const n of [...base, ...attn]) expectNeverTransparent(stylesCss, n, '.run-it-btn');
  });

  it('.misdeal-reveal and .run-zoom carry no entrance animation at all', () => {
    expect(namesFor(stylesCss, '.misdeal-reveal').size).toBe(0);
    expect(namesFor(stylesCss, '.run-zoom').size).toBe(0);
  });

  it('the announcement content (rz-card / rz-bubble) never starts transparent', () => {
    for (const sel of ['.misdeal-card', '.run-zoom-card', '.run-bubble']) {
      const names = namesFor(stylesCss, sel);
      expect(names.size, `${sel} keeps its deal-in motion`).toBeGreaterThanOrEqual(1);
      for (const n of names) expectNeverTransparent(stylesCss, n, sel);
    }
  });

  it('.spec-take (online.css) paints outright', () => {
    expect(namesFor(onlineCss, '.spec-take').size).toBe(0);
  });
});

/* ---------------------------------------------------------- real Table */

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

const rules = makeRules('joker', { firstHandBidsItself: false });

function callableSeed(): string {
  for (let i = 0; i < 20000; i++) {
    const st: GameState = newGame(rules, `misdeal-win-${i}`);
    if (st.phase === 'bidding' && st.dealer !== 0 && !st.hands[0]!.some((c) => isTrump(c, rules))) return `misdeal-win-${i}`;
  }
  throw new Error('none');
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

async function until(fn: () => boolean, timeoutMs = 30000, stepMs = 40): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return true;
    await act(async () => { await new Promise((r) => setTimeout(r, stepMs)); });
  }
  return fn();
}

describe('the offer survives a scene that never reports the deal', () => {
  it('arrives via the bounded path, survives a flip and another seat’s bid, closes on my bid', async () => {
    const seed = callableSeed();
    try { sessionStorage.setItem(versusSeenKey(seed), '1'); } catch { /* storage off */ }
    act(() => {
      root!.render(createElement(Table, {
        rules, seed,
        settings: { ...DEFAULT_SETTINGS, quality: 'low', speed: 'fast' },
        onExit: () => {}, onRematch: () => {}, onQuality: () => {},
      }));
    });
    const btn = () => document.querySelector('[data-testid="misdeal"]');
    // The scene never reports: the offer arrives on useGame's local deal clock once
    // state proves the deal complete (the deal gate) — it must arrive, in the floating placement
    // or the panel's, while the human has not bid.
    expect(await until(() => !!btn(), 30000), 'offer arrives despite the stalled scene').toBe(true);

    // A rotation mid-window (viewport flip, both ways) must not close or lose it.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 844 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 390 });
    act(() => { window.dispatchEvent(new Event('resize')); });
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(btn(), 'offer survives the flip to landscape').toBeTruthy();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    act(() => { window.dispatchEvent(new Event('resize')); });
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(btn(), 'offer survives the flip back').toBeTruthy();

    // Wait for my bid panel (other seats bidding first never closed the offer —
    // it has been mounted continuously since it arrived), then bid: the decline.
    expect(await until(() => !!btn()?.closest('.bid-panel'), 30000), 'offer rides into my bid panel').toBe(true);
    const bidBtn = document.querySelector('.bid-grid button') as HTMLElement | null;
    expect(bidBtn, 'bid grid present').toBeTruthy();
    act(() => { bidBtn!.click(); });
    expect(await until(() => !btn(), 5000), 'my own bid closes the offer').toBe(true);
  }, 90000);
});
