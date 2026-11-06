/**
 * CSS contract for the online-create venue preview (owner 2026-11-05,
 * responsive audit G5): the SAME .setup-preview element is turned on inside
 * a setup card by a card-scoped rule, while the bots host's rules — the
 * display:none base and the land-tab grid placement — stay verbatim.
 * (Node environment: reads the stylesheet text, like layout-setupbar-fit.)
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

describe('online preview CSS contract', () => {
  it('the in-card preview is displayed by a card-scoped rule; the bots host rules are untouched', () => {
    // base rule still hides the element everywhere by default
    expect(css).toContain('.setup-preview { display: none; }');
    // a rule scoped to a preview inside a setup card turns it on
    const i = css.indexOf('.setup-card .setup-preview {');
    expect(i).toBeGreaterThan(-1);
    const block = css.slice(i, css.indexOf('}', i));
    expect(block).toContain('display: flex');
    // the bots land-tab placement survives verbatim
    expect(css).toContain('.wizard.step-table .ess-barred:has(> .setup-preview) > .setup-preview { display: flex; grid-column: 3; grid-row: 1 / span 2; min-height: 260px; }');
  });
});
