/**
 * D5 (design audit 2026-10-24, P1): the versus intro / table loading shell
 * (.bwm-loading) was fixed, grid-centered, with NO scroll — in phone
 * landscape the versus stack (~465px) overflowed the 327px available at
 * 667×375 and ~138px was clipped, unreachable, at both ends; the standard
 * hold (~382px) lost ~55px the same way.
 *
 * Fix: the shell scrolls (overflow-y: auto) and the card centers SAFELY
 * (margin: auto — centers when it fits, collapses to 0 when it doesn't, so
 * the top of the stack is always reachable), plus a max-height: 560px
 * compact variant that shrinks both stacks to fit whole at the audited
 * landscape sizes. Budgets below are recomputed from the shipped compact
 * constants; line heights use the house factors (Barlow ~1.15–1.2, body
 * ~1.35). The wordmark's aspect (93px tall at 280px wide) was measured in
 * the audit (full-size stack 382px accounting).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return parseFloat(m[1]!);
};
const compactStart = css.indexOf('@media (max-height: 560px)');
const base = css.slice(0, compactStart);
const compact = css.slice(compactStart, css.indexOf('/* Pre-deal setup window', compactStart));

/** Compact constants parsed from the shipped media block. */
const C = {
  padY: num(/\.bwm-loading \{ padding: calc\((\d+)px/, compact) * 2,
  cardGap: num(/\.bwm-loading-card \{ gap: (\d+)px/, compact),
  markW: num(/\.bwm-loading-mark \{ width: min\(46%, (\d+)px\)/, compact),
  tipEm: num(/\.bwm-loading-tip \{ min-height: ([\d.]+)em/, compact),
  facebox: num(/\.bwm-seat-facebox \{ height: (\d+)px/, compact),
  plate: num(/\.bwm-seat-plate \{ height: (\d+)px/, compact),
  stage: num(/\.versus-stage \{ min-height: (\d+)px/, compact),
  stageSolo: num(/\.versus-stage\.solo \{ min-height: (\d+)px/, compact),
  shakeGap: num(/\.versus-shake \{ gap: (\d+)px/, compact),
  tapePadTop: num(/\.versus-tape \{ padding: (\d+)px \d+px \d+px/, compact),
  tapePadBottom: num(/\.versus-tape \{ padding: \d+px \d+px (\d+)px/, compact),
  titleMargin: num(/\.versus-tape-title \{ margin-bottom: (\d+)px/, compact),
  potMargin: num(/\.versus-pot \{ margin-bottom: (\d+)px/, compact),
  rowPad: num(/\.versus-row \{ padding: (\d+)px \d+px/, compact) * 2,
  cell: num(/\.versus-cell \{ font-size: (\d+)px/, compact),
  face: num(/\.versus-face \{ width: (\d+)px !important/, compact),
  trackMargin: num(/\.versus-track \{ margin-top: (\d+)px/, compact),
};
const MARK_ASPECT = 93 / 280; // measured in the audit at the full-size mark
const TRACK_H = 3; // .bwm-loading-track height (unchanged by the compact block)

/** Versus tape: padding + title (11px font + margin) + pot (13px + margin)
 *  + 4 stat rows (cell font + row padding + 1px top border). */
const tape =
  C.tapePadTop + C.tapePadBottom + (11 + C.titleMargin) + (13 + C.potMargin) + 4 * (C.cell + C.rowPad + 1);
const versusTeam = C.stage + C.shakeGap + tape + C.cardGap + C.trackMargin + TRACK_H;
const versusSolo = C.stageSolo + C.shakeGap + tape + C.cardGap + C.trackMargin + TRACK_H;

/** Standard hold: mark + room line + status line + track + seat row + tip. */
const seats = 4 + Math.max(C.facebox, C.plate) + 5 + Math.ceil(12.5 * 1.1) + 5 + Math.ceil(10.5 * 1.2); // margin + face/plate + gaps + name + tag
const tip = 2 + Math.max(C.tipEm * 17, 12 + 6 + 2 * 17 * 1.35); // margin + reserved or 2-line text, whichever is taller
const standard =
  Math.round(C.markW * MARK_ASPECT) + C.cardGap + (2 + 12) + C.cardGap + Math.ceil(15 * 1.2) + C.cardGap + TRACK_H + C.cardGap + seats + C.cardGap + tip;

const LANDSCAPE = [
  { name: '667×375', h: 375 },
  { name: '844×390', h: 390 },
  { name: '932×430', h: 430 },
] as const;

describe('D5: the loading shell centers safely and scrolls', () => {
  it('shell scrolls; card uses auto margins (safe centering)', () => {
    expect(css).toContain('.bwm-loading { position: fixed; inset: 0; z-index: 80; display: grid; place-items: center; overflow-y: auto;');
    expect(css).toContain('.bwm-loading-card { width: min(100%, 360px); margin: auto;');
  });

  it('portrait/full-size rules are untouched (compact is height-gated)', () => {
    expect(num(/\.versus-stage \{[^}]*min-height: (\d+)px/, base)).toBe(168);
    expect(num(/\.bwm-loading-tip \{[^}]*min-height: ([\d.]+)em/, base)).toBe(5.6);
    expect(compactStart).toBeGreaterThan(0);
  });
});

describe('D5: compact budgets fit the audited landscape sizes whole', () => {
  it('faces shrink to 52px (inline sizes overridden with !important)', () => {
    expect(C.face).toBe(52);
    expect(compact).toContain('.versus-face .avatar-circle, .versus-face > span { width: 52px !important; height: 52px !important; font-size: 22px !important; }');
  });

  for (const s of LANDSCAPE) {
    it(`versus (team) fits at ${s.name}`, () => {
      expect(versusTeam).toBeLessThanOrEqual(s.h - C.padY);
    });
    it(`versus (solo) fits at ${s.name}`, () => {
      expect(versusSolo).toBeLessThanOrEqual(s.h - C.padY);
    });
    it(`standard hold fits at ${s.name}`, () => {
      expect(standard).toBeLessThanOrEqual(s.h - C.padY);
    });
  }

  it('even where a stack would exceed the shell, the scroll reaches it', () => {
    // the guarantee is structural: overflow-y auto + margin-auto centering —
    // asserted above; the budgets show the audited sizes need no scroll.
    expect(versusTeam).toBe(271);
    expect(standard).toBeLessThanOrEqual(300);
  });
});
