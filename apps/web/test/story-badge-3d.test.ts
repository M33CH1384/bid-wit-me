/**
 * @vitest-environment happy-dom
 *
 * THE BADGE AS AN OBJECT (owner, 2026-10-25: "I really want the badges
 * to be 3d items that take precent in the modal"). The badge popup's
 * flat emblem becomes a CSS-3D medallion coin — the hero of the sheet:
 * a front face carrying the badge's glyph, a back face, and a reeded
 * edge of segments, turning on a slow rock, draggable with momentum;
 * earned is full gold, locked the same coin in dark unlit metal; under
 * reduced effects it rests at a still three-quarter angle (no loop,
 * and no flat icon in its place). The words beneath it are the def's
 * own, on the same data paths the flat sheet used.
 *
 * Pins: the coin construction in the DOM (front/back/edge + the def's
 * glyph on the front), earned vs locked as distinct shipped styling,
 * drag rotating the coin, the reduced still state, and the other
 * popup kinds keeping their flat emblem header untouched.
 */
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STORY_STOPS, storyBadgesFor } from '@spades/bots';
import StoryBadges, { badgeFactsOf } from '../src/story/StoryBadges';
import { FindDetail } from '../src/story/StoryDetailSheet';
import { fx } from '../src/fx';
import type { StoryNewFind } from '../src/story/storyApi';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const storyCss = readFileSync('apps/web/src/story/story.css', 'utf8');

let root: Root; let el: HTMLDivElement;
const qs = <T extends Element = HTMLElement>(sel: string) => el.querySelector(sel) as T | null;
const qsa = (sel: string) => [...el.querySelectorAll(sel)];
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const click = async (target: Element | null) => {
  if (!target) throw new Error('missing element to click');
  await act(async () => { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  await flush();
};
const render = async (node: Parameters<Root['render']>[0]) => {
  await act(async () => { root.render(node); });
  await flush();
};

const facts = badgeFactsOf({
  stops: STORY_STOPS.map((s) => ({ stopId: s.id, attempts: s.id === 'porch' ? 1 : 0, clears: s.id === 'porch' ? 1 : 0 })),
  finds: { eggs: [], feats: [] },
  completed: false,
});
const defs = storyBadgesFor(facts);
const rotateYOf = (transform: string) => {
  const m = transform.match(/rotateY\((-?[\d.]+)deg\)/);
  if (!m) throw new Error(`no rotateY in transform: ${transform}`);
  return parseFloat(m[1]!);
};

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }),
  });
  fx.setReduce(false);
  el = document.createElement('div');
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(async () => {
  fx.setReduce(false);
  await act(async () => { root.unmount(); });
  el.remove();
});

const openBadge = async (id: string) => {
  await render(createElement(StoryBadges, { facts }));
  await click(qs(`[data-testid="story-badge-${id}"]`));
  const sheet = qs('[data-testid="story-badge-detail"]');
  expect(sheet, 'badge detail sheet').not.toBeNull();
  return sheet!;
};

