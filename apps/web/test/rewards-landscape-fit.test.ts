/**
 * REWARDS SCREEN, LANDSCAPE FIT (owner, 2026-10-28, sharpening the
 * morning report): "The landscape view made it so that you have to
 * scroll to see it but once you do it's already happened."
 *
 * The defect's placement half: on /rewards the card ran ~755px tall in
 * a 390-430px landscape viewport. The confetti was already
 * viewport-anchored (probe-verified), but the reward ROWS — the
 * count-up show — started below the fold with the Postgame Report
 * ahead of them, and the actions below that. cb104b94's in-view gate
 * kept the rows' show unspent below the fold, but the scroll that
 * reveals them spends it mid-scroll: the page is still moving while
 * the count-ups run, and by the time it settles the show is over.
 *
 * The fix these tests pin: in short landscape (the same
 * height+width gate family as the recap sheet's short-landscape block
 * and the D8 victory grid) the card composes as THREE COLUMNS —
 * headline + Postgame Report left, reward rows center, actions on a
 * right rail — and FITS the viewport, ticker clearance included, so
 * the rows sit in the initial viewport and their gate opens at
 * presentation. Portrait and tall screens keep the single column.
 * The geometry itself is probe-verified at 844×390 and 932×430
 * (card fully in view, no scrolling element, rows gate open at load);
 * these pins hold the composition so it cannot silently regress.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const blockStart = css.indexOf('@media (max-height: 560px) and (min-width: 560px)');
const rwBlock = blockStart === -1 ? '' : css.slice(blockStart, css.indexOf('\n}\n', blockStart));

describe('rewards screen: LANDSCAPE FIT — the celebration starts in the initial viewport', () => {
  it('the short-landscape block exists and turns the card into a three-column grid', () => {
    expect(blockStart).toBeGreaterThan(-1);
    expect(rwBlock).toContain('.rw-card');
    expect(rwBlock).toContain('display: grid');
    expect(rwBlock).toContain('grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr) minmax(150px, .55fr)');
    // rows start in the FIRST grid row (top of the middle column = in
    // the initial viewport); the actions ride a full-height right rail
    expect(rwBlock).toContain('grid-template-areas: "head rows actions" "report rows actions"');
  });

  it('every card child has its grid area (head, report, rows, actions)', () => {
    expect(rwBlock).toMatch(/\.rw-head \{ grid-area: head; \}/);
    expect(rwBlock).toMatch(/\.rw-postgame \{ grid-area: report; margin: 0; \}/);
    expect(rwBlock).toMatch(/\.rw-rows \{ grid-area: rows; \}/);
    expect(rwBlock).toMatch(/\.rw-actions \{ grid-area: actions; margin-top: 0;/);
  });

  it('the ticker clearance is budgeted: report table and headline trim down in landscape', () => {
    // On device the league ticker's clearance rule takes 58px of bottom
    // padding on this page, so the fit is budgeted against it (390 −
    // 6 top pad − 58 ticker − card padding 26 = ~300px of inner height;
    // the tallest column, head ~89 + gap 8 + report ~175 = ~272, fits).
    expect(rwBlock).toMatch(/\.rw-postgame \.cmp-table th, \.rw-postgame \.cmp-table td \{ padding-top: 4px; padding-bottom: 4px; \}/);
    expect(rwBlock).toMatch(/\.rw-trophy \{ font-size: 30px; \}/);
    expect(rwBlock).toMatch(/\.rw-actions \.primary\.big \{ min-height: 44px; \}/);
    expect(rwBlock).toMatch(/\.rw-actions \.rw-rematch-btn \{ min-height: 44px; \}/);
    expect(rwBlock).toMatch(/\.rw-row \{ padding: 8px 10px; \}/);
    const inner = 390 - 6 - 58 - 26;
    expect(inner).toBeGreaterThanOrEqual(89 + 8 + 175);
  });

  it('portrait is untouched: the base card stays a single flex column and the grid is landscape-only', () => {
    expect(css).toMatch(/\.rw-card \{ width: min\(100%, 480px\);[^}]*display: flex; flex-direction: column;/);
    const gridAt = css.indexOf('grid-template-areas: "head rows actions"');
    expect(gridAt).toBeGreaterThan(blockStart); // the grid lives inside the gated block only
  });
});
