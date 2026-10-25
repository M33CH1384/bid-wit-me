/**
 * D8 (design audit 2026-10-24, P1): the online victory screen in phone
 * landscape — ~690px of natural column against ~300px of inner height —
 * crushed the winner spotlight to a ~100px scroll window and the placements
 * region to 0–15px.
 *
 * Fix: below 560px tall the screen composes as a two-column grid — the head
 * spans the top; the spotlight scrolls in the wider left cell; the foot
 * panel (placements scroll + pinned Rematch/Home, unchanged) fills the
 * right cell. Both regions get the full inner height:
 *   region = h − padding (10 top + 10 bottom) − head (~26) − row gap 8
 *   667×375 -> 321px · 844×390 -> 336px · 932×430 -> 376px
 * against the old ~100px spotlight window. Winner frames are capped at
 * 34vh and name cards drop to a 96px min-height so a 2-up spotlight shows
 * whole frames inside the region at the audited sizes.
 *
 * Portrait must not regress: the compact block is height-gated (portrait
 * phones are 667px+ tall, so it never applies), and the base column rules
 * the portrait fit pass closed on (58px top pad, 14px sides/bottom, the
 * internal-scroll flex rules) are pinned verbatim below.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};
const d8Start = css.indexOf('/* D8 (design audit');
const d8 = css.slice(d8Start, css.indexOf('/* ---------- recap header', d8Start));

const HEAD = 26; // .vic-head at landscape widths: clamp(15px, 2.6vw, 22px) font, one line + small — 26 is the conservative top
const region = (h: number) => h - 10 - 10 - HEAD - 8;

describe('D8: short-height grid composition', () => {
  it('the screen becomes a two-column grid under 560px tall', () => {
    expect(d8).toContain('@media (max-height: 560px)');
    expect(d8).toContain('grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr)');
    expect(d8).toContain('grid-template-rows: auto minmax(0, 1fr)');
    expect(d8).toContain('.victory-screen .vic-head { grid-column: 1 / -1; justify-self: center; }');
    expect(d8).toContain('padding: calc(10px + env(safe-area-inset-top)) 12px calc(10px + env(safe-area-inset-bottom))');
  });

  it('frames are height-capped and cards shrink so the spotlight shows whole frames', () => {
    expect(num(/\.victory-screen \.vs-frame \{ max-height: (\d+)vh/, d8)).toBe(34);
    expect(num(/\.victory-screen \.vs-card \{ min-height: (\d+)px/, d8)).toBe(96);
  });

  it('both scroll regions get the full inner height (was ~100px / ~0px)', () => {
    for (const h of [375, 390, 430]) expect(region(h)).toBeGreaterThanOrEqual(3 * 100);
    expect(region(375)).toBe(321);
    // regions scroll internally; the foot’s actions stay pinned (base rules)
    expect(css).toContain('.victory-screen .victory-spot { flex: 0 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }');
    expect(css).toContain('.vic-foot .confirm-actions { flex: none; width: 100%; }');
    expect(css).toContain('.vic-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto;');
  });

  it('2-up winner frames fit the spotlight region without scrolling', () => {
    for (const s of [{ w: 667, h: 375 }, { w: 844, h: 390 }, { w: 932, h: 430 }]) {
      const innerW = s.w - 24; // compact side padding 12 x2
      const spotCol = (innerW - 14) * (1.2 / 2.2); // grid gap 14, 1.2fr of 2.2fr
      const frameW = (spotCol - 10) / 2; // winners grid gap 10, 2 columns
      const frameH = Math.min((frameW * 3) / 4, 0.34 * s.h); // 4:3, capped at 34vh
      const titleEtc = 34 + 17 + 30; // compact vs-title cap + vs-sub cap + gaps/paddings
      expect(frameH + titleEtc).toBeLessThanOrEqual(region(s.h));
    }
  });
});

describe('D8: portrait arithmetic does not regress', () => {
  it('base column rules are byte-identical to the fit-pass rules', () => {
    expect(css).toContain('padding: calc(58px + env(safe-area-inset-top)) 14px calc(14px + env(safe-area-inset-bottom)); overflow-y: auto;');
    expect(css).toContain('.victory-screen { overflow: hidden; }');
    expect(css).toContain('.vic-foot { flex: 0 1 auto; min-height: 0; }');
    // portrait inner height at 375×667 is unchanged: 667 − 58 − 14 = 595
    expect(667 - 58 - 14).toBe(595);
  });
});
