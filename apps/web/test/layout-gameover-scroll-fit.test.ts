/**
 * Game-over sheet: standings must never live inside a scroll region
 * (owner, 2026-10-28 — "I can't see the other teams score unless I
 * scroll"; the victory-placement probe then measured the sheet's inner
 * .scroll region at ~0px tall in landscape on the OFFLINE sheet: the
 * flex column's only flexible child absorbed the whole deficit, the
 * placements sat behind an invisible sliver-scroll, and the stacked
 * action column spilled past the sheet's bottom edge).
 *
 * The fix is structural, in two parts (landed with the story-outro
 * standings fix, layout-gameover-landscape-fit.test.ts):
 *  (1) Table.tsx renders <ol className="placements"> as FIXED sheet
 *      content above the .scroll region — only the box score scrolls.
 *  (2) styles.css gives .modal.gameover the D8-style landscape
 *      composition under @media (max-height: 560px): hero band across
 *      the top, standings left + box-score scroll right in the middle
 *      row, the actions as ONE row pinned across the bottom.
 * This file's pins add the two things that composition's own budget
 * (modeled on a smaller sheet box) did not lock: the action row is
 * shrunk to a measured 44px inside the tier (at the base 20px its
 * labels wrap and the row measures ~76px, straight out of the middle
 * row), and the arithmetic is checked against the REAL sheet box —
 * the backdrop's --m-top/--m-bot caps (12px each headless), not the
 * 54/16 pads of the sheet-backdrop variant. The middle row (standings
 * + the box score's scroll window) must stay honestly tall at
 * 844×390 / 932×430 even in the worst case (shot-out banner AND
 * series chip both riding, cutthroat's four standings rows). The
 * geometry itself is asserted in gameover-scroll-fit.e2e.ts.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

const tierStart = css.indexOf('Game-over sheet in LANDSCAPE');
const tier = tierStart >= 0 ? css.slice(tierStart, css.indexOf('.exit-divider { display: none; }', tierStart) + 80) : '';

/** First capture group of `re` in `hay`, as a float — fails loudly if absent. */
const num = (hay: string, re: RegExp): number => {
  const m = hay.match(re);
  expect(m, `pattern ${re} not found`).not.toBeNull();
  return parseFloat(m![1]!);
};

describe('game-over sheet — standings are fixed content (JSX)', () => {
  it('renders the placements list ABOVE the gameover scroll region, box score inside it', () => {
    const offline = table.slice(table.indexOf('{showResults && st.result && !online?.victory'), table.indexOf('<AnimFxLayer'));
    expect(offline.length).toBeGreaterThan(100);
    const placementsAt = offline.indexOf('<ol className="placements">');
    const scrollAt = offline.indexOf('data-testid="gameover-scroll"');
    const boxScoreAt = offline.indexOf('<BoxScore', scrollAt);
    expect(placementsAt).toBeGreaterThan(-1);
    expect(scrollAt).toBeGreaterThan(placementsAt);
    expect(boxScoreAt).toBeGreaterThan(scrollAt);
  });
});

