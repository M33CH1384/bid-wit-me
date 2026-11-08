/**
 * MOTION PILL UNDER-PLATE PLACEMENT (owner, 2026-11-08): "The motion
 * button should go under my plate it's covering my card".
 *
 * The shipped pill (d7b8316) rides at bottom:100px portrait /
 * bottom:92px short landscape — in the fan's lower-left corner band.
 * On the owner's phone that band is his cards. His word: the pill goes
 * UNDER his own plate. But the plate parks 8px (portrait) / 10px
 * (short landscape) above the screen bottom — a 44px pill cannot fit
 * under it as the plate sits. So at phone sizes the pill takes the
 * plate's own parking spot and the plate stack (plate + its YOUR TURN
 * tab, which is a child of the plate) lifts by exactly one pill-height
 * plus a 6px gap — ONLY while the pill exists (Motion view on), gated
 * by a pure-CSS :has() on the pill itself, the same no-JS-gate
 * discipline as the plate's own fixed placement (see the founder note
 * on the portrait phone block: a JS class gate missed on a real
 * iPhone once; a CSS gate cannot miss).
 *
 * The contract these pins hold:
 *  (1) PORTRAIT PHONES — inside the (max-width:600px, portrait) block:
 *      the pill parks at the plate's resting spot (left 8, bottom 8),
 *      and a :has(.motion-view-btn) rule lifts .me-plate to bottom:58.
 *  (2) SHORT LANDSCAPE — beside the standing .short plate rule
 *      (bottom:10): the pill parks at bottom:10 under a
 *      .short:has(.motion-view-btn) lift of .me-plate to bottom:60.
 *  (3) GEOMETRY — lift − (floor + 44px pill) = a 6px gap in both
 *      orientations; the pill never shrinks below its 44px tap height.
 *  (4) PRESERVED — with Motion off nothing moves: the resting plate
 *      rules (bottom:8 / bottom:10) stand, and the shipped pill
 *      placements outside phone sizes (bottom:100 base, bottom:92
 *      non-short landscape) stand.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const PORTRAIT_PHONE = '@media (max-width: 600px) and (orientation: portrait)';
const ppAt = css.indexOf(PORTRAIT_PHONE);
const pp = ppAt >= 0 ? css.slice(ppAt, css.indexOf('\n}', ppAt)) : '';

const LANDSCAPE = '@media (orientation: landscape) and (max-height: 560px)';
const lsAt = css.indexOf(LANDSCAPE);
const ls = lsAt >= 0 ? css.slice(lsAt, css.indexOf('\n}', lsAt)) : '';

// The standing short-landscape plate rule (its own line, unique text).
const SHORT_PLATE = ".table-screen.short .me-plate { position: fixed; left: calc(8px + env(safe-area-inset-left)); bottom: calc(10px + env(safe-area-inset-bottom)); }";
const shortPlateAt = css.indexOf(SHORT_PLATE);

const num = (re: RegExp, text: string) => {
  const m = text.match(re);
  return m ? Number(m[1]) : NaN;
};

describe('motion pill under-plate placement (owner, 2026-11-08)', () => {
  it('the phone blocks exist', () => {
    expect(ppAt).toBeGreaterThan(0);
    expect(pp.length).toBeGreaterThan(200);
    expect(lsAt).toBeGreaterThan(0);
    expect(shortPlateAt).toBeGreaterThan(0);
  });

  it('(4) preserved: the resting plate rules stand (Motion off moves nothing)', () => {
    // portrait resting spot: bottom 8 inside the phone block
    expect(pp).toContain('bottom: calc(8px + env(safe-area-inset-bottom))');
    // short-landscape resting spot: the standing rule, verbatim
    expect(css).toContain(SHORT_PLATE);
  });

  it('(1) portrait: the pill parks at the plate’s resting spot, left-aligned with it', () => {
    const pill = pp.match(/\.motion-view-btn \{[^}]*\}/)?.[0] ?? '';
    expect(pill).toContain('left: calc(8px + env(safe-area-inset-left))');
    expect(pill).toContain('bottom: calc(8px + env(safe-area-inset-bottom))');
  });

  it('(1) portrait: the plate stack lifts only while the pill exists', () => {
    const lift = pp.match(/\.table-screen:has\(\.motion-view-btn\) \.me-plate \{[^}]*\}/)?.[0] ?? '';
    expect(lift).toContain('bottom: calc(58px + env(safe-area-inset-bottom))');
  });

  it('(2) short landscape: the pill parks under the plate at its resting offset', () => {
    const pill = css.match(/\.table-screen\.short \.motion-view-btn \{[^}]*\}/)?.[0] ?? '';
    expect(pill).toContain('left: calc(8px + env(safe-area-inset-left))');
    expect(pill).toContain('bottom: calc(10px + env(safe-area-inset-bottom))');
  });

  it('(2) short landscape: the plate stack lifts only while the pill exists', () => {
    const lift = css.match(/\.table-screen\.short:has\(\.motion-view-btn\) \.me-plate \{[^}]*\}/)?.[0] ?? '';
    expect(lift).toContain('bottom: calc(60px + env(safe-area-inset-bottom))');
  });

  it('(3) geometry: lift − (floor + 44px pill) leaves the same 6px gap in both orientations', () => {
    const pLift = num(/\.table-screen:has\(\.motion-view-btn\) \.me-plate \{[^}]*bottom: calc\((\d+)px/, pp);
    const lLift = num(/\.table-screen\.short:has\(\.motion-view-btn\) \.me-plate \{[^}]*bottom: calc\((\d+)px/, css);
    expect(pLift - (8 + 44)).toBe(6);
    expect(lLift - (10 + 44)).toBe(6);
  });

  it('(3) the pill keeps its real 44px tap height', () => {
    // The base rule is the one carrying position:absolute (the scoped
    // phone rules only override left/bottom).
    const base = css.match(/\.motion-view-btn \{[^}]*position: absolute[^}]*\}/)?.[0] ?? '';
    expect(base).toContain('min-height: 44px');
    expect(base).toContain('min-width: 44px');
  });

  it('(4) preserved: non-phone pill placements stand (base 100, non-short landscape 92)', () => {
    const base = css.match(/\.motion-view-btn \{[^}]*position: absolute[^}]*\}/)?.[0] ?? '';
    expect(base).toContain('bottom: calc(100px + env(safe-area-inset-bottom))');
    expect(ls).toContain('bottom: calc(92px + env(safe-area-inset-bottom))');
  });
});
