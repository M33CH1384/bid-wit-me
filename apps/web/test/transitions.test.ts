/**
 * @vitest-environment happy-dom
 *
 * The screen-transition family (owner, 2026-10-23: "Build them all"):
 * a move is classified, the theme skins it where the class has theme
 * variants, and ONE controller (transitions.ts) drives the chosen
 * program's cover -> swap -> hold -> reveal lifecycle. Pins:
 *  - the registry matrix (move class x theme -> program) and the
 *    route classifier Root uses, exclusions included;
 *  - every program's failsafe honors the family invariant: it outlives
 *    the program's full cycle by at least 500 ms;
 *  - Ink Bloom is the spray program re-skinned (identical spec);
 *  - the controller runs each program on its own timing, joins and
 *    snap-backs keep the episode's program, and suppression is an
 *    instant cut for every class;
 *  - the Deal's ready-driven lifecycle: minimum dwell AND the ready
 *    signal, the readiness cap, and a navigation out from under it.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fxStub = vi.hoisted(() => ({ reduced: false, osReducedMotion: false }));
vi.mock('../src/fx', () => ({ fx: fxStub }));

import {
  DEAL_READY_CAP_MS,
  PROGRAM_SPECS,
  SPRAY_COVER_MS,
  SPRAY_HOLD_MS,
  SPRAY_REVEAL_MS,
  cancelTransitions,
  coverTableEntry,
  coverThen,
  getTransitionSnapshot,
  registerTransitionRenderer,
  resolveProgram,
  routeMoveClass,
  signalTableReady,
  type MoveClass,
  type TransitionProgramId,
} from '../src/transitions';
import { themeStore } from '../src/theme';

const src = join(dirname(fileURLToPath(import.meta.url)), '../src');
const read = (p: string) => readFileSync(join(src, p), 'utf8');

beforeEach(() => {
  vi.useFakeTimers();
  fxStub.reduced = false;
  fxStub.osReducedMotion = false;
  themeStore.set('classic');
  registerTransitionRenderer(false);
  cancelTransitions();
});

afterEach(() => {
  cancelTransitions();
  registerTransitionRenderer(false);
  themeStore.set('classic');
  vi.useRealTimers();
});

describe('the registry — move class x theme -> program', () => {
  it('menu-space classes are skinned by theme; the rest are themselves', () => {
    const classes: MoveClass[] = ['menu-nav', 'screen', 'profile-social', 'table-entry', 'table-exit', 'story-entry'];
    const classic: Record<MoveClass, TransitionProgramId> = {
      'menu-nav': 'spray',
      'screen': 'spray',
      'profile-social': 'fan',
      'table-entry': 'deal',
      'table-exit': 'sweep',
      'story-entry': 'doorway',
    };
    for (const c of classes) expect(resolveProgram(c)).toBe(classic[c]);
    themeStore.set('neon');
    // Theme parity: ONLY the menu-space programs change skin — and
    // only their visuals; every other program is identical.
    expect(resolveProgram('menu-nav')).toBe('ink');
    expect(resolveProgram('screen')).toBe('ink');
    for (const c of classes.slice(2)) expect(resolveProgram(c)).toBe(classic[c]);
  });

  it('Ink Bloom is the spray program re-skinned: the specs are identical', () => {
    expect(PROGRAM_SPECS.ink).toEqual(PROGRAM_SPECS.spray);
  });

  it('every program honors the failsafe margin invariant (cycle + >=500 ms)', () => {
    for (const [id, spec] of Object.entries(PROGRAM_SPECS)) {
      expect(spec.failsafeMs - (spec.coverMs + spec.holdMs + spec.revealMs), id).toBeGreaterThanOrEqual(500);
    }
    // The Deal's real cycle is dwell + readiness wait (to the cap) +
    // reveal; its failsafe clears even that with the margin to spare.
    expect(PROGRAM_SPECS.deal.failsafeMs).toBeGreaterThanOrEqual(
      DEAL_READY_CAP_MS + PROGRAM_SPECS.deal.revealMs + 500,
    );
  });

  it('program timing budgets match the approved designs', () => {
    const total = (id: TransitionProgramId) => {
      const s = PROGRAM_SPECS[id];
      return s.coverMs + s.holdMs + s.revealMs;
    };
    // The Card Fan is brisker than the spray: ~750-900 ms.
    expect(total('fan')).toBeGreaterThanOrEqual(750);
    expect(total('fan')).toBeLessThanOrEqual(900);
    // The Book Sweep: ~800-1000 ms.
    expect(total('sweep')).toBeGreaterThanOrEqual(800);
    expect(total('sweep')).toBeLessThanOrEqual(1000);
    // The Doorway: ~1100-1300 ms.
    expect(total('doorway')).toBeGreaterThanOrEqual(1100);
    expect(total('doorway')).toBeLessThanOrEqual(1300);
    // The Deal's minimum dwell is ~700 ms before readiness can lift it.
    expect(PROGRAM_SPECS.deal.coverMs).toBe(700);
  });
});

describe('route classification (Root choke point)', () => {
  it('classifies entries, exits, and the menu classes; no-ops classify null', () => {
    expect(routeMoveClass('/', '/')).toBeNull();
    expect(routeMoveClass('/story', '/story')).toBeNull();
    expect(routeMoveClass('/t/ABCD', '/t/WXYZ')).toBeNull();
    expect(routeMoveClass('/', '/t/ABCD')).toBe('table-entry');
    expect(routeMoveClass('/online', '/t/ABCD')).toBe('table-entry');
    expect(routeMoveClass('/t/ABCD', '/')).toBe('table-exit');
    expect(routeMoveClass('/t/ABCD', '/online')).toBe('table-exit');
    expect(routeMoveClass('/', '/story')).toBe('story-entry');
    expect(routeMoveClass('/online', '/story')).toBe('story-entry');
    // Destination wins: entering Story Mode is a Doorway even from
    // the profile, and leaving story for menu space is a menu move.
    expect(routeMoveClass('/profile', '/story')).toBe('story-entry');
    expect(routeMoveClass('/story', '/')).toBe('menu-nav');
    expect(routeMoveClass('/', '/profile')).toBe('profile-social');
    expect(routeMoveClass('/profile', '/')).toBe('profile-social');
    expect(routeMoveClass('/', '/online')).toBe('menu-nav');
    expect(routeMoveClass('/rewards', '/')).toBe('menu-nav');
  });
});

describe('the shared controller runs every program on its own timing', () => {
  it('a fan episode covers, swaps, holds, and reveals on the fan spec', () => {
    registerTransitionRenderer(true);
    const m = vi.fn();
    coverThen(m, 'profile-social');
    const snap = getTransitionSnapshot();
    expect(snap.phase).toBe('cover');
    expect(snap.program).toBe('fan');
    vi.advanceTimersByTime(PROGRAM_SPECS.fan.coverMs - 1);
    expect(m).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(m).toHaveBeenCalledTimes(1);
    expect(getTransitionSnapshot().phase).toBe('reveal');
    vi.advanceTimersByTime(PROGRAM_SPECS.fan.holdMs + PROGRAM_SPECS.fan.revealMs);
    expect(getTransitionSnapshot().phase).toBe('idle');
  });

  it('under Neon a menu move runs the ink program on the spray timings', () => {
    themeStore.set('neon');
    registerTransitionRenderer(true);
    const m = vi.fn();
    coverThen(m, 'menu-nav');
    expect(getTransitionSnapshot().program).toBe('ink');
    vi.advanceTimersByTime(SPRAY_COVER_MS - 1);
    expect(m).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(m).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(SPRAY_HOLD_MS + SPRAY_REVEAL_MS);
    expect(getTransitionSnapshot().phase).toBe('idle');
  });

  it('a join during a cover and a snap-back during the reveal keep the episode program', () => {
    registerTransitionRenderer(true);
    const order: string[] = [];
    coverThen(() => order.push('a'), 'story-entry');
    expect(getTransitionSnapshot().program).toBe('doorway');
    vi.advanceTimersByTime(100);
    coverThen(() => order.push('b'), 'menu-nav'); // joins, keeps doorway
    vi.advanceTimersByTime(PROGRAM_SPECS.doorway.coverMs - 100);
    expect(order).toEqual(['a', 'b']);
    vi.advanceTimersByTime(PROGRAM_SPECS.doorway.holdMs + 100); // dissolving
    coverThen(() => order.push('c'), 'profile-social'); // snap-back, keeps doorway
    const snap = getTransitionSnapshot();
    expect(snap.phase).toBe('cover');
    expect(snap.program).toBe('doorway');
    expect(snap.fromCoverage).toBeGreaterThan(0);
    vi.advanceTimersByTime(PROGRAM_SPECS.doorway.coverMs);
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('suppression is an instant cut for every move class', () => {
    registerTransitionRenderer(true);
    fxStub.reduced = true;
    for (const c of ['menu-nav', 'profile-social', 'table-exit', 'story-entry'] as MoveClass[]) {
      const m = vi.fn();
      coverThen(m, c);
      expect(m).toHaveBeenCalledTimes(1);
      expect(getTransitionSnapshot().phase).toBe('idle');
    }
  });
});

describe('the Deal — ready-driven entry lifecycle', () => {
  it('lifts only when BOTH the dwell has passed AND the table signalled ready', () => {
    registerTransitionRenderer(true);
    coverTableEntry();
    expect(getTransitionSnapshot()).toMatchObject({ phase: 'cover', program: 'deal' });
    vi.advanceTimersByTime(300);
    signalTableReady(); // ready early: the dwell still owns the lift
    expect(getTransitionSnapshot().phase).toBe('cover');
    vi.advanceTimersByTime(PROGRAM_SPECS.deal.coverMs - 300 - 1);
    expect(getTransitionSnapshot().phase).toBe('cover');
    vi.advanceTimersByTime(1); // dwell completes -> lift
    expect(getTransitionSnapshot().phase).toBe('reveal');
    vi.advanceTimersByTime(PROGRAM_SPECS.deal.revealMs);
    expect(getTransitionSnapshot().phase).toBe('idle');
  });

  it('a late ready signal lifts the cover as soon as it lands', () => {
    registerTransitionRenderer(true);
    coverTableEntry();
    vi.advanceTimersByTime(PROGRAM_SPECS.deal.coverMs + 500); // dwell long done
    expect(getTransitionSnapshot().phase).toBe('cover');
    signalTableReady();
    expect(getTransitionSnapshot().phase).toBe('reveal');
    vi.advanceTimersByTime(PROGRAM_SPECS.deal.revealMs);
    expect(getTransitionSnapshot().phase).toBe('idle');
  });

  it('the readiness cap lifts the cover onto the seats hold — never a trap', () => {
    registerTransitionRenderer(true);
    coverTableEntry();
    vi.advanceTimersByTime(DEAL_READY_CAP_MS - 1);
    expect(getTransitionSnapshot().phase).toBe('cover');
    vi.advanceTimersByTime(1);
    expect(getTransitionSnapshot().phase).toBe('reveal');
    vi.advanceTimersByTime(PROGRAM_SPECS.deal.revealMs);
    expect(getTransitionSnapshot().phase).toBe('idle');
  });

  it('a navigation out from under a deal cover ends the ceremony and runs its own episode', () => {
    registerTransitionRenderer(true);
    coverTableEntry();
    vi.advanceTimersByTime(200);
    const m = vi.fn();
    coverThen(m, 'table-exit'); // the player backed out mid-deal
    const snap = getTransitionSnapshot();
    expect(snap.phase).toBe('cover');
    expect(snap.program).toBe('sweep');
    vi.advanceTimersByTime(PROGRAM_SPECS.sweep.coverMs);
    expect(m).toHaveBeenCalledTimes(1);
  });

  it('signalTableReady outside a deal is a no-op; a suppressed entry never covers', () => {
    registerTransitionRenderer(true);
    signalTableReady();
    expect(getTransitionSnapshot().phase).toBe('idle');
    fxStub.reduced = true;
    coverTableEntry();
    expect(getTransitionSnapshot().phase).toBe('idle');
  });
});

describe('the Card Fan (stage 2)', () => {
  it('wiring: Root classifies route moves and mounts the fan; the social store fans its swaps', () => {
    const main = read('main.tsx');
    expect(main).toContain("import FanLayer from './FanLayer'");
    expect(main).toContain('<FanLayer />');
    expect(main).toContain("routeMoveClass(cur, next) ?? 'menu-nav'");
    const store = read('social/store.ts');
    expect(store.split("coverThen(apply, 'profile-social')")).toHaveLength(6); // all five swaps
  });

  it('construction: seven abstract card backs, compositor-only, the game spade as the mark', () => {
    const fan = read('FanLayer.tsx');
    expect(fan).toContain('FAN_TILTS');
    expect(fan).toContain('[-39, -26, -13, 0, 13, 26, 39]');
    expect(fan).toContain('SPADE_PATH_D');
    expect(fan).toContain('tfan-card');
    expect(fan).not.toContain('<canvas');
    expect(fan).not.toContain('requestAnimationFrame');
    expect(fan).not.toContain('getContext');
    const css = read('transitions.css');
    expect(css).toContain('.tfan-layer');
    expect(css).toContain('z-index: 2000');
    expect(css).toContain('.tfan-neon .tfan-card');
  });

  it('renders the fan only during a fan episode; input locks on cover, frees on reveal', async () => {
    const { createElement } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { default: FanLayer } = await import('../src/FanLayer');
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(FanLayer)));
    act(() => registerTransitionRenderer(true));
    expect(host.querySelector('[data-testid="fan-layer"]')).toBeNull();

    const m = vi.fn();
    act(() => coverThen(m, 'profile-social'));
    const layerEl = host.querySelector<HTMLElement>('[data-testid="fan-layer"]');
    expect(layerEl).not.toBeNull();
    expect(layerEl!.style.pointerEvents).toBe('auto');
    expect(host.querySelectorAll('[data-anim="fan-card"]')).toHaveLength(7);

    act(() => vi.advanceTimersByTime(PROGRAM_SPECS.fan.coverMs));
    expect(m).toHaveBeenCalledTimes(1);
    const revealEl = host.querySelector<HTMLElement>('[data-testid="fan-layer"]');
    expect(revealEl!.dataset.phase).toBe('reveal');
    expect(revealEl!.style.pointerEvents).toBe('none');

    act(() => vi.advanceTimersByTime(PROGRAM_SPECS.fan.holdMs + PROGRAM_SPECS.fan.revealMs));
    expect(host.querySelector('[data-testid="fan-layer"]')).toBeNull();
    act(() => root.unmount());
    host.remove();
  });
});

describe('family-wide construction pins', () => {
  it('the controller paints nothing and runs no frame loop', () => {
    const ctl = read('transitions.ts');
    expect(ctl).not.toContain('requestAnimationFrame');
    expect(ctl).toContain('export function resolveProgram');
    expect(ctl).toContain('export const PROGRAM_SPECS');
  });

  it('the ink skin lives in the spray layer as a program branch over shared geometry', () => {
    const layer = read('SprayLayer.tsx');
    expect(layer).toContain("snap.program === 'ink'");
    expect(layer).toContain('InkCoverArt');
    expect(layer).toContain('id="ink-grad"');
    expect(layer).toContain('INK_DARK');
    // Ink textures are static like the spray's: built once, no loops.
    const tex = read('inkTextures.ts');
    expect(tex).toContain('export function getInkTextures');
    expect(tex).toContain('toDataURL');
    expect(tex).not.toContain('requestAnimationFrame');
    expect(tex).not.toContain('.animate(');
  });
});
