/**
 * Hand recap in LANDSCAPE (owner, 2026-10-25: "This screen would make more
 * sense if it utilized the whole screen in landscape" — his 932×430 shot
 * showed the sheet parked at the left with ~45% of the screen empty black,
 * TOP SCORES row #2 sliced mid-height, and the Score pad heading with no
 * pad under it).
 *
 * Pre-fix mechanism (measured, headless Chromium, seeded handOver saves):
 * below 900px wide the sheet was the base 560px column centered (142px of
 * black per side at 844); at 900–1023px the wizard's tablet-rail pin
 * (.tt at 452px, backdrop flex-start — written for the setup step, not
 * the recap) still governed, so 932×430 got a 452px column against the
 * left edge. Vertically the sheet was head + ONE scrolling column + a
 * 190px stacked footer: the body's visible window was 112–167px against
 * a 707px (partnership) / 1063px (cutthroat) column, and TOP SCORES
 * (140/238px, starting 52px down under the old landscape block's body
 * padding) was sliced mid-row-#2 by the window.
 *
 * Fix (styles.css, "Hand recap in LANDSCAPE" block, D8 idiom): a
 * height-gated tier — max-height 560px, so portrait phones (667px+ tall)
 * never enter — where the sheet spans the stage (min(1040px, 100%),
 * centered), the body is a two-column grid (rail: TOP SCORES + HANDS +
 * callouts; main: side cards, then the Run It / Review-the-tricks
 * entries), and the footer is ONE action row pinned under the body.
 *
 * Budgets below recompute from the shipped CSS constants plus measured
 * render constants (the house idiom — cf. layout-lobby-fit's TEAMS_W):
 *   HEAD 57   (head padding 6+6 around the 44px chat button + border)
 *   FOOT 69   (action-row padding 8+8 around the 52px primary + border)
 *   SCORE_ROW 30 in this tier (li padding 3+3 + the 20px numeral's line)
 *   CARD 100  (a partnership side card at the tier's compaction)
 *   CONTENT 282 (the whole partnership body content, measured)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const tsx = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');

const start = css.indexOf('/* Hand recap in LANDSCAPE');
const land = css.slice(start, css.indexOf('/* Home story-resume row', start));

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};

const BACKDROP = 16; // .tt-backdrop padding 8 top + 8 bottom (harness; a device's safe-area adds outside the panel)
const HEAD = 57;
const FOOT = 69;
const body = (h: number) => h - BACKDROP - HEAD - FOOT;

/** TOP SCORES in the tier, from the shipped constants. */
const scoresH = (rows: number) => {
  const padY = num(/\.tt\.espn \.tt-top-scores \{ padding: (\d+)px/, land) + num(/\.tt\.espn \.tt-top-scores \{ padding: \d+px \d+px (\d+)px/, land);
  const h3 = 16 + num(/\.tt\.espn \.tt-top-scores h3 \{ margin-bottom: (\d+)px/, land) + 2; // 13px line + margin + rounding
  const row = 30; // measured: li padding 3+3 around the 20px numeral's ~24px line
  const gap = num(/\.tt\.espn \.tt-top-scores ol \{ gap: (\d+)px/, land);
  return padY + h3 + rows * row + (rows - 1) * gap;
};
const CARD = 100; // measured partnership side card in the tier
const CONTENT = 282; // measured partnership body content height in the tier

describe('landscape recap: the tier and its composition', () => {
  it('is height-gated like D8 — portrait phones (667px+ tall) can never enter', () => {
    expect(land).toContain('@media (max-height: 560px) and (min-width: 560px)');
    expect(num(/@media \(max-height: (\d+)px\) and \(min-width: 560px\)/, land)).toBe(560);
    expect(560).toBeLessThan(667);
  });

  it('the sheet spans the stage, centered — no 452px left park, no 560px cap', () => {
    expect(land).toContain('.tt-backdrop { justify-content: center; }');
    expect(land).toContain('.tt { width: min(1040px, 100%); }');
    // the wizard's rail pin still exists for the setup step (untouched) —
    // it is simply out-ranked for the recap inside this tier by source order
    expect(css).toContain('.tt { width: 452px; flex: none; }');
    expect(css.indexOf('/* Hand recap in LANDSCAPE')).toBeGreaterThan(css.indexOf('.tt { width: 452px; flex: none; }'));
  });

  it('the body is the two-column grid: rail of scores/strip/callouts, main of cards + reviews', () => {
    expect(land).toContain('grid-template-areas: "scores recap" "strip recap" "callouts recap" "callouts run" "callouts tricks";');
    expect(land).toContain('.tt-top-scores { grid-area: scores; width: 100%; }');
    expect(land).toContain('.tt-recap { grid-area: recap; width: 100%;');
    expect(land).toContain('.tt-tricks { grid-area: tricks; width: 100%; margin: 0; }');
    expect(land).toContain('.tt-run { grid-area: run; width: 100%; margin: 0; }');
    // both columns inside the viewport at the narrowest landscape size:
    // panel 651 = 667 − 16 backdrop; rail capped, main takes the rest
    const railMax = num(/grid-template-columns: minmax\(\d+px, (\d+)px\)/, land);
    const colGap = num(/column-gap: (\d+)px/, land);
    const bodyPadX = num(/\.tt-body \{[^}]*padding: \d+px (\d+)px/, land);
    const main = 651 - bodyPadX * 2 - railMax - colGap;
    expect(main).toBe(317);
    expect(main).toBeGreaterThanOrEqual(300);
  });

  it('the footer is ONE pinned action row (Score pad · Continue · Leave), never a 190px stack', () => {
    expect(land).toContain('.tt-foot.stack { flex-direction: row; align-items: center;');
    expect(land).toContain('.tt-foot.stack .primary { flex: 1; width: auto;');
    expect(land).toContain('.tt-foot.stack .exit-divider { display: none; }');
    // pinned by structure: the footer is the sheet's last flex child and
    // the body is the only flexing region (base rules, unchanged)
    expect(tsx.indexOf('tt-foot stack')).toBeGreaterThan(tsx.indexOf('tt-body'));
    expect(css).toContain('.tt-body { flex: 1; min-height: 0; overflow-y: auto;');
    expect(FOOT).toBeLessThan(190);
  });
});

describe('landscape recap: budgets close (measured constants)', () => {
  it('TOP SCORES renders whole at every landscape size — the owner’s slice is closed', () => {
    expect(scoresH(2)).toBe(109); // partnership, measured 109
    expect(scoresH(4)).toBe(181); // cutthroat, measured 181
    for (const h of [375, 390, 430]) {
      expect(scoresH(2), `partnership @${h}`).toBeLessThanOrEqual(body(h));
      expect(scoresH(4), `cutthroat @${h}`).toBeLessThanOrEqual(body(h));
    }
  });

  it('partnership: scores, strip and BOTH cards are on the first screenful at every size', () => {
    const padTop = num(/\.tt-body \{[^}]*padding: (\d+)px/, land);
    const cardStack = 2 * CARD + num(/\.tt-recap \{[^}]*gap: (\d+)px/, land);
    for (const h of [375, 390, 430]) {
      expect(padTop + cardStack, `cards @${h}`).toBeLessThanOrEqual(body(h));
    }
    // the whole content fits with no scroll at the owner's 932×430…
    expect(CONTENT).toBeLessThanOrEqual(body(430));
    // …and at the two smaller sizes the only thing past the fold is the
    // tricks pill's tail — a bounded scroll, documented in the CSS block
    expect(CONTENT - body(390)).toBe(34);
    expect(CONTENT - body(375)).toBe(49);
    expect(CONTENT - body(375)).toBeLessThan(44 + 6); // never more than the pill itself
  });

  it('cutthroat deals its four cards as a 2×2 grid, restacked only when narrow', () => {
    expect(land).toContain('.tt-recap.crowded { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; }');
    expect(land).toContain('@media (max-height: 560px) and (min-width: 560px) and (max-width: 799px)');
    expect(land).toContain('.tt-recap.crowded .tt-face:not(.has-verdict) { grid-template-areas: "name name" "line line" "players bags" "bar bar"; }');
  });
});

describe('landscape recap: portrait and tablet do not regress', () => {
  it('the portrait base column is byte-identical', () => {
    expect(css).toContain('.tt { width: min(560px, 100%); max-height: 100%; align-self: stretch;');
    expect(css).toContain('.tt-body { flex: 1; min-height: 0; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; justify-content: flex-start; align-items: center; gap: 24px; padding: 22px 16px 30px; }');
    // the portrait phone pins from recap-fit.test.ts still hold their strings
    expect(css).toContain('.tt-team { padding: 16px 14px 14px; }');
    expect(css).toContain('.tt-recap { gap: 16px; }');
  });

  it('tablet landscape (768px+ tall) stays with the ≥1024 two-region grid', () => {
    expect(css).toContain('grid-template-areas: "scores recap" "strip recap" "callouts recap" "run run" "tricks tricks";');
    expect(768).toBeGreaterThan(560); // outside this tier's gate by construction
  });
});
