/**
 * @vitest-environment happy-dom
 *
 * Watch-button legibility (owner, 2026-10-24): in Open Tables the Watch
 * action rendered as a ghost — near-white text on a pale pill. Root
 * cause: the button is BARE (no class) and its only rule, `.ot-acts
 * button`, set geometry (min-width / padding / radius) with no paint —
 * no background, no border, no appearance reset. The global button rule
 * gives it `color: inherit`, i.e. the theme ink (--ink, near-white in
 * BOTH themes), so the label painted in near-white over the platform's
 * default light pill face. Same fallback the codebase already documented
 * once for the Settings audio-quality seg (.sf-seg, styles.css).
 *
 * The fix gives the non-primary action in .ot-acts the ghost treatment
 * the row's own filter chips already use (translucent fill, edge
 * hairline, --ink text, appearance reset), keeping Join the gold
 * .primary. These tests COMPUTE the pairing from the shipped CSS (the
 * player-card nameplate idiom): the label ink over its effective
 * background — ghost fill composited over the row card composited over
 * the page --bg — must reach ≥ 4.5:1 in Classic AND Neon, so the
 * pairing cannot silently regress to the UA pill again.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const socialCss = read('../src/social/social.css');
const stylesCss = read('../src/styles.css');
const openTables = read('../src/social/OpenTables.tsx');

/* ------------------------------------------------------------ css utils */

type Rgb = [number, number, number];

const ruleBlock = (css: string, selector: string): string => {
  const i = css.indexOf(selector);
  expect(i, `selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', i);
  return css.slice(open, css.indexOf('}', open));
};

const hexRgb = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
};

const varHex = (block: string, name: string): string => {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `${name} in block`).toBeTruthy();
  return m![1]!;
};

const rgbaOf = (block: string, prop: string): { rgb: Rgb; a: number } => {
  const m = block.match(new RegExp(`${prop}:\\s*rgba\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*([\\d.]+)\\s*\\)`));
  expect(m, `${prop} rgba() in block`).toBeTruthy();
  return { rgb: [Number(m![1]), Number(m![2]), Number(m![3])], a: Number(m![4]) };
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

/* ------------------------------------------------------------- the fix */

describe('open tables — the Watch button carries its own paint', () => {
  const ghostBlock = () => ruleBlock(socialCss, '.ot-acts button:not(.primary) {');

  it('the ghost rule exists and resets the platform pill (appearance + own background + own border)', () => {
    const ghost = ghostBlock();
    expect(ghost).toMatch(/appearance:\s*none/);
    expect(ghost).toMatch(/background:\s*rgba\(/);
    expect(ghost).toMatch(/border:\s*1px solid/);
    expect(ghost).toMatch(/color:\s*var\(--ink\)/);
  });

  it('hierarchy intact: Join keeps .primary (gold), Watch stays the bare secondary the ghost rule dresses', () => {
    expect(openTables).toMatch(/className="primary" data-testid=\{`ot-join-/);
    expect(openTables).toMatch(/<button type="button" data-testid=\{`ot-watch-/);
    expect(openTables).not.toMatch(/className="primary" data-testid=\{`ot-watch-/);
  });

  it('the label ink meets ≥ 4.5:1 over its effective background in BOTH themes (computed from the shipped css)', () => {
    const rowBg = rgbaOf(ruleBlock(socialCss, '.ot-row {'), 'background');
    const fill = rgbaOf(ghostBlock(), 'background');
    const themes: [string, string][] = [
      ['classic', ruleBlock(stylesCss, ':root {')],
      ['neon', ruleBlock(stylesCss, 'html[data-theme="neon"] {')],
    ];
    for (const [name, vars] of themes) {
      const ink = hexRgb(varHex(vars, '--ink'));
      const page = hexRgb(varHex(vars, '--bg'));
      const effective = over(fill.rgb, fill.a, over(rowBg.rgb, rowBg.a, page));
      expect(contrast(ink, effective), `${name}: ink vs watch background`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