describe('game-over sheet in LANDSCAPE (the D8-style tier)', () => {
  it('the tier exists under the short-height gate', () => {
    expect(tierStart).toBeGreaterThan(-1);
    expect(tier).toContain('@media (max-height: 560px)');
    expect(tier).toContain('.modal.gameover { display: grid;');
  });

  it('hero band spans the top; standings left and box score right share the middle row', () => {
    expect(tier).toContain('grid-template-rows: auto auto auto auto auto minmax(0, 1fr) auto;');
    expect(tier).toContain('.modal.gameover .trophy { grid-column: 1 / -1; grid-row: 1;');
    expect(tier).toContain('.modal.gameover h2 { grid-column: 1 / -1; grid-row: 2;');
    expect(tier).toContain('.modal.gameover .placements { grid-column: 1; grid-row: 6;');
    expect(tier).toContain('.modal.gameover .go-scroll { grid-column: 2; grid-row: 6; }');
    // the scroll region's min-height: 0 comes from the shared contract —
    // without it a grid row would refuse to shrink and clip instead
    expect(css).toContain('.sheet > .sheet-body, .sheet > .scroll, .modal > .scroll { flex: 1 1 auto; min-height: 0; overflow: auto;');
  });

  it('the actions are one pinned row across the bottom — no stacked column, no divider', () => {
    expect(tier).toContain('.modal.gameover .confirm-actions { grid-column: 1 / -1; grid-row: 7; flex-direction: row;');
    expect(tier).toContain('.modal.gameover .confirm-actions .exit-divider { display: none; }');
    // the tier shrinks the buttons (base 20px wraps them to a 76px row)
    expect(tier).toContain(' min-height: 44px; }');
    expect(tier).toContain('font-size: 13px; padding: 9px 8px; min-height: 44px;');
  });

  it('portrait is untouched: the base sheet stays a flex column with its original standings rows', () => {
    expect(css).toContain('.modal.gameover { position: relative; }');
    // grid composition exists ONLY inside the tier
    expect(css.indexOf('.modal.gameover { display: grid;')).toBeGreaterThan(tierStart);
    expect(css).toContain('.placements li { display: flex; gap: 10px; align-items: center; padding: 8px 12px;');
  });
});

describe('game-over landscape budget — the middle row stays honest', () => {
  // Backdrop caps: --m-top/--m-bot are max(12px, …safe-area…); headless and
  // landscape phones resolve them to 12px, so the sheet cap is vh − 24.
  const cap = (vh: number) => vh - num(css, /--m-top: max\((\d+)px/) - num(css, /--m-bot: max\((\d+)px/);
  const padV = 2 * num(tier, /\.modal\.gameover \{[^}]*padding: (\d+)px/);
  const gaps = 6 * num(tier, /\.modal\.gameover \{[^}]*gap: (\d+)px/);
  // Hero: trophy font × its base line-height 1.05; h2 and the banner at a
  // modeled 1.2 line-height; the result line at its tier 1.3.
  const hero =
    num(tier, /\.trophy \{[^}]*font-size: (\d+)px/) * num(css, /\.gameover \.trophy \{[^}]*line-height: ([\d.]+)/) +
    num(tier, /\.modal\.gameover h2 \{[^}]*font-size: (\d+)px/) * 1.2 +
    num(tier, /end-reason"\] \{[^}]*font-size: (\d+)px/) * num(tier, /end-reason"\] \{[^}]*line-height: ([\d.]+)/);
  const banner = num(tier, /\.shot-out-banner \{[^}]*font-size: (\d+)px/) * 1.2;
  const chipAllowance = 30; // a one-line .series-chip button, modeled generously
  const actions = num(tier, /font-size: 13px; padding: 9px 8px; min-height: (\d+)px/);
  const middle = (vh: number, extras: number) => cap(vh) - padV - hero - extras - gaps - actions;

  // Standings rows in the tier: vertical padding + the score figure's
  // line box (17px at 1.2 is the tallest content), list gap between rows.
  const rowH =
    2 * num(tier, /\.placements li \{ padding: (\d+)px/) +
    num(tier, /\.placements li b \{ font-size: (\d+)px/) * 1.2;
  const standings = (rows: number) => rows * rowH + (rows - 1) * num(tier, /\.placements \{[^}]*gap: (\d+)px/);

  it('the box-score scroll window is a real window (≥130px) even with banner + chip at 844×390', () => {
    expect(middle(390, banner + chipAllowance)).toBeGreaterThanOrEqual(130);
    expect(middle(430, banner + chipAllowance)).toBeGreaterThanOrEqual(170);
    expect(middle(390, 0)).toBeGreaterThanOrEqual(185);
  });

  it("cutthroat's four standings rows fit inside the worst-case middle row", () => {
    expect(standings(4)).toBeLessThanOrEqual(middle(390, banner + chipAllowance));
    expect(standings(2)).toBeLessThanOrEqual(middle(390, banner + chipAllowance));
  });
});
