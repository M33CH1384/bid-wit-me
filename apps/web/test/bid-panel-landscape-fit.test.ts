/**
 * Bid panel landscape fit — the YOUR BID heading hides on landscape phones
 * (owner, 2026-11-01, from his iPhone at Grandma's in landscape, bidding):
 * "Looks like the your bid label should be hidden in landscape so the bid
 * box doesn't need to scroll."
 *
 * Why: the panel is bottom-anchored just above the resting hand
 * (--hand-clear, see bidPanelFit.ts) and grows UP. Its landscape budget is
 * the space between the scorebug band (~60px, the budget bid-panel-fan-fit
 * already uses) and the hand's top edge minus the 6px clear gap. Measured
 * against the shipped CSS below, the panel WITH its heading is ~124-128px:
 * it already OVERFLOWS the smallest audited size's fallback budget, and the
 * moment a second note row renders (team-min note above the block line) it
 * overflows even 844x390's measured budget — on the owner's phone, with the
 * live hand anchor and real font leading, the number row ran to the box's
 * bottom edge and options hid behind plates. The heading costs ~21px
 * (13px line + 3px flex gap, plus line-height slack); without it the panel
 * is ~105-107px and fits every audited landscape size, both views, every
 * anchor variant — and still fits at the owner's sizes with the extra note
 * row rendered.
 *
 * Portrait keeps the heading — the hide is scoped to .table-screen.short
 * (isShortLandscape: landscape phones only), and the player's plate keeps
 * its own YOUR BID ribbon (a turn indicator, not this heading).
 *
 * Metrics are read from the shipped CSS where a rule states them outright;
 * the strip/note heights are arithmetic on their rules (BidSummary partner
 * cell: 4+5 padding + 10px*1.1 name + 24px*1.05 bid = 45.2px, the tallest
 * cell; .bid-block note: 13px*1.35 = 17.55px). 'normal' line-height is
 * modelled at a conservative 1.4 factor for the display font.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cardScreenQuad, handFan, MIN_STRIP_PX, type FanOpts } from '../src/three/layout';
import { feltCardBox } from '../src/FeltHand';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

/** Rule blocks for a selector, in source order. The short bid-panel rules
 *  layer (480px width, then 620px, then 600px, then a padding/gap-only
 *  compaction): at equal specificity the LAST block that sets a property
 *  wins it, so each field is read from the last block that declares it. */
