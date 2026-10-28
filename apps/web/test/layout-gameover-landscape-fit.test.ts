import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

/** Game-over sheet in LANDSCAPE (owner, 2026-10-28: "I can't see the other
 *  teams score unless I scroll" — the story outro at phone landscape showed
 *  only the #1 standings row). Mechanism this pins shut:
 *  .modal.gameover is a flex column inside a backdrop box that is only
 *  320px tall at 844×390 (h − 54 top pad − 16 bottom pad). Its ONLY
 *  flexible child was the .scroll region, and the standings lived INSIDE
 *  it (placements + box score): the fixed hero + stacked actions (~327px)
 *  left the region ~0–33px, so standings row #2 fell below the fold of an
 *  inner scroll. The fix: (1) the standings render as FIXED sheet content
 *  above the scroll region in the JSX — only the box score scrolls; (2) a
 *  height-gated tier (max-height 560px) recomposes the sheet as the D8
 *  two-column grid: hero band across the top, standings left / box-score
 *  scroll right, actions as one pinned row across the bottom.
 *  Portrait (667px+) never enters the tier and the base rules are
 *  untouched. The geometry capture lives in gameover-fit.e2e.ts. */

const num = (re: RegExp, src = css): number => {
  const m = src.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return Number(m[1]);
};

/** The offline game-over sheet's DOM block in Table.tsx. */
const offlineBlock = (() => {
  const start = table.indexOf('{showResults && st.result && !online?.victory');
  if (start < 0) throw new Error('offline game-over block not found');
  return table.slice(start, table.indexOf('<AnimFxLayer', start));
})();

describe('game-over sheet — standings are fixed content, never scroll content', () => {
  it('renders the standings ABOVE the scroll region; only the box score scrolls', () => {
    const placements = offlineBlock.indexOf('<ol className="placements">');
    const scroll = offlineBlock.indexOf('data-testid="gameover-scroll"');
    const boxScore = offlineBlock.indexOf('<BoxScore');
    expect(placements).toBeGreaterThan(-1);
    expect(scroll).toBeGreaterThan(-1);
    // THE regression: on the old build placements sat inside .go-scroll,
    // after the gameover-scroll marker — this ordering fails there.
    expect(placements).toBeLessThan(scroll);
    expect(boxScore).toBeGreaterThan(scroll);
  });

  it('the online victory screen keeps its own composition (sibling untouched)', () => {
    const vic = table.slice(table.indexOf('{showResults && online?.victory'), table.indexOf('{showResults && st.result && !online?.victory'));
    // placements.compact stays inside the D8-governed .vic-scroll region,
    // which gets the full inner height in landscape (layout-victory-fit).
    expect(vic.indexOf('placements compact')).toBeGreaterThan(vic.indexOf('vic-scroll'));
  });
});

