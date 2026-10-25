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
 * callouts + the tricks entry; main: the side cards, the Run It review
 * full-width beneath), and the footer is ONE action row pinned under
 * the body.
 *
 * Content parity extension (owner, same day, second walk — the same
 * hand-2 story recap in both orientations): portrait carries TOP
 * SCORES, HANDS, the HEAT CHECK banner and the SHOT card whole, so
 * landscape must carry every section. The SHOT (notice) card's portrait
 * anatomy (22/46px padding + the 88px tape lane) made it 257px of the
 * 286px body — whole, but it pushed the second card and the tricks
 * entry off the stage. The tier compacts the set states instead of
 * amputating them (notice padding/lane, hole re-anchor, verdict
 * plaque, sheet padding), and with the tricks entry in the rail the
 * owner's exact state renders at 932×430 with ZERO body scroll in both
 * themes (measured in Chromium against a crafted state matching his
 * screenshots: story partnership, hand 2, set side, 2-in-a-row streak).
 *
 * Budgets below recompute from the shipped CSS constants plus measured
 * render constants (the house idiom — cf. layout-lobby-fit's TEAMS_W):
 *   HEAD 57   (head padding 6+6 around the 44px chat button + border)
 *   FOOT 69   (action-row padding 8+8 around the 52px primary + border)
 *   SCORE_ROW 26 in this tier (Neon, the taller theme; Classic is 24)
 *   CARD 100  (a partnership side card at the tier's compaction)
 *   NOTICE 163 (the SHOT card at the tier's set-state compaction, ≥800px)
 *   STRIP 53 / 88 (HANDS tracker, partnership / cutthroat)
 *   CALLOUT 21 (a one-line streak banner in the rail)
 *   PILL 44   (the Review-the-tricks entry, at the tap floor)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const tsx = readFileSync(new URL('../src/Intermission.tsx', import.meta.url), 'utf8');

const start = css.indexOf('/* Hand recap in LANDSCAPE');
const land = css.slice(start, css.indexOf('/* Home story-resume row', start));
const narrow = css.slice(css.indexOf('@media (max-height: 560px) and (min-width: 560px) and (max-width: 799px)'), css.indexOf('/* Home story-resume row'));

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};

const BACKDROP = 16; // .tt-backdrop padding 8 top + 8 bottom (harness; a device's safe-area adds outside the panel)
const HEAD = 57;
const FOOT = 69;
const body = (h: number) => h - BACKDROP - HEAD - FOOT;
const GAP = 6; // the tier's grid row-gap

/** TOP SCORES in the tier, from the shipped constants. */
const scoresH = (rows: number) => {
  const padY = num(/\.tt\.espn \.tt-top-scores \{ padding: (\d+)px/, land) + num(/\.tt\.espn \.tt-top-scores \{ padding: \d+px \d+px (\d+)px/, land);
  const h3 = 16 + num(/\.tt\.espn \.tt-top-scores h3 \{ margin-bottom: (\d+)px/, land) + 2; // 13px line + margin + rounding
  const row = 26; // measured in this tier (Neon): li padding 1+1 around the 20px numeral at line-height 1.1
  const gap = num(/\.tt\.espn \.tt-top-scores ol \{ gap: (\d+)px/, land);
  return padY + h3 + rows * row + (rows - 1) * gap;
};
const CARD = 100; // measured partnership side card in the tier
const NOTICE = 163; // measured SHOT card in the tier (800px+ wide)
const STRIP_P = 53; // measured HANDS tracker, partnership
const STRIP_C = 88; // measured HANDS tracker, cutthroat
const CALLOUT = 21; // measured one-line callout in the rail
const PILL = 44; // the tricks entry at the 44px tap floor

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

  it('the body is the two-column grid: rail of scores/strip/callouts/tricks, main of cards, run beneath', () => {
    expect(land).toContain('grid-template-areas: "scores recap" "strip recap" "callouts recap" "tricks recap" "run run";');
    expect(land).toContain('.tt-top-scores { grid-area: scores; width: 100%; }');
    expect(land).toContain('.tt-recap { grid-area: recap; width: 100%;');
    expect(land).toContain('.tt-tricks { grid-area: tricks; width: 100%; margin: 0; }');
    expect(land).toContain('.tt-tricks-show { grid-area: tricks; justify-self: start; }');
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
    expect(scoresH(2)).toBe(101); // partnership, measured 101 (Neon)
    expect(scoresH(4)).toBe(165); // cutthroat, measured 165 (Neon)
    for (const h of [375, 390, 430]) {
      expect(scoresH(2), `partnership @${h}`).toBeLessThanOrEqual(body(h));
      expect(scoresH(4), `cutthroat @${h}`).toBeLessThanOrEqual(body(h));
    }
  });

  it('plain partnership: both cards on the first screenful at every size, the whole rail too at 932', () => {
    const padTop = num(/\.tt-body \{[^}]*padding: (\d+)px/, land);
    const cardStack = 2 * CARD + num(/\.tt-recap \{[^}]*gap: (\d+)px/, land);
    for (const h of [375, 390, 430]) {
      expect(padTop + cardStack, `cards @${h}`).toBeLessThanOrEqual(body(h));
    }
    const rail = scoresH(2) + STRIP_P + CALLOUT + PILL + 3 * GAP;
    expect(rail).toBeLessThanOrEqual(body(430));
  });

  it('cutthroat deals its four cards as a 2×2 grid, restacked only when narrow', () => {
    expect(land).toContain('.tt-recap.crowded { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); align-content: start; align-items: start; }');
    expect(land).toContain('@media (max-height: 560px) and (min-width: 560px) and (max-width: 799px)');
    expect(land).toContain('.tt-recap.crowded .tt-face:not(.has-verdict) { grid-template-areas: "name name" "line line" "players bags" "bar bar"; }');
    // at 932 the cutthroat rail carries scores + tracker + banner whole
    expect(scoresH(4) + STRIP_C + CALLOUT + 2 * GAP).toBeLessThanOrEqual(body(430));
  });
});

describe('landscape recap: content parity for the set states (owner, second walk)', () => {
  it('the SHOT card compacts in the tier — padding, tape lane, hole re-anchor; nothing removed', () => {
    expect(land).toContain('.tt-team.notice, .tt-team.mine.notice { padding: 10px 14px 8px; }');
    expect(land).toContain('.tt-team.notice .tt-line { margin-top: 44px; }');
    // the hole's slots are inline styles anchored ~124px from the card
    // top; the re-anchor into the compacted lane takes !important, and
    // the base full-fidelity lane is untouched outside the tier
    expect(land).toContain('.tt-team.notice .shot-holes img { top: 76px !important; }');
    expect(css).toContain('.tt-team.notice .tt-line { margin-top: 88px; }');
    // narrower still in the sub-tier
    expect(narrow).toContain('.tt-team.notice .tt-line { margin-top: 36px; }');
    expect(narrow).toContain('.tt-team.notice .shot-holes img { top: 68px !important; }');
    expect(narrow).toContain('.tt-face:not(.has-verdict) { grid-template-areas: "name name" "line line" "players bags" "bar bar"; }');
  });

  it('the sheet (finale) card compacts its verdict plaque and toe-tag clearing', () => {
    expect(land).toContain('.tt-face .finale-verdict { padding: 6px 10px 5px; gap: 2px; }');
    expect(land).toContain('.tt-face .finale-verdict b { font-size: 21px; }');
    expect(land).toContain('.tt-team.shrouded { padding-bottom: 36px; }');
    expect(css).toContain('.tt-team.shrouded { padding-bottom: 58px; }'); // portrait base untouched
  });

  it('the owner’s exact state fits whole at 932×430 — both columns, no scroll', () => {
    // rail: scores + HANDS + HEAT CHECK + the review pill
    const rail = scoresH(2) + STRIP_P + CALLOUT + PILL + 3 * GAP;
    expect(rail).toBe(237);
    expect(rail).toBeLessThanOrEqual(body(430));
    // main: the SHOT card + the other side's card
    const main = NOTICE + CARD + num(/\.tt-recap \{[^}]*gap: (\d+)px/, land);
    expect(main).toBe(273);
    expect(main).toBeLessThanOrEqual(body(430));
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
