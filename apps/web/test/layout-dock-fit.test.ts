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

  it('slotted CSS fills the slot exactly, in flow', () => {
    expect(css).toContain('.sound-dock.slotted { position: relative; width: 100%; height: 100%; display: block; }');
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
});
