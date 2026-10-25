/**
 * D3 (design audit 2026-10-24, P1): the fixed commit bar (.setup-bar) sliced
 * the deck slider + summary on the wizard table step, and the deck-browser
 * sheet's bottom rows slid UNDER the bar.
 *
 * Two mechanisms:
 *  (a) Sheet case — the browser's backdrop (.db-backdrop, position:fixed)
 *      renders inside .setup-card, whose clip-path both confines a fixed
 *      descendant to the card box and clips it (the screenshot: browser head
 *      sliced off at the card edge, rows visible only inside the card, the
 *      bar painting over them). While the browser is open the card/sheet
 *      stands its clip down, the backdrop covers the viewport at z-30 (above
 *      the bar's z-15), and the bar itself is hidden while any modal is open,
 *      so a sheet's end-of-scroll is fully reachable.
 *  (b) Page case — the bar shrinks (top padding 26 -> 12) and its gradient
 *      goes opaque from the top edge (the summary line used to print over
 *      the deck tiles through the transparent fade). The page's bottom
 *      reserve (.ess-barred) must clear the bar by >= 16px, with and
 *      without the ticker (whose rules live in social.css).
 *
 * Bar height budget (worst case, vs-bots: summary + sticky-note shown):
 *   padding-top 12 + summary 16 (13px font x ~1.25) + margin 8
 *   + .go 52 (padding 14x2 + 20px font x 1.2) + sticky-note 24 (margin 6 +
 *   13px x ~1.35) + padding-bottom 10 = 122px (+ safe-area-inset-bottom,
 *   which the reserve also carries, so it cancels).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');
const social = read('../src/social/social.css');

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};
const rule = (sel: string, s = css) => {
  const i = s.indexOf(sel + ' {');
  if (i < 0) throw new Error(`rule not found: ${sel}`);
  return s.slice(i, s.indexOf('}', i));
};

const BAR = {
  padTop: num(/\.setup-bar \{[^}]*padding: (\d+)px 18px/, css),
  summary: num(/\.setup-bar-summary \{[^}]*font-size: (\d+)px/, css) * 1.25,
  summaryMargin: num(/\.setup-bar-summary \{[^}]*margin: 0 0 (\d+)px/, css),
  go: num(/\.big \{ width: 100%; padding: (\d+)px;/, css) * 2 + num(/\.big \{ width: 100%; padding: \d+px; font-size: (\d+)px/, css) * 1.2,
  note: num(/\.setup-bar \.sticky-note \{ margin: (\d+)px/, css) + num(/\.sticky-note \{[^}]*font-size:\s*(\d+)px/, css) * 1.35,
  padBottom: num(/\.setup-bar \{[^}]*padding: \d+px 18px calc\((\d+)px/, css),
};
const barHeight = BAR.padTop + BAR.summary + BAR.summaryMargin + BAR.go + BAR.note + BAR.padBottom;
const reserve = num(/\.ess-barred \{ padding-bottom: calc\((\d+)px/, css);
const tickerReserve = num(/\.ess-barred \{ padding-bottom: calc\((\d+)px/, social);
const tickerLift = num(/\.setup-bar \{ bottom: calc\((\d+)px/, social);

describe('D3 (b): the wizard page reserve clears the shrunken bar by >= 16px', () => {
  it('bar budget closes from the shipped constants', () => {
    expect(BAR.padTop).toBe(12);
    expect(barHeight).toBeLessThanOrEqual(122);
    expect(reserve - barHeight).toBeGreaterThanOrEqual(16);
  });

  it('ticker-on arithmetic keeps the same 16px (social.css constants)', () => {
    expect(tickerReserve - (barHeight + tickerLift)).toBeGreaterThanOrEqual(16);
  });

  it('the bar is opaque from its top edge — no text prints over tiles', () => {
    const bar = rule('.setup-bar');
    expect(bar).toContain('linear-gradient(180deg, rgba(12,7,18,.94), rgba(12,7,18,.98) 42%)');
    expect(bar).not.toContain('transparent');
    // still the fixed commit bar the scroll-safety pins rely on
    expect(css).toContain('.setup-bar { position: fixed;');
  });
});

describe('D3 (a): a sheet’s end-of-scroll clears the bar', () => {
  it('the hosting card/sheet stands its clip down while the browser is open', () => {
    expect(css).toContain('.setup-card:has(.db-backdrop), .sheet:has(.db-backdrop) { clip-path: none; }');
  });

  it('the bar hides while any modal sheet is open', () => {
    expect(css).toContain('body:has(.modal-backdrop) .setup-bar { visibility: hidden; }');
  });

  it('the browser backdrop out-ranks the bar (z 30 over z 15)', () => {
    const backdropZ = num(/\.db-backdrop \{ z-index: (\d+); \}/, css);
    const barZ = num(/\.setup-bar \{[^}]*z-index: (\d+);/, css);
    expect(backdropZ).toBeGreaterThan(barZ);
  });

  it('the browser’s Use button meets the 44px floor', () => {
    expect(rule('.db-use')).toContain('min-height: 44px');
  });
});
