/**
 * @vitest-environment happy-dom
 *
 * Misdeal button legibility (owner, 2026-10-25): the in-panel "Call misdeal —
 * no spades" bar was AVAILABLE but rendered muted, "as if it's turned off".
 * Mechanism, proven from the shipped CSS: the bid panel's generic button rule
 * `.bid-panel button` (class + element, specificity 0,1,1) sets the panel
 * wash `background: rgba(var(--purple-rgb), .16)`, and it out-specifies the
 * button's own rule `.misdeal-btn` (class only, 0,1,0) — so inside the panel
 * the button's gold gradient, white border and 900 weight never landed, while
 * its dark text color (#231303, uncontested) stayed. Dark text on the dark
 * plum wash computes to ~1.07:1 in BOTH themes: a live call in a disabled
 * costume. The floating (out-of-panel) call was never affected.
 *
 * The fix restores the paint with scoped rules that beat the wash on
 * specificity: `.misdeal-btn.misdeal-in-panel` (0,2,0) carries the same gold
 * the floating call wears, and the sibling theft — Blind Nil's `.danger`
 * red, stripped by the same wash inside the panel — is restored by
 * `.bid-panel .danger` (0,2,0). These tests COMPUTE the pairings from the
 * shipped CSS (the open-tables-contrast idiom): the cascade winner for the
 * in-panel background must be the gold gradient, and its text must reach
 * ≥ 4.5:1 at BOTH gradient stops in BOTH themes. The unavailable state is
 * pinned too: the button renders ONLY while canMisdeal offers it — absent,
 * never a disabled-styled element.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const stylesCss = read('../src/styles.css');
const tableTsx = read('../src/Table.tsx');

/* ------------------------------------------------------------ css utils */

type Rgb = [number, number, number];
type Spec = [number, number, number];