describe('the badge popup — a 3D medallion coin as the hero', () => {
  it('renders the coin construction: front face with the def’s glyph, back face, reeded edge', async () => {
    const sheet = await openBadge('porch-graduate');
    const def = defs.find((b) => b.id === 'porch-graduate')!;
    // the hero sits above the titles: the sheet is in hero layout
    expect(sheet.classList.contains('has-hero')).toBe(true);
    const stage = qs('[data-testid="badge-medal-3d"]');
    expect(stage, '3D stage').not.toBeNull();
    expect(stage!.classList.contains('earned')).toBe(true);
    expect(stage!.classList.contains('locked')).toBe(false);
    expect(stage!.getAttribute('data-motion')).toBe('live');
    const front = qs('[data-testid="badge3d-front"]');
    const back = qs('[data-testid="badge3d-back"]');
    expect(front, 'front face').not.toBeNull();
    expect(back, 'back face').not.toBeNull();
    expect(front!.querySelector('.badge3d-glyph')!.textContent).toBe(def.icon);
    expect(back!.querySelector('.badge3d-back-glyph')!.textContent).toBe(def.icon);
    expect(qsa('.badge3d-edge').length).toBe(48);
    // the name and the def's own words still land beneath the object
    expect(sheet.textContent).toContain(def.name);
    expect(sheet.textContent).toContain(def.about);
    expect(sheet.textContent).toContain(def.detail!);
    // no flat emblem medallion remains in the badge sheet's header
    expect(sheet.querySelector('.story-medal.emblem')).toBeNull();
  });

  it('a locked badge is the same coin in dark metal — stage locked, sheet ghosted', async () => {
    const sheet = await openBadge('egg-hunter');
    const def = defs.find((b) => b.id === 'egg-hunter')!;
    expect(def.earned).toBe(false);
    expect(sheet.classList.contains('ghost')).toBe(true);
    const stage = qs('[data-testid="badge-medal-3d"]')!;
    expect(stage.classList.contains('locked')).toBe(true);
    expect(stage.classList.contains('earned')).toBe(false);
    expect(qs('[data-testid="badge3d-front"] .badge3d-glyph')!.textContent).toBe(def.icon);
    expect(sheet.textContent).toContain(`To unlock: ${def.hint}`);
  });

  it('earned and locked ship as distinct metal in the CSS', () => {
    const earned = storyCss.match(/\.badge3d-front \{[^}]*\}/)![0];
    expect(earned).toContain('#f7dc8d'); // lit gold field
    const locked = storyCss.match(/\.badge3d\.locked \.badge3d-front \{[^}]*\}/)![0];
    expect(locked).toContain('#55555f'); // dark unlit field
    expect(locked).not.toContain('#f7dc8d');
    expect(storyCss).toContain('.badge3d.locked .badge3d-edge');
    expect(storyCss).toContain('.badge3d.locked .badge3d-glyph');
  });

  it('the construction is transform-driven 3D: preserve-3d coin, hidden backfaces, segmented edge', () => {
    expect(storyCss).toMatch(/\.badge3d-coin \{[^}]*transform-style: preserve-3d/);
    expect(storyCss).toMatch(/\.badge3d-face \{[^}]*backface-visibility: hidden/);
    expect(storyCss).toMatch(/\.badge3d-edge \{[^}]*rotateY\(90deg\)/);
    expect(storyCss).toMatch(/\.badge3d-front \{[^}]*translateZ\(8px\)/);
    expect(storyCss).toMatch(/\.badge3d-back \{[^}]*rotateY\(180deg\)[^}]*translateZ\(8px\)/);
    expect(storyCss).toMatch(/@media \(orientation: landscape\) and \(max-height: 540px\) \{\s*\.badge3d \{ --coin: 120px;/);
  });

  it('dragging the stage spins the coin', async () => {
    await openBadge('porch-graduate');
    const stage = qs('[data-testid="badge-medal-3d"]')!;
    const coin = qs('.badge3d-coin')!;
    let before = 0;
    let after = 0;
    await act(async () => {
      before = rotateYOf(coin.style.transform);
      stage.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }));
      stage.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 170 }));
      // read before the release: the move handler's write is synchronous
      // and the idle loop cannot interleave inside the act; on release
      // the coin correctly keeps its momentum and spins on
      after = rotateYOf(coin.style.transform);
      stage.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, clientX: 170 }));
    });
    // a 70px drag at 0.45°/px turns the coin ~31.5°
    expect(after - before).toBeGreaterThan(20);
    expect(after - before).toBeLessThan(45);
  });

  it('reduced effects: the coin rests at the still three-quarter view — no loop, no drag, no flat swap', async () => {
    fx.setReduce(true);
    await openBadge('porch-graduate');
    const stage = qs('[data-testid="badge-medal-3d"]')!;
    expect(stage.classList.contains('still')).toBe(true);
    expect(stage.getAttribute('data-motion')).toBe('still');
    const coin = qs('.badge3d-coin')!;
    expect(coin.style.transform).toBe('rotateX(10deg) rotateY(-28deg)');
    // the construction is still all there — it is a still OBJECT, not an icon
    expect(qs('[data-testid="badge3d-front"]')).not.toBeNull();
    expect(qsa('.badge3d-edge').length).toBe(48);
    expect(stage.querySelector('.badge3d-hint')).toBeNull();
    await act(async () => {
      stage.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100 }));
      stage.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 200 }));
    });
    expect(coin.style.transform).toBe('rotateX(10deg) rotateY(-28deg)');
  });

  it('the other popup kinds keep their flat emblem — the coin lives in the badge sheet only', async () => {
    const find: StoryNewFind = { kind: 'egg', id: 'pjs-opp-set-twice', name: "Brick's Second Blink" };
    await render(createElement(FindDetail, { find, onClose: () => {} }));
    const sheet = qs('[data-testid="story-find-detail"]')!;
    expect(sheet).not.toBeNull();
    expect(sheet.querySelector('[data-testid="badge-medal-3d"]')).toBeNull();
    expect(sheet.querySelector('.story-medal.emblem')).not.toBeNull();
    expect(sheet.classList.contains('has-hero')).toBe(false);
  });
});