describe('game-over sheet — landscape tier (max-height: 560px)', () => {
  const tierAt = css.indexOf('@media (max-height: 560px)', css.indexOf('Game-over sheet in LANDSCAPE'));
  const tier = tierAt < 0 ? '' : css.slice(tierAt, css.indexOf('/* ---------- recap header', tierAt));
  // tier-derived constants fail soft (NaN) so a missing tier fails each
  // budget assertion individually instead of aborting collection.
  const numT = (re: RegExp): number => { const m = tier.match(re); return m ? Number(m[1]) : NaN; };

  it('exists, is height-gated, and lays the sheet out as the D8 grid', () => {
    expect(tierAt).toBeGreaterThan(-1);
    expect(tier).toContain('.modal.gameover { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); grid-template-rows: auto auto auto auto auto minmax(0, 1fr) auto;');
    expect(tier).toContain('.modal.gameover .placements { grid-column: 1; grid-row: 6;');
    expect(tier).toContain('.modal.gameover .go-scroll { grid-column: 2; grid-row: 6; }');
    expect(tier).toContain('.modal.gameover .confirm-actions { grid-column: 1 / -1; grid-row: 7; flex-direction: row;');
    expect(tier).toContain('.modal.gameover .confirm-actions .exit-divider { display: none; }');
  });

  // ---- budget model: constants parsed from the shipped rules ----
  const topPad = num(/\.modal-backdrop \{[^}]*?calc\((\d+)px \+ env\(safe-area-inset-top\)\)/); // 54
  const bottomPad = num(/\.modal-backdrop \{ position: fixed;[^}]*?padding: (\d+)px;/); // 16 — the shorthand pad (top is overridden to 54 above it)
  const maxH = num(/\.modal \{[^}]*?max-height: (\d+)dvh/) / 100; // 0.88
  const padV = numT(/\.modal\.gameover \{ display: grid;[^}]*?padding: (\d+)px/); // 12
  const rowGap = numT(/\.modal\.gameover \{ display: grid;[^}]*?gap: (\d+)px/); // 6
  const trophy = numT(/\.modal\.gameover \.trophy \{[^}]*?font-size: (\d+)px/) * num(/\.gameover \.trophy \{ font-size: 40px; line-height: ([\d.]+)/); // 24 × 1.05
  const h2 = numT(/\.modal\.gameover h2 \{[^}]*?font-size: (\d+)px/) * 1.2; // 21px, normal lh modeled 1.2
  const banner = numT(/\.modal\.gameover \.shot-out-banner \{[^}]*?font-size: (\d+)px/); // 22, lh 1 per the font shorthand
  const reason = numT(/\.modal\.gameover \[data-testid="end-reason"\] \{[^}]*?font-size: (\d+)px/) * numT(/\.modal\.gameover \[data-testid="end-reason"\] \{[^}]*?line-height: ([\d.]+)/); // 13 × 1.3
  const actions = num(/\.primary\.big \{[^}]*?min-height: (\d+)px/); // 52 — the tallest control in the row
  const liRow = numT(/\.modal\.gameover \.placements li \{ padding: (\d+)px/) * 2
    + numT(/\.modal\.gameover \.placements li \{[^}]*?font-size: (\d+)px/) * 1.25; // 8 + 14 × 1.25
  const liGap = numT(/\.modal\.gameover \.placements \{[^}]*?gap: (\d+)px/); // 5

  const box = (h: number) => Math.min(h - topPad - bottomPad, Math.floor(h * maxH));
  const hero = trophy + h2 + banner + reason;
  const middle = (h: number, series = 0) => box(h) - padV * 2 - (hero + series) - rowGap * 6 - actions;
  const standings = (rows: number) => rows * liRow + (rows - 1) * liGap;

  it('the two-team standings fit the middle row at both phone landscape heights', () => {
    for (const h of [390, 430]) {
      expect(middle(h), `middle row at h=${h}`).toBeGreaterThanOrEqual(standings(2));
    }
  });

  it('even cutthroat’s four standings rows fit at both heights', () => {
    for (const h of [390, 430]) {
      expect(middle(h), `middle row at h=${h}`).toBeGreaterThanOrEqual(standings(4));
    }
  });

  it('a series chip (21px hero guest) still leaves room for the two-team standings', () => {
    const chip = num(/\.series-chip \{[^}]*?font: 800 (\d+)px/) * 1.2 + 6; // 11px/1.2 text + 2×2 padding + 2×1 border ≈ 19
    for (const h of [390, 430]) expect(middle(h, chip)).toBeGreaterThanOrEqual(standings(2));
  });
});

describe('game-over sheet — portrait non-regression', () => {
  it('keeps the base sheet contract byte-present (the tier is additive only)', () => {
    expect(css).toContain('.modal { width: min(580px, 100%); max-height: 88dvh;');
    expect(css).toContain('.sheet > .sheet-body, .sheet > .scroll, .modal > .scroll { flex: 1 1 auto; min-height: 0; overflow: auto;');
    expect(css).toContain('.gameover .go-scroll { display: flex; flex-direction: column;');
    expect(css).toContain('.gameover .trophy { font-size: 40px; line-height: 1.05; }');
    expect(css).toContain('.espn .shot-out-banner { font-size: clamp(24px, 6vw, 42px);');
    expect(css).toContain('.modal.gameover .confirm-actions { flex: none; }');
    expect(css).toContain('.modal.gameover { gap: 8px; }');
  });

  it('the tier is gated on height only — no width query can pull it into portrait', () => {
    const comment = css.indexOf('Game-over sheet in LANDSCAPE');
    const mediaAt = css.indexOf('@media', comment);
    const gate = css.slice(mediaAt, css.indexOf('{', mediaAt));
    expect(gate).toContain('@media (max-height: 560px)');
    expect(gate).not.toContain('max-width');
    expect(gate).not.toContain('orientation');
  });
});
