/**
 * @vitest-environment happy-dom
 *
 * D1 (design audit 2026-10-24, P0): the sound dock collided with the header's
 * right-side buttons at EVERY size/theme (sound-button × social-btn 30–45px,
 * × gear 8–46px) and floated over the versus intro + table loading screens.
 *
 * Root cause: SoundDock parked a position:fixed box on its slot's MEASURED
 * viewport rect (CSS vars --dock-top/right/w/h). The measurement raced the
 * app's own transition transforms and only re-synced on mutation / resize /
 * scroll / a 1s tick, so the box landed stale; and on screens with no slot
 * (versus, loading) the fixed fallback painted over the immersive layer.
 *
 * Fix: the dock renders INTO the slot (React portal) — in the header's own
 * flow its rect IS the slot's rect, so intersection with the header's other
 * flex items is impossible by construction — and CSS stands the dock down
 * entirely while a modal sheet, the Social panel, the versus/loading hold or
 * the victory screen is up. The recap (.tt-backdrop) is deliberately NOT a
 * suppression trigger: its header reserves dock room (pinned in
 * scorecard-espn.test.ts) and the dock stays reachable over it.
 *
 * Rogue dock (owner report 2026-10-25, follow-up): D1's slotted rule set
 * position:relative but never cleared the base rule's top/right, so the
 * fixed-mode offsets (top: 6–10px + env(safe-area-inset-top), right: 8px +
 * env(safe-area-inset-right)) kept applying as a RELATIVE shift — the
 * speaker sat off its slot everywhere: dropped a full row below the header
 * line on Home (portrait insets), slid across the Social button leaving the
 * slot's frame empty at the corner (landscape), and shoved down out of the
 * scorebug's slot at the table where the bug panel painted over it
 * ("missing"). The audit's Chromium has zero safe-area insets, so it only
 * ever saw the (-8, +10)px residue and passed it. Fix: top/right: auto on
 * the slotted rule (pinned below), and the slot pick now requires a usable
 * slot — connected, real height as well as width, and no hidden ancestor —
 * so a slot stranded in a leaving/hidden subtree can never steal the dock
 * from the live screen's slot.
 */
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');
const sc = read('../src/SoundControls.tsx');

let root: Root | null = null;
let el: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  el?.remove();
  el = null;
  document.body.innerHTML = '';
});

