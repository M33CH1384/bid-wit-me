/**
 * Wizard TABLE step, landscape (owner 2026-10-25: "this bot room setup
 * screen is still trash in landscape" + "actually it's the same for
 * online"). The design pass's D3 geometry fix (bar clearance) could not
 * see this COMPOSITION failure; these pins hold the stage discipline:
 *
 *  (1) The PR-E >=900px rail paints a ::after felt slab into a second
 *      grid column on .wizard.step-table. The slab is a static gradient
 *      with no content in EITHER branch (vs-bots setup and online
 *      create-table render no preview element at this step, and the
 *      gradient never reflects the chosen deck/venue/seats) — in
 *      landscape it only steals width (measured at 932x430: form column
 *      404px, cards crushed to 197px) and at short heights it starts at
 *      the wizard's top edge, under the header cluster. In landscape
 *      the slab yields: wizard back to flex, ::after display:none.
 *  (2) The form is 1,047–1,553px tall at phone-landscape sizes against a
 *      375–430px viewport, and the stage had no height discipline: the
 *      page scrolled under the viewport-fixed commit bar, which sliced
 *      the form mid-card at rest. The step is now a bounded scrollport
 *      (100dvh stage, overflow-y auto, top-aligned) whose bottom edge is
 *      bound to the bar's top edge by a margin equal to the D3 bar
 *      budget (122px; the ticker lift and the wizard's bottom padding
 *      carry the same 38px/safe-area terms on both sides, so the edges
 *      stay coincident in both ticker states). The :has(.setup-bar)
 *      gate keeps the bar-less online lobby view on the same stage
 *      without the dead margin.
 *  (3) With the bound providing clearance, the in-scroll end reserve
 *      (.ess-barred) drops to the contract's 16px in landscape; the
 *      portrait reserve (138px) is untouched, as is the whole portrait
 *      composition (the PR-E rail still governs portrait widths).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};

// The D3 bar budget, recomputed from the shipped constants exactly as
// layout-setupbar-fit.test.ts closes it (worst case vs-bots bar).
const barHeight =
  num(/\.setup-bar \{[^}]*padding: (\d+)px 18px/, css) +
  num(/\.setup-bar-summary \{[^}]*font-size: (\d+)px/, css) * 1.25 +
  num(/\.setup-bar-summary \{[^}]*margin: 0 0 (\d+)px/, css) +
  (num(/\.big \{ width: 100%; padding: (\d+)px;/, css) * 2 + num(/\.big \{ width: 100%; padding: \d+px; font-size: (\d+)px/, css) * 1.2) +
  (num(/\.setup-bar \.sticky-note \{ margin: (\d+)px/, css) + num(/\.sticky-note \{[^}]*font-size:\s*(\d+)px/, css) * 1.35) +
  num(/\.setup-bar \{[^}]*padding: \d+px 18px calc\((\d+)px/, css);

// The landscape stage block: from its @media line to its closing brace.
const landAt = css.indexOf('@media (orientation: landscape) {');
const land = landAt >= 0 ? css.slice(landAt, css.indexOf('\n}', landAt)) : '';
const railAt = css.indexOf('.wizard.step-table { display: grid;');

const inLand = (sel: string) => {
  const i = land.indexOf(sel + ' {');
  if (i < 0) throw new Error(`rule not found in landscape block: ${sel}`);
  return land.slice(i, land.indexOf('}', i));
};

describe('wizard table step: the felt slab yields in landscape', () => {
  it('the landscape stage block exists and is placed after the PR-E rail block (wins at 932px-wide short landscape)', () => {
    expect(railAt).toBeGreaterThan(0);
    expect(landAt).toBeGreaterThan(railAt);
  });
  it('wizard returns to a bounded flex stage and the ::after slab is display:none', () => {
    const wiz = inLand('.wizard.step-table');
    expect(wiz).toContain('display: flex');
    expect(wiz).toContain('height: 100dvh');
    expect(inLand('.wizard.step-table::after')).toContain('display: none');
  });
  it('the PR-E rail itself still ships (portrait tablets keep the shipped composition)', () => {
    expect(css.slice(railAt, railAt + 120)).toContain('grid-template-columns: 452px minmax(0, 1fr)');
    expect(css).toContain(".wizard.step-table::after { content: ''; grid-row: 1 / span 20; grid-column: 2;");
  });
});

describe('wizard table step: bounded scrollport bound to the commit bar', () => {
  it('the step is a top-aligned scrollport', () => {
    const step = inLand('.wizard.step-table .wiz-step');
    expect(step).toContain('overflow-y: auto');
    expect(step).toContain('min-height: 0');
    expect(step).toContain('justify-content: flex-start');
  });
  it('the scrollport bottom margin equals the D3 bar budget (122px), gated on a bar being present', () => {
    expect(barHeight).toBeLessThanOrEqual(122); // the budget ceiling, as closed in layout-setupbar-fit
    const gated = inLand('.wizard.step-table:has(.setup-bar) .wiz-step');
    expect(gated).toContain('margin-bottom: 122px');
  });
  it('the in-scroll end reserve drops to the 16px contract minimum in landscape', () => {
    expect(inLand('.wizard.step-table .ess-barred')).toContain('padding-bottom: 16px');
  });
  it('the portrait end reserve is untouched (138px = bar + 16)', () => {
    expect(num(/\.ess-barred \{ padding-bottom: calc\((\d+)px/, css)).toBe(138);
  });
});
