/**
 * W1 Phase 2 pins — responsive audit 2026-11-05, Findings A + B.
 *
 * A: bid buttons. Portrait grid drops to 5 columns (coach or not) so a
 * 390px phone renders >=44px-wide buttons; bid buttons are de-clipped in
 * the 84ab0298 pattern (paint on a pointer-events:none ::before, the
 * element itself an un-clipped hit box); portrait rows carry a 44px
 * min-height floor while short landscape keeps its compact strip; and
 * where the rendered numeric buttons would still be <44px wide (small
 * portrait, e.g. 320px at 5 columns = ~40px) Table.tsx gates bidding
 * behind select-then-confirm (bidConfirmGate.ts) — everywhere else a
 * tap still bids immediately.
 *
 * B: chat overflow. The rail-clearing rule (43a4d800) moved the panel's
 * right offset to 68px+inset in every orientation but left the portrait
 * width at min(300px, 82vw), stranding the left edge off-screen below
 * ~368px. The fix derives the width from the SAME --chat-right custom
 * property that sets the offset, so the pair can never drift apart:
 * width = min(300px, 100dvw - var(--chat-right) - 8px - inset-left).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bidButtonWidthForViewport, bidNeedsConfirmForViewport, gateForRenderedWidth } from '../src/bidConfirmGate';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const table = readFileSync(new URL('../src/Table.tsx', import.meta.url), 'utf8');

function leafRules(source: string): { selector: string; body: string }[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { selector: string; body: string }[] = [];
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) return;
      const selector = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const inner = text.slice(open + 1, j - 1);
      if (selector.startsWith('@media') || selector.startsWith('@supports')) walk(inner);
      else if (selector && !selector.startsWith('@')) out.push({ selector, body: inner });
      i = j;
    }
  };
  walk(clean);
  return out;
}
function blocksFor(selector: string): string[] {
  return leafRules(css)
    .filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector))
    .map((r) => r.body);
}
function winning(selector: string, prop: string): string {
  const blocks = blocksFor(selector).filter((b) => b.includes(prop));
  if (!blocks.length) throw new Error(`no rule for ${selector} declaring ${prop}`);
  return blocks[blocks.length - 1]!;
}

const SLANT8 = 'polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px)';

describe('A: portrait bid grid is 5 columns, coach or not', () => {
  it('base grid', () => {
    expect(winning('.bid-grid', 'grid-template-columns')).toContain('repeat(5, 1fr)');
  });
  it('with-coach grid matches (no 8-column switch)', () => {
    expect(winning('.table-screen:not(.short) .bid-panel.with-coach .bid-grid', 'grid-template-columns')).toContain('repeat(5, 1fr)');
  });
  it('no 7/8-column bid grid remains anywhere', () => {
    expect(css).not.toContain('.bid-grid { display: grid; grid-template-columns: repeat(7, 1fr)');
    expect(css).not.toMatch(/bid-grid[^}]*repeat\(8, 1fr\)/);
  });
});

describe('A: bid buttons are de-clipped (84ab0298 pattern)', () => {
  it('the element itself carries no clip and no paint', () => {
    const block = winning('.bid-grid button', 'clip-path');
    expect(block).toContain('clip-path: none');
    expect(block).toContain('background: transparent');
    expect(block).toContain('box-shadow: none');
  });
  it('the ::before paints the chip: purple fill, ring, 8px slant, no hit area', () => {
    const before = blocksFor('.bid-grid button::before')[0]!;
    expect(before).toContain('pointer-events: none');
    expect(before).toContain('rgba(var(--purple-rgb), 0.16)');
    expect(before).toContain(`clip-path: ${SLANT8}`);
    expect(before).toContain('inset: 0');
  });
  it('hover paint moved to the chip layer too', () => {
    expect(blocksFor('.bid-grid button:hover::before')[0]).toContain('rgba(var(--purple-rgb), 0.35)');
  });
  it('NIL keeps its gradient + glow, on the chip layer', () => {
    // the nil ::before overrides only paint; content/inset/pointer-events
    // come from the base .bid-grid button::before rule above (same pseudo)
    const before = blocksFor('.bid-grid button.nil::before')[0]!;
    expect(before).toContain('linear-gradient(180deg, var(--purple-hot)');
    expect(before).toContain('box-shadow: 0 0 12px');
    expect(blocksFor('.bid-grid button::before')[0]).toContain('pointer-events: none');
  });
  it('blind-nil bid-row buttons in the panel are de-clipped as well', () => {
    expect(winning('.bid-panel .bid-row button', 'clip-path')).toContain('clip-path: none');
  });
});

describe('A: 44px height floor, portrait only', () => {
  it('portrait bid buttons have min-height 44', () => {
    expect(winning('.bid-grid button', 'min-height')).toContain('min-height: 44px');
  });
  it('short landscape keeps its compact strip (no floor, no label shrink)', () => {
    const block = winning('.table-screen.short .bid-grid button', 'min-height');
    expect(block).toContain('min-height: 0');
    expect(block).toContain('font-size: 15px');
    expect(block).toContain('padding: 3px 0');
  });
});

describe('A: select-then-confirm gate geometry (bidConfirmGate.ts)', () => {
  it('rendered-width formula matches the shipped reserves (70px .me + 24px panel, 5 cols, 6px gaps)', () => {
    expect(bidButtonWidthForViewport(390)).toBeCloseTo(54.4, 1);
    expect(bidButtonWidthForViewport(375)).toBeCloseTo(51.4, 1);
    expect(bidButtonWidthForViewport(360)).toBeCloseTo(48.4, 1);
    expect(bidButtonWidthForViewport(320)).toBeCloseTo(40.4, 1);
  });
  it('gate is ON only where buttons would be <44px wide in portrait', () => {
    expect(bidNeedsConfirmForViewport(320, 568)).toBe(true);
    expect(bidNeedsConfirmForViewport(360, 740)).toBe(false);
    expect(bidNeedsConfirmForViewport(390, 844)).toBe(false);
    expect(bidNeedsConfirmForViewport(430, 932)).toBe(false);
  });
  it('gate is OFF in short landscape (panel there stays one-tap)', () => {
    expect(bidNeedsConfirmForViewport(667, 375)).toBe(false);
    expect(bidNeedsConfirmForViewport(844, 390)).toBe(false);
  });
  it('rendered refinement: a non-positive width is no measurement and never engages the gate (G3)', () => {
    // In a zero-layout environment (the DOM test harness) every
    // getBoundingClientRect() reads 0. A 0 is the ABSENCE of a measurement,
    // not a measurement of a narrow button: the refinement must abstain
    // (null = keep the formula's verdict) instead of reading 0 < 44 as
    // "gated" — the misdeal-button-visible regression on the audit base.
    expect(gateForRenderedWidth(0)).toBeNull();
    expect(gateForRenderedWidth(-1)).toBeNull();
    expect(gateForRenderedWidth(Number.NaN)).toBeNull();
    expect(gateForRenderedWidth(40.4)).toBe(true);
    expect(gateForRenderedWidth(43.9)).toBe(true);
    expect(gateForRenderedWidth(44)).toBe(false);
    expect(gateForRenderedWidth(54.4)).toBe(false);
    expect(table).toContain('gateForRenderedWidth');
  });
  it('Table.tsx wires the gate: selection state, confirm control, reset, aria-pressed', () => {
    expect(table).toContain('pendingBid');
    expect(table).toContain('bidNeedsConfirmForViewport');
    expect(table).toContain('data-testid="bid-confirm"');
    expect(table).toContain('aria-pressed');
    expect(table).toContain('setPendingBid(null)');
  });
  it('selected bid button has a marked selected style', () => {
    const blocks = blocksFor('.bid-grid button.selected::before');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]).toContain('var(--gold');
  });
});

describe('B: chat width derives from the same --chat-right as the offset', () => {
  it('--chat-right is defined once on .table-screen from the rail geometry', () => {
    const defs = blocksFor('.table-screen').filter((b) => b.includes('--chat-right'));
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[defs.length - 1]).toContain('var(--rail-w, 60px)');
    expect(defs[defs.length - 1]).toContain('env(safe-area-inset-right)');
  });
  it('right and width both consume var(--chat-right) in the same rule', () => {
    const block = blocksFor('.table-screen .chat:not(.recap-chat)').find((b) => b.includes('right: var(--chat-right)'))!;
    expect(block).toBeTruthy();
    expect(block).toContain('calc(100dvw - var(--chat-right) - 8px - env(safe-area-inset-left))');
    expect(block).toContain('min(300px');
    expect(block).not.toContain('82vw');
  });
  it('short-landscape width keeps 330px/42vw but gains the available-space cap', () => {
    const blocks = blocksFor('.table-screen .chat:not(.recap-chat)').filter((b) => b.includes('42vw'));
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[blocks.length - 1]).toContain('var(--chat-right)');
  });
  it('recap chat is untouched by the pairing (excluded by :not)', () => {
    for (const b of blocksFor('.table-screen .chat:not(.recap-chat)')) expect(b).not.toContain('recap-chat {');
    expect(css).toContain('.chat.glass.slant.recap-chat');
  });
  it('arithmetic: with the paired formula the left edge is >= 0 at narrow portrait widths', () => {
    // right offset = 60 (rail fallback) + 8 = 68 at zero insets (pinned above from the CSS var)
    for (const vw of [320, 360, 375, 390, 430]) {
      const width = Math.min(300, vw - 68 - 8);
      const left = vw - 68 - width;
      expect(left, `${vw}px: left ${left}`).toBeGreaterThanOrEqual(0);
    }
    expect(Math.min(300, 320 - 68 - 8)).toBe(244); // 320px panel width after the fix (was 262.4, left -10.4)
  });
});
