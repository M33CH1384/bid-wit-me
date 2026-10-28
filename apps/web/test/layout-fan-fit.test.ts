/**
 * D10 (design audit 2026-10-24, P1): table fan corners under HUD pills.
 * The measured pairs decompose into three different mechanisms:
 *
 *  1. PHANTOM (menu × card-LJ 32×21 at EVERY size; card-TH/AC × the speaker):
 *     the "cards" are the sr-only automation strip ([data-testid="hand"]).
 *     Its container is a true 1×1 sr box, but white-space:nowrap laid the
 *     strip's full-size buttons (28px tall, up to 96px wide, ~600px of
 *     layout rects) in one line from the container's static position under
 *     the header — geometry audits read them as HUD elements eating the
 *     fan's first card and the speaker. Play never uses their geometry
 *     (e2e reads state and plays via canvas coordinates); each button now
 *     gets its own 1×1 clipped box, so the whole class of pairs collapses
 *     to <= 1px.
 *
 *  2. REAL — trash-talk × fan cards (portrait/tablet) and plate chips × fan
 *     cards (landscape + wide screens). Overlap heights reach 33–38px —
 *     taller than the 28px sr strip — so these are the real fan cards'
 *     rotated AABBs (FeltHand: 3.2°/step rotation, 3px/step sag, cards to
 *     120×168). Fixes, all in the shipped sizing idioms:
 *       - the control rail rises 48px on sub-900px screens (23vh+8 -> +56):
 *         clears the deepest trash encroachment (33px portrait, 38px at
 *         768×1024) with >= 10px margin; the plate layout engine reads the
 *         rail's live rect as an obstacle, so plates re-avoid it.
 *       - short heights: the fan rises 16px (clears the 3–11px chip dips)
 *         and keeps a 104px right reserve on the short table layout.
 *       - tall wide screens: the fan drops from its 15vh anchor to 12px —
 *         a >= 103px drop at every audited height — putting its top edge
 *         below the .me plate row whose chips it covered for their full
 *         20px height; the last-trick readout (23vh + 64px) stays above it.
 *
 *  3. BY-DESIGN — bid-panel NIL × fan cards: the bid panel is a deliberate
 *     modal overlay. It renders only during bidding/exchange inside .me
 *     (z-index 9 over the fan's 7), Table measures the live hand top and
 *     sets --hand-clear so the panel rests just above the resting hand,
 *     and while it is open bidding is the only legal input. The last test
 *     pins that mechanism so the call stays true.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');
const table = read('../src/Table.tsx');

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};

describe('D10 phantom: the sr-only hand strip has no layout footprint', () => {
  it('each strip button gets its own 1×1 clipped sr box', () => {
    const i = css.indexOf('[data-testid="hand"] > button');
    expect(i).toBeGreaterThan(0);
    const ruleText = css.slice(i, css.indexOf('}', i));
    expect(ruleText).toContain('width: 1px !important');
    expect(ruleText).toContain('height: 1px !important');
    expect(ruleText).toContain('clip: rect(0 0 0 0)');
    // the container keeps its standard sr-only box
    expect(css).toContain('.sr-only { position: absolute !important; width: 1px; height: 1px;');
  });
});

describe('D10 real: rail rise + fan tiers clear the measured encroachments', () => {
  it('the rail rises 48px on sub-900px screens', () => {
    const rise = num(/@media \(max-width: 899px\) \{\s*\.ctl-rail \{ bottom: calc\(23vh \+ (\d+)px/, css);
    const baseRail = num(/\.ctl-rail, \.table-screen\.short \.ctl-rail \{[^}]*bottom: calc\(23vh \+ (\d+)px/, css);
    expect(rise - baseRail).toBe(48);
    // deepest measured trash encroachments: 33px (portrait), 38px (768×1024, 667×375 short is fan-reserve territory)
    expect(rise - baseRail).toBeGreaterThanOrEqual(33 + 10);
  });

  it('short heights: fan rises 16px over the chip dips and keeps a right reserve', () => {
    const i = css.indexOf('@media (max-height: 560px)');
    const block = css.slice(i, css.indexOf('@media (min-width: 601px)', i));
    expect(num(/\.felt-hand \{ bottom: calc\(15vh \+ (\d+)px/, block)).toBe(16);
    expect(16).toBeGreaterThanOrEqual(11 + 5); // deepest measured chip dip 11px + margin
    expect(num(/\.table-screen\.short \.felt-hand \{ right: (\d+)px/, block)).toBe(104);
  });

  it('tall wide screens: the fan drop clears the chips at every audited size', () => {
    const drop = num(/@media \(min-width: 601px\) and \(min-height: 561px\) \{\s*\.felt-hand \{ bottom: calc\((\d+)px/, css);
    expect(drop).toBe(12);
    // old top edge anchor was 15vh; the drop at each audited height must
    // exceed the 20px full-height chip coverage with real margin
    for (const h of [768, 820, 900, 1024, 1080]) {
      expect(0.15 * h - drop).toBeGreaterThanOrEqual(20 + 60);
    }
    // the last-trick readout stays above the dropped fan top
    // (fan top = 12 + 168 card + ~22 rotation/lift; readout = 23vh + 64)
    const fanTop = drop + 168 + 22;
    for (const h of [768, 820, 900, 1080]) {
      expect(0.23 * h + 64).toBeGreaterThan(fanTop);
    }
    // portrait phones are untouched by both tiers (width gate + height gate)
    expect(css).toContain('.felt-hand { position: absolute; z-index: 7; left: 0; right: 0; bottom: calc(15vh + env(safe-area-inset-bottom));');
  });
});

describe('D10 by-design: the bid panel is a measured modal overlay', () => {
  it('the panel’s column out-ranks the fan and rests on the measured hand top', () => {
    const meZ = num(/\.me \{[^}]*z-index: (\d+)/, css);
    const fanZ = num(/\.felt-hand \{[^}]*z-index: (\d+)/, css);
    expect(meZ).toBeGreaterThan(fanZ);
    expect(css).toContain('.table-screen:not(.short) .me:has(> .bid-panel) { bottom: var(--hand-clear, calc(43vh + env(safe-area-inset-bottom))); }');
    expect(table).toContain("el.style.setProperty('--hand-clear'");
  });
});
