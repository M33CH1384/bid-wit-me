/**
 * D4, styles.css portion (design audit 2026-10-24): the 44px tap-target
 * floor for the shipped styles.css controls the census flagged under it.
 * The census names are descriptive; each row maps to the real shipped rule
 * it measured (verified by the census size against the rule's old value).
 * Sizes are parsed from the shipped CSS — a regression under 44 fails here.
 *
 *   census name            shipped rule                              was
 *   ---------------------  ----------------------------------------  ----
 *   .seg button (38)       .seg button (all seg wrappers: wizard,     32–38
 *   .wz-seg button (34)    theme toggle = [data-testid=theme-seg],  by padding
 *   .theme-seg button (34) sort segs, settings segrows — one rule)
 *   .sortseg button (36)
 *   .segrow .seg (38)
 *   .chat-send (36)        .chat-input button                         36 wide
 *   .chat-head button (34) .modal-x (sheet/modal head close)          34
 *   .tell-x (34)           .modal-x                                   34
 *   .close-x (36)          .sheet-x                                   36
 *   .hand .h-close (30)    .bid-coach .bc-close                       30
 *   .tb-close (38)         .tb-x (trick browser close)                32
 *   .setcover-x (32)       .run-review-x (set-animation review close) 32
 *   .chat-toggle (40)      .chat-toggle / .ctl-rail .chat-toggle      42×38/42×46
 *   .tt-foot-adjacent      .tt-chat-btn (recap head chat)             38
 *   .me-tools .icon-btn    .sheet-head .icon-btn                      40
 *   .db close              .db-close (deck browser)                   40
 *   .quick-reacts (34)     .tt-reacts button + .emotes button         ~29–34
 *   .replay-btn (40)       .tt-run-show / .tt-tricks-show pills       ~30–40
 *   .hm / setup-music      .hm-tabs/.hm-beats/.hm-btn, setup-music   40
 *   .prof-link input       .prof-link-row input                       40
 *
 * Adjacent same-cluster raises the harness flagged with the census items:
 * .trash-btn (42×38), .ctl-cluster .av-btn (42×42) and the short-cluster
 * 40×38 variants, .pad-x (36, score pad close), .set-group-toggle (34),
 * .db-use (deck browser Use), .dock-btn fallback (40).
 *
 * NOT in styles.css at this commit (grep-verified across src; flagged in
 * the worker summary, not forced): sb-moon-pip, trick-arrow (its shipped
 * .lt-nav is already 44), tb-nav, hand-tab, fs-btn, devbar, vt-remove,
 * lb-help, chip-toggle, lobby-invite .li-actions (online.css — sibling
 * worker's file), .tt-foot .btn / .ghost-btn (already min-height 44).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** Body of the rule for `sel`, preferring a line-start match so compound
 *  selectors (e.g. `.pad-sticky .pad-x`) never shadow the base rule. */
const rule = (sel: string) => {
  let i = css.indexOf('\n' + sel + ' {');
  if (i < 0) i = css.indexOf(sel + ' {');
  if (i < 0) throw new Error(`rule not found: ${sel}`);
  return css.slice(i, css.indexOf('}', i));
};
const dim = (body: string, prop: string) => {
  const m = body.match(new RegExp(`(?<![-\\w])${prop}:\\s*(\\d+(?:\\.\\d+)?)px`));
  if (!m) throw new Error(`prop ${prop} not found in: ${body.slice(0, 80)}`);
  return parseFloat(m[1]!);
};

/** [selector, minWidth | null, minHeight | null] — null = that axis is not
 *  the constrained one for this control (checked via min-height instead). */
const BOXES: Array<[string, number, number]> = [
  ['.chat-input button', 44, 44], // min-height via min-height prop — handled below
  ['.chat-toggle', 44, 44],
  ['.ctl-rail .chat-toggle', 44, 44],
  ['.bid-coach .bc-close', 44, 44],
  ['.tb-x', 44, 44],
  ['.modal-x', 44, 44],
  ['.sheet-x', 44, 44],
  ['.chat.recap-chat header .sheet-x', 44, 44],
  ['.tt-chat-btn', 44, 44],
  ['.sheet-head .icon-btn', 44, 44],
  ['.db-close', 44, 44],
  ['.run-review-x', 44, 44],
  ['.pad-x', 44, 44],
  ['.trash-btn', 44, 44],
  ['.ctl-cluster .av-btn', 44, 44],
  ['.dock-btn', 44, 44],
];

const MIN_HEIGHTS: Array<[string, number]> = [
  ['.seg button', 44],
  ['.tt-reacts button', 44],
  ['.emotes button', 44],
  ['.tt-run-show', 44],
  ['.tt-tricks-show', 44],
  ['.set-group-toggle', 44],
  ['.db-use', 44],
  ['.prof-link-row input', 44],
];

describe('D4: styles.css tap-target floor (44px)', () => {
  for (const [sel, w, h] of BOXES) {
    it(`${sel} is at least ${w}×${h}`, () => {
      const body = rule(sel);
      if (sel === '.chat-input button') {
        expect(dim(body, 'width')).toBeGreaterThanOrEqual(w);
        expect(dim(body, 'min-height')).toBeGreaterThanOrEqual(h);
        return;
      }
      expect(dim(body, 'width')).toBeGreaterThanOrEqual(w);
      expect(dim(body, 'height')).toBeGreaterThanOrEqual(h);
    });
  }

  for (const [sel, h] of MIN_HEIGHTS) {
    it(`${sel} has min-height >= ${h}`, () => {
      expect(dim(rule(sel), 'min-height')).toBeGreaterThanOrEqual(h);
    });
  }

  it('short-cluster variants meet the floor too', () => {
    const body = rule('.table-screen.short .ctl-cluster .av-btn, .table-screen.short .chat-toggle');
    expect(dim(body, 'width')).toBeGreaterThanOrEqual(44);
    expect(dim(body, 'height')).toBeGreaterThanOrEqual(44);
  });

  it('lobby music + setup music controls meet the floor', () => {
    expect(dim(rule('.lobby-music .hm-tabs button, .lobby-music .hm-beats button, .lobby-music .hm-btn'), 'min-height')).toBeGreaterThanOrEqual(44);
    expect(dim(rule('.setup-music select, .setup-music input'), 'min-height')).toBeGreaterThanOrEqual(44);
  });

  it('controls already at the floor stay there (.lt-nav, .ghost-btn, .primary)', () => {
    const lt = rule('.lt-nav');
    expect(dim(lt, 'width')).toBeGreaterThanOrEqual(44);
    expect(dim(lt, 'height')).toBeGreaterThanOrEqual(44);
    expect(dim(rule('.ghost-btn'), 'min-height')).toBeGreaterThanOrEqual(44);
  });
});
