/**
 * W3 Findings F + H (responsive audit 2026-11-05): gate consolidation.
 *
 * F — the canonical expanded-layout gate G was
 *   (landscape, max-height:540px) OR (landscape, min-width:1000px)
 * repeated verbatim across styles.css, plus tall-leg-only companion blocks
 * (min-height:541px + min-width:1000px). Landscape windows 541+ tall and
 * 900–999 wide (e.g. 960x600) fell in a dead zone: single 560px column,
 * no tab rail, no expanded setup grid. The tall leg is consolidated on
 * w>=900 — the tier the app already trusts for two-column content (the
 * PR-E rail at min-width:900px). These pins hold EVERY inventoried site
 * to the one canonical query so the surfaces cannot drift apart again,
 * and hold the deliberate non-members out (viewport.ts and online.css
 * are other systems, untouched by this lane).
 *
 * H — portrait tablets (768x1024, 820x1180) got no venue preview at all:
 * .setup-preview was display:none except in the land-tab block. The fix
 * is CSS-only: the existing element becomes a compact horizontal strip
 * (capped 150–180px tall) on the portrait-tablet tier
 * (orientation:portrait + min-width:700px — a content tier, no device
 * names). Phone portrait (<700px) stays preview-free, so the venue
 * backdrop still never downloads there.
 *
 * REBASE RECONCILIATION (2026-11-06, onto master 20fe97b3): master grew
 * two sites this file's original text did not know, both from cd5cab7f
 * (online-create venue preview, the lane that closed gap G5):
 *  1. a SECOND portrait-tablet block (the card-scoped online strip) now
 *     precedes the bots strip block, so the H pins select their block by
 *     its host marker (.ess-barred > .setup-preview) instead of by
 *     first occurrence. Every H assertion is unchanged.
 *  2. ONE landscape query still keys on 1000px: cd5cab7f's online
 *     preview TALL SIZE TIER (height:240px at min-height:541px +
 *     min-width:1000px). It is a preview size, not a layout gate — at
 *     900–999px the online form already takes the expanded layout via
 *     G; only the preview's height steps later. The F pin therefore
 *     inventories that single named exception instead of asserting a
 *     blanket absence that was only true on the audit base. Whether
 *     the tier should follow G to 900px is a behaviour call for the
 *     owner, flagged in the rebase report — not taken here.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');

const G = '@media (orientation: landscape) and (max-height: 540px), (orientation: landscape) and (min-width: 900px)';
const TALL = '@media (orientation: landscape) and (min-height: 541px) and (min-width: 900px)';

const count = (needle: string) => css.split(needle).length - 1;

/** The block starting at the first occurrence of `media` (to its closing column-0 brace). */
const block = (media: string) => {
  const i = css.indexOf(media);
  if (i < 0) throw new Error(`media block not found: ${media}`);
  return css.slice(i, css.indexOf('\n}', i));
};

/** The block starting at the occurrence of `media` whose body contains `marker`. */
const blockWith = (media: string, marker: string) => {
  let i = css.indexOf(media);
  while (i >= 0) {
    const b = css.slice(i, css.indexOf('\n}', i));
    if (b.includes(marker)) return b;
    i = css.indexOf(media, i + 1);
  }
  throw new Error(`no ${media} block containing ${marker}`);
};

describe('F: the canonical gate G is one query at every inventoried site', () => {
  it('no landscape gate anywhere in styles.css still keys on 1000px', () => {
    expect(css).not.toContain('(orientation: landscape) and (min-width: 1000px)');
    // The single inventoried exception (see header): cd5cab7f's online
    // preview tall size tier — a preview height, not a layout gate.
    expect(count('(min-width: 1000px)')).toBe(1);
    expect(block('@media (orientation: landscape) and (min-height: 541px) and (min-width: 1000px)')).toContain('.setup-card .setup-preview { height: 240px; }');
  });
  it('the union gate G appears at its four canonical sites (wizard header, decision cards, score pad, settings rail)', () => {
    expect(count(G)).toBe(4);
  });
  it('the tall-leg companion form appears at its five sites (wiz-bar, home, decision-card cap, setup grid, preview grid)', () => {
    expect(count(TALL)).toBe(5);
  });
  it('the short leg is untouched (land-phone still max-height:540px)', () => {
    expect(css).toContain('@media (orientation: landscape) and (max-height: 540px) {');
  });
  it('the setup preview joins the tall tier at 900 (geometry-verified at 960x600; no conscious split needed)', () => {
    const preview = block(TALL + ' {\n  .wizard.step-table .ess.ess-barred:has(> .setup-preview)');
    expect(preview).toContain('.setup-preview { display: flex;');
  });
  it('other systems keep their own gates (this lane does not retune them)', () => {
    const online = read('../src/online/online.css');
    expect(online).toContain('(min-width: 1024px) and (min-height: 600px)');
    const viewport = read('../src/viewport.ts');
    expect(viewport).toContain('540');
  });
});

describe('H: portrait-tablet preview strip', () => {
  const PORTRAIT = '@media (orientation: portrait) and (min-width: 700px)';
  // Master's cd5cab7f added a card-scoped online strip block under the
  // same query; the bots strip is the block hosting .ess-barred's child.
  const strip = () => blockWith(PORTRAIT, '.ess-barred > .setup-preview');
  it('a portrait-tablet block turns the existing preview into a strip', () => {
    const b = strip();
    expect(b).toContain('.setup-preview { display: flex;');
  });
  it('the strip is horizontal and capped in the 150–180px band', () => {
    const b = strip();
    expect(b).toContain('flex-direction: row');
    const m = b.match(/\.setup-preview \{[^}]*height: (\d+)px/);
    if (!m) throw new Error('strip height not pinned in the portrait block');
    const h = parseFloat(m[1]!);
    expect(h).toBeGreaterThanOrEqual(150);
    expect(h).toBeLessThanOrEqual(180);
  });
  it('the strip shrinks the felt table to strip scale (~200px)', () => {
    const b = strip();
    expect(b).toMatch(/\.setup-preview \.sp-table \{[^}]*width: 200px/);
  });
  it('phone portrait stays preview-free: the base rule is still display:none and the strip gate starts at 700px', () => {
    expect(css).toContain('.setup-preview { display: none; }');
    expect(PORTRAIT).toContain('min-width: 700px');
  });
  it('the strip cannot double up with the landscape preview (portrait-only gate)', () => {
    expect(PORTRAIT).toContain('orientation: portrait');
  });
});
