import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Deck tile fit (owner 2026-10-24): the deck picker's selected tile
 * (HARLEM, "Your deck") rendered as a tall gold frame with a large empty
 * gradient tail under its tagline — "too much white space."
 *
 * Measured cause (Chromium, shipped CSS + real deck data): the tile's own
 * stack is 239.5px, but the gallery is a flex row whose default
 * `align-items: stretch` forces every tile to the tallest sibling's
 * height, and the tallest siblings are tall for text reasons — a locked
 * deck's unlock line ("Finish the route — clear The King of the Block in
 * Story Mode") wraps to 3 lines against the tag's 2-line budget
 * (min-height: 2.6em), and long deck names can wrap to a second line.
 * The surplus pooled at the bottom of the top-anchored column, inside
 * the border — lit gold on the selected tile. Owner state measured
 * 256.8px, a fresh player's gallery 271.7px; Harlem's dead band below
 * its tagline text was 34px (owner) / 49px (fresh) instead of the
 * designed ~15px tag reserve + 10px bottom padding.
 *
 * The fix makes the height closed-form: the row top-aligns
 * (`align-items: flex-start` — a tile is exactly its own stack tall, no
 * sibling can export height into it) and the tag is clamped to the
 * 2 lines its min-height already budgets, so the tag box is exactly
 * 2 lines for every deck. These tests parse the shipped CSS constants
 * and recompute the stack (the seat-fit idiom) so a dead tail can't
 * silently return.
 */
const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const block = css.slice(css.indexOf('.deck-gallery {'), css.indexOf('.db-backdrop'));

const rule = (re: RegExp) => {
  const m = block.match(re);
  if (!m) throw new Error(`rule not found: ${re}`);
  return m[1]!;
};
const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};

const gallery = rule(/\.deck-gallery \{([^}]*)\}/);
const cover = rule(/\.dg-cover \{([^}]*)\}/);
const img = rule(/\.dg-cover img \{([^}]*)\}/);
const name = rule(/\.dg-cover \.dg-name \{([^}]*)\}/);
const tag = rule(/\.dg-cover \.dg-tag \{([^}]*)\}/);
const on = rule(/\.dg-cover\.on \{([^}]*)\}/);

/** Tile geometry parsed from the shipped rules. */
const TILE = {
  width: num(/width: (\d+)px/, cover),
  padTop: num(/padding: (\d+)px \d+px \d+px/, cover),
  padX: num(/padding: \d+px (\d+)px \d+px/, cover),
  padBottom: num(/padding: \d+px \d+px (\d+)px/, cover),
  gap: num(/gap: (\d+)px/, cover),
  imgRatioWH: num(/aspect-ratio: (\d+)\/(\d+)/, img) / num(/aspect-ratio: \d+\/(\d+)/, img),
  nameLine: num(/font-size: (\d+)px/, name) * num(/line-height: ([\d.]+)/, name),
  tagFont: num(/font-size: ([\d.]+)px/, tag),
  tagLine: num(/font-size: ([\d.]+)px/, tag) * num(/line-height: ([\d.]+)/, tag),
  tagMinEm: num(/min-height: ([\d.]+)em/, tag),
  tagClamp: num(/-webkit-line-clamp: (\d+)/, tag),
};
const imgH = (TILE.width - TILE.padX * 2) / TILE.imgRatioWH;
const tagBoxH = TILE.tagMinEm * TILE.tagFont;
/** The full content stack for a tile with a one-line name. */
const stackH = TILE.padTop + imgH + TILE.gap + TILE.nameLine + TILE.gap + tagBoxH + TILE.padBottom;

describe('deck tiles hug their content (no dead tail)', () => {
  it('the gallery cannot stretch a tile to a sibling’s height', () => {
    expect(gallery).toContain('align-items: flex-start');
    // the tile itself declares no fixed height: its height is its stack
    expect(cover).not.toMatch(/(^|;)\s*(min-)?height\s*:/);
  });

  it('the tag box is a closed two-line box — its budget and its ceiling agree', () => {
    // min-height reserves exactly 2 lines…
    expect(tagBoxH).toBeCloseTo(2 * TILE.tagLine, 5);
    // …and the clamp caps it at the same 2 lines, so a long unlock line
    // (King: "Finish the route — clear The King of the Block in Story
    // Mode") can never inflate the tile again.
    expect(TILE.tagClamp * TILE.tagLine).toBeCloseTo(tagBoxH, 5);
    expect(tag).toContain('overflow: hidden');
  });

  it('the tile stack is closed-form and bounded', () => {
    // 8 pad + 162.4 art (116 × 7/5) + 6 + 17.25 name + 6 + 29.9 tag + 10 pad
    expect(imgH).toBeCloseTo(162.4, 5);
    expect(stackH).toBeCloseTo(239.5, 0);
    // Bounded allowance under the text: a one-line tag leaves exactly one
    // reserved line inside its box (uniform by design) plus the declared
    // bottom padding — and nothing else. No term in the stack comes from
    // another tile.
    const tailAllowance = tagBoxH - TILE.tagLine + TILE.padBottom;
    expect(tailAllowance).toBeCloseTo(24.9, 0);
    expect(tailAllowance).toBeLessThan(stackH * 0.11);
  });

  it('selection changes no geometry — the gold reads via border and pill only', () => {
    expect(on).not.toMatch(/(height|width|padding|margin|font-size)\s*:/);
    expect(on).toContain('box-shadow');
    expect(on).toContain('background');
  });

  it('one definition site serves both themes (parity)', () => {
    expect(css.match(/\.deck-gallery \{/g)).toHaveLength(1);
    expect(css.match(/\.dg-cover \{/g)).toHaveLength(1);
    expect(css.match(/\.dg-cover \.dg-tag \{/g)).toHaveLength(1);
  });
});
