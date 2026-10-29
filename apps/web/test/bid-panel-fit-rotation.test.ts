/**
 * Bid panel fit × rotation — the founder's iPhone defect of 2026-10-29:
 * "It's only blocked if I switch from portrait mode when the bid window is
 * showing — only then does it cover the cards."
 *
 * Mechanism: the panel anchor (--hand-clear) is computed from the Scene's
 * __bwmLayout publish mixed with window.innerHeight. Mid-flip the window
 * is already landscape while the publish still carries the portrait
 * canvas's dims + rects (the Scene's size commit trails the flip). The
 * old tick mixed them anyway: portrait hand tops (~530px) against the
 * landscape height (390px) produced a negative clear, the 60px floor
 * turned it into an anchor, and the panel sat ON the fan — rewritten by
 * every 400ms tick for as long as the publish stayed stale. Fresh opens
 * in landscape were fine (publish already converged), which is why the
 * resting-state probes of rotation rounds 1–3 never saw it.
 *
 * The fix, pinned here:
 *   1. A publish whose stamped dims disagree with the live window is
 *      stale (the other orientation's geometry) and never anchors.
 *   2. While stale, Table REMOVES the inline --hand-clear: the panel
 *      rides the current orientation's CSS fallback (proven to clear
 *      the fan on its own in bid-panel-fan-fit.test.ts) until the
 *      publish converges and the measured clear takes over.
 *   3. The fit effect re-runs on the whole committed viewport record,
 *      so the re-measure lands on the converged record, not at open
 *      time only.
 *   4. A measured top outside the live viewport can never become an
 *      anchor (the old code clamped it into the 60px floor value).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handClearPx, layoutPublishStale } from '../src/bidPanelFit';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const table = read('../src/Table.tsx');
const scene = read('../src/three/Scene.tsx');

describe('layoutPublishStale: a publish is trusted only when its stamp matches the live window', () => {
  it('settled publish (stamp == window) is fresh, both orientations', () => {
    expect(layoutPublishStale({ w: 390, h: 844 }, 390, 844)).toBe(false);
    expect(layoutPublishStale({ w: 844, h: 390 }, 844, 390)).toBe(false);
    expect(layoutPublishStale({ w: 932, h: 430 }, 932, 430)).toBe(false);
  });

  it('the defect: portrait publish against the landscape window is stale', () => {
    expect(layoutPublishStale({ w: 390, h: 844 }, 844, 390)).toBe(true);
    expect(layoutPublishStale({ w: 430, h: 932 }, 932, 430)).toBe(true);
  });

  it('the reverse flip: landscape publish against the portrait window is stale', () => {
    expect(layoutPublishStale({ w: 844, h: 390 }, 390, 844)).toBe(true);
  });

  it('same orientation but mid-stream dims are stale', () => {
    expect(layoutPublishStale({ w: 700, h: 500 }, 844, 390)).toBe(true);
    expect(layoutPublishStale({ w: 844, h: 844 }, 844, 390)).toBe(true);
  });

  it('rounding-band differences (chrome wiggle, sub-pixel) stay fresh', () => {
    expect(layoutPublishStale({ w: 844, h: 382 }, 844, 390)).toBe(false);
    expect(layoutPublishStale({ w: 390, h: 844 }, 390, 852)).toBe(false);
  });

  it('an unusable stamp (zero dims) is stale', () => {
    expect(layoutPublishStale({ w: 0, h: 0 }, 844, 390)).toBe(true);
  });
});

describe('handClearPx: only a hand top inside the live viewport becomes an anchor', () => {
  it('computes the resting clear: window height − hand top + 6', () => {
    expect(handClearPx(200, 390)).toBe(196);
    expect(handClearPx(572, 844)).toBe(278);
  });

  it('keeps the 60px floor for a genuinely low hand', () => {
    expect(handClearPx(380, 390)).toBe(60);
  });

  it('the defect arithmetic can no longer happen: a portrait top against the landscape height yields no anchor', () => {
    // old code: max(60, 390 − 530 + 6) = 60 → panel parked on the fan
    expect(handClearPx(530, 390)).toBeNull();
    expect(handClearPx(844, 390)).toBeNull();
  });

  it('rejects negative and non-finite tops', () => {
    expect(handClearPx(-4, 390)).toBeNull();
    expect(handClearPx(Infinity, 390)).toBeNull();
    expect(handClearPx(NaN, 390)).toBeNull();
  });
});

describe('Table wires the guard into the measure tick', () => {
  it('consults the stale check before anchoring on the 3D publish', () => {
    expect(table).toContain("from './bidPanelFit'");
    expect(table).toContain('layoutPublishStale(L, window.innerWidth, window.innerHeight)');
    expect(table).toContain('if (L?.hand?.length && !stale) top = Math.min(...L.hand.map((q) => q.y));');
  });

  it('drops the inline clear while stale, so the orientation CSS fallback carries the panel', () => {
    expect(table).toContain("el.style.removeProperty('--hand-clear')");
  });

  it('anchors through handClearPx (out-of-viewport tops never clamp onto the fan)', () => {
    expect(table).toContain('const clear = handClearPx(top, window.innerHeight);');
    expect(table).toContain("el.style.setProperty('--hand-clear', `${clear}px`);");
  });

  it('re-fits on the committed viewport record, not the open-time geometry', () => {
    expect(table).toContain('}, [measureHand, vp]);');
  });

  it('the Scene publish carries the size stamp the guard consumes', () => {
    expect(scene).toContain('__bwmLayout');
    expect(scene).toContain('w: size.width, h: size.height');
  });
});