function blocksFor(selector: string): string[] {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${esc} \\{ ([^}]*)\\}`, 'g'))].map((m) => m[1]);
}
function lastBlock(selector: string, declares?: string): string {
  const blocks = blocksFor(selector).filter((b) => !declares || b.includes(declares));
  if (!blocks.length) throw new Error(`CSS rule not found: ${selector} (${declares ?? ''})`);
  return blocks[blocks.length - 1];
}
function field(block: string, re: RegExp, what: string): number {
  const m = block.match(re);
  if (!m) throw new Error(`CSS value not found: ${what}`);
  return Number(m[1]);
}

// Short-landscape panel metrics, straight from the shipped (cascade-winning) rules.
const PANEL = lastBlock('.table-screen.short .bid-panel', 'padding:');
const PANEL_W = lastBlock('.table-screen.short .bid-panel', 'width:');
const GRID = lastBlock('.table-screen.short .bid-grid', 'gap:');
const GRID_BTN = lastBlock('.table-screen.short .bid-grid button');
const TITLE_RULE = lastBlock('.table-screen.short .panel-title');
const PAD_V = field(PANEL, /padding: (\d+)px \d+px \d+px/, 'panel pad top')
  + field(PANEL, /padding: \d+px \d+px (\d+)px/, 'panel pad bottom');
const GAP = field(PANEL, /gap: (\d+)px/, 'panel gap');
const TITLE_PX = field(TITLE_RULE, /font-size: (\d+)px/, 'short title size');
const GRID_BTN_PX = field(GRID_BTN, /font-size: (\d+)px/, 'grid button size');
const GRID_BTN_PAD = field(GRID_BTN, /padding: (\d+)px 0/, 'grid button pad') * 2;
const PANEL_VW = field(PANEL_W, /width: min\(\d+px, (\d+)vw\)/, 'panel vw');
const PANEL_MAX = field(PANEL_W, /width: min\((\d+)px,/, 'panel max width');
const PANEL_PAD_X = field(PANEL, /padding: \d+px (\d+)px/, 'panel pad x') * 2;
const TRACK_MIN = field(css.match(/bid-grid[^{]*\{[^}]*minmax\((\d+)px, 1fr\)/)?.[0] ?? '', /minmax\((\d+)px/, 'grid track min');
const GRID_GAP = field(GRID, /gap: (\d+)px/, 'grid gap');

const LH = 1.4; // conservative 'normal' line-height for the display font
const SUMMARY_H = 4 + 5 + 10 * 1.1 + 24 * 1.05; // 45.2 — partner cell, tallest in the strip
const NOTE_H = 13 * 1.35; // 17.55 — one-line .bid-block

/** Panel height for the owner's state: strip + one note line + number row. */
function panelHeight(withTitle: boolean): number {
  const items = [SUMMARY_H, NOTE_H, GRID_BTN_PX * LH + GRID_BTN_PAD];
  if (withTitle) items.unshift(TITLE_PX * LH);
  return PAD_V + items.reduce((a, b) => a + b, 0) + GAP * (items.length - 1);
}

function fanTop(W: number, H: number, view: 'standing' | 'sitting'): number {
  const aspect = W / H;
  const opts: FanOpts = {
    short: true, view,
    reserveFrac: 186 / W,
    bottomFrac: view === 'sitting' ? 12 / H : 0,
    heightFrac: 0.32, pxW: W, minStripPx: MIN_STRIP_PX,
  };
  let top = Infinity;
  for (let i = 0; i < 13; i++) {
    const t = handFan(aspect, 13, i, 0, 0, opts, 0, H);
    top = Math.min(top, ...cardScreenQuad(aspect, t, W, H, 0, true, view).map((p) => p.y));
  }
  return top;
}

const BAND = 60; // scorebug band — the same budget bid-panel-fan-fit.test.ts uses
const SIZES: [number, number][] = [[932, 430], [844, 390], [915, 412], [740, 360]];
const VIEWS = ['standing', 'sitting'] as const;

describe('the YOUR BID heading hides in landscape only', () => {
  it('the bid panel title carries the distinguishing class; sibling panel titles do not', () => {
    expect(table).toContain('<div className="panel-title bid-title">YOUR BID</div>');
    expect(table).toContain('<div className="panel-title">BLIND NIL?</div>');
    expect(table).not.toContain('panel-title bid-title">BLIND NIL?');
    expect(table).not.toContain('panel-title bid-title">PASS');
  });

  it('exactly one hide rule exists for it, scoped to short landscape', () => {
    expect(css).toContain('.table-screen.short .bid-panel .bid-title { display: none; }');
    expect(css.match(/\.bid-title/g)).toHaveLength(1);
  });

  it('portrait has no bid-title rule at all (heading renders exactly as before)', () => {
    expect(css).not.toMatch(/\.table-screen:not\(\.short\)[^{]*\.bid-title/);
  });
});

describe('with the heading hidden, the whole bid box fits in landscape', () => {
  for (const [W, H] of SIZES) {
    for (const view of VIEWS) {
      it(`${W}x${H} ${view}: fits under the measured 3D-hand anchor`, () => {
        const budget = fanTop(W, H, view) - 6 - BAND;
        expect(panelHeight(false), `panel ${panelHeight(false).toFixed(1)}px vs budget ${budget.toFixed(1)}px`).toBeLessThanOrEqual(budget);
      });
    }
    it(`${W}x${H}: fits under the flat-fan anchor`, () => {
      const feltTop = H - 12 - (feltCardBox(13, W, H).height + 36);
      const budget = feltTop - 6 - BAND;
      expect(panelHeight(false), `panel ${panelHeight(false).toFixed(1)}px vs budget ${budget.toFixed(1)}px`).toBeLessThanOrEqual(budget);
    });
    it(`${W}x${H}: fits under the unmeasured 50vh fallback anchor`, () => {
      const budget = H * 0.5 - BAND;
      expect(panelHeight(false), `panel ${panelHeight(false).toFixed(1)}px vs budget ${budget.toFixed(1)}px`).toBeLessThanOrEqual(budget);
    });
  }

  it('the number grid stays one row at the named sizes, worst case (13 numbers + NIL)', () => {
    for (const W of [932, 844]) {
      const inner = Math.min(PANEL_MAX, (PANEL_VW / 100) * W) - PANEL_PAD_X;
      const tracks = Math.floor((inner + GRID_GAP) / (TRACK_MIN + GRID_GAP));
      expect(tracks, `${W}px wide: ${tracks} tracks`).toBeGreaterThanOrEqual(15); // 13 numbers + NIL spanning 2
    }
  });
});

// A second note row (.team-min-note above the block line) is a real bidding
// state: 12px at the modelled line-height + its 4px margin + one more gap.
const TEAM_NOTE_EXTRA = 12 * LH + 4 + GAP;

describe('with the heading hidden, the panel still fits when both note rows render', () => {
  for (const [W, H] of [[932, 430], [844, 390]] as const) {
    for (const view of VIEWS) {
      it(`${W}x${H} ${view}: fits with the team-min note too`, () => {
        const budget = fanTop(W, H, view) - 6 - BAND;
        expect(panelHeight(false) + TEAM_NOTE_EXTRA, `panel+note ${(panelHeight(false) + TEAM_NOTE_EXTRA).toFixed(1)}px vs budget ${budget.toFixed(1)}px`).toBeLessThanOrEqual(budget);
      });
    }
  }
});

describe('the defect this fixes, pinned', () => {
  it('WITH the heading, the panel overflowed the 740x360 fallback budget', () => {
    expect(panelHeight(true)).toBeGreaterThan(360 * 0.5 - BAND);
  });
  it('WITH the heading and both note rows, the panel overflowed 844x390 sitting', () => {
    const budget = fanTop(844, 390, 'sitting') - 6 - BAND;
    expect(panelHeight(true) + TEAM_NOTE_EXTRA).toBeGreaterThan(budget);
  });
});
