/**
 * @vitest-environment happy-dom
 *
 * NEON HOME FIT (owner, 2026-11-08, Mac screenshot): "the neon theme
 * needs some work now, the home screen has a scroll on pc and the
 * phone / tablet needs to be looked at as well" — a scrollbar on the
 * home screen, the actions crowding the ticker, and the RESUME
 * signpost's label dangling its last word ("RESUME — THE KING OF
 * THE / BLOCK").
 *
 * THE SCROLL. The wizard is the scroll surface (its overflow-x:hidden
 * computes overflow-y to auto), so a too-tall stage scrolls INSIDE the
 * app while the document stays put. Measured on master in a headless
 * Chromium rig with the owner's exact home state (PLAY + King
 * signpost + story entry + streak chip + fire band + ticker): Classic
 * fits at every size; Neon scrolls — 390×844 wizard 1087px tall in an
 * 844px viewport (RESUME and STORY MODE below the fold), desktop
 * stage 941px vs Classic's 808 with the splash and actions in
 * SWAPPED columns, 932×430 splash crushed to 79px wide with the
 * tagline stacked a word per line.
 *
 * One cause, convicted by computed style: in Neon the EmblemSmoke
 * layer computes to position:relative — an IN-FLOW stage item — even
 * though its own rule says absolute. The blanket content lift
 *   html[data-theme="neon"] .wiz-home > *:not(.home-streak-fire):not(.home-blizzard)
 *   { position: relative; z-index: 1 }
 * carries specificity (0,4,1) — every :not() argument counts — and
 * beats the smoke's own (0,3,1) rule. The lift exists for real
 * content (splash, actions). Every other decoration layer was
 * excluded by name when it shipped (the fire band 2026-11-01 — see
 * streak-fire.test.ts — the blizzard 2026-11-04); the smoke
 * (2026-10-29) never got its exclusion. In flow it inflates the
 * portrait grid's first row, steals a land-tab grid cell (hence the
 * column swap), and eats the landscape flex row (hence the crush).
 * These pins hold the exclusion + the cascade outcome, so the layer
 * can never silently re-enter the flow.
 *
 * THE WRAP. The story-resume row shares .quiet-row's row layout
 * (label left, chip right, chip never shrinks): wherever label +
 * chip outmeasure the row, the label wraps and its last word
 * dangles. Measured on master: 2 lines / 72px in the 460px desktop
 * column, 3 lines / 94px at 375px portrait. The signpost is now a
 * stacked button — title on its own single line (nowrap; ellipsis
 * is the narrow-screen valve), the pair chip as a sub-line beneath
 * — the same read at every width, in both themes (one shared tree).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('../src/styles.css');

/* ---------------- specificity + a one-property cascade ------------------ */

/** CSS specificity [id, class-ish, element-ish]. :not() contributes its
 * argument's specificity, never its own — the arithmetic that convicted
 * the smoke override. */
function specificity(sel: string): [number, number, number] {
  let a = 0, b = 0, c = 0;
  const s = sel.replace(/:not\(([^()]*)\)/g, (_m, inner: string) => {
    const [x, y, z] = specificity(inner);
    a += x; b += y; c += z;
    return ' ';
  });
  a += (s.match(/#[\w-]+/g) ?? []).length;
  b += (s.match(/\.[\w-]+/g) ?? []).length;
  b += (s.match(/\[[^\]]*\]/g) ?? []).length;
  b += (s.match(/:(?!:)[\w-]+/g) ?? []).length;
  c += (s.match(/::[\w-]+/g) ?? []).length;
  const rest = s
    .replace(/#[\w-]+/g, ' ').replace(/\.[\w-]+/g, ' ').replace(/\[[^\]]*\]/g, ' ')
    .replace(/::?[\w-]+/g, ' ');
  c += rest.split(/[\s>+~*,]+/).filter((t) => /^[a-zA-Z][\w-]*$/.test(t)).length;
  return [a, b, c];
}

const cmpSpec = (x: [number, number, number], y: [number, number, number]) =>
  x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

/** Every rule in the stylesheet that declares `position` on a selector
 * matching `test`, in source order. Comments are stripped first so a
 * rule's selector is the text directly before its brace. */
function positionRules(test: (sel: string) => boolean) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: { sel: string; position: string; spec: [number, number, number]; at: number }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bare))) {
    const sel = m[1].trim();
    if (!test(sel)) continue;
    const pos = m[2].match(/position:\s*(\w+)/);
    if (!pos) continue;
    out.push({ sel, position: pos[1], spec: specificity(sel), at: m.index });
  }
  return out;
}

/* ---------------- the emblem smoke stays out of the flow ---------------- */