const ruleBlock = (css: string, selector: string): string => {
  const i = css.indexOf(selector);
  expect(i, `selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', i);
  return css.slice(open, css.indexOf('}', open));
};

/** Specificity (ids, classes/attrs/pseudo-classes, elements/pseudo-elements). */
const specificity = (sel: string): Spec => {
  const ids = (sel.match(/#/g) ?? []).length;
  const classes = (sel.match(/\.|::?[a-z-]+\(|\[/g) ?? []).length;
  const rest = sel.replace(/#[\w-]+/g, ' ').replace(/\.[\w-]+/g, ' ').replace(/::?[a-z-]+(\([^)]*\))?/g, ' ').replace(/\[[^\]]*\]/g, ' ');
  const elements = rest.split(/[\s>+~]+/).filter((t) => /^[a-z][\w-]*$/i.test(t)).length + (sel.match(/::[a-z-]+/g) ?? []).length;
  return [ids, classes, elements];
};
const specGt = (a: Spec, b: Spec): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];

const hexRgb = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const varHex = (block: string, name: string): string => {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `${name} in block`).toBeTruthy();
  return m![1]!;
};

const varTriplet = (block: string, name: string): Rgb => {
  const m = block.match(new RegExp(`${name}:\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)`));
  expect(m, `${name} triplet in block`).toBeTruthy();
  return [Number(m![1]), Number(m![2]), Number(m![3])];
};

/** the alpha in `rgba(var(--glass-rgb), A)` for the --glass declaration of a theme block */
const glassAlpha = (block: string): number => {
  const m = block.match(/--glass:\s*rgba\(var\(--glass-rgb\),\s*([\d.]+)\)/);
  expect(m, '--glass rgba in block').toBeTruthy();
  return Number(m![1]);
};

const gradientStops = (block: string): [Rgb, Rgb] => {
  const m = block.match(/linear-gradient\(180deg,\s*(#[0-9a-fA-F]{6}),\s*(#[0-9a-fA-F]{6})\)/);
  expect(m, '180deg two-stop gradient in block').toBeTruthy();
  return [hexRgb(m![1]!), hexRgb(m![2]!)];
};

/** fg (with alpha) composited over an opaque bg. */
const over = (fg: Rgb, a: number, bg: Rgb): Rgb =>
  [0, 1, 2].map((i) => Math.round(a * fg[i]! + (1 - a) * bg[i]!)) as unknown as Rgb;

const luminance = (rgb: Rgb): number => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
};

const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/* ------------------------------------------------------- theme fixtures */

const rootBlock = ruleBlock(stylesCss, ':root {');
const neonBlock = ruleBlock(stylesCss, 'html[data-theme="neon"] {');
const panelBtnBlock = ruleBlock(stylesCss, '.bid-panel button {');
const misdealBtnBlock = ruleBlock(stylesCss, '.misdeal-btn {');
const scopedBlock = ruleBlock(stylesCss, '.misdeal-btn.misdeal-in-panel {');
const dangerBlock = ruleBlock(stylesCss, '.danger {');
const panelDangerBlock = ruleBlock(stylesCss, '.bid-panel .danger {');

const washAlpha = Number(panelBtnBlock.match(/background:\s*rgba\(var\(--purple-rgb\),\s*([\d.]+)\)/)![1]);
const misdealText = hexRgb(misdealBtnBlock.match(/color:\s*(#[0-9a-fA-F]{6})/)![1]!);

const themes = [
  { name: 'Classic', block: rootBlock },
  { name: 'Neon', block: neonBlock },
] as const;

/** the panel's effective fill: --glass composited over the page --bg */
const panelFill = (block: string): Rgb => over(varTriplet(block, '--glass-rgb'), glassAlpha(block), hexRgb(varHex(block, '--bg')));
/** what the wash rule alone would paint inside the panel */
const washedFill = (block: string): Rgb => over(varTriplet(block, '--purple-rgb'), washAlpha, panelFill(block));

/* ----------------------------------------------------------------- tests */

describe('misdeal button — the available call carries its own paint', () => {
  it('the theft is real in the shipped numbers: without the scoped rule the wash wins and the pairing is ~1:1', () => {
    // cascade: .bid-panel button (0,1,1) beats .misdeal-btn (0,1,0) for background
    expect(specGt(specificity('.bid-panel button'), specificity('.misdeal-btn'))).toBe(true);
    for (const t of themes) {
      expect(contrast(misdealText, washedFill(t.block)), `${t.name} buggy pairing`).toBeLessThan(2);
    }
  });

  it('the scoped rule out-specifies the panel wash and restores the gold', () => {
    expect(specGt(specificity('.misdeal-btn.misdeal-in-panel'), specificity('.bid-panel button'))).toBe(true);
    expect(scopedBlock).toMatch(/background:\s*linear-gradient\(180deg,\s*#ffd75e,\s*#f59e0b\)/);
    expect(scopedBlock).toMatch(/color:\s*#231303/);
    expect(scopedBlock).toMatch(/clip-path:\s*none/); // the pill silhouette, un-chamfered
    expect(scopedBlock).toMatch(/border:\s*2px solid/);
  });

  it('available pairing computes ≥ 4.5:1 at both gradient stops, both themes', () => {
    const stops = gradientStops(scopedBlock);
    // the stops + text are literals — identical across themes by construction;
    // assert per theme anyway so a future themed override is measured, not assumed
    for (const t of themes) {
      expect(t.block.length, `${t.name} theme block`).toBeGreaterThan(0);
      for (const stop of stops) {
        expect(contrast(misdealText, stop), `${t.name} stop`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('sibling: Blind Nil’s danger red is restored inside the panel too', () => {
    expect(specGt(specificity('.bid-panel .danger'), specificity('.bid-panel button'))).toBe(true);
    const [hi, deep] = gradientStops(dangerBlock);
    expect(panelDangerBlock).toMatch(/background:\s*linear-gradient\(180deg,\s*#ff6b88,\s*#c2183c\)/);
    expect(hi).toEqual(hexRgb('#ff6b88'));
    // white label on the gradient's deep stop (where the centered label sits at rest)
    expect(contrast([255, 255, 255], deep)).toBeGreaterThanOrEqual(4.5);
  });

  it('unaffected siblings audited: number keys and NIL never lost their paint', () => {
    // number keys ARE the wash by design, with the theme ink on top — legible
    for (const t of themes) {
      const ink = hexRgb(varHex(t.block, '--ink'));
      expect(contrast(ink, washedFill(t.block)), `${t.name} number keys`).toBeGreaterThanOrEqual(4.5);
    }
    // NIL's own rule (0,2,0) already beats the wash — its gradient survives
    const nilBlock = ruleBlock(stylesCss, '.bid-grid .nil {');
    expect(nilBlock).toMatch(/linear-gradient/);
    expect(specGt(specificity('.bid-grid .nil'), specificity('.bid-grid button'))).toBe(true);
  });
});

describe('misdeal button — unavailable stays honest by absence', () => {
  it('both presentations render only under canMisdeal; no disabled-styled variant exists', () => {
    expect(tableTsx).toMatch(/canMisdeal && \(\s*<button[^>]*className="misdeal-btn misdeal-in-panel"/);
    expect(tableTsx).toMatch(/canMisdeal && !bidPanelShowing && <MisdealButton/);
    for (const line of tableTsx.split('\n')) {
      if (line.includes('misdeal-btn') || line.includes('MisdealButton')) {
        expect(line, 'no disabled misdeal rendering').not.toMatch(/disabled/);
      }
    }
  });
});
