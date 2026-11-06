/**
 * BWM Central — verification-fix CSS pins (V1–V4, coordinator rulings
 * 2026-11-05, evidence in NOTES-VERIFY.md / geometry.json /
 * rig2-findings.json). Source pins in the repo's css.test idiom; the
 * behavioural proof (geometry + computed styles at 390×844, both
 * themes) is the fix lane's Playwright rig — these pins keep the
 * declarations from being quietly dropped later.
 *
 *  V1 — match "Score by hand" timeline measured 443px inside a 390px
 *       panel (body overflow 65–67px, second side cut off); the
 *       match-player header's team-name line clipped too.
 *  V2 — bare buttons in Central action rows took the UA buttonface
 *       background rgb(239,239,239) under near-white theme ink —
 *       white-on-white in BOTH themes (the same leak the .ot-acts
 *       note in social.css documents for Open Tables).
 *  V3 — duo pair card: the record column ran ~15px off the card with
 *       a very long pair name; the name column must yield instead.
 *  V4 — career team-name chip measured 391px, 13–15px past the panel,
 *       with a 41-char team name.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const social = readFileSync(new URL('../src/social/social.css', import.meta.url), 'utf8');
const compete = readFileSync(new URL('../src/social/Compete.tsx', import.meta.url), 'utf8');

/** The declaration block of the first rule whose selector matches exactly. */
function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${esc} \\{\\s*([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`rule not found: ${selector}`);
  return m[1]!;
}
/** True when SOME rule whose selector list contains `needle` declares `decl`. */
function hasRuleDeclaring(css: string, needle: string, decl: string): boolean {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.includes(needle) && m[2]!.includes(decl)) return true;
  }
  return false;
}

describe('V1: match timeline fits its card', () => {
  it('the timeline table is fixed-layout, so long side names cannot force its width', () => {
    expect(rule(social, '.match-timeline')).toContain('table-layout: fixed');
  });
  it('timeline header/data cells ellipsize instead of overflowing (scores stay visible)', () => {
    const cells = rule(social, '.match-timeline th, .match-timeline td');
    expect(cells).toContain('overflow: hidden');
    expect(cells).toContain('text-overflow: ellipsis');
    expect(cells).toContain('white-space: nowrap');
  });
  it('the Hand column keeps a fixed narrow width; side columns share the rest', () => {
    expect(rule(social, '.match-timeline th:first-child')).toContain('width: 5.4em');
  });
  it('the final-score table is fixed-layout too, with the score column pinned', () => {
    expect(rule(social, '.match-final')).toContain('table-layout: fixed');
    expect(rule(social, '.match-final td')).toContain('width: 4em');
    expect(rule(social, '.match-final th')).toContain('text-overflow: ellipsis');
  });
  it("the match-player header's team-name line can shrink and ellipsize", () => {
    const muted = rule(social, '.match-player .power-head .soc-muted');
    expect(muted).toContain('min-width: 0');
    expect(muted).toContain('overflow: hidden');
    expect(muted).toContain('text-overflow: ellipsis');
    expect(muted).toContain('white-space: nowrap');
  });
});

describe('V2: Central secondary buttons carry real paint in both themes', () => {
  // The shared rule: every Central action-row container whose bare
  // buttons leaked the UA background gets the player-row secondary
  // idiom (edge-tinted fill + hairline + theme ink), appearance reset
  // so no platform buttonface can leak back in.
  const CONTAINERS = ['.featured-acts', '.favorite-acts', '.rivalry-acts', '.headline-invite-acts', '.crew-invite-row'];
  for (const c of CONTAINERS) {
    it(`${c} bare buttons are painted (not .primary, not .ghost)`, () => {
      expect(hasRuleDeclaring(social, `${c} button:not(.primary):not(.ghost)`, 'background: rgba(var(--edge-rgb),.14)')).toBe(true);
      expect(hasRuleDeclaring(social, `${c} button:not(.primary):not(.ghost)`, 'color: var(--ink)')).toBe(true);
      expect(hasRuleDeclaring(social, `${c} button:not(.primary):not(.ghost)`, 'appearance: none')).toBe(true);
    });
  }
  it('the shared rule is NOT scoped to one theme (it must hold in Classic AND Neon)', () => {
    const m = /([^{}]*\.featured-acts button:not\(\.primary\):not\(\.ghost\)[^{}]*)\{/.exec(social);
    expect(m).not.toBeNull();
    expect(m![1]).not.toContain('data-theme');
  });
});

describe('V3: duo card — the name column yields, the record never clips', () => {
  it('.duo-names can shrink below its content width', () => {
    expect(rule(social, '.duo-names')).toContain('min-width: 0');
  });
  it('the pair names render in an ellipsizing text span (ranks-name-txt idiom)', () => {
    expect(compete).toContain('className="duo-names-txt"');
    const txt = rule(social, '.duo-names-txt');
    expect(txt).toContain('overflow: hidden');
    expect(txt).toContain('text-overflow: ellipsis');
    expect(txt).toContain('white-space: nowrap');
  });
  it('the record column is flex-none so it is never the part that clips', () => {
    expect(rule(social, '.duo-rec')).toContain('flex: none');
  });
});

describe('V4: career team-name chip is constrained to the panel', () => {
  it('.team-chip caps at the container width and ellipsizes', () => {
    const chip = rule(social, '.soc-badge-chip.team-chip');
    expect(chip).toContain('max-width: 100%');
    expect(chip).toContain('overflow: hidden');
    expect(chip).toContain('text-overflow: ellipsis');
    expect(chip).toContain('white-space: nowrap');
  });
  it('plain badge chips in a .soc-badges row are capped too (same overflow shape)', () => {
    expect(hasRuleDeclaring(social, '.soc-badges .soc-badge-chip', 'max-width: 100%')).toBe(true);
  });
});
