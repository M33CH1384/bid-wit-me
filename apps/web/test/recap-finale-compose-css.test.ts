/**
 * Finale composition CSS pins (owner, 2026-10-21) — the stylesheet half
 * of recap-finale-compose.test.ts (which pins the DOM through real
 * engine-driven games). Node environment so the CSS can be read from
 * disk, the recap-present.test.ts pattern. The composition lives in an
 * appended override block at the end of animfx.css; these pins keep the
 * load-bearing rules from drifting:
 *  - the cover clipped to the card face (no bleed past the card),
 *  - the verdict plaque as a FLOW grid row (never an absolute overlay),
 *  - the Rec finale banner as a compact strip with its GAME fragment
 *    suppressed (the plaque owns the verdict words),
 *  - the reserved top band (.fv-band) on Rec/Cookout finale cards.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/animfx/animfx.css', import.meta.url), 'utf8');

describe('the composition CSS (appended overrides in animfx.css)', () => {
  it('the cover is clipped to the card face — no bleed', () => {
    expect(css).toContain('.setcover { inset: 0; }');
  });
  it('the verdict plaque is a flow grid row, not an overlay', () => {
    expect(css).toContain('.finale-verdict { grid-area: verdict;');
    expect(css).toContain('.tt-face.has-verdict { grid-template-areas: "name bags" "line bags" "players bags" "verdict verdict" "bar bar"; }');
    expect(css).not.toContain('.finale-verdict { position: absolute');
  });
  it('the verdict stamp keeps the cover’s clock and gates', () => {
    expect(css).toContain('.finale-verdict.fresh { animation: sc-headline-in .45s cubic-bezier(.2, 1.4, .4, 1) calc(var(--sc-delay, 0ms) + 1100ms) both; }');
    expect(css).toContain('.finale-verdict.waiting, .tt-backdrop:not(.presented) .finale-verdict.fresh { animation-play-state: paused; }');
  });
  it('the Rec finale banner is a compact strip and its GAME fragment is suppressed', () => {
    expect(css).toContain('.setcover[data-anim="rec-center"].tier-finale .sc-banner { height: 44px; }');
    expect(css).toContain('.setcover[data-anim="rec-center"].tier-finale .sc-banner em { display: none; }');
  });
  it('finale cards reserve the strip band at the top of the face', () => {
    expect(css).toContain('.tt-team.fv-band .tt-face { padding-top: 52px; }');
    expect(css).toContain('.setcover[data-anim="cookout"].tier-finale .sc-lid { height: 40px; }');
  });
});
