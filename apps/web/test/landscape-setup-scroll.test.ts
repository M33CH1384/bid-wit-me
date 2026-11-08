/**
 * LANDSCAPE SETUP: ONE PAGE SCROLL + PINNED BAR (owner pick, 2026-11-08).
 *
 * The teams-dropdown lane proved the setup form cannot fit a phone-
 * landscape viewport by compaction (column totals 422/488/646px against
 * a 366px budget at 932x430). Offered four directions, the owner picked
 * (C): the form scrolls as ONE page in phone landscape and the commit
 * bar (DEAL ME IN / CREATE TABLE) stays FIXED at the bottom — the
 * portrait composition, inside the landscape stage's bounded scrollport.
 * That pick concedes the no-inner-scroll landscape gate FOR THIS FORM
 * SURFACE ONLY; game/recap surfaces keep the gate.
 *
 * Before this change the S1 land-phone block (design audit 2026-10-25)
 * laid .ess-barred out as a 3-column grid and made the bar a STATIC
 * grid item at the top of the last column: the bar scrolled away with
 * the form, columns ended at unrelated heights, and card bottoms were
 * sliced at the scrollport's edge. These pins hold the picked contract:
 *
 *  (1) ONE COLUMN — no grid, no explicit card placements in the
 *      land-phone block; the cards stack in DOM order like portrait.
 *  (2) BAR PINNED — no land-phone rule un-fixes the bar; the base
 *      position:fixed pin (setup-scroll-safety) governs at this tier.
 *  (3) CLEARANCE — the land-phone block no longer zeroes the
 *      scrollport's 122px bottom margin (the all-landscape binding in
 *      layout-wiztable-fit), so the last card scrolls fully clear of
 *      the bar; and the bar's land-phone widening to 860px goes with
 *      the grid, back to the base min(560px, 100%) over the column.
 *  (4) STEP WIDTH — the step no longer stretches full-width for the
 *      grid; the base 560px centred column governs.
 *
 * Guards that pass before AND after (the preserved half): the 54px
 * step top padding that clears the Gate-G absolute head, the create
 * preview's 176px land-phone height, no overflow-y scroller is
 * introduced inside the form at this tier, and the portrait 138px
 * end reserve is untouched.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const LAND_PHONE = '@media (orientation: landscape) and (max-height: 540px)';

// The S1 block: the one introduced by the "S1 landscape fit" comment.
const s1CommentAt = css.indexOf('S1 landscape fit');
const s1At = css.indexOf(LAND_PHONE, s1CommentAt);
const s1 = s1At >= 0 ? css.slice(s1At, css.indexOf('\n}', s1At)) : '';

// The land-phone setup-bar widening is a standalone rule with this exact
// text (its own small media block near the base bar rules) — unique in
// the file, so it is pinned by its literal text rather than by position.

describe('landscape setup (owner pick C): one page scroll, pinned bar', () => {
  it('the S1 land-phone block exists', () => {
    expect(s1CommentAt).toBeGreaterThan(0);
    expect(s1At).toBeGreaterThan(0);
    expect(s1.length).toBeGreaterThan(200);
  });

  it('(1) the form is NOT a multi-column grid at this tier — cards stack in one column', () => {
    expect(s1).not.toContain('grid-template-columns: 1.1fr 1fr 1fr');
    expect(s1).not.toMatch(/\.ess\.ess-barred \{[^}]*display: grid/);
    // no explicit per-card grid placements survive
    expect(s1).not.toMatch(/\.ess-barred > \.setup-card\[aria-label/);
  });

  it('(2) no land-phone rule un-fixes the commit bar (it stays pinned to the viewport)', () => {
    expect(s1).not.toMatch(/\.setup-bar \{[^}]*position:/);
    expect(s1).not.toContain('position: static');
  });

  it('(3) the scrollport keeps its bar binding at this tier (no margin-bottom: 0 override)', () => {
    expect(s1).not.toMatch(/:has\(\.setup-bar\) \.wiz-step \{[^}]*margin-bottom: 0/);
  });

  it('(3b) the bar is not widened past the form column at this tier', () => {
    expect(css).not.toContain('.setup-bar { width: min(860px, 100%); }');
  });

  it('(4) the step keeps the portrait column width at this tier (560px, over the bar)', () => {
    expect(s1).not.toMatch(/\.wiz-step \{[^}]*max-width: none/);
    // stated explicitly in the S1 block: the generic land-phone step
    // rule further up the file widens every wizard step to 860px, and
    // the setup column must stay the base 560px so it sits exactly
    // over the fixed bar's min(560px, 100%).
    expect(s1).toMatch(/\.wizard\.step-table \.wiz-step \{[^}]*max-width: 560px/);
  });

  it('guard: the 54px step top padding (Gate-G head clearance) survives', () => {
    expect(s1).toMatch(/\.wiz-step \{[^}]*padding: 54px/);
  });

  it('guard: no inner vertical scroller is introduced inside the form at this tier', () => {
    expect(s1).not.toMatch(/overflow-y: (auto|scroll)/);
  });

  it('guard: the create-form preview keeps its 176px land-phone height', () => {
    expect(css).toContain('.wizard.step-table .setup-card .setup-preview { height: 176px; }');
  });

  it('guard: the portrait end reserve is untouched (138px over the fixed bar)', () => {
    expect(css).toContain('.ess-barred { padding-bottom: calc(138px + env(safe-area-inset-bottom)); }');
  });
});