describe('D1: the dock renders into its slot (no measured parking)', () => {
  it('SoundDock portals into the slot element instead of copying its rect', () => {
    expect(sc).toContain('createPortal(dock, slot)');
    // the measured-parking mechanism is gone from the component
    expect(sc).not.toContain("el.style.setProperty(k, x)");
    expect(sc).not.toContain("'--dock-top'");
    // the legacy geometry helpers stay exported (recap-touch pins them)
    expect(sc).toContain('export function speakerSlotBox');
    expect(sc).toContain('export function rectsOverlap');
  });

  it('the slot pick requires a usable slot (connected, real box, no hidden ancestor)', () => {
    // the pick is the mechanism: a width-only first-match let hidden or
    // stranded slots steal the dock (rogue-dock follow-up, 2026-10-25)
    expect(sc).toContain('r.width <= 0 || r.height <= 0');
    expect(sc).toContain('x.isConnected');
    expect(sc).toContain('x.parentElement');
    expect(sc).toContain("cs.visibility === 'hidden'");
  });

  it('slotted CSS fills the slot exactly, in flow', () => {
    // top/right: auto is the rogue-dock fix (2026-10-25): position:relative
    // alone kept the base rule's fixed-mode offsets applying as a relative
    // shift (safe-area insets included) — the dock must sit ON its slot.
    expect(css).toContain('.sound-dock.slotted { position: relative; top: auto; right: auto; width: 100%; height: 100%; display: block; }');
    expect(css).toContain('.sound-dock.slotted .dock-btn { width: 100% !important; height: 100% !important; }');
    // the old var-parked rules are gone
    expect(css).not.toContain('var(--dock-top)');
    expect(css).not.toContain('var(--dock-w)');
    // the slot reserves space invisibly; the portaled dock inside it is visible
    expect(css).toContain('.dock-slot { visibility: hidden;');
    expect(css).toContain('.dock-slot > .sound-dock { visibility: visible; }');
    // scorebug variant: square, anchored to the top of the tall slot (the
    // recap Save-button protection from the old 40px cap, kept)
    expect(css).toContain('.sound-dock.slotted.in-bug { height: auto; aspect-ratio: 1; }');
  });

  it('the pinned fixed fallback + z-order rules survive verbatim', () => {
    expect(css).toContain('.sound-dock { position: fixed; z-index: 70; top: calc(6px + env(safe-area-inset-top)); right: calc(8px + env(safe-area-inset-right)); }');
    expect(css).toContain('.sound-dock { z-index: 1050; }');
  });

  it('suppression: no dock over sheets, Social, versus/loading, or victory', () => {
    expect(css).toContain('#root:has(.bwm-loading) .sound-dock, #root:has(.modal-backdrop) .sound-dock, #root:has(.victory-screen) .sound-dock { display: none; }');
    // Social's backdrop is a .modal-backdrop subclass, so the single
    // .modal-backdrop arm covers the panel + every sheet.
    const social = read('../src/social/Social.tsx');
    expect(social).toContain('modal-backdrop soc-backdrop');
    // the recap is NOT suppressed (deliberate, see header)
    expect(css).not.toContain(':has(.tt-backdrop) .sound-dock');
  });

  it('DOM: with a visible slot, the speaker button lands INSIDE the slot', async () => {
    const { SoundDock } = await import('../src/SoundControls');
    el = document.createElement('div');
    document.body.appendChild(el);
    // the slot lives OUTSIDE the dock's own React root container (React
    // clears its container's children on first render) — in the app it sits
    // in the header markup of the same tree, which is what this models
    const slot = document.createElement('span');
    slot.className = 'dock-slot';
    // happy-dom has no layout: give the slot the rect a browser would
    slot.getBoundingClientRect = () =>
      ({ left: 300, top: 6, right: 340, bottom: 46, width: 40, height: 40, x: 300, y: 6, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(slot);
    root = createRoot(el);
    await act(async () => {
      root!.render(createElement(SoundDock));
    });
    const btn = document.querySelector('[data-testid="sound-button"]');
    expect(btn).not.toBeNull();
    // the button's dock lives inside the slot element — same rect as the slot
    // by construction, so it cannot intersect the header's Social/gear buttons
    expect(slot.contains(btn)).toBe(true);
    expect(btn!.closest('.sound-dock')!.classList.contains('slotted')).toBe(true);
  });

  it('DOM: with no slot, the dock renders its fixed fallback in place', async () => {
    const { SoundDock } = await import('../src/SoundControls');
    el = document.createElement('div');
    document.body.appendChild(el);
    root = createRoot(el);
    await act(async () => {
      root!.render(createElement(SoundDock));
    });
    const btn = document.querySelector('[data-testid="sound-button"]');
    expect(btn).not.toBeNull();
    expect(btn!.closest('.sound-dock')!.classList.contains('slotted')).toBe(false);
  });

  it('DOM: a slot inside a hidden subtree never wins over the live slot', async () => {
    const { SoundDock } = await import('../src/SoundControls');
    el = document.createElement('div');
    document.body.appendChild(el);
    const rect = (w: number, h: number) => () =>
      ({ left: 0, top: 0, right: w, bottom: h, width: w, height: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    // a stranded slot (a leaving screen / closed container): real box, but
    // its subtree is display:none — document order puts it FIRST, and the
    // pre-fix width-only pick took it and the dock vanished with it
    const hiddenWrap = document.createElement('div');
    hiddenWrap.style.display = 'none';
    const deadSlot = document.createElement('span');
    deadSlot.className = 'dock-slot';
    deadSlot.getBoundingClientRect = rect(46, 46);
    hiddenWrap.appendChild(deadSlot);
    document.body.appendChild(hiddenWrap);
    // the live screen's slot
    const liveSlot = document.createElement('span');
    liveSlot.className = 'dock-slot';
    liveSlot.getBoundingClientRect = rect(46, 46);
    document.body.appendChild(liveSlot);
    root = createRoot(el);
    await act(async () => {
      root!.render(createElement(SoundDock));
    });
    const btn = document.querySelector('[data-testid="sound-button"]');
    expect(btn).not.toBeNull();
    expect(liveSlot.contains(btn)).toBe(true);
    expect(deadSlot.contains(btn)).toBe(false);
  });

  it('DOM: a zero-height slot is not a seat — the dock falls back instead', async () => {
    const { SoundDock } = await import('../src/SoundControls');
    el = document.createElement('div');
    document.body.appendChild(el);
    const flat = document.createElement('span');
    flat.className = 'dock-slot';
    // width without height: a collapsed placeholder, not a rendered header box
    flat.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 46, bottom: 0, width: 46, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    document.body.appendChild(flat);
    root = createRoot(el);
    await act(async () => {
      root!.render(createElement(SoundDock));
    });
    const btn = document.querySelector('[data-testid="sound-button"]');
    expect(btn).not.toBeNull();
    expect(flat.contains(btn)).toBe(false);
    expect(btn!.closest('.sound-dock')!.classList.contains('slotted')).toBe(false);
  });
});
