/** Rep block legibility (owner, 2026-10-24, annotated profile screenshot:
 *  "This bar needs to be thicker so the numbers can be larger for legibility").
 *  The shared Rep block (RepBlock.tsx) renders on the full profile AND in the
 *  in-game profile modal. The growth is scoped to the full profile via the
 *  .profile-view root (ProfileView — /profile and the Social profile); the
 *  modal is a compact quick-peek and keeps the base sizes. These pins hold
 *  both halves of that contract: a future shrink of the profile block — or a
 *  future growth leaking into the modal — fails here. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

/** The declaration block of the first rule whose selector matches exactly. */
function rule(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|\\n)${esc} \\{\\s*([^}]*)\\}`).exec(css);
  if (!m) throw new Error(`rule not found: ${selector}`);
  return m[1]!;
}
function px(body: string, prop: string): number {
  const m = new RegExp(`${prop}: (\\d+(?:\\.\\d+)?)px`).exec(body);
  if (!m) throw new Error(`no ${prop} in: ${body}`);
  return Number(m[1]);
}

describe('rep block legibility — full profile', () => {
  it('the XP bar is substantially thicker than the compact base', () => {
    expect(px(rule(styles, '.profile-view .xp-bar'), 'height')).toBeGreaterThanOrEqual(20);
  });

  it('the XP readout grows with the bar — bold and tabular inside it', () => {
    const small = rule(styles, '.profile-view .xp-bar small');
    expect(px(small, 'font-size')).toBeGreaterThanOrEqual(13);
    expect(small).toContain('font-weight: 700');
    expect(small).toContain('font-variant-numeric: tabular-nums');
  });

  it('the rating and coin chips carry larger numbers on one line', () => {
    expect(px(rule(styles, '.profile-view .soc-div-chip'), 'font-size')).toBeGreaterThanOrEqual(15);
    expect(px(rule(styles, '.profile-view .soc-coin-chip'), 'font-size')).toBeGreaterThanOrEqual(15);
    expect(rule(styles, '.profile-view .soc-rep-ranks')).toContain('flex-wrap: nowrap');
  });
});

describe('rep block legibility — the modal keeps its compact base', () => {
  it('the unscoped base rules stay at the quick-peek sizes', () => {
    expect(px(rule(styles, '.xp-bar'), 'height')).toBe(10);
    expect(px(rule(styles, '.xp-bar small'), 'font-size')).toBe(9);
    expect(px(rule(styles, '.soc-div-chip'), 'font-size')).toBe(13);
    expect(px(rule(styles, '.soc-coin-chip'), 'font-size')).toBe(13);
  });
});
