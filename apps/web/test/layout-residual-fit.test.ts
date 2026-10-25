/**
 * D4 residual sweep (design audit 2026-10-24, worker W6): the last
 * sub-44px tap targets in styles.css + social.css that the earlier
 * batches deferred. Sizes are parsed from the shipped CSS — a regression
 * under 44 (or a budget that stops closing) fails here.
 *
 *   item  shipped rule                              was -> now
 *   ----  ----------------------------------------  ----------------
 *   1     .ot-filters button (social.css)           ~30 tall -> min-height 44
 *   2     .db-close / .db-use                       VERIFIED already 44 at
 *                                                   d0db85cd (W1) — pinned
 *                                                   in layout-tapfloor-fit /
 *                                                   layout-setupbar-fit, not
 *                                                   re-pinned here
 *   3     .link.bwm-loading-back                    ~39-40 -> min-height 44
 *   4     .primary (base rule)                      ~40 plain -> min-height 44
 *         .micro-action (wizard JOIN)               ~40 -> min-height 44
 *         .ess .name-input                          ~41 -> min-height 44
 *         .setup-card-toggle                        ~17 box -> min-height 44
 *   5     .seg button (the "1/2/3/4" minimum-books  34-37 WIDE x 44 tall ->
 *         stepper is a plain .seg)                  min-width 44 on the base
 *                                                   rule; the flex-distributed
 *                                                   seg contexts keep their
 *                                                   min-width: 0 overrides
 *
 * Budget notes (proved below / by the re-run sibling suites):
 *  - .primary in the setup bar is always .primary.big, whose height is
 *    padding-derived (14x2 + 20x1.2 = 52) — a 44 floor is a no-op there,
 *    so the D3 bar budget (122 vs 138 reserve, 16px clearance) is
 *    unchanged. The plain-.primary contexts that do grow (~+4) are all
 *    in flow/scroll containers; the compact inline primaries inside
 *    social rows (.soc-pl-acts, .soc-compose, .ot-acts, toast/invite
 *    button rows) already carry their own min-height: 44 container
 *    rules and do not move.
 *  - .bwm-loading-back lives in the .bwm-loading shell, which scrolls
 *    (D5 fix); +~4px on an optional Back link is absorbed by that
 *    scroll + safe centering. layout-loading-fit re-pins the stacks.
 *  - Item 5 arithmetic at 375: section content = 375 - 2x18 (.wiz-step
 *    padding) - 2x14 (.setup-card padding) = 311px. The seg's own box =
 *    4 chips x 44 + 3 gaps x 3 + 2 seg padding x 3 = 191px <= 311 (and
 *    the row wraps under .ess-row's wrap rule where the label shares
 *    the line, so nothing is squeezed at wider widths either).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');
const social = read('../src/social/social.css');

/** Body of the first rule for `sel` in `s` (line-start match preferred). */
const rule = (sel: string, s: string) => {
  let i = s.indexOf('\n' + sel + ' {');
  if (i < 0) i = s.indexOf(sel + ' {');
  if (i < 0) throw new Error(`rule not found: ${sel}`);
  return s.slice(i, s.indexOf('}', i));
};
const dim = (body: string, prop: string) => {
  const m = body.match(new RegExp(`(?<![-\\w])${prop}:\\s*(\\d+(?:\\.\\d+)?)px`));
  if (!m) throw new Error(`prop ${prop} not found in: ${body.slice(0, 80)}`);
  return parseFloat(m[1]!);
};

describe('W6 residual: styles.css tap floor', () => {
  for (const sel of ['.primary', '.micro-action', '.ess .name-input', '.setup-card-toggle', '.bwm-loading-back'] as const) {
    it(`${sel} has min-height >= 44`, () => {
      expect(dim(rule(sel, css), 'min-height')).toBeGreaterThanOrEqual(44);
    });
  }

  it('.primary raise is a no-op for the setup bar: .big height (52) already exceeds the floor', () => {
    const big = rule('.big', css);
    const bigHeight = dim(big, 'padding') * 2 + dim(big, 'font-size') * 1.2;
    expect(bigHeight).toBe(52);
    expect(dim(rule('.primary', css), 'min-height')).toBeLessThanOrEqual(bigHeight);
    // and the reserve the bar budget is checked against is untouched
    expect(css).toContain('.ess-barred { padding-bottom: calc(138px + env(safe-area-inset-bottom)); }');
  });

  it('the loading shell still scrolls, so the taller Back link is always reachable (D5 mechanism intact)', () => {
    expect(css).toContain('.bwm-loading { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; overflow-y: auto;');
    expect(css).toContain('.bwm-loading-card { width: min(100%, 360px); margin: auto;');
  });
});

describe('W6 residual: the 1/2/3/4 seg stepper meets the floor on BOTH axes', () => {
  it('.seg button has min-width >= 44 (min-height 44 was W1)', () => {
    const b = rule('.seg button', css);
    expect(dim(b, 'min-width')).toBeGreaterThanOrEqual(44);
    expect(dim(b, 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('the 4-chip seg fits the 375px section content with room to spare', () => {
    const seg = rule('.seg', css);
    const chip = dim(rule('.seg button', css), 'min-width');
    const segBox = 4 * chip + 3 * dim(seg, 'gap') + 2 * dim(seg, 'padding');
    expect(segBox).toBe(191);
    // 375 - 2*18 (.wiz-step side padding) - 2*14 (.setup-card side padding)
    expect(segBox).toBeLessThanOrEqual(311);
  });

  it('flex-distributed seg contexts keep their min-width: 0 overrides (they already span their row)', () => {
    expect(rule('.ess-row.stack > .seg button', css)).toContain('min-width: 0');
    expect(rule('.sf-row.seg-stack > .seg button', css)).toContain('min-width: 0');
    expect(rule('.set-group .seg button', css)).toContain('min-width: 0');
  });
});

describe('W6 residual: social.css Open Tables filter chips', () => {
  it('.ot-filters button has min-height >= 44', () => {
    expect(dim(rule('.ot-filters button', social), 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('the filter row still composes as a horizontal scroll-flow (no fixed budget)', () => {
    const row = rule('.ot-filters', social);
    expect(row).toContain('display: flex');
    expect(row).toContain('overflow-x: auto');
    expect(rule('.ot-filters button', social)).toContain('flex: none');
  });
});