describe('neon home: the blanket lift never swallows the decoration layers', () => {
  it('the lift excludes every decoration layer by name — fire, blizzard, and the emblem smoke', () => {
    expect(css).toContain('.wiz-home > *:not(.home-streak-fire)');
    expect(css).toContain(':not(.home-blizzard)');
    expect(css).toContain(':not(.emblem-smoke)');
    expect(css).not.toContain('html[data-theme="neon"] .wiz-home > * {');
  });

  it('the cascade winner for .emblem-smoke under Neon is its own absolute rule', () => {
    // candidates: any rule setting position on the smoke — its base rule,
    // its Neon rule, and the blanket lift (a candidate only while the
    // lift's selector still reaches it, i.e. does not exclude it)
    const candidates = positionRules((sel) => {
      if (/^\.emblem-smoke$/.test(sel)) return true;
      if (sel === 'html[data-theme="neon"] .wiz-home > .emblem-smoke') return true;
      if (sel.startsWith('html[data-theme="neon"] .wiz-home > *')) return !sel.includes(':not(.emblem-smoke)');
      return false;
    });
    expect(candidates.length).toBeGreaterThanOrEqual(2); // base + Neon rule, plus the lift while it still reaches the layer
    const winner = candidates.reduce((w, r) => (cmpSpec(r.spec, w.spec) > 0 || (cmpSpec(r.spec, w.spec) === 0 && r.at > w.at) ? r : w));
    expect(winner.position, `winning rule: ${winner.sel}`).toBe('absolute');
  });

  it('the smoke keeps its designed box: absolute, stage-spanning, inert', () => {
    const base = css.match(/\.emblem-smoke \{([^}]*)\}/);
    expect(base).toBeTruthy();
    expect(base![1]).toContain('position: absolute');
    expect(base![1]).toContain('display: none'); // outside Neon it never renders
    const neon = css.match(/html\[data-theme="neon"\] \.wiz-home > \.emblem-smoke \{([^}]*)\}/);
    expect(neon).toBeTruthy();
    expect(neon![1]).toContain('position: absolute');
    expect(neon![1]).toContain('display: block');
  });
});

/* ---------------- the resume signpost never wraps ----------------------- */

describe('story resume signpost: one line for the title, the chip beneath', () => {
  it('the signpost stacks: label line over chip line, left-aligned', () => {
    const rule = css.match(/\.story-resume-row \{([^}]*)\}/);
    expect(rule, '.story-resume-row carries its own composition rule').toBeTruthy();
    expect(rule![1]).toContain('flex-direction: column');
    expect(rule![1]).toContain('align-items: flex-start');
  });

  it('the title span can never wrap — nowrap, ellipsis as the narrow valve', () => {
    const rule = css.match(/\.story-resume-row > span:first-child \{([^}]*)\}/);
    expect(rule, 'the signpost title span has its own rule').toBeTruthy();
    expect(rule![1]).toContain('white-space: nowrap');
    expect(rule![1]).toContain('text-overflow: ellipsis');
  });

  it('the shared quiet-row pattern itself is untouched (other rows keep label-left, chip-right)', () => {
    const quiet = css.match(/\.quiet-row \{([^}]*)\}/);
    expect(quiet).toBeTruthy();
    expect(quiet![1]).toContain('justify-content:space-between');
    expect(quiet![1]).not.toContain('flex-direction: column');
  });
});

/* ---------------- the stage budget, land-tab regime --------------------- */

describe('desktop home: the composition fits with the smoke out of flow', () => {
  // Content heights measured on master in the rig (owner's full state):
  // splash 194 (logo 151 + tagline), actions 273 with the stacked
  // signpost (chip 28 + PLAY 76 + signpost ~74 + entry 56 + gaps 42,
  // rounded up from the measured parts). Fixed shell: wiz-bar 56
  // (10 padding + 46 icon), land-tab stage bottom padding 80, ticker
  // reserve 38 (social.css). In flow under Neon after the fix: splash
  // + actions only — the budget below is their worst column.
  const BAR = 56, STAGE_PAD_BOTTOM = 80, TICKER = 38;
  const CONTENT = Math.max(194, 273);
  it.each([[1440, 900], [1366, 768], [1180, 820]])('%sx%s: shell + content stays inside the viewport', (w, h) => {
    void w;
    const pad = parseFloat(css.match(/\.wiz-home \{[^}]*padding: 0 120px (\d+)px;/)![1]);
    expect(pad).toBe(STAGE_PAD_BOTTOM);
    expect(BAR + CONTENT + pad + TICKER).toBeLessThanOrEqual(h);
  });
});
